import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { authRouter } from './modules/auth/auth.routes';
import { userRouter } from './modules/user/user.routes';
import { bookRouter } from './modules/book/book.routes';
import { authorRouter } from './modules/author/author.routes';
import { categoryRouter } from './modules/category/category.routes';
import { readerRouter } from './modules/reader/reader.routes';
import { readerAuthRouter } from './modules/reader/reader-auth.routes';
import { loanRouter } from './modules/loan/loan.routes';
import { reservationRouter } from './modules/reservation/reservation.routes';
import { reportRouter } from './modules/report/report.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { backupRouter } from './modules/backup/backup.routes';
import { labelRouter } from './modules/label/label.routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

export const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
  }),
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'livraria-api' });
});

app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/books', bookRouter);
app.use('/api/authors', authorRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/readers', readerAuthRouter);
app.use('/api/readers', readerRouter);
app.use('/api/loans', loanRouter);
app.use('/api/reservations', reservationRouter);
app.use('/api/reports', reportRouter);
app.use('/api/audit', auditRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/backups', backupRouter);
app.use('/api/labels', labelRouter);

app.use(notFoundHandler);
app.use(errorHandler);