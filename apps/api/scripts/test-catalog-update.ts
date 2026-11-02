import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CatalogUpdateRow } from '@library/shared';
import { CatalogUpdateJobManager } from '../src/lib/catalog-update/jobs';
import { FileCatalogUpdateJobStore } from '../src/lib/catalog-update/store-file';
import { startSimulation } from '../src/lib/catalog-update/service';
import { bulkSizeForPlan } from '../src/lib/catalog-update/simulation';
import type { PrismaClient } from '../src/generated/prisma';
import { fetchIsbndbAccount, lookupIsbndbBook, lookupIsbndbBooksBulk } from '../src/lib/catalog-update/isbndb-client';
import {
  buildBookProposal,
  detectConflict,
  type BookSnapshot,
} from '../src/lib/catalog-update/mapper';
import {
  isbn10To13,
  isbn13To10,
  isbnEquivalent,
  selectBookIsbn,
} from '../src/lib/catalog-update/isbn';
import { normalizeLanguage } from '../src/lib/catalog-update/language';
import {
  computeCounts,
  deriveRowState,
  isCompletedProcessStatus,
} from '../src/lib/catalog-update/analysis';
import {
  buildInvalidIsbnReport,
  buildMissingIsbnReport,
} from '../src/lib/catalog-update/reports';

let passed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

function snapshot(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    id: 1,
    title: 'Livro de Teste',
    isbn10: null,
    isbn13: null,
    description: null,
    publisher: null,
    edition: null,
    publicationYear: null,
    language: null,
    pages: null,
    coverUrl: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    authors: [],
    ...overrides,
  };
}

test('ISBN-10/13 round-trip e equivalência', () => {
  assert.equal(isbn13To10('9780134093413'), '0134093410');
  assert.equal(isbn10To13('0134093410'), '9780134093413');
  assert.equal(isbnEquivalent('0134093410', '9780134093413'), true);
  assert.equal(isbnEquivalent('0134093410', '0134093410'), true);
  assert.equal(isbnEquivalent('8535910662', '9780134093413'), false);
});

test('seleção de ISBN prioriza 13, usa 10 como alternativa e rejeita inválidos', () => {
  assert.deepEqual(selectBookIsbn({ isbn10: '0134093410', isbn13: '9780134093413' }), {
    status: 'VALID_ISBN',
    isbnUsed: '9780134093413',
    reason: null,
  });
  assert.equal(
    selectBookIsbn({ isbn10: '0134093410', isbn13: null }).isbnUsed,
    '0134093410',
  );
  assert.equal(selectBookIsbn({ isbn10: null, isbn13: null }).status, 'MISSING_ISBN');
  assert.equal(
    selectBookIsbn({ isbn10: null, isbn13: '9780134093419' }).status,
    'INVALID_ISBN',
  );
  assert.equal(
    selectBookIsbn({ isbn10: '0134093419', isbn13: '9780134093413' }).status,
    'INVALID_ISBN',
  );
});

test('tamanho de lote por plano', () => {
  assert.equal(bulkSizeForPlan('Basic'), 100);
  assert.equal(bulkSizeForPlan('Academic'), 10);
  assert.equal(bulkSizeForPlan('Pro'), 1000);
  assert.equal(bulkSizeForPlan(null), 100);
});

test('normalização de idioma', () => {
  assert.equal(normalizeLanguage('por'), 'Português');
  assert.equal(normalizeLanguage('pt-br'), 'Português');
  assert.equal(normalizeLanguage('eng'), 'Inglês');
  assert.equal(normalizeLanguage('fra'), 'Francês');
  assert.equal(normalizeLanguage('xyz'), null);
  assert.equal(normalizeLanguage(''), null);
});

