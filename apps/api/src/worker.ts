import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { notFound, onError } from './worker/errors';
import { corsOrigins } from './worker/env';
import { prismaMiddleware } from './worker/db';
import { authApp } from './worker/modules/auth';
import { backupApp } from './worker/modules/backup';
import { readerAuthApp } from './worker/modules/reader-auth';
import { readerApp } from './worker/modules/reader';
import { reservationApp } from './worker/modules/reservation';
import { loanApp } from './worker/modules/loan';
import { userApp } from './worker/modules/user';
import { authorApp } from './worker/modules/author';
import { bookApp } from './worker/modules/book';
import { categoryApp } from './worker/modules/category';
import { reportApp } from './worker/modules/report';
import { labelApp } from './worker/modules/label';
import { settingsApp } from './worker/modules/settings';
import { dashboardApp } from './worker/modules/dashboard';
import { auditApp } from './worker/modules/audit';
import type { AppEnv } from './worker/context';

const app = new Hono<AppEnv>();

app.use('*', prismaMiddleware);

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = corsOrigins(c.env);
      return allowed.includes(origin) ? origin : null;
    },
  }),
);

app.get('/api/health', (c) => c.json({ ok: true, service: 'livraria-api' }));

app.route('/api/auth', authApp);
app.route('/api/backups', backupApp);
app.route('/api/users', userApp);
app.route('/api/readers', readerAuthApp);
app.route('/api/readers', readerApp);
app.route('/api/books', bookApp);
app.route('/api/reservations', reservationApp);
app.route('/api/loans', loanApp);
app.route('/api/reports', reportApp);
app.route('/api/labels', labelApp);
app.route('/api/settings', settingsApp);
app.route('/api/authors', authorApp);
app.route('/api/categories', categoryApp);
app.route('/api/dashboard', dashboardApp);
app.route('/api/audit', auditApp);

app.notFound(notFound);
app.onError(onError);

export default app;
