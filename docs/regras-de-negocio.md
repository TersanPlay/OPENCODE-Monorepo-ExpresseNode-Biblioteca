# Regras de negócio

## Configurações (tela Configurações / `Setting` id 1)

| Regra | Padrão | Faixa | Efeito |
|---|---|---|---|
| `loanLimit` | 4 | 1–20 | Máximo de empréstimos ativos (ACTIVE + OVERDUE) por leitor |
| `defaultLoanDays` | 15 | 1–90 | Prazo de devolução aplicado quando não informado |
| `maxRenewals` | 1 | 0–5 (backend; tela aceita 0–10 e o backend barra acima de 5 com `400`) | Máximo de renovações por empréstimo |
| Instituição | vazio | — | Nome, endereço, telefone, e-mail, horário — preenchidos pelo usuário |

> Campos institucionais começam vazios e só aparecem na interface quando preenchidos (não há valores de demonstração). Exceções pontuais: cabeçalho do PDF e logo usam `"Biblioteca Pública"` quando o nome não foi configurado.

## Configurações — acesso

`GET /settings` é público; `PUT /settings` exige `ADMIN`.

## Status

### Leitor
`ACTIVE` | `INACTIVE` | `BLOCKED`

### Empréstimo
- `ACTIVE` — em aberto, dentro do prazo.
- `OVERDUE` — `ACTIVE` cuja `dueDate` passou sem devolução (marcado por `refreshOverdue`, disparado em `GET/POST /loans`, `GET /loans/search`, `GET /readers/:id`, dashboard, relatórios e portal `GET /readers/me/loans`).
- `RETURNED` — devolvido.

### Reserva
`PENDING` (aguardando) → `AVAILABLE` (livro devolvido, aguardando retirada) → `FULFILLED` (empréstimo criado) | `CANCELLED` | `EXPIRED` (só `PENDING` expira, 3 dias após criação; `AVAILABLE` nunca expira sozinho).

### Livro
`isArchived` — arquivamento é **soft delete**: o livro some das listagens mas permanece no banco; não pode ser emprestado enquanto arquivado.

## Empréstimo

1. Leitor deve existir e estar `ACTIVE` (bloqueado/inativo não empresta).
2. Leitor não pode ter empréstimo `OVERDUE` em aberto — "regularize antes de emprestar".
3. `ativos + novos ≤ loanLimit` (com a contagem de ativos recalculada).
4. Livro elegível: não arquivado, sem empréstimo ativo (`ACTIVE`/`OVERDUE`) e sem reserva `PENDING`/`AVAILABLE` de **outro** leitor. Mensagens citam o título do livro.
5. `dueDate` opcional; se informada, deve ser futura; senão `loanDate + defaultLoanDays`.
6. Número gerado: `EMP-` + id com 6 dígitos (ex.: `EMP-000123`).
7. Registra auditoria `LOAN_CREATED`.

### Snapshots de dados

No momento da criação do empréstimo, são salvos os dados do leitor, livro e usuário responsáveis como snapshots. Campos: `readerNameSnapshot`, `bookTitleSnapshot`, `bookAuthorSnapshot`, `bookIsbnSnapshot`, `bookNumberSnapshot`, `createdByNameSnapshot`, `createdBySignatureSnapshot` (assinatura salva do operador, se houver). Na devolução: `receivedByNameSnapshot` + `receivedBySignatureSnapshot`. Esses snapshots são usados nos Termos PDF (documentos de empréstimo/devolução) para preservar o estado dos dados no momento do registro, mesmo que o leitor/livro sejam alterados depois.

Para empréstimos criados antes da implementação dos snapshots, os termos PDF fazem fallback para os dados das relações atuais (reader, book, user). Empréstimos criados via atendimento de reserva (`fulfill`) não gravam snapshots nem assinatura.

### Assinatura do leitor (obrigatória só na UI; opcional no backend)

