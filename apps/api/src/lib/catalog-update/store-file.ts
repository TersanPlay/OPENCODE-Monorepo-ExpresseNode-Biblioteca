import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CatalogUpdateJobRecord, CatalogUpdateJobStore } from './store';

/**
 * Store de jobs em filesystem (Express/dev). Grava JSON atômico por job e um
 * ponteiro `active.json` para impedir execuções simultâneas.
 */
export class FileCatalogUpdateJobStore implements CatalogUpdateJobStore {
  constructor(private readonly directory: string) {}

  private jobPath(id: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Identificador de job inválido');
    return path.join(this.directory, `${id}.json`);
  }

  private activePath(): string {
    return path.join(this.directory, 'active.json');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await this.ensureDir();
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data), 'utf8');
    await fs.rename(temporary, file);
  }

  async save(record: CatalogUpdateJobRecord): Promise<void> {
    await this.writeJson(this.jobPath(record.id), record);
  }

  async load(id: string): Promise<CatalogUpdateJobRecord | null> {
    try {
      const raw = await fs.readFile(this.jobPath(id), 'utf8');
      return JSON.parse(raw) as CatalogUpdateJobRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async getActive(): Promise<{ id: string; startedAt: string } | null> {
    try {
      const raw = await fs.readFile(this.activePath(), 'utf8');
      return JSON.parse(raw) as { id: string; startedAt: string };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async setActive(id: string | null): Promise<void> {
    await this.ensureDir();
    if (id === null) {
      await fs.rm(this.activePath(), { force: true });
      return;
    }
    await this.writeJson(this.activePath(), { id, startedAt: new Date().toISOString() });
  }
}