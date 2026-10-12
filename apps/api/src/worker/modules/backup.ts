import { Hono } from 'hono';
import { HttpError } from '../../lib/http-error';
import { requireAuth, requireRoles } from '../auth';
import type { AppEnv } from '../context';

/**
 * Backups no D1: a recuperação contínua é nativa (Time Travel, sem cron).
 * Este módulo gerencia cópias portáteis no R2 (colocadas via runbook
 * `wrangler d1 export` + `wrangler r2 object put`, ou upload pela UI).
 * Restauração de desastre = Time Travel no dashboard (ver docs).
 */
export const backupApp = new Hono<AppEnv>();

backupApp.use(requireAuth, requireRoles('ADMIN'));

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function checkName(filename: string): void {
  if (
    !filename ||
    filename.length > 180 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    !/^[A-Za-z0-9._-]+$/.test(filename) ||
    !/\.(sqlite|db|sql)$/i.test(filename)
  ) {
    throw new HttpError(400, 'Nome de arquivo inválido');
  }
}

backupApp.get('/', async (c) => {
  const listed = await c.env.BACKUPS.list();
  const items = (listed.objects ?? [])
    .map((o) => ({ filename: o.key, size: o.size, createdAt: o.uploaded.toISOString() }))
    .sort((a, b) => (a.filename < b.filename ? 1 : -1));
  return c.json(items);
});

backupApp.post('/', async (_c) => {
  // Snapshots sob demanda exigem export fora do Worker (CPU do plano Free
  // não comporta dump lógico; `DB.dump()` só vale p/ DBs alpha).
  // Recuperação contínua: Time Travel do D1 (automático).
  throw new HttpError(
    501,
    'Snapshot imediato indisponível no Worker. A proteção é contínua via Time Travel do D1; para cópia portátil use o runbook `wrangler d1 export` (ver docs).',
  );
});

backupApp.get('/:filename/download', async (c) => {
  const filename = c.req.param('filename');
  checkName(filename);
  const obj = await c.env.BACKUPS.get(filename);
  if (!obj) throw new HttpError(404, 'Backup não encontrado');
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

backupApp.post('/restore-upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) {
    throw new HttpError(400, 'Nenhum arquivo enviado');
  }
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.sqlite') && !lower.endsWith('.db') && !lower.endsWith('.sql')) {
    throw new HttpError(400, 'Formato inválido. Use arquivos .sqlite, .db ou .sql');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Arquivo excede 100 MB');
  }
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  const key = `upload-${Date.now()}-${safe}`;
  await c.env.BACKUPS.put(key, await file.arrayBuffer());
  return c.json({
    ok: true,
    filename: key,
    message:
      'Arquivo guardado. A ativação como banco ativo é feita pelo Time Travel do D1 no dashboard Cloudflare.',
  });
});

backupApp.post('/:filename/restore', async (c) => {
  const filename = c.req.param('filename');
  checkName(filename);
  const obj = await c.env.BACKUPS.head(filename);
  if (!obj) throw new HttpError(404, 'Backup não encontrado');
  throw new HttpError(
    501,
    'Restauração no D1 é feita pelo Time Travel no dashboard Cloudflare (Workers & Pages → D1 → biblioteca-publica).',
  );
});

backupApp.delete('/:filename', async (c) => {
  const filename = c.req.param('filename');
  checkName(filename);
  const obj = await c.env.BACKUPS.head(filename);
  if (!obj) throw new HttpError(404, 'Backup não encontrado');
  await c.env.BACKUPS.delete(filename);
  return c.json({ ok: true });
});
