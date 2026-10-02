# Referência da API

URL base: `http://localhost:3333/api` (dev). Autenticação: `Authorization: Bearer <token>`.

Formato de resposta paginada:

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 10, "totalPages": 0 }
```

Query de paginação (quando aplicável): `page` (≥1, padrão 1), `pageSize` (1–100, padrão 10). Exceções: `GET /categories` e `GET /authors?all=1` ignoram paginação e retornam `{ items, total, page: 1, pageSize: total, totalPages: 1 }`.

Erros: sempre `{ "error": "<mensagem>" }` (ver docs/arquitetura.md → Tratamento de erros). Exceção: ISBN duplicado em `POST/PUT /books` retorna `{ success: false, code: 'BOOK_ALREADY_EXISTS', message, duplicate: { id, titulo, isbn10, isbn13 } }`.

---

## Health

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/health` | — | `{ ok: true, service: 'livraria-api' }` |

## Auth

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/auth/login` | — | Login. Rate limit: 10/15 min. Retorna `{ token, user }` |
| GET | `/api/auth/me` | ✅ | Usuário autenticado (`{ user }`) |
| POST | `/api/auth/logout` | ✅ | Registra auditoria de logout; `{ ok: true }` |

`POST /login` — corpo: `{ email, password }`. Erros: `401` credenciais inválidas ou usuário inativo; `429` muitas tentativas. Tokens staff carregam `typ: 'staff'`; `requireAuth` rejeita outro `typ` com `401` (barreira contra reuso cruzado com tokens do portal).

## Users — `ADMIN` apenas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/users` | Lista paginada; filtros: `search` (nome/e-mail), `role` (ADMIN/ATTENDANT), `status` (ACTIVE/INACTIVE) |
| POST | `/api/users` | Cria usuário: `{ name, email, password (mín. 6), role? }`. `409` e-mail duplicado |
| GET | `/api/users/:id` | Detalhe `{ id, name, email, role, status, createdAt, updatedAt }` (sem senha) |
| PUT | `/api/users/:id` | Atualiza `{ name?, email?, role?, status? }`; `409` e-mail duplicado; `403` ao alterar papel de outro ADMIN |
| POST | `/api/users/:id/password` | Redefine senha: `{ password (mín. 6), currentPassword? }` — exigido `currentPassword` (validado, `403` se errado) ao redefinir senha de outro ADMIN |
| PATCH | `/api/users/:id/signature` | Salva/substitui/remove assinatura da equipe: `{ signature }` (data-URL PNG, ou `null` p/ remover); atualiza `signatureUpdatedAt`; auditoria `USER_UPDATED` |

## Books

