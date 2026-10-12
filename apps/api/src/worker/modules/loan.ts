import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { PrismaClient } from '../../generated/prisma';
import { HttpError } from '../../lib/http-error';
import { writeAudit } from '../../lib/audit';
import { computeDueDate, expireReservations, refreshOverdue } from '../../lib/overdue';
import { getSettings } from '../../lib/settings';
import { stripLoanBlobsMany, stripReaderBlobs } from '../../lib/strip-signature-blobs';
import {
  generateBatchReturnTermPDF,
  generateLoanTermPDF,
  generateReturnTermPDF,
} from '../../lib/terms';
import { prismaOf } from '../db';
import { requireAuth, requireReader } from '../auth';
import { clientIp, reqJson } from '../http';
import { loanInclude } from '../loan-include';
import {
  dateOrNull,
  listQuerySchema,
  loanBatchCreateSchema,
  loanCreateSchema,
  loanQuerySchema,
  loanReturnBatchSchema,
  loanReturnSchema,
  parse,
} from '../../validation';
import type { AppEnv } from '../context';

export const loanApp = new Hono<AppEnv>();

interface ReturnInput {
  condition?: string | null;
  observations?: string | null;
  signature?: string | null;
  useSavedSignature?: boolean;
  returnGroup?: string | null;
}

