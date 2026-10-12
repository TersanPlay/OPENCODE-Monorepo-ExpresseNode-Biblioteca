import { Hono } from 'hono';
import { HttpError } from '../../lib/http-error';
import { writeAudit } from '../../lib/audit';
import { computeDueDate, expireReservations, MS_PER_DAY } from '../../lib/overdue';
import { getSettings } from '../../lib/settings';
import { prismaOf } from '../db';
import { requireAuth } from '../auth';
import { clientIp, reqJson } from '../http';
import { parse, reservationCreateSchema, reservationQuerySchema } from '../../validation';
import type { AppEnv } from '../context';

export const reservationApp = new Hono<AppEnv>();

reservationApp.use(requireAuth);

export const reservationInclude = {
  reader: true,
  book: true,
};

const RESERVATION_DAYS = 3;

reservationApp.get('/', async (c) => {
  const prisma = prismaOf(c);
  await expireReservations(prisma);
  const q = parse(reservationQuerySchema, c.req.query());
  const where = {
    ...(q.status && q.status !== 'all' ? { status: q.status } : {}),
    ...(q.readerId ? { readerId: q.readerId } : {}),
    ...(q.bookId ? { bookId: q.bookId } : {}),
    ...(q.search ? { reader: { name: { contains: q.search } } } : {}),
  };
  const total = await prisma.reservation.count({ where });
  const items = await prisma.reservation.findMany({
    where,
    include: reservationInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  return c.json({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize) });
});

reservationApp.post('/', async (c) => {
  const prisma = prismaOf(c);
  const data = parse(reservationCreateSchema, await reqJson(c));
  const reader = await prisma.reader.findUnique({ where: { id: data.readerId } });
  if (!reader) throw new HttpError(404, 'Leitor não encontrado');
  if (reader.deletedAt) throw new HttpError(400, 'Leitor excluído não pode reservar');
  if (reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado não pode reservar');
  const book = await prisma.book.findUnique({ where: { id: data.bookId } });
  if (!book) throw new HttpError(404, 'Livro não encontrado');

  const pending = await prisma.reservation.findFirst({
    where: { readerId: data.readerId, bookId: data.bookId, status: { in: ['PENDING', 'AVAILABLE'] } },
  });
  if (pending) throw new HttpError(400, 'Leitor já possui reserva ativa para este livro');

  const reservation = await prisma.reservation.create({
    data: {
      readerId: data.readerId,
      bookId: data.bookId,
      expiresAt: new Date(Date.now() + RESERVATION_DAYS * MS_PER_DAY),
    },
  });
  await writeAudit(c.get('user')?.id, 'RESERVATION_CREATED', 'Reservation', reservation.id, { readerId: data.readerId, bookId: data.bookId }, clientIp(c), prisma);
  return c.json(reservation, 201);
});

reservationApp.post('/:id/cancel', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Reserva não encontrada');
  if (existing.status === 'FULFILLED') throw new HttpError(400, 'Reserva já atendida não pode ser cancelada');
  const reservation = await prisma.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
  await writeAudit(c.get('user')?.id, 'RESERVATION_CANCELLED', 'Reservation', id, undefined, clientIp(c), prisma);
  return c.json(reservation);
});

reservationApp.post('/:id/fulfill', async (c) => {
  const prisma = prismaOf(c);
  const id = Number(c.req.param('id'));
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: { reader: true } });
  if (!reservation) throw new HttpError(404, 'Reserva não encontrada');
  if (reservation.status === 'CANCELLED' || reservation.status === 'EXPIRED') {
    throw new HttpError(400, 'Reserva cancelada ou expirada não pode ser atendida');
  }
  if (reservation.status === 'FULFILLED') throw new HttpError(400, 'Reserva já atendida');
  if (reservation.reader.status !== 'ACTIVE') throw new HttpError(400, 'Leitor bloqueado não pode retirar reserva');

  const settings = await getSettings(prisma);
  const dueDate = computeDueDate(new Date(), settings.defaultLoanDays);

  // D1 não suporta transações interativas (callback); leituras + batch atômico.
  const activeBookLoan = await prisma.loan.findFirst({
    where: { bookId: reservation.bookId, status: { in: ['ACTIVE', 'OVERDUE'] } },
  });
  if (activeBookLoan) throw new HttpError(400, 'Este livro já está emprestado');

  const roster = await prisma.loan.count({
    where: { readerId: reservation.readerId, status: { in: ['ACTIVE', 'OVERDUE'] } },
  });
  if (roster >= settings.loanLimit) {
    throw new HttpError(400, `Limite de empréstimos do leitor atingido (${settings.loanLimit})`);
  }

  const created = await prisma.loan.create({
    data: { readerId: reservation.readerId, bookId: reservation.bookId, userId: c.get('user')!.id, dueDate },
  });
  const number = `EMP-${String(created.id).padStart(6, '0')}`;
  await prisma.$transaction([
    prisma.loan.update({ where: { id: created.id }, data: { number } }),
    prisma.reservation.update({
      where: { id },
      data: { status: 'FULFILLED', fulfilledAt: new Date() },
    }),
  ]);
  await writeAudit(c.get('user')?.id, 'RESERVATION_FULFILLED', 'Reservation', id, { loanId: created.id }, clientIp(c), prisma);
  await writeAudit(c.get('user')?.id, 'LOAN_CREATED', 'Loan', created.id, { number, viaReservation: id }, clientIp(c), prisma);
  return c.json({ loanId: created.id, number }, 201);
});
