# Arquitetura

## Visão geral

Aplicação web de duas camadas para gestão de biblioteca pública:

```
┌──────────────┐   HTTP/JSON (axios)   ┌──────────────┐   Prisma ORM   ┌────────────┐
│  Web         │ ─────────────────────► │  API         │ ─────────────► │  SQLite    │
│  React + Vite│ ◄───────────────────── │  Express API │ ◄───────────── │  dev.db    │
└──────────────┘        JWT Bearer      └──────────────┘                └────────────┘
   http://localhost:5173                   http://localhost:3333/api
```

- O frontend é uma SPA (Vite dev na porta 5173) com proxy `/api` → porta 3333 em desenvolvimento.
- O backend expõe uma API REST sob a URL base `/api` (porta 3333).
- O banco é SQLite via Prisma (`apps/api/prisma/dev.db`), preparado para migração a PostgreSQL.
- Autenticação stateless: JWT assinado, enviado como `Authorization: Bearer <token>`.

## Stack

### API (`apps/api/`)

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js + TypeScript (executado com `tsx watch`) |
| HTTP | Express 4 |
| ORM | Prisma 5 (`@prisma/client`) |
| Banco | SQLite (arquivo `dev.db`), schema em `prisma/schema.prisma` |
| Validação | Zod 3 (`src/validation.ts`: `parse()` + reexporta `@library/shared`) |
| Autenticação | JWT (`jsonwebtoken`) + bcryptjs |
| PDF | `pdfkit` (geração de termos de empréstimo e devolução) |
| Rate limit | `express-rate-limit` (login e consulta de capa) |
| Upload | `multer` (restauração de backup por arquivo local) |
| Cron | `node-cron` (backups automáticos 18:30 e 23:45) |

### Web (`apps/web/`)

| Camada | Tecnologia |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Estilo | Tailwind CSS 3 + Radix UI (dialogs, selects, tabs, switch) + Lucide React + Flat Color Icons (sidebar) + `signature_pad` (pad de assinatura) + `react-icons` |
| Formulários | React Hook Form + Zod resolvers |
| Rotas | React Router 6 |
| HTTP | Axios (`src/services/api-client.ts`; `axios.ts` reexporta por compatibilidade) |

### UI/UX

Metodologia UI Architect ASJ: canvas `#F2F2F0`, primary `#087F8C`, superfícies creme, hairline, motion refinado. Tokens em Tailwind (`apps/web/tailwind.config.ts`).

### Regra de ícones do sidebar (`AdminLayout`)

O sidebar tem biblioteca própria, diferente do resto da aplicação:

