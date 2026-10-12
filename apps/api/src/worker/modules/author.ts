import { Hono } from 'hono';
import { HttpError } from '../../lib/http-error';
import { writeAudit } from '../../lib/audit';
import { prismaOf } from '../db';
import { requireAuth } from '../auth';
import { clientIp, reqJson } from '../http';
import { authorSchema, authorStatusSchema, listQuerySchema, parse } from '../../validation';
import type { AppEnv } from '../context';

export const authorApp = new Hono<AppEnv>();

authorApp.use(requireAuth);

authorApp.get('/', async (c) => {
  const prisma = prismaOf(c);
  const q = parse(listQuerySchema, c.req.query());
  const all = c.req.query('all') === '1';
  const where = {
    ...(q.search ? { name: { contains: q.search } } : {}),
    ...(q.status === 'active' ? { isActive: true } : {}),
    ...(q.status === 'inactive' ? { isActive: false } : {}),
  };
  if (all) {
    const items = await prisma.author.findMany({
      where: { isActive: true, ...(q.search ? { name: { contains: q.search } } : {}) },
      include: { _count: { select: { books: true } } },
      orderBy: { name: 'asc' },
    });
    return c.json({ items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 });
  }
  const total = await prisma.author.count({ where });
  const items = await prisma.author.findMany({
    where,
    include: { _count: { select: { books: true } } },
    orderBy: { name: 'asc' },
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  return c.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
});

authorApp.post('/', async (c) => {
  const prisma = prismaOf(c);
  const data = parse(authorSchema, await reqJson(c));
  const author = await prisma.author.create({
    data: { name: data.name },
  });
  await writeAudit(c.get('user')?.id, 'AUTHOR_CREATED', 'Author', author.id, { name: author.name }, clientIp(c), prisma);
  return c.json(author, 201);
});

authorApp.put('/:id', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const data = parse(authorSchema, await reqJson(c));
  const existing = await prisma.author.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Autor não encontrado');
  const author = await prisma.author.update({
    where: { id },
    data: { name: data.name, isActive: data.isActive ?? existing.isActive },
  });
  await writeAudit(c.get('user')?.id, 'AUTHOR_UPDATED', 'Author', id, { name: author.name }, clientIp(c), prisma);
  return c.json(author);
});

authorApp.patch('/:id/status', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const { isActive } = parse(authorStatusSchema, await reqJson(c));
  const existing = await prisma.author.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Autor não encontrado');
  const author = await prisma.author.update({ where: { id }, data: { isActive } });
  await writeAudit(c.get('user')?.id, isActive ? 'AUTHOR_ACTIVATED' : 'AUTHOR_INACTIVATED', 'Author', id, undefined, clientIp(c), prisma);
  return c.json(author);
});
