import type { CatalogUpdateRow } from '@library/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma';
import { writeAudit } from '../audit';
import { detectConflict, toUpdateData, type BookSnapshot } from './mapper';
import { parseProcessStatus, toBookSnapshot } from './analysis';
import type { CatalogUpdateJobManager } from './jobs';

export interface ApplyRowProgress {
  processed: number;
  updated: number;
  unchanged: number;
  notFound: number;
  conflicts: number;
  errors: number;
}

export interface ApplySimulationRowsResult extends ApplyRowProgress {
  total: number;
  stopped: boolean;
}

export interface ApplySimulationRowsOptions {
  prisma: PrismaClient;
  manager: CatalogUpdateJobManager;
  jobId: string;
  rows: CatalogUpdateRow[];
  userId: number | null;
  shouldStop?: () => Promise<boolean>;
  /** true no job de aplicação; false quando as linhas já estão no job ativo. */
  appendRows?: boolean;
  onProgress?: (stats: ApplyRowProgress) => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Erro inesperado';
}

function isCompletedStatus(status: string | null): boolean {
  const parsed = parseProcessStatus(status);
  return parsed === 'UPDATED' || parsed === 'UNCHANGED';
}

/** Resolve autores por nome (case-insensitive) sem duplicar registros. */
class AuthorResolver {
  private readonly cache = new Map<string, number>();

  async load(prisma: PrismaClient): Promise<void> {
    const authors = await prisma.author.findMany({ select: { id: true, name: true } });
    for (const author of authors) {
      this.cache.set(author.name.toLowerCase(), author.id);
    }
  }

  async resolve(prisma: PrismaClient, names: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const raw of names) {
      const name = raw.trim().slice(0, 120);
      if (!name) continue;
      const key = name.toLowerCase();
      let id = this.cache.get(key);
      if (!id) {
        const created = await prisma.author.create({ data: { name } });
        id = created.id;
        this.cache.set(key, id);
        await writeAudit(null, 'AUTHOR_CREATED', 'Author', id, { name }, undefined, prisma);
      }
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }
}

/**
 * Aplica/registra os resultados de uma simulação. Usado pelo job de aplicação
 * e também quando o usuário para uma simulação (aplica os resultados parciais).
 */
