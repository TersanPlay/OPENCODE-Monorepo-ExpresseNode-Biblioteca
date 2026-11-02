export interface IsbndbBook {
  title?: string;
  isbn10?: string | null;
  isbn13?: string;
  publisher?: string | null;
  language?: string | null;
  date_published?: string;
  edition_number?: number | null;
  pages?: number | null;
  synopsis?: string | null;
  image?: string | null;
  authors?: string[] | null;
}

export type IsbndbLookupResult =
  | { kind: 'found'; book: IsbndbBook }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string; status: number | null; fatal: boolean };

export type IsbndbBulkResult =
  | { kind: 'ok'; books: IsbndbBook[]; requested: number; waitSeconds: number }
  | { kind: 'error'; message: string; status: number | null; fatal: boolean; waitSeconds: number };

export interface IsbndbAccount {
  planName: string;
  dailyTotal: number | null;
  dailySpent: number | null;
  dailyLeft: number | null;
  waitSeconds: number;
}

export interface IsbndbClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_URL = 'https://api2.isbndb.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRY_DELAY_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
    }
  }
  // Sem Retry-After: backoff exponencial curto (1s, 2s, 4s...).
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      message?: unknown;
      errorMessage?: unknown;
    };
    const message = body.errorMessage ?? body.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // Corpo não-JSON: usa o status como mensagem.
  }
  return `HTTP ${res.status}`;
}

/**
 * Consulta `GET /book/{isbn}` com a chave no header Authorization (nunca na
 * query string). Trata timeout, 404, 401/403, 429 e 503 com retentativas
 * controladas; 429 diário e 401/403 são fatais e interrompem o lote.
 */
