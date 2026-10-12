import { Router } from 'express';
import type { RequestHandler } from 'express';
import { Prisma } from '../../generated/prisma';
import prisma from '../../lib/prisma';
import { HttpError } from '../../lib/http-error';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth } from '../../middleware/auth';
import { writeAudit } from '../../lib/audit';
import { computeDueDate, expireReservations, refreshOverdue } from '../../lib/overdue';
import { getSettings } from '../../lib/settings';
import { stripLoanBlobsMany, stripReaderBlobs } from '../../lib/strip-signature-blobs';
import { readerEmbedSelect } from '../../lib/reader-select';
import { generateBatchReturnTermPDF, generateLoanTermPDF, generateReturnTermPDF } from '../../lib/terms';
import { requireReader } from '../../lib/reader-auth';
import { dateOrNull, listQuerySchema, loanBatchCreateSchema, loanCreateSchema, loanQuerySchema, loanReturnBatchSchema, loanReturnSchema, parse } from '../../validation';

export const loanRouter = Router();

export const loanInclude = {
  // `select` explícito: sem `passwordHash` (credencial) e sem
  // `signature`/`rubricImage` (PNG em base64, ~85 KB por leitor).
  reader: { select: readerEmbedSelect },
  book: true,
  user: { select: { id: true, name: true } },
};

async function ensureNumber(loanId: number, tx: Prisma.TransactionClient): Promise<string> {
  const number = `EMP-${String(loanId).padStart(6, '0')}`;
  await tx.loan.update({ where: { id: loanId }, data: { number } });
  return number;
}

async function assertBookEligible(
  tx: Prisma.TransactionClient,
  bookId: number,
  readerId: number,
): Promise<{ id: number; title: string }> {
  const book = await tx.book.findUnique({ where: { id: bookId } });
  if (!book) throw new HttpError(404, 'Livro não encontrado');
  if (book.isArchived) throw new HttpError(400, 'Livro arquivado não pode ser emprestado');
  const activeBookLoan = await tx.loan.findFirst({
    where: { bookId: book.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
  });
  if (activeBookLoan) throw new HttpError(400, `"${book.title}" já está emprestado`);
  const reservation = await tx.reservation.findFirst({
    where: { bookId: book.id, status: { in: ['PENDING', 'AVAILABLE'] }, readerId: { not: readerId } },
  });
  if (reservation) throw new HttpError(400, `"${book.title}" possui reserva aguardando por outro leitor`);
  return { id: book.id, title: book.title };
}

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
  db: Prisma.TransactionClient | typeof prisma,
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

async function applyAutoBlock(
  db: Prisma.TransactionClient | typeof prisma,
  readerId: number,
  ip: string | undefined,
) {
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
      }, ip);
    }
  }
}

// Termos: equipe (qualquer empréstimo) ou o próprio leitor dono do empréstimo.
const requireStaffOrLoanOwner: RequestHandler = (req, res, next) => {
  (requireAuth as RequestHandler)(req, res, () => {
    if (req.user) return next();
    (requireReader as RequestHandler)(req, res, async () => {
      try {
        if (!req.reader) return next(new HttpError(401, 'Não autenticado'));
        const loan = await prisma.loan.findUnique({
          where: { id: Number(req.params.id) },
          select: { readerId: true },
        });
        if (!loan || loan.readerId !== req.reader.id) {
          return next(new HttpError(403, 'Sem permissão para este documento'));
        }
        return next();
      } catch (err) {
        return next(err);
      }
    });
  });
};

