import { Hono } from 'hono';
import { HttpError } from '../../lib/http-error';
import { hashPassword } from '../../lib/password-hash';
import { writeAudit } from '../../lib/audit';
import { refreshOverdue } from '../../lib/overdue';
import { stripReaderBlobs } from '../../lib/strip-signature-blobs';
import { prismaOf } from '../db';
import { requireAuth, requireRoles } from '../auth';
import { passwordPepper } from '../env';
import { clientIp, reqJson } from '../http';
import {
  cleanNull,
  dateOrNull,
  parse,
  paginationSchema,
  readerDeleteSchema,
  readerPasswordSchema,
  readerQuerySchema,
  readerSchema,
  readerSignatureSchema,
  readerStatusSchema,
  readerUpdateSchema,
} from '../../validation';
import type { AppEnv } from '../context';

export const readerApp = new Hono<AppEnv>();

readerApp.use(requireAuth);

// Listagem: sem `signature`/`rubricImage` (PNG em base64, ~85 KB por leitor).
// A tela de detalhe (`/admin/leitores/:id`) continua recebendo tudo.
function mapReader(r: unknown, activeLoans = 0) {
  return { ...stripReaderBlobs(r as Record<string, unknown>), activeLoans };
}

readerApp.get('/', async (c) => {
  const prisma = prismaOf(c);
  const q = parse(readerQuerySchema, c.req.query());
  const where = {
    deletedAt: null,
    ...(q.search
      ? { OR: [{ name: { contains: q.search } }, { cpf: { contains: q.search } }, { email: { contains: q.search } }] }
      : {}),
    ...(q.status !== 'ALL' ? { status: q.status } : {}),
  };
  const total = await prisma.reader.count({ where });
  const items = await prisma.reader.findMany({
    where,
    orderBy: { name: 'asc' },
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  const ids = items.map((i) => i.id);
  const activeByReader: Record<number, number> = {};
  if (ids.length > 0) {
    const rows = await prisma.loan.groupBy({
      by: ['readerId'],
      where: { readerId: { in: ids }, status: { in: ['ACTIVE', 'OVERDUE'] } },
      _count: { _all: true },
    });
    for (const row of rows) activeByReader[row.readerId] = row._count._all;
  }
  return c.json({
    items: items.map((i) => mapReader(i, activeByReader[i.id] ?? 0)),
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.ceil(total / q.pageSize),
  });
});

readerApp.post('/', async (c) => {
  const prisma = prismaOf(c);
  const data = parse(readerSchema, await reqJson(c));
  const clash = await prisma.reader.findUnique({ where: { cpf: data.cpf } });
  if (clash) throw new HttpError(409, 'CPF já cadastrado');
  if (data.email) {
    const emailClash = await prisma.reader.findFirst({ where: { email: data.email } });
    if (emailClash) throw new HttpError(409, 'E-mail já cadastrado');
  }
  const reader = await prisma.reader.create({
    data: {
      name: data.name,
      cpf: data.cpf,
      birthDate: dateOrNull(data.birthDate) ?? null,
      phone: cleanNull(data.phone),
      email: cleanNull(data.email),
      cep: cleanNull(data.cep),
      address: cleanNull(data.address),
      number: cleanNull(data.number),
      neighborhood: cleanNull(data.neighborhood),
      city: cleanNull(data.city),
      state: cleanNull(data.state),
    },
  });
  await writeAudit(c.get('user')?.id, 'READER_CREATED', 'Reader', reader.id, { name: reader.name }, clientIp(c), prisma);
  return c.json(reader, 201);
});

readerApp.get('/blocked', async (c) => {
  const prisma = prismaOf(c);
  const q = parse(paginationSchema, c.req.query());
  const search = c.req.query('search')?.trim() ?? '';
  const where = {
    status: 'BLOCKED' as const,
    deletedAt: null,
    ...(search
      ? { OR: [{ name: { contains: search } }, { cpf: { contains: search } }] }
      : {}),
  };
  const total = await prisma.reader.count({ where });
  const items = await prisma.reader.findMany({
    where,
    orderBy: { blockedAt: 'desc' },
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  const ids = items.map((i) => i.id);
  const activeByReader: Record<number, number> = {};
  if (ids.length > 0) {
    const rows = await prisma.loan.groupBy({
      by: ['readerId'],
      where: { readerId: { in: ids }, status: { in: ['ACTIVE', 'OVERDUE'] } },
      _count: { _all: true },
    });
    for (const row of rows) activeByReader[row.readerId] = row._count._all;
  }
  const blockedByNameMap: Record<number, string> = {};
  const userIds = items.filter((i) => i.blockedBy).map((i) => i.blockedBy!);
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, name: true },
    });
    for (const u of users) blockedByNameMap[u.id] = u.name;
  }
  return c.json({
    items: items.map((r) => ({
      ...r,
      activeLoans: activeByReader[r.id] ?? 0,
      blockedByName: r.blockedBy ? blockedByNameMap[r.blockedBy] ?? null : null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.ceil(total / q.pageSize),
  });
});

readerApp.get('/:id', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const reader = await prisma.reader.findUnique({ where: { id } });
  if (!reader) throw new HttpError(404, 'Leitor não encontrado');
  await refreshOverdue(id, prisma);
  const [loans, reservations] = await Promise.all([
    prisma.loan.findMany({
      where: { readerId: id },
      include: { book: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.reservation.findMany({
      where: { readerId: id },
      include: { book: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  const activeLoans = loans.filter((l) => l.status !== 'RETURNED');
  const overdueCount = loans.filter((l) => l.status === 'OVERDUE').length;
  return c.json({ reader, loans, activeLoans, overdueCount, reservations });
});

readerApp.put('/:id', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const data = parse(readerUpdateSchema, await reqJson(c));
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Leitor não encontrado');
  if (existing.deletedAt) throw new HttpError(409, 'Leitor excluído não pode ser editado');
  if (data.cpf && data.cpf !== existing.cpf) {
    const clash = await prisma.reader.findUnique({ where: { cpf: data.cpf } });
    if (clash) throw new HttpError(409, 'CPF já cadastrado');
  }
  if (data.email && data.email !== existing.email) {
    const emailClash = await prisma.reader.findFirst({ where: { email: data.email, NOT: { id } } });
    if (emailClash) throw new HttpError(409, 'E-mail já cadastrado');
  }
  const reader = await prisma.reader.update({
    where: { id },
    data: {
      name: data.name ?? existing.name,
      cpf: data.cpf ?? existing.cpf,
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
  await writeAudit(c.get('user')?.id, 'READER_UPDATED', 'Reader', id, { name: reader.name }, clientIp(c), prisma);
  return c.json(reader);
});

readerApp.patch('/:id/status', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const { status, reason, category } = parse(readerStatusSchema, await reqJson(c));
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Leitor não encontrado');
  if (existing.deletedAt) throw new HttpError(409, 'Leitor excluído não pode ter status alterado');
  const data: Record<string, unknown> = { status };
  if (status === 'BLOCKED') {
    data.blockReason = reason ?? null;
    data.blockCategory = category ?? null;
    data.blockedAt = new Date();
    data.blockedBy = c.get('user')!.id;
  } else if (status === 'ACTIVE') {
    data.blockReason = null;
    data.blockCategory = null;
    data.blockedAt = null;
    data.blockedBy = null;
  }
  const reader = await prisma.reader.update({ where: { id }, data });
  await writeAudit(c.get('user')?.id, 'READER_STATUS_CHANGED', 'Reader', id, {
    status,
    reason: reason ?? null,
    category: category ?? null,
  }, clientIp(c), prisma);
  return c.json(reader);
});

// Balcão gerencia a assinatura do leitor (aba assinatura de /admin/leitores/:id) —
// mesmo modelo de aparência do perfil da equipe; `signature: null` remove e limpa metadados.
readerApp.patch('/:id/signature', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const data = parse(readerSignatureSchema, await reqJson(c));
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Leitor não encontrado');
  if (existing.deletedAt) throw new HttpError(409, 'Leitor excluído não pode ter assinatura alterada');
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
  await writeAudit(c.get('user')?.id, 'READER_UPDATED', 'Reader', id, { signature: hasSig }, clientIp(c), prisma);
  return c.json(reader);
});

// Balcão define/redefine a senha de acesso ao portal do leitor.
readerApp.post('/:id/password', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const data = parse(readerPasswordSchema, await reqJson(c));
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Leitor não encontrado');
  if (existing.deletedAt) throw new HttpError(409, 'Leitor excluído não pode ter senha alterada');
  await prisma.reader.update({
    where: { id },
    data: { passwordHash: await hashPassword(data.password, passwordPepper(c.env)) },
  });
  await writeAudit(c.get('user')?.id, 'READER_UPDATED', 'Reader', id, { password: true, byStaff: true }, clientIp(c), prisma);
  return c.json({ ok: true });
});

readerApp.delete('/:id', requireRoles('ADMIN'), async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(404, 'Leitor não encontrado');
  const raw = await c.req.text();
  const { reason } = parse(readerDeleteSchema, raw ? JSON.parse(raw) : {});
  const existing = await prisma.reader.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Leitor não encontrado');
  if (existing.deletedAt) throw new HttpError(409, 'Leitor já foi excluído');

  const activeLoans = await prisma.loan.count({
    where: { readerId: id, status: { in: ['ACTIVE', 'OVERDUE'] } },
  });
  if (activeLoans > 0) {
    throw new HttpError(409, 'Leitor possui empréstimos ativos ou em atraso e não pode ser excluído');
  }

  // D1 não suporta transações interativas (callback); operações independentes em batch.
  await prisma.$transaction([
    prisma.reservation.updateMany({
      where: { readerId: id, status: { in: ['PENDING', 'AVAILABLE'] } },
      data: { status: 'CANCELLED' },
    }),
    prisma.reader.update({
      where: { id },
      data: {
        name: 'Leitor excluído',
        cpf: `EXCLUIDO-${String(id).padStart(6, '0')}`,
        birthDate: null,
        phone: null,
        email: null,
        cep: null,
        address: null,
        number: null,
        neighborhood: null,
        city: null,
        state: null,
        status: 'INACTIVE',
        blockReason: null,
        blockCategory: null,
        blockedAt: null,
        blockedBy: null,
        signature: null,
        signatureUpdatedAt: null,
        signatureType: null,
        signatureText: null,
        rubricText: null,
        rubricImage: null,
        fontFamily: null,
        passwordHash: null,
        deletedAt: new Date(),
        anonymizedAt: new Date(),
      },
    }),
  ]);

  await writeAudit(c.get('user')?.id, 'READER_DELETED', 'Reader', id, {
    reference: `LTR-${String(id).padStart(6, '0')}`,
    previousName: existing.name,
    cancelledReservations: true,
    reason: reason ?? null,
  }, clientIp(c), prisma);
  return c.json({ ok: true, deleted: true });
});
