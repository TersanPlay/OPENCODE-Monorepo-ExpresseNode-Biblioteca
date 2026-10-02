# Sistema de Biblioteca Pública

Sistema web para gestão de biblioteca pública: acervo, leitores, exemplares, empréstimos, devoluções, usuários, relatórios e catálogo público.

## Stack

- **Backend**: Node.js + Express + TypeScript + Prisma ORM + SQLite (preparado para PostgreSQL) + JWT + bcryptjs + multer (upload de backups) + pdfkit (geração de termos PDF)
- **Frontend**: React + TypeScript + Vite + Tailwind CSS + Radix UI + Lucide React + React Router + Axios + React Hook Form + Zod
- **UI/UX**: metodologia UI Architect ASJ (canvas `#F2F2F0`, primary `#087F8C`, superfícies creme, hairline, motion refinado)

## Estrutura (monorepo pnpm)

```
/
├── apps/
│   ├── web/                  SPA React/Vite (porta 5173, proxy /api → 3333)
│   │   └── src/
│   │       ├── features/<dominio>/api.ts      clientes HTTP por domínio
│   │       ├── features/<dominio>/pages/      páginas por domínio
│   │       ├── services/api-client.ts         Axios central + JWT
│   │       └── types/api.ts                   reexporta @library/shared
│   └── api/                  Express + Prisma (porta 3333, URL base /api)
│       ├── prisma/           schema.prisma, seed.ts, dev.db
│       └── src/
│           ├── modules/<dominio>/<dominio>.routes.ts
│           ├── config/env.ts                  env + JWT centralizados
│           ├── infrastructure/                prisma, http, pdf, covers, audit
│           └── validation.ts                  parse() + reexporta @library/shared
├── packages/
│   ├── shared/               tipos, schemas Zod, constantes (@library/shared)
│   ├── ui/                   Design System Radix (@library/ui)
│   └── config/               ESLint compartilhado (@library/config)
├── docs/                     arquitetura, API, regras, módulos, testes
├── infra/                    reservado p/ deploy (não exigido p/ rodar)
├── scripts/                  verify-workspaces.mjs
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .env.example
```

> Compatibilidade: `apps/web/src/components/ui/*`, `features/api.ts`, `types/api.ts`
> e `pages/admin/*` são shims que reexportam dos novos locais — imports antigos
> continuam funcionando. O Prisma Client é gerado em
> `apps/api/src/generated/prisma` (ver `DATABASE_URL` abaixo).

---

## Pré-requisitos

| Requisito | Versão mínima | Como verificar |
|-----------|---------------|----------------|
| **Node.js** | 18+ | `node --version` |
| **pnpm** | 9+ | `pnpm --version` |

> O projeto foi testado com Node.js 24.x e pnpm 10.x. Use pnpm nos workspaces
> (o `packageManager` está fixado no `package.json` da raiz).

---

## Instalação passo a passo

### 1. Clonar o repositório

```bash
git clone https://github.com/TersanPlay/Biblioteca-Publica-OPENCODE.git
cd Biblioteca-Publica-OPENCODE
```

### 2. Configurar o Backend

#### 2.1 Instalar dependências (raiz do monorepo)

```bash
pnpm install
```

> O `postinstall` compila `@library/shared` e gera automaticamente o Prisma Client
> em `apps/api/src/generated/prisma`.

#### 2.2 Criar o arquivo `.env`

Crie o arquivo `apps/api/.env` com o seguinte conteúdo (veja `.env.example` na raiz):

```env
DATABASE_URL="file:C:/caminho/ate/o/repo/apps/api/prisma/dev.db"
JWT_SECRET=cole-um-segredo-forte-aqui-minimo-32-caracteres
ADMIN_NAME=Administrador
ADMIN_EMAIL=seu@email.com
ADMIN_PASSWORD=sua-senha-forte
```

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Sim | Caminho do banco SQLite. **Use caminho absoluto** (`file:C:/.../apps/api/prisma/dev.db`): o Prisma CLI resolve `file:` em relação ao schema, mas o runtime resolve em relação ao cwd — o caminho absoluto funciona nos dois. Gerencie pelo seed/setup abaixo |
| `JWT_SECRET` | Sim | Chave secreta para assinar tokens JWT. Use uma string aleatória de no mínimo 32 caracteres |
| `ADMIN_EMAIL` | Sim | E-mail do primeiro administrador. Será usado para fazer login |
| `ADMIN_PASSWORD` | Sim | Senha do primeiro administrador. Mínimo 6 caracteres |
| `ADMIN_NAME` | Não | Nome exibido do administrador. Padrão: `Administrador` |
| `JWT_EXPIRES` | Não | Tempo de expiração do token. Padrão: `8h` |
| `CORS_ORIGIN` | Não | Origens permitidas (separadas por vírgula). Padrão: `http://localhost:5173` |

