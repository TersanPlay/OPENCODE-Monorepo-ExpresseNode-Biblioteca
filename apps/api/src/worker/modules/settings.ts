import { Hono } from 'hono';
import { cleanNull, parse, settingsSchema } from '../../validation';
import { writeAudit } from '../../lib/audit';
import { prismaOf } from '../db';
import { requireAuth, requireRoles } from '../auth';
import { clientIp, reqJson } from '../http';
import type { AppEnv } from '../context';

export const settingsApp = new Hono<AppEnv>();

settingsApp.get('/', async (c) => {
  const s = await prismaOf(c).setting.findUnique({ where: { id: 1 } });
  return c.json({
    loanLimit: s?.loanLimit ?? 4,
    defaultLoanDays: s?.defaultLoanDays ?? 15,
    maxRenewals: s?.maxRenewals ?? 1,
    libraryName: s?.libraryName ?? '',
    libraryAddress: s?.libraryAddress ?? null,
    libraryPhone: s?.libraryPhone ?? null,
    libraryEmail: s?.libraryEmail ?? null,
    libraryHours: s?.libraryHours ?? null,
  });
});

settingsApp.put('/', requireAuth, requireRoles('ADMIN'), async (c) => {
  const prisma = prismaOf(c);
  const data = parse(settingsSchema, await reqJson(c));
  const payload = {
    loanLimit: data.loanLimit,
    defaultLoanDays: data.defaultLoanDays,
    maxRenewals: data.maxRenewals,
    libraryName: data.libraryName,
    libraryAddress: cleanNull(data.libraryAddress),
    libraryPhone: cleanNull(data.libraryPhone),
    libraryEmail: cleanNull(data.libraryEmail),
    libraryHours: cleanNull(data.libraryHours),
  };
  const s = await prisma.setting.upsert({
    where: { id: 1 },
    update: payload,
    create: { id: 1, ...payload },
  });
  await writeAudit(c.get('user')?.id, 'SETTINGS_UPDATED', 'Setting', 1, data, clientIp(c), prisma);
  return c.json(s);
});