- **Navegação** (`navSections` em `components/layout/admin-layout.tsx`): Flat Color Icons — `import { FcX } from 'react-icons/fc'` ([flat-color-icons](https://github.com/icons8/flat-color-icons)). Tamanho `size-[17px]`, cores da própria lib (não aplicar classes `text-*` de cor).
- **Ações** (abrir/fechar menu, sair, dropdown do usuário): Lucide React.
- **Novos itens**: importar o ícone de `react-icons/fc` e registrar em `navSections` com `icon: FcNome`. Proibido Lucide ou emoji na navegação do sidebar.
- Mapa atual: Dashboard `FcComboChart`, Empréstimos `FcReading`, Devoluções `FcUndo`, Reservas `FcBookmark`, Livros `FcLibrary`, Autores `FcPortraitMode`, Categorias `FcOpenedFolder`, Leitores `FcConferenceCall`, BlockList `FcCancel`, Relatórios `FcLineChart`, Usuários `FcBusinessman`, Auditoria `FcInspection`, Backup `FcDatabase`, Configurações `FcSettings`.

## Estrutura de diretórios (monorepo pnpm)

```
apps/api/
  prisma/
    schema.prisma        Modelos do banco (`output` do client → `src/generated/prisma`)
    seed.ts              Bootstrap estrutural (config + admin via env)
  scripts/
    smoke.ts             Suite E2E via API (62 casos)
    import-books.ts      Importação de livros de planilha
    dedupe-books.ts      Utilitário de deduplicação de ISBN
    delete-reader-e2e.ts E2E de exclusão de leitor (via `tsx`, sem script npm)
    check-users.ts       Diagnóstico de usuários/senhas
    check-snapshots.ts   Diagnóstico de snapshots de empréstimo
    copy-generated.mjs   Copia o Prisma Client gerado para `dist/` no build
  src/
    server.ts            Bootstrap HTTP (usa `config/env.ts`)
    app.ts               Montagem dos routers, CORS, handlers de erro
    validation.ts        `parse()` + reexporta `@library/shared`
    config/env.ts        Env centralizado (`JWT_SECRET`, `READER_JWT_SECRET`, `JWT_EXPIRES`, `CORS_ORIGIN`, `PORT`, `NODE_ENV`) + `jwtSecret()`; sem `JWT_SECRET` o servidor aborta (fatal)
    infrastructure/      Reexports centrais: database (prisma), http
                         (http-error, async-handler, error-handler), pdf
                         (terms), covers, audit, loans (overdue), settings
    lib/                 Implementações: prisma, http-error, audit (writeAudit),
                         settings (getSettings), overdue (refreshOverdue,
                         expireReservations, computeDueDate), cover, terms (pdfkit),
                         reader-auth (sessão isolada do portal)
    middleware/          auth (signToken c/ `typ: 'staff'`, requireAuth barra outro `typ`, requireRoles),
                         login/cover rate-limit, error-handler, async-handler
    modules/<dominio>/   Um router por domínio (reader tem 2: staff + portal; ver docs/modulos.md)
  backups/               Backups do banco (.sqlite)

apps/web/
  src/
    app/router/          Rotas (routes.tsx) e guardas (guards.tsx)
    components/layout/   AdminLayout, PublicLayout, BookCover, CatalogBookCard
    features/<dominio>/  `api.ts` (clientes HTTP) + `pages/` (páginas); `readers/` tem ainda `portal-api.ts`, `reader-session.tsx`; `loans/components/` tem o pad de assinatura
    features/api.ts      Barrel que reexporta os clientes por domínio (portal fica fora do barrel)
    features/http.ts     `Params` + `cleanPayload`
    services/api-client.ts  Duas instâncias: staff (`livraria_token`, `auth:unauthorized`) + portal (`apiReader`, `livraria_reader_token`, `reader:unauthorized`)
    types/api.ts         Reexporta `@library/shared` (compatibilidade)
    pages/admin/*        Shims que reexportam `features/<dominio>/pages/`

packages/shared/         Tipos TS, schemas Zod e constantes (`@library/shared`);
                         build CJS em `dist/` (API); web consome o fonte via alias Vite
packages/ui/             Design System Radix + tokens (`@library/ui`)
packages/config/         ESLint compartilhado (`@library/config`)
```

## Fluxo de dados

1. A SPA chama os clientes de `features/<dominio>/api.ts` (ex.: `loansApi.createBatch`) ou do portal (`readers/portal-api.ts`).
2. O interceptor injeta `Authorization: Bearer <token>` do `localStorage` (`livraria_token` staff, `livraria_reader_token` portal).
3. O Express roteia para o módulo correspondente (`app.ts` monta `/api/<recurso>`; `/api/readers` tem 2 routers: staff e portal).
4. O corpo/query é validado com Zod (`parse`); falha → `400` com `{ error }`.
5. A rota executa a regra de negócio via Prisma (SQLite), geralmente em `$transaction`.
6. Toda mutação registra auditoria (`writeAudit`; fluxos self/automáticos usam `userId` nulo). Rotas de backup não auditam.
7. Erros conhecidos viram `HttpError`; o `errorHandler` devolve `{ error }` com status apropriado.
8. Em `401`, o interceptor limpa o token daquela sessão e emite `auth:unauthorized` (staff, exceto `/auth/login`) ou `reader:unauthorized` (portal, exceto `/readers/login|/readers/register`), que desconecta.

## Autenticação e sessão

- `POST /api/auth/login` valida e-mail/senha (bcrypt), emite JWT staff com `sub`, `role` e `typ: 'staff'`, expiração padrão **8 horas** (`JWT_EXPIRES`).
- Para evitar enumeração de e-mail, compara a senha contra um hash dummy quando o usuário não existe.
- `requireAuth` verifica o JWT, rejeita `typ` diferente de staff e **consulta o banco** a cada requisição: usuário deve existir e estar `ACTIVE`.
- `requireRoles(...)` restringe a rota a determinados papéis.
- Logout não revoga o token (sessão stateless); apenas registra auditoria. A revogação efetiva ocorre ao expirar ou ao usuário ser desativado (o `requireAuth` rejeita usuários `INACTIVE`).

## Portal do leitor (sessão isolada)

- Secret próprio (`READER_JWT_SECRET`, default derivado de `JWT_SECRET`); tokens com `typ: 'reader'` — não cruzam com staff mesmo com IDs iguais.
- `POST /readers/register|/login|/claim` públicos (rate-limit de login); `GET|PUT /me`, `POST /me/password`, `GET /me/loans|/me/reservations`, `POST /me/reservations|/me/reservations/:id/cancel` exigem `requireReader` (leitor `ACTIVE`, não excluído).
- Termos aceitam staff ou dono (`requireStaffOrLoanOwner`, `403` terceiros).

## RBAC

| Papel | Acesso |
|---|---|
| `ADMIN` | Tudo: dashboard, livros, empréstimos, devoluções, reservas, leitores, autores, categorias, relatórios, usuários, configurações, auditoria, backup |
| `ATTENDANT` | Dashboard, livros, empréstimos, devoluções, reservas, leitores, autores (consulta/criação), blocklist — **sem** usuários, relatórios, configurações, auditoria, categorias (escrita), backup |

Aplicação no backend: `requireRoles('ADMIN')` em users, categories (escrita), reports, audit, settings (PUT), reader DELETE, backup (módulo inteiro). Rotas de escrita de autores exigem só auth (qualquer staff). No frontend: guarda `RequireAdmin` envolve essas rotas; portal usa `RequireReader`.

## Auditoria

- `writeAudit(userId, action, entity, entityId, metadata, ip)` grava em `AuditLog`; falha de escrita não derruba a operação (log de erro).
- Ações registradas: `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `USER_CREATED`, `USER_UPDATED`, `USER_PASSWORD_RESET`, `BOOK_CREATED`, `BOOK_UPDATED`, `BOOK_ARCHIVED`, `BOOK_RESTORED`, `AUTHOR_CREATED`, `AUTHOR_UPDATED`, `AUTHOR_ACTIVATED`, `AUTHOR_INACTIVATED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED`, `CATEGORY_STATUS_CHANGED`, `READER_CREATED`, `READER_UPDATED`, `READER_STATUS_CHANGED`, `READER_DELETED`, `LOAN_CREATED`, `LOAN_RETURNED`, `LOAN_RENEWED`, `RESERVATION_CREATED`, `RESERVATION_CANCELLED`, `RESERVATION_FULFILLED`, `SETTINGS_UPDATED`.
- Consulta: `GET /api/audit` (ADMIN) com filtros por ação, usuário e período (`end` inclusivo); `GET /api/audit/actions` lista ações distintas.

## Backups

- Backups automáticos: `node-cron` agenda dois horários diários (18:30 e 23:45).
- Mecanismo: `VACUUM INTO` (SQLite 3.27+) — seguro com escritas concorrentes.
- Armazenamento: `apps/api/backups/` com arquivos `backup_YYYY-MM-DD_HH-mm.sqlite`.
- Rotação: mantém apenas os 5 backups mais recentes; os antigos são deletados automaticamente.
- Download: `GET /api/backups/:filename/download` — stream do arquivo via `res.download`.
- Rotas de lista/criação/remoção: `GET /api/backups`, `POST /api/backups` (`201 { filename, size }`), `DELETE /api/backups/:filename` (`400` nome inválido, `404` inexistente).
- Upload: `POST /api/backups/restore-upload` — multipart via `multer` (campo `file`, `.sqlite`/`.db`, máx. 100 MB). Storage temporário em `backups/.tmp/`.
- Restauração do servidor: `POST /api/backups/:filename/restore` — copia o arquivo sobre `dev.db`.
- Restauração local: copia o arquivo enviado sobre `dev.db` (requer restart do servidor).
- Extensão validada: regex no filename, `multer` fileFilter no upload.
- Endpoints protegidos: `requireAuth` + `requireRoles('ADMIN')` em todas as rotas.

## Rate limits

| Rota | Janela | Limite | Observação |
|---|---|---|---|
| `POST /api/auth/login` | 15 min | 10 tentativas | In-memory; reset ao reiniciar o servidor |
| `POST /api/readers/register\|/login\|/claim` | 15 min | 10 tentativas | Mesmo limiter do login staff |
| `GET /api/books/cover` | 15 min | 30 consultas | Rota pública; protege o scrap da Amazon |

## CORS

`app.ts` aceita `CORS_ORIGIN` (lista separada por vírgula); padrão `http://localhost:5173`.

## Tratamento de erros

Formato padrão de erro: `{ "error": "<mensagem>" }`.

| Situação | Status |
|---|---|
| Validação Zod (corpo ou query) | 400 |
| `HttpError` lançado pela regra de negócio | status próprio (400/401/403/404/409) |
| Prisma `P2002` (duplicado, ex.: ISBN) | 409 |
| Prisma `P2025` (registro inexistente) | 404 |
| Prisma `P2003` (FK inválida) | 400 |
| JSON malformado no corpo | 400 |
| Rota inexistente (`notFoundHandler`) | 404 |
| Qualquer outro | 500 |

## Consistência de prazos (overdue/reservas)

- `refreshOverdue()` marca como `OVERDUE` empréstimos `ACTIVE` com `dueDate` vencida e sem devolução. Roda em: `GET /loans`, `GET /loans/search`, `POST /loans`, `POST /loans/batch`, `GET /readers/:id`, `GET /dashboard`, `GET /reports`, portal `GET /readers/me/loans`.
- `expireReservations()` marca como `EXPIRED` reservas `PENDING` vencidas (`expiresAt` = 3 dias; `AVAILABLE` nunca expira sozinho). Roda em: `GET /reservations`, `GET /loans`, portal `GET /readers/me/reservations`.

## Ambiente

### API (`apps/api/.env`)

```
DATABASE_URL="file:./dev.db"
JWT_SECRET=<segredo forte>
JWT_EXPIRES=8h            # opcional
READER_JWT_SECRET=<segredo do portal>  # opcional; default = JWT_SECRET + sufixo
ADMIN_NAME=Administrador   # opcional
ADMIN_EMAIL=voce@dominio.com
ADMIN_PASSWORD=sua-senha
CORS_ORIGIN=http://localhost:5173   # opcional, lista separada por vírgula
PORT=3333                 # opcional
NODE_ENV=development      # opcional
```

> Use `file:./dev.db` (relativo, padrão do `.env.example`) ou caminho absoluto `file:C:/...` se o banco ficar fora do pacote. Sem `JWT_SECRET`, o servidor aborta com `[fatal]`.

> O seed **não cria usuário** sem `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Sem credenciais padrão — ver docs/regras-de-negocio.md.

### Web (`apps/web/.env`)

```
VITE_API_URL=http://localhost:3333/api   # opcional; padrão '/api' (proxy)
```

## Notas

- Buscas textuais no SQLite (Prisma `contains`) são case-sensitive: CPF, números e títulos devem ser digitados conforme cadastrados.
- Senhas com bcryptjs (compatível com bcrypt, sem dependência nativa no Windows).
- Comparação de nomes de autores para reaproveitamento é case-insensitive e feita em memória (o SQLite não suporta filtro `mode: 'insensitive'` no Prisma).
- SQLite não suporta enums do Prisma: campos como `acquisitionType` são validados por Zod na borda da API e armazenados como String.
