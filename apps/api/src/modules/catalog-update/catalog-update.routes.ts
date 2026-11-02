import { Router } from 'express';
import path from 'node:path';
import prisma from '../../lib/prisma';
import { env } from '../../config/env';
import { HttpError } from '../../lib/http-error';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { parse } from '../../validation';
import {
  booleanQuery,
  catalogApplySchema,
  catalogReportParamsSchema,
  catalogRowsQuerySchema,
  catalogSimulateSchema,
} from '../../lib/catalog-update/schemas';
import { CatalogUpdateJobManager } from '../../lib/catalog-update/jobs';
import { FileCatalogUpdateJobStore } from '../../lib/catalog-update/store-file';
import { runApplyJob, runSimulationJob } from '../../lib/catalog-update/runner';
import {
  analyzeCatalog,
  buildReportMarkdown,
  delayFromEnv,
  getJobRows,
  listAnalysisRows,
  startApply,
  startSimulation,
} from '../../lib/catalog-update/service';
import { toJobSummary } from '../../lib/catalog-update/store';

export const catalogUpdateRouter = Router();

// A API roda a partir de apps/api (dev e `start`), onde ficam .env e backups/.
const JOB_STORE_DIR = path.resolve(process.cwd(), 'backups/.catalog-updates');
const manager = new CatalogUpdateJobManager(new FileCatalogUpdateJobStore(JOB_STORE_DIR));

catalogUpdateRouter.use(requireAuth, requireRoles('ADMIN'));

catalogUpdateRouter.get(
  '/analysis',
  asyncHandler(async (_req, res) => {
    res.json(await analyzeCatalog(prisma, Boolean(env.ISBNDB_API_KEY)));
  }),
);

catalogUpdateRouter.get(
  '/books',
  asyncHandler(async (req, res) => {
    const query = parse(catalogRowsQuerySchema, req.query);
    res.json(await listAnalysisRows(prisma, query));
  }),
);

catalogUpdateRouter.post(
  '/simulate',
  asyncHandler(async (req, res) => {
    const data = parse(catalogSimulateSchema, req.body ?? {});
    const delayMs = data.delayMs ?? delayFromEnv(env.ISBNDB_DELAY_MS);
    const parsedBulk = env.ISBNDB_BULK_SIZE ? Number(env.ISBNDB_BULK_SIZE) : NaN;
    const bulkSize = Number.isFinite(parsedBulk) && parsedBulk > 0 ? parsedBulk : undefined;
    const { job, bookIds } = await startSimulation({
      manager,
      prisma,
      apiKey: env.ISBNDB_API_KEY,
      delayMs,
      userId: req.user?.id ?? null,
      limit: data.limit ?? null,
      bookIds: data.bookIds,
    });

    void runSimulationJob({
      manager,
      prisma,
      jobId: job.id,
      apiKey: env.ISBNDB_API_KEY as string,
      delayMs,
userId: req.user?.id ?? null,
      bookIds,
      bulkSize,
    }).catch((err) => console.error('[catalog-update] falha na simulação:', err));

    res.status(202).json({ job });
  }),
);

catalogUpdateRouter.post(
  '/apply',
  asyncHandler(async (req, res) => {
    const data = parse(catalogApplySchema, req.body ?? {});
    const { job, simulation } = await startApply({
      manager,
      prisma,
      simulationId: data.simulationId,
      userId: req.user?.id ?? null,
      confirm: data.confirm,
    });

    void runApplyJob({
      manager,
      prisma,
      jobId: job.id,
      simulation,
      userId: req.user?.id ?? null,
    }).catch((err) => console.error('[catalog-update] falha na aplicação:', err));

    res.status(202).json({ job });
  }),
);

catalogUpdateRouter.post(
  '/jobs/:id/stop',
  asyncHandler(async (req, res) => {
    const job = await manager.requestCancel(req.params.id);
    if (!job) throw new HttpError(404, 'Execução não encontrada.');
    res.status(202).json({ job });
  }),
);

catalogUpdateRouter.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await manager.get(req.params.id);
    if (!job) throw new HttpError(404, 'Execução não encontrada.');
    res.json({ job: toJobSummary(job) });
  }),
);

catalogUpdateRouter.get(
  '/jobs/:id/rows',
  asyncHandler(async (req, res) => {
    const query = parse(catalogRowsQuerySchema, req.query);
    res.json(await getJobRows(manager, req.params.id, query));
  }),
);

catalogUpdateRouter.get(
  '/reports/:kind',
  asyncHandler(async (req, res) => {
    const { kind } = parse(catalogReportParamsSchema, req.params);
    const report = await buildReportMarkdown(prisma, kind === 'livros-sem-isbn' ? 'missing' : 'invalid');
    const download = booleanQuery.parse(req.query.download);

    if (download) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
      res.send(report.markdown);
      return;
    }

    res.json({
      filename: report.filename,
      title: report.title,
      total: report.total,
      generatedAt: new Date().toISOString(),
      markdown: report.markdown,
    });
  }),
);