// Núcleo da devolução, reutilizado no unitário e no lote: valida, resolve
// assinatura, grava retorno e ativa reserva. Auditoria e auto-block ficam no chamador.
async function performReturn(
  db: PrismaClient,
  loan: { id: number; readerId: number; bookId: number; returnedAt: Date | null },
  input: ReturnInput,
  operator: { id: number; name: string },
) {
  if (loan.returnedAt) throw new HttpError(400, 'Empréstimo já devolvido');
  const now = new Date();
  let sig: string | null = input.signature ? input.signature : null;
  if (sig) {
    await db.reader.update({
      where: { id: loan.readerId },
      data: { signature: sig, signatureUpdatedAt: now, signatureType: null, signatureText: null, rubricText: null, rubricImage: null, fontFamily: null },
    });
  } else if (input.useSavedSignature) {
    const r = await db.reader.findUnique({ where: { id: loan.readerId } });
    if (!r?.signature) throw new HttpError(400, 'Leitor não possui assinatura salva; assine no pad');
    sig = r.signature;
  }
  const opSig = (await db.user.findUnique({ where: { id: operator.id }, select: { signature: true } }))?.signature ?? null;

  const returned = await db.loan.update({
    where: { id: loan.id },
    data: {
      returnedAt: now,
      status: 'RETURNED',
      returnCondition: input.condition ?? null,
      returnObservations: input.observations ?? null,
      receivedByNameSnapshot: operator.name,
      returnSignature: sig,
      returnSignedAt: sig ? now : null,
      receivedBySignatureSnapshot: opSig,
      returnGroup: input.returnGroup ?? null,
    },
  });

  const pending = await db.reservation.findFirst({
    where: { bookId: loan.bookId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  if (pending) {
    const expired = pending.expiresAt && pending.expiresAt.getTime() < Date.now();
    await db.reservation.update({
      where: { id: pending.id },
      data: { status: expired ? 'EXPIRED' : 'AVAILABLE' },
    });
  }
  return returned;
}

async function applyAutoBlock(db: PrismaClient, readerId: number, ip: string | undefined) {
  const overdueCount = await db.loan.count({
    where: { readerId, status: 'OVERDUE' },
  });
  if (overdueCount >= 2) {
    const reader = await db.reader.findUnique({ where: { id: readerId } });
    if (reader && reader.status === 'ACTIVE') {
      await db.reader.update({
        where: { id: readerId },
        data: {
          status: 'BLOCKED',
          blockCategory: 'ATRASO_REPETIDO',
          blockReason: 'Bloqueado automaticamente por atrasos repetidos',
          blockedAt: new Date(),
          blockedBy: null,
        },
      });
      await db.reservation.updateMany({
        where: { readerId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await writeAudit(null, 'READER_STATUS_CHANGED', 'Reader', readerId, {
        status: 'BLOCKED',
        reason: 'Bloqueado automaticamente por atrasos repetidos',
        category: 'ATRASO_REPETIDO',
        auto: true,
      }, ip, db);
    }
  }
}

// Termos: equipe (qualquer empréstimo) ou o próprio leitor dono do empréstimo.
const requireStaffOrLoanOwner = createMiddleware<AppEnv>(async (c, next) => {
  try {
    let called = false;
    await requireAuth(c, async () => {
      called = true;
    });
    if (called && c.get('user')) {
      await next();
      return;
    }
  } catch {
    // cai para leitor
  }
  try {
    let called = false;
    await requireReader(c, async () => {
      called = true;
    });
    if (!called || !c.get('reader')) throw new HttpError(401, 'Não autenticado');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'Não autenticado');
  }
  const loan = await prismaOf(c).loan.findUnique({
    where: { id: Number(c.req.param('id')) },
    select: { readerId: true },
  });
  if (!loan || loan.readerId !== c.get('reader')!.id) {
    throw new HttpError(403, 'Sem permissão para este documento');
  }
  await next();
});

// Assinatura da operação: nova desenho atualiza a salva do leitor;
// useSavedSignature reaproveita a salva (erro se não houver).
async function resolveLoanSignature(
  db: PrismaClient,
  readerId: number,
  data: { signature?: string | null; useSavedSignature?: boolean },
): Promise<string | null> {
  const drawn = data.signature ? data.signature : null;
  if (drawn) {
    await db.reader.update({
      where: { id: readerId },
      data: { signature: drawn, signatureUpdatedAt: new Date(), signatureType: null, signatureText: null, rubricText: null, rubricImage: null, fontFamily: null },
    });
    return drawn;
  }
  if (data.useSavedSignature) {
    const r = await db.reader.findUnique({ where: { id: readerId } });
    if (!r?.signature) throw new HttpError(400, 'Leitor não possui assinatura salva; assine no pad');
    return r.signature;
  }
  return null;
}

async function buildLoanSnapshots(
  db: PrismaClient,
  readerId: number,
  bookId: number,
  userId: number,
) {
  const [reader, book, user] = await Promise.all([
    db.reader.findUnique({ where: { id: readerId }, select: { name: true } }),
    db.book.findUnique({ where: { id: bookId }, select: { id: true, title: true, isbn10: true, isbn13: true } }),
    db.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  let authorSnapshot: string | null = null;
  const bookAuthors = await db.bookAuthor.findMany({ where: { bookId }, include: { author: { select: { name: true } } } });
  if (bookAuthors.length > 0) {
    authorSnapshot = bookAuthors.map((ba) => ba.author.name).join(', ');
  }

  return {
    readerNameSnapshot: reader?.name ?? null,
    bookTitleSnapshot: book?.title ?? null,
    bookAuthorSnapshot: authorSnapshot,
    bookIsbnSnapshot: book?.isbn13 ?? book?.isbn10 ?? null,
    bookNumberSnapshot: String(book?.id ?? bookId),
    createdByNameSnapshot: user?.name ?? null,
  };
}

async function assertBookEligible(db: PrismaClient, bookId: number, readerId: number) {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) throw new HttpError(404, 'Livro não encontrado');
  if (book.isArchived) throw new HttpError(400, 'Livro arquivado não pode ser emprestado');
  const activeBookLoan = await db.loan.findFirst({
    where: { bookId: book.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
  });
  if (activeBookLoan) throw new HttpError(400, `"${book.title}" já está emprestado`);
  const reservation = await db.reservation.findFirst({
    where: { bookId: book.id, status: { in: ['PENDING', 'AVAILABLE'] }, readerId: { not: readerId } },
  });
  if (reservation) throw new HttpError(400, `"${book.title}" possui reserva aguardando por outro leitor`);
  return { id: book.id, title: book.title };
}

async function ensureNumber(db: PrismaClient, loanId: number): Promise<string> {
  const number = `EMP-${String(loanId).padStart(6, '0')}`;
  await db.loan.update({ where: { id: loanId }, data: { number } });
  return number;
}

loanApp.get('/', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  await refreshOverdue(undefined, prisma);
  await expireReservations(prisma);
  const q = parse(loanQuerySchema, c.req.query());
  const where: Record<string, unknown> = {
    ...(q.status === 'ACTIVE' ? { status: { in: ['ACTIVE', 'OVERDUE'] } } : {}),
    ...(q.status === 'OVERDUE' ? { status: 'OVERDUE' } : {}),
    ...(q.status === 'RETURNED' ? { status: 'RETURNED' } : {}),
    ...(q.readerId ? { readerId: q.readerId } : {}),
    ...(q.start || q.end
      ? { loanDate: { gte: dateOrNull(q.start) ?? undefined, lte: dateOrNull(q.end) ?? undefined } }
      : {}),
    ...(q.search
      ? {
          OR: [
            { number: { contains: q.search } },
            { reader: { name: { contains: q.search } } },
            { reader: { cpf: { contains: q.search } } },
            { book: { title: { contains: q.search } } },
            { book: { isbn10: { contains: q.search } } },
            { book: { isbn13: { contains: q.search } } },
          ],
        }
      : {}),
  };
  const total = await prisma.loan.count({ where });
  const items = await prisma.loan.findMany({
    where,
    include: loanInclude,
    orderBy: { createdAt: 'desc' },
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  return c.json({ items: stripLoanBlobsMany(items), total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
});

loanApp.get('/search', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const qText = (c.req.query('q') || '').trim();
  if (!qText) {
    return c.json({ items: [] });
  }
  await refreshOverdue(undefined, prisma);
  const items = await prisma.loan.findMany({
    where: {
      status: { in: ['ACTIVE', 'OVERDUE'] },
      OR: [
        { number: { contains: qText } },
        { reader: { name: { contains: qText } } },
        { reader: { cpf: { contains: qText } } },
        { book: { title: { contains: qText } } },
        { book: { isbn10: { contains: qText } } },
        { book: { isbn13: { contains: qText } } },
      ],
    },
    include: loanInclude,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return c.json({ items: stripLoanBlobsMany(items) });
});

loanApp.post('/', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(loanCreateSchema, await reqJson(c));
  const userId = c.get('user')!.id;
  const settings = await getSettings(prisma);

  await refreshOverdue(data.readerId, prisma);

  // D1 não suporta transações interativas (callback): sequência de operações.
  const reader = await prisma.reader.findUnique({ where: { id: data.readerId } });
  if (!reader) throw new HttpError(404, 'Leitor não encontrado');
  if (reader.deletedAt) throw new HttpError(400, 'Leitor excluido nao pode emprestar');
  if (reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado ou inativo não pode emprestar');

  await assertBookEligible(prisma, data.bookId, reader.id);

  const overdue = await prisma.loan.findFirst({
    where: { readerId: reader.id, status: 'OVERDUE' },
  });
  if (overdue) throw new HttpError(400, 'Leitor possui empréstimo atrasado; regularize antes de emprestar');

  const activeCount = await prisma.loan.count({
    where: { readerId: reader.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
  });
  if (activeCount >= settings.loanLimit) {
    throw new HttpError(400, `Limite de ${settings.loanLimit} empréstimos ativos atingido`);
  }

  const loanDate = new Date();
  const dueDate = data.dueDate
    ? (dateOrNull(data.dueDate) ?? computeDueDate(loanDate, settings.defaultLoanDays))
    : computeDueDate(loanDate, settings.defaultLoanDays);
  if (dueDate.getTime() <= loanDate.getTime()) throw new HttpError(400, 'Prazo de devolução deve ser futuro');

  const snapshots = await buildLoanSnapshots(prisma, reader.id, data.bookId, userId);
  const sig = await resolveLoanSignature(prisma, reader.id, data);
  const opSig = (await prisma.user.findUnique({ where: { id: userId }, select: { signature: true } }))?.signature ?? null;

  const created = await prisma.loan.create({
    data: {
      readerId: reader.id,
      bookId: data.bookId,
      userId,
      dueDate,
      status: 'ACTIVE',
      ...snapshots,
      loanSignature: sig,
      loanSignedAt: sig ? loanDate : null,
      createdBySignatureSnapshot: opSig,
    },
  });
  const number = await ensureNumber(prisma, created.id);
  await writeAudit(userId, 'LOAN_CREATED', 'Loan', created.id, { number, readerId: created.readerId, bookId: created.bookId }, clientIp(c), prisma);

  const full = await prisma.loan.findUnique({ where: { id: created.id }, include: loanInclude });
  return c.json({ ...full, number }, 201);
});

loanApp.post('/batch', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(loanBatchCreateSchema, await reqJson(c));
  const userId = c.get('user')!.id;
  const settings = await getSettings(prisma);

  await refreshOverdue(data.readerId, prisma);

  const loanDate = new Date();
  const dueDate = data.dueDate
    ? (dateOrNull(data.dueDate) ?? computeDueDate(loanDate, settings.defaultLoanDays))
    : computeDueDate(loanDate, settings.defaultLoanDays);
  if (dueDate.getTime() <= loanDate.getTime()) throw new HttpError(400, 'Prazo de devolução deve ser futuro');

  const bookIds = [...new Set(data.bookIds)];
  if (bookIds.length !== data.bookIds.length) throw new HttpError(400, 'Livro duplicado na seleção');

  const reader = await prisma.reader.findUnique({ where: { id: data.readerId } });
  if (!reader) throw new HttpError(404, 'Leitor não encontrado');
  if (reader.deletedAt) throw new HttpError(400, 'Leitor excluido nao pode emprestar');
  if (reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado ou inativo não pode emprestar');

  const overdue = await prisma.loan.findFirst({
    where: { readerId: reader.id, status: 'OVERDUE' },
  });
  if (overdue) throw new HttpError(400, 'Leitor possui empréstimo atrasado; regularize antes de emprestar');

  const activeCount = await prisma.loan.count({
    where: { readerId: reader.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
  });
  if (activeCount + bookIds.length > settings.loanLimit) {
    throw new HttpError(
      400,
      `Limite de ${settings.loanLimit} empréstimos ativos atingido (${activeCount} ativos + ${bookIds.length} selecionados)`,
    );
  }

  const loans: { id: number; number: string; bookId: number }[] = [];
  const batchSig = await resolveLoanSignature(prisma, reader.id, data);
  const batchOpSig = (await prisma.user.findUnique({ where: { id: userId }, select: { signature: true } }))?.signature ?? null;
  for (const bookId of bookIds) {
    await assertBookEligible(prisma, bookId, reader.id);
    const snapshots = await buildLoanSnapshots(prisma, reader.id, bookId, userId);
    const createdLoan = await prisma.loan.create({
      data: {
        readerId: reader.id,
        bookId,
        userId,
        dueDate,
        status: 'ACTIVE',
        ...snapshots,
        loanSignature: batchSig,
        loanSignedAt: batchSig ? loanDate : null,
        createdBySignatureSnapshot: batchOpSig,
      },
    });
    const number = await ensureNumber(prisma, createdLoan.id);
    loans.push({ id: createdLoan.id, number, bookId });
  }

  for (const l of loans) {
    await writeAudit(userId, 'LOAN_CREATED', 'Loan', l.id, { number: l.number, readerId: data.readerId, bookId: l.bookId }, clientIp(c), prisma);
  }

  const full = await prisma.loan.findMany({
    where: { id: { in: loans.map((l) => l.id) } },
    include: loanInclude,
    orderBy: { createdAt: 'asc' },
  });
  return c.json({ items: full, count: full.length }, 201);
});

loanApp.get('/:id', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const loan = await prisma.loan.findUnique({ where: { id }, include: loanInclude });
  if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
  return c.json(loan);
});

loanApp.post('/:id/return', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const raw = await c.req.text();
  const data = raw && Object.keys(JSON.parse(raw)).length > 0 ? parse(loanReturnSchema, JSON.parse(raw)) : {};
  const loan = await prisma.loan.findUnique({ where: { id } });
  if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');

  const user = c.get('user')!;
  const returned = await performReturn(prisma, loan, data, { id: user.id, name: user.name });
  await applyAutoBlock(prisma, loan.readerId, clientIp(c));

  await writeAudit(user.id, 'LOAN_RETURNED', 'Loan', id, { number: loan.number }, clientIp(c), prisma);
  return c.json({ ...returned, number: loan.number });
});

loanApp.post('/returns/batch', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(loanReturnBatchSchema, await reqJson(c));
  const userId = c.get('user')!.id;
  const opName = c.get('user')!.name;

  const ids = [...new Set(data.loanIds)];
  if (ids.length !== data.loanIds.length) throw new HttpError(400, 'Empréstimo duplicado na seleção');
  const found = await prisma.loan.findMany({ where: { id: { in: ids } } });
  if (found.length !== ids.length) throw new HttpError(404, 'Empréstimo não encontrado');
  const readerIds = new Set(found.map((l) => l.readerId));
  if (readerIds.size !== 1) throw new HttpError(400, 'O lote deve conter empréstimos de um único leitor');

  const group = `DEV-${String(Math.min(...ids)).padStart(6, '0')}`;
  const ordered = [...found].sort((a, b) => a.id - b.id);
  const returned = [];
  for (const loan of ordered) {
    returned.push(await performReturn(prisma, loan, { ...data, returnGroup: group }, { id: userId, name: opName }));
  }
  await applyAutoBlock(prisma, found[0].readerId, clientIp(c));

  for (const l of returned) {
    await writeAudit(userId, 'LOAN_RETURNED', 'Loan', l.id, { number: l.number, group }, clientIp(c), prisma);
  }

  const full = await prisma.loan.findMany({
    where: { id: { in: ids } },
    include: loanInclude,
    orderBy: { createdAt: 'asc' },
  });
  return c.json({ items: full, count: full.length, group });
});

loanApp.get('/returns/pending', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const q = parse(listQuerySchema, c.req.query());
  const search = (q.search ?? '').trim();
  const loanWhere: Record<string, unknown> = {
    status: { in: ['ACTIVE', 'OVERDUE'] },
    ...(search
      ? {
          OR: [
            { reader: { name: { contains: search } } },
            { reader: { cpf: { contains: search } } },
            { book: { title: { contains: search } } },
          ],
        }
      : {}),
  };
  const idRows = await prisma.loan.findMany({
    where: loanWhere,
    select: { readerId: true },
    distinct: ['readerId'],
    orderBy: { readerId: 'asc' },
  });
  const total = idRows.length;
  const pageIds = idRows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((r) => r.readerId);
  const loans = pageIds.length > 0
    ? await prisma.loan.findMany({
        where: { ...loanWhere, readerId: { in: pageIds } },
        include: { reader: true, book: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const groups = new Map<number, { reader: (typeof loans)[number]['reader']; loans: typeof loans }>();
  for (const l of loans) {
    const g = groups.get(l.readerId) ?? { reader: l.reader, loans: [] };
    g.loans.push(l);
    groups.set(l.readerId, g);
  }
  const items = [...groups.values()]
    .map((g) => ({
      reader: g.reader ? stripReaderBlobs(g.reader) : g.reader,
      loans: stripLoanBlobsMany(g.loans),
      activeCount: g.loans.length,
      overdueCount: g.loans.filter((l) => l.status === 'OVERDUE').length,
    }))
    .sort((a, b) => a.reader.name.localeCompare(b.reader.name));
  return c.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
});

loanApp.post('/:id/renew', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const loan = await prisma.loan.findUnique({
    where: { id },
    include: { reader: true },
  });
  if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
  if (loan.status === 'RETURNED' || loan.returnedAt) throw new HttpError(400, 'Empréstimo já devolvido');
  if (loan.status === 'OVERDUE') throw new HttpError(400, 'Empréstimo atrasado não pode ser renovado');
  if (loan.reader.deletedAt) throw new HttpError(400, 'Leitor excluído não pode renovar');
  if (loan.reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado ou inativo não pode renovar');

  const settings = await getSettings(prisma);
  if (loan.renewals >= settings.maxRenewals) {
    throw new HttpError(400, `Limite de ${settings.maxRenewals} renovação(ões) atingido`);
  }
  const reservation = await prisma.reservation.findFirst({
    where: { bookId: loan.bookId, status: { in: ['PENDING', 'AVAILABLE'] } },
  });
  if (reservation) throw new HttpError(400, 'Há uma reserva para este livro; não é possível renovar');

  const base = loan.dueDate.getTime() > Date.now() ? loan.dueDate : new Date();
  const newDueDate = computeDueDate(base, settings.defaultLoanDays);
  const renewed = await prisma.loan.update({
    where: { id },
    data: { dueDate: newDueDate, renewals: { increment: 1 } },
  });
  await writeAudit(c.get('user')?.id, 'LOAN_RENEWED', 'Loan', id, { number: loan.number, dueDate: newDueDate }, clientIp(c), prisma);
  return c.json({ ...renewed, number: loan.number });
});

loanApp.get('/:id/term', requireStaffOrLoanOwner, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const loan = await prisma.loan.findUnique({ where: { id }, include: { reader: true, book: true } });
  if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
  const settings = await getSettings(prisma);
  const bytes = await generateLoanTermPDF(loan, settings);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="termo-emprestimo-${loan.number || `EMP-${String(loan.id).padStart(6, '0')}`}.pdf"`,
    },
  });
});

const batchTermAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization');
  const staffToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
  let staffOk = false;
  if (staffToken) {
    try {
      let called = false;
      await requireAuth(c, async () => {
        called = true;
      });
      staffOk = called && !!c.get('user');
    } catch {
      staffOk = false;
    }
  }
  if (!staffOk) {
    try {
      let called = false;
      await requireReader(c, async () => {
        called = true;
      });
      if (!called || !c.get('reader')) throw new HttpError(401, 'Não autenticado');
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(401, 'Não autenticado');
    }
    const owned = await prismaOf(c).loan.count({
      where: { returnGroup: c.req.param('group'), readerId: c.get('reader')!.id },
    });
    if (owned === 0) throw new HttpError(403, 'Sem permissão para este documento');
  }
  await next();
});

loanApp.get('/return-term/batch/:group', batchTermAuth, async (c) => {
  const prisma = prismaOf(c);
  const loans = await prisma.loan.findMany({
    where: { returnGroup: c.req.param('group') },
    include: { reader: true, book: true },
    orderBy: { createdAt: 'asc' },
  });
  if (loans.length === 0) throw new HttpError(404, 'Termo não encontrado');
  if (loans.some((l) => !l.returnedAt)) throw new HttpError(404, 'Devolução ainda não concluída');
  const settings = await getSettings(prisma);
  const bytes = await generateBatchReturnTermPDF(loans, settings);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="termo-devolucao-${c.req.param('group')}.pdf"`,
    },
  });
});

loanApp.get('/:id/return-term', requireStaffOrLoanOwner, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const loan = await prisma.loan.findUnique({ where: { id }, include: { reader: true, book: true } });
  if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
  if (!loan.returnedAt) throw new HttpError(404, 'Empréstimo ainda não devolvido');
  const settings = await getSettings(prisma);
  const bytes = await generateReturnTermPDF(loan, settings);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="termo-devolucao-DEV-${String(loan.id).padStart(6, '0')}.pdf"`,
    },
  });
});
