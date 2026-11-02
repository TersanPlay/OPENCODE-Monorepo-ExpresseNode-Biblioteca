import {
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
} from '../../validation';
import { isbn13To10 } from '../cover';

export interface IsbnSelection {
  status: 'VALID_ISBN' | 'MISSING_ISBN' | 'INVALID_ISBN';
  isbnUsed: string | null;
  reason: string | null;
}

export function isbn10To13(isbn10: string): string | null {
  const digits = normalizeIsbn(isbn10);
  if (!isValidIsbn10(digits)) return null;
  const body = `978${digits.slice(0, 9)}`;
  const sum = body
    .split('')
    .reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return `${body}${check}`;
}

/** Todas as formas equivalentes (ISBN-10 e ISBN-13) de um ISBN válido. */
export function isbnVariants(value: string | null | undefined): string[] {
  if (!value) return [];
  const normalized = normalizeIsbn(value);
  const out = new Set<string>();
  if (isValidIsbn13(normalized)) {
    out.add(normalized);
    const as10 = isbn13To10(normalized);
    if (as10) out.add(as10);
  } else if (isValidIsbn10(normalized)) {
    out.add(normalized);
    const as13 = isbn10To13(normalized);
    if (as13) out.add(as13);
  }
  return [...out];
}

export function isbnEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = isbnVariants(a);
  if (left.length === 0) return false;
  const right = new Set(isbnVariants(b));
  return left.some((value) => right.has(value));
}

/**
 * Escolhe o ISBN de consulta respeitando as regras do projeto:
 * - prioriza ISBN-13;
 * - usa ISBN-10 como alternativa;
 * - livro sem ISBN não é consultado;
 * - livro com qualquer ISBN preenchido inválido não é atualizado.
 */
export function selectBookIsbn(book: {
  isbn10: string | null;
  isbn13: string | null;
}): IsbnSelection {
  const isbn10 = book.isbn10?.trim() ? normalizeIsbn(book.isbn10) : null;
  const isbn13 = book.isbn13?.trim() ? normalizeIsbn(book.isbn13) : null;

  if (!isbn10 && !isbn13) {
    return { status: 'MISSING_ISBN', isbnUsed: null, reason: null };
  }

  const invalid: string[] = [];
  if (isbn10 && !isValidIsbn10(isbn10)) invalid.push(`ISBN-10 inválido: ${isbn10}`);
  if (isbn13 && !isValidIsbn13(isbn13)) invalid.push(`ISBN-13 inválido: ${isbn13}`);

  if (invalid.length > 0) {
    return { status: 'INVALID_ISBN', isbnUsed: null, reason: invalid.join('; ') };
  }

  if (isbn13) return { status: 'VALID_ISBN', isbnUsed: isbn13, reason: null };
  return { status: 'VALID_ISBN', isbnUsed: isbn10, reason: null };
}
export { isbn13To10 };