// Assinatura da operação: nova desenho atualiza a salva do leitor;
// useSavedSignature reaproveita a salva (erro se não houver).
async function resolveLoanSignature(
  tx: Prisma.TransactionClient,
  readerId: number,
  data: { signature?: string | null; useSavedSignature?: boolean },
): Promise<string | null> {
  const drawn = data.signature ? data.signature : null;
  if (drawn) {
    await tx.reader.update({
      where: { id: readerId },
      data: { signature: drawn, signatureUpdatedAt: new Date(), signatureType: null, signatureText: null, rubricText: null, rubricImage: null, fontFamily: null },
    });
    return drawn;
  }
  if (data.useSavedSignature) {
    const r = await tx.reader.findUnique({ where: { id: readerId } });
    if (!r?.signature) throw new HttpError(400, 'Leitor não possui assinatura salva; assine no pad');
    return r.signature;
  }
  return null;
}

async function buildLoanSnapshots(
  tx: Prisma.TransactionClient,
  readerId: number,
  bookId: number,
  userId: number,
) {
  const [reader, book, user] = await Promise.all([
    tx.reader.findUnique({ where: { id: readerId }, select: { name: true } }),
    tx.book.findUnique({ where: { id: bookId }, select: { id: true, title: true, isbn10: true, isbn13: true } }),
    tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  let authorSnapshot: string | null = null;
  const bookAuthors = await tx.bookAuthor.findMany({ where: { bookId }, include: { author: { select: { name: true } } } });
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

loanRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    await refreshOverdue();
    await expireReservations();
    const q = parse(loanQuerySchema, req.query);
    const where: any = {
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
    res.json({ items: stripLoanBlobsMany(items), total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
  }),
);

loanRouter.get(
  '/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const qText = String(req.query.q || '').trim();
    if (!qText) {
      res.json({ items: [] });
      return;
    }
    await refreshOverdue();
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
    res.json({ items: stripLoanBlobsMany(items) });
  }),
);

loanRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = parse(loanCreateSchema, req.body);
    const userId = req.user!.id;
    const settings = await getSettings();

    await refreshOverdue(data.readerId);

    const { loan, number } = await prisma.$transaction(async (tx) => {
      const reader = await tx.reader.findUnique({ where: { id: data.readerId } });
      if (!reader) throw new HttpError(404, 'Leitor não encontrado');
      if (reader.deletedAt) throw new HttpError(400, 'Leitor excluido nao pode emprestar');
      if (reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado ou inativo não pode emprestar');

      await assertBookEligible(tx, data.bookId, reader.id);

      const overdue = await tx.loan.findFirst({
        where: { readerId: reader.id, status: 'OVERDUE' },
      });
      if (overdue) throw new HttpError(400, 'Leitor possui empréstimo atrasado; regularize antes de emprestar');

      const activeCount = await tx.loan.count({
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

      const snapshots = await buildLoanSnapshots(tx, reader.id, data.bookId, userId);
      const sig = await resolveLoanSignature(tx, reader.id, data);
      const opSig = (await tx.user.findUnique({ where: { id: userId }, select: { signature: true } }))?.signature ?? null;

      const created = await tx.loan.create({
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
      const number = await ensureNumber(created.id, tx);
      return { loan: created, number };
    });
    await writeAudit(userId, 'LOAN_CREATED', 'Loan', loan.id, { number, readerId: loan.readerId, bookId: loan.bookId }, req.ip);

    const full = await prisma.loan.findUnique({ where: { id: loan.id }, include: loanInclude });
    res.status(201).json({ ...full, number });
  }),
);

loanRouter.post(
  '/batch',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = parse(loanBatchCreateSchema, req.body);
    const userId = req.user!.id;
    const settings = await getSettings();

    await refreshOverdue(data.readerId);

    const loanDate = new Date();
    const dueDate = data.dueDate
      ? (dateOrNull(data.dueDate) ?? computeDueDate(loanDate, settings.defaultLoanDays))
      : computeDueDate(loanDate, settings.defaultLoanDays);
    if (dueDate.getTime() <= loanDate.getTime()) throw new HttpError(400, 'Prazo de devolução deve ser futuro');

    const bookIds = [...new Set(data.bookIds)];
    if (bookIds.length !== data.bookIds.length) throw new HttpError(400, 'Livro duplicado na seleção');

    const created = await prisma.$transaction(async (tx) => {
      const reader = await tx.reader.findUnique({ where: { id: data.readerId } });
      if (!reader) throw new HttpError(404, 'Leitor não encontrado');
      if (reader.deletedAt) throw new HttpError(400, 'Leitor excluido nao pode emprestar');
      if (reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado ou inativo não pode emprestar');

      const overdue = await tx.loan.findFirst({
        where: { readerId: reader.id, status: 'OVERDUE' },
      });
      if (overdue) throw new HttpError(400, 'Leitor possui empréstimo atrasado; regularize antes de emprestar');

      const activeCount = await tx.loan.count({
        where: { readerId: reader.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
      });
      if (activeCount + bookIds.length > settings.loanLimit) {
        throw new HttpError(
          400,
          `Limite de ${settings.loanLimit} empréstimos ativos atingido (${activeCount} ativos + ${bookIds.length} selecionados)`,
        );
      }

      const loans: { id: number; number: string; bookId: number }[] = [];
      const batchSig = await resolveLoanSignature(tx, reader.id, data);
      const batchOpSig = (await tx.user.findUnique({ where: { id: userId }, select: { signature: true } }))?.signature ?? null;
      for (const bookId of bookIds) {
        await assertBookEligible(tx, bookId, reader.id);
        const snapshots = await buildLoanSnapshots(tx, reader.id, bookId, userId);
        const createdLoan = await tx.loan.create({
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
        const number = await ensureNumber(createdLoan.id, tx);
        loans.push({ id: createdLoan.id, number, bookId });
      }
      return loans;
    });

    for (const l of created) {
      await writeAudit(userId, 'LOAN_CREATED', 'Loan', l.id, { number: l.number, readerId: data.readerId, bookId: l.bookId }, req.ip);
    }

    const full = await prisma.loan.findMany({
      where: { id: { in: created.map((l) => l.id) } },
      include: loanInclude,
      orderBy: { createdAt: 'asc' },
    });
    res.status(201).json({ items: full, count: full.length });
  }),
);

loanRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const loan = await prisma.loan.findUnique({ where: { id }, include: loanInclude });
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
    res.json(loan);
  }),
);

loanRouter.post(
  '/:id/return',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = req.body && Object.keys(req.body).length > 0 ? parse(loanReturnSchema, req.body) : {};
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');

    const returned = await performReturn(prisma, loan, data, { id: req.user!.id, name: req.user!.name });
    await applyAutoBlock(prisma, loan.readerId, req.ip);

    await writeAudit(req.user?.id, 'LOAN_RETURNED', 'Loan', id, { number: loan.number }, req.ip);
    res.json({ ...returned, number: loan.number });
  }),
);

