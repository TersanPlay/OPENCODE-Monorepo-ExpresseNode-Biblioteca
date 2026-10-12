import type { Context } from 'hono';
import type { PrismaClient } from '../generated/prisma';
import type { AuthUser, ReaderSession } from './auth';
import type { WorkerEnv } from './env';

export interface AppVariables {
  prisma: PrismaClient;
  user?: AuthUser;
  reader?: ReaderSession;
}

export interface AppEnv {
  Bindings: WorkerEnv;
  Variables: AppVariables;
}

export type AppContext = Context<AppEnv>;
