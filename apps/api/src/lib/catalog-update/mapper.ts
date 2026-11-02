import type {
  CatalogUpdateAuthorChange,
  CatalogUpdateChange,
  CatalogUpdateRow,
} from '@library/shared';
import { normalizeIsbn } from '../../validation';
import { isValidIsbn10, isValidIsbn13 } from '../../validation';
import type { IsbndbBook } from './isbndb-client';
import { normalizeLanguage } from './language';

export interface BookSnapshot {
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
  authors: string[];
}

export interface BookProposal {
  changes: CatalogUpdateChange[];
  authorChanges: CatalogUpdateAuthorChange | null;
  apiTitle: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Título',
  isbn10: 'ISBN-10',
  isbn13: 'ISBN-13',
  publisher: 'Editora',
  publicationYear: 'Ano de publicação',
  edition: 'Edição',
  language: 'Idioma',
  pages: 'Páginas',
  description: 'Descrição',
  coverUrl: 'URL da capa',
};

/** Campos que o script pode gravar. CDD, Cutter, categorias, subtítulo e volume nunca entram. */
export const APPLICABLE_FIELDS = Object.keys(FIELD_LABELS) as Array<
  keyof typeof FIELD_LABELS
>;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

function parsePositiveInt(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n < 1 || n > max) return null;
  return n;
}

function parseYear(value: unknown): number | null {
  const text = typeof value === 'string' ? value : '';
  const match = text.match(/\b(1\d{3}|20\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  const maxYear = new Date().getFullYear() + 1;
  if (year < 1000 || year > maxYear) return null;
  return year;
}

function normalizeAuthorNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = cleanText(item);
    if (!name || name.length < 2) continue;
    const value = name.slice(0, 120);
    if (!out.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      out.push(value);
    }
  }
  return out;
}

function sameNameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((name) => name.toLowerCase()));
  return b.every((name) => set.has(name.toLowerCase()));
}

function pushChange(
  changes: CatalogUpdateChange[],
  field: string,
  current: string | number | null,
  next: string | number | null,
): void {
  changes.push({ field, label: FIELD_LABELS[field] ?? field, current, next });
}

/**
 * Monta a proposta de atualização de um livro a partir do retorno da ISBNdb.
 * Só inclui campos mapeados, válidos e não vazios. Regras conservadoras evitam
 * sobrescrever dados existentes com informação pior/incompleta.
 */
export function buildBookProposal(book: BookSnapshot, api: IsbndbBook): BookProposal {
  const changes: CatalogUpdateChange[] = [];

  const apiTitle = cleanText(api.title);
  if (
    apiTitle &&
    apiTitle.length >= 3 &&
    !sameText(book.title, apiTitle) &&
    !(
      book.title.toLowerCase().startsWith(apiTitle.toLowerCase()) &&
      book.title.length > apiTitle.length
    )
  ) {
    pushChange(changes, 'title', book.title, apiTitle);
  }

  const apiIsbn10 = api.isbn10 ? normalizeIsbn(api.isbn10) : null;
  if (apiIsbn10 && isValidIsbn10(apiIsbn10) && !book.isbn10) {
    pushChange(changes, 'isbn10', book.isbn10, apiIsbn10);
  }

  const apiIsbn13 = api.isbn13 ? normalizeIsbn(api.isbn13) : null;
  if (apiIsbn13 && isValidIsbn13(apiIsbn13) && !book.isbn13) {
    pushChange(changes, 'isbn13', book.isbn13, apiIsbn13);
  }

  const publisher = cleanText(api.publisher);
  if (
    publisher &&
    !sameText(book.publisher, publisher) &&
    !(
      book.publisher &&
      book.publisher.toLowerCase().includes(publisher.toLowerCase()) &&
      book.publisher.length > publisher.length
    )
  ) {
    pushChange(changes, 'publisher', book.publisher, publisher);
  }

  const year = parseYear(api.date_published);
  if (year !== null && year !== book.publicationYear) {
    pushChange(changes, 'publicationYear', book.publicationYear, year);
  }

  const edition = parsePositiveInt(api.edition_number, 999);
  if (edition !== null && edition !== book.edition) {
    pushChange(changes, 'edition', book.edition, edition);
  }

  const language = normalizeLanguage(api.language);
  if (language && !sameText(book.language, language)) {
    pushChange(changes, 'language', book.language, language);
  }

  const pages = parsePositiveInt(api.pages, 20_000);
  if (pages !== null && pages !== book.pages) {
    pushChange(changes, 'pages', book.pages, pages);
  }

  const description = cleanText(api.synopsis);
  if (description && description.length >= 20) {
    const current = book.description?.trim() ?? '';
    const richer =
      !current ||
      current.length < 80 ||
      description.length >= Math.ceil(current.length * 1.25);
    if (richer && !sameText(book.description, description)) {
      pushChange(changes, 'description', book.description, description);
    }
  }

  const cover = cleanText(api.image);
  if (cover && /^https?:\/\//i.test(cover) && !book.coverUrl) {
    pushChange(changes, 'coverUrl', book.coverUrl, cover);
  }

  const nextAuthors = normalizeAuthorNames(api.authors);
  const authorChanges =
    nextAuthors.length > 0 && !sameNameSet(book.authors, nextAuthors)
      ? { current: book.authors, next: nextAuthors }
      : null;

  return { changes, authorChanges, apiTitle };
}

/** Dados de update do Prisma restritos aos campos realmente aplicáveis. */
export function toUpdateData(
  changes: CatalogUpdateChange[],
): Record<string, string | number | null> {
  const data: Record<string, string | number | null> = {};
  for (const change of changes) {
    if (!APPLICABLE_FIELDS.includes(change.field)) continue;
    data[change.field] = change.next;
  }
  return data;
}

function normalizeComparable(value: string | number | null): string {
  if (value === null) return '';
  return String(value).trim();
}

/**
 * Verifica se o livro mudou desde a simulação. Qualquer divergência impede a
 * aplicação do livro inteiro (sem atualização parcial).
 */
export function detectConflict(book: BookSnapshot, row: CatalogUpdateRow): string | null {
  const bookUpdatedAt =
    book.updatedAt instanceof Date ? book.updatedAt.toISOString() : new Date(book.updatedAt).toISOString();
  if (bookUpdatedAt !== row.bookUpdatedAt) {
    return 'O livro foi alterado depois da simulação.';
  }

  const currentValues: Record<string, string | number | null> = {
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
  };

  const changedFields: string[] = [];
  for (const change of row.changes ?? []) {
    if (!(change.field in currentValues)) continue;
    if (normalizeComparable(currentValues[change.field]) !== normalizeComparable(change.current)) {
      changedFields.push(FIELD_LABELS[change.field] ?? change.field);
    }
  }
  if (changedFields.length > 0) {
    return `Campos alterados desde a simulação: ${changedFields.join(', ')}.`;
  }

  if (row.authorChanges && !sameNameSet(book.authors, row.authorChanges.current)) {
    return 'Os autores do livro mudaram desde a simulação.';
  }

  return null;
}