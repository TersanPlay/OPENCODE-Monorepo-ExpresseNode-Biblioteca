import type { CatalogUpdateRow } from '@library/shared';
import type { PrismaClient } from '../../generated/prisma';
import { writeAudit } from '../audit';
import { isbnEquivalent, isbnVariants, selectBookIsbn, type IsbnSelection } from './isbn';
import {
  fetchIsbndbAccount,
  lookupIsbndbBook,
  lookupIsbndbBooksBulk,
  type IsbndbBook,
  type IsbndbLookupResult,
} from './isbndb-client';
import type { CatalogUpdateJobManager } from './jobs';
import { applySimulationRows } from './apply-core';
import { buildBookProposal, type BookSnapshot } from './mapper';
import { loadCatalogBooks, toBookSnapshot } from './analysis';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function bulkSizeForPlan(planName: string | null): number {
  const name = (planName ?? '').toLowerCase();
  if (name.includes('academic')) return 10;
  if (name.includes('basic')) return 100;
  if (name.includes('pro') || name.includes('premium')) return 1000;
  return 100;
}

type CatalogBook = Awaited<ReturnType<typeof loadCatalogBooks>>[number];

interface PlannedBook {
  book: CatalogBook;
  snapshot: BookSnapshot;
  selection: IsbnSelection;
}

export interface SimulationDeps {
  manager: CatalogUpdateJobManager;
  prisma: PrismaClient;
  jobId: string;
  apiKey: string;
  delayMs: number;
  userId: number | null;
  bookIds?: number[];
  limit?: number | null;
  bulkSize?: number;
}