- No Step 3 do novo empréstimo, a UI exibe a pré-visualização do Termo e exige a assinatura do leitor no pad (mouse, touch ou caneta; limpar/refazer liberado). Sem assinatura, a confirmação fica bloqueada.
- A mesma assinatura vale para todos os livros do lote; é salva em `loanSignature`/`loanSignedAt` de cada empréstimo e incorporada ao Termo de Empréstimo (PDF).
- Na devolução, o modal exibe a pré-visualização do Termo de Devolução e exige a assinatura; salva em `returnSignature`/`returnSignedAt` e incorporada ao Termo de Devolução.
- Termos de operações anteriores (sem assinatura salva) continuam válidos, com as linhas manuais.

### Assinatura salva do leitor

- Cada leitor pode ter uma assinatura salva (`signature`/`signatureUpdatedAt`, via `PATCH /readers/:id/signature` ou automaticamente ao desenhar nova em empréstimo/devolução).
- Com salva existente, o Step 3 e o modal de devolução oferecem escolha explícita: **Usar salva** (miniatura) ou **Assinar novamente** (a nova vira a salva).
- `useSavedSignature: true` reaproveita sem redesenhar; sem salva, `400` pedindo desenho.
- Exclusão LGPD apaga a assinatura junto dos dados pessoais.

### Empréstimo em lote (`POST /loans/batch`)

- 1 a 20 livros por pedido; seleção sem duplicados.
- **Transação única**: se qualquer livro falhar (emprestado, reservado, arquivado), nenhum empréstimo é criado.
- Data de devolução única para todo o lote.
- Limite combinado: `ativos + selecionados ≤ loanLimit` (o frontend mostra "X de N disponíveis" no novo empréstimo).

## Renovação

Bloqueada quando (mensagem específica em cada caso):
- Empréstimo já devolvido (`RETURNED`/`returnedAt`).
- Empréstimo `OVERDUE` — atrasado não renova (o bloqueio por atraso roda antes do cálculo, e `renew` não dispara `refreshOverdue`, então o ramo "vencida" só vale se a marcação ainda não rodou).
- Leitor excluído, bloqueado ou inativo.
- `renewals ≥ maxRenewals`.
- Existe reserva ativa (PENDING/AVAILABLE) para o livro.

Novo prazo: `base + defaultLoanDays`, onde `base` = `dueDate` atual (se ainda futura) ou hoje (se vencida). `renewals` incrementa e a auditoria `LOAN_RENEWED` registra número e novo prazo.

## Devolução em lote (página `/admin/devolucoes`)

- Listagem agrupada por leitor (`GET /loans/returns/pending`, paginado por leitor); detalhe por leitor (`/admin/devolucoes/:readerId`) com todos os abertos.
- Seleção individual + Selecionar todos; 1 livro usa a rota unitária (termo individual); ≥2 usam `POST /loans/returns/batch` (1–20 ids, mesmo leitor, transação única, mesma condição/observações/assinatura p/ todos).
- Lote gera `returnGroup` (`DEV-` + menor id) em cada empréstimo e **um único Termo** listando todos os materiais; histórico/auditoria continuam por empréstimo (`LOAN_RETURNED` cada).
- Unitária e lote compartilham o mesmo núcleo (`performReturn`): guards, assinatura, snapshots, ativação de reserva; auto-block roda 1× por operação.

## Devolução

- `400` se já devolvida.
- Marca `RETURNED` e `returnedAt`.
- Opcionalmente registra `returnCondition` (BOM/REGULAR/DANIFICADO) e `returnObservations` (até 500 caracteres).
- Snapshot do responsável pela devolução: `receivedByNameSnapshot`.
- Se houver reserva `PENDING` para o livro (só a mais antiga), ela vira `AVAILABLE` (aguardando retirada) — ou `EXPIRED` se `expiresAt` já passou.
- **Bloqueio automático por atrasos repetidos**: após a devolução, conta-se os `OVERDUE` restantes (**excluindo** o recém-devolvido); se ≥2 e o leitor ainda estiver `ACTIVE`, vira `BLOCKED` (`ATRASO_REPETIDO`, `blockedBy` nulo, auditoria `READER_STATUS_CHANGED` com `auto: true`) e suas reservas `PENDING` são canceladas (`AVAILABLE` ficam).