test('proposta preenche campos mapeados e ignora vazios', () => {
  const proposal = buildBookProposal(snapshot(), {
    title: 'Novo Título',
    isbn10: '0134093410',
    isbn13: '9780134093413',
    publisher: 'Editora X',
    date_published: '2008-03-01',
    edition_number: 2,
    language: 'por',
    pages: 256,
    synopsis: 'Uma sinopse suficientemente longa para ser considerada válida.',
    image: 'https://example.com/capa.jpg',
    authors: ['Machado de Assis', 'Machado de Assis '],
  });

  const byField = new Map(proposal.changes.map((change) => [change.field, change]));
  assert.equal(byField.get('title')?.next, 'Novo Título');
  assert.equal(byField.get('isbn10')?.next, '0134093410');
  assert.equal(byField.get('isbn13')?.next, '9780134093413');
  assert.equal(byField.get('publisher')?.next, 'Editora X');
  assert.equal(byField.get('publicationYear')?.next, 2008);
  assert.equal(byField.get('edition')?.next, 2);
  assert.equal(byField.get('language')?.next, 'Português');
  assert.equal(byField.get('pages')?.next, 256);
  assert.ok(byField.has('description'));
  assert.ok(byField.has('coverUrl'));
  assert.deepEqual(proposal.authorChanges, {
    current: [],
    next: ['Machado de Assis'],
  });
  assert.equal(byField.has('cdd'), false);
  assert.equal(byField.has('cutter'), false);
  assert.equal(byField.has('subtitle'), false);
  assert.equal(byField.has('volume'), false);
});

test('proposta não sobrescreve ISBN existente nem capa existente', () => {
  const proposal = buildBookProposal(
    snapshot({ isbn13: '9780134093413', coverUrl: 'https://atual/capa.jpg' }),
    { isbn13: '9788535910667', image: 'https://nova/capa.jpg' },
  );
  const fields = proposal.changes.map((change) => change.field);
  assert.equal(fields.includes('isbn13'), false);
  assert.equal(fields.includes('coverUrl'), false);
});

test('proposta evita rebaixar título/descrição e aceita sinopse mais rica', () => {
  const currentDescription = 'Descrição atual consideravelmente mais longa que a nova.';
  const proposal = buildBookProposal(
    snapshot({
      title: 'Dom Casmurro: edição comentada',
      description: currentDescription,
    }),
    {
      title: 'Dom Casmurro',
      synopsis: 'Curta.',
    },
  );
  const fields = proposal.changes.map((change) => change.field);
  assert.equal(fields.includes('title'), false);
  assert.equal(fields.includes('description'), false);

  const richer = buildBookProposal(
    snapshot({ description: 'Curta.' }),
    { synopsis: 'Uma descrição bem mais completa e detalhada sobre a obra e seu contexto.' },
  );
  assert.ok(richer.changes.some((change) => change.field === 'description'));
});

test('proposta ignora autores iguais (case-insensitive)', () => {
  const proposal = buildBookProposal(snapshot({ authors: ['Machado de Assis'] }), {
    authors: ['machado de assis'],
  });
  assert.equal(proposal.authorChanges, null);
});

