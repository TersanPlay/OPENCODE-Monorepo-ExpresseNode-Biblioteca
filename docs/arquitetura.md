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

Em produção, a mesma API roda como Worker na Cloudflare (`apps/api/src/worker.ts`, Hono) com banco D1 (`biblioteca-publica`) — mesmo contrato, mesmas respostas, JWTs compatíveis nos dois sentidos. Ver "Worker + D1 (produção)" abaixo.

- O frontend é uma SPA (Vite dev na porta 5173) com proxy `/api` → porta 3333 em desenvolvimento.
- O backend expõe uma API REST sob a URL base `/api` (porta 3333).
- O banco é SQLite via Prisma (`apps/api/prisma/dev.db` no dev local; D1 `biblioteca-publica` em produção — mesmo schema). Formato de DateTime difere por runtime: o engine Node grava millis INTEGER; o adapter D1 grava ISO-8601 TEXT (único formato que o edge lê) — nunca cruzar dados crus entre os dois sem converter.
- Autenticação stateless: JWT assinado, enviado como `Authorization: Bearer <token>`.

## Stack

### API (`apps/api/`)

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js + TypeScript (executado com `tsx watch`) — dev local; Worker Cloudflare (Hono, `src/worker.ts`) — produção |
| HTTP | Express 4 (local) / Hono 4 (Worker) — mesmo contrato e respostas |
| ORM | Prisma 5 (`@prisma/client` + `@prisma/adapter-d1`, `previewFeatures = ["driverAdapters"]`) |
| Banco | SQLite local (`dev.db`) / D1 `biblioteca-publica` (produção); migrations em `prisma/migrations/` |
| Validação | Zod 3 (`src/validation.ts`: `parse()` + reexporta `@library/shared`) |
| Autenticação | JWT HS256 (`jose` no Worker, `jsonwebtoken` no Express — tokens compatíveis) + PBKDF2-SHA256 10k + pepper (`lib/password-hash.ts`) |
| PDF | `pdfkit` (geração de termos de empréstimo e devolução) |
| Rate limit | `express-rate-limit` (Express) / janela deslizante em memória (Worker) — login 10/15 min, capa 30/15 min |
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

## Worker + D1 (produção Cloudflare)

- Entrada: `apps/api/src/worker.ts` (Hono) — monta `/api/health` e os 15 domínios: `auth`, `users`, `readers` (portal + balcão), `books`, `reservations`, `loans`, `reports`, `labels`, `settings`, `audit`, `dashboard`, `categories`, `authors`, `backups`.
- `apps/api/src/worker/`: `env.ts` (vars/secrets + defaults iguais ao Express), `context.ts` (tipos `AppEnv`), `db.ts` (Prisma por requisição via binding `DB`), `http.ts` (`reqJson`, `clientIp`), `errors.ts` (mesmo mapa de erros do Express), `auth.ts` (JWT `jose`, `publicReader`), `rate-limit.ts` (janela deslizante), `mail.ts` (Email Sending via binding `EMAIL`), `modules/` (portagens dos 15 domínios).
- O código Express (`app.ts`, `modules/`) segue intacto para o dev local — libs compartilhadas aceitam client injetável (`writeAudit`, `create/consumeResetToken`, `refreshOverdue`, `expireReservations`).
- `apps/api/wrangler.jsonc`: worker `biblioteca-api`, `compatibility_date` atual, `compatibility_flags: ["nodejs_compat"]`, bindings `DB` → D1 `biblioteca-publica`, `BACKUPS` → R2 `biblioteca-backups`, `EMAIL` → Email Sending; `migrations_dir: prisma/migrations` (+ `migrations_pattern` p/ layout `0001_init/migration.sql`), observability (logs + traces).
- Banco: `prisma/migrations/0001_init/migration.sql` gerado via `prisma migrate diff --from-empty`; dados importados com datetimes em ISO-8601 (único formato legível no edge).
- Typecheck duplo: `tsc --noEmit` (Express, exclui `src/worker`) + `tsc --noEmit -p tsconfig.worker.json` (Worker, `types: []`, inclui `worker-configuration.d.ts` gerado por `wrangler types`).
- Dev local do Worker: `wrangler d1 migrations apply DB --local` + `wrangler dev --port 8787` (D1 local em `.wrangler/`, secrets em `.dev.vars` — ambos gitignored).

### Produção (implantado)

| Piece | Onde |
| --- | --- |
| Web (assets) | `https://biblioteca-publica-opencode-monorepo.tersandropbs.workers.dev` |
| API (Hono+D1) | `https://biblioteca-api.tersandropbs.workers.dev` (`/api/*`) |
| D1 | `biblioteca-publica` (`5fdd8892-2931-4325-8b15-fbfcc412eeff`) |
| R2 | `biblioteca-backups` |

