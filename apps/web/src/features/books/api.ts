import { api } from '../../services/api-client';
import type { Book, BookFormValues, BookRef, Paginated } from '@library/shared';
import { cleanPayload, type Params } from '../http';

function toBookPayload(v: BookFormValues) {
  return cleanPayload({
    title: v.title,
    subtitle: v.subtitle,
    isbn10: v.isbn10,
    isbn13: v.isbn13,
    description: v.description,
    publisher: v.publisher,
    edition: v.edition ? Number(v.edition) : undefined,
    publicationYear: v.publicationYear ? Number(v.publicationYear) : undefined,
    language: v.language,
    pages: v.pages ? Number(v.pages) : undefined,
    coverUrl: v.coverUrl,
    volume: v.volume,
    cdd: v.cdd,
    cutter: v.cutter,
    physicalLocation: v.physicalLocation,
    availableCopies: v.availableCopies ? Number(v.availableCopies) : undefined,
    acquisitionType: v.acquisitionType || undefined,
    categoryIds: v.categories.filter((c) => c.id != null).map((c) => c.id as number),
    categoryNames: v.categories.filter((c) => c.id == null).map((c) => c.name),
    authorIds: v.authors.filter((a) => a.id != null).map((a) => a.id as number),
    authorNames: v.authors.filter((a) => a.id == null).map((a) => a.name),
  });
}

export const booksApi = {
  list: (params?: Params, signal?: AbortSignal) =>
    api.get<Paginated<Book>>('/books', { params, signal }).then((r) => r.data),
  get: (id: number) => api.get<Book>(`/books/${id}`).then((r) => r.data),
  create: (v: BookFormValues) => api.post<Book>('/books', toBookPayload(v)).then((r) => r.data),
  update: (id: number, v: BookFormValues) =>
    api.put<Book>(`/books/${id}`, toBookPayload(v)).then((r) => r.data),
  archive: (id: number) => api.delete(`/books/${id}`).then((r) => r.data),
  restore: (id: number) => api.patch(`/books/${id}/restore`).then((r) => r.data),
  cover: (isbn: string, signal?: AbortSignal) =>
    api
      .get<{
        coverUrl: string;
        title: string | null;
        subtitle: string | null;
        isbn13: string | null;
        description: string | null;
        publisher: string | null;
        publicationYear: number | null;
        pages: number | null;
        authors: string[];
        categories: string[];
      }>('/books/cover', { params: { isbn }, signal })
      .then((r) => r.data),
  exists: (isbn: string, excludeId?: number, signal?: AbortSignal) =>
    api
      .get<{ book: BookRef | null }>('/books/exists', {
        params: { isbn, ...(excludeId ? { exclude: excludeId } : {}) },
        signal,
      })
      .then((r) => r.data),
};
