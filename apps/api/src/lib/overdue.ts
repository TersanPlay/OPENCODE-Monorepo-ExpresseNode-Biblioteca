import prisma from './prisma';
import type { PrismaClient } from '../generated/prisma';

export async function refreshOverdue(readerId?: number, client: PrismaClient = prisma): Promise<void> {
  const now = new Date();
  const where = {
    returnedAt: null,
    dueDate: { lt: now },
    status: 'ACTIVE' as const,
    ...(readerId ? { readerId } : {}),
  };
  const loans = await client.loan.findMany({ where, select: { id: true } });
  if (loans.length > 0) {
    await client.loan.updateMany({
      where: { id: { in: loans.map((l) => l.id) } },
      data: { status: 'OVERDUE' },
    });
  }
}

export async function expireReservations(client: PrismaClient = prisma): Promise<void> {
  const now = new Date();
  const rows = await client.reservation.findMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    select: { id: true },
  });
  if (rows.length > 0) {
    await client.reservation.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'EXPIRED' },
    });
  }
}

export const MS_PER_DAY = 86400000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function computeDueDate(from: Date, days: number): Date {
  return addDays(from, days);
}

export function isPast(date: Date): boolean {
  return date.getTime() < Date.now();
}