export async function applySimulationRows(
  options: ApplySimulationRowsOptions,
): Promise<ApplySimulationRowsResult> {
  const { prisma, manager, jobId, userId } = options;
  const base = options.rows.filter(
    (row) =>
      row.queryStatus === 'FOUND' ||
      row.queryStatus === 'NOT_FOUND' ||
      row.queryStatus === 'ERROR',
  );
  const candidates = options.appendRows
    ? base.map<CatalogUpdateRow>((row) => ({ ...row, applyStatus: undefined, applyError: null }))
    : base;

  const stats: ApplyRowProgress = {
    processed: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    conflicts: 0,
    errors: 0,
  };
  let stopped = false;
  let lastSave = Date.now();

  const authorResolver = new AuthorResolver();
  await authorResolver.load(prisma);

  const baseStatusData = (status: string, message: string | null, fields: string[] | null) => ({
    catalogUpdateStatus: status,
    catalogUpdatedAt: new Date(),
    catalogUpdateSource: 'ISBNDB',
    catalogUpdateMessage: message,
    catalogUpdateFields: fields ? JSON.stringify(fields) : null,
    catalogUpdateJobId: jobId,
  });

  const commit = async (row: CatalogUpdateRow): Promise<void> => {
    if (options.appendRows) await manager.appendRows(jobId, [row]);
    stats.processed += 1;
  };

  for (const row of candidates) {
    if (options.shouldStop && (await options.shouldStop())) {
      stopped = true;
      break;
    }

    const book = await prisma.book.findUnique({
      where: { id: row.bookId },
      include: { authors: { include: { author: { select: { name: true } } } } },
    });

    if (!book) {
      row.applyStatus = 'ERROR';
      row.applyError = 'Livro não encontrado (pode ter sido excluído).';
      stats.errors += 1;
      await commit(row);
      continue;
    }

    const previouslyCompleted = isCompletedStatus(book.catalogUpdateStatus);

    if (row.queryStatus === 'NOT_FOUND') {
      row.applyStatus = 'NOT_FOUND';
      stats.notFound += 1;
      if (!previouslyCompleted) {
        try {
          await prisma.book.update({
            where: { id: book.id },
            data: baseStatusData('NOT_FOUND', row.queryError ?? 'Não encontrado na ISBNdb.', null),
          });
        } catch (err) {
          row.applyStatus = 'ERROR';
          row.applyError = errorMessage(err);
          stats.errors += 1;
          stats.notFound -= 1;
        }
      }
      await commit(row);
      continue;
    }

    if (row.queryStatus === 'ERROR') {
      row.applyStatus = 'ERROR';
      row.applyError = row.queryError ?? 'Falha na consulta à ISBNdb.';
      stats.errors += 1;
      if (!previouslyCompleted) {
        try {
          await prisma.book.update({
            where: { id: book.id },
            data: baseStatusData('ERROR', row.queryError ?? 'Falha na consulta à ISBNdb.', null),
          });
        } catch {
          // Mantém o erro do job; o estado anterior permanece.
        }
      }
      await commit(row);
      continue;
    }

    const snapshot: BookSnapshot = toBookSnapshot(book);
    const conflict = detectConflict(snapshot, row);
    if (conflict) {
      row.applyStatus = 'CONFLICT';
      row.applyError = conflict;
      stats.conflicts += 1;
      await commit(row);
      continue;
    }

    const data = toUpdateData(row.changes ?? []);
    const hasBookUpdate = Object.keys(data).length > 0;
    const authorIds = row.authorChanges
      ? await authorResolver.resolve(prisma, row.authorChanges.next)
      : null;

    if (!hasBookUpdate && !authorIds) {
      row.applyStatus = 'UNCHANGED';
      stats.unchanged += 1;
      if (!previouslyCompleted) {
        try {
          await prisma.book.update({
            where: { id: book.id },
            data: baseStatusData('UNCHANGED', null, null),
          });
        } catch (err) {
          row.applyStatus = 'ERROR';
          row.applyError = errorMessage(err);
          stats.errors += 1;
          stats.unchanged -= 1;
        }
      }
      await commit(row);
      continue;
    }

    try {
      const fields = (row.changes ?? []).map((change) => change.field);
      if (row.authorChanges) fields.push('authors');

      const operations: Prisma.PrismaPromise<unknown>[] = [
        prisma.book.update({
          where: { id: book.id },
          data: {
            ...data,
            ...baseStatusData('UPDATED', null, fields),
          },
        }),
      ];
      if (authorIds) {
        operations.push(prisma.bookAuthor.deleteMany({ where: { bookId: book.id } }));
        if (authorIds.length > 0) {
          operations.push(
            prisma.bookAuthor.createMany({
              data: authorIds.map((authorId) => ({ bookId: book.id, authorId })),
            }),
          );
        }
      }
      await prisma.$transaction(operations);

      row.applyStatus = 'UPDATED';
      stats.updated += 1;
      await writeAudit(
        userId,
        'CATALOG_UPDATE_APPLIED',
        'Book',
        book.id,
        { jobId, fields, authorsChanged: Boolean(row.authorChanges) },
        undefined,
        prisma,
      );
    } catch (err) {
      row.applyStatus = 'ERROR';
      row.applyError = errorMessage(err);
      stats.errors += 1;
    }

    await commit(row);

    const now = Date.now();
    if (
      options.onProgress &&
      (stats.processed % 10 === 0 || now - lastSave > 5000)
    ) {
      await options.onProgress({ ...stats });
      lastSave = now;
    }
  }

  return { ...stats, total: candidates.length, stopped };
}