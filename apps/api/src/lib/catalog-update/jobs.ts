import type { CatalogUpdateJobSummary, CatalogUpdateRow } from '@library/shared';
import { HttpError } from '../http-error';
import {
  toJobSummary,
  type CatalogUpdateJobRecord,
  type CatalogUpdateJobStore,
} from './store';

const STALE_JOB_MS = 2 * 60 * 60 * 1000;

function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Mantém o job em memória (progresso ao vivo) e persiste metadados/resultado
 * no store injetado (filesystem no Express, R2 no Worker).
 */
export class CatalogUpdateJobManager {
  private active: CatalogUpdateJobRecord | null = null;

  constructor(private readonly store: CatalogUpdateJobStore) {}

  async start(
    input: Omit<
      CatalogUpdateJobRecord,
      | 'id'
      | 'rows'
      | 'startedAt'
      | 'finishedAt'
      | 'processed'
      | 'found'
      | 'notFound'
      | 'skipped'
      | 'errors'
      | 'changedBooks'
      | 'updated'
      | 'unchanged'
      | 'conflicts'
      | 'apiCalls'
      | 'message'
    >,
  ): Promise<CatalogUpdateJobRecord> {
    const active = await this.store.getActive();
    if (active) {
      const existing = await this.store.load(active.id);
      const age = Date.now() - new Date(active.startedAt).getTime();
      if (existing && existing.status === 'RUNNING' && age < STALE_JOB_MS) {
        throw new HttpError(
          409,
          `Já existe uma execução em andamento (${existing.mode === 'SIMULATE' ? 'simulação' : 'atualização'}). Aguarde a conclusão.`,
        );
      }
      await this.store.setActive(null);
    }

    const record: CatalogUpdateJobRecord = {
      ...input,
      id: newId(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      processed: 0,
      found: 0,
      notFound: 0,
      skipped: 0,
      errors: 0,
      changedBooks: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
      apiCalls: 0,
      message: null,
      rows: [],
    };

    this.active = record;
    await this.store.setActive(record.id);
    await this.store.save({ ...record, rows: [] });
    return record;
  }

  async get(id: string): Promise<CatalogUpdateJobRecord | null> {
    if (this.active?.id === id) return this.active;
    return this.store.load(id);
  }

  getSummary(id: string): CatalogUpdateJobSummary | null {
    if (this.active?.id !== id) return null;
    return toJobSummary(this.active);
  }

  getActiveSummary(): CatalogUpdateJobSummary | null {
    return this.active ? toJobSummary(this.active) : null;
  }

  /** Marca a execução para parar após o lote/registro atual. */
  async requestCancel(id: string): Promise<CatalogUpdateJobSummary | null> {
    const record = this.active?.id === id ? this.active : await this.store.load(id);
    if (!record) return null;
    if (record.status !== 'RUNNING') return toJobSummary(record);
    record.cancelRequested = true;
    if (this.active?.id === id) this.active = record;
    await this.store.save({ ...record, rows: [] });
    return toJobSummary(record);
  }

  async isCancelRequested(id: string): Promise<boolean> {
    if (this.active?.id === id) return Boolean(this.active.cancelRequested);
    const record = await this.store.load(id);
    return Boolean(record?.cancelRequested);
  }

  /** Linhas coletadas até agora (memória quando ativo; store ao retomar). */
  async getRows(id: string): Promise<CatalogUpdateRow[]> {
    if (this.active?.id === id) return this.active.rows;
    const record = await this.store.load(id);
    return record?.rows ?? [];
  }

  private requireActive(id: string): CatalogUpdateJobRecord {
    if (!this.active || this.active.id !== id) {
      throw new Error(`Job ${id} não está ativo neste processo.`);
    }
    return this.active;
  }

  /** Atualiza o estado em memória e persiste apenas metadados (sem as linhas). */
  async saveProgress(
    id: string,
    patch: Partial<CatalogUpdateJobRecord>,
  ): Promise<CatalogUpdateJobSummary> {
    const record = this.requireActive(id);
    Object.assign(record, patch);
    await this.store.save({ ...record, rows: [] });
    return toJobSummary(record);
  }

  async appendRows(id: string, rows: CatalogUpdateJobRecord['rows']): Promise<void> {
    const record = this.requireActive(id);
    record.rows.push(...rows);
  }

  async finish(
    id: string,
    patch: Partial<CatalogUpdateJobRecord> & Pick<CatalogUpdateJobRecord, 'status'>,
  ): Promise<CatalogUpdateJobRecord> {
    const record = this.requireActive(id);
    Object.assign(record, patch, { finishedAt: new Date().toISOString() });
    await this.store.save(record);
    await this.store.setActive(null);
    this.active = null;
    return record;
  }
}