import { Hono } from 'hono';
import { HttpError } from '../../lib/http-error';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../lib/password-hash';
import { consumeResetToken, createResetToken } from '../../lib/password-reset';
import { writeAudit } from '../../lib/audit';
import { prismaOf } from '../db';
import { loginLimiter } from '../rate-limit';
import { requireAuth, signToken } from '../auth';
import { frontendUrl, passwordPepper } from '../env';
import { passwordResetEmail, sendEmail } from '../mail';
import { clientIp, reqJson } from '../http';
import {
  forgotPasswordSchema,
  loginSchema,
  parse,
  resetPasswordWithTokenSchema,
} from '../../validation';
import type { AppEnv } from '../context';

export const authApp = new Hono<AppEnv>();

function publicUser(u: {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
}): { id: number; name: string; email: string; role: 'ADMIN' | 'ATTENDANT'; status: string } {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as 'ADMIN' | 'ATTENDANT',
    status: u.status,
  };
}

authApp.post('/login', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const env = c.env;
  const data = parse(loginSchema, await reqJson(c));
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  const result = await verifyPassword(
    data.password,
    user ? user.passwordHash : DUMMY_PASSWORD_HASH,
    passwordPepper(env),
  );
  if (!user || result === 'invalid' || user.status !== 'ACTIVE') {
    await writeAudit(null, 'LOGIN_FAILED', 'User', user?.id, { email: data.email }, clientIp(c), prisma);
    throw new HttpError(401, 'E-mail ou senha inválidos');
  }
  if (result === 'legacy') {
    await writeAudit(
      user.id,
      'LOGIN_FAILED',
      'User',
      user.id,
      { email: data.email, legacy: true },
      clientIp(c),
      prisma,
    );
    throw new HttpError(
      401,
      'Sua senha precisa ser redefinida. Use "Esqueci a senha" ou peça ao administrador.',
    );
  }
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(data.password, passwordPepper(env)) },
    });
  }
  const token = await signToken(env, user);
  await writeAudit(user.id, 'LOGIN', 'User', user.id, undefined, clientIp(c), prisma);
  return c.json({ token, user: publicUser(user) });
});

authApp.get('/me', requireAuth, async (c) => {
  return c.json({ user: c.get('user') });
});

authApp.post('/logout', requireAuth, async (c) => {
  const prisma = prismaOf(c);
  const user = c.get('user');
  await writeAudit(user?.id, 'LOGOUT', 'User', user?.id, undefined, clientIp(c), prisma);
  return c.json({ ok: true });
});

const GENERIC_FORGOT_MESSAGE = 'Se o e-mail estiver cadastrado, enviamos as instruções de recuperação.';

authApp.post('/forgot-password', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(forgotPasswordSchema, await reqJson(c));
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (user && user.status === 'ACTIVE') {
    const raw = await createResetToken(user.email, 'USER', prisma);
    const link = `${frontendUrl(c.env)}/redefinir-senha?token=${raw}&tipo=equipe`;
    const content = passwordResetEmail(user.name, link);
    await sendEmail(c.env, { to: user.email, ...content });
    await writeAudit(user.id, 'PASSWORD_RESET_REQUESTED', 'User', user.id, undefined, clientIp(c), prisma);
  }
  return c.json({ ok: true, message: GENERIC_FORGOT_MESSAGE });
});

authApp.post('/reset-password', loginLimiter, async (c) => {
  const prisma = prismaOf(c);
  const data = parse(resetPasswordWithTokenSchema, await reqJson(c));
  const record = await consumeResetToken(data.token, 'USER', prisma);
  if (!record) throw new HttpError(400, 'Link inválido ou expirado');
  const user = await prisma.user.findUnique({ where: { email: record.email } });
  if (!user || user.status !== 'ACTIVE') throw new HttpError(400, 'Link inválido ou expirado');
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(data.password, passwordPepper(c.env)) },
  });
  await writeAudit(user.id, 'PASSWORD_RESET_DONE', 'User', user.id, undefined, clientIp(c), prisma);
  return c.json({ ok: true });
});
