import { Hono } from 'hono';
import { auditQuerySchema, dateOrNull, parse } from '../../validation';
import { prismaOf } from '../db';
import { requireAuth, requireRoles } from '../auth';
import type { AppEnv } from '../context';

export const auditApp = new Hono<AppEnv>();

auditApp.use(requireAuth, requireRoles('ADMIN'));

auditApp.get('/', async (c) => {
  const prisma = prismaOf(c);
  const q = parse(auditQuerySchema, c.req.query());
  const start = dateOrNull(q.start);
  const end = dateOrNull(q.end);
  const endInclusive = end ? new Date(end.getTime() + 86399999) : undefined;
  const where = {
    ...(q.action ? { action: q.action } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(start || endInclusive
      ? { createdAt: { ...(start ? { gte: start } : {}), ...(endInclusive ? { lte: endInclusive } : {}) } }
      : {}),
  };
  const total = await prisma.auditLog.count({ where });
  const items = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  return c.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
});

auditApp.get('/actions', async (c) => {
  const prisma = prismaOf(c);
  const rows = await prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true } });
  return c.json({ actions: rows.map((r) => r.action) });
});
