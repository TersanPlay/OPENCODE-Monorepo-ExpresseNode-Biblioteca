import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { HttpError } from '../../lib/http-error';
import { asyncHandler } from '../../middleware/async-handler';
import { loginLimiter } from '../../middleware/login-rate-limit';
import { publicReader, requireReader, signReaderToken } from '../../lib/reader-auth';
import { writeAudit } from '../../lib/audit';
import { expireReservations, MS_PER_DAY } from '../../lib/overdue';
import { refreshOverdue } from '../../lib/overdue';
import { env } from '../../config/env';
import { passwordResetEmail, sendEmail } from '../../lib/mail';
import { consumeResetToken, createResetToken } from '../../lib/password-reset';
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

export const readerAuthRouter = Router();

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
const RESERVATION_DAYS = 3;

// --- Autocadastro público: cria leitor ACTIVE + senha e já autentica ---
readerAuthRouter.post(
  '/register',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(readerRegisterSchema, req.body);
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
        passwordHash: bcrypt.hashSync(data.password, 10),
      },
    });
    const token = signReaderToken(reader);
    await writeAudit(null, 'READER_CREATED', 'Reader', reader.id, { self: true }, req.ip);
    res.status(201).json({ token, reader: publicReader(reader) });
  }),
);

// --- Login do portal do leitor ---
readerAuthRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(readerLoginSchema, req.body);
    const reader = await prisma.reader.findFirst({ where: { email: data.email, deletedAt: null } });
    const valid = await bcrypt.compare(
      data.password,
      reader?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!reader || !reader.passwordHash || !valid || reader.status !== 'ACTIVE') {
      await writeAudit(null, 'LOGIN_FAILED', 'Reader', reader?.id, { email: data.email }, req.ip);
      throw new HttpError(401, 'E-mail ou senha inválidos');
    }
    const token = signReaderToken(reader);
    await writeAudit(null, 'LOGIN', 'Reader', reader.id, undefined, req.ip);
    res.json({ token, reader: publicReader(reader) });
  }),
);

// --- Primeiro acesso: leitor já cadastrado confere CPF + e-mail e define a senha ---
readerAuthRouter.post(
  '/claim',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(readerClaimSchema, req.body);
    const cpfDigits = data.cpf.replace(/\D/g, '');
    const reader =
      (await prisma.reader.findUnique({ where: { cpf: data.cpf } })) ??
      (cpfDigits !== data.cpf
        ? await prisma.reader.findUnique({ where: { cpf: cpfDigits } })
        : null);
    const emailOk =
      !!reader?.email && reader.email.trim().toLowerCase() === data.email;
    if (!reader || reader.deletedAt || reader.status !== 'ACTIVE' || !emailOk || reader.passwordHash) {
      await writeAudit(null, 'LOGIN_FAILED', 'Reader', reader?.id, { claim: true }, req.ip);
      throw new HttpError(401, 'Dados não conferem ou conta já possui senha de acesso');
    }
    const updated = await prisma.reader.update({
      where: { id: reader.id },
      data: { passwordHash: bcrypt.hashSync(data.password, 10) },
    });
    const token = signReaderToken(updated);
    await writeAudit(null, 'READER_UPDATED', 'Reader', reader.id, { self: true, claimed: true }, req.ip);
    res.json({ token, reader: publicReader(updated) });
  }),
);

// --- Perfil próprio ---
readerAuthRouter.get(
  '/me',
  requireReader,
  asyncHandler(async (req, res) => {
    const reader = await prisma.reader.findUnique({ where: { id: req.reader!.id } });
    if (!reader) throw new HttpError(404, 'Leitor não encontrado');
    res.json({ reader: publicReader(reader) });
  }),
);

readerAuthRouter.put(
  '/me',
  requireReader,
  asyncHandler(async (req, res) => {
    const id = req.reader!.id;
    const data = parse(readerSelfUpdateSchema, req.body);
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
    await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true }, req.ip);
    res.json({ reader: publicReader(reader) });
  }),
);

// --- Assinatura do próprio leitor: salva/substitui (somente a atual do perfil) ---
readerAuthRouter.patch(
  '/me/signature',
  requireReader,
  asyncHandler(async (req, res) => {
    const id = req.reader!.id;
    const data = parse(readerSignatureSchema, req.body);
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
    await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true, signature: hasSig }, req.ip);
    res.json({ reader: publicReader(reader) });
  }),
);

// --- Exclui a assinatura atual do perfil (n£o toca nas congeladas de empréstimos/devoluções) ---
readerAuthRouter.delete(
  '/me/signature',
  requireReader,
  asyncHandler(async (req, res) => {
    const id = req.reader!.id;
    const existing = await prisma.reader.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new HttpError(404, 'Leitor nǜo encontrado');
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
    await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true, signature: false }, req.ip);
    res.json({ reader: publicReader(reader) });
  }),
);