## Reserva

- Leitor deve estar `ACTIVE`; bloqueado/inativo não reserva.
- Não pode haver reserva ativa (PENDING/AVAILABLE) do mesmo leitor para o mesmo livro.
- `expiresAt` = criação + 3 dias; só `PENDING` vencida → `EXPIRED` automaticamente (`expireReservations`, rodando em `GET /loans`, `GET /reservations` e portal).
- Atendimento (`fulfill`): cria o empréstimo em transação, validando de novo leitor ativo, livro livre e limite; reserva vira `FULFILLED`. Reserva cancelada/expirada não pode ser atendida. O empréstimo do `fulfill` **não** grava snapshots/assinatura e não checa `OVERDUE` do leitor.
- Reserva do **balcão** não verifica livro arquivado; reserva do **portal** barra arquivado (`400`).
- Cancelamento: portal só `PENDING`/`AVAILABLE` próprias; balcão só barra `FULFILLED` (recancelar é idempotente).
- Devolução de livro com reserva PENDING a ativa como `AVAILABLE`.

## Autores com cadastro automático

- O formulário de livro aceita nomes separados por **vírgulas**.
- Ao salvar, cada nome é procurado no cadastro ignorando maiúsculas/minúsculas (comparação em memória, pois o SQLite não suporta `mode: 'insensitive'`).
  - Existe → reaproveita o autor (não cria duplicado).
  - Não existe → cria e registra auditoria `AUTHOR_CREATED`.
- Nome de autor: 2–120 caracteres.
- No update do livro, a relação de autores é **reatribuída** (remove e recria), então o formulário deve enviar a lista completa.
- Frontend: nomes digitados viram "chips"; chips de autores que serão criados aparecem destacados ("novo").

## Categorias com cadastro automático + taxonomia canônica

- O formulário de livro aceita nomes separados por **vírgulas**; nomes inexistentes são criados (find-or-create case-insensitive) com auditoria `CATEGORY_CREATED` — mesmo padrão dos autores.
- A base usa a **taxonomia canônica de 39 categorias** (`scripts/review-categories/taxonomy.json`); `/admin/categorias` lista só canônicas após o cleanup.
- Automação `scripts/review-categories/`: `classify.py` analisa (CDD, keywords, autores, Open Library) e gera `revisao-categorias.json` (`AUTO`/`REVIEW`/`INSUFFICIENT`) sem tocar o banco; `import.py --apply` importa aprovadas (backup prévio, idempotente); `cleanup-legacy.py --apply` remove categorias fora da taxonomia.

## Livros

- ISBN-10 e ISBN-13 validados com dígito verificador; normalizados (espaços/hífens removidos, maiúsculas).
- Duplicado por ISBN → `409` com detalhes do livro existente (`code: BOOK_ALREADY_EXISTS`).
- Capa: `GET /books/cover` consulta a Amazon Brasil (fallback .com) e extrai capa, título, subtítulo, ISBN-13, descrição, editora e ano; timeout de 12 s; rate limit 30/15 min.
- Campos expandidos: `volume`, `cdd`, `cutter`, `physicalLocation`, `availableCopies`, `acquisitionType` (COMPRA/DOACAO/REPOSICAO/PRODUCAO_INTERNA/TROCA/EMPRESTIMO_BIBLIOTECAS/LICITACAO/PERMUTA/CONVENIO).
- SQLite não suporta enums do Prisma: valores validados por Zod na borda da API, armazenados como String.

## Leitores

