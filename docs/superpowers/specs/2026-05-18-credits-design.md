# Sistema de Créditos — Design

**Data:** 2026-05-18
**Status:** Aprovado para planejamento

## Objetivo

Permitir que customers comprem créditos via Stripe e gastem esses créditos para
usar funcionalidades pagas da plataforma. As prévias com IA mantêm a cota grátis
diária (5/dia, reset 00:00 BRT); créditos só entram quando a cota se esgota ou
para features sem cota (vetorização, editor-IA). O motor de crédito é genérico
e plugável em outras features no futuro.

## Decisões (definidas com o usuário)

1. **Cota grátis + créditos extras.** As 5 prévias/dia grátis continuam. Esgotou
   a cota → o customer pode gastar créditos comprados para continuar no mesmo dia.
2. **Consumidores iniciais:** Prévia IA (após a cota), Vetorização, Editor-IA.
   Motor genérico, plugável em outros pontos depois.
3. **Pacotes definidos pelo admin** (mesmo padrão dos addons: cada pacote vira um
   Stripe product + price). Admin pode criar, editar, ativar/desativar.
4. **Custo por feature configurável pelo admin** (sem deploy), via tabela editável.
5. **Créditos não expiram.**
6. **Confirmação explícita.** Nenhuma operação debita crédito sem uma flag de
   confirmação no request. Sem a flag → erro estruturado informando custo e saldo.
7. **Testes:** introduzir `vitest` para cobrir a lógica de crédito (parte de risco).
8. **Admin com edição completa** de pacotes e custos + endpoint de ajuste manual
   de saldo (`/credits/adjust`).

## Abordagem escolhida

**Carteira + Razão (ledger).** Tabela de carteira com saldo materializado +
livro-razão append-only para auditoria/idempotência. Débito feito por função
Postgres atômica (trava de linha) para impedir gasto duplo em requests
concorrentes. Webhook credita de forma idempotente pelo `stripe_session_id`.
Reaproveita o padrão Stripe existente (`payment-link.ts` checkout +
`checkout.session.completed` em `webhook.ts`).

## Modelo de dados — `sql/credits-tables.sql`

Todas as tabelas com prefixo `pl_`, arquivo SQL plano aplicado manualmente
(convenção do repo, ver `sql/`).

### `pl_credit_wallet`
- `customer_id` — PK, FK para customers
- `balance` — int NOT NULL DEFAULT 0, CHECK (`balance >= 0`)
- `created_at`, `updated_at`
- Uma linha por customer (criada lazy no primeiro crédito/consulta).

### `pl_credit_transaction` (append-only)
- `id` — uuid PK
- `customer_id` — FK
- `type` — `purchase` | `debit` | `refund` | `adjustment`
- `amount` — int (positivo p/ purchase/refund/adjustment+, negativo p/ debit)
- `balance_after` — int (saldo após a transação)
- `feature` — text NULL (`previa` | `vectorize` | `editor-ai`; null em compras)
- `package_id` — uuid NULL (FK `pl_credit_package`; preenchido em compras)
- `stripe_session_id` — text NULL
- `idempotency_key` — text UNIQUE NULL
- `metadata` — jsonb
- `created_at`

### `pl_credit_package` (admin; espelha addon)
- `id` — uuid PK
- `name`, `description`
- `credits` — int NOT NULL
- `price` — numeric (BRL)
- `stripe_product_id`, `stripe_price_id`
- `status` — `ativo` | `inativo`
- `created_at`, `updated_at`

### `pl_credit_feature_cost` (admin; editável sem deploy)
- `feature` — text PK (`previa` | `vectorize` | `editor-ai`)
- `cost` — int NOT NULL CHECK (`cost > 0`)
- `label` — text
- `updated_at`
- Seed inicial com defaults para as três features.

### Funções Postgres (chamadas via `supabase.rpc`)

`pl_consume_credits(p_customer_id, p_feature, p_cost, p_idempotency_key, p_metadata)`
- Numa única transação: trava a linha da carteira (`FOR UPDATE`), valida
  `balance >= cost`, debita, grava a transação `debit`, retorna saldo novo.
- Se `p_idempotency_key` já existe em `pl_credit_transaction` → retorna o
  resultado anterior sem cobrar de novo.
- Saldo insuficiente → levanta exceção (mapeada para erro de domínio na app).

`pl_add_credits(p_customer_id, p_amount, p_package_id, p_stripe_session_id)`
- Idempotente por `p_stripe_session_id` (evento Stripe reenviado não credita 2x).
- Cria a carteira se não existir; incrementa saldo; grava transação `purchase`.

`pl_adjust_credits(p_customer_id, p_amount, p_reason)` — ajuste manual admin
(positivo ou negativo), grava transação `adjustment`. Saldo nunca fica negativo.

## Camadas (espelham a estrutura atual)

