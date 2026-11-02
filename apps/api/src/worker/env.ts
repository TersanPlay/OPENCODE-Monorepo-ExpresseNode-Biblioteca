import type { D1Database, R2Bucket, SendEmail } from '@cloudflare/workers-types';

/**
 * Variáveis de ambiente do Worker (bindings + vars/secrets).
 * Interface própria (não estende o Env gerado) para não quebrar a cada
 * `wrangler types` — que deriva as chaves do conteúdo do `.dev.vars`.
 */
export interface WorkerEnv {
  DB: D1Database;
  BACKUPS: R2Bucket;
  /** Binding de Email Sending — opcional: ausente = envio desabilitado. */
  EMAIL?: SendEmail;
  JWT_SECRET: string;
  JWT_EXPIRES?: string;
  READER_JWT_SECRET?: string;
  PASSWORD_PEPPER?: string;
  CORS_ORIGIN?: string;
  FRONTEND_URL?: string;
  MAIL_FROM?: string;
  ISBNDB_API_KEY?: string;
ISBNDB_DELAY_MS?: string;
  ISBNDB_BULK_SIZE?: string;
}

function requiredEnv(env: WorkerEnv, name: 'JWT_SECRET'): string {
  const value = env[name];
  if (!value) throw new Error(`[worker] ${name} ausente — configure como secret`);
  return value;
}

export function jwtSecret(env: WorkerEnv): string {
  return requiredEnv(env, 'JWT_SECRET');
}

export function readerJwtSecret(env: WorkerEnv): string {
  return env.READER_JWT_SECRET?.trim() || `${jwtSecret(env)}#reader`;
}

export function jwtExpires(env: WorkerEnv): string {
  return env.JWT_EXPIRES?.trim() || '8h';
}

export function passwordPepper(env: WorkerEnv): string {
  return env.PASSWORD_PEPPER?.trim() || `${jwtSecret(env)}#pepper`;
}

export function frontendUrl(env: WorkerEnv): string {
  return (env.FRONTEND_URL || env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)[0] as string;
}

export function corsOrigins(env: WorkerEnv): string[] {
  return (env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isbndbApiKey(env: WorkerEnv): string | null {
  return env.ISBNDB_API_KEY?.trim() || null;
}

export function isbndbDelayMs(env: WorkerEnv): string | undefined {
  return env.ISBNDB_DELAY_MS;
}

export function isbndbBulkSize(env: WorkerEnv): string | undefined {
  return env.ISBNDB_BULK_SIZE;
}