> **Gerar JWT_SECRET aleatório** (opção rápida):
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

#### 2.3 Configurar o banco de dados

```bash
pnpm --filter @library/api db:setup
```

Esse comando:
1. Cria o arquivo `dev.db` (SQLite) com o schema do Prisma
2. Roda o seed que cria a configuração inicial e o usuário administrador (usando as variáveis `ADMIN_EMAIL`/`ADMIN_PASSWORD` do `.env`)

#### 2.4 Iniciar o servidor

```bash
# raiz: sobe API + web juntos
pnpm dev

# ou só a API
pnpm dev:api
```

O backend estará disponível em: **http://localhost:3333/api**

Para verificar se está rodando:
```bash
curl http://localhost:3333/api/health
# Resposta: {"ok":true,"service":"livraria-api"}
```

### 3. Configurar o Frontend

O `pnpm install` da raiz já instala o web. Em um novo terminal:

```bash
pnpm dev:web
```

O frontend estará disponível em: **http://localhost:5173**

> O Vite configura automaticamente um proxy de `/api` para `localhost:3333`, então o frontend
> se comunica com o backend sem configuração adicional.

### 4. Primeiro acesso

1. Acesse **http://localhost:5173**
2. Clique em "Entrar" ou acesse **http://localhost:5173/login**
3. Use as credenciais definidas no `.env`:
   - **E-mail**: o valor de `ADMIN_EMAIL`
   - **Senha**: o valor de `ADMIN_PASSWORD`
4. Após login, configure os dados da biblioteca em **Configurações** (nome, endereço, telefone, horário)

> **Importante**: O sistema não possui credenciais de demonstração. O primeiro usuário é
> criado exclusivamente pelas variáveis de ambiente. Usuários adicionais (atendentes) são
> criados pela tela **Usuários** após o primeiro login.

---

## Comandos úteis (raiz do monorepo)

| Comando | Descrição |
|---------|-----------|
| `pnpm dev` | Sobe API + web juntos (com hot-reload) |
| `pnpm dev:api` | Só a API (tsx watch em `apps/api`) |
| `pnpm dev:web` | Só o web (Vite em `apps/web`) |
| `pnpm build` | Compila shared → API → web |
| `pnpm typecheck` | Tipos em todos os workspaces |
| `pnpm lint` | ESLint do monorepo |
| `node scripts/verify-workspaces.mjs` | Checa workspaces e contratos |

### API (`apps/api`, ou `pnpm --filter @library/api <cmd>`)

| Comando | Descrição |
|---------|-----------|
| `pnpm dev` | Inicia o servidor com hot-reload (tsx watch) |
| `pnpm build` | Compila TypeScript p/ `dist/` + copia o Prisma Client gerado |
| `pnpm start` | Inicia em produção (`node dist/src/server.js`, requer build) |
| `pnpm db:setup` | Cria banco + aplica schema + roda seed |
| `pnpm db:push` | Aplica mudanças do schema sem seed |
| `pnpm db:seed` | Roda apenas o seed (cria admin se `.env` configurado) |
| `pnpm smoke` | Executa a suíte de testes E2E (62 casos) |
| `pnpm typecheck` | Verifica tipos sem gerar output |

### Web (`apps/web`, ou `pnpm --filter @library/web <cmd>`)

| Comando | Descrição |
|---------|-----------|
| `pnpm dev` | Inicia o servidor de desenvolvimento Vite |
| `pnpm build` | Compila para produção (verifica tipos + gera `dist/`) |
| `pnpm preview` | Visualiza a build de produção localmente |

> **Nota sobre PDFs**: A geração de Termos de Empréstimo/Devolução é feita no backend via `pdfkit`. Os PDFs são gerados dinamicamente e servidos como blobs autenticados — não há armazenamento de arquivos PDF no servidor.

---

## Variáveis de ambiente do Frontend

Crie `apps/web/.env` (opcional):

```env
VITE_API_URL=http://localhost:3333/api
```

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `VITE_API_URL` | `/api` (proxy do Vite) | URL da API. Só precisa definir se o backend estiver em outro host/porta |

---

## Troubleshooting (Problemas comuns)

### `EADDRINUSE: porta já está em uso`

Outro processo está usando a porta 3333 ou 5173.

```bash
# Windows — encontrar e matar o processo na porta
netstat -ano | findstr :3333
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :3333
kill -9 <PID>
```

### `[fatal] JWT_SECRET ausente`

O arquivo `apps/api/.env` não existe ou está vazio. Crie-o seguindo a seção 2.2.

### Seed não cria usuário administrador

Verifique se `ADMIN_EMAIL` e `ADMIN_PASSWORD` estão definidos no `apps/api/.env` antes de rodar `pnpm --filter @library/api db:seed`. Sem essas variáveis, o seed cria apenas a configuração inicial.

