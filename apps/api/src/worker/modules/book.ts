import { Hono } from 'hono';
import type { Prisma, PrismaClient } from '../../generated/prisma';
import { HttpError } from '../../lib/http-error';
import { writeAudit } from '../../lib/audit';
import { resolveBookMetadata } from '../../lib/cover';
import { prismaOf } from '../db';
import { stripLoanBlobsMany } from '../../lib/strip-signature-blobs';
import { readerEmbedSelect } from '../../lib/reader-select';
import { requireAuth } from '../auth';
import { rateLimit } from '../rate-limit';
import { clientIp, reqJson } from '../http';
import {
  bookQuerySchema,
  bookSchema,
  cleanInt,
  cleanNull,
  normalizeIsbn,
  parse,
} from '../../validation';
import type { AppContext, AppEnv } from '../context';

export const bookApp = new Hono<AppEnv>();

export const bookInclude = {
  categories: { include: { category: true } },
  authors: { include: { author: true } },
};

const ACTIVE_LOAN_STATUSES = ['ACTIVE', 'OVERDUE'];

async function resolveAuthorNames(
  tx: Prisma.TransactionClient,
  names: string[],
): Promise<{ ids: number[]; created: { id: number; name: string }[] }> {
  const ids: number[] = [];
  const created: { id: number; name: string }[] = [];
  if (names.length === 0) return { ids, created };
  const all = await tx.author.findMany({ select: { id: true, name: true } });
  const nameMap = new Map(all.map((a) => [a.name.toLowerCase(), a.id]));
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existingId = nameMap.get(key);
    if (existingId) {
      ids.push(existingId);
    } else {
      const author = await tx.author.create({ data: { name } });
      created.push({ id: author.id, name: author.name });
      nameMap.set(key, author.id);
      ids.push(author.id);
    }
  }
  return { ids, created };
}

async function resolveCategoryNames(
  tx: Prisma.TransactionClient,
  names: string[],
): Promise<{ ids: number[]; created: { id: number; name: string }[] }> {
  const ids: number[] = [];
  const created: { id: number; name: string }[] = [];
  if (names.length === 0) return { ids, created };
  const all = await tx.category.findMany({ select: { id: true, name: true } });
  const nameMap = new Map(all.map((c) => [c.name.toLowerCase(), c.id]));
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existingId = nameMap.get(key);
    if (existingId) {
      ids.push(existingId);
    } else {
      const category = await tx.category.create({ data: { name } });
      created.push({ id: category.id, name: category.name });
      nameMap.set(key, category.id);
      ids.push(category.id);
    }
  }
  return { ids, created };
}

function mapBook(b: any, isAvailable: boolean) {
  return {
    ...b,
    categories: (b.categories ?? []).map((c: any) => c.category),
    isAvailable,
  };
}

async function loanedBookIds(prisma: PrismaClient): Promise<Set<number>> {
  const loans = await prisma.loan.findMany({
    where: { status: { in: ACTIVE_LOAN_STATUSES } },
    select: { bookId: true },
    distinct: ['bookId'],
  });
  return new Set(loans.map((l) => l.bookId));
}

function providedIsbns(data: { isbn10?: string | null; isbn13?: string | null }): string[] {
  const set: string[] = [];
  for (const value of [data.isbn10, data.isbn13]) {
    if (!value) continue;
    const normalized = normalizeIsbn(value);
    if (normalized && !set.includes(normalized)) set.push(normalized);
  }
  return set;
}

async function findDuplicateBook(prisma: PrismaClient, isbns: string[], excludeId?: number) {
  if (isbns.length === 0) return null;
  return prisma.book.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ isbn10: { in: isbns } }, { isbn13: { in: isbns } }],
    },
    select: { id: true, title: true, isbn10: true, isbn13: true },
  });
}

function duplicateConflict(c: AppContext, duplicate: NonNullable<Awaited<ReturnType<typeof findDuplicateBook>>>) {
  return c.json(
    {
      success: false,
      code: 'BOOK_ALREADY_EXISTS',
      message: 'Este livro já está cadastrado.',
      duplicate: {
        id: duplicate.id,
        titulo: duplicate.title,
        isbn10: duplicate.isbn10,
        isbn13: duplicate.isbn13,
      },
    },
    409,
  );
}

const coverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: { error: 'Muitas consultas de capa. Tente novamente mais tarde.' },
});

