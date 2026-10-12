import { Hono } from 'hono';
import type { DashboardData, Loan, LoanStatus } from '@library/shared';
import { MS_PER_DAY, refreshOverdue } from '../../lib/overdue';
import { stripLoanBlobs } from '../../lib/strip-signature-blobs';
import { prismaOf } from '../db';
import { requireAuth } from '../auth';
import { loanInclude } from '../loan-include';
import type { AppEnv } from '../context';

export const dashboardApp = new Hono<AppEnv>();

dashboardApp.use(requireAuth);

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

dashboardApp.get('/', async (c) => {
  const prisma = prismaOf(c);
  await refreshOverdue(undefined, prisma);

  const [
    totalBooks,
    activeLoans,
    overdueLoans,
    activeReaders,
    recentLoans,
    recentReturns,
    overdue,
  ] = await Promise.all([
    prisma.book.count({ where: { isArchived: false } }),
    prisma.loan.count({ where: { status: { in: ['ACTIVE', 'OVERDUE'] } } }),
    prisma.loan.count({ where: { status: 'OVERDUE' } }),
    prisma.reader.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    prisma.loan.findMany({
      where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
      include: loanInclude,
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.loan.findMany({
      where: { status: 'RETURNED' },
      include: loanInclude,
      orderBy: { returnedAt: 'desc' },
      take: 5,
    }),
    prisma.loan.findMany({
      where: { status: 'OVERDUE' },
      include: loanInclude,
      orderBy: { dueDate: 'asc' },
      take: 5,
    }),
  ]);

  const availableBooks = Math.max(0, totalBooks - activeLoans);
  const topBooksRaw = await prisma.loan.groupBy({
    by: ['bookId'],
    where: { loanDate: { gte: new Date(Date.now() - 30 * MS_PER_DAY) } },
    _count: { _all: true },
    orderBy: { _count: { bookId: 'desc' } },
    take: 5,
  });
  const bookIds = topBooksRaw.map((g) => g.bookId);
  const bookTitles = await prisma.book.findMany({
    where: { id: { in: bookIds } },
    select: { id: true, title: true },
  });
  const titleMap = new Map(bookTitles.map((b) => [b.id, b.title]));
  const topBooks = topBooksRaw.map((g) => ({
    title: titleMap.get(g.bookId) ?? `Livro #${g.bookId}`,
    count: g._count._all,
  }));

  // Assinaturas/rubricas são PNG em base64 e somavam ~130 KB por empréstimo
  // (reader.signature, reader.rubricImage, createdBySignatureSnapshot...). O
  // painel não exibe nenhum deles, então saem daqui (ver `strip-signature-blobs`):
  // sem isso o dashboard entrega ~1 MB por carga.
  type LoanRow = (typeof recentLoans)[number];

  const shape = (l: LoanRow) => ({
    ...stripLoanBlobs(l),
    status: l.status as LoanStatus,
    loanDate: l.loanDate.toISOString(),
    dueDate: l.dueDate.toISOString(),
    returnedAt: iso(l.returnedAt),
    createdAt: iso(l.createdAt),
    updatedAt: iso(l.updatedAt),
  });

  // O `c.json` serializa as `Date` aninhadas (reader/book) em ISO-8601, então o
  // payload real já satisfaz o contrato; o TS não enxerga essa conversão — por
  // isso o cast fica só nas listas, e o topo continua checado de verdade.
  const payload: DashboardData = {
    totalBooks,
    availableBooks,
    loanedBooks: activeLoans,
    activeReaders,
    activeLoans,
    overdueLoans,
    topBooks,
    recentLoans: recentLoans.map(shape) as unknown as Loan[],
    recentReturns: recentReturns.map(shape) as unknown as Loan[],
    overdue: overdue.map(shape) as unknown as Loan[],
  };
  return c.json(payload);
});
