import type {
  CatalogUpdateCounts,
  CatalogUpdateProcessStatus,
  CatalogUpdateRow,
  CatalogUpdateRowState,
} from '@library/shared';
import type { PrismaClient } from '../../generated/prisma';
import type { BookSnapshot } from './mapper';
import { selectBookIsbn } from './isbn';

type BookWithAuthors = {
  id: number;
  title: string;
  isbn10: string | null;
  isbn13: string | null;
  description: string | null;
  publisher: string | null;
  edition: number | null;
  publicationYear: number | null;
  language: string | null;
  pages: number | null;
  coverUrl: string | null;
  updatedAt: Date | string;
  catalogUpdateStatus: string | null;
  catalogUpdatedAt: Date | string | null;
  catalogUpdateSource: string | null;
  catalogUpdateMessage: string | null;
  catalogUpdateFields: string | null;
  catalogUpdateJobId: string | null;
  authors: { author: { name: string } }[];
};

export interface CatalogUpdatePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CatalogListQuery {
  status?: string | null;
  state?: string | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
}

export const PROCESS_STATUSES: CatalogUpdateProcessStatus[] = ['UPDATED', 'UNCHANGED', 'NOT_FOUND', 'ERROR'];
export const COMPLETED_STATUSES: CatalogUpdateProcessStatus[] = ['UPDATED', 'UNCHANGED'];

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function parseProcessStatus(value: string | null): CatalogUpdateProcessStatus | null {
  if (!value) return null;
  const upper = value.toUpperCase() as CatalogUpdateProcessStatus;
  return PROCESS_STATUSES.includes(upper) ? upper : null;
}