- CPF validado com dígitos verificadores (11 dígitos, sem sequências repetidas).
- CPF único; e-mail único quando informado.
- Bloqueio manual pela tela de leitores; bloqueado não empresta, não renova, não reserva nem retira reserva. Categoria do bloqueio: `ATRASO_REPETIDO` | `COMPORTAMENTO` | `SOLICITACAO` | `OUTRO`.
- Bloqueio automático: 2+ empréstimos `OVERDUE` restantes após uma devolução bloqueiam o leitor (`ATRASO_REPETIDO`) e cancelam suas reservas `PENDING` (ver Devolução).
- Motivo e categoria de bloqueio registrados (`blockReason`, `blockCategory`, `blockedAt`, `blockedBy`).
- **Exclusão com anonimização LGPD** (`DELETE /readers/:id`, ADMIN apenas):
  - **Recusa** com `409` se houver empréstimos ativos ou em atraso (não bloqueia, barra a operação); `409` se já excluído.
  - Cancela reservas `PENDING`/`AVAILABLE` do leitor.
  - Substitui dados pessoais: nome → "Leitor excluído", CPF → "EXCLUIDO-000123" (6 dígitos), demais campos (incl. senha e assinatura) → `null`.
  - Status → `INACTIVE`, registra `deletedAt` e `anonymizedAt`.
  - Registra auditoria `READER_DELETED` com `reference: LTR-000123` e motivo opcional.

## Usuários do sistema

- Papéis: `ADMIN` e `ATTENDANT`.
- Senha mínima de 6 caracteres; hash bcrypt (10 rounds).
- Usuário inativo não autentica (o `requireAuth` rejeita status ≠ `ACTIVE`).
- Primeiro acesso: criado no seed a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD` (não há credenciais padrão). Perfis adicionais são criados pela tela Usuários.
- Assinatura da equipe (`/admin/usuarios`, ADMIN): modal exclusivo via botão **Assinatura** na tabela (separado do cadastro/edição) — mostra a salva, desenhar substitui, botão remove. Salva em `signature`/`signatureUpdatedAt` (`PATCH /users/:id/signature`). A salva do operador da operação é congelada no empréstimo/devolução (`createdBySignatureSnapshot`/`receivedBySignatureSnapshot`) e incorporada na coluna do responsável nos Termos (fallback p/ linhas manuais).

## Portal do leitor (autocadastro)

- Página pública `/cadastro`: nome, CPF (validado), e-mail (único, obrigatório — é o login), senha (mín. 6), telefone e nascimento opcionais. Conta nasce `ACTIVE`, sem admin.
- Login em `/login` (aba Leitor) com e-mail + senha; sessão e token separados da equipe (`livraria_reader_token`).
- Leitor vê e altera só o próprio cadastro (sem CPF/status), troca a própria senha, consulta empréstimos e termos próprios, cria/cancela as próprias reservas. Empréstimo, devolução, renovação e gestão seguem exclusivos do balcão.
- Reserva pelo portal barra livro arquivado; balcão não checa (assimetria conhecida).
- Leitores antigos (cadastrados no balcão, sem senha): o balcão define a senha em Detalhe do leitor → Senha de acesso, ou o próprio leitor ativa em `/login` → Primeiro acesso (confere CPF com/sem máscara + e-mail sem caixa; exige `ACTIVE`, não excluído e conta ainda sem senha; `401` genérico; rate-limit).
- Exclusão LGPD também apaga `passwordHash` e assinatura do leitor.

## Auditoria

Toda operação de escrita registra quem (usuário autenticado; `null` em fluxos self/automáticos), o quê (ação), sobre qual entidade, com metadados e IP. Falhas de login também são registradas (sem usuário). Rotas de backup (`GET/POST/DELETE /backups`) não geram auditoria.

Ações registradas: `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `USER_CREATED`, `USER_UPDATED`, `USER_PASSWORD_RESET`, `BOOK_CREATED`, `BOOK_UPDATED`, `BOOK_ARCHIVED`, `BOOK_RESTORED`, `AUTHOR_CREATED`, `AUTHOR_UPDATED`, `AUTHOR_ACTIVATED`, `AUTHOR_INACTIVATED`, `CATEGORY_CREATED`, `CATEGORY_UPDATED`, `CATEGORY_STATUS_CHANGED`, `READER_CREATED`, `READER_UPDATED`, `READER_STATUS_CHANGED`, `READER_DELETED`, `LOAN_CREATED`, `LOAN_RETURNED`, `LOAN_RENEWED`, `RESERVATION_CREATED`, `RESERVATION_CANCELLED`, `RESERVATION_FULFILLED`, `SETTINGS_UPDATED`.

