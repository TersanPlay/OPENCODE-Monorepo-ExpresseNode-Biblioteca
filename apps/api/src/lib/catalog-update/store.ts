import type { CatalogUpdateJobSummary, CatalogUpdateRow } from '@library/shared';

export interface CatalogUpdateJobRecord extends CatalogUpdateJobSummary {
  rows: CatalogUpdateRow[];
}

export interface CatalogUpdateJobStore {
  save(record: CatalogUpdateJobRecord): Promise<void>;
  load(id: string): Promise<CatalogUpdateJobRecord | null>;
  getActive(): Promise<{ id: string; startedAt: string } | null>;
  setActive(id: string | null): Promise<void>;
}

export function toJobSummary(record: CatalogUpdateJobRecord): CatalogUpdateJobSummary {
  const { rows: _rows, ...summary } = record;
  return summary;
}