import type {
  CatalogUpdateAnalysis,
  CatalogUpdateJobSummary,
  CatalogUpdateRow,
} from '@library/shared';
import type { PrismaClient } from '../../generated/prisma';
import { HttpError } from '../http-error';
import {
  bothReportsRows,
  computeCounts,
  filterRows,
  isCompletedProcessStatus,
  loadCatalogBooks,
  paginate,
  toAnalysisRow,
  type CatalogListQuery,
  type CatalogUpdatePage,
} from './analysis';
import type { CatalogUpdateJobManager } from './jobs';
import { selectBookIsbn } from './isbn';
import { buildInvalidIsbnReport, buildMissingIsbnReport } from './reports';
import { toJobSummary, type CatalogUpdateJobRecord } from './store';

export const DEFAULT_DELAY_MS = 1100;
export const MAX_DELAY_MS = 60_000;

export function delayFromEnv(value: string | undefined): number {
  if (!value) return DEFAULT_DELAY_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DELAY_MS;
  return Math.min(parsed, MAX_DELAY_MS);
}

export async function analyzeCatalog(
  prisma: PrismaClient,
  apiConfigured: boolean,
): Promise<CatalogUpdateAnalysis> {
  const books = await loadCatalogBooks(prisma);
  const rows = books.map(toAnalysisRow);
  return {
    generatedAt: new Date().toISOString(),
    counts: computeCounts(rows),
    apiConfigured,
  };
}

export async function listAnalysisRows(
  prisma: PrismaClient,
  query: CatalogListQuery,
): Promise<CatalogUpdatePage<CatalogUpdateRow>> {
  const books = await loadCatalogBooks(prisma);
  const rows = books.map(toAnalysisRow);
  const filtered = filterRows(rows, query);
  if (query.state?.trim().toUpperCase() === 'UPDATED') {
    filtered.sort((a, b) =>
      (b.catalogUpdatedAt ?? '').localeCompare(a.catalogUpdatedAt ?? ''),
    );
  }
  return paginate(filtered, query.page, query.pageSize);
}

export interface StartSimulationInput {
  manager: CatalogUpdateJobManager;
  prisma: PrismaClient;
  apiKey: string | null;
  delayMs: number;
  userId: number | null;
  limit?: number | null;
  bookIds?: number[];
}

export interface StartSimulationResult {
  job: CatalogUpdateJobSummary;
  bookIds: number[];
}

export async function startSimulation(
  input: StartSimulationInput,
): Promise<StartSimulationResult> {
  if (!input.apiKey?.trim()) {
    throw new HttpError(
      503,
      'ISBNDB_API_KEY não configurada. Defina a variável de ambiente para consultar a ISBNdb.',
    );
  }

  const books = await input.prisma.book.findMany({
    select: { id: true, isbn10: true, isbn13: true, catalogUpdateStatus: true },
  });
  const manual = Boolean(input.bookIds?.length);
  const wanted = manual ? new Set(input.bookIds) : null;
  let ids = books
    .filter((book) => (wanted ? wanted.has(book.id) : true))
    .filter((book) => selectBookIsbn(book).status === 'VALID_ISBN')
    // Por padrão processa apenas pendentes: livros já concluídos só entram
    // quando o usuário pede reprocessamento explícito por `bookIds`.
    .filter((book) =>
      manual
        ? true
        : !isCompletedProcessStatus(book.catalogUpdateStatus),
    )
    .map((book) => book.id);

  const limit =
    input.limit === null || input.limit === undefined
      ? null
      : Math.min(Math.max(Math.trunc(input.limit), 1), 10_000);
  if (limit) ids = ids.slice(0, limit);

  if (ids.length === 0) {
    throw new HttpError(
      400,
      manual
        ? 'Nenhum livro com ISBN válido foi encontrado para os critérios informados.'
        : 'Nenhum livro pendente com ISBN válido. Livros já concluídos só são reprocessados por ação explícita.',
    );
  }

  const record = await input.manager.start({
    mode: 'SIMULATE',
    status: 'RUNNING',
    userId: input.userId,
    simulationId: null,
    total: ids.length,
    delayMs: input.delayMs,
    limit,
  });

  return { job: toJobSummary(record), bookIds: ids };
}

export interface StartApplyInput {
  manager: CatalogUpdateJobManager;
  prisma: PrismaClient;
  simulationId: string;
  userId: number | null;
  confirm: boolean;
}

export interface StartApplyResult {
  job: CatalogUpdateJobSummary;
  simulation: CatalogUpdateJobRecord;
}

export async function startApply(input: StartApplyInput): Promise<StartApplyResult> {
  if (!input.confirm) {
    throw new HttpError(400, 'Confirmação explícita obrigatória para aplicar as alterações.');
  }
  const simulation = await input.manager.get(input.simulationId);
  if (!simulation) throw new HttpError(404, 'Simulação não encontrada.');
  if (simulation.mode !== 'SIMULATE') {
    throw new HttpError(400, 'O identificador informado não é de uma simulação.');
  }
  if (simulation.status !== 'COMPLETED') {
    throw new HttpError(409, 'A simulação ainda não foi concluída.');
  }

  const candidates = simulation.rows.filter((row) =>
    row.queryStatus === 'FOUND' ||
    row.queryStatus === 'NOT_FOUND' ||
    row.queryStatus === 'ERROR',
  );
  if (candidates.length === 0) {
    throw new HttpError(400, 'A simulação não contém resultados para registrar.');
  }

  const record = await input.manager.start({
    mode: 'APPLY',
    status: 'RUNNING',
    userId: input.userId,
    simulationId: simulation.id,
    total: candidates.length,
    delayMs: 0,
    limit: null,
  });

  return { job: toJobSummary(record), simulation };
}

export async function getJobRows(
  manager: CatalogUpdateJobManager,
  id: string,
  query: CatalogListQuery & { result?: string | null; onlyChanges?: boolean },
): Promise<CatalogUpdatePage<CatalogUpdateRow>> {
  const job = await manager.get(id);
  if (!job) throw new HttpError(404, 'Execução não encontrada.');

  const status = (query.result ?? query.status ?? '').trim().toUpperCase();
  const search = query.search?.trim().toLowerCase() ?? '';
  const rows = job.rows.filter((row) => {
    if (status && status !== 'ALL') {
      const matches =
        row.status === status ||
        row.queryStatus === status ||
        row.applyStatus === status;
      if (!matches) return false;
    }
    if (query.onlyChanges) {
      const hasChanges =
        (row.changes?.length ?? 0) > 0 || Boolean(row.authorChanges);
      if (!hasChanges) return false;
    }
    if (!search) return true;
    const haystack = [row.title, row.isbn10, row.isbn13, row.isbnUsed, ...row.authors]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });

  return paginate(rows, query.page, query.pageSize);
}

export async function buildReportMarkdown(
  prisma: PrismaClient,
  kind: 'missing' | 'invalid',
  generatedAt: Date = new Date(),
): Promise<{ markdown: string; total: number; filename: string; title: string }> {
  const books = await loadCatalogBooks(prisma);
  const rows = books.map(toAnalysisRow);
  const { missing, invalid } = bothReportsRows(rows);
  if (kind === 'missing') {
    return {
      markdown: buildMissingIsbnReport(missing, generatedAt),
      total: missing.length,
      filename: 'livros-sem-isbn.md',
      title: 'Livros sem ISBN',
    };
  }
  return {
    markdown: buildInvalidIsbnReport(invalid, generatedAt),
    total: invalid.length,
    filename: 'isbns-invalidos.md',
    title: 'Livros com ISBN inválido',
  };
}