readerAuthRouter.post(
  '/me/password',
  requireReader,
  asyncHandler(async (req, res) => {
    const id = req.reader!.id;
    const data = parse(readerSelfPasswordSchema, req.body);
    const existing = await prisma.reader.findUnique({ where: { id } });
    if (!existing || !existing.passwordHash) throw new HttpError(404, 'Leitor não encontrado');
    const valid = await bcrypt.compare(data.currentPassword, existing.passwordHash);
    if (!valid) throw new HttpError(401, 'Senha atual incorreta');
    await prisma.reader.update({
      where: { id },
      data: { passwordHash: bcrypt.hashSync(data.password, 10) },
    });
    await writeAudit(null, 'READER_UPDATED', 'Reader', id, { self: true, password: true }, req.ip);
    res.json({ ok: true });
  }),
);

// --- Empréstimos próprios (leitura) ---
readerAuthRouter.get(
  '/me/loans',
  requireReader,
  asyncHandler(async (req, res) => {
    const id = req.reader!.id;
    await refreshOverdue(id);
    const loans = await prisma.loan.findMany({
      where: { readerId: id },
      include: { book: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const activeLoans = loans.filter((l) => l.status !== 'RETURNED');
    const overdueCount = loans.filter((l) => l.status === 'OVERDUE').length;
    res.json({ loans, activeLoans, overdueCount });
  }),
);

// --- Reservas próprias ---
readerAuthRouter.get(
  '/me/reservations',
  requireReader,
  asyncHandler(async (req, res) => {
    await expireReservations();
    const reservations = await prisma.reservation.findMany({
      where: { readerId: req.reader!.id },
      include: { book: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ reservations });
  }),
);

readerAuthRouter.post(
  '/me/reservations',
  requireReader,
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ bookId: z.number().int() }), req.body);
    const readerId = req.reader!.id;
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
    await writeAudit(null, 'RESERVATION_CREATED', 'Reservation', reservation.id, { readerId, bookId: data.bookId, self: true }, req.ip);
    res.status(201).json(reservation);
  }),
);

readerAuthRouter.post(
  '/me/reservations/:id/cancel',
  requireReader,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing || existing.readerId !== req.reader!.id) {
      throw new HttpError(404, 'Reserva não encontrada');
    }
    if (existing.status === 'FULFILLED') throw new HttpError(400, 'Reserva já atendida não pode ser cancelada');
    if (existing.status !== 'PENDING' && existing.status !== 'AVAILABLE') {
      throw new HttpError(400, 'Reserva não pode ser cancelada');
    }
    const reservation = await prisma.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit(null, 'RESERVATION_CANCELLED', 'Reservation', id, { self: true }, req.ip);
    res.json(reservation);
  }),
);

const GENERIC_READER_FORGOT_MESSAGE = 'Se o e-mail estiver cadastrado, enviamos as instruções de recuperação.';

readerAuthRouter.post(
  '/forgot-password',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(forgotPasswordSchema, req.body);
    const reader = await prisma.reader.findFirst({ where: { email: data.email, deletedAt: null } });
    if (reader && reader.email && reader.status === 'ACTIVE' && reader.passwordHash) {
      const raw = await createResetToken(reader.email, 'READER');
      const link = `${env.FRONTEND_URL}/redefinir-senha?token=${raw}&tipo=leitor`;
      const content = passwordResetEmail(reader.name, link);
      await sendEmail({ to: reader.email, ...content });
      await writeAudit(null, 'READER_PASSWORD_RESET_REQUESTED', 'Reader', reader.id, undefined, req.ip);
    }
    res.json({ ok: true, message: GENERIC_READER_FORGOT_MESSAGE });
  }),
);

readerAuthRouter.post(
  '/reset-password',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(resetPasswordWithTokenSchema, req.body);
    const record = await consumeResetToken(data.token, 'READER');
    if (!record) throw new HttpError(400, 'Link inválido ou expirado');
    const reader = await prisma.reader.findFirst({ where: { email: record.email, deletedAt: null } });
    if (!reader || reader.status !== 'ACTIVE') throw new HttpError(400, 'Link inválido ou expirado');
    await prisma.reader.update({
      where: { id: reader.id },
      data: { passwordHash: bcrypt.hashSync(data.password, 10) },
    });
    await writeAudit(null, 'READER_PASSWORD_RESET_DONE', 'Reader', reader.id, undefined, req.ip);
    res.json({ ok: true });
  }),
);
