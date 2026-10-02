# Módulos

## API — routers (`apps/api/src/modules/<dominio>/`)

| Módulo | Arquivo | Prefixo | Auth no módulo |
|---|---|---|---|
| Auth | `auth/auth.routes.ts` | `/api/auth` | login público; me/logout exigem auth |
| Users | `user/user.routes.ts` | `/api/users` | ADMIN (módulo inteiro) |
| Books | `book/book.routes.ts` | `/api/books` | leitura pública (incl. `GET /cover`, público com rate-limit); escrita com auth; `GET /exists` com auth |
| Authors | `author/author.routes.ts` | `/api/authors` | auth (qualquer staff, incl. escrita) |
| Categories | `category/category.routes.ts` | `/api/categories` | leitura pública; `?all=1` exige auth; escrita ADMIN |
| Readers | `reader/reader.routes.ts` | `/api/readers` | auth (DELETE: ADMIN); `POST /:id/password` qualquer staff |
| Reader Auth | `reader/reader-auth.routes.ts` | `/api/readers` | `/register`, `/login` e `/claim` públicos (rate-limit); `/me/*` com sessão de leitor |
| Loans | `loan/loan.routes.ts` | `/api/loans` | auth; `POST /returns/batch` e `GET /returns/pending` agrupados; termos (`GET /:id/term`, `/:id/return-term`, `/return-term/batch/:group`) aceitam staff ou dono |
| Reservations | `reservation/reservation.routes.ts` | `/api/reservations` | auth |
| Reports | `report/report.routes.ts` | `/api/reports` | ADMIN |
| Audit | `audit/audit.routes.ts` | `/api/audit` | ADMIN |
| Settings | `settings/settings.routes.ts` | `/api/settings` | GET público; PUT ADMIN |
| Dashboard | `dashboard/dashboard.routes.ts` | `/api/dashboard` | auth |
| Backup | `backup/backup.routes.ts` | `/api/backups` | ADMIN (módulo inteiro) |

### Helpers de domínio

- `loan/loan.routes.ts` — `assertBookEligible` (validação de livro para empréstimo, reutilizada no empréstimo individual e no lote), `ensureNumber` (gera `EMP-000123`), `buildLoanSnapshots` (snapshots de dados do leitor/livro/usuário no momento do empréstimo), `resolveLoanSignature` (desenho atualiza a salva; `useSavedSignature` reaproveita), `requireStaffOrLoanOwner` (termos: staff ou dono, `403` terceiros), `performReturn` + `applyAutoBlock` (núcleo da devolução unitária e em lote).
- `book/book.routes.ts` — `resolveAuthorNames`, `resolveCategoryNames` (find-or-create dentro da transação), `findDuplicateBook`/`duplicateConflict` (ISBN duplicado).
- `reader/reader.routes.ts` — `DELETE /:id` com anonimização LGPD (substitui dados pessoais incl. senha/assinatura, cancela reservas, **recusa** `409` se houver empréstimos ativos); `POST /:id/password` (balcão define senha do portal).
- `reader/reader-auth.routes.ts` — `POST /register|/login|/claim` públicos, `GET|PUT /me`, `POST /me/password`, `GET /me/loans|/me/reservations`, `POST /me/reservations|/me/reservations/:id/cancel`.
- `lib/overdue.ts` — `refreshOverdue`, `expireReservations`, `computeDueDate`, `addDays`.
- `lib/settings.ts` — `getSettings()` (regras + dados institucionais; defaults estruturais sem dados de demonstração).
- `lib/terms.ts` — `generateLoanTermPDF`, `generateReturnTermPDF` (imagem da assinatura ou linhas manuais), `generateBatchReturnTermPDF` (termo agrupado multi-livros).
- `lib/reader-auth.ts` — `signReaderToken`, `requireReader`, `publicReader` (remove `passwordHash`).
- `lib/cover.ts` — `resolveBookMetadata` (Amazon + Open Library/Google/Gutendex), `isbn13To10`.
- `lib/audit.ts` — `writeAudit`.
- `backup/backup.routes.ts` — `createBackup` (VACUUM INTO), `rotateBackups` (mantém 5), `startBackupCrons` (18:30 e 23:45), download e upload via multer.

## Web — rotas (`apps/web/src/app/router/routes.tsx`)

### Públicas (layout `PublicLayout`, sem login — exceto `/minha-conta`)

