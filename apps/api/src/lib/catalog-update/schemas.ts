import { z } from 'zod';
import { paginationSchema, strOpt } from '../../validation';

export const booleanQuery = z.preprocess(
  (value) => value === true || value === 'true' || value === '1',
  z.boolean(),
);

export const catalogRowsQuerySchema = paginationSchema.extend({
  status: strOpt,
  state: strOpt,
  result: strOpt,
  search: strOpt,
  onlyChanges: booleanQuery.optional(),
});

export const catalogSimulateSchema = z.object({
  limit: z.number().int().min(1).max(10_000).nullish(),
  bookIds: z.array(z.number().int().positive()).max(10_000).optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
});

export const catalogApplySchema = z.object({
  simulationId: z.string().trim().min(1, 'simulação obrigatória'),
  confirm: z.boolean().refine((value) => value === true, 'confirmação obrigatória'),
});

export const catalogReportParamsSchema = z.object({
  kind: z.enum(['livros-sem-isbn', 'isbns-invalidos']),
});