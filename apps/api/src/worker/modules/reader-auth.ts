import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../lib/password-hash';
import { consumeResetToken, createResetToken } from '../../lib/password-reset';
import { expireReservations, MS_PER_DAY, refreshOverdue } from '../../lib/overdue';
import { stripLoanBlobsMany } from '../../lib/strip-signature-blobs';
import { writeAudit } from '../../lib/audit';
import { prismaOf } from '../db';
import { loginLimiter } from '../rate-limit';
import { publicReader, requireReader, signReaderToken } from '../auth';
import { frontendUrl, passwordPepper } from '../env';
import { passwordResetEmail, sendEmail } from '../mail';
import { clientIp, reqJson } from '../http';
import {
  cleanNull,
  dateOrNull,
  forgotPasswordSchema,
  parse,
  readerClaimSchema,
  readerLoginSchema,
  readerRegisterSchema,
  readerSelfPasswordSchema,
  readerSelfUpdateSchema,
  readerSignatureSchema,
  resetPasswordWithTokenSchema,
} from '../../validation';
import type { AppEnv } from '../context';

export const readerAuthApp = new Hono<AppEnv>();

const RESERVATION_DAYS = 3;

// --- Autocadastro público: cria leitor ACTIVE + senha e já autentica ---
readerAuthApp.post('/register', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(readerRegisterSchema, await reqJson(c));
  const cpfClash = await prisma.reader.findUnique({ where: { cpf: data.cpf } });
  if (cpfClash) throw new HttpError(409, 'CPF já cadastrado');
  const emailClash = await prisma.reader.findFirst({ where: { email: data.email } });
  if (emailClash) throw new HttpError(409, 'E-mail já cadastrado');
  const reader = await prisma.reader.create({
    data: {
      name: data.name,
      cpf: data.cpf,
      birthDate: dateOrNull(data.birthDate) ?? null,
      phone: cleanNull(data.phone),
      email: data.email,
      cep: cleanNull(data.cep),
      address: cleanNull(data.address),
      number: cleanNull(data.number),
      neighborhood: cleanNull(data.neighborhood),
      city: cleanNull(data.city),
      state: cleanNull(data.state),
      status: 'ACTIVE',
      passwordHash: await hashPassword(data.password, passwordPepper(c.env)),
    },
  });
  const token = await signReaderToken(c.env, reader);
  await writeAudit(null, 'READER_CREATED', 'Reader', reader.id, { self: true }, clientIp(c), prisma);
  return c.json({ token, reader: publicReader(reader) }, 201);
});

// --- Login do portal do leitor ---
readerAuthApp.post('/login', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(readerLoginSchema, await reqJson(c));
  const reader = await prisma.reader.findFirst({ where: { email: data.email, deletedAt: null } });
  const result = await verifyPassword(
    data.password,
    reader?.passwordHash ?? DUMMY_PASSWORD_HASH,
    passwordPepper(c.env),
  );
  if (!reader || !reader.passwordHash || result === 'invalid' || reader.status !== 'ACTIVE') {
    await writeAudit(null, 'LOGIN_FAILED', 'Reader', reader?.id, { email: data.email }, clientIp(c), prisma);
    throw new HttpError(401, 'E-mail ou senha inválidos');
  }
  if (result === 'legacy') {
    await writeAudit(null, 'LOGIN_FAILED', 'Reader', reader.id, { email: data.email, legacy: true }, clientIp(c), prisma);
    throw new HttpError(
      401,
      'Sua senha precisa ser redefinida. Use "Esqueci a senha" ou peça ajuda no balcão.',
    );
  }
  if (needsRehash(reader.passwordHash!)) {
    await prisma.reader.update({
      where: { id: reader.id },
      data: { passwordHash: await hashPassword(data.password, passwordPepper(c.env)) },
    });
  }
  const token = await signReaderToken(c.env, reader);
  await writeAudit(null, 'LOGIN', 'Reader', reader.id, undefined, clientIp(c), prisma);
  return c.json({ token, reader: publicReader(reader) });
});