### Erro `P2021` (tabela não existe) após migrar / em produção

O `DATABASE_URL` relativo (`file:./dev.db`) é resolvido de forma diferente pelo
Prisma CLI (relativo ao schema) e pelo runtime (relativo ao cwd). Use **caminho
absoluto** no `apps/api/.env`, conforme a seção 2.2.

### `pnpm install` falha

Possível lockfile corrompido. Solução:

```bash
del pnpm-lock.yaml   # Windows
rm pnpm-lock.yaml    # Linux/Mac
pnpm install
```

### Buscas textuais não encontram registros

O SQLite é **case-sensitive** para buscas com `contains`. Busque exatamente como cadastrado (ex.: `Dom Casmurro`, não `dom casmurro`).

### Erro `P2002` (registro duplicado)

Violação de unique constraint. Ex.: tentar cadastrar um livro com ISBN já existente ou um leitor com CPF já cadastrado.

---

## Documentação completa

- [Arquitetura](docs/arquitetura.md) — stack, fluxo de dados, autenticação, RBAC, auditoria, erros
- [Referência da API](docs/api.md) — todos os endpoints, parâmetros, exemplos e erros
- [Regras de negócio](docs/regras-de-negocio.md) — limites, prazos, empréstimo em lote, autores, reservas, exclusão de leitores, backup
- [Módulos](docs/modulos.md) — routers do backend e páginas/rotas do frontend
- [Testes e validação](docs/testes.md) — smoke E2E, typecheck, validação de UI, política anti-mock

## Fluxo MVP validado

Cadastrar livro → cadastrar leitor → realizar empréstimo → gerar Termo de Empréstimo (PDF) → acompanhar prazo → registrar devolução com condição → gerar Termo de Devolução (PDF) → disponibilizar novamente o livro.

## Regras de negócio

- Limite inicial de 4 empréstimos ativos por leitor (configurável em Configurações)
- Prazo padrão de 15 dias (configurável)
- Leitor bloqueado ou inativo não realiza nem renova empréstimo
- Livro indisponível não é emprestado
- Empréstimo vencido vira ATRASADO automaticamente
- Snapshots de dados (leitor, livro, usuário) salvos no momento do empréstimo para uso nos Termos PDF
- Devolução libera o livro e pode ativar reserva aguardando
- Novo empréstimo aceita vários livros de uma vez, limitado ao que sobra do
  limite do leitor (ativos + selecionados ≤ limite configurado); os empréstimos
  são criados em transação única — se qualquer livro falhar (já emprestado,
  reservado, arquivado), nenhum é criado
- Autores: o formulário aceita nomes separados por vírgulas; nomes não
  cadastrados são criados automaticamente ao salvar, reaproveitando o autor
  existente quando o nome bate ignorando maiúsculas
- Livros possuem campos expandidos: volume, CDD, cutter, localização física, cópias disponíveis, tipo de aquisição
- Exclusão de leitores com anonimização LGPD (ADMIN apenas): dados pessoais substituídos (senha e assinatura apagadas); com empréstimos ativos, a exclusão é recusada (`409`)
- Termos de empréstimo/devolução: PDFs gerados dinamicamente com snapshots e assinatura digital incorporada, acessíveis pelo histórico do leitor e pelo portal
- Assinatura do leitor: pad obrigatório no empréstimo/devolução, salva reaproveitável, exigida antes de concluir
- Portal do leitor (`/cadastro`, `/minha-conta`): autocadastro, login isolado, empréstimos, reservas e dados próprios
- Categorias em taxonomia canônica de 39 itens (automação em `scripts/review-categories/`)
- Devolução com registro de condição do material (BOM/REGULAR/DANIFICADO) e observações/ocorrências
- Backups: download de arquivos existentes, restauração a partir de arquivo local do computador
- Toda operação registra o usuário responsável (auditoria; fluxos self/automáticos usam `null`)

## Testes

Detalhes em [docs/testes.md](docs/testes.md). Resumo:

```bash
# API — testes E2E (sobe servidor próprio efêmero, sem precisar rodar a API antes)
pnpm --filter @library/api smoke

# Tipos em todos os workspaces
pnpm typecheck

# Build completo (shared → API → web)
pnpm build
```

## Notas

- Buscas textuais no SQLite (Prisma `contains`) são case-sensitive; CPFs, códigos e números devem ser digitados conforme cadastrados.
- Senhas com bcryptjs (API compatível com bcrypt, sem dependência nativa no Windows).
- A comparação de nomes de autores para reaproveitamento ignora maiúsculas (feita em memória, no backend).
- SQLite não suporta enums do Prisma: campos como `acquisitionType` são validados por Zod na borda da API e armazenados como String.