| Rota | Página |
|---|---|
| `/` | Home |
| `/catalogo` | Catálogo de livros (busca + ordenação na mesma linha; sem card de filtros) |
| `/livros/:id` | Detalhe do livro público (reserva p/ leitor logado) |
| `/cadastro` | Autocadastro de leitor (página própria, fora do `PublicLayout`) |
| `/minha-conta` | Portal do leitor (guarda `RequireReader`, dentro do `PublicLayout`) |
| `/arquitetura` | Arquitetura do sistema (visão geral + stack; sem Estrutura/Fluxo) |

### Autenticadas (guarda `RequireAuth` + `AdminLayout`)

| Rota | Página | Guarda extra |
|---|---|---|
| `/admin` | Dashboard (métricas, empréstimos recentes, devoluções, atrasados, top livros) | — |
| `/admin/livros` | Lista de livros | — |
| `/admin/livros/novo` | Formulário de livro (com capa por ISBN, autores e categorias por vírgula) | — |
| `/admin/livros/:id/editar` | Formulário de livro (edição) | — |
| `/admin/emprestimos` | Lista de empréstimos | — |
| `/admin/emprestimos/novo` | Novo empréstimo (1 ou vários livros) | — |
| `/admin/devolucoes` | Devoluções agrupadas por leitor (busca + paginação) | — |
| `/admin/devolucoes/:readerId` | Detalhe p/ devolução (seleção unitária/todos, lote com termo agrupado) | — |
| `/admin/reservas` | Reservas (cancelar/atender) | — |
| `/admin/leitores` | Lista de leitores (criação/edição via dialog `ReaderFormDialog`) | — |
| `/admin/leitores/:id` | Detalhe do leitor (editar, bloquear/desbloquear, excluir, histórico) | — |
| `/admin/blocklist` | Lista de leitores bloqueados (busca, desbloqueio em lote) | — |
| `/admin/autores` | Autores | `RequireAdmin` |
| `/admin/categorias` | Categorias | `RequireAdmin` |
| `/admin/relatorios` | Relatórios (9 tipos + exportar CSV) | `RequireAdmin` |
| `/admin/usuarios` | Usuários do sistema | `RequireAdmin` |
| `/admin/configuracoes` | Configurações (limites + dados institucionais) | `RequireAdmin` |
| `/admin/auditoria` | Trilha de auditoria | `RequireAdmin` |
| `/admin/backup` | Backup & Restauração (download, upload, criar, restaurar, excluir) | `RequireAdmin` |

### Outras

| Rota | Página |
|---|---|
| `/login` | Login com abas Equipe/Leitor + primeiro acesso (claim) |
| `*` | 404 |

### Guardas (`apps/web/src/app/router/guards.tsx`)

- `RequireAuth` — redireciona a `/login` sem sessão; mostra spinner enquanto carrega.
- `RequireAdmin` — exige `role === 'ADMIN'`; redireciona atendente para `/admin`.
- `RequireReader` — exige sessão do portal (`useReaderSession`); redireciona a `/login`.

## Web — camadas (`apps/web/src/`)

### `services/api-client.ts`
Instância staff (`api`, `livraria_token`, `auth:unauthorized` exceto `/auth/login`) + instância isolada do portal (`apiReader`, `livraria_reader_token`, `reader:unauthorized` exceto `/readers/login|/readers/register`). (`services/axios.ts` reexporta este módulo por compatibilidade.)

### `features/<dominio>/`
Código real organizado por domínio: `api.ts` (clientes HTTP) + `pages/` (páginas). Domínios: `books`, `authors`, `categories`, `readers`, `loans`, `reservations`, `reports`, `users`, `audit`, `settings`, `dashboard`, `backups` — além de `auth/` (sessão), `hooks/` (`use-async-data`, `use-debounce`), `toast/` e `http.ts` (`Params` + `cleanPayload`).
- `features/api.ts` — barrel que reexporta todos os clientes: `booksApi`, `authorsApi`, `categoriesApi`, `readersApi` (inclui `block`, `unblock`, `unblockBatch`, `setStatus`, `remove`, `blocked`, `setSignature`, `setReaderPassword`), `loansApi` (inclui `createBatch`), `reservationsApi`, `reportsApi`, `usersApi`, `auditApi`, `settingsApi`, `dashboardApi`, `backupsApi` (inclui `download`, `restoreUpload`). Fora do barrel: `readers/portal-api.ts` (`readerPortalApi`: register/login/claim/me/reservas/termos do dono). Payloads limpos (campos vazios removidos); livro converte `BookFormValues` → `{ authorIds, authorNames, categoryIds, categoryNames }`.
- `auth/auth-provider.tsx` — sessão staff; `readers/reader-session.tsx` — sessão do portal (`ReaderSessionProvider`, `login/register/claim/logout/refresh`).
- `loans/components/` — `signature-pad.tsx` (captura via `signature_pad`) + `signature-field.tsx` (escolha salva × redesenhar).
- `hooks/use-async-data.ts` — hook genérico para carregamento de dados com loading/error/refetch.

