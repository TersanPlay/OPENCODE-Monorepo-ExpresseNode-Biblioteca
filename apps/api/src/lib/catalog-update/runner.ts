export { runSimulationJob } from './simulation';

import { writeAudit } from '../audit';
import type { PrismaClient } from '../../generated/prisma';
import type { CatalogUpdateJobManager } from './jobs';
import type { CatalogUpdateJobRecord } from './store';
import { applySimulationRows } from './apply-core';

export interface ApplyDeps {
  manager: CatalogUpdateJobManager;
  prisma: PrismaClient;
  jobId: string;
  simulation: CatalogUpdateJobRecord;
  userId: number | null;
}

export async function runApplyJob(deps: ApplyDeps): Promise<void> {
  const { manager, prisma, jobId, simulation, userId } = deps;

  try {
    const result = await applySimulationRows({
      prisma,
      manager,
      jobId,
      rows: simulation.rows,
      userId,
      appendRows: true,
      shouldStop: () => manager.isCancelRequested(jobId),
      onProgress: async (stats) => {
        await manager.saveProgress(jobId, { ...stats });
      },
    });

    const finished = await manager.finish(jobId, {
      status: 'COMPLETED',
      processed: result.processed,
      updated: result.updated,
      unchanged: result.unchanged,
      notFound: result.notFound,
      conflicts: result.conflicts,
      errors: result.errors,
      changedBooks: result.updated,
      skipped: Math.max(0, result.total - result.processed),
      applied: true,
      phase: 'APPLY',
      cancelRequested: result.stopped,
      message: result.stopped
        ? `Processo interrompido: ${result.processed} de ${result.total} registros. ${result.updated} atualizados, ${result.unchanged} sem alterações, ${result.notFound} não encontrados, ${result.conflicts} conflitos, ${result.errors} erros.`
        : `Atualização concluída: ${result.updated} atualizados, ${result.unchanged} sem alterações, ${result.notFound} não encontrados, ${result.conflicts} conflitos, ${result.errors} erros.`,
    });

    await writeAudit(
      userId,
      'CATALOG_UPDATE_APPLIED',
      'CatalogUpdateJob',
      jobId,
      {
        simulationId: simulation.id,
        processed: finished.processed,
        updated: finished.updated,
        unchanged: finished.unchanged,
        notFound: finished.notFound,
        conflicts: finished.conflicts,
        errors: finished.errors,
        stopped: result.stopped,
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