bookApp.get('/', async (c) => {
  const prisma = prismaOf(c);
  const q = parse(bookQuerySchema, c.req.query());
  const search = q.search;
  const where: any = {
    isArchived: q.includeArchived ? undefined : false,
    ...(q.categoryId ? { categories: { some: { categoryId: q.categoryId } } } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search } },
            { subtitle: { contains: search } },
            { isbn10: { contains: search } },
            { isbn13: { contains: search } },
            { publisher: { contains: search } },
            { authors: { some: { author: { name: { contains: search } } } } },
          ],
        }
      : {}),
  };
  let loanedIds: Set<number> = new Set();
  if (q.availability) {
    loanedIds = await loanedBookIds(prisma);
    if (loanedIds.size === 0 && q.availability === 'available') {
      return c.json({ items: [], total: 0, page: q.page, pageSize: q.pageSize, totalPages: 0 });
    }
    if (q.availability === 'available') {
      where.id = { notIn: Array.from(loanedIds) };
    } else {
      where.id = { in: Array.from(loanedIds) };
    }
  }

  const total = await prisma.book.count({ where });
  const orderBy: any =
    q.sort === 'title'
      ? { title: 'asc' as const }
      : q.sort === 'oldest'
        ? { createdAt: 'asc' as const }
        : { createdAt: 'desc' as const };

  const items = await prisma.book.findMany({
    where,
    include: bookInclude,
    orderBy,
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  if (loanedIds.size === 0) loanedIds = await loanedBookIds(prisma);
  return c.json({
    items: items.map((b) => mapBook(b, !loanedIds.has(b.id))),
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.ceil(total / q.pageSize),
  });
});

bookApp.get('/cover', coverLimiter, async (c) => {
  const isbn = c.req.query('isbn')?.trim() ?? '';
  if (!isbn) throw new HttpError(400, 'Informe um ISBN');
  const info = await resolveBookMetadata(isbn);
  if (!info) throw new HttpError(404, 'Capa não encontrada');
  return c.json(info);
});

bookApp.get('/exists', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const raw = c.req.query('isbn')?.trim() ?? '';
  const isbn = raw ? normalizeIsbn(raw) : '';
  if (!isbn) throw new HttpError(400, 'Informe um ISBN');
  const exclude = Number(c.req.query('exclude')) || undefined;
  const book = await prisma.book.findFirst({
    where: {
      ...(exclude ? { id: { not: exclude } } : {}),
      OR: [{ isbn10: isbn }, { isbn13: isbn }],
    },
    select: { id: true, title: true, isbn10: true, isbn13: true },
  });
  return c.json({ book });
});