### `components/`
- `layout/` — `admin-layout` (sidebar com regra própria de ícones: navegação em Flat Color Icons `react-icons/fc`, ações em Lucide — ver docs/arquitetura.md), `public-layout`, `book-cover`, `catalog-book-card`.
- `ui/` — shims que reexportam `@library/ui`; o código real do Design System (botões, badges de status, dialogs com `ConfirmDialog`, selects, tabs, switch, skeleton, tabela, paginação) vive em `packages/ui/src/`.

### `pages/`
- `public/` (home, catálogo, detalhe do livro, arquitetura, `register.tsx` do autocadastro), `auth/` (login Equipe/Leitor + claim), `not-found` — públicas e login/404.
- `reader/account.tsx` — portal (`ReaderAccountPage`, tabs empréstimos/reservas/dados).
- `admin/*` — shims que reexportam `features/<dominio>/pages/` (o router importa daqui e não mudou).
- Páginas em destaque: `readers/pages/reader-form-dialog.tsx` (dialog compartilhado de criação/edição de leitores), `readers/pages/reader-details.tsx` (tabs histórico/reservas com paginação 10/pág, botões de PDF via blob autenticado, botão Senha de acesso), `loans/pages/new-loan.tsx` (3 passos + preview do termo + assinatura obrigatória), `loans/pages/returns.tsx` (lista agrupada por leitor), `loans/pages/return-detail.tsx` (seleção unitária/todos, lote com condição/observações/assinatura e termo agrupado), `readers/pages/blocklist.tsx` (busca e desbloqueio em lote).

### `types/api.ts`
Reexporta `@library/shared`. Os tipos canônicos (`Book`, `Loan`, `Reader`, `ReaderDetail`, `BlockedReader`, `Reservation`, `User`, `Category`, `Author`, `AuditLog`, `ReportResult`, `LibrarySettings`, `DashboardData`, `Backup`, `Paginated<T>` etc.) vivem em `packages/shared/src/` junto dos schemas Zod.

## Mapa no monorepo (apps/api, apps/web, packages)

- Backend por domínio: `apps/api/src/modules/<dominio>/<dominio>.routes.ts` (mesmas rotas e regras; imports ajustados para a nova profundidade).
- Centralização backend: `apps/api/src/config/env.ts` (env + JWT), `apps/api/src/infrastructure/` (prisma, http, pdf, covers, audit, loans, settings — reexportam `lib/`/`middleware/`).
- Contratos: `packages/shared` (schemas Zod + tipos + constantes); `apps/api/src/validation.ts` expõe `parse()` e reexporta o shared; frontend usa `@library/shared` (tipos, ISBN/CPF) e `features/<dominio>/api.ts`.
- Design System: `packages/ui` (Radix); `apps/web/src/components/ui/*` são shims de compatibilidade.
- Páginas admin: código real em `apps/web/src/features/<dominio>/pages/`; `apps/web/src/pages/admin/*` reexportam (o router não mudou).
- Prisma Client gerado em `apps/api/src/generated/prisma` (`output` explícito no schema; `pnpm build` copia o runtime para `dist/`).

## Scripts (`scripts/`)

- `verify-workspaces.mjs` — checa monorepo (workspaces, `dist` do shared, resolução `@library/*`); `packages/config` é o ESLint compartilhado.
- `review-categories/` — automação de categorias: `taxonomy.json` (39 canônicas), `classify.py` (análise → `revisao-categorias.json`, sem escrita), `import.py` (importa aprovadas c/ backup e idempotência), `cleanup-legacy.py` (remove fora da taxonomia). Ver `scripts/review-categories/README.md`.
