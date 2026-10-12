import { Hono } from 'hono';
import { HttpError } from '../../lib/http-error';
import { hashPassword, verifyPassword } from '../../lib/password-hash';
import { writeAudit } from '../../lib/audit';
import { prismaOf } from '../db';
import { requireAuth, requireRoles } from '../auth';
import { passwordPepper } from '../env';
import { clientIp, reqJson } from '../http';
import {
  parse,
  userCreateSchema,
  userQuerySchema,
  userSignatureSchema,
  userUpdateSchema,
  resetPasswordSchema,
} from '../../validation';
import type { AppEnv } from '../context';

export const userApp = new Hono<AppEnv>();

// Perfil do usuário logado (qualquer papel) — registrado antes de /:id.
userApp.get('/me', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const user = c.get('user');
  const me = await prisma.user.findUnique({
    where: { id: user!.id },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, updatedAt: true, signature: true, signatureUpdatedAt: true, signatureType: true, signatureText: true, rubricText: true, rubricImage: true, fontFamily: true },
  });
  if (!me) throw new HttpError(404, 'Usuário não encontrado');
  return c.json(me);
});

userApp.patch('/me/signature', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const user = c.get('user');
  const data = parse(userSignatureSchema, await reqJson(c));
  const hasSig = !!data.signature;
  const updated = await prisma.user.update({
    where: { id: user!.id },
    data: {
      signature: data.signature ?? null,
      signatureUpdatedAt: hasSig ? new Date() : null,
      signatureType: hasSig ? (data.signatureType ?? null) : null,
      signatureText: hasSig ? (data.signatureText ?? null) : null,
      rubricText: hasSig ? (data.rubricText ?? null) : null,
      rubricImage: hasSig ? (data.rubricImage ?? null) : null,
      fontFamily: hasSig ? (data.fontFamily ?? null) : null,
    },
  });
  await writeAudit(user?.id, 'USER_UPDATED', 'User', updated.id, { self: true, signature: hasSig }, clientIp(c), prisma);
  return c.json({ id: updated.id, signature: updated.signature, signatureUpdatedAt: updated.signatureUpdatedAt, signatureType: updated.signatureType, signatureText: updated.signatureText, rubricText: updated.rubricText, rubricImage: updated.rubricImage, fontFamily: updated.fontFamily });
});

userApp.use(requireAuth, requireRoles('ADMIN'));

userApp.get('/', async (c) => {
  const prisma = prismaOf(c);
  const q = parse(userQuerySchema, c.req.query());
  const where = {
    ...(q.search ? { OR: [{ name: { contains: q.search } }, { email: { contains: q.search } }] } : {}),
    ...(q.role ? { role: q.role } : {}),
    ...(q.status ? { status: q.status } : {}),
  };
  const total = await prisma.user.count({ where });
  const items = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, signature: true, signatureUpdatedAt: true, signatureType: true, signatureText: true, rubricText: true, rubricImage: true, fontFamily: true },
    orderBy: { name: 'asc' },
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  return c.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
});

userApp.post('/', async (c) => {
  const prisma = prismaOf(c);
  const user = c.get('user');
  const data = parse(userCreateSchema, await reqJson(c));
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) throw new HttpError(409, 'E-mail já cadastrado');
  const created = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password, passwordPepper(c.env)),
      role: data.role,
    },
  });
  await writeAudit(user?.id, 'USER_CREATED', 'User', created.id, { email: created.email, role: created.role }, clientIp(c), prisma);
  return c.json({ id: created.id, name: created.name, email: created.email, role: created.role, status: created.status, signature: created.signature, signatureUpdatedAt: created.signatureUpdatedAt }, 201);
});

userApp.get('/:id', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const found = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, updatedAt: true, signature: true, signatureUpdatedAt: true, signatureType: true, signatureText: true, rubricText: true, rubricImage: true, fontFamily: true },
  });
  if (!found) throw new HttpError(404, 'Usuário não encontrado');
  return c.json(found);
});

userApp.put('/:id', async (c) => {
  const prisma = prismaOf(c);
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const data = parse(userUpdateSchema, await reqJson(c));
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Usuário não encontrado');
  if (data.email && data.email !== existing.email) {
    const clash = await prisma.user.findUnique({ where: { email: data.email } });
    if (clash) throw new HttpError(409, 'E-mail já cadastrado');
  }
  if (data.role && data.role !== existing.role && existing.role === 'ADMIN' && user!.id !== id) {
    throw new HttpError(403, 'Não é possível alterar o papel de outro administrador');
  }
  const updated = await prisma.user.update({
    where: { id },
    data: {
      name: data.name ?? existing.name,
      email: data.email ?? existing.email,
      role: data.role ?? existing.role,
      status: data.status ?? existing.status,
    },
  });
  await writeAudit(user?.id, 'USER_UPDATED', 'User', id, { email: updated.email, role: updated.role }, clientIp(c), prisma);
  return c.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, status: updated.status, signature: updated.signature, signatureUpdatedAt: updated.signatureUpdatedAt });
});

userApp.patch('/:id/signature', async (c) => {
  const prisma = prismaOf(c);
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const data = parse(userSignatureSchema, await reqJson(c));
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Usuário não encontrado');
  const sig = data.signature ? data.signature : null;
  const hasSig = !!sig;
  const updated = await prisma.user.update({
    where: { id },
    data: {
      signature: sig,
      signatureUpdatedAt: hasSig ? new Date() : null,
      signatureType: hasSig ? (data.signatureType ?? null) : null,
      signatureText: hasSig ? (data.signatureText ?? null) : null,
      rubricText: hasSig ? (data.rubricText ?? null) : null,
      rubricImage: hasSig ? (data.rubricImage ?? null) : null,
      fontFamily: hasSig ? (data.fontFamily ?? null) : null,
    },
  });
  await writeAudit(user?.id, 'USER_UPDATED', 'User', id, { signature: hasSig }, clientIp(c), prisma);
  return c.json({ id: updated.id, signature: updated.signature, signatureUpdatedAt: updated.signatureUpdatedAt, signatureType: updated.signatureType, signatureText: updated.signatureText, rubricText: updated.rubricText, rubricImage: updated.rubricImage, fontFamily: updated.fontFamily });
});

userApp.post('/:id/password', async (c) => {
  const prisma = prismaOf(c);
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const data = parse(resetPasswordSchema, await reqJson(c));
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Usuário não encontrado');
  if (existing.role === 'ADMIN' && user!.id !== id) {
    if (!data.currentPassword) throw new HttpError(400, 'Senha atual obrigatória para redefinir senha de outro administrador');
    const caller = await prisma.user.findUnique({ where: { id: user!.id } });
    const valid = await verifyPassword(data.currentPassword, caller!.passwordHash, passwordPepper(c.env));
    if (valid !== 'valid') throw new HttpError(403, 'Senha atual inválida');
  }
  await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(data.password, passwordPepper(c.env)) } });
  await writeAudit(user?.id, 'USER_PASSWORD_RESET', 'User', id, undefined, clientIp(c), prisma);
  return c.json({ ok: true });
});
