import { readerEmbedSelect } from '../lib/reader-select';

/**
 * Include padrão de empréstimo (leitor + livro + responsável) — espelha loan.routes.
 * O leitor vem com `select` explícito: sem `passwordHash` (credencial) e sem
 * `signature`/`rubricImage` (PNG em base64, ~85 KB por leitor).
 */
export const loanInclude = {
  reader: { select: readerEmbedSelect },
  book: true,
  user: { select: { id: true, name: true } },
};