loanRouter.post(
  '/returns/batch',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = parse(loanReturnBatchSchema, req.body);
    const userId = req.user!.id;
    const opName = req.user!.name;

    const ids = [...new Set(data.loanIds)];
    if (ids.length !== data.loanIds.length) throw new HttpError(400, 'Empréstimo duplicado na seleção');
    const found = await prisma.loan.findMany({ where: { id: { in: ids } } });
    if (found.length !== ids.length) throw new HttpError(404, 'Empréstimo não encontrado');
    const readerIds = new Set(found.map((l) => l.readerId));
    if (readerIds.size !== 1) throw new HttpError(400, 'O lote deve conter empréstimos de um único leitor');

    const group = `DEV-${String(Math.min(...ids)).padStart(6, '0')}`;
    const ordered = [...found].sort((a, b) => a.id - b.id);
    const returned = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const loan of ordered) {
        out.push(await performReturn(tx, loan, { ...data, returnGroup: group }, { id: userId, name: opName }));
      }
      return out;
    });
    await applyAutoBlock(prisma, found[0].readerId, req.ip);

    for (const l of returned) {
      await writeAudit(userId, 'LOAN_RETURNED', 'Loan', l.id, { number: l.number, group }, req.ip);
    }

    const full = await prisma.loan.findMany({
      where: { id: { in: ids } },
      include: loanInclude,
      orderBy: { createdAt: 'asc' },
    });
    res.status(200).json({ items: full, count: full.length, group });
  }),
);

