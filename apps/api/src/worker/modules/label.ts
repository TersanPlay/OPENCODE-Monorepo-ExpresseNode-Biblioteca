import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error';
import { generateLabelsPDF } from '../../lib/labels-pdf';
import { prismaOf } from '../db';
import { requireAuth } from '../auth';
import { parse } from '../../validation';
import { reqJson } from '../http';
import type { AppEnv } from '../context';

export const labelApp = new Hono<AppEnv>();

labelApp.use(requireAuth);

const labelGenerateSchema = z.object({
  bookId: z.number().int().positive(),
  exemplares: z.array(z.number().int().positive()).min(1),
});

labelApp.post('/pdf', async (c) => {
  const prisma = prismaOf(c);
  const data = parse(labelGenerateSchema, await reqJson(c));
  const book = await prisma.book.findUnique({ where: { id: data.bookId } });
  if (!book) throw new HttpError(404, 'Livro não encontrado');

  // Exemplares = cópias cadastradas do livro (mínimo 1).
  const copies = Math.max(book.availableCopies ?? 1, 1);
  const exemplares = [...new Set(data.exemplares)].sort((a, b) => a - b);
  if (exemplares[exemplares.length - 1] > copies) {
    throw new HttpError(400, `Exemplares devem estar entre 1 e ${copies}`);
  }

  const bytes = await generateLabelsPDF(exemplares.map((exemplar) => ({ book, exemplar })));
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="etiquetas-livro-${book.id}.pdf"`,
    },
  });
});
