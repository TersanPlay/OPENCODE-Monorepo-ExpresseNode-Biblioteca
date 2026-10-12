import prisma from './prisma';
import type { PrismaClient } from '../generated/prisma';

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashResetToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return toHex(new Uint8Array(digest));
}

export function randomHex(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function createResetToken(
  email: string,
  scope: 'USER' | 'READER',
  client: PrismaClient = prisma,
): Promise<string> {
  const raw = randomHex(32);
  await client.passwordResetToken.create({
    data: {
      email: email.toLowerCase(),
      scope,
      tokenHash: await hashResetToken(raw),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });
  // Limpeza best-effort de tokens expirados.
  await client.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
  return raw;
}

export async function consumeResetToken(
  raw: string,
  scope: 'USER' | 'READER',
  client: PrismaClient = prisma,
) {
  const tokenHash = await hashResetToken(raw.trim());
  const record = await client.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.scope !== scope || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }
  await client.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record;
}
