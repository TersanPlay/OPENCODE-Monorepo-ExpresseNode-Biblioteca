import { createMiddleware } from 'hono/factory';
import { jwtVerify, SignJWT } from 'jose';
import { HttpError } from '../lib/http-error';
import { jwtExpires, jwtSecret, readerJwtSecret, type WorkerEnv } from './env';
import type { AppContext, AppEnv } from './context';
import { prismaOf } from './db';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'ADMIN' | 'ATTENDANT';
}

export interface ReaderSession {
  id: number;
  name: string;
  email: string | null;
}

/** Resposta pública do leitor: nunca expõe passwordHash. */
export function publicReader<T extends { passwordHash?: string | null }>(r: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _omit, ...rest } = r;
  return rest;
}

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * Mesmas claims do jsonwebtoken ({ sub, role, typ }, HS256) — tokens
 * emitidos pelo Express continuam válidos e vice-versa.
 */
export async function signToken(
  env: WorkerEnv,
  user: { id: number; role: string },
): Promise<string> {
  return await new SignJWT({ role: user.role, typ: 'staff' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setExpirationTime(jwtExpires(env))
    .sign(enc(jwtSecret(env)));
}

/** Token isolado do portal do leitor — secret distinto do staff. */
export async function signReaderToken(
  env: WorkerEnv,
  reader: { id: number },
): Promise<string> {
  return await new SignJWT({ typ: 'reader' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(reader.id))
    .setExpirationTime(jwtExpires(env))
    .sign(enc(readerJwtSecret(env)));
}

function bearerToken(c: AppContext): string | null {
  const header = c.req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c);
  if (!token) throw new HttpError(401, 'Não autenticado');
  let sub: unknown;
  let typ: unknown;
  try {
    const { payload } = await jwtVerify(token, enc(jwtSecret(c.env)));
    sub = payload.sub;
    typ = (payload as { typ?: unknown }).typ;
  } catch {
    throw new HttpError(401, 'Sessão expirada');
  }
  // Tokens do portal do leitor usam secret próprio, mas o typ barra
  // qualquer reuso cruzado mesmo em colisão de IDs.
  if (typ !== undefined && typ !== 'staff') throw new HttpError(401, 'Sessão inválida');
  const id = Number(sub);
  if (!Number.isInteger(id)) throw new HttpError(401, 'Sessão inválida');
  const user = await prismaOf(c).user.findUnique({ where: { id } });
  if (!user || user.status !== 'ACTIVE') throw new HttpError(401, 'Sessão inválida');
  c.set('user', {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as AuthUser['role'],
  });
  await next();
});

export const requireRoles = (...roles: Array<'ADMIN' | 'ATTENDANT'>) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      throw new HttpError(403, 'Sem permissão para esta operação');
    }
    await next();
  });

export const requireReader = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearerToken(c);
  if (!token) throw new HttpError(401, 'Não autenticado');
  let sub: unknown;
  let typ: unknown;
  try {
    const { payload } = await jwtVerify(token, enc(readerJwtSecret(c.env)));
    sub = payload.sub;
    typ = (payload as { typ?: unknown }).typ;
  } catch {
    throw new HttpError(401, 'Sessão expirada');
  }
  if (typ !== 'reader') throw new HttpError(401, 'Sessão inválida');
  const id = Number(sub);
  if (!Number.isInteger(id)) throw new HttpError(401, 'Sessão inválida');
  const reader = await prismaOf(c).reader.findUnique({ where: { id } });
  if (!reader || reader.deletedAt || reader.status !== 'ACTIVE') {
    throw new HttpError(401, 'Sessão inválida');
  }
  c.set('reader', { id: reader.id, name: reader.name, email: reader.email });
  await next();
});
