import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth } from '../../middleware/auth';
import { loanInclude } from '../loan/loan.routes';
import { refreshOverdue, MS_PER_DAY } from '../../lib/overdue';
import { stripLoanBlobs } from '../../lib/strip-signature-blobs';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

dashboardRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    await refreshOverdue();

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

    res.json({
      totalBooks,
      availableBooks,
      loanedBooks: activeLoans,
      activeReaders,
      activeLoans,
      overdueLoans,
      recentLoans: recentLoans.map((l) => ({
        ...stripLoanBlobs(l),
        loanDate: iso(l.loanDate),
        dueDate: iso(l.dueDate),
        returnedAt: iso(l.returnedAt),
        createdAt: iso(l.createdAt),
        updatedAt: iso(l.updatedAt),
      })),
      recentReturns: recentReturns.map((l) => ({
        ...stripLoanBlobs(l),
        loanDate: iso(l.loanDate),
        dueDate: iso(l.dueDate),
        returnedAt: iso(l.returnedAt),
        createdAt: iso(l.createdAt),
        updatedAt: iso(l.updatedAt),
      })),
      overdue: overdue.map((l) => ({
        ...stripLoanBlobs(l),
        loanDate: iso(l.loanDate),
        dueDate: iso(l.dueDate),
        returnedAt: iso(l.returnedAt),
        createdAt: iso(l.createdAt),
        updatedAt: iso(l.updatedAt),
      })),
      topBooks,
    });
  }),
);