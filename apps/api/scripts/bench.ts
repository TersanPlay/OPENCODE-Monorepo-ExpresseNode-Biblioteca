/**
 * Benchmark de latência dos endpoints de leitura — o complemento medido do
 * smoke (que valida comportamento). Só faz GET e não cria/altera nenhum dado,
 * então pode rodar contra produção.
 *
 *   BENCH_BASE_URL=https://biblioteca-api.exemplo.workers.dev \
 *   BENCH_EMAIL=admin@exemplo.com BENCH_PASSWORD=... \
 *   pnpm --filter @library/api bench
 *
 * Saída: p50/p95/p99 por endpoint + tamanho do payload. Use para comparar
 * antes/depois de uma otimização (ver docs/performance.md).
 */
import 'dotenv/config';

const BASE = (process.env.BENCH_BASE_URL || 'http://localhost:3333').replace(/\/$/, '');
const EMAIL = process.env.BENCH_EMAIL;
const PASSWORD = process.env.BENCH_PASSWORD;
const N = Number(process.env.BENCH_ITERATIONS || 12);
const WARMUP = 2;

type Stat = { p50: number; p95: number; p99: number; bytes: number; status: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function time(path: string, token: string | null, iterations: number): Promise<Stat> {
  const times: number[] = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i < iterations + WARMUP; i++) {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const t0 = performance.now();
    const res = await fetch(BASE + path, { headers });
    const text = await res.text();
    const dt = performance.now() - t0;
    if (i >= WARMUP) {
      times.push(dt);
      bytes = Buffer.byteLength(text);
      status = res.status;
    }
  }
  times.sort((a, b) => a - b);
  return {
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    bytes,
    status,
  };
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

function fmtKb(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

async function main() {
  let token: string | null = null;
  if (EMAIL && PASSWORD) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const body = (await res.json()) as { token?: string };
    token = body.token ?? null;
    if (!token) throw new Error('login falhou — informe BENCH_EMAIL/BENCH_PASSWORD válidos');
  } else {
    console.log('! sem BENCH_EMAIL/BENCH_PASSWORD: só endpoints públicos serão medidos\n');
  }

  // ids reais para endpoints parametrizados (nada é criado)
  let readerId: number | null = null;
  let bookId: number | null = null;
  if (token) {
    const auth = { Authorization: `Bearer ${token}` };
    const readers = (await (await fetch(`${BASE}/api/readers?limit=1`, { headers: auth })).json()) as {
      items?: { id: number }[];
    };
    readerId = readers.items?.[0]?.id ?? null;
    const books = (await (await fetch(`${BASE}/api/books?limit=1`, { headers: auth })).json()) as {
      items?: { id: number }[];
    };
    bookId = books.items?.[0]?.id ?? null;
  }

  const targets: { path: string; auth: boolean }[] = [
    { path: '/api/health', auth: false },
    { path: '/api/settings', auth: true },
    { path: '/api/dashboard', auth: true },
    { path: '/api/books?limit=12', auth: true },
    { path: '/api/loans?limit=12', auth: true },
    { path: '/api/loans?pageSize=100', auth: true },
    { path: '/api/readers?limit=12', auth: true },
    { path: '/api/users?limit=12', auth: true },
    { path: '/api/audit?limit=20', auth: true },
    { path: '/api/reports?type=acervo', auth: true },
  ];
  if (readerId) {
    targets.push({ path: `/api/readers/${readerId}`, auth: true });
    targets.push({ path: `/api/loans/returns/pending`, auth: true });
  }
  if (bookId) targets.push({ path: `/api/books/${bookId}`, auth: true });

  const rows: { path: string; stat: Stat }[] = [];
  for (const t of targets) {
    if (t.auth && !token) continue;
    const stat = await time(t.path, t.auth ? token : null, N);
    rows.push({ path: t.path, stat });
    const flag = stat.status >= 400 ? '  <-- HTTP ' + stat.status : '';
    console.log(
      `${t.path.padEnd(34)} ${fmt(stat.p50).padStart(7)} ${fmt(stat.p95).padStart(7)} ` +
        `${fmt(stat.p99).padStart(7)}  ${fmtKb(stat.bytes).padStart(10)}${flag}`,
    );
  }

  console.log(`\n${N} iterações (+${WARMUP} warmup) contra ${BASE}`);
}

main().catch((err) => {
  console.error('bench falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
