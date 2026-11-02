import type { CatalogUpdateRow } from '@library/shared';

const NOT_INFORMED = 'Não informado';

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NOT_INFORMED;
  const text = String(value).replace(/\r?\n/g, ' ').trim();
  if (!text) return NOT_INFORMED;
  return text.replace(/\|/g, '\\|');
}

function header(generatedAt: Date): string[] {
  return [
    '# Livros sem ISBN',
    '',
    `Gerado em: ${generatedAt.toLocaleString('pt-BR')}`,
    '',
  ];
}

export function buildMissingIsbnReport(rows: CatalogUpdateRow[], generatedAt: Date): string {
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const lines = header(generatedAt);
  lines.push(`**Total de livros sem ISBN:** ${sorted.length}`);
  lines.push('');
  lines.push('| ID | Título | Autor(es) | Editora | Ano de publicação |');
  lines.push('|---:|---|---|---|---|');
  for (const row of sorted) {
    lines.push(
      `| ${row.bookId} | ${cell(row.title)} | ${cell(row.authors.join(', '))} | ${cell(
        row.publisher,
      )} | ${cell(row.publicationYear)} |`,
    );
  }
  if (sorted.length === 0) {
    lines.push('');
    lines.push('_Nenhum livro sem ISBN cadastrado._');
  }
  lines.push('');
  return lines.join('\n');
}

export function buildInvalidIsbnReport(rows: CatalogUpdateRow[], generatedAt: Date): string {
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const lines = [
    '# Livros com ISBN inválido',
    '',
    `Gerado em: ${generatedAt.toLocaleString('pt-BR')}`,
    '',
    `**Total de livros com ISBN inválido:** ${sorted.length}`,
    '',
    '| ID | Título | ISBN-10 | ISBN-13 | Motivo |',
    '|---:|---|---|---|---|',
  ];
  for (const row of sorted) {
    lines.push(
      `| ${row.bookId} | ${cell(row.title)} | ${cell(row.isbn10)} | ${cell(row.isbn13)} | ${cell(
        row.reason,
      )} |`,
    );
  }
  if (sorted.length === 0) {
    lines.push('');
    lines.push('_Nenhum ISBN inválido encontrado._');
  }
  lines.push('');
  return lines.join('\n');
}