// --- Primeiro acesso: leitor já cadastrado confere CPF + e-mail e define a senha ---
readerAuthApp.post('/claim', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(readerClaimSchema, await reqJson(c));
  const cpfDigits = data.cpf.replace(/\D/g, '');
  const reader =
    (await prisma.reader.findUnique({ where: { cpf: data.cpf } })) ??
    (cpfDigits !== data.cpf
      ? await prisma.reader.findUnique({ where: { cpf: cpfDigits } })
      : null);
  const emailOk =
    !!reader?.email && reader.email.trim().toLowerCase() === data.email;
  if (!reader || reader.deletedAt || reader.status !== 'ACTIVE' || !emailOk || reader.passwordHash) {
    await writeAudit(null, 'LOGIN_FAILED', 'Reader', reader?.id, { claim: true }, clientIp(c), prisma);
    throw new HttpError(401, 'Dados não conferem ou conta já possui senha de acesso');
  }
  const updated = await prisma.reader.update({
    where: { id: reader.id },
    data: { passwordHash: await hashPassword(data.password, passwordPepper(c.env)) },
  });
  const token = await signReaderToken(c.env, updated);
  await writeAudit(null, 'READER_UPDATED', 'Reader', reader.id, { self: true, claimed: true }, clientIp(c), prisma);
  return c.json({ token, reader: publicReader(updated) });
});

// --- Perfil próprio ---
readerAuthApp.get('/me', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const reader = await prisma.reader.findUnique({ where: { id: c.get('reader')!.id } });
  if (!reader) throw new HttpError(404, 'Leitor não encontrado');
  return c.json({ reader: publicReader(reader) });
});

readerAuthApp.put('/me', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const id = c.get('reader')!.id;
  const data = parse(readerSelfUpdateSchema, await reqJson(c));
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, 'Leitor não encontrado');
  if (data.email && data.email !== existing.email) {
    const emailClash = await prisma.reader.findFirst({ where: { email: data.email, NOT: { id } } });
    if (emailClash) throw new HttpError(409, 'E-mail já cadastrado');
  }
  const reader = await prisma.reader.update({
    where: { id },
    data: {
      name: data.name ?? existing.name,
      birthDate: data.birthDate !== undefined ? (dateOrNull(data.birthDate) ?? null) : existing.birthDate,
      phone: data.phone !== undefined ? cleanNull(data.phone) : existing.phone,
      email: data.email !== undefined ? cleanNull(data.email) : existing.email,
      cep: data.cep !== undefined ? cleanNull(data.cep) : existing.cep,
      address: data.address !== undefined ? cleanNull(data.address) : existing.address,
      number: data.number !== undefined ? cleanNull(data.number) : existing.number,
      neighborhood: data.neighborhood !== undefined ? cleanNull(data.neighborhood) : existing.neighborhood,
      city: data.city !== undefined ? cleanNull(data.city) : existing.city,
      state: data.state !== undefined ? cleanNull(data.state) : existing.state,
    },
  });
  await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true }, clientIp(c), prisma);
  return c.json({ reader: publicReader(reader) });
});

// --- Assinatura do próprio leitor: salva/substitui (somente a atual do perfil) ---
readerAuthApp.patch('/me/signature', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const id = c.get('reader')!.id;
  const data = parse(readerSignatureSchema, await reqJson(c));
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, 'Leitor não encontrado');
  const sig = data.signature ? data.signature : null;
  const hasSig = !!sig;
  const reader = await prisma.reader.update({
    where: { id },
    data: {
      signature: sig,
      signatureUpdatedAt: hasSig ? new Date() : null,
      signatureType: hasSig ? (data.signatureType ?? null) : null,
      signatureText: hasSig ? (data.signatureText ?? null) : null,
      rubricText: hasSig ? (data.rubricText ?? null) : null,
      rubricImage: hasSig ? (data.rubricImage ?? null) : null,
      fontFamily: hasSig ? (data.fontFamily ?? null) : null,
    },
  });
  await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true, signature: hasSig }, clientIp(c), prisma);
  return c.json({ reader: publicReader(reader) });
});

// --- Exclui a assinatura atual do perfil (não toca nas congeladas de empréstimos/devoluções) ---
readerAuthApp.delete('/me/signature', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const id = c.get('reader')!.id;
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new HttpError(404, 'Leitor não encontrado');
  const reader = await prisma.reader.update({
    where: { id },
    data: {
      signature: null,
      signatureUpdatedAt: null,
      signatureType: null,
      signatureText: null,
      rubricText: null,
      rubricImage: null,
      fontFamily: null,
    },
  });
  await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true, signature: false }, clientIp(c), prisma);
  return c.json({ reader: publicReader(reader) });
});

readerAuthApp.post('/me/password', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const id = c.get('reader')!.id;
  const data = parse(readerSelfPasswordSchema, await reqJson(c));
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing || !existing.passwordHash) throw new HttpError(404, 'Leitor não encontrado');
  const valid = await verifyPassword(data.currentPassword, existing.passwordHash, passwordPepper(c.env));
  if (valid !== 'valid') throw new HttpError(401, 'Senha atual incorreta');
  await prisma.reader.update({
    where: { id },
    data: { passwordHash: await hashPassword(data.password, passwordPepper(c.env)) },
  });
  await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true, password: true }, clientIp(c), prisma);
  return c.json({ ok: true });
});

