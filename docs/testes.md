# Testes e validação

## Política anti-dados-mock (regra do projeto)

- É proibido dados mock/fictícios/placeholders no código de produção (listagens, gráficos, credenciais demo, seeds com dados institucionais falsos, fallbacks inventados).
- Fontes de dados em tempo de execução: apenas API/banco. Estados vazios reais ("Nenhum livro cadastrado") são obrigatórios.
- Primeiro acesso do administrador via `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- **Exceção**: fixtures de testes automatizados podem criar dados fictícios, identificados como TEST e removidos ao final (best-effort).

## Suite E2E via API — `apps/api/scripts/smoke.ts`

Sobe servidor próprio em porta efêmera (não precisa rodar a API antes) e testa via HTTP real:

```bash
pnpm --filter @library/api smoke
```

Cobre **62 casos**, incluindo:

- Login, RBAC (ADMIN × ATTENDANT), token inválido/expirado, rate limit
- CRUD de livros, autores, categorias, leitores, usuários
- ISBN (validação, duplicado → 409, normalize) e `GET /books/exists`
- Badge `hasActiveLoan`, catálogo público e filtro de disponibilidade
- Campos expandidos do livro (volume, cdd, cutter, physicalLocation, availableCopies, acquisitionType)
- Autores e categorias com cadastro automático (criação e reuso case-insensitive)
- Empréstimo individual e em lote (limites, livro emprestado/reservado/arquivado, duplicados, prazo futuro, leitor bloqueado/atrasado, aborto atômico)
- Renovação (limite, atrasado, bloqueado, reserva pendente)
- Devolução com condição/observações e ativação de reserva (`AVAILABLE`)
- Reservas (criação, cancelamento, atendimento, expiração)
- Relatórios (todos os tipos) e exportação CSV
- Configurações e auditoria

Limpeza via `deleteMany` direto no `finally` (não exercita o `DELETE /readers/:id` LGPD — ver abaixo). Não cobre: expiração real de token, upload de backup, PDFs e `429` além do login.

> Não cobertos pelo smoke (validar manualmente quando mexer nessas áreas):
> rate limit de login (429), token expirado, exportação CSV (`GET /reports/export`),
> geração dos PDFs (`GET /loans/:id/term|return-term`) e upload/restauração de
> backup (`multer`).

As fixtures são criadas com nomes/emails marcados como `TEST` e removidas no `finally` de cada caso — ao final, o banco volta ao estado anterior.

## Testes específicos de funcionalidade

- `apps/api/scripts/delete-reader-e2e.ts` — 15 casos de exclusão de leitor (anonimização, bloqueio com empréstimos ativos, cancelamento de reservas, auditoria). Sem script npm; rodar com `pnpm --filter @library/api exec tsx scripts/delete-reader-e2e.ts` (backend rodando).

## Banco e scripts utilitários

- `pnpm --filter @library/api db:setup` (push + seed), `db:push`, `db:seed`, `db:dedupe` (`dedupe-books.ts`), `scripts/import-books.ts` (planilha), `scripts/check-users.ts` e `check-snapshots.ts` (diagnóstico).
- `scripts/review-categories/` — automação de categorias fora do smoke: `classify.py` (análise), `import.py` (importa aprovadas), `cleanup-legacy.py`. Ver `scripts/review-categories/README.md`.

## Typecheck, lint e build

```bash
pnpm typecheck                  # tipos em todos os workspaces
pnpm lint                       # ESLint (ignora gerados: Prisma, dist, node_modules)
pnpm build                      # shared -> API -> web (tipos + bundles)
node scripts/verify-workspaces.mjs   # workspaces resolvem + contratos existem
```

## Validação de UI (Chrome DevTools Protocol)

Fluxos de interface são validados com scripts temporários usando Edge headless + CDP (client `ws`), contra fixtures TEST:

- Técnica: setar inputs via native setter + disparar `input`; cliques em elementos com handlers `onMouseDown` (ex.: sugestões de autor) exigem `dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`.
- Scripts e perfis ficam em diretório temporário (ex.: `%TEMP%\opencode`) e são **removidos ao final**.
- Exemplos de fluxos já validados: empréstimo multi-livro (9 etapas), campo de autores com vírgula e autocomplete, login e navegação, cadastro público de leitor, catálogo e página de arquitetura (screenshots headless).

## Checklist de conclusão de tarefa (AGENTS.md)

1. Os dados exibidos vêm de fonte real (API/banco)?
2. Estados vazios e de erro estão implementados?
3. Não há fallback fictício em caso de ausência de dados?
4. Não há credenciais demo expostas na UI ou no seed?