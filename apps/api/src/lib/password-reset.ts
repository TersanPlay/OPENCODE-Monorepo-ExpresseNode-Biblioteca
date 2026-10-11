import crypto from 'node:crypto';
import prisma from './prisma';

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function createResetToken(email: string, scope: 'USER' | 'READER'): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      email: email.toLowerCase(),
      scope,
      tokenHash: hashResetToken(raw),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });
  // Limpeza best-effort de tokens expirados.
  await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
  return raw;
}

export async function consumeResetToken(raw: string, scope: 'USER' | 'READER') {
  const tokenHash = hashResetToken(raw.trim());
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.scope !== scope || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record;
}
