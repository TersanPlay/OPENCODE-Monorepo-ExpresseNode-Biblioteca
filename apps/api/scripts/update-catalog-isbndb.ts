import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import prisma from '../src/lib/prisma';
import { env } from '../src/config/env';
import { CatalogUpdateJobManager } from '../src/lib/catalog-update/jobs';
import { FileCatalogUpdateJobStore } from '../src/lib/catalog-update/store-file';
import { runApplyJob, runSimulationJob } from '../src/lib/catalog-update/runner';
import {
  buildReportMarkdown,
  delayFromEnv,
  startApply,
  startSimulation,
} from '../src/lib/catalog-update/service';
import type { CatalogUpdateJobRecord } from '../src/lib/catalog-update/store';

interface Options {
  apply: boolean;
  yes: boolean;
  reportsOnly: boolean;
  limit: number | null;
  delayMs: number;
  bookIds: number[];
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    yes: false,
    reportsOnly: false,
    limit: null,
    delayMs: delayFromEnv(env.ISBNDB_DELAY_MS),
    bookIds: [],
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Valor ausente para ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--yes':
        options.yes = true;
        break;
      case '--reports-only':
        options.reportsOnly = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--limit': {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1) throw new Error('--limit deve ser >= 1');
        options.limit = value;
        break;
      }
      case '--delay': {
        const value = Number(next());
        if (!Number.isFinite(value) || value < 0) throw new Error('--delay deve ser >= 0');
        options.delayMs = value;
        break;
      }
      case '--book': {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1) throw new Error('--book deve ser um ID válido');
        options.bookIds.push(value);
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Uso: pnpm --filter @library/api catalog:update [opções]

Opções:
  --reports-only       Gera apenas os relatórios Markdown (não consulta a ISBNdb)
  --limit N            Processa no máximo N livros com ISBN válido
  --book ID            Processa apenas o livro informado (pode repetir)
  --delay MS           Intervalo entre chamadas à ISBNdb (padrão: ISBNDB_DELAY_MS ou 1100)
  --apply              Aplica as alterações simuladas (exige --yes)
  --yes                Confirma explicitamente a aplicação
  --json               Imprime o resumo final em JSON
  -h, --help           Mostra esta ajuda

Variáveis de ambiente:
  ISBNDB_API_KEY       Chave da ISBNdb (obrigatória para simular/atualizar)
  ISBNDB_DELAY_MS      Intervalo padrão entre chamadas (opcional)

Sem --apply, o script apenas simula (dry-run) e não altera o banco.`);
}

function formatSummary(job: CatalogUpdateJobRecord): string {
  const changed = job.rows.filter(
    (row) => (row.changes?.length ?? 0) > 0 || Boolean(row.authorChanges),
  ).length;
  return [
    `Execução ${job.id} (${job.mode}) — ${job.status}`,
    `  consultados: ${job.processed}/${job.total}`,
    `  encontrados: ${job.found}`,
    `  não encontrados: ${job.notFound}`,
    `  erros: ${job.errors}`,
    `  livros com alterações propostas: ${changed}`,
    `  chamadas à API: ${job.apiCalls}`,
    job.message ? `  mensagem: ${job.message}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function writeReports(outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  const missing = await buildReportMarkdown(prisma, 'missing');
  const invalid = await buildReportMarkdown(prisma, 'invalid');
  await fs.writeFile(path.join(outputDir, missing.filename), missing.markdown, 'utf8');
  await fs.writeFile(path.join(outputDir, invalid.filename), invalid.markdown, 'utf8');
  console.log(
    `Relatórios gerados em ${outputDir}: ${missing.filename} (${missing.total}), ${invalid.filename} (${invalid.total}).`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apiRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(apiRoot, '../..');
  const reportDir = path.resolve(repoRoot, 'relatorios');
  const jobStoreDir = path.resolve(apiRoot, 'backups/.catalog-updates');

  await writeReports(reportDir);

  if (options.reportsOnly) {
    return;
  }

  if (!env.ISBNDB_API_KEY) {
    throw new Error('ISBNDB_API_KEY não configurada em apps/api/.env');
  }
  if (options.apply && !options.yes) {
    throw new Error('Para aplicar alterações use --apply --yes (confirmação explícita).');
  }

  const manager = new CatalogUpdateJobManager(new FileCatalogUpdateJobStore(jobStoreDir));
  const { job, bookIds } = await startSimulation({
    manager,
    prisma,
    apiKey: env.ISBNDB_API_KEY,
    delayMs: options.delayMs,
    userId: null,
    limit: options.limit,
    bookIds: options.bookIds.length > 0 ? options.bookIds : undefined,
  });

  console.log(
    `Simulação ${job.id} iniciada para ${job.total} livro(s), delay de ${options.delayMs}ms entre chamadas.`,
  );

  const progress = setInterval(() => {
    const current = manager.getSummary(job.id);
    if (current?.status === 'RUNNING') {
      console.log(
        `  progresso: ${current.processed}/${current.total} (encontrados ${current.found}, erros ${current.errors})`,
      );
    }
  }, 10_000);

  try {
    await runSimulationJob({
      manager,
      prisma,
      jobId: job.id,
      apiKey: env.ISBNDB_API_KEY,
      delayMs: options.delayMs,
      userId: null,
      bookIds,
    });
  } finally {
    clearInterval(progress);
  }

  const simulated = await manager.get(job.id);
  if (!simulated) throw new Error('Simulação não encontrada após execução.');
  console.log(formatSummary(simulated));

  if (!options.apply) {
    if (options.json) {
      console.log(JSON.stringify({ simulation: simulated.id, status: simulated.status }));
    }
    console.log('Dry-run concluído. Nenhuma alteração foi gravada no banco.');
    return;
  }

  if (simulated.status !== 'COMPLETED') {
    throw new Error('Simulação não foi concluída; aplicação cancelada.');
  }
  const candidates = simulated.rows.filter(
    (row) => row.queryStatus === 'FOUND' && ((row.changes?.length ?? 0) > 0 || row.authorChanges),
  );
  if (candidates.length === 0) {
    console.log('Nenhuma alteração para aplicar.');
    return;
  }

  const applied = await startApply({
    manager,
    prisma,
    simulationId: simulated.id,
    userId: null,
    confirm: true,
  });
  await runApplyJob({
    manager,
    prisma,
    jobId: applied.job.id,
    simulation: applied.simulation,
    userId: null,
  });

  const result = await manager.get(applied.job.id);
  if (!result) throw new Error('Execução de aplicação não encontrada.');
  console.log(formatSummary(result));

  if (options.json) {
    console.log(
      JSON.stringify({
        simulation: simulated.id,
        apply: result.id,
        updated: result.updated,
        conflicts: result.conflicts,
        errors: result.errors,
      }),
    );
  }
}

main()
  .catch((err) => {
    console.error('[catalog-update]', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());