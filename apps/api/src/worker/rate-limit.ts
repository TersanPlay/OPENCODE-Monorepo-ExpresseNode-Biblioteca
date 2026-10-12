import { createMiddleware } from 'hono/factory';
import { clientIp } from './http';
import type { AppEnv } from './context';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  message: unknown;
}

/**
 * Janela deslizante em memória (por isolate). Equivale ao express-rate-limit
 * para o mesmo comportamento de API (429 + mensagem); em produção com
 * múltiplos isolates a contagem é aproximada.
 */
export function rateLimit(opts: LimiterOptions) {
  const hits = new Map<string, number[]>();
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = clientIp(c) ?? 'unknown';
    const now = Date.now();
    const window = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (window.length >= opts.limit) {
      return c.json(opts.message, 429);
    }
    window.push(now);
    hits.set(key, window);
    if (hits.size > 10000) {
      const oldest = hits.keys().next();
      if (!oldest.done) hits.delete(oldest.value);
    }
    await next();
  });
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});