bookApp.get('/:id', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(404, 'Livro não encontrado');
  const book = await prisma.book.findUnique({ where: { id }, include: bookInclude });
  if (!book) throw new HttpError(404, 'Livro não encontrado');
  const [loans, activeLoans] = await Promise.all([
    prisma.loan.findMany({
      where: { bookId: id },
      include: { reader: { select: readerEmbedSelect }, book: true, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.loan.count({
      where: { bookId: id, status: { in: ACTIVE_LOAN_STATUSES } },
    }),
  ]);
  return c.json({
    ...mapBook(book, activeLoans === 0),
    // A ficha do livro não exibe as assinaturas do empréstimo; sem o strip cada
    // linha carregava ~20 KB de PNG em base64.
    loans: stripLoanBlobsMany(loans),
    hasActiveLoan: activeLoans > 0,
  });
});

bookApp.post('/', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(bookSchema, await reqJson(c));
  const duplicate = await findDuplicateBook(prisma, providedIsbns(data));
  if (duplicate) {
    return duplicateConflict(c, duplicate);
  }
  // D1 não suporta transações interativas (callback): sequência de operações.
  const createdAuthors: { id: number; name: string }[] = [];
  const createdCategories: { id: number; name: string }[] = [];
  const book = await prisma.book.create({
    data: {
      title: data.title,
      subtitle: cleanNull(data.subtitle),
      isbn10: cleanNull(data.isbn10 ? normalizeIsbn(data.isbn10) : null),
      isbn13: cleanNull(data.isbn13 ? normalizeIsbn(data.isbn13) : null),
      description: cleanNull(data.description),
      publisher: cleanNull(data.publisher),
      edition: cleanInt(data.edition),
      publicationYear: cleanInt(data.publicationYear),
      language: cleanNull(data.language),
      pages: cleanInt(data.pages),
      coverUrl: cleanNull(data.coverUrl),
      volume: cleanNull(data.volume),
      cdd: cleanNull(data.cdd),
      cutter: cleanNull(data.cutter),
      physicalLocation: cleanNull(data.physicalLocation),
      availableCopies: cleanInt(data.availableCopies),
      acquisitionType: cleanNull(data.acquisitionType),
    },
  });
  if (data.authorIds.length > 0 || data.authorNames.length > 0) {
    const resolved = await resolveAuthorNames(prisma, data.authorNames);
    const authorIds = [...new Set([...data.authorIds, ...resolved.ids])];
    await prisma.bookAuthor.createMany({
      data: authorIds.map((authorId) => ({ bookId: book.id, authorId })),
    });
    createdAuthors.push(...resolved.created);
  }
  if (data.categoryIds.length > 0 || data.categoryNames.length > 0) {
    const resolved = await resolveCategoryNames(prisma, data.categoryNames);
    const categoryIds = [...new Set([...data.categoryIds, ...resolved.ids])];
    await prisma.bookCategory.createMany({
      data: categoryIds.map((categoryId) => ({ bookId: book.id, categoryId })),
    });
    createdCategories.push(...resolved.created);
  }
  for (const a of createdAuthors) {
    await writeAudit(c.get('user')?.id, 'AUTHOR_CREATED', 'Author', a.id, { name: a.name }, clientIp(c), prisma);
  }
  for (const cat of createdCategories) {
    await writeAudit(c.get('user')?.id, 'CATEGORY_CREATED', 'Category', cat.id, { name: cat.name }, clientIp(c), prisma);
  }
  await writeAudit(c.get('user')?.id, 'BOOK_CREATED', 'Book', book.id, { title: book.title }, clientIp(c), prisma);
  const full = await prisma.book.findUnique({ where: { id: book.id }, include: bookInclude });
  return c.json(mapBook(full!, true), 201);
});

bookApp.put('/:id', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const data = parse(bookSchema, await reqJson(c));
  const existing = await prisma.book.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Livro não encontrado');
  const duplicate = await findDuplicateBook(prisma, providedIsbns(data), id);
  if (duplicate) {
    return duplicateConflict(c, duplicate);
  }
  const createdAuthors: { id: number; name: string }[] = [];
  const createdCategories: { id: number; name: string }[] = [];
  await prisma.book.update({
    where: { id },
    data: {
      title: data.title,
      subtitle: cleanNull(data.subtitle),
      isbn10: cleanNull(data.isbn10 ? normalizeIsbn(data.isbn10) : null),
      isbn13: cleanNull(data.isbn13 ? normalizeIsbn(data.isbn13) : null),
      description: cleanNull(data.description),
      publisher: cleanNull(data.publisher),
      edition: cleanInt(data.edition),
      publicationYear: cleanInt(data.publicationYear),
      language: cleanNull(data.language),
      pages: cleanInt(data.pages),
      coverUrl: cleanNull(data.coverUrl),
      volume: cleanNull(data.volume),
      cdd: cleanNull(data.cdd),
      cutter: cleanNull(data.cutter),
      physicalLocation: cleanNull(data.physicalLocation),
      availableCopies: cleanInt(data.availableCopies),
      acquisitionType: cleanNull(data.acquisitionType),
    },
  });
  await prisma.bookAuthor.deleteMany({ where: { bookId: id } });
  const resolved = await resolveAuthorNames(prisma, data.authorNames);
  const authorIds = [...new Set([...data.authorIds, ...resolved.ids])];
  if (authorIds.length > 0) {
    await prisma.bookAuthor.createMany({
      data: authorIds.map((authorId) => ({ bookId: id, authorId })),
    });
  }
  createdAuthors.push(...resolved.created);
  await prisma.bookCategory.deleteMany({ where: { bookId: id } });
  const resolvedCategories = await resolveCategoryNames(prisma, data.categoryNames);
  const categoryIds = [...new Set([...data.categoryIds, ...resolvedCategories.ids])];
  if (categoryIds.length > 0) {
    await prisma.bookCategory.createMany({
      data: categoryIds.map((categoryId) => ({ bookId: id, categoryId })),
    });
  }
  createdCategories.push(...resolvedCategories.created);
  for (const a of createdAuthors) {
    await writeAudit(c.get('user')?.id, 'AUTHOR_CREATED', 'Author', a.id, { name: a.name }, clientIp(c), prisma);
  }
  for (const cat of createdCategories) {
    await writeAudit(c.get('user')?.id, 'CATEGORY_CREATED', 'Category', cat.id, { name: cat.name }, clientIp(c), prisma);
  }
  await writeAudit(c.get('user')?.id, 'BOOK_UPDATED', 'Book', id, { title: data.title }, clientIp(c), prisma);
  const full = await prisma.book.findUnique({ where: { id }, include: bookInclude });
  const activeLoans = await prisma.loan.count({
    where: { bookId: id, status: { in: ACTIVE_LOAN_STATUSES } },
  });
  return c.json(mapBook(full!, activeLoans === 0));
});

bookApp.delete('/:id', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const existing = await prisma.book.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Livro não encontrado');
  const archived = await prisma.book.update({ where: { id }, data: { isArchived: true } });
  await writeAudit(c.get('user')?.id, 'BOOK_ARCHIVED', 'Book', id, { title: archived.title }, clientIp(c), prisma);
  return c.json({ ok: true, isArchived: true });
});

bookApp.patch('/:id/restore', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const existing = await prisma.book.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Livro não encontrado');
  const restored = await prisma.book.update({ where: { id }, data: { isArchived: false } });
  await writeAudit(c.get('user')?.id, 'BOOK_RESTORED', 'Book', id, { title: restored.title }, clientIp(c), prisma);
  return c.json({ ok: true, isArchived: false });
});