Público para leitura; escrita exige autenticação.

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/books` | — | Lista paginada com `isAvailable` por livro |
| GET | `/api/books/cover` | — | Busca capa/dados na Amazon por ISBN. Rate limit: 30/15 min. `404` se não achar |
| GET | `/api/books/exists` | ✅ | Verifica ISBN cadastrado: `?isbn=&exclude=` → `{ book }` ou `{ book: null }` |
| GET | `/api/books/:id` | — | Detalhe + últimos 10 empréstimos + `hasActiveLoan` |
| POST | `/api/books` | ✅ | Cria livro (autores e categorias por nome inclusos) |
| PUT | `/api/books/:id` | ✅ | Atualiza livro (autores e categorias reatribuídos) |
| DELETE | `/api/books/:id` | ✅ | Arquiva (soft delete): `{ ok, isArchived: true }` |
| PATCH | `/api/books/:id/restore` | ✅ | Desarquiva: `{ ok, isArchived: false }` |

Query de `GET /books`: `search` (título, subtítulo, ISBN, editora, autor), `categoryId`, `availability` (`available`/`unavailable`), `sort` (`newest` [padrão]/`oldest`/`title`), `includeArchived` (bool).

`POST/PUT /books` — corpo:

```json
{
  "title": "Dom Casmurro",
  "subtitle": null,
  "isbn10": "8535910664",
  "isbn13": "9788535910663",
  "description": null,
  "publisher": "Companhia das Letras",
  "edition": 1,
  "publicationYear": 2008,
  "language": "pt-BR",
  "pages": 256,
  "coverUrl": null,
  "volume": "Vol. 1",
  "cdd": "869.9",
  "cutter": "M338d",
  "physicalLocation": "Estante A",
  "availableCopies": 3,
  "acquisitionType": "COMPRA",
  "categoryIds": [3],
  "categoryNames": ["Ficção científica"],
  "authorIds": [1, 2],
  "authorNames": ["Machado de Assis"]
}
```

- `authorNames` cria autores novos ao salvar (find-or-create case-insensitive); nomes existentes são reutilizados.
- `categoryIds`/`categoryNames` seguem o mesmo padrão (livro pode ter N categorias — relação `BookCategory`).
- `acquisitionType`: `COMPRA`, `DOACAO`, `REPOSICAO`, `PRODUCAO_INTERNA`, `TROCA`, `EMPRESTIMO_BIBLIOTECAS`, `LICITACAO`, `PERMUTA` ou `CONVENIO`.
- ISBN normalizado (espaços/hífens removidos, dígito verificador validado).
- Livro duplicado por ISBN → `409` com `{ success: false, code: 'BOOK_ALREADY_EXISTS', message, duplicate: { id, titulo, isbn10, isbn13 } }`.
- `GET /books/cover?isbn=...` → `{ coverUrl, title, subtitle, isbn13, description, publisher, publicationYear, pages, authors, categories }`.

## Authors — autenticação

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/authors` | Paginado; filtros: `search`, `status` (`active`/`inactive`); `?all=1` lista ativos sem paginação |
| POST | `/api/authors` | Cria: `{ name, isActive? }` (`isActive` aceito mas ignorado na criação — autor nasce ativo) |
| PUT | `/api/authors/:id` | Atualiza `{ name, isActive? }` |
| PATCH | `/api/authors/:id/status` | `{ isActive: boolean }` — desativa/ativa |

## Categories

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/categories` | — | Ativas por padrão; `?all=1` inclui inativas (exige auth) |
| POST | `/api/categories` | ADMIN | Cria `{ name, description? }` |
| PUT | `/api/categories/:id` | ADMIN | Atualiza `{ name, description? }` |
| PATCH | `/api/categories/:id/status` | ADMIN | `{ status: 'ACTIVE' | 'INACTIVE' }` |

## Readers — autenticação

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/readers` | ✅ | Paginado com `activeLoans` por leitor; filtros: `search` (nome/CPF/e-mail), `status` (ACTIVE/INACTIVE/BLOCKED/ALL [padrão]) |
| POST | `/api/readers` | ✅ | Cria (CPF validado com dígitos verificadores; `409` CPF/e-mail duplicado) |
| GET | `/api/readers/blocked` | ✅ | Lista de leitores bloqueados (paginado, com `activeLoans` e `blockedByName`, ordem `blockedAt` desc); `search` só nome/CPF (sem e-mail) |
| GET | `/api/readers/:id` | ✅ | `{ reader, loans, activeLoans, overdueCount, reservations }` — empréstimos (últimos 50, com livro), `activeLoans` é array (não contagem), reservas (últimas 20, com livro). Dispara `refreshOverdue` |
| PUT | `/api/readers/:id` | ✅ | Atualiza campos parciais; `409` se excluído ou CPF/e-mail em conflito |
| PATCH | `/api/readers/:id/status` | ✅ | `{ status: 'ACTIVE' \| 'INACTIVE' \| 'BLOCKED', reason? (máx. 500), category?: 'ATRASO_REPETIDO' \| 'COMPORTAMENTO' \| 'SOLICITACAO' \| 'OUTRO' }`. `BLOCKED` grava motivo/categoria/data/autor; `ACTIVE` limpa tudo; `INACTIVE` preserva bloqueio. `409` se excluído |
| PATCH | `/api/readers/:id/signature` | ✅ | Salva/atualiza assinatura: `{ signature }` (data-URL PNG, mín. 1, máx. 700000 chars); atualiza `signatureUpdatedAt`; `409` se excluído |
| POST | `/api/readers/:id/password` | ✅ | Balcão (qualquer staff) define/redefine senha do portal: `{ password }` (mín. 6). Retorna `{ ok: true }`; `409` se excluído |
| DELETE | `/api/readers/:id` | ADMIN | Anonimização LGPD (`{ reason? }`, máx. 500): **recusa** com `409` se houver empréstimos ativos; cancela reservas `PENDING`/`AVAILABLE`; nome → `Leitor excluído`, CPF → `EXCLUIDO-000123`, demais dados (incl. senha e assinatura) → `null`, status `INACTIVE`. Retorna `{ ok: true, deleted: true }`; `409` se já excluído |

