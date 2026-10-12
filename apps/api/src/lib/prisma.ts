import 'dotenv/config';
import { PrismaClient } from '../generated/prisma';
import { PrismaD1 } from '@prisma/adapter-d1';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * No Worker (D1), o binding é injetado via env (ver src/worker.ts).
 * Fora dele (Express local), usa o SQLite em arquivo via DATABASE_URL.
 */
export function createPrisma(db?: D1Database) {
  if (db) return new PrismaClient({ adapter: new PrismaD1(db) });
  return new PrismaClient();
}

function isWorkersRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

// No Worker, `new PrismaClient()` sem adapter estoura no import — lá o client
// é criado por requisição com o binding D1 (ver worker/db.ts).
let shared: PrismaClient | null = null;
if (!isWorkersRuntime()) {
  shared = createPrisma();
}
const prisma = shared as PrismaClient;
export default prisma;