function parseFields(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function toBookSnapshot(book: BookWithAuthors): BookSnapshot {
  return {
    id: book.id,
    title: book.title,
    isbn10: book.isbn10,
    isbn13: book.isbn13,
    description: book.description,
    publisher: book.publisher,
    edition: book.edition,
    publicationYear: book.publicationYear,
    language: book.language,
    pages: book.pages,
    coverUrl: book.coverUrl,
    updatedAt: book.updatedAt,
    authors: book.authors.map((link) => link.author.name),
  };
}

/**
 * Fonte da verdade do estado de atualização: colunas persistidas em `Book`.
 * Uma simulação nunca altera esses campos; apenas a aplicação os grava.
 */
export function deriveRowState(book: {
  isbn10: string | null;
  isbn13: string | null;
  catalogUpdateStatus: string | null;
  catalogUpdateMessage: string | null;
}): { rowState: CatalogUpdateRowState; pendingReason: string | null } {
  const selection = selectBookIsbn(book);
  if (selection.status === 'MISSING_ISBN') {
    return { rowState: 'MISSING_ISBN', pendingReason: 'Livro sem ISBN-10 e ISBN-13.' };
  }
  if (selection.status === 'INVALID_ISBN') {
    return { rowState: 'PENDING', pendingReason: selection.reason ?? 'ISBN inválido.' };
  }

  const processStatus = parseProcessStatus(book.catalogUpdateStatus);
  if (processStatus && COMPLETED_STATUSES.includes(processStatus)) {
    return { rowState: 'UPDATED', pendingReason: null };
  }
  if (processStatus === 'NOT_FOUND') {
    return {
      rowState: 'PENDING',
      pendingReason:
        book.catalogUpdateMessage ??
        'Não encontrado na ISBNdb; pode ser tentado novamente em outra execução.',
    };
  }
  if (processStatus === 'ERROR') {
    return {
      rowState: 'PENDING',
      pendingReason: book.catalogUpdateMessage ?? 'Falha na última consulta à ISBNdb.',
    };
  }
  return {
    rowState: 'PENDING',
    pendingReason: 'Ainda não processado pela ISBNdb.',
  };
}

export function toAnalysisRow(book: BookWithAuthors): CatalogUpdateRow {
  const selection = selectBookIsbn(book);
  const { rowState, pendingReason } = deriveRowState(book);
  return {
    bookId: book.id,
    title: book.title,
    authors: book.authors.map((link) => link.author.name),
    publisher: book.publisher,
    publicationYear: book.publicationYear,
    isbn10: book.isbn10,
    isbn13: book.isbn13,
    isbnUsed: selection.isbnUsed,
    status: selection.status,
    reason: selection.reason,
    bookUpdatedAt: toIso(book.updatedAt),
    processStatus: parseProcessStatus(book.catalogUpdateStatus),
    catalogUpdatedAt: book.catalogUpdatedAt ? toIso(book.catalogUpdatedAt) : null,
    catalogUpdateSource: book.catalogUpdateSource,
    catalogUpdateMessage: book.catalogUpdateMessage,
    catalogUpdateFields: parseFields(book.catalogUpdateFields),
    catalogUpdateJobId: book.catalogUpdateJobId,
    rowState,
    pendingReason,
  };
}

export async function loadCatalogBooks(prisma: PrismaClient): Promise<BookWithAuthors[]> {
  return prisma.book.findMany({
    include: { authors: { include: { author: { select: { name: true } } } } },
    orderBy: { title: 'asc' },
  });
}

export function computeCounts(rows: CatalogUpdateRow[]): CatalogUpdateCounts {
  let withValidIsbn = 0;
  let withoutIsbn = 0;
  let invalidIsbn = 0;
  let pending = 0;
  let completed = 0;
  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let errors = 0;

  for (const row of rows) {
    if (row.status === 'VALID_ISBN') withValidIsbn += 1;
    else if (row.status === 'MISSING_ISBN') withoutIsbn += 1;
    else invalidIsbn += 1;

    if (row.rowState === 'PENDING') pending += 1;
    if (row.rowState === 'UPDATED') completed += 1;
    if (row.processStatus === 'UPDATED') updated += 1;
    else if (row.processStatus === 'UNCHANGED') unchanged += 1;
    else if (row.processStatus === 'NOT_FOUND') notFound += 1;
    else if (row.processStatus === 'ERROR') errors += 1;
  }

  return {
    totalBooks: rows.length,
    withValidIsbn,
    withoutIsbn,
    invalidIsbn,
    pending,
    completed,
    updated,
    unchanged,
    notFound,
    errors,
  };
}

function matchesSearch(row: CatalogUpdateRow, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  const haystack = [row.title, row.isbn10, row.isbn13, row.publisher, ...row.authors]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterRows(rows: CatalogUpdateRow[], query: CatalogListQuery): CatalogUpdateRow[] {
  const state = query.state?.trim().toUpperCase();
  const status = query.status?.trim().toUpperCase();
  const search = query.search?.trim() ?? '';

  return rows.filter((row) => {
    if (state === 'PENDING' && row.rowState !== 'PENDING') return false;
    if (state === 'UPDATED' && row.rowState !== 'UPDATED') return false;
    if (state === 'MISSING_ISBN' && row.rowState !== 'MISSING_ISBN') return false;

if (status === 'UNPROCESSED') {
      if (row.processStatus) return false;
    } else if (status) {
      const matchesStatus =
        row.processStatus === status ||
        row.status === status ||
        row.rowState === status;
      if (!matchesStatus) return false;
    }
    return matchesSearch(row, search);
  });
}

export function paginate<T>(items: T[], page = 1, pageSize = 20): CatalogUpdatePage<T> {
  const safePage = Math.max(1, Math.trunc(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Math.trunc(pageSize) || 20));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const start = (safePage - 1) * safeSize;
  return {
    items: items.slice(start, start + safeSize),
    total,
    page: safePage,
    pageSize: safeSize,
    totalPages,
  };
}

export function bothReportsRows(rows: CatalogUpdateRow[]): {
  missing: CatalogUpdateRow[];
  invalid: CatalogUpdateRow[];
} {
  return {
    missing: rows
      .filter((row) => row.status === 'MISSING_ISBN')
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
    invalid: rows
      .filter((row) => row.status === 'INVALID_ISBN')
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
  };
}
export function isCompletedProcessStatus(status: string | null): boolean {
  const parsed = parseProcessStatus(status);
  return parsed !== null && COMPLETED_STATUSES.includes(parsed);
}