- `src/types/credit.ts` — schemas zod (request/response).
- `src/repositories/credit.ts` — acesso a wallet/ledger/package/feature-cost + RPCs.
- `src/services/credit.ts` — lógica de negócio (checkout, charge, fulfill,
  balance, history, CRUD admin de pacotes/custos, ajuste manual).
- `src/controllers/credit.ts` — HTTP + mapeamento de erros.
- `src/routes/credit.ts` — definição das rotas; registrado em `src/router.ts`.
- `src/lib/credit-errors.ts` — `InsufficientCreditsError`,
  `CreditConfirmationRequiredError` (espelha o padrão `DailyLimitError`).

## Rotas

### Customer (`authenticateCustomer`)
- `GET /credits/balance` → `{ balance }`
- `GET /credits/packages` → pacotes ativos `[{ id, name, credits, price }]`
- `GET /credits/costs` → `[{ feature, cost, label }]`
- `POST /credits/checkout` `{ packageId }` → cria Stripe Checkout Session
  (mode `payment`), `metadata: { type: 'credit_purchase', customer_id,
  package_id }`, retorna `{ checkoutUrl, sessionId }`. Reusa o padrão de
  `payment-link.ts`.
- `GET /credits/history?page&limit` → razão paginada do customer.

### Admin (`authenticateAdmin`, como `/addon`)
- `POST /credits/packages` → cria Stripe product+price (igual `createAddon`) +
  grava pacote.
- `PUT /credits/packages/:id` → edita nome/descrição/créditos/preço (atualiza
  Stripe product/price conforme `updateProduct`).
- `PATCH /credits/packages/:id/status` → ativar/desativar.
- `GET /credits/packages/all` → lista incluindo inativos.
- `PUT /credits/costs/:feature` `{ cost }` → ajusta custo da feature.
- `POST /credits/adjust` `{ customerId, amount, reason }` → ajuste manual de
  saldo (estorno/cortesia/correção de disputa).

## Webhook (em `src/routes/webhook.ts`)

No início de `handleCheckoutCompleted`: se
`session.metadata?.type === 'credit_purchase'` →
`creditService.fulfillPurchase(session)` (idempotente) e **`return`** antes de
toda a lógica de provisionamento de tenant. Compras de crédito ficam isoladas
do fluxo de provisionamento. `fulfillPurchase` resolve o pacote pelo
`metadata.package_id` e chama `pl_add_credits`.

## Consumo (confirmação explícita) — helper compartilhado

`creditService.charge({ customerId, feature, idempotencyKey, confirmed }) → handle`
- Lê o custo da feature em `pl_credit_feature_cost` e o saldo da carteira.
- Sem `confirmed` → lança `CreditConfirmationRequiredError(feature, cost, balance)`.
- `confirmed` mas saldo < custo → lança `InsufficientCreditsError(feature, cost, balance)`.
- OK → `pl_consume_credits` atômico; retorna handle com `.refund()`.

**Refund-on-failure:** debita **antes** da chamada cara de IA. Se a operação
lançar exceção, emite transação `refund` compensatória e re-lança. O customer
nunca perde crédito por erro de IA/infra.

### Pontos de integração
- **Prévia** (`previaService.generate`): só **após** esgotar a cota diária.
  `GeneratePreviaInput` ganha `useCredits?: boolean`. Cota disponível → grátis
  (comportamento atual). Cota esgotada → `charge({ feature: 'previa',
  confirmed: body.useCredits })`, gera, e em caso de erro faz refund.
- **Vetorização** e **Editor-IA**: sem cota grátis → toda operação chama
  `charge(...)` com a mesma regra de confirmação. O front consulta
  `/credits/costs` antes para mostrar o custo.

## Tratamento de erro (HTTP)

- `402 Payment Required` com payload estruturado:
  `{ reason: 'confirmation_required' | 'insufficient_balance', feature, cost, balance }`.
- Prévia mantém `429` (limite diário) **enriquecido** com bloco
  `creditOption: { cost, balance, canUseCredits }` para o front oferecer
  "continuar gastando crédito".
- Webhook idempotente; evento Stripe duplicado não credita 2x.
- Checkout com pacote inválido/inativo → `400/404`.

## Testes (vitest — novo no repo)

Introduzir `vitest` + script `test` no `package.json`, cobrindo a parte de risco:
- `pl_consume_credits`: saldo insuficiente, saldo exato, idempotência (mesma
  key não cobra 2x), concorrência (dois débitos paralelos não furam o saldo).
- `fulfillPurchase`/`pl_add_credits`: evento Stripe duplicado não credita 2x.
- `creditService.charge`: sem confirmação → `CreditConfirmationRequiredError`;
  saldo insuficiente → `InsufficientCreditsError`; sucesso debita; refund-on-failure.
- Fallback de prévia: cota disponível não cobra; cota esgotada sem `useCredits`
  → 429+creditOption; com `useCredits` e saldo → debita e gera.

## Fora de escopo (YAGNI)

Expiração de crédito, auto-recarga/assinatura de crédito, reembolso automático
de disputa Stripe (coberto por `/credits/adjust` manual), multi-moeda.
