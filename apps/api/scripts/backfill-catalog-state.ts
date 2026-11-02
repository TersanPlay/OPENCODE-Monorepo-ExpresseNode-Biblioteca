import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import prisma from '../src/lib/prisma';

/**
 * Backfill opcional e baseado em evidência: importa o estado de jobs APPLY já
 * concluídos (arquivos de job) para as colunas de controle em Book.
 *
 * Só grava quando o livro ainda não tem estado persistido (null), preservando
 * qualquer execução mais nova. Por padrão é dry-run.
 */
const APPLY_FLAG = process.argv.includes('--apply');

interface JobRow {
  bookId: number;
  applyStatus?: string | null;
  applyError?: string | null;
  changes?: { field: string }[];
  authorChanges?: unknown;
}

interface JobFile {
  id: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  rows: JobRow[];
}

const TARGET_STATUSES = ['UPDATED', 'UNCHANGED', 'NOT_FOUND', 'ERROR'] as const;

function messageFor(row: JobRow): string | null {
  if (row.applyStatus === 'NOT_FOUND') return row.applyError ?? 'Não encontrado na ISBNdb.';
  if (row.applyStatus === 'ERROR') return row.applyError ?? 'Falha na consulta à ISBNdb.';
  return null;
}

function fieldsFor(row: JobRow): string[] | null {
  if (row.applyStatus !== 'UPDATED') return null;
  const fields = (row.changes ?? []).map((change) => change.field);
  if (row.authorChanges) fields.push('authors');
  return fields;
}

async function main(): Promise<void> {
  const directory = path.resolve(process.cwd(), 'backups/.catalog-updates');
  const entries = await fs.readdir(directory).catch(() => [] as string[]);
  const jobs: JobFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry === 'active.json') continue;
    try {
      const job = JSON.parse(
        await fs.readFile(path.join(directory, entry), 'utf8'),
      ) as JobFile;
      if (job.mode === 'APPLY' && job.status === 'COMPLETED') jobs.push(job);
    } catch {
      // Ignora arquivos inválidos; o comando apenas relata o que conseguiu ler.
    }
  }

  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let errors = 0;
  let skipped = 0;

  for (const job of jobs) {
    const when = new Date(job.finishedAt ?? job.startedAt);
    for (const row of job.rows ?? []) {
      const status = row.applyStatus as (typeof TARGET_STATUSES)[number] | undefined;
      if (!status || !TARGET_STATUSES.includes(status)) {
        skipped += 1;
        continue;
      }
      const book = await prisma.book.findUnique({
        where: { id: row.bookId },
        select: { id: true, catalogUpdateStatus: true },
      });
      if (!book || book.catalogUpdateStatus) {
        skipped += 1;
        continue;
      }

      const data = {
        catalogUpdateStatus: status,
        catalogUpdatedAt: when,
        catalogUpdateSource: 'ISBNDB',
        catalogUpdateMessage: messageFor(row),
        catalogUpdateFields: fieldsFor(row) ? JSON.stringify(fieldsFor(row)) : null,
        catalogUpdateJobId: job.id,
      };
      if (APPLY_FLAG) {
        await prisma.book.update({ where: { id: book.id }, data });
      }
      if (status === 'UPDATED') updated += 1;
      else if (status === 'UNCHANGED') unchanged += 1;
      else if (status === 'NOT_FOUND') notFound += 1;
      else errors += 1;
    }
  }

  console.log(
    `${APPLY_FLAG ? 'Backfill aplicado' : 'Dry-run (use --apply para gravar)'}: ` +
      `${updated} atualizados, ${unchanged} sem alterações, ${notFound} não encontrados, ` +
      `${errors} erros, ${skipped} ignorados (já possuem estado ou não se aplicam).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());