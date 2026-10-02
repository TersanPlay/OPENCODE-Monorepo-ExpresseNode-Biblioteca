# Revisão de categorias do acervo — Etapa 1 (análise, sem escrita no banco)

Pipeline somente-leitura sobre `apps/api/prisma/dev.db`:

1. **Exporta** sinais por livro: título, subtítulo, descrição, ISBN, CDD, editora, autores, categorias atuais.
2. **Enriquece** via Open Library por ISBN (somente sem-CDD e buckets ambíguos: `028*`, `808*`, `860*`, `sem dewey`), com cache em `.ol-cache.json` (reprocessamento não reconsulta).
3. **Classifica** pela taxonomia de `taxonomy.json` (39 categorias canônicas):
   - CDD (Dewey, prefixo mais longo + centena + regras `8x1` poesia / `8x2` teatro),
   - keywords com word-boundary + overrides fortes (concurso, bíblia, gibi),
   - autores-âncora e subjects da Open Library.
4. **Grava** `revisao-categorias.json`: `{id, titulo, isbn, categoriaAtual[], categoriaRecomendada|null, status, motivos[], cdd, olSubjects[]}`.
   - `AUTO` — sinal único e consistente (apto à etapa 2 após amostragem).
   - `REVIEW` — conflito, bucket ambíguo ou sem consenso (decisão humana).
   - `INSUFFICIENT` — sem sinais (recomendação nula).

```bash
python scripts/review-categories/classify.py [--limit N] [--skip-enrich]
```

Etapa 2: importar aprovadas e atualizar livros (idempotente, com backup):

```bash
python scripts/review-categories/import.py [--apply] [--include-review] [--input revisao-categorias.json]
```

Sem `--apply`: dry-run (relata criaria/atualizaria). Com `--apply`: copia `dev.db`
para `pre-import-categorias-*.sqlite`, cria as canônicas inexistentes
(find-or-create por nome) e troca os vínculos dos livros aprovados pela categoria
recomendada (delete + insert; reprocesso detecta "já correto" e pula).
Padrão: só `AUTO`. Com `--include-review`: também `REVIEW` com recomendação.
`REVIEW` sem recomendação, `INSUFFICIENT` e arquivados ficam intactos.

Limpeza das legadas (fora da taxonomia — página `/admin/categorias` passa a listar só as canônicas):

```bash
python scripts/review-categories/cleanup-legacy.py [--apply]
```

Remove primeiro os vínculos e depois as categorias, com backup prévio. Livros
mantêm as canônicas que tiverem; os sem nenhuma ficam sem categoria (visíveis
na revisão como `categoriaAtual: []`).
