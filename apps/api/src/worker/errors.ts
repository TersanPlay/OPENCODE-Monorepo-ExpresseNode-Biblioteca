import { ZodError } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HttpError } from '../lib/http-error';
import type { AppContext } from './context';

export function notFound(c: AppContext) {
  return c.json({ error: 'Rota não encontrada' }, 404);
}

/** Espelha apps/api/src/middleware/error-handler.ts (sem importar runtime do Prisma). */
export function onError(err: Error, c: AppContext) {
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`).join('; ');
    return c.json({ error: message }, 400);
  }
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  }
  const code = (err as { code?: unknown }).code;
  const errName = (err as { name?: unknown }).name;
  if (errName === 'PrismaClientKnownRequestError') {
    if (code === 'P2002') {
      const meta = (err as { meta?: { target?: unknown } }).meta;
      const target: string[] = Array.isArray(meta?.target) ? meta.target : [];
      if (target.includes('isbn10') || target.includes('isbn13')) {
        return c.json({ error: 'Este livro já está cadastrado.' }, 409);
      }
      return c.json({ error: 'Registro duplicado: valor já cadastrado' }, 409);
    }
    if (code === 'P2025') {
      return c.json({ error: 'Registro não encontrado' }, 404);
    }
    if (code === 'P2003') {
      return c.json({ error: 'Registro relacionado não encontrado' }, 400);
    }
  }
  if (err instanceof SyntaxError) {
    return c.json({ error: 'JSON inválido no corpo da requisição' }, 400);
  }
  console.error('[erro]', err);
  return c.json({ error: 'Erro interno do servidor' }, 500);
}