test('detectConflict compara versão e valores simulados', () => {
  const base = snapshot({ publisher: 'Editora A' });
  const row: CatalogUpdateRow = {
    bookId: 1,
    title: base.title,
    authors: [],
    publisher: base.publisher,
    publicationYear: null,
    isbn10: null,
    isbn13: null,
    isbnUsed: null,
    status: 'VALID_ISBN',
    reason: null,
    bookUpdatedAt: (base.updatedAt as Date).toISOString(),
    changes: [{ field: 'publisher', label: 'Editora', current: 'Editora A', next: 'Editora B' }],
  };
  assert.equal(detectConflict(base, row), null);

  const changedAt = snapshot({
    publisher: 'Editora A',
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  assert.match(detectConflict(changedAt, row) ?? '', /alterado depois da simulação/);

  const changedField = snapshot({ publisher: 'Editora C' });
  assert.match(detectConflict(changedField, row) ?? '', /Campos alterados/);
});

function analysisRow(overrides: Partial<CatalogUpdateRow> = {}): CatalogUpdateRow {
  return {
    bookId: 1,
    title: 'Livro',
    authors: [],
    publisher: null,
    publicationYear: null,
    isbn10: null,
    isbn13: '9780134093413',
    isbnUsed: '9780134093413',
    status: 'VALID_ISBN',
    reason: null,
    bookUpdatedAt: '2026-01-01T00:00:00.000Z',
    processStatus: null,
    catalogUpdatedAt: null,
    catalogUpdateSource: null,
    catalogUpdateMessage: null,
    catalogUpdateFields: [],
    catalogUpdateJobId: null,
    rowState: 'PENDING',
    pendingReason: 'Ainda não processado.',
    ...overrides,
  };
}

test('estado persistido separa pendentes, concluídos e sem ISBN', () => {
  const base = {
    isbn10: null,
    isbn13: '9780134093413',
    catalogUpdateStatus: null,
    catalogUpdateMessage: null,
  };
  assert.equal(deriveRowState(base).rowState, 'PENDING');
  assert.equal(deriveRowState({ ...base, catalogUpdateStatus: 'UPDATED' }).rowState, 'UPDATED');
  assert.equal(deriveRowState({ ...base, catalogUpdateStatus: 'UNCHANGED' }).rowState, 'UPDATED');
  assert.equal(
    deriveRowState({ ...base, catalogUpdateStatus: 'NOT_FOUND', catalogUpdateMessage: '404' })
      .rowState,
    'PENDING',
  );
  assert.equal(
    deriveRowState({ isbn10: null, isbn13: null, catalogUpdateStatus: null, catalogUpdateMessage: null })
      .rowState,
    'MISSING_ISBN',
  );
  assert.equal(
    deriveRowState({
      isbn10: null,
      isbn13: '123',
      catalogUpdateStatus: null,
      catalogUpdateMessage: null,
    }).rowState,
    'PENDING',
  );

  assert.equal(isCompletedProcessStatus('UPDATED'), true);
  assert.equal(isCompletedProcessStatus('UNCHANGED'), true);
  assert.equal(isCompletedProcessStatus('NOT_FOUND'), false);
  assert.equal(isCompletedProcessStatus('ERROR'), false);
  assert.equal(isCompletedProcessStatus(null), false);
});

test('contadores não classificam concluídos como pendentes', () => {
  const counts = computeCounts([
    analysisRow({ bookId: 1, status: 'MISSING_ISBN', rowState: 'MISSING_ISBN', isbnUsed: null }),
    analysisRow({ bookId: 2 }),
    analysisRow({ bookId: 3, processStatus: 'UPDATED', rowState: 'UPDATED' }),
    analysisRow({ bookId: 4, processStatus: 'UNCHANGED', rowState: 'UPDATED' }),
    analysisRow({ bookId: 5, processStatus: 'NOT_FOUND' }),
    analysisRow({ bookId: 6, processStatus: 'ERROR' }),
  ]);
  assert.equal(counts.totalBooks, 6);
  assert.equal(counts.withValidIsbn, 5);
  assert.equal(counts.withoutIsbn, 1);
  assert.equal(counts.pending, 3);
  assert.equal(counts.completed, 2);
  assert.equal(counts.updated, 1);
  assert.equal(counts.unchanged, 1);
  assert.equal(counts.notFound, 1);
  assert.equal(counts.errors, 1);
});

test('relatórios Markdown usam dados reais e "Não informado"', () => {
  const rows: CatalogUpdateRow[] = [
    {
      bookId: 2,
      title: 'Sem editora',
      authors: ['Autora B'],
      publisher: null,
      publicationYear: null,
      isbn10: null,
      isbn13: null,
      isbnUsed: null,
      status: 'MISSING_ISBN',
      reason: null,
      bookUpdatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      bookId: 1,
      title: 'Com editora',
      authors: ['Autor A'],
      publisher: 'Editora A',
      publicationYear: 2001,
      isbn10: null,
      isbn13: null,
      isbnUsed: null,
      status: 'MISSING_ISBN',
      reason: null,
      bookUpdatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const markdown = buildMissingIsbnReport(rows, new Date('2026-02-01T12:00:00.000Z'));
  assert.match(markdown, /\*\*Total de livros sem ISBN:\*\* 2/);
  assert.match(markdown, /Não informado/);
  assert.ok(markdown.indexOf('Com editora') < markdown.indexOf('Sem editora'));

  const invalid = buildInvalidIsbnReport(
    [
      {
        bookId: 3,
        title: 'Inválido',
        authors: [],
        publisher: null,
        publicationYear: null,
        isbn10: '123',
        isbn13: null,
        isbnUsed: null,
        status: 'INVALID_ISBN',
        reason: 'ISBN-10 inválido: 123',
        bookUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    new Date('2026-02-01T12:00:00.000Z'),
  );
  assert.match(invalid, /ISBN-10 inválido: 123/);
  assert.match(invalid, /\*\*Total de livros com ISBN inválido:\*\* 1/);
});

async function testIsbndbClient(): Promise<void> {
  let lastAuth: string | undefined;
  let calls = 0;
const server = createServer((req, res) => {
    calls += 1;
    lastAuth = req.headers.authorization;
    if (req.url === '/key') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ratelimit: '"rate";r=9;t=0',
      });
      res.end(
        JSON.stringify({
          plan_name: 'Basic',
          plan_limit: { total: 5000, spent: 100, left: 4900 },
        }),
      );
      return;
    }
    if (req.url === '/books') {
      res.writeHead(200, { 'Content-Type': 'application/json', ratelimit: '"rate";r=8;t=0' });
      res.end(
        JSON.stringify({
          total: 1,
          requested: 2,
          data: [
            {
              title: 'Livro Bulk',
              isbn13: '9780134093413',
              isbn10: '0134093410',
              authors: ['Autor Bulk'],
            },
          ],
        }),
      );
      return;
    }
    if (req.url?.includes('not-found')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Book not found', errorMessage: 'Book not found' }));
      return;
    }
    if (req.url?.includes('unauthorized')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Bad credentials.', errorMessage: 'Bad credentials.' }));
      return;
    }
    if (req.url?.includes('daily')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          message: 'Daily quota exceeded, please try again later',
          errorMessage: 'Daily quota exceeded, please try again later',
        }),
      );
      return;
    }
    if (req.url?.includes('retry') && calls === 1) {
      res.writeHead(503, { 'Retry-After': '0' });
      res.end('unavailable');
      return;
    }
    if (req.url?.includes('bad-json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not-json');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        book: {
          title: 'Livro ISBNdb',
          isbn13: '9780134093413',
          isbn10: '0134093410',
          publisher: 'Pearson',
          language: 'eng',
          date_published: '2017',
          edition_number: 11,
          pages: 1488,
          synopsis: 'Sinopse de teste suficientemente longa.',
          image: 'https://example.com/cover.jpg',
          authors: ['Autor A', 'Autor B'],
        },
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const options = { apiKey: 'test-key', baseUrl, maxRetries: 1, sleep: async () => undefined };

  try {
    const found = await lookupIsbndbBook('9780134093413', options);
    assert.equal(found.kind, 'found');
    if (found.kind === 'found') assert.equal(found.book.title, 'Livro ISBNdb');
    assert.equal(lastAuth, 'test-key');

    const missing = await lookupIsbndbBook('not-found', options);
    assert.equal(missing.kind, 'not_found');

    const unauthorized = await lookupIsbndbBook('unauthorized', options);
    assert.equal(unauthorized.kind, 'error');
    if (unauthorized.kind === 'error') assert.equal(unauthorized.fatal, true);

    const daily = await lookupIsbndbBook('daily', options);
    assert.equal(daily.kind, 'error');
    if (daily.kind === 'error') {
      assert.equal(daily.fatal, true);
      assert.match(daily.message, /Cota diária/);
    }

    calls = 0;
    const retried = await lookupIsbndbBook('retry', options);
    assert.equal(retried.kind, 'found');
    assert.equal(calls, 2);

const invalid = await lookupIsbndbBook('bad-json', options);
    assert.equal(invalid.kind, 'error');

    const account = await fetchIsbndbAccount(options);
    assert.equal(account?.planName, 'Basic');
    assert.equal(account?.dailyLeft, 4900);

    const bulk = await lookupIsbndbBooksBulk(['9780134093413', '9780000000000'], options);
    assert.equal(bulk.kind, 'ok');
    if (bulk.kind === 'ok') {
      assert.equal(bulk.requested, 2);
      assert.equal(bulk.books.length, 1);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testJobStore(): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-jobs-'));
  try {
    const store = new FileCatalogUpdateJobStore(directory);
    const manager = new CatalogUpdateJobManager(store);
    const job = await manager.start({
      mode: 'SIMULATE',
      status: 'RUNNING',
      userId: null,
      simulationId: null,
      total: 1,
      delayMs: 0,
      limit: 1,
    });
    await manager.appendRows(job.id, [
      {
        bookId: 10,
        title: 'Livro',
        authors: [],
        publisher: null,
        publicationYear: null,
        isbn10: null,
        isbn13: '9780134093413',
        isbnUsed: '9780134093413',
        status: 'VALID_ISBN',
        reason: null,
        bookUpdatedAt: '2026-01-01T00:00:00.000Z',
        queryStatus: 'FOUND',
        changes: [],
      },
    ]);
    await manager.saveProgress(job.id, { processed: 1, found: 1 });

    await assert.rejects(
      () =>
        manager.start({
          mode: 'APPLY',
          status: 'RUNNING',
          userId: null,
          simulationId: job.id,
          total: 1,
          delayMs: 0,
          limit: null,
        }),
      /em andamento/,
    );

    await manager.finish(job.id, { status: 'COMPLETED', processed: 1, found: 1 });
    const stored = await store.load(job.id);
    assert.equal(stored?.status, 'COMPLETED');
    assert.equal(stored?.rows.length, 1);
    assert.equal(await store.getActive(), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function testSimulationScope(): Promise<void> {
  const books = [
    { id: 1, isbn10: null, isbn13: '9780134093413', catalogUpdateStatus: 'UPDATED' },
    { id: 2, isbn10: null, isbn13: '9780134093413', catalogUpdateStatus: null },
    { id: 3, isbn10: null, isbn13: '9780134093413', catalogUpdateStatus: 'UNCHANGED' },
    { id: 4, isbn10: null, isbn13: '9780134093413', catalogUpdateStatus: 'NOT_FOUND' },
    { id: 5, isbn10: null, isbn13: null, catalogUpdateStatus: null },
    { id: 6, isbn10: null, isbn13: '123', catalogUpdateStatus: null },
  ];
  const prisma = {
    book: { findMany: async () => books },
  } as unknown as PrismaClient;

  const captured: { total: number }[] = [];
  const manager = {
    start: async (input: Record<string, unknown>) => {
      captured.push({ total: Number(input.total) });
      return {
        ...input,
        id: 'job-test',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        processed: 0,
        found: 0,
        notFound: 0,
        skipped: 0,
        errors: 0,
        changedBooks: 0,
        updated: 0,
        unchanged: 0,
        conflicts: 0,
        apiCalls: 0,
        message: null,
        rows: [],
      };
    },
  } as unknown as CatalogUpdateJobManager;

  const automatic = await startSimulation({
    manager,
    prisma,
    apiKey: 'test-key',
    delayMs: 0,
    userId: null,
    limit: null,
  });
  assert.deepEqual(automatic.bookIds, [2, 4]);
  assert.equal(captured[0].total, 2);

  const manual = await startSimulation({
    manager,
    prisma,
    apiKey: 'test-key',
    delayMs: 0,
    userId: null,
    limit: null,
    bookIds: [1],
  });
  assert.deepEqual(manual.bookIds, [1]);
  assert.equal(captured[1].total, 1);
}

testIsbndbClient()
  .then(() => {
    passed += 1;
    return testJobStore();
  })
  .then(() => {
    passed += 1;
    return testSimulationScope();
  })
  .then(() => {
    passed += 1;
    console.log(`${passed} teste(s) de atualização cadastral aprovados.`);
  })
  .catch((err) => {
    console.error('✗ cliente ISBNdb / store de jobs');
    console.error(err);
    process.exitCode = 1;
  });