export async function lookupIsbndbBook(
  isbn: string,
  options: IsbndbClientOptions,
): Promise<IsbndbLookupResult> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return { kind: 'error', message: 'ISBNDB_API_KEY não configurada', status: null, fatal: true };
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const sleep = options.sleep ?? defaultSleep;
  const url = `${baseUrl}/book/${encodeURIComponent(isbn)}`;

  let lastMessage = 'Falha ao consultar a ISBNdb';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: apiKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (res.status === 404) {
        return { kind: 'not_found' };
      }

      if (res.status === 401 || res.status === 403) {
        const message = await readErrorMessage(res);
        return {
          kind: 'error',
          message: `Acesso à ISBNdb negado: ${message}`,
          status: res.status,
          fatal: true,
        };
      }

      if (res.status === 429) {
        const message = await readErrorMessage(res);
        if (/daily quota/i.test(message)) {
          return {
            kind: 'error',
            message: `Cota diária da ISBNdb esgotada: ${message}`,
            status: res.status,
            fatal: true,
          };
        }
        lastMessage = message;
        if (attempt < maxRetries) {
          await sleep(retryAfterMs(res, attempt));
          continue;
        }
        return {
          kind: 'error',
          message: `Limite de requisições da ISBNdb atingido: ${message}`,
          status: res.status,
          fatal: true,
        };
      }

      if (res.status === 503) {
        lastMessage = await readErrorMessage(res);
        if (attempt < maxRetries) {
          await sleep(retryAfterMs(res, attempt));
          continue;
        }
        return {
          kind: 'error',
          message: `ISBNdb indisponível: ${lastMessage}`,
          status: res.status,
          fatal: false,
        };
      }

      if (res.status === 400) {
        const message = await readErrorMessage(res);
        return {
          kind: 'error',
          message: `Requisição inválida para a ISBNdb: ${message}`,
          status: res.status,
          fatal: false,
        };
      }

      if (!res.ok) {
        lastMessage = await readErrorMessage(res);
        if (attempt < maxRetries && res.status >= 500) {
          await sleep(retryAfterMs(res, attempt));
          continue;
        }
        return {
          kind: 'error',
          message: `Erro da ISBNdb (${res.status}): ${lastMessage}`,
          status: res.status,
          fatal: false,
        };
      }

      const body = (await res.json()) as { book?: IsbndbBook } & IsbndbBook;
      const book = body.book ?? body;
      if (!book || typeof book !== 'object' || typeof book.title !== 'string') {
        return {
          kind: 'error',
          message: 'Resposta inválida da ISBNdb (livro ausente ou sem título)',
          status: res.status,
          fatal: false,
        };
      }
      return { kind: 'found', book };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastMessage = aborted
        ? `Tempo limite de ${timeoutMs}ms excedido`
        : err instanceof Error
          ? err.message
          : 'Falha de rede';
      if (attempt < maxRetries) {
        await sleep(Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS));
        continue;
      }
      return {
        kind: 'error',
        message: `Falha ao consultar a ISBNdb: ${lastMessage}`,
        status: null,
        fatal: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'error',
    message: `Falha ao consultar a ISBNdb: ${lastMessage}`,
    status: null,
    fatal: false,
  };
}
function parseRateWaitSeconds(res: Response): number {
  const header = res.headers.get('ratelimit');
  if (!header) return 0;
  // O header traz múltiplas janelas, ex.: `"rate";r=9;t=0, "daily";r=4000;t=56312`.
  // Só a janela `rate` interessa para o espaçamento entre requisições; a `daily`
  // (segundos até 00:00 UTC) não deve bloquear o processamento.
  let max = 0;
  for (const part of header.split(',')) {
    if (!/rate/i.test(part) || /daily/i.test(part)) continue;
    const match = part.match(/t=(\d+)/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

/**
 * Consulta vários ISBNs no endpoint bulk (`POST /books`). No plano Basic o
 * limite é 100 ISBNs por requisição; cada ISBN conta na cota diária.
 */
export async function lookupIsbndbBooksBulk(
  isbns: string[],
  options: IsbndbClientOptions,
): Promise<IsbndbBulkResult> {
  if (isbns.length === 0) {
    return { kind: 'ok', books: [], requested: 0, waitSeconds: 0 };
  }

  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return {
      kind: 'error',
      message: 'ISBNDB_API_KEY não configurada',
      status: null,
      fatal: true,
      waitSeconds: 0,
    };
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = Math.max(0, options.maxRetries ?? 1);
  const sleep = options.sleep ?? defaultSleep;
  const url = `${baseUrl}/books`;

  let lastMessage = 'Falha ao consultar a ISBNdb';
  let waitSeconds = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isbns }),
        signal: controller.signal,
      });
      waitSeconds = parseRateWaitSeconds(res);

      if (res.status === 401 || res.status === 403) {
        return {
          kind: 'error',
          message: `Acesso à ISBNdb negado: ${await readErrorMessage(res)}`,
          status: res.status,
          fatal: true,
          waitSeconds,
        };
      }
      if (res.status === 429) {
        const message = await readErrorMessage(res);
        if (/daily quota/i.test(message)) {
          return {
            kind: 'error',
            message: `Cota diária da ISBNdb esgotada: ${message}`,
            status: res.status,
            fatal: true,
            waitSeconds,
          };
        }
        if (attempt < maxRetries) {
          await sleep(Math.max(retryAfterMs(res, attempt), waitSeconds * 1000));
          continue;
        }
        return {
          kind: 'error',
          message: `Limite de requisições da ISBNdb atingido: ${message}`,
          status: res.status,
          fatal: false,
          waitSeconds,
        };
      }
      if (res.status === 503) {
        lastMessage = await readErrorMessage(res);
        if (attempt < maxRetries) {
          await sleep(Math.max(retryAfterMs(res, attempt), waitSeconds * 1000));
          continue;
        }
        return {
          kind: 'error',
          message: `ISBNdb indisponível: ${lastMessage}`,
          status: res.status,
          fatal: false,
          waitSeconds,
        };
      }
      if (!res.ok) {
        return {
          kind: 'error',
          message: `Erro da ISBNdb (${res.status}): ${await readErrorMessage(res)}`,
          status: res.status,
          fatal: false,
          waitSeconds,
        };
      }

      const body = (await res.json()) as {
        data?: IsbndbBook[];
        requested?: number;
        total?: number;
      };
      if (!Array.isArray(body.data)) {
        return {
          kind: 'error',
          message: 'Resposta bulk inválida da ISBNdb',
          status: res.status,
          fatal: false,
          waitSeconds,
        };
      }
      return {
        kind: 'ok',
        books: body.data,
        requested: typeof body.requested === 'number' ? body.requested : isbns.length,
        waitSeconds,
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastMessage = aborted
        ? `Tempo limite de ${timeoutMs}ms excedido`
        : err instanceof Error
          ? err.message
          : 'Falha de rede';
      if (attempt < maxRetries) {
        await sleep(Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS));
        continue;
      }
      return {
        kind: 'error',
        message: `Falha ao consultar a ISBNdb: ${lastMessage}`,
        status: null,
        fatal: false,
        waitSeconds,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'error',
    message: `Falha ao consultar a ISBNdb: ${lastMessage}`,
    status: null,
    fatal: false,
    waitSeconds,
  };
}

/** Plano/cota restante (`GET /key`); não consome a cota diária. */
export async function fetchIsbndbAccount(
  options: IsbndbClientOptions,
): Promise<IsbndbAccount | null> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return null;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetch(`${baseUrl}/key`, {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      plan_name?: string;
      plan_limit?: { total?: number; spent?: number; left?: number };
    };
    return {
      planName: body.plan_name ?? 'desconhecido',
      dailyTotal: typeof body.plan_limit?.total === 'number' ? body.plan_limit.total : null,
      dailySpent: typeof body.plan_limit?.spent === 'number' ? body.plan_limit.spent : null,
      dailyLeft: typeof body.plan_limit?.left === 'number' ? body.plan_limit.left : null,
      waitSeconds: parseRateWaitSeconds(res),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
