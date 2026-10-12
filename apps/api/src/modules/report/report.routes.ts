import { Router } from 'express';
import type { Request } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { dateOrNull, parse, reportQuerySchema } from '../../validation';
import { refreshOverdue, MS_PER_DAY } from '../../lib/overdue';
import { generateReportPDF } from '../../lib/reports-pdf';

export const reportRouter = Router();

reportRouter.use(requireAuth, requireRoles('ADMIN'));

type Row = (string | number | null | undefined)[];

interface ReportResult {
  type: string;
  generatedAt: string;
  filters: Record<string, unknown>;
  columns: string[];
  rows: Row[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

function buildResult(
  type: string,
  req: Request,
  columns: string[],
  rows: Row[],
  paging?: { total: number; page: number; pageSize: number },
): ReportResult {
  const filters: Record<string, unknown> = {};
  for (const key of ['start', 'end', 'categoryId', 'bookId', 'readerId', 'limit', 'page']) {
    const v = (req.query as Record<string, unknown>)[key];
    if (v) filters[key] = v;
  }
  return {
    type,
    generatedAt: new Date().toISOString(),
    filters,
    columns,
    rows,
    ...(paging
      ? { total: paging.total, page: paging.page, pageSize: paging.pageSize, totalPages: Math.ceil(paging.total / paging.pageSize) }
      : {}),
  };
}

function toCsv(columns: string[], rows: Row[]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(';'), ...rows.map((r) => r.map(esc).join(';'))].join('\r\n');
}

async function computeReport(req: Request, opts?: { full?: boolean }): Promise<ReportResult> {
  const q = parse(reportQuerySchema, req.query);
  const full = opts?.full ?? false;
  const take = full ? undefined : q.limit;
  const start = dateOrNull(q.start);
  const end = dateOrNull(q.end);
  const endInclusive = end ? new Date(end.getTime() + MS_PER_DAY - 1) : undefined;
  await refreshOverdue();

  const bookFilter = {
    ...(q.categoryId ? { categories: { some: { categoryId: q.categoryId } } } : {}),
    ...(q.bookId ? { id: q.bookId } : {}),
    isArchived: false,
  };
  const periodFilter = {
    ...(start ? { gte: start } : {}),
    ...(endInclusive ? { lte: endInclusive } : {}),
  };
  const periodWhere =
    start || endInclusive
      ? { loanDate: periodFilter as { gte?: Date; lte?: Date } }
      : {};

  let columns: string[];
  let rows: Row[];

  if (q.type === 'acervo') {
    // Escopo opcional por categoria; demais filtros não se aplicam a agregados.
    const scope = q.categoryId ? { categories: { some: { categoryId: q.categoryId } } } : {};
    const [totalBooks, archivedBooks, totalCategories, totalAuthors, activeLoans, copies] =
      await Promise.all([
        prisma.book.count({ where: { ...scope, isArchived: false } }),
        prisma.book.count({ where: { ...scope, isArchived: true } }),
        prisma.category.count(),
        prisma.author.count(),
        prisma.loan.count({ where: { status: { in: ['ACTIVE', 'OVERDUE'] }, book: { ...scope, isArchived: false } } }),
        prisma.book.aggregate({ where: { ...scope, isArchived: false }, _sum: { availableCopies: true } }),
      ]);
    columns = ['Métrica', 'Valor'];
    rows = [
      ['Livros cadastrados', totalBooks],
      ['Livros disponíveis', Math.max(0, totalBooks - activeLoans)],
      ['Livros emprestados', activeLoans],
      ['Exemplares registrados', copies._sum.availableCopies ?? 0],
      ['Livros arquivados', archivedBooks],
      ['Categorias', totalCategories],
      ['Autores', totalAuthors],
    ];
  } else if (q.type === 'acervo-livros') {
    // Tabela do acervo: 30 por página, com situação por livro.
    const pageSize = 30;
    const loanedIds = new Set(
      (
        await prisma.loan.findMany({
          where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
          select: { bookId: true },
          distinct: ['bookId'],
        })
      ).map((l) => l.bookId),
    );
    const where = {
      ...(q.categoryId ? { categories: { some: { categoryId: q.categoryId } } } : {}),
      ...(q.bookId ? { id: q.bookId } : {}),
    };
    const total = await prisma.book.count({ where });
    const items = await prisma.book.findMany({
      where,
      select: { id: true, title: true, availableCopies: true, isArchived: true },
      orderBy: { title: 'asc' },
      ...(full ? {} : { skip: (q.page - 1) * pageSize, take: pageSize }),
    });
    columns = ['Título', 'Quant. Cópias', 'Situação'];
    rows = items.map((b) => [
      b.title,
      b.availableCopies ?? null,
      b.isArchived ? 'Arquivado' : loanedIds.has(b.id) ? 'Emprestado' : 'Disponível',
    ]);
    return buildResult(q.type, req, columns, rows, { total, page: q.page, pageSize });
  } else if (q.type === 'available' || q.type === 'loaned') {
    const loanedIds = (
      await prisma.loan.findMany({
        where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
        select: { bookId: true },
        distinct: ['bookId'],
      })
    ).map((l) => l.bookId);
    const inSet = q.type === 'available' ? { notIn: loanedIds } : { in: loanedIds };
    const { id: _ignored, ...bookFilterNoId } = bookFilter as Record<string, unknown>;
    const items = await prisma.book.findMany({
      where: {
        ...bookFilterNoId,
        AND: [{ id: inSet }, ...(q.bookId ? [{ id: q.bookId }] : [])],
      },
      select: {
        id: true,
        title: true,
        isbn10: true,
        isbn13: true,
        authors: { select: { author: { select: { name: true } } } },
      },
      orderBy: { title: 'asc' },
      take,
    });
    const situacao = q.type === 'available' ? 'Disponível' : 'Emprestado';
    columns = ['Título', 'Autor(es)', 'ISBN', 'Situação'];
    rows = items.map((b) => [
      b.title,
      b.authors.map((a) => a.author.name).join(', ') || '—',
      b.isbn13 ?? b.isbn10,
      situacao,
    ]);
  } else if (q.type === 'overdue') {
    const now = Date.now();
    const items = await prisma.loan.findMany({
      where: {
        status: 'OVERDUE',
        ...(q.readerId ? { readerId: q.readerId } : {}),
        book: bookFilter,
      },
      include: { reader: true, book: { select: { title: true } } },
      orderBy: { dueDate: 'asc' },
      take,
    });
    columns = ['Empréstimo', 'Leitor', 'Livro', 'Devido em', 'Dias em atraso'];
    rows = items.map((l) => [
      l.number,
      l.reader.name,
      l.book.title,
      l.dueDate.toISOString().slice(0, 10),
      Math.max(0, Math.ceil((now - l.dueDate.getTime()) / MS_PER_DAY)),
    ]);
  } else if (q.type === 'loans-period' || q.type === 'returns-period') {
    const isReturn = q.type === 'returns-period';
    const dateField = isReturn ? 'returnedAt' : 'loanDate';
    const items = await prisma.loan.findMany({
      where: {
        [dateField]: periodFilter as { gte?: Date; lte?: Date },
        ...(q.readerId ? { readerId: q.readerId } : {}),
        book: bookFilter,
      },
      include: { reader: true, book: { select: { title: true } } },
      orderBy: { [dateField]: 'desc' } as any,
      take,
    });
    columns = ['Emprï¿½stimo', 'Leitor', 'Livro', isReturn ? 'Devolvido em' : 'Emprestado em'];
    rows = items.map((l) => [
      l.number,
      l.reader.name,
      l.book.title,
      (isReturn ? l.returnedAt : l.loanDate)?.toISOString().slice(0, 10),
    ]);
  } else if (q.type === 'active-readers') {
    const grouped = await prisma.loan.groupBy({
      by: ['readerId'],
      where: { ...periodWhere, ...(q.readerId ? { readerId: q.readerId } : {}) },
      _count: { _all: true },
      orderBy: { _count: { readerId: 'desc' } },
      take,
    });
    const readers = await prisma.reader.findMany({
      where: { id: { in: grouped.map((g) => g.readerId) } },
    });
    const readerMap = new Map(readers.map((r) => [r.id, r]));
    columns = ['Leitor', 'CPF', 'Emprï¿½stimos no perï¿½odo'];
    rows = grouped.map((g) => [
      readerMap.get(g.readerId)?.name ?? `Leitor #${g.readerId}`,
      readerMap.get(g.readerId)?.cpf ?? '-',
      g._count._all,
    ]);
  } else if (q.type === 'top-books') {
    const loans = await prisma.loan.findMany({
      where: {
        ...periodWhere,
        ...(q.readerId ? { readerId: q.readerId } : {}),
        book: bookFilter,
      },
      select: { book: { select: { id: true, title: true, isbn10: true, isbn13: true } } },
    });
    const byBook = new Map<number, { title: string; isbn: string | null; count: number }>();
    for (const l of loans) {
      const book = l.book;
      const current = byBook.get(book.id) ?? { title: book.title, isbn: book.isbn13 ?? book.isbn10, count: 0 };
      current.count += 1;
      byBook.set(book.id, current);
    }
    const top = [...byBook.values()].sort((a, b) => b.count - a.count).slice(0, full ? undefined : (q.limit ?? 10));
    columns = ['Livro', 'ISBN', 'Emprï¿½stimos'];
    rows = top.map((r) => [r.title, r.isbn, r.count]);
  } else {
    const loans = await prisma.loan.findMany({
      where: {
        ...periodWhere,
        ...(q.readerId ? { readerId: q.readerId } : {}),
        book: bookFilter,
      },
      select: {
        book: { select: { categories: { include: { category: { select: { name: true } } } } } },
      },
    });
    const byCategory = new Map<string, number>();
    for (const l of loans) {
      const names = l.book.categories.map((c) => c.category.name);
      if (names.length === 0) {
        byCategory.set('Sem categoria', (byCategory.get('Sem categoria') ?? 0) + 1);
      } else {
        for (const name of names) {
          byCategory.set(name, (byCategory.get(name) ?? 0) + 1);
        }
      }
    }
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, full ? undefined : (q.limit ?? 10));
    columns = ['Categoria', 'Emprï¿½stimos'];
    rows = top.map((r) => [r[0], r[1]]);
  }

  return buildResult(q.type, req, columns, rows);
}

reportRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await computeReport(req));
  }),
);

reportRouter.get(
  '/export-pdf',
  asyncHandler(async (req, res) => {
    // Exportação contempla o resultado completo (ignora página/limite).
    const result = await computeReport(req, { full: true });
    const type = String((req.query as Record<string, unknown>).type || 'relatorio');
    const name = `relatorio-${type}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const bytes = await generateReportPDF({
      title: `Relatório — ${type}`,
      generatedAt: result.generatedAt,
      filters: result.filters,
      columns: result.columns,
      rows: result.rows,
    });
    res.send(Buffer.from(bytes));
  }),
);

reportRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const result = await computeReport(req);
    const csv = toCsv(result.columns, result.rows);
    const type = String((req.query as Record<string, unknown>).type || 'relatorio');
    const name = `relatorio-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send('ï»¿' + csv);
  }),
);