loanRouter.get(
  '/returns/pending',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parse(listQuerySchema, req.query);
    const search = typeof q.search === 'string' ? q.search.trim() : '';
    const loanWhere: Prisma.LoanWhereInput = {
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
    res.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
  }),
);

loanRouter.post(
  '/:id/renew',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: { reader: true },
    });
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
    if (loan.status === 'RETURNED' || loan.returnedAt) throw new HttpError(400, 'Empréstimo já devolvido');
    if (loan.status === 'OVERDUE') throw new HttpError(400, 'Empréstimo atrasado não pode ser renovado');
    if (loan.reader.deletedAt) throw new HttpError(400, 'Leitor excluído não pode renovar');
    if (loan.reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado ou inativo não pode renovar');

    const settings = await getSettings();
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
    await writeAudit(req.user?.id, 'LOAN_RENEWED', 'Loan', id, { number: loan.number, dueDate: newDueDate }, req.ip);
    res.json({ ...renewed, number: loan.number });
  }),
);

loanRouter.get(
  '/:id/term',
  requireStaffOrLoanOwner,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const loan = await prisma.loan.findUnique({ where: { id }, include: { reader: true, book: true } });
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
    const settings = await getSettings();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="termo-emprestimo-${loan.number || `EMP-${String(loan.id).padStart(6, '0')}`}.pdf"`);
    const bytes = await generateLoanTermPDF(loan as any, settings);
    res.send(Buffer.from(bytes));
  }),
);

loanRouter.get(
  '/return-term/batch/:group',
  asyncHandler(async (req, res, next) => {
    const header = req.headers.authorization;
    const staffToken = header?.startsWith('Bearer ') ? header.slice(7) : null;
    let staffOk = false;
    if (staffToken) {
      await new Promise<void>((resolve) => {
        (requireAuth as RequestHandler)(req, res, () => resolve());
      });
      staffOk = !!req.user;
    }
    if (!staffOk) {
      await new Promise<void>((resolve) => {
        (requireReader as RequestHandler)(req, res, () => resolve());
      });
      if (!req.reader) return next(new HttpError(401, 'Não autenticado'));
      const owned = await prisma.loan.count({
        where: { returnGroup: req.params.group, readerId: req.reader.id },
      });
      if (owned === 0) return next(new HttpError(403, 'Sem permissão para este documento'));
      return next();
    }
    return next();
  }),
  asyncHandler(async (req, res) => {
    const loans = await prisma.loan.findMany({
      where: { returnGroup: req.params.group },
      include: { reader: true, book: true },
      orderBy: { createdAt: 'asc' },
    });
    if (loans.length === 0) throw new HttpError(404, 'Termo não encontrado');
    if (loans.some((l) => !l.returnedAt)) throw new HttpError(404, 'Devolução ainda não concluída');
    const settings = await getSettings();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="termo-devolucao-${req.params.group}.pdf"`);
    const bytes = await generateBatchReturnTermPDF(loans as any, settings);
    res.send(Buffer.from(bytes));
  }),
);

loanRouter.get(
  '/:id/return-term',
  requireStaffOrLoanOwner,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const loan = await prisma.loan.findUnique({ where: { id }, include: { reader: true, book: true } });
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado');
    if (!loan.returnedAt) throw new HttpError(404, 'Empréstimo ainda não devolvido');
    const settings = await getSettings();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="termo-devolucao-DEV-${String(loan.id).padStart(6, '0')}.pdf"`);
    const bytes = await generateReturnTermPDF(loan as any, settings);
    res.send(Buffer.from(bytes));
  }),
);
