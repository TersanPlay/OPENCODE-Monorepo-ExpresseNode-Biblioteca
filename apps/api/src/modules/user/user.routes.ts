import { Router } from 'express';
import prisma from '../../lib/prisma';
import { HttpError } from '../../lib/http-error';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { writeAudit } from '../../lib/audit';
import { env } from '../../config/env';
import { hashPassword, verifyPassword } from '../../lib/password-hash';
import { parse, userCreateSchema, userQuerySchema, userSignatureSchema, userUpdateSchema, resetPasswordSchema } from '../../validation';

export const userRouter = Router();

// Perfil do usuário logado (qualquer papel) — registrado antes do guard ADMIN e de /:id.
userRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, updatedAt: true, signature: true, signatureUpdatedAt: true, signatureType: true, signatureText: true, rubricText: true, rubricImage: true, fontFamily: true },
    });
    if (!user) throw new HttpError(404, 'Usuário não encontrado');
    res.json(user);
  }),
);

userRouter.patch(
  '/me/signature',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = parse(userSignatureSchema, req.body);
    const hasSig = !!data.signature;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
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
    await writeAudit(req.user?.id, 'USER_UPDATED', 'User', user.id, { self: true, signature: hasSig }, req.ip);
    res.json({ id: user.id, signature: user.signature, signatureUpdatedAt: user.signatureUpdatedAt, signatureType: user.signatureType, signatureText: user.signatureText, rubricText: user.rubricText, rubricImage: user.rubricImage, fontFamily: user.fontFamily });
  }),
);

userRouter.use(requireAuth, requireRoles('ADMIN'));

userRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(userQuerySchema, req.query);
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
    res.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
  }),
);

userRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parse(userCreateSchema, req.body);
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new HttpError(409, 'E-mail já cadastrado');
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: await hashPassword(data.password, env.PASSWORD_PEPPER),
        role: data.role,
      },
    });
    await writeAudit(req.user?.id, 'USER_CREATED', 'User', user.id, { email: user.email, role: user.role }, req.ip);
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, signature: user.signature, signatureUpdatedAt: user.signatureUpdatedAt });
  }),
);

userRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, updatedAt: true, signature: true, signatureUpdatedAt: true, signatureType: true, signatureText: true, rubricText: true, rubricImage: true, fontFamily: true },
    });
    if (!user) throw new HttpError(404, 'Usuário não encontrado');
    res.json(user);
  }),
);

userRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = parse(userUpdateSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    if (data.email && data.email !== existing.email) {
      const clash = await prisma.user.findUnique({ where: { email: data.email } });
      if (clash) throw new HttpError(409, 'E-mail já cadastrado');
    }
    if (data.role && data.role !== existing.role && existing.role === 'ADMIN' && req.user!.id !== id) {
      throw new HttpError(403, 'Não é possível alterar o papel de outro administrador');
    }
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: data.name ?? existing.name,
        email: data.email ?? existing.email,
        role: data.role ?? existing.role,
        status: data.status ?? existing.status,
      },
    });
    await writeAudit(req.user?.id, 'USER_UPDATED', 'User', id, { email: user.email, role: user.role }, req.ip);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, signature: user.signature, signatureUpdatedAt: user.signatureUpdatedAt });
  }),
);

userRouter.patch(
  '/:id/signature',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = parse(userSignatureSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    const sig = data.signature ? data.signature : null;
    const hasSig = !!sig;
    const user = await prisma.user.update({
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
    await writeAudit(req.user?.id, 'USER_UPDATED', 'User', id, { signature: hasSig }, req.ip);
    res.json({ id: user.id, signature: user.signature, signatureUpdatedAt: user.signatureUpdatedAt, signatureType: user.signatureType, signatureText: user.signatureText, rubricText: user.rubricText, rubricImage: user.rubricImage, fontFamily: user.fontFamily });
  }),
);

userRouter.post(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = parse(resetPasswordSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Usuário não encontrado');
    if (existing.role === 'ADMIN' && req.user!.id !== id) {
      if (!data.currentPassword) throw new HttpError(400, 'Senha atual obrigatória para redefinir senha de outro administrador');
      const caller = await prisma.user.findUnique({ where: { id: req.user!.id } });
      const valid = await verifyPassword(data.currentPassword, caller!.passwordHash, env.PASSWORD_PEPPER);
      if (valid !== 'valid') throw new HttpError(403, 'Senha atual inválida');
    }
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(data.password, env.PASSWORD_PEPPER) } });
    await writeAudit(req.user?.id, 'USER_PASSWORD_RESET', 'User', id, undefined, req.ip);
    res.json({ ok: true });
  }),
);