# Modo course-only — visão da API central

Este documento explica como a API central (este repo) **suporta** o modo
course-only do `system_porteira` sem precisar mudar nenhum endpoint.

## Contexto

Tenants com `only_profissao=true` (clientes que compraram só o curso) acessam
o sistema pela rota nova `/curso` no `slug.vercel.app` — login pela API central
e UI da Profissão Laser direto, sem dashboard de gestão e **sem DB local**.

A API central **não muda comportamento** — apenas:

1. Ganha 1 coluna em `pl_tenant` pra marcar quem é course-only
2. Ganha 1 script de migração pra mover os 53 existentes (sem mexer em endpoint)

## Por que a API não precisa mudar

A aba Profissão Laser do `system_porteira` já chama esta API hoje via
`plApi` (axios) usando `NEXT_PUBLIC_PL_API_URL`. Os endpoints existentes:

- `POST /login/customer` — autentica e devolve `{token}` (Supabase access_token)
- `POST /login/user` — idem para staff/admin
- `GET /me/subscription` — devolve a subscription do customer (usa `authenticateCustomer`)
- `GET /course/:slug`, `/lesson/:id`, `/progress`, etc.

…já cobrem 100% do que a rota `/curso` precisa. O `system_porteira` faz:

1. `POST {PL_API_URL}/login/customer` no submit do form
2. Salva o `token` em cookie httpOnly + localStorage
3. Renderiza o `<ProfissaoLaserStandalone />`
4. As chamadas de aulas/progresso usam o token igual ao modo full atual

## Mudanças no schema central

Aplicar `sql/add-tenant-only-profissao-flag.sql`:

```sql
ALTER TABLE "pl_tenant"
  ADD COLUMN IF NOT EXISTS "only_profissao" BOOLEAN NOT NULL DEFAULT false;
```

Backfill incluso na própria migration: lê `pl_provisioning_order.metadata.only_profissao`
e marca os tenants existentes.

## Script de migração

`scripts/migrate-existing-only-profissao.ts`:

Para cada tenant com `only_profissao=true` que ainda tem `supabase_project_ref`:

1. Atualiza envs do projeto Vercel:
   - **Remove**: `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - **Adiciona**: `NEXT_PUBLIC_TENANT_MODE=course_only`, `TENANT_MODE=course_only`
   - **Mantém**: `NEXT_PUBLIC_PL_API_URL` (ou `NEXT_PUBLIC_API_URL` em tenants antigos — porteira aceita os 2 nomes)
2. **Seta Build Command override** no Vercel project: `prisma generate && next build` (pula `prisma migrate deploy` que tentaria conectar no Supabase deletado)
3. Dispara redeploy do Vercel
4. Deleta o projeto Supabase (irreversível — só após redeploy)
5. Zera `pl_tenant.supabase_*` no central

> O `package.json` do `system_porteira` continua igual em `main` (`prisma migrate deploy && prisma generate && next build`). Tenants em `course_only` usam Build Command override próprio do Vercel project — apenas eles pulam o migrate.

**Default `--dry-run`.** Para executar:

```bash
# dry-run em todos
npx tsx --env-file=.env scripts/migrate-existing-only-profissao.ts

# apply em 1 piloto
npx tsx --env-file=.env scripts/migrate-existing-only-profissao.ts \
  --apply --only=cliente@x.com

# apply em todos
npx tsx --env-file=.env scripts/migrate-existing-only-profissao.ts --apply
```

## Pré-requisitos para executar a migração

- [x] SQL `add-tenant-only-profissao-flag.sql` aplicado no Supabase central
- [ ] PR PORTEIRA-1 mergeado e deployado (rota `/curso` existe nos tenants)
- [ ] PR PORTEIRA-2 mergeado e deployado (middleware course_only ativo)
- [ ] 1 tenant piloto migrado e validado por usuário real

Não deletar Supabases dos 53 antes de validar o piloto.

## Provisioning de novos course-only

O webhook do Stripe (`src/routes/webhook.ts`, commit `b5330cf`) **já pula**
o `handleSystemProvisioning` quando `gerenciamentoSistema=false`. Como
consequência, novas compras course-only **não criam Vercel project**
automaticamente hoje.

Para automatizar isso (criar só Vercel project sem Supabase), sugere-se um
PR futuro no webhook — não está incluído neste escopo. Por enquanto, novos
tenants course-only podem ser criados manualmente via script (exemplo a
ser desenvolvido).
