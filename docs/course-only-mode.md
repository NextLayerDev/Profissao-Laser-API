# Course-only mode — integração com `system_porteira`

Este documento descreve as mudanças na **API central** (Profissao-Laser-API)
necessárias para suportar o modo `course-only` do `system_porteira` — deploy
único compartilhado em `course.profissaolaser.com.br` que atende todos os
clientes que compraram **apenas o curso** (ou seja, produtos com
`pl_system_class.gerenciamentoSistema = false`, ou compras avulsas sem
system_class vinculado).

## Contexto

Antes desta entrega:

- O webhook do Stripe (`src/routes/webhook.ts`) já foi ajustado no commit
  `b5330cf` para **pular** o tenant-provisioning (Supabase + Vercel + máquina
  de 12 estados) quando `gerenciamentoSistema=false`. Logo, novos compradores
  course-only **não** ganham mais infra própria.
- O `pl_subscription` continua sendo populado em `handleCheckoutCompleted`,
  então o cliente já tem acesso ao curso pela API central — só falta um
  frontend pra ele logar.

A solução escolhida: o `system_porteira` ganha um **modo dual**
(`TENANT_MODE=full | course_only`) e roda 1 deploy único em
`course.profissaolaser.com.br` para atender todos os course-only. Esse deploy
não tem DB próprio — chama a API central pra autenticação e dados.

Pra essa integração funcionar, a API central precisa expor:

1. **Login enriquecido** (com `refresh_token` + `customer/user` profile)
2. **`POST /auth/refresh`** — renovar access_token sem re-prompt do user
3. **`GET /auth/me`** — resolver identidade do token (user vs customer)

## Endpoints

### `POST /login/customer`

Body:
```json
{ "email": "cliente@x.com", "password": "secret123" }
```

**Response 200** (shape novo — retro-compat: campo `token` permanece):
```json
{
  "token": "eyJhbG...",
  "refresh_token": "v1.MR...",
  "expires_at": 1735689600,
  "customer": {
    "id": "uuid",
    "email": "cliente@x.com",
    "name": "Cliente Exemplo",
    "phone": "5511999998888"
  }
}
```

`expires_at` é Unix epoch seconds (vem direto do Supabase Auth).

### `POST /login/user`

Body: igual ao customer.

**Response 200**:
```json
{
  "token": "eyJhbG...",
  "refresh_token": "v1.MR...",
  "expires_at": 1735689600,
  "user": {
    "id": "uuid",
    "email": "staff@x.com",
    "name": "Staff Member",
    "role": "admin"
  }
}
```

### `POST /auth/refresh` *(novo)*

Body:
```json
{ "refresh_token": "v1.MR..." }
```

**Response 200**:
```json
{
  "token": "eyJhbG... (novo)",
  "refresh_token": "v1.MR... (rotated)",
  "expires_at": 1735693200
}
```

**Response 401**: refresh_token inválido/expirado/revogado.

Use case típico no porteira course-only:

```ts
// pseudocódigo no middleware do Next.js
const session = await getCookie('pl_session');
if (session.expires_at - 60 < now()) {
  const refreshed = await fetch('/api/pl-proxy/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  await setCookie('pl_session', refreshed);
}
```

### `GET /auth/me` *(novo)*

Headers: `Authorization: Bearer <access_token>`

**Response 200** — uma de duas variantes:

```json
{
  "type": "user",
  "id": "uuid",
  "email": "staff@x.com",
  "name": "Staff",
  "role": "admin"
}
```

ou:

```json
{
  "type": "customer",
  "id": "uuid",
  "email": "cliente@x.com",
  "name": "Cliente",
  "phone": "5511999998888"
}
```

**Response 401**: token inválido, expirado, ou identidade não encontrada.

Use case: o porteira course-only chama `/auth/me` no `getSession()` server-side
para validar o cookie sem precisar compartilhar `SUPABASE_JWT_SECRET`.

## Schema — colunas novas em `pl_provisioning_customer`

Migration em `sql/add-customer-migration-tracking.sql`:

```sql
ALTER TABLE "pl_provisioning_customer"
  ADD COLUMN IF NOT EXISTS "migrated_to_course_only_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "migration_notes" TEXT;
```

`migrated_to_course_only_at`: timestamp da migração do cliente do tenant
próprio para o deploy compartilhado course-only. NULL = ainda usa tenant
próprio (ou nunca teve).

`migration_notes`: texto livre — o script de migração preenche com info como
"Tenants removed: slug-do-tenant".

## Script de migração — `scripts/migrate-only-profissao-to-course-only.ts`

Detecta os 53 (atual) clientes com `pl_provisioning_order.metadata.only_profissao=true`
que ainda têm `pl_tenant` ativo. Para cada um (com confirmação por flag):

1. Deleta projeto Vercel
2. Deleta projeto Supabase
3. Limpa `pl_tenant` + `pl_tenant_plan_history` + `pl_provisioning_audit_log`
4. Marca `pl_provisioning_customer.migrated_to_course_only_at = now()`
5. (TODO) Envia email avisando o novo URL

**Default é `--dry-run`**. Para executar:

```bash
# dry-run (default — só lista)
npx tsx --env-file=.env scripts/migrate-only-profissao-to-course-only.ts

# apenas 1 cliente, modo apply
npx tsx --env-file=.env scripts/migrate-only-profissao-to-course-only.ts \
  --apply --only=cliente@x.com

# apply em todos
npx tsx --env-file=.env scripts/migrate-only-profissao-to-course-only.ts --apply
```

## CORS

Já está com `origin: true` em `src/server.ts` (todas origens permitidas).
Nada a mudar — `course.profissaolaser.com.br` será aceito.

## Rate limit

Não há rate limit configurado hoje. Em uma fase futura, recomenda-se
adicionar `@fastify/rate-limit` por user_id (lido do JWT) nas rotas
autenticadas. Não é bloqueante para o course-only.

## Compatibilidade retroativa

Todas as mudanças são **backward-compatible**:

- `/login/customer` e `/login/user` continuam aceitando o mesmo body e
  retornando o campo `token` nas mesmas posições. Apenas adicionam novos
  campos (`refresh_token`, `expires_at`, `customer`/`user`).
- Frontends existentes que ignoram campos extras continuam funcionando.
- Os novos endpoints (`/auth/refresh`, `/auth/me`) são adições puras.
- A migration SQL é `ADD COLUMN IF NOT EXISTS` — idempotente.