- `JWT_SECRET` é **secret** (`wrangler secret put JWT_SECRET --name biblioteca-api`); o pepper de senha deriva dele (`${JWT_SECRET}#pepper`) — trocar o secret invalida senhas e sessões.
- O resto vai em `vars` no `wrangler.jsonc` (versionado): `JWT_EXPIRES`, `CORS_ORIGIN`, `FRONTEND_URL`, `MAIL_FROM`.
- Deploy da API (a partir de `apps/api`): `pnpm exec wrangler deploy`.
- Deploy do web: build com a URL da API embutida e upload de assets a partir de `apps/api` (o wrangler está lá):
  ```
  cd apps/web && VITE_API_URL=https://biblioteca-api.tersandropbs.workers.dev/api pnpm build
  cd ../api && pnpm exec wrangler deploy -c ../web/wrangler.toml
  ```
  `VITE_API_URL` é embutido no bundle em build time — trocar a URL exige rebuild.
- `wrangler login` (OAuth, device flow) é o pré-requisito de deploy; o `cf` CLI não lê `wrangler.jsonc` e não serve para o upload dos módulos.
- E-mail: exige sending domain habilitada no dashboard (zone `legismemory.com`) + DNS validado. Sem isso a recuperação de senha responde `503` (`E_SENDER_DOMAIN_NOT_CONFIGURED`) — o token OAuth disponível não tem permissão de zona para automatizar esse onboarding.

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
    migrations/          SQL p/ D1 (`0001_init/migration.sql` via `migrate diff --from-empty`)
    dev.db               SQLite local (gitignored)
  wrangler.jsonc         Worker `biblioteca-api`: binding D1 `DB`, migrations, observability
  worker-configuration.d.ts  Tipos gerados (`wrangler types`; commitado)
  .dev.vars              Secrets locais do `wrangler dev` (gitignored)
  scripts/
    smoke.ts             Suite E2E via API (80 casos)
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
    config/env.ts        Env centralizado (`JWT_SECRET`, `READER_JWT_SECRET`, `JWT_EXPIRES`, `PASSWORD_PEPPER`, `CORS_ORIGIN`, `PORT`, `NODE_ENV`, `SMTP_*`, `MAIL_FROM`, `FRONTEND_URL`) + `jwtSecret()`; sem `JWT_SECRET` o servidor aborta (fatal)
    infrastructure/      Reexports centrais: database (prisma), http
                         (http-error, async-handler, error-handler), pdf
                         (terms), covers, audit, loans (overdue), settings
    lib/                 Implementações: prisma (`createPrisma(db?)`: D1 via adapter no Worker, SQLite local no Express), http-error, audit (writeAudit aceita client injetável), password-hash (PBKDF2-SHA256 + pepper via WebCrypto; verifica bcrypt legado fora do Worker), password-reset (WebCrypto + client injetável), mail-content (template puro), settings (getSettings), overdue (refreshOverdue, expireReservations, computeDueDate — com client injetável), cover, terms (pdfkit),
                         reader-auth (sessão isolada do portal)
    worker/              Runtime Cloudflare: env, context, db (Prisma por requisição), http, errors, auth (`jose`), rate-limit, mail (stub 503), modules/ (portagens Hono)
    worker.ts            Entrada do Worker (monta `/api/*`, `notFound`/`onError`)
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

- `POST /api/auth/login` valida e-mail/senha (PBKDF2-SHA256 10k + pepper, ~5ms; ver Senhas abaixo), emite JWT staff com `sub`, `role` e `typ: 'staff'`, expiração padrão **8 horas** (`JWT_EXPIRES`). Hash bcrypt legado → `401` orientando redefinição (sem CPU p/ bcrypt no plano Free); login válido com parâmetros defasados faz re-hash transparente.
- Para evitar enumeração de e-mail, compara a senha contra um hash dummy quando o usuário não existe.
- `requireAuth` verifica o JWT, rejeita `typ` diferente de staff e **consulta o banco** a cada requisição: usuário deve existir e estar `ACTIVE`.
- `requireRoles(...)` restringe a rota a determinados papéis.
- Logout não revoga o token (sessão stateless); apenas registra auditoria. A revogação efetiva ocorre ao expirar ou ao usuário ser desativado (o `requireAuth` rejeita usuários `INACTIVE`).

## Senhas (PBKDF2)

- Algoritmo: PBKDF2-SHA256 via WebCrypto (Node 18+ e Workers), 10.000 iterações, salt aleatório 16 bytes, pepper HMAC (`PASSWORD_PEPPER`, default derivado de `JWT_SECRET`) — ~5ms, cabe no CPU do plano Free. Formato versionado `$pbkdf2$<versão>$<iterações>$<salt>$<hash>` (`apps/api/src/lib/password-hash.ts`: `hashPassword`, `verifyPassword` → `valid|invalid|legacy`, `needsRehash`, `DUMMY_PASSWORD_HASH`).
- Hashes bcrypt legados (`$2b$…`): no Worker retornam `legacy` → login responde `401` pedindo redefinição; fora do Worker (dev local) são conferidos de verdade via bcryptjs para não travar o fluxo. Login válido com hash defasado regrava em PBKDF2 (re-hash transparente).
- Rotação de `PASSWORD_PEPPER` (ou `JWT_SECRET` sem pepper dedicado) invalida todas as senhas — exige redefinição; não rotacionar casualmente.

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
PASSWORD_PEPPER=<segredo p/ senhas>  # opcional; default = JWT_SECRET + '#pepper' (NÃO rotacionar: invalida senhas)
READER_JWT_SECRET=<segredo do portal>  # opcional; default = JWT_SECRET + sufixo
ADMIN_NAME=Administrador   # opcional
ADMIN_EMAIL=voce@dominio.com
ADMIN_PASSWORD=sua-senha
CORS_ORIGIN=http://localhost:5173   # opcional, lista separada por vírgula
PORT=3333                 # opcional
NODE_ENV=development      # opcional
SMTP_HOST=smtp.zoho.com   # opcional (padrão Zoho; contas pessoais @zohomail.com)
SMTP_PORT=465             # opcional (465 = SSL; 587 = STARTTLS)
ZOHO_EMAIL=voce@zohomail.com       # conta remetente (obrigatória p/ enviar e-mail)
ZOHO_APP_PASSWORD=<senha de aplicativo>  # obrigatória p/ enviar; com 2FA, gerar em mail.zoho.com
MAIL_FROM=                # opcional; padrão = ZOHO_EMAIL (o Zoho exige remetente = conta)
FRONTEND_URL=http://localhost:5173  # opcional; base do link de redefinição (produção: URL pública)
```

> Use `file:./dev.db` (relativo, padrão do `.env.example`) ou caminho absoluto `file:C:/...` se o banco ficar fora do pacote. Sem `JWT_SECRET`, o servidor aborta com `[fatal]`.

> O seed **não cria usuário** sem `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Sem credenciais padrão — ver docs/regras-de-negocio.md.

### Web (`apps/web/.env`)

```
VITE_API_URL=http://localhost:3333/api   # opcional; padrão '/api' (proxy)
```

## E-mail / recuperação de senha

- Envio via Nodemailer pelo SMTP do Zoho (`lib/mail.ts`: `sendEmail`, `passwordResetEmail`). Contas pessoais `@zohomail.com` usam `smtp.zoho.com` sem configurar DNS de domínio próprio.
- Sem `ZOHO_EMAIL`/`ZOHO_APP_PASSWORD` (ou `MAIL_FROM`), o envio falha com erro `[email]` explícito — nunca silencioso.
- Fluxo: `POST /auth|/readers/forgot-password` cria token aleatório (guardado como hash SHA-256 em `PasswordResetToken`, `lib/password-reset.ts` via WebCrypto + client de banco injetável), validade 1 hora (`RESET_TOKEN_TTL_MS`), uso único; o link é `FRONTEND_URL/redefinir-senha?token=..&tipo=equipe|leitor`. Resposta sempre genérica (anti-enumeração de e-mails).
- No Worker, o envio é pelo **Email Sending** (binding `EMAIL` em `wrangler.jsonc`, sem chaves — `worker/mail.ts`); remetente `MAIL_FROM` obrigatório e de domínio habilitado no Email Service; local simula (não entrega).

## Notas

- Buscas textuais no SQLite (Prisma `contains`) são case-sensitive: CPF, números e títulos devem ser digitados conforme cadastrados.
- Senhas com PBKDF2-SHA256 + pepper via WebCrypto (ver "Senhas (PBKDF2)" acima); bcrypt legado só pede redefinição no Worker.
- Datetimes: `dev.db` usa millis INTEGER (nativo do engine; comparações numéricas corretas); D1 usa ISO-8601 TEXT (único legível no edge). Misturar formatos na mesma base quebra filtros por data — exportações p/ D1 convertem millis→ISO.
- Comparação de nomes de autores para reaproveitamento é case-insensitive e feita em memória (o SQLite não suporta filtro `mode: 'insensitive'` no Prisma).
- SQLite não suporta enums do Prisma: campos como `acquisitionType` são validados por Zod na borda da API e armazenados como String.