Corpo de criação: `{ name, cpf, birthDate?, phone?, email?, cep?, address?, number?, neighborhood?, city?, state? }` (UF com 2 letras).

## Portal do leitor — sessão isolada

Autenticação própria da tabela `Reader` (secret JWT distinto do staff + `typ: 'reader'`; tokens não cruzam mesmo com IDs iguais). Rate limit 10/15 min em `register`/`login`/`claim`.

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/readers/register` | — | Autocadastro: `readerSchema` + `email` (obrigatório, único) + `password` (mín. 6). Cria `ACTIVE` e já retorna `{ token, reader }`. `409` CPF/e-mail duplicado |
| POST | `/api/readers/login` | — | `{ email, password }` → `{ token, reader }`. `401` genérico (incl. excluído, inativo ou sem senha) |
| POST | `/api/readers/claim` | — | Primeiro acesso: `{ cpf, email, password }`. CPF aceito com ou sem máscara; e-mail comparado sem caixa; exige `ACTIVE`, não excluído, e-mail igual e conta ainda sem senha. `401` genérico caso contrário |
| GET | `/api/readers/me` | Leitor | Perfil próprio (sem `passwordHash`) |
| PUT | `/api/readers/me` | Leitor | Atualiza nome, contato e endereço (sem CPF/status); `409` e-mail em conflito |
| POST | `/api/readers/me/password` | Leitor | `{ currentPassword, password }`; `401` senha atual incorreta; `404` se a conta nunca teve senha |
| GET | `/api/readers/me/loans` | Leitor | `{ loans, activeLoans, overdueCount }` (`activeLoans` é array; últimos 100, com livro; dispara `refreshOverdue`) |
| GET | `/api/readers/me/reservations` | Leitor | `{ reservations }` (últimas 50, com livro; dispara `expireReservations()`) |
| POST | `/api/readers/me/reservations` | Leitor | `{ bookId }` — livro existente e não arquivado, sem reserva ativa duplicada; `expiresAt` = +3 dias. (Balcão não checa `isArchived` — assimetria conhecida) |
| POST | `/api/readers/me/reservations/:id/cancel` | Leitor | Só própria (`404` senão); só `PENDING`/`AVAILABLE` (`400` nos demais; `FULFILLED` tem mensagem própria). Balcão só barra `FULFILLED` |

Leitor acessa seus Termos via `GET /loans/:id/term` e `/return-term` (aceita staff ou o próprio dono; `403` para terceiros).

## Loans — autenticação

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/loans` | Paginado; filtros: `status` (ACTIVE [inclui OVERDUE]/OVERDUE/RETURNED/ALL), `readerId`, `start`, `end` (por `loanDate`), `search` (número, leitor nome/CPF, livro título/ISBN) |
| GET | `/api/loans/search` | `?q=` busca rápida entre ativos/atrasados (máx. 20, mais recentes); `q` vazio → `{ items: [] }` |
| POST | `/api/loans` | Empréstimo de 1 livro |
| POST | `/api/loans/batch` | Empréstimo de vários livros em transação única |
| GET | `/api/loans/:id` | Detalhe |
| POST | `/api/loans/:id/return` | Devolução unitária (`condition?`, `observations?`, `signature?`, `useSavedSignature?`) |
| POST | `/api/loans/returns/batch` | Devolução em lote (mesmo leitor): `{ loanIds[1..20], condition?, observations?, signature?, useSavedSignature? }` → `200 { items, count, group }`. Transação única; `400` duplicado/multi-leitor; `404` se algum inexistir |
| GET | `/api/loans/returns/pending` | Leitores com empréstimos abertos: `{ items: [{ reader, loans, activeCount, overdueCount }], total, page, pageSize, totalPages }` (paginado por leitor; `search` nome/CPF/título) |
| POST | `/api/loans/:id/renew` | Renovação (regras abaixo) |
| GET | `/api/loans/:id/term` | PDF do Termo de Empréstimo (staff ou dono; blob autenticado) |
| GET | `/api/loans/:id/return-term` | PDF do Termo de Devolução unitário (staff ou dono; `404` se não devolvido) |
| GET | `/api/loans/return-term/batch/:group` | PDF do Termo de Devolução agrupado (staff ou dono de algum empréstimo do grupo; `404` se vazio/inconcluído) |