export async function runSimulationJob(deps: SimulationDeps): Promise<void> {
  const { manager, prisma, jobId, apiKey, delayMs, userId } = deps;

  try {
    const books = await loadCatalogBooks(prisma);
    const wanted = deps.bookIds?.length ? new Set(deps.bookIds) : null;
    let candidates = books.filter((book) => {
      if (wanted && !wanted.has(book.id)) return false;
      return selectBookIsbn(book).status === 'VALID_ISBN';
    });
    if (deps.limit && deps.limit > 0) candidates = candidates.slice(0, deps.limit);

    const requestedTotal = candidates.length;
    let bulkSize = deps.bulkSize && deps.bulkSize > 0 ? Math.min(deps.bulkSize, 1000) : 100;
    let planName: string | null = null;
    let quotaRemaining: number | null = null;
    let rateWaitSeconds = 0;
    let quotaNotice: string | null = null;

    const account = await fetchIsbndbAccount({ apiKey });
    if (account) {
      planName = account.planName;
      rateWaitSeconds = account.waitSeconds;
      if (!deps.bulkSize) bulkSize = bulkSizeForPlan(account.planName);
      quotaRemaining = account.dailyLeft;
      await manager.saveProgress(jobId, { planName, bulkSize, quotaRemaining });

      if (quotaRemaining !== null && quotaRemaining <= 0) {
        await manager.finish(jobId, {
          status: 'FAILED',
          skipped: requestedTotal,
          planName,
          bulkSize,
          quotaRemaining,
          message: 'Cota diária da ISBNdb esgotada (0 restantes). Tente novamente após 00:00 UTC.',
        });
        return;
      }
      if (quotaRemaining !== null && candidates.length > quotaRemaining) {
        candidates = candidates.slice(0, quotaRemaining);
        quotaNotice = `Cota diária restante (${quotaRemaining}) limitou o processamento; ${requestedTotal - quotaRemaining} livro(s) seguem pendentes.`;
      }
    }

    const planned: PlannedBook[] = candidates.map((book) => ({
      book,
      snapshot: toBookSnapshot(book),
      selection: selectBookIsbn(book),
    }));

    const stats = {
      processed: 0,
      found: 0,
      notFound: 0,
      errors: 0,
      changedBooks: 0,
      apiCalls: 0,
      httpRequests: 0,
    };
    let fatalMessage: string | null = null;
    let cancelled = false;

    const makeRow = (entry: PlannedBook): CatalogUpdateRow => ({
      bookId: entry.book.id,
      title: entry.book.title,
      authors: entry.snapshot.authors,
      publisher: entry.book.publisher,
      publicationYear: entry.book.publicationYear,
      isbn10: entry.book.isbn10,
      isbn13: entry.book.isbn13,
      isbnUsed: entry.selection.isbnUsed,
      status: entry.selection.status,
      reason: entry.selection.reason,
      bookUpdatedAt:
        entry.snapshot.updatedAt instanceof Date
          ? entry.snapshot.updatedAt.toISOString()
          : new Date(entry.snapshot.updatedAt).toISOString(),
      queryStatus: 'PENDING',
      queryError: null,
      changes: [],
      authorChanges: null,
    });

    const commit = async (row: CatalogUpdateRow): Promise<void> => {
      await manager.appendRows(jobId, [row]);
      stats.processed += 1;
    };

    const applyProposal = (row: CatalogUpdateRow, entry: PlannedBook, apiBook: IsbndbBook): void => {
      const apiIsbn = apiBook.isbn13 ?? apiBook.isbn10 ?? null;
      if (!isbnEquivalent(entry.selection.isbnUsed, apiIsbn)) {
        row.queryStatus = 'ERROR';
        row.queryError = `ISBN retornado pela ISBNdb (${apiIsbn ?? 'ausente'}) não corresponde ao ISBN consultado (${entry.selection.isbnUsed}).`;
        stats.errors += 1;
        return;
      }
      const proposal = buildBookProposal(entry.snapshot, apiBook);
      row.queryStatus = 'FOUND';
      row.changes = proposal.changes;
      row.authorChanges = proposal.authorChanges;
      if (proposal.changes.length > 0 || proposal.authorChanges) stats.changedBooks += 1;
      stats.found += 1;
    };

    const handleLookup = async (
      entry: PlannedBook,
      lookup: IsbndbLookupResult,
    ): Promise<boolean> => {
      const row = makeRow(entry);
      if (lookup.kind === 'not_found') {
        row.queryStatus = 'NOT_FOUND';
        stats.notFound += 1;
      } else if (lookup.kind === 'error') {
        row.queryStatus = 'ERROR';
        row.queryError = lookup.message;
        stats.errors += 1;
        await commit(row);
        return lookup.fatal;
      } else {
        applyProposal(row, entry, lookup.book);
      }
      await commit(row);
      return false;
    };

    const pace = async (): Promise<void> => {
      if (stats.httpRequests === 0) return;
      await sleep(Math.max(delayMs, rateWaitSeconds * 1000));
    };

    const chargeQuota = (count: number): void => {
      stats.apiCalls += count;
      if (quotaRemaining !== null) quotaRemaining = Math.max(0, quotaRemaining - count);
    };

for (let offset = 0; offset < planned.length; offset += bulkSize) {
      if (await manager.isCancelRequested(jobId)) {
        cancelled = true;
        break;
      }
      const batch = planned.slice(offset, offset + bulkSize);
      const isbns = [
        ...new Set(
          batch
            .map((entry) => entry.selection.isbnUsed)
            .filter((value): value is string => Boolean(value)),
        ),
      ];

      if (bulkSize <= 1 || isbns.length <= 1) {
        for (const entry of batch) {
          await pace();
          const lookup = await lookupIsbndbBook(entry.selection.isbnUsed as string, { apiKey });
          stats.httpRequests += 1;
          chargeQuota(1);
          const fatal = await handleLookup(entry, lookup);
          if (fatal) {
            fatalMessage = lookup.kind === 'error' ? lookup.message : 'Falha na consulta.';
            break;
          }
        }
      } else {
        await pace();
        const bulk = await lookupIsbndbBooksBulk(isbns, { apiKey });
        stats.httpRequests += 1;
        rateWaitSeconds = bulk.waitSeconds;

        if (bulk.kind === 'ok') {
          chargeQuota(bulk.requested);
          const byVariant = new Map<string, IsbndbBook>();
          for (const apiBook of bulk.books) {
            for (const variant of [
              ...isbnVariants(apiBook.isbn13 ?? null),
              ...isbnVariants(apiBook.isbn10 ?? null),
            ]) {
              byVariant.set(variant, apiBook);
            }
          }
          for (const entry of batch) {
            const apiBook =
              isbnVariants(entry.selection.isbnUsed)
                .map((variant) => byVariant.get(variant))
                .find((value): value is IsbndbBook => Boolean(value)) ?? null;
            const row = makeRow(entry);
            if (!apiBook) {
              row.queryStatus = 'NOT_FOUND';
              stats.notFound += 1;
              await commit(row);
            } else {
              applyProposal(row, entry, apiBook);
              await commit(row);
            }
          }
        } else {
// Lote falhou: cai para consultas individuais para isolar o erro.
          for (const entry of batch) {
            if (await manager.isCancelRequested(jobId)) {
              cancelled = true;
              break;
            }
            await pace();
            const lookup = await lookupIsbndbBook(entry.selection.isbnUsed as string, { apiKey });
            stats.httpRequests += 1;
            chargeQuota(1);
            const fatal = await handleLookup(entry, lookup);
            if (fatal) {
              fatalMessage = lookup.kind === 'error' ? lookup.message : 'Falha na consulta.';
              break;
            }
          }
        }
      }

      await manager.saveProgress(jobId, {
        ...stats,
        planName,
        bulkSize,
        quotaRemaining,
      });
if (fatalMessage) break;
      if (cancelled) break;
    }

cancelled = cancelled || (await manager.isCancelRequested(jobId));
    const skipped = Math.max(0, requestedTotal - stats.processed);
    const summary = [
      `${stats.found} encontrados`,
      `${stats.changedBooks} com alterações`,
      `${stats.notFound} não encontrados`,
      `${stats.errors} erros`,
      planName ? `plano ${planName}` : '',
      bulkSize > 1 ? `lotes de ${bulkSize} ISBN` : '',
      quotaNotice ?? '',
    ]
      .filter(Boolean)
      .join(', ');

if (cancelled && !fatalMessage) {
      await manager.saveProgress(jobId, {
        ...stats,
        phase: 'APPLY',
        cancelRequested: true,
        planName,
        bulkSize,
        quotaRemaining,
      });

      const rows = await manager.getRows(jobId);
      const applied = await applySimulationRows({
        prisma,
        manager,
        jobId,
        rows,
        userId,
        appendRows: false,
        onProgress: async (progress) => {
          await manager.saveProgress(jobId, {
            ...progress,
            phase: 'APPLY',
            cancelRequested: true,
          });
        },
      });

      const message =
        stats.processed === 0
          ? 'Processo parado pelo usuário antes de consultar livros. Nenhum resultado para aplicar.'
          : `Processo parado pelo usuário: ${stats.processed} livro(s) consultados. ${applied.updated} atualizados, ${applied.unchanged} sem alterações, ${applied.notFound} não encontrados, ${applied.conflicts} conflitos, ${applied.errors} erros. Livros não consultados permanecem pendentes.`;

      await manager.finish(jobId, {
        status: 'COMPLETED',
        processed: stats.processed,
        found: stats.found,
        notFound: stats.notFound,
        errors: stats.errors,
        changedBooks: stats.changedBooks,
        apiCalls: stats.apiCalls,
        httpRequests: stats.httpRequests,
        updated: applied.updated,
        unchanged: applied.unchanged,
        conflicts: applied.conflicts,
        skipped,
        planName,
        bulkSize,
        quotaRemaining,
        phase: 'APPLY',
        applied: true,
        cancelRequested: true,
        message,
      });
      await writeAudit(
        userId,
        'CATALOG_UPDATE_STOPPED',
        'CatalogUpdateJob',
        jobId,
        {
          processed: stats.processed,
          updated: applied.updated,
          unchanged: applied.unchanged,
          notFound: stats.notFound,
          conflicts: applied.conflicts,
          errors: stats.errors,
        },
        undefined,
        prisma,
      );
      return;
    }

    if (fatalMessage) {
      await manager.finish(jobId, {
        status: 'FAILED',
        ...stats,
        skipped,
        planName,
        bulkSize,
        quotaRemaining,
        message: fatalMessage,
      });
      await writeAudit(
        userId,
        'CATALOG_UPDATE_SIMULATED',
        'CatalogUpdateJob',
        jobId,
        {
          status: 'FAILED',
          processed: stats.processed,
          errors: stats.errors,
          planName,
          bulkSize,
          message: fatalMessage,
        },
        undefined,
        prisma,
      );
      return;
    }

    const finished = await manager.finish(jobId, {
      status: 'COMPLETED',
      ...stats,
      skipped,
      planName,
      bulkSize,
      quotaRemaining,
      message: `Simulação concluída: ${summary}. Nenhum dado foi gravado.`,
    });
    await writeAudit(
      userId,
      'CATALOG_UPDATE_SIMULATED',
      'CatalogUpdateJob',
      jobId,
      {
        processed: finished.processed,
        found: finished.found,
        notFound: finished.notFound,
        errors: finished.errors,
        changedBooks: finished.changedBooks,
        apiCalls: finished.apiCalls,
        httpRequests: stats.httpRequests,
        planName,
        bulkSize,
      },
      undefined,
      prisma,
    );
  } catch (err) {
    await manager
      .finish(jobId, {
        status: 'FAILED',
        message: err instanceof Error ? err.message : 'Erro inesperado',
      })
      .catch(() => undefined);
  }
}