// --- Empréstimos próprios (leitura) ---
readerAuthApp.get('/me/loans', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const id = c.get('reader')!.id;
  await refreshOverdue(id, prisma);
  const loans = await prisma.loan.findMany({
    where: { readerId: id },
    include: { book: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const activeLoans = loans.filter((l) => l.status !== 'RETURNED');
  const overdueCount = loans.filter((l) => l.status === 'OVERDUE').length;
    return c.json({ loans: stripLoanBlobsMany(loans), activeLoans, overdueCount });
});

// --- Reservas próprias ---
readerAuthApp.get('/me/reservations', requireReader, async (c) => {
  const prisma = prismaOf(c);
  await expireReservations(prisma);
  const reservations = await prisma.reservation.findMany({
    where: { readerId: c.get('reader')!.id },
    include: { book: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return c.json({ reservations });
});

readerAuthApp.post('/me/reservations', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(z.object({ bookId: z.number().int() }), await reqJson(c));
  const readerId = c.get('reader')!.id;
  const book = await prisma.book.findUnique({ where: { id: data.bookId } });
  if (!book) throw new HttpError(404, 'Livro não encontrado');
  if (book.isArchived) throw new HttpError(400, 'Livro arquivado não pode ser reservado');
  const pending = await prisma.reservation.findFirst({
    where: { readerId, bookId: data.bookId, status: { in: ['PENDING', 'AVAILABLE'] } },
  });
  if (pending) throw new HttpError(400, 'Você já possui reserva ativa para este livro');
  const reservation = await prisma.reservation.create({
    data: {
      readerId,
      bookId: data.bookId,
      expiresAt: new Date(Date.now() + RESERVATION_DAYS * MS_PER_DAY),
    },
  });
  await writeAudit(null, 'RESERVATION_CREATED', 'Reservation', reservation.id, { readerId, bookId: data.bookId, self: true }, clientIp(c), prisma);
  return c.json(reservation, 201);
});

readerAuthApp.post('/me/reservations/:id/cancel', requireReader, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing || existing.readerId !== c.get('reader')!.id) {
    throw new HttpError(404, 'Reserva não encontrada');
  }
  if (existing.status === 'FULFILLED') throw new HttpError(400, 'Reserva já atendida não pode ser cancelada');
  if (existing.status !== 'PENDING' && existing.status !== 'AVAILABLE') {
    throw new HttpError(400, 'Reserva não pode ser cancelada');
  }
  const reservation = await prisma.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
  await writeAudit(null, 'RESERVATION_CANCELLED', 'Reservation', id, { self: true }, clientIp(c), prisma);
  return c.json(reservation);
});

const GENERIC_READER_FORGOT_MESSAGE = 'Se o e-mail estiver cadastrado, enviamos as instruções de recuperação.';

readerAuthApp.post('/forgot-password', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(forgotPasswordSchema, await reqJson(c));
  const reader = await prisma.reader.findFirst({ where: { email: data.email, deletedAt: null } });
  if (reader && reader.email && reader.status === 'ACTIVE' && reader.passwordHash) {
    const raw = await createResetToken(reader.email, 'READER', prisma);
    const link = `${frontendUrl(c.env)}/redefinir-senha?token=${raw}&tipo=leitor`;
    const content = passwordResetEmail(reader.name, link);
    await sendEmail(c.env, { to: reader.email, ...content });
    await writeAudit(null, 'READER_PASSWORD_RESET_REQUESTED', 'Reader', reader.id, undefined, clientIp(c), prisma);
  }
  return c.json({ ok: true, message: GENERIC_READER_FORGOT_MESSAGE });
});

readerAuthApp.post('/reset-password', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(resetPasswordWithTokenSchema, await reqJson(c));
  const record = await consumeResetToken(data.token, 'READER', prisma);
  if (!record) throw new HttpError(400, 'Link inválido ou expirado');
  const reader = await prisma.reader.findFirst({ where: { email: record.email, deletedAt: null } });
  if (!reader || reader.status !== 'ACTIVE') throw new HttpError(400, 'Link inválido ou expirado');
  await prisma.reader.update({
    where: { id: reader.id },
    data: { passwordHash: await hashPassword(data.password, passwordPepper(c.env)) },
  });
  await writeAudit(null, 'READER_PASSWORD_RESET_DONE', 'Reader', reader.id, undefined, clientIp(c), prisma);
  return c.json({ ok: true });
});
