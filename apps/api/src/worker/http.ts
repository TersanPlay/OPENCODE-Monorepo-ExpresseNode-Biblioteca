import { HttpError } from '../lib/http-error';
import type { AppContext } from './context';

/** Corpo JSON — mesma mensagem de erro do express.json() inválido. */
export async function reqJson(c: AppContext): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    throw new HttpError(400, 'JSON inválido no corpo da requisição');
  }
}

/** IP do cliente (Cabeçalho Cloudflare, com fallback p/ proxy). */
export function clientIp(c: AppContext): string | undefined {
  const fwd = c.req.header('x-forwarded-for');
  return (
    c.req.header('cf-connecting-ip') ?? (fwd ? fwd.split(',')[0]?.trim() || undefined : undefined)
  );
}