## Backup

- Backups automáticos: dois horários diários via `node-cron` (18:30 e 23:45).
- Mecanismo: `VACUUM INTO` (SQLite 3.27+) — seguro com escritas concorrentes.
- Armazenamento: `apps/api/backups/` com arquivos `backup_YYYY-MM-DD_HH-mm.sqlite`.
- Rotação: mantém apenas os 5 backups mais recentes; os antigos são deletados automaticamente.
- **Download**: `GET /api/backups/:filename/download` — stream do arquivo real.
- **Upload/Restauração local**: `POST /api/backups/restore-upload` — recebe arquivo via multipart (campo `file`, formatos `.sqlite`/`.db`, máx. 100 MB), copia sobre `dev.db`.
- **Restauração do servidor**: `POST /api/backups/:filename/restore` — copia o backup do servidor sobre `dev.db`.
- Extensão validada no backend (regex no filename, multer fileFilter no upload).
- **Listar/criar/remover**: `GET /api/backups`, `POST /api/backups` (`201 { filename, size }`), `DELETE /api/backups/:filename`.
- Restauração requer confirmação explícita no frontend (modal, não `window.confirm`).
- Todas as rotas protegidas: `requireAuth` + `requireRoles('ADMIN')`.

## Política anti-dados-mock

O sistema não exibe nem cria dados fictícios em produção: estados vazios reais ("Nenhum livro cadastrado"), sem credenciais demo, sem fallbacks inventados. Apenas fixtures de teste (smoke/CDP) criam dados, marcados como TEST e removidos ao final.

## Termos de Empréstimo/Devolução (PDF)

### Geração

- **Termo de Empréstimo** (`GET /loans/:id/term`): dados do empréstimo, leitor, material bibliográfico, registro do atendimento e assinaturas.
- **Termo de Devolução** (`GET /loans/:id/return-term`): situação (prazo/atraso), condição do material, dados do empréstimo original, leitor, material, registro da devolução, responsável e assinaturas.

### Layout

- Cabeçalho institucional com ícone BookOpen, nome, endereço, telefone e e-mail da biblioteca.
- Título centralizado com número do termo destacado.
- Seções numeradas com bordas sutis e campos em 2-3 colunas.
- Predominantemente preto/cinza, cor institucional (#087F8C) apenas em pequenos elementos de destaque.
- Código de verificação (SHA-256 baseado no ID e data) no rodapé.
- Rodapé: data/hora de geração, número do empréstimo, registrado por.
- Numeração de páginas.

### Segurança

- Termos: `requireStaffOrLoanOwner` — qualquer staff **ou** o leitor dono (token do portal); terceiros recebem `403`; sem token, `401`. Não existem rotas públicas de PDF.
- Frontend staff busca o PDF como blob via axios (com token JWT), cria blob URL e abre com `window.open`; portal usa o próprio token.

### Disponibilidade

- Botões de documentos na página de detalhes do leitor (`/admin/leitores/:id`), na tabela de histórico de empréstimos, e no portal (`/minha-conta`, só próprios).
- Termo de Devolução só disponível para empréstimos devolvidos (`returnedAt` preenchido).
