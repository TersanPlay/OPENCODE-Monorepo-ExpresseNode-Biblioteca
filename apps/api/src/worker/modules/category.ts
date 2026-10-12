import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HttpError } from '../../lib/http-error';
import { writeAudit } from '../../lib/audit';
import { prismaOf } from '../db';
import { requireAuth, requireRoles } from '../auth';
import { clientIp, reqJson } from '../http';
import { categorySchema, categoryStatusSchema, cleanNull, parse } from '../../validation';
import type { AppContext, AppEnv } from '../context';

export const categoryApp = new Hono<AppEnv>();

// Lista pública; com ?all=1 exige auth e inclui inativas.
const maybeAuth = createMiddleware<AppEnv>(async (c, next) => {
  const appC = c as AppContext;
  if (appC.req.query('all') === '1') return requireAuth(appC, next);
  await next();
});

categoryApp.get('/', maybeAuth, async (c) => {
  const prisma = prismaOf(c);
  const includeInactive = c.req.query('all') === '1' && !!c.get('user');
  const items = await prisma.category.findMany({
    where: includeInactive ? {} : { status: 'ACTIVE' },
    include: { _count: { select: { bookLinks: true } } },
    orderBy: { name: 'asc' },
  });
  return c.json({
    items: items.map((cat) => ({ ...cat, _count: { books: cat._count.bookLinks } })),
    total: items.length,
    page: 1,
    pageSize: items.length,
    totalPages: 1,
  });
});

categoryApp.use(requireAuth, requireRoles('ADMIN'));

categoryApp.post('/', async (c) => {
  const prisma = prismaOf(c);
  const data = parse(categorySchema, await reqJson(c));
  const category = await prisma.category.create({
    data: { name: data.name, description: cleanNull(data.description) },
  });
  await writeAudit(c.get('user')?.id, 'CATEGORY_CREATED', 'Category', category.id, { name: category.name }, clientIp(c), prisma);
  return c.json(category, 201);
});

categoryApp.put('/:id', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const data = parse(categorySchema, await reqJson(c));
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Categoria não encontrada');
  const category = await prisma.category.update({
    where: { id },
    data: { name: data.name, description: cleanNull(data.description) },
  });
  await writeAudit(c.get('user')?.id, 'CATEGORY_UPDATED', 'Category', id, { name: category.name }, clientIp(c), prisma);
  return c.json(category);
});

categoryApp.patch('/:id/status', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const { status } = parse(categoryStatusSchema, await reqJson(c));
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Categoria não encontrada');
  const category = await prisma.category.update({ where: { id }, data: { status } });
  await writeAudit(c.get('user')?.id, 'CATEGORY_STATUS_CHANGED', 'Category', id, { status }, clientIp(c), prisma);
  return c.json(category);
});
