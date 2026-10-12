import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { HttpError } from '../../lib/http-error';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth } from '../../middleware/auth';
import { generateLabelsPDF } from '../../lib/labels-pdf';
import { parse } from '../../validation';

export const labelRouter = Router();

labelRouter.use(requireAuth);

const labelGenerateSchema = z.object({
  bookId: z.number().int().positive(),
  exemplares: z.array(z.number().int().positive()).min(1),
});

labelRouter.post(
  '/pdf',
  asyncHandler(async (req, res) => {
    const data = parse(labelGenerateSchema, req.body);
    const book = await prisma.book.findUnique({ where: { id: data.bookId } });
    if (!book) throw new HttpError(404, 'Livro não encontrado');

    // Exemplares = cópias cadastradas do livro (mínimo 1).
    const copies = Math.max(book.availableCopies ?? 1, 1);
    const exemplares = [...new Set(data.exemplares)].sort((a, b) => a - b);
    if (exemplares[exemplares.length - 1] > copies) {
      throw new HttpError(400, `Exemplares devem estar entre 1 e ${copies}`);
    }

    const pdf = await generateLabelsPDF(exemplares.map((exemplar) => ({ book, exemplar })));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="etiquetas-livro-${book.id}.pdf"`);
    res.send(Buffer.from(pdf));
  }),
);
