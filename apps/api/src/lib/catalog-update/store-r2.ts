import type { R2Bucket } from '@cloudflare/workers-types';
import type { CatalogUpdateJobRecord, CatalogUpdateJobStore } from './store';

const PREFIX = 'catalog-update';
const ACTIVE_KEY = `${PREFIX}/active.json`;

function jobKey(id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Identificador de job inválido');
  return `${PREFIX}/jobs/${id}.json`;
}

/** Store de jobs no R2 (Worker/D1), reaproveitando o binding BACKUPS. */
export class R2CatalogUpdateJobStore implements CatalogUpdateJobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async save(record: CatalogUpdateJobRecord): Promise<void> {
    await this.bucket.put(jobKey(record.id), JSON.stringify(record), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  async load(id: string): Promise<CatalogUpdateJobRecord | null> {
    const object = await this.bucket.get(jobKey(id));
    if (!object) return null;
    return (await object.json()) as CatalogUpdateJobRecord;
  }

  async getActive(): Promise<{ id: string; startedAt: string } | null> {
    const object = await this.bucket.get(ACTIVE_KEY);
    if (!object) return null;
    try {
      return (await object.json()) as { id: string; startedAt: string };
    } catch {
      return null;
    }
  }

  async setActive(id: string | null): Promise<void> {
    if (id === null) {
      await this.bucket.delete(ACTIVE_KEY);
      return;
    }
    await this.bucket.put(
      ACTIVE_KEY,
      JSON.stringify({ id, startedAt: new Date().toISOString() }),
      { httpMetadata: { contentType: 'application/json' } },
    );
  }
}