`POST /loans` — corpo: `{ readerId, bookId, dueDate?, signature?, useSavedSignature? }`. `POST /loans/batch` — corpo:

```json
{ "readerId": 7, "bookIds": [12, 34], "dueDate": "2026-09-01", "signature": "data:image/png;base64,..." }
```

- `signature`: data-URL PNG da assinatura do leitor capturada no pad (opcional no backend, obrigatória na UI; no lote, a mesma assinatura vale para todos os empréstimos). Salva em `loanSignature`/`loanSignedAt` e é incorporada ao Termo de Empréstimo. Desenhar nova assinatura atualiza a salva do leitor.
- `useSavedSignature`: `true` para reaproveitar a assinatura salva do leitor sem redesenhar (`400` se ele não tiver salva).

`POST /loans/:id/return` — corpo (opcional):

```json
{ "condition": "BOM", "observations": "Material sem avarias", "signature": "data:image/png;base64,..." }
```

- `condition`: `BOM`, `REGULAR` ou `DANIFICADO`
- `observations`: texto livre (até 500 caracteres)
- `signature`: data-URL PNG da assinatura do leitor (opcional no backend, obrigatória na UI). Salva em `returnSignature`/`returnSignedAt` e é incorporada ao Termo de Devolução. Desenhar nova assinatura atualiza a salva do leitor.
- `useSavedSignature`: `true` para reaproveitar a assinatura salva (`400` se não houver).

Regras comuns (falha → `400` sem criar nada):
- Leitor deve existir e estar `ACTIVE`.
- Leitor sem empréstimo `OVERDUE` em aberto.
- `ativos + selecionados ≤ loanLimit` (configurado em Configurações).
- `signature`/`useSavedSignature`: PNG data-URL (máx. 700000 chars) ou `true` p/ salva; valem p/ `POST /loans`, `/batch` e `/return`.
- Livro não arquivado, sem empréstimo ativo e sem reserva `PENDING`/`AVAILABLE` de **outro** leitor (mensagem inclui o título: `"X" já está emprestado` / `"X" possui reserva aguardando por outro leitor`).
- `dueDate` deve ser futura; sem `dueDate`, usa `loanDate + defaultLoanDays`.
- Duplicados em `bookIds` → `400` "Livro duplicado na seleção".
- Batch: `bookIds` de 1 a 20; falha de qualquer livro aborta a transação inteira.

Respostas: `201` com o(s) empréstimo(s) completos (com `number` no formato `EMP-000123`, `reader`, `book`, `user`); batch retorna `{ items, count }`. Leitores excluídos e filtros de `start`/`end` (por `loanDate`, `end` não inclusivo) conforme implementação.

### Renovação

`POST /loans/:id/renew` — `404` se inexistente; `400` se: já devolvido, `OVERDUE`, leitor excluído/bloqueado/inativo, `renewals ≥ maxRenewals`, ou qualquer reserva `PENDING`/`AVAILABLE` p/ o livro. Novo prazo = (`dueDate` futura ? `dueDate` : hoje) + `defaultLoanDays`; incrementa `renewals`; registra `LOAN_RENEWED`; retorna `{ ...loan, number }`.

### Devolução — efeitos colaterais

Além de marcar `RETURNED` + `returnedAt` (+ `condition`, `observations`, assinatura e `receivedByNameSnapshot`):
- Reserva `PENDING` mais antiga do livro vira `AVAILABLE` (ou `EXPIRED` se vencida; só a primeira).
- Auto-bloqueio: se restarem ≥2 `OVERDUE` do leitor (excluindo o atual), leitor `ACTIVE` vira `BLOCKED` (`ATRASO_REPETIDO`, `blockedBy` nulo) e reservas `PENDING` são canceladas.

### Termos PDF

Rotas `GET /loans/:id/term` e `GET /loans/:id/return-term` geram PDFs com `pdfkit` em streaming (`Content-Type: application/pdf`, `Content-Disposition: inline`, nomes `termo-emprestimo-*` / `termo-devolucao-*`). Autorização `requireStaffOrLoanOwner`: qualquer staff **ou** o leitor dono (`403` p/ terceiros). `return-term` retorna `404` se ainda não devolvido. Frontend busca como blob e abre em nova aba.

O Termo de Empréstimo contém: dados do empréstimo, leitor (snapshots), material bibliográfico, registro do atendimento e assinaturas. O Termo de Devolução contém: situação (prazo/atraso), condição do material, dados do empréstimo original, leitor, material, registro da devolução, responsável e assinaturas. O Termo em lote (`group` = `DEV-` + menor id) lista todos os materiais com situação individual, uma condição/observações/assinatura para a operação e mesmos snapshots por empréstimo. Quando há assinatura digital salva (`loanSignature`/`returnSignature`), a imagem é incorporada na seção de assinaturas com data/hora; sem ela, mantêm-se as linhas manuais.

## Reservations — autenticação

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/reservations` | Paginado (`status` case-sensitive, padrão `all`); ordenado por status + criação desc; dispara `expireReservations()` |
| POST | `/api/reservations` | Cria `{ readerId, bookId }` — `expiresAt` = +3 dias. Checa leitor existente/não excluído/`ACTIVE` e livro existente (**sem** checar arquivado); `201` |
| POST | `/api/reservations/:id/cancel` | Cancela; só barra `FULFILLED` (recancelar `CANCELLED`/`EXPIRED` é idempotente) |
| POST | `/api/reservations/:id/fulfill` | Atende em transação: `400` se `CANCELLED`/`EXPIRED`/`FULFILLED`, leitor não `ACTIVE`, livro emprestado ou limite atingido. Cria empréstimo mínimo (**sem** snapshots/assinatura), marca `FULFILLED` + `fulfilledAt`, retorna `201 { loanId, number }` |

- `400` se o leitor já tiver reserva ativa (PENDING/AVAILABLE) para o mesmo livro.
- `GET /reservations` dispara `expireReservations()` (PENDING vencidas → EXPIRED).
- Devolução de livro com reserva PENDING a transforma em `AVAILABLE` (ou `EXPIRED` se já vencida).

## Reports — `ADMIN` apenas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/reports` | Resultado `{ type, generatedAt, filters, columns, rows }` (+ `total/page/pageSize/totalPages` em `acervo-livros`) |
| GET | `/api/reports/export` | Mesmos filtros; baixa CSV (`;` como separador, BOM UTF-8) |
| GET | `/api/reports/export-pdf` | Mesmos filtros; baixa PDF paisagem completo — ignora página/limite (todo o resultado do modelo selecionado), com cabeçalho, tabela, filtros e páginas numeradas |

Parâmetros: `type` (obrigatório) + `start`, `end` (`end` inclusivo), `categoryId`, `bookId`, `readerId`, `limit` (1–100, padrão 10; ignorado em `acervo`), `page` (≥1, padrão 1; usado por `acervo-livros`). Livros filtrados sempre com `isArchived: false` (exceto `acervo-livros`, que inclui arquivados). `active-readers` e `top-books` também aceitam `readerId`.

| `type` | Colunas |
|---|---|
| `acervo` | Métrica/Valor (cadastrados, disponíveis, emprestados, exemplares [soma `availableCopies`], arquivados, categorias, autores; contagens de livros respeitam `categoryId`) |
| `acervo-livros` | Título/Quant. Cópias/Situação (Disponível, Emprestado ou Arquivado) — 30 por página, com `total/page/pageSize/totalPages`; respeita `categoryId`/`bookId` |
| `available` | Título/Autor(es)/ISBN/Situação (livros disponíveis) |
| `loaned` | Título/Autor(es)/ISBN/Situação (livros emprestados) |
| `overdue` | Empréstimo/Leitor/Livro/Devido em/Dias em atraso |
| `loans-period` | Empréstimo/Leitor/Livro/Emprestado em (filtro por `loanDate`) |
| `returns-period` | Empréstimo/Leitor/Livro/Devolvido em (filtro por `returnedAt`) |
| `active-readers` | Leitor/CPF/Empréstimos no período |
| `top-books` | Livro/ISBN/Empréstimos |
| `categories` | Categoria/Empréstimos (multi-categoria conta N vezes; vazio → `Sem categoria`) |

UI (`/admin/relatorios`): filtro de categoria (todos exceto `active-readers`), limite 10/25/50/100 (exceto `acervo`), período 7/30/90d (só period types); acervo renderiza cards em vez de tabela.

## Audit — `ADMIN` apenas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/audit` | Paginado; filtros: `action`, `userId`, `start`, `end` (`end` inclusivo); inclui usuário `{ id, name, email }` |
| GET | `/api/audit/actions` | `{ actions: [...] }` — ações distintas já registradas |

## Settings

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/settings` | — | Configurações atuais (público; usado pelo catálogo) |
| PUT | `/api/settings` | ADMIN | Atualiza |

`PUT` — corpo: `{ loanLimit (1–20), defaultLoanDays (1–90), maxRenewals (0–5), libraryName (obrigatório, mín. 2), libraryAddress?, libraryPhone?, libraryEmail? (validado), libraryHours? }`. `GET` público retorna defaults (`loanLimit` 4, `defaultLoanDays` 15, `maxRenewals` 1, `libraryName` `''`, resto `null`). Campos institucionais vazios até serem preenchidos pelo usuário.

## Dashboard — autenticação

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/dashboard` | `{ totalBooks, availableBooks, loanedBooks, activeReaders, activeLoans, overdueLoans, recentLoans[5], recentReturns[5], overdue[5], topBooks[5] }` — recentes só `ACTIVE`/`OVERDUE`, devoluções por `returnedAt`, atrasados por `dueDate`, topBooks últimos 30 dias |

## Backup — `ADMIN` apenas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/backups` | Lista backups existentes (ordenados por data desc) |
| POST | `/api/backups` | Cria backup manual (`VACUUM INTO`, `201 { filename, size }`). Rotação automática: mantém apenas 5 |
| GET | `/api/backups/:filename/download` | Baixa o arquivo de backup (stream via `res.download`) |
| POST | `/api/backups/restore-upload` | Restaura banco a partir de arquivo local (multipart: campo `file`, formatos `.sqlite`/`.db`, máx. 100 MB) |
| POST | `/api/backups/:filename/restore` | Restaura banco a partir do backup no servidor (substitui `dev.db`) |
| DELETE | `/api/backups/:filename` | Remove backup |

`GET /backups` retorna:

```json
[
  { "filename": "backup_2026-08-21_18-30.sqlite", "size": 53248, "createdAt": "2026-08-21T18:30:00.000Z" }
]
```

Backups automáticos: dois agendamentos diários via `node-cron` (18:30 e 23:45). Arquivos em `apps/api/backups/`. Validação de `filename`: regex `^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.sqlite$` (`400` inválido, `404` inexistente). Restauração do servidor responde sem exigir restart; upload responde pedindo restart. Upload usa `multer` com storage temporário em `backups/.tmp/`.

---

## Conformidade frontend × backend

Mapeamento vigente (`apps/web/src/features/<dominio>/api.ts`): `PATCH /authors/:id/status` (`{ isActive }`),
`PATCH /categories/:id/status` (`{ status }`), `PUT /users/:id` (com `status`
para ativar/desativar), `POST /reservations/:id/cancel|fulfill`, termos via
`loansApi.openTerm/openReturnTerm` (staff) e `readerPortalApi` (dono). Divergências
conhecidas são registradas nas seções acima quando existem.
