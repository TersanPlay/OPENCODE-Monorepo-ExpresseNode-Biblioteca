import { Hono } from 'hono';
import { HttpError } from '../../lib/http-error';
import { requireAuth, requireRoles } from '../auth';
import { prismaOf } from '../db';
import { reqJson } from '../http';
import { isbndbApiKey, isbndbBulkSize, isbndbDelayMs } from '../env';
import { parse } from '../../validation';
import {
  booleanQuery,
  catalogApplySchema,
  catalogReportParamsSchema,
  catalogRowsQuerySchema,
  catalogSimulateSchema,
} from '../../lib/catalog-update/schemas';
import { CatalogUpdateJobManager } from '../../lib/catalog-update/jobs';
import { R2CatalogUpdateJobStore } from '../../lib/catalog-update/store-r2';
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
import type { AppContext, AppEnv } from '../context';

export const catalogUpdateApp = new Hono<AppEnv>();

catalogUpdateApp.use(requireAuth, requireRoles('ADMIN'));

function managerOf(c: AppContext): CatalogUpdateJobManager {
  return new CatalogUpdateJobManager(new R2CatalogUpdateJobStore(c.env.BACKUPS));
}

catalogUpdateApp.get('/analysis', async (c) => {
  const prisma = prismaOf(c);
  return c.json(await analyzeCatalog(prisma, Boolean(isbndbApiKey(c.env))));
});

catalogUpdateApp.get('/books', async (c) => {
  const prisma = prismaOf(c);
  const query = parse(catalogRowsQuerySchema, c.req.query());
  return c.json(await listAnalysisRows(prisma, query));
});

catalogUpdateApp.post('/simulate', async (c) => {
  const prisma = prismaOf(c);
  const manager = managerOf(c);
  const data = parse(catalogSimulateSchema, await reqJson(c));
  const apiKey = isbndbApiKey(c.env);
  const delayMs = data.delayMs ?? delayFromEnv(isbndbDelayMs(c.env));
  const parsedBulk = Number(isbndbBulkSize(c.env) ?? '');
  const bulkSize = Number.isFinite(parsedBulk) && parsedBulk > 0 ? parsedBulk : undefined;
  const user = c.get('user');

  const { job, bookIds } = await startSimulation({
    manager,
    prisma,
    apiKey,
    delayMs,
    userId: user?.id ?? null,
    limit: data.limit ?? null,
    bookIds: data.bookIds,
  });

  c.executionCtx.waitUntil(
    runSimulationJob({
      manager,
      prisma,
      jobId: job.id,
      apiKey: apiKey as string,
      delayMs,
userId: user?.id ?? null,
      bookIds,
      bulkSize,
    }).catch((err) => console.error('[catalog-update] falha na simulação:', err)),
  );

  return c.json({ job }, 202);
});

catalogUpdateApp.post('/apply', async (c) => {
  const prisma = prismaOf(c);
  const manager = managerOf(c);
  const data = parse(catalogApplySchema, await reqJson(c));
  const user = c.get('user');

  const { job, simulation } = await startApply({
    manager,
    prisma,
    simulationId: data.simulationId,
    userId: user?.id ?? null,
    confirm: data.confirm,
  });

  c.executionCtx.waitUntil(
    runApplyJob({
      manager,
      prisma,
      jobId: job.id,
      simulation,
      userId: user?.id ?? null,
    }).catch((err) => console.error('[catalog-update] falha na aplicação:', err)),
  );

  return c.json({ job }, 202);
});

catalogUpdateApp.post('/jobs/:id/stop', async (c) => {
  const manager = managerOf(c);
  const job = await manager.requestCancel(c.req.param('id'));
  if (!job) throw new HttpError(404, 'Execução não encontrada.');
  return c.json({ job }, 202);
});

catalogUpdateApp.get('/jobs/:id', async (c) => {
  const manager = managerOf(c);
  const job = await manager.get(c.req.param('id'));
  if (!job) throw new HttpError(404, 'Execução não encontrada.');
  return c.json({ job: toJobSummary(job) });
});

catalogUpdateApp.get('/jobs/:id/rows', async (c) => {
  const manager = managerOf(c);
  const query = parse(catalogRowsQuerySchema, c.req.query());
  return c.json(await getJobRows(manager, c.req.param('id'), query));
});

catalogUpdateApp.get('/reports/:kind', async (c) => {
  const prisma = prismaOf(c);
  const { kind } = parse(catalogReportParamsSchema, c.req.param());
  const report = await buildReportMarkdown(
    prisma,
    kind === 'livros-sem-isbn' ? 'missing' : 'invalid',
  );
  const download = booleanQuery.parse(c.req.query('download'));

  if (download) {
    return new Response(report.markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${report.filename}"`,
      },
    });
  }

  return c.json({
    filename: report.filename,
    title: report.title,
    total: report.total,
    generatedAt: new Date().toISOString(),
    markdown: report.markdown,
  });
});