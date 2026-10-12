import prisma from './prisma';
import type { PrismaClient } from '../generated/prisma';

export async function writeAudit(
  userId: number | null | undefined,
  action: string,
  entity?: string,
  entityId?: string | number,
  metadata?: unknown,
  ip?: string,
  client: PrismaClient = prisma,
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        userId: userId ?? null,
        action,
        entity: entity ?? null,
        entityId: entityId !== undefined ? String(entityId) : null,
        metadata: metadata !== undefined ? JSON.stringify(metadata) : null,
        ip: ip ?? null,
      },
    });
  } catch (err) {
    console.error('Falha ao registrar auditoria:', err);
  }
}