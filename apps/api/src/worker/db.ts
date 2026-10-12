import { createMiddleware } from 'hono/factory';
import { createPrisma } from '../lib/prisma';
import type { AppContext, AppEnv } from './context';

/** Prisma por requisição (binding D1) — padrão documentado p/ Workers. */
export const prismaMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('prisma', createPrisma(c.env.DB));
  await next();
});

export function prismaOf(c: AppContext) {
  return c.get('prisma');
}
