# Sistema de Créditos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que customers comprem créditos via Stripe e gastem esses créditos em features pagas (prévia após cota, vetorização, editor-IA), com pacotes e custos definidos pelo admin.

**Architecture:** Carteira de saldo materializada (`pl_credit_wallet`) + livro-razão append-only (`pl_credit_transaction`). Débito atômico e idempotente via funções Postgres chamadas por `supabase.rpc`. Compra via Stripe Checkout (mesmo padrão de `payment-link.ts`), creditada idempotentemente no webhook `checkout.session.completed`. Camadas espelham a estrutura existente (types → repository → service → controller → route).

**Tech Stack:** TypeScript, Fastify, Supabase (Postgres), Stripe SDK, Zod, Vitest (novo).

**Spec:** `docs/superpowers/specs/2026-05-18-credits-design.md`

**Convenções do repo confirmadas:**
- Tabelas com prefixo `pl_`, SQL plano em `sql/` aplicado manualmente no Supabase SQL Editor.
- `supabase` client em `src/lib/supabase.js`; `stripe` em `src/lib/stripe.js`.
- Customer autenticado: `request.currentCustomer.id` (middleware `authenticateCustomer`).
- Admin: middleware `authenticateAdmin`.
- Controllers retornam `reply.status(n).send({ message })` em erro.
- Imports usam extensão `.js` (NodeNext) mesmo para arquivos `.ts`.
- Não commitar sem o usuário pedir — os passos "Commit" abaixo são executados pelo engenheiro sob revisão; mantenha-os, mas só execute o `git commit` quando estiver conduzindo o plano.

---

## Phase 0 — Test harness (Vitest)

### Task 0: Adicionar Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Instalar vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Adicionar script de teste em `package.json`**

No bloco `"scripts"`, adicionar a linha (manter as existentes):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Criar `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
	},
});
```

- [ ] **Step 4: Criar `tests/smoke.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

describe('harness', () => {
	it('runs', () => {
		expect(1 + 1).toBe(2);
	});
});
```

- [ ] **Step 5: Rodar e verificar verde**

Run: `npm test`
Expected: 1 passed (`tests/smoke.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "chore(test): introduz vitest"
```

---

## Phase 1 — Banco de dados

### Task 1: Schema SQL de créditos

**Files:**
- Create: `sql/credits-tables.sql`

- [ ] **Step 1: Criar `sql/credits-tables.sql`**

```sql
-- ============================================================
-- CREDIT SYSTEM TABLES - Banco Master (Profissao Laser API)
-- Carteira de créditos, livro-razão, pacotes (Stripe) e custo
-- por feature. Rodar no Supabase SQL Editor do banco principal.
-- ============================================================

-- Pacotes de crédito (definidos pelo admin; cada um vira um
-- Stripe product + price, igual ao padrão de addon).
CREATE TABLE pl_credit_package (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "credits" INTEGER NOT NULL CHECK ("credits" > 0),
    "price" NUMERIC(10,2) NOT NULL CHECK ("price" > 0),
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ativo' CHECK ("status" IN ('ativo','inativo')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Custo em créditos por feature (editável pelo admin sem deploy).
CREATE TABLE pl_credit_feature_cost (
    "feature" TEXT PRIMARY KEY,
    "cost" INTEGER NOT NULL CHECK ("cost" > 0),
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO pl_credit_feature_cost ("feature","cost","label") VALUES
    ('previa', 1, 'Prévia IA (após cota diária)'),
    ('vectorize', 1, 'Vetorização'),
    ('editor-ai', 1, 'Editor IA');

-- Carteira: saldo materializado por customer.
CREATE TABLE pl_credit_wallet (
    "customerId" TEXT PRIMARY KEY,
    "balance" INTEGER NOT NULL DEFAULT 0 CHECK ("balance" >= 0),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Livro-razão append-only.
CREATE TABLE pl_credit_transaction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL CHECK ("type" IN ('purchase','debit','refund','adjustment')),
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "feature" TEXT,
    "packageId" UUID REFERENCES pl_credit_package(id),
    "stripeSessionId" TEXT,
    "idempotencyKey" TEXT UNIQUE,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_tx_customer ON pl_credit_transaction("customerId");
CREATE INDEX idx_credit_tx_created_at ON pl_credit_transaction("createdAt" DESC);
```

- [ ] **Step 2: Append das funções RPC no mesmo arquivo**

Adicionar ao final de `sql/credits-tables.sql`:

```sql
-- Débito atômico + idempotente. Retorna o saldo após a operação.
CREATE OR REPLACE FUNCTION pl_consume_credits(
    p_customer_id TEXT,
    p_feature TEXT,
    p_cost INTEGER,
    p_idempotency_key TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS INTEGER AS $$
DECLARE
    v_existing pl_credit_transaction%ROWTYPE;
    v_balance INTEGER;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing FROM pl_credit_transaction
            WHERE "idempotencyKey" = p_idempotency_key;
        IF FOUND THEN
            RETURN v_existing."balanceAfter";
        END IF;
    END IF;

    INSERT INTO pl_credit_wallet ("customerId","balance")
        VALUES (p_customer_id, 0)
        ON CONFLICT ("customerId") DO NOTHING;

    SELECT "balance" INTO v_balance FROM pl_credit_wallet
        WHERE "customerId" = p_customer_id FOR UPDATE;

    IF v_balance < p_cost THEN
        RAISE EXCEPTION 'INSUFFICIENT_CREDITS:%:%', p_cost, v_balance;
    END IF;

    v_balance := v_balance - p_cost;
    UPDATE pl_credit_wallet
        SET "balance" = v_balance, "updatedAt" = NOW()
        WHERE "customerId" = p_customer_id;

    INSERT INTO pl_credit_transaction
        ("customerId","type","amount","balanceAfter","feature","idempotencyKey","metadata")
        VALUES (p_customer_id,'debit',-p_cost,v_balance,p_feature,p_idempotency_key,p_metadata);

    RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- Crédito de compra, idempotente por stripeSessionId.
CREATE OR REPLACE FUNCTION pl_add_credits(
    p_customer_id TEXT,
    p_amount INTEGER,
    p_package_id UUID,
    p_stripe_session_id TEXT
) RETURNS INTEGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    IF p_stripe_session_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM pl_credit_transaction
            WHERE "stripeSessionId" = p_stripe_session_id AND "type" = 'purchase'
    ) THEN
        SELECT "balance" INTO v_balance FROM pl_credit_wallet
            WHERE "customerId" = p_customer_id;
        RETURN COALESCE(v_balance, 0);
    END IF;

    INSERT INTO pl_credit_wallet ("customerId","balance")
        VALUES (p_customer_id, 0)
        ON CONFLICT ("customerId") DO NOTHING;

    SELECT "balance" INTO v_balance FROM pl_credit_wallet
        WHERE "customerId" = p_customer_id FOR UPDATE;

    v_balance := v_balance + p_amount;
    UPDATE pl_credit_wallet
        SET "balance" = v_balance, "updatedAt" = NOW()
        WHERE "customerId" = p_customer_id;

    INSERT INTO pl_credit_transaction
        ("customerId","type","amount","balanceAfter","packageId","stripeSessionId")
        VALUES (p_customer_id,'purchase',p_amount,v_balance,p_package_id,p_stripe_session_id);

    RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- Ajuste manual admin (estorno/cortesia). Não deixa saldo negativo.
CREATE OR REPLACE FUNCTION pl_adjust_credits(
    p_customer_id TEXT,
    p_amount INTEGER,
    p_reason TEXT
) RETURNS INTEGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    INSERT INTO pl_credit_wallet ("customerId","balance")
        VALUES (p_customer_id, 0)
        ON CONFLICT ("customerId") DO NOTHING;

    SELECT "balance" INTO v_balance FROM pl_credit_wallet
        WHERE "customerId" = p_customer_id FOR UPDATE;

    v_balance := GREATEST(0, v_balance + p_amount);
    UPDATE pl_credit_wallet
        SET "balance" = v_balance, "updatedAt" = NOW()
        WHERE "customerId" = p_customer_id;

    INSERT INTO pl_credit_transaction
        ("customerId","type","amount","balanceAfter","metadata")
        VALUES (p_customer_id,'adjustment',p_amount,v_balance,
                jsonb_build_object('reason', p_reason));

    RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- Estorno (refund-on-failure). Idempotente pela idempotencyKey do refund.
CREATE OR REPLACE FUNCTION pl_refund_credits(
    p_customer_id TEXT,
    p_amount INTEGER,
    p_feature TEXT,
    p_idempotency_key TEXT
) RETURNS INTEGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    IF p_idempotency_key IS NOT NULL AND EXISTS (
        SELECT 1 FROM pl_credit_transaction
            WHERE "idempotencyKey" = p_idempotency_key
    ) THEN
        SELECT "balance" INTO v_balance FROM pl_credit_wallet
            WHERE "customerId" = p_customer_id;
        RETURN COALESCE(v_balance, 0);
    END IF;

    INSERT INTO pl_credit_wallet ("customerId","balance")
        VALUES (p_customer_id, 0)
        ON CONFLICT ("customerId") DO NOTHING;

    SELECT "balance" INTO v_balance FROM pl_credit_wallet
        WHERE "customerId" = p_customer_id FOR UPDATE;

    v_balance := v_balance + p_amount;
    UPDATE pl_credit_wallet
        SET "balance" = v_balance, "updatedAt" = NOW()
        WHERE "customerId" = p_customer_id;

    INSERT INTO pl_credit_transaction
        ("customerId","type","amount","balanceAfter","feature","idempotencyKey")
        VALUES (p_customer_id,'refund',p_amount,v_balance,p_feature,p_idempotency_key);

    RETURN v_balance;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: Aplicar manualmente**

Rodar o conteúdo de `sql/credits-tables.sql` no Supabase SQL Editor do banco principal. Confirmar criação de 4 tabelas + 4 funções e os 3 seeds em `pl_credit_feature_cost`.

- [ ] **Step 4: Commit**

```bash
git add sql/credits-tables.sql
git commit -m "feat(credits): schema SQL (tabelas + funções RPC)"
```

---

## Phase 2 — Tipos e erros de domínio

### Task 2: `src/types/credit.ts`

**Files:**
- Create: `src/types/credit.ts`

- [ ] **Step 1: Criar `src/types/credit.ts`**

```ts
import { z } from 'zod';

export const CREDIT_FEATURES = ['previa', 'vectorize', 'editor-ai'] as const;
export type CreditFeature = (typeof CREDIT_FEATURES)[number];

export const creditBalanceSchema = z.object({ balance: z.number().int() });

export const creditPackageSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	credits: z.number().int(),
	price: z.number(),
	status: z.enum(['ativo', 'inativo']),
});
export const creditPackageListSchema = z.array(creditPackageSchema);

export const creditCostSchema = z.object({
	feature: z.string(),
	cost: z.number().int(),
	label: z.string(),
});
export const creditCostListSchema = z.array(creditCostSchema);

export const createCheckoutSchema = z.object({ packageId: z.string() });
export const checkoutResponseSchema = z.object({
	checkoutUrl: z.string(),
	sessionId: z.string(),
});

export const createPackageSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	credits: z.number().int().positive(),
	price: z.number().positive(),
});
export const updatePackageSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	credits: z.number().int().positive().optional(),
	price: z.number().positive().optional(),
});
export const updatePackageStatusSchema = z.object({ active: z.boolean() });

export const updateCostSchema = z.object({ cost: z.number().int().positive() });

export const adjustCreditsSchema = z.object({
	customerId: z.string(),
	amount: z.number().int(),
	reason: z.string().min(1),
});

export const creditHistoryQuerySchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
});
export const creditTransactionSchema = z.object({
	id: z.string(),
	type: z.enum(['purchase', 'debit', 'refund', 'adjustment']),
	amount: z.number().int(),
	balanceAfter: z.number().int(),
	feature: z.string().nullable(),
	createdAt: z.string(),
});
export const creditHistoryResponseSchema = z.object({
	data: z.array(creditTransactionSchema),
	total: z.number().int(),
	page: z.number().int(),
	limit: z.number().int(),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
export type AdjustCreditsInput = z.infer<typeof adjustCreditsSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos referentes a `src/types/credit.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/credit.ts
git commit -m "feat(credits): tipos e schemas zod"
```

### Task 3: `src/lib/credit-errors.ts`

**Files:**
- Create: `src/lib/credit-errors.ts`

- [ ] **Step 1: Criar `src/lib/credit-errors.ts`**

```ts
import type { CreditFeature } from '../types/credit.js';

/** Operação custa crédito e o request não confirmou o gasto. */
export class CreditConfirmationRequiredError extends Error {
	constructor(
		public readonly feature: CreditFeature,
		public readonly cost: number,
		public readonly balance: number,
	) {
		super(`Confirmação necessária: ${feature} custa ${cost} crédito(s)`);
		this.name = 'CreditConfirmationRequiredError';
	}
}

/** Confirmou o gasto mas o saldo é insuficiente. */
export class InsufficientCreditsError extends Error {
	constructor(
		public readonly feature: CreditFeature,
		public readonly cost: number,
		public readonly balance: number,
	) {
		super(`Saldo insuficiente: ${feature} custa ${cost}, saldo ${balance}`);
		this.name = 'InsufficientCreditsError';
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/credit-errors.ts
git commit -m "feat(credits): erros de domínio"
```

---

## Phase 3 — Repository

### Task 4: `src/repositories/credit.ts`

**Files:**
- Create: `src/repositories/credit.ts`

- [ ] **Step 1: Criar `src/repositories/credit.ts`**

```ts
import { supabase } from '../lib/supabase.js';
import type { CreditFeature } from '../types/credit.js';

interface PackageRow {
	id: string;
	name: string;
	description: string | null;
	credits: number;
	price: number;
	status: 'ativo' | 'inativo';
	stripeProductId: string | null;
	stripePriceId: string | null;
}

interface CreatePackageRow {
	name: string;
	description?: string;
	credits: number;
	price: number;
	stripeProductId: string;
	stripePriceId: string;
}

class CreditRepository {
	async getBalance(customerId: string): Promise<number> {
		const { data, error } = await supabase
			.from('pl_credit_wallet')
			.select('balance')
			.eq('customerId', customerId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data?.balance ?? 0;
	}

	async getFeatureCost(feature: CreditFeature): Promise<number> {
		const { data, error } = await supabase
			.from('pl_credit_feature_cost')
			.select('cost')
			.eq('feature', feature)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error(`Feature cost not configured: ${feature}`);
		return data.cost;
	}

	async listFeatureCosts() {
		const { data, error } = await supabase
			.from('pl_credit_feature_cost')
			.select('feature, cost, label')
			.order('feature');
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async setFeatureCost(feature: string, cost: number) {
		const { error } = await supabase
			.from('pl_credit_feature_cost')
			.update({ cost, updatedAt: new Date().toISOString() })
			.eq('feature', feature);
		if (error) throw new Error(error.message);
	}

	async consume(params: {
		customerId: string;
		feature: CreditFeature;
		cost: number;
		idempotencyKey: string;
		metadata?: Record<string, unknown>;
	}): Promise<number> {
		const { data, error } = await supabase.rpc('pl_consume_credits', {
			p_customer_id: params.customerId,
			p_feature: params.feature,
			p_cost: params.cost,
			p_idempotency_key: params.idempotencyKey,
			p_metadata: params.metadata ?? {},
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async refund(params: {
		customerId: string;
		amount: number;
		feature: CreditFeature;
		idempotencyKey: string;
	}): Promise<number> {
		const { data, error } = await supabase.rpc('pl_refund_credits', {
			p_customer_id: params.customerId,
			p_amount: params.amount,
			p_feature: params.feature,
			p_idempotency_key: params.idempotencyKey,
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async addCredits(params: {
		customerId: string;
		amount: number;
		packageId: string;
		stripeSessionId: string;
	}): Promise<number> {
		const { data, error } = await supabase.rpc('pl_add_credits', {
			p_customer_id: params.customerId,
			p_amount: params.amount,
			p_package_id: params.packageId,
			p_stripe_session_id: params.stripeSessionId,
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async adjust(customerId: string, amount: number, reason: string) {
		const { data, error } = await supabase.rpc('pl_adjust_credits', {
			p_customer_id: customerId,
			p_amount: amount,
			p_reason: reason,
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async findPackageById(id: string): Promise<PackageRow> {
		const { data, error } = await supabase
			.from('pl_credit_package')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Credit package not found');
		return data as PackageRow;
	}

	async listPackages(onlyActive: boolean): Promise<PackageRow[]> {
		let q = supabase.from('pl_credit_package').select('*').order('credits');
		if (onlyActive) q = q.eq('status', 'ativo');
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return (data ?? []) as PackageRow[];
	}

	async createPackage(row: CreatePackageRow): Promise<PackageRow> {
		const { data, error } = await supabase
			.from('pl_credit_package')
			.insert(row)
			.select()
			.single();
		if (error || !data) throw new Error(error?.message ?? 'Insert failed');
		return data as PackageRow;
	}

	async updatePackage(
		id: string,
		patch: Record<string, unknown>,
	): Promise<PackageRow> {
		const { data, error } = await supabase
			.from('pl_credit_package')
			.update({ ...patch, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error || !data) throw new Error(error?.message ?? 'Update failed');
		return data as PackageRow;
	}

	async listTransactions(customerId: string, page: number, limit: number) {
		const from = (page - 1) * limit;
		const to = from + limit - 1;
		const { data, error, count } = await supabase
			.from('pl_credit_transaction')
			.select('id, type, amount, balanceAfter, feature, createdAt', {
				count: 'exact',
			})
			.eq('customerId', customerId)
			.order('createdAt', { ascending: false })
			.range(from, to);
		if (error) throw new Error(error.message);
		return { data: data ?? [], total: count ?? 0 };
	}
}

export const creditRepository = new CreditRepository();
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos referentes a `src/repositories/credit.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/repositories/credit.ts
git commit -m "feat(credits): repository (wallet, ledger, packages, RPCs)"
```

---

## Phase 4 — Service (com testes Vitest)

### Task 5: `creditService.charge` — TDD

**Files:**
- Create: `src/services/credit.ts`
- Create: `tests/credit-service.test.ts`

- [ ] **Step 1: Escrever o teste que falha — `tests/credit-service.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories/credit.js', () => ({
	creditRepository: {
		getFeatureCost: vi.fn(),
		getBalance: vi.fn(),
		consume: vi.fn(),
		refund: vi.fn(),
	},
}));

import { creditRepository } from '../src/repositories/credit.js';
import {
	CreditConfirmationRequiredError,
	InsufficientCreditsError,
} from '../src/lib/credit-errors.js';
import { creditService } from '../src/services/credit.js';

const repo = creditRepository as unknown as {
	getFeatureCost: ReturnType<typeof vi.fn>;
	getBalance: ReturnType<typeof vi.fn>;
	consume: ReturnType<typeof vi.fn>;
	refund: ReturnType<typeof vi.fn>;
};

describe('creditService.charge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		repo.getFeatureCost.mockResolvedValue(2);
		repo.getBalance.mockResolvedValue(5);
		repo.consume.mockResolvedValue(3);
		repo.refund.mockResolvedValue(5);
	});

	it('lança CreditConfirmationRequiredError sem confirmação', async () => {
		await expect(
			creditService.charge({
				customerId: 'c1',
				feature: 'vectorize',
				idempotencyKey: 'k1',
				confirmed: false,
			}),
		).rejects.toBeInstanceOf(CreditConfirmationRequiredError);
		expect(repo.consume).not.toHaveBeenCalled();
	});

	it('lança InsufficientCreditsError quando saldo < custo', async () => {
		repo.getBalance.mockResolvedValue(1);
		await expect(
			creditService.charge({
				customerId: 'c1',
				feature: 'vectorize',
				idempotencyKey: 'k1',
				confirmed: true,
			}),
		).rejects.toBeInstanceOf(InsufficientCreditsError);
		expect(repo.consume).not.toHaveBeenCalled();
	});

	it('debita quando confirmado e com saldo, e refund() estorna', async () => {
		const handle = await creditService.charge({
			customerId: 'c1',
			feature: 'vectorize',
			idempotencyKey: 'k1',
			confirmed: true,
		});
		expect(repo.consume).toHaveBeenCalledWith({
			customerId: 'c1',
			feature: 'vectorize',
			cost: 2,
			idempotencyKey: 'k1',
			metadata: {},
		});
		expect(handle.cost).toBe(2);
		expect(handle.balance).toBe(3);

		await handle.refund();
		expect(repo.refund).toHaveBeenCalledWith({
			customerId: 'c1',
			amount: 2,
			feature: 'vectorize',
			idempotencyKey: 'refund:k1',
		});
	});
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test`
Expected: FAIL — `creditService` não existe / `charge` indefinido.

- [ ] **Step 3: Implementar `src/services/credit.ts` (mínimo p/ passar charge)**

```ts
import { randomBytes } from 'node:crypto';
import { stripe } from '../lib/stripe.js';
import {
	CreditConfirmationRequiredError,
	InsufficientCreditsError,
} from '../lib/credit-errors.js';
import { creditRepository } from '../repositories/credit.js';
import type { CreditFeature } from '../types/credit.js';

interface ChargeHandle {
	cost: number;
	balance: number;
	refund: () => Promise<void>;
}

class CreditService {
	async getBalance(customerId: string) {
		return { balance: await creditRepository.getBalance(customerId) };
	}

	async listCosts() {
		return creditRepository.listFeatureCosts();
	}

	async charge(params: {
		customerId: string;
		feature: CreditFeature;
		idempotencyKey: string;
		confirmed: boolean;
		metadata?: Record<string, unknown>;
	}): Promise<ChargeHandle> {
		const { customerId, feature, idempotencyKey, confirmed } = params;
		const cost = await creditRepository.getFeatureCost(feature);
		const balance = await creditRepository.getBalance(customerId);

		if (!confirmed) {
			throw new CreditConfirmationRequiredError(feature, cost, balance);
		}
		if (balance < cost) {
			throw new InsufficientCreditsError(feature, cost, balance);
		}

		const newBalance = await creditRepository.consume({
			customerId,
			feature,
			cost,
			idempotencyKey,
			metadata: params.metadata ?? {},
		});

		return {
			cost,
			balance: newBalance,
			refund: async () => {
				await creditRepository.refund({
					customerId,
					amount: cost,
					feature,
					idempotencyKey: `refund:${idempotencyKey}`,
				});
			},
		};
	}
}

export const creditService = new CreditService();
```

- [ ] **Step 4: Rodar o teste e confirmar verde**

Run: `npm test`
Expected: PASS (3 testes de `creditService.charge`).

- [ ] **Step 5: Commit**

```bash
git add src/services/credit.ts tests/credit-service.test.ts
git commit -m "feat(credits): creditService.charge + testes"
```

### Task 6: Checkout, fulfill, packages e admin no service

**Files:**
- Modify: `src/services/credit.ts`
- Modify: `tests/credit-service.test.ts`

- [ ] **Step 1: Adicionar teste de `fulfillPurchase` (idempotência via repo)**

Adicionar ao final de `tests/credit-service.test.ts`:

```ts
describe('creditService.fulfillPurchase', () => {
	it('credita pelo pacote resolvido do metadata', async () => {
		const r = creditRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
		r.findPackageById = vi.fn().mockResolvedValue({ id: 'p1', credits: 50 });
		r.addCredits = vi.fn().mockResolvedValue(50);

		const balance = await creditService.fulfillPurchase({
			id: 'sess_1',
			metadata: { type: 'credit_purchase', customer_id: 'c1', package_id: 'p1' },
		} as never);

		expect(r.findPackageById).toHaveBeenCalledWith('p1');
		expect(r.addCredits).toHaveBeenCalledWith({
			customerId: 'c1',
			amount: 50,
			packageId: 'p1',
			stripeSessionId: 'sess_1',
		});
		expect(balance).toBe(50);
	});
});
```

Atualizar o `vi.mock` do topo do arquivo para incluir os novos métodos:

```ts
vi.mock('../src/repositories/credit.js', () => ({
	creditRepository: {
		getFeatureCost: vi.fn(),
		getBalance: vi.fn(),
		consume: vi.fn(),
		refund: vi.fn(),
		findPackageById: vi.fn(),
		addCredits: vi.fn(),
	},
}));
```

- [ ] **Step 2: Rodar e confirmar que o novo teste falha**

Run: `npm test`
Expected: FAIL — `creditService.fulfillPurchase` não existe.

- [ ] **Step 3: Adicionar métodos ao `src/services/credit.ts`**

Adicionar dentro da classe `CreditService` (antes do fechamento da classe):

```ts
	async createCheckout(customerId: string, packageId: string) {
		const pkg = await creditRepository.findPackageById(packageId);
		if (pkg.status !== 'ativo') throw new Error('Package is not active');
		if (!pkg.stripePriceId) throw new Error('Package not configured for payments');

		const session = await stripe.checkout.sessions.create({
			line_items: [{ price: pkg.stripePriceId, quantity: 1 }],
			mode: 'payment',
			payment_method_types: ['card', 'boleto'],
			success_url: `${process.env.COURSES_URL ?? 'https://profissaolaser.com.br/course'}?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: process.env.CANCEL_URL ?? 'http://localhost:3000/cancelado',
			metadata: {
				type: 'credit_purchase',
				customer_id: customerId,
				package_id: pkg.id,
			},
		});
		return { checkoutUrl: session.url ?? '', sessionId: session.id };
	}

	async fulfillPurchase(session: {
		id: string;
		metadata: Record<string, string> | null;
	}): Promise<number> {
		const customerId = session.metadata?.customer_id;
		const packageId = session.metadata?.package_id;
		if (!customerId || !packageId) {
			throw new Error('Missing credit_purchase metadata');
		}
		const pkg = await creditRepository.findPackageById(packageId);
		return creditRepository.addCredits({
			customerId,
			amount: pkg.credits,
			packageId,
			stripeSessionId: session.id,
		});
	}

	async listPackages(onlyActive: boolean) {
		return creditRepository.listPackages(onlyActive);
	}

	async createPackage(data: {
		name: string;
		description?: string;
		credits: number;
		price: number;
	}) {
		const stripeProduct = await stripe.products.create({
			name: data.name,
			description: data.description || undefined,
		});
		const stripePrice = await stripe.prices.create({
			product: stripeProduct.id,
			unit_amount: Math.round(data.price * 100),
			currency: 'brl',
		});
		return creditRepository.createPackage({
			name: data.name,
			description: data.description,
			credits: data.credits,
			price: data.price,
			stripeProductId: stripeProduct.id,
			stripePriceId: stripePrice.id,
		});
	}

	async updatePackage(
		id: string,
		data: {
			name?: string;
			description?: string;
			credits?: number;
			price?: number;
		},
	) {
		const existing = await creditRepository.findPackageById(id);
		if (data.name && existing.stripeProductId) {
			await stripe.products.update(existing.stripeProductId, {
				name: data.name,
				...(data.description !== undefined && {
					description: data.description,
				}),
			});
		}
		const patch: Record<string, unknown> = {};
		if (data.name !== undefined) patch.name = data.name;
		if (data.description !== undefined) patch.description = data.description;
		if (data.credits !== undefined) patch.credits = data.credits;
		if (data.price !== undefined && existing.stripeProductId) {
			const newPrice = await stripe.prices.create({
				product: existing.stripeProductId,
				unit_amount: Math.round(data.price * 100),
				currency: 'brl',
			});
			patch.price = data.price;
			patch.stripePriceId = newPrice.id;
		}
		return creditRepository.updatePackage(id, patch);
	}

	async setPackageStatus(id: string, active: boolean) {
		return creditRepository.updatePackage(id, {
			status: active ? 'ativo' : 'inativo',
		});
	}

	async setFeatureCost(feature: string, cost: number) {
		await creditRepository.setFeatureCost(feature, cost);
		return { feature, cost };
	}

	async adjust(customerId: string, amount: number, reason: string) {
		const balance = await creditRepository.adjust(customerId, amount, reason);
		return { balance };
	}

	async listHistory(customerId: string, page: number, limit: number) {
		const { data, total } = await creditRepository.listTransactions(
			customerId,
			page,
			limit,
		);
		return { data, total, page, limit };
	}
```

- [ ] **Step 4: Remover import não usado**

`randomBytes` não é mais necessário — remover a linha `import { randomBytes } from 'node:crypto';` do topo de `src/services/credit.ts` se não for usada.

- [ ] **Step 5: Rodar testes + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: todos os testes PASS; sem erros de tipo novos.

- [ ] **Step 6: Commit**

```bash
git add src/services/credit.ts tests/credit-service.test.ts
git commit -m "feat(credits): checkout, fulfill, CRUD de pacotes e ajuste"
```

---

## Phase 5 — Controller e rotas

### Task 7: `src/controllers/credit.ts`

**Files:**
- Create: `src/controllers/credit.ts`

- [ ] **Step 1: Criar `src/controllers/credit.ts`**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	CreditConfirmationRequiredError,
	InsufficientCreditsError,
} from '../lib/credit-errors.js';
import { creditService } from '../services/credit.js';
import {
	adjustCreditsSchema,
	createCheckoutSchema,
	createPackageSchema,
	updateCostSchema,
	updatePackageSchema,
	updatePackageStatusSchema,
} from '../types/credit.js';

export function mapCreditError(err: unknown, reply: FastifyReply) {
	if (err instanceof CreditConfirmationRequiredError) {
		return reply.status(402).send({
			message: err.message,
			reason: 'confirmation_required',
			feature: err.feature,
			cost: err.cost,
			balance: err.balance,
		});
	}
	if (err instanceof InsufficientCreditsError) {
		return reply.status(402).send({
			message: err.message,
			reason: 'insufficient_balance',
			feature: err.feature,
			cost: err.cost,
			balance: err.balance,
		});
	}
	const message = err instanceof Error ? err.message : 'Unknown error';
	const status = message.includes('not found') ? 404 : 500;
	return reply.status(status).send({ message });
}

export const getBalanceController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(403).send({ message: 'Customer not found' });
	try {
		return reply.send(await creditService.getBalance(customerId));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const listCostsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		return reply.send(await creditService.listCosts());
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const listPackagesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		return reply.send(await creditService.listPackages(true));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const createCheckoutController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(403).send({ message: 'Customer not found' });
	try {
		const { packageId } = createCheckoutSchema.parse(request.body);
		return reply.send(await creditService.createCheckout(customerId, packageId));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const historyController = async (
	request: FastifyRequest<{ Querystring: { page?: number; limit?: number } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(403).send({ message: 'Customer not found' });
	try {
		const page = request.query.page ?? 1;
		const limit = request.query.limit ?? 20;
		return reply.send(await creditService.listHistory(customerId, page, limit));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

// ── Admin ────────────────────────────────────────────────────────────────
export const listAllPackagesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		return reply.send(await creditService.listPackages(false));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const createPackageController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createPackageSchema.parse(request.body);
		return reply.status(201).send(await creditService.createPackage(data));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const updatePackageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updatePackageSchema.parse(request.body);
		return reply.send(
			await creditService.updatePackage(request.params.id, data),
		);
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const updatePackageStatusController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { active } = updatePackageStatusSchema.parse(request.body);
		return reply.send(
			await creditService.setPackageStatus(request.params.id, active),
		);
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const updateCostController = async (
	request: FastifyRequest<{ Params: { feature: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { cost } = updateCostSchema.parse(request.body);
		return reply.send(
			await creditService.setFeatureCost(request.params.feature, cost),
		);
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const adjustController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { customerId, amount, reason } = adjustCreditsSchema.parse(
			request.body,
		);
		return reply.send(await creditService.adjust(customerId, amount, reason));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/controllers/credit.ts
git commit -m "feat(credits): controller + mapeamento de erro 402"
```

### Task 8: `src/routes/credit.ts` + registro no router

**Files:**
- Create: `src/routes/credit.ts`
- Modify: `src/router.ts`

- [ ] **Step 1: Criar `src/routes/credit.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	adjustController,
	createCheckoutController,
	createPackageController,
	getBalanceController,
	historyController,
	listAllPackagesController,
	listCostsController,
	listPackagesController,
	updateCostController,
	updatePackageController,
	updatePackageStatusController,
} from '../controllers/credit.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	adjustCreditsSchema,
	checkoutResponseSchema,
	createCheckoutSchema,
	createPackageSchema,
	creditBalanceSchema,
	creditCostListSchema,
	creditHistoryQuerySchema,
	creditHistoryResponseSchema,
	creditPackageListSchema,
	creditPackageSchema,
	updateCostSchema,
	updatePackageSchema,
	updatePackageStatusSchema,
} from '../types/credit.js';

export async function creditRoute(server: FastifyInstance) {
	server.get(
		'/credits/balance',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Saldo de créditos do customer logado.',
				response: { 200: creditBalanceSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		getBalanceController,
	);

	server.get(
		'/credits/costs',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Custo em créditos por feature.',
				response: { 200: creditCostListSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		listCostsController,
	);

	server.get(
		'/credits/packages',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Pacotes de crédito ativos para compra.',
				response: { 200: creditPackageListSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		listPackagesController,
	);

	server.post(
		'/credits/checkout',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Cria uma sessão Stripe Checkout para comprar um pacote.',
				body: createCheckoutSchema,
				response: {
					200: checkoutResponseSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		createCheckoutController,
	);

	server.get(
		'/credits/history',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Histórico (livro-razão) de créditos do customer.',
				querystring: creditHistoryQuerySchema,
				response: {
					200: creditHistoryResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		historyController,
	);

	// ── Admin ───────────────────────────────────────────────────────────
	server.get(
		'/credits/packages/all',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Lista todos os pacotes (inclui inativos).',
				response: { 200: creditPackageListSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		listAllPackagesController,
	);

	server.post(
		'/credits/packages',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Cria um pacote (Stripe product+price) e grava no banco.',
				body: createPackageSchema,
				response: {
					201: creditPackageSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPackageController,
	);

	server.put(
		'/credits/packages/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Edita um pacote de crédito.',
				params: z.object({ id: z.string() }),
				body: updatePackageSchema,
				response: {
					200: creditPackageSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		updatePackageController,
	);

	server.patch(
		'/credits/packages/:id/status',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Ativa/desativa um pacote.',
				params: z.object({ id: z.string() }),
				body: updatePackageStatusSchema,
				response: {
					200: creditPackageSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		updatePackageStatusController,
	);

	server.put(
		'/credits/costs/:feature',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Ajusta o custo em créditos de uma feature.',
				params: z.object({ feature: z.string() }),
				body: updateCostSchema,
				response: { 200: z.object({ feature: z.string(), cost: z.number() }), 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateCostController,
	);

	server.post(
		'/credits/adjust',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Ajuste manual de saldo (estorno/cortesia/correção).',
				body: adjustCreditsSchema,
				response: { 200: creditBalanceSchema, 403: ErrorSchema, 500: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		adjustController,
	);
}
```

- [ ] **Step 2: Registrar no `src/router.ts`**

Adicionar o import junto aos demais (ordem alfabética perto de `couponRoute`):

```ts
import { creditRoute } from './routes/credit.js';
```

E registrar dentro de `export const routes`, após `app.register(couponRoute);`:

```ts
	app.register(creditRoute);
```

- [ ] **Step 3: Typecheck + boot**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

Run: `timeout 8 npm run dev` (ou subir o server localmente)
Expected: server sobe sem erro; rotas `/credits/*` registradas no log/Swagger.

- [ ] **Step 4: Commit**

```bash
git add src/routes/credit.ts src/router.ts
git commit -m "feat(credits): rotas customer + admin"
```

---

## Phase 6 — Webhook (fulfillment de compra)

### Task 9: Branch `credit_purchase` no webhook

**Files:**
- Modify: `src/routes/webhook.ts`

- [ ] **Step 1: Importar o service**

No topo de `src/routes/webhook.ts`, junto aos imports de repositories/services, adicionar:

```ts
import { creditService } from '../services/credit.js';
```

- [ ] **Step 2: Adicionar guard no início de `handleCheckoutCompleted`**

Em `src/routes/webhook.ts`, na função `handleCheckoutCompleted`, logo após a verificação `const email = session.customer_details?.email; if (!email) return;` — NÃO; o fulfillment de crédito não depende de `email`. Inserir o branch como **primeira instrução** da função `handleCheckoutCompleted` (antes da linha `const email = session.customer_details?.email;`):

```ts
	if (session.metadata?.type === 'credit_purchase') {
		try {
			await creditService.fulfillPurchase({
				id: session.id,
				metadata: session.metadata as Record<string, string>,
			});
			server.log.info(
				{ sessionId: session.id, customerId: session.metadata.customer_id },
				'Credit purchase fulfilled',
			);
		} catch (err) {
			server.log.error(
				{ err, sessionId: session.id },
				'Failed to fulfill credit purchase',
			);
		}
		return;
	}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhook.ts
git commit -m "feat(credits): fulfillment de compra via webhook Stripe"
```

---

## Phase 7 — Integração nos consumidores

### Task 10: Prévia — fallback cota → crédito

**Files:**
- Modify: `src/types/previa.ts`
- Modify: `src/services/previa.ts`
- Modify: `src/controllers/previa.ts`

- [ ] **Step 1: Adicionar `useCredits` ao schema de geração**

Abrir `src/types/previa.ts`, localizar `generatePreviaSchema` (objeto zod do body de geração) e adicionar o campo opcional ao objeto:

```ts
	useCredits: z.boolean().optional().default(false),
```

(adicionar como mais uma chave do `z.object({ ... })` do `generatePreviaSchema`).

- [ ] **Step 2: Substituir o bloco de quota em `src/services/previa.ts`**

Localizar o bloco atual (linhas ~40-48):

```ts
		// ── Quota diário (5 prévias/dia, reset 00:00 BRT) ───────────────────
		const used = await previaRepository.countTodayByCustomer(customerId);
		if (used >= DAILY_PREVIA_LIMIT) {
			throw new DailyLimitError(
				DAILY_PREVIA_LIMIT,
				used,
				startOfTomorrowBRT().toISOString(),
			);
		}
```

Substituir por (cota grátis intacta; esgotou → cobra crédito com confirmação):

```ts
		// ── Quota diário (5 grátis/dia). Esgotou → crédito (confirmação). ───
		const used = await previaRepository.countTodayByCustomer(customerId);
		let creditHandle: { refund: () => Promise<void> } | null = null;
		if (used >= DAILY_PREVIA_LIMIT) {
			try {
				creditHandle = await creditService.charge({
					customerId,
					feature: 'previa',
					idempotencyKey: `previa:${customerId}:${crypto.randomUUID()}`,
					confirmed: body.useCredits === true,
				});
			} catch (err) {
				if (err instanceof CreditConfirmationRequiredError) {
					throw new DailyLimitError(
						DAILY_PREVIA_LIMIT,
						used,
						startOfTomorrowBRT().toISOString(),
					);
				}
				throw err;
			}
		}
```

Adicionar os imports no topo de `src/services/previa.ts`:

```ts
import { CreditConfirmationRequiredError } from '../lib/credit-errors.js';
import { creditService } from './credit.js';
```

(`crypto` já é importado no topo do arquivo como `import crypto from 'node:crypto';`.)

- [ ] **Step 3: Refund-on-failure ao redor da geração**

Em `src/services/previa.ts`, envolver a parte cara (da chamada `openrouter.chat.completions.create` até o `previaRepository.create(...)` final) de modo que, se qualquer exceção ocorrer após o débito, o crédito seja estornado. Implementar envolvendo o restante do método após o bloco de quota com:

```ts
		try {
			// ... TODO-EXISTING: todo o corpo atual a partir da resolução da
			// variant até o `return previaRepository.create({ ... });`
		} catch (err) {
			if (creditHandle) await creditHandle.refund();
			throw err;
		}
```

Concretamente: manter todo o código existente entre o bloco de quota e o `return`, apenas indentando-o dentro do `try`, e adicionar o `catch` acima imediatamente antes do fim do método. O `return previaRepository.create(...)` continua sendo a última instrução do `try`.

- [ ] **Step 4: Enriquecer o 429 da prévia com bloco de crédito**

Em `src/controllers/previa.ts`, no `catch` de `generatePreviaController`, o bloco `if (err instanceof DailyLimitError)` já devolve 429. Acrescentar ao payload o campo `creditOption` consultando saldo/custo. Substituir o `return reply.status(429).send({ ... })` por:

```ts
		if (err instanceof DailyLimitError) {
			const customerId = request.currentCustomer?.id;
			let creditOption: {
				cost: number;
				balance: number;
				canUseCredits: boolean;
			} | null = null;
			if (customerId) {
				try {
					const [{ balance }, costs] = await Promise.all([
						creditService.getBalance(customerId),
						creditService.listCosts(),
					]);
					const cost =
						costs.find((c) => c.feature === 'previa')?.cost ?? 1;
					creditOption = {
						cost,
						balance,
						canUseCredits: balance >= cost,
					};
				} catch {
					creditOption = null;
				}
			}
			return reply.status(429).send({
				message: `Você atingiu o limite diário de ${err.limit} prévias. Use créditos para gerar mais.`,
				code: 'DAILY_LIMIT_REACHED',
				limit: err.limit,
				used: err.used,
				remaining: 0,
				resetsAt: err.resetsAt,
				creditOption,
			});
		}
```

Adicionar o import no topo de `src/controllers/previa.ts`:

```ts
import { creditService } from '../services/credit.js';
```

Também mapear `InsufficientCreditsError` para 402 nesse mesmo `catch`, antes do `return reply.status(statusFor(message))`:

```ts
		if (err instanceof InsufficientCreditsError) {
			return reply.status(402).send({
				message: err.message,
				reason: 'insufficient_balance',
				feature: err.feature,
				cost: err.cost,
				balance: err.balance,
			});
		}
```

Adicionar ao import de erros: `import { InsufficientCreditsError } from '../lib/credit-errors.js';`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Verificação manual (checklist)**

Com server local + um customer de teste:
- Gerar prévia com cota disponível → 201, sem débito (conferir `pl_credit_transaction` vazio para o customer).
- Esgotar a cota (gerar 5) → 6ª sem `useCredits` → 429 com `creditOption`.
- 6ª com `useCredits: true` e saldo suficiente → 201 e 1 transação `debit`.
- Sem saldo e `useCredits: true` → 402 `insufficient_balance`.
- Forçar erro de IA após débito (ex.: env key inválida) → conferir transação `refund` compensatória.

- [ ] **Step 7: Commit**

```bash
git add src/types/previa.ts src/services/previa.ts src/controllers/previa.ts
git commit -m "feat(credits): prévia consome crédito após a cota diária"
```

### Task 11: Vetorização — cobrar crédito

**Files:**
- Modify: `src/controllers/vector.ts` (controller de `vectorizeController`)
- Read first: `src/controllers/vector.ts`, `src/routes/vector.ts`

- [ ] **Step 1: Inspecionar o ponto de entrada**

Run: `grep -n "vectorizeController\|currentCustomer\|currentUser\|export const vectorize" src/controllers/vector.ts`
Objetivo: confirmar o nome do handler de vetorização e como o customer é resolvido (a rota usa `authenticateVectorizacao`; confirmar se expõe `request.currentCustomer?.id`; se não, usar o id disponível nesse middleware).

- [ ] **Step 2: Adicionar o charge no início do handler de vetorização**

No `vectorizeController` (e `vectorizeBatchController`, se existir e gerar custo por lote), antes de executar a vetorização, inserir:

```ts
	const customerId = request.currentCustomer?.id;
	if (!customerId) {
		return reply.status(403).send({ message: 'Customer not found' });
	}
	const confirmed =
		(request.body as { useCredits?: boolean } | undefined)?.useCredits === true;
	let creditHandle: { refund: () => Promise<void> } | null = null;
	try {
		creditHandle = await creditService.charge({
			customerId,
			feature: 'vectorize',
			idempotencyKey: `vectorize:${customerId}:${crypto.randomUUID()}`,
			confirmed,
		});
	} catch (err) {
		return mapCreditError(err, reply);
	}
	try {
		// ... TODO-EXISTING: corpo atual da vetorização, terminando no reply.send(...)
	} catch (err) {
		if (creditHandle) await creditHandle.refund();
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
```

Imports no topo de `src/controllers/vector.ts`:

```ts
import crypto from 'node:crypto';
import { mapCreditError } from './credit.js';
import { creditService } from '../services/credit.js';
```

(Se `crypto` já estiver importado, não duplicar.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Verificação manual**

- Vetorizar sem `useCredits` → 402 `confirmation_required` com `cost`/`balance`.
- Com `useCredits: true` e saldo → 200 e 1 transação `debit`.
- Forçar erro no processamento → conferir `refund`.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/vector.ts
git commit -m "feat(credits): vetorização consome crédito"
```

### Task 12: Editor-IA — cobrar crédito

**Files:**
- Modify: `src/controllers/editor-ai.ts`
- Read first: `src/controllers/editor-ai.ts`, `src/routes/editor-ai.ts`, `src/types/editor-ai.ts`

- [ ] **Step 1: Inspecionar o handler**

Run: `grep -n "editorAiController\|currentCustomer\|export const editor" src/controllers/editor-ai.ts`
Objetivo: confirmar o handler principal de geração/edição (`editorAiController`) e a resolução do customer (rota usa `authenticateCustomer` → `request.currentCustomer.id`).

- [ ] **Step 2: Adicionar `useCredits` ao schema do editor**

Em `src/types/editor-ai.ts`, no schema do body de `editorAiController` (geração/edição), adicionar:

```ts
	useCredits: z.boolean().optional().default(false),
```

- [ ] **Step 3: Cobrar crédito no `editorAiController`**

No início do `editorAiController`, após resolver `customerId`, inserir o mesmo padrão de charge da Task 11 mas com `feature: 'editor-ai'` e `idempotencyKey: \`editor-ai:${customerId}:${crypto.randomUUID()}\``, envolvendo a chamada a `editorAiService.generateOrEdit(...)` no `try/catch` com `creditHandle.refund()` no erro. Imports:

```ts
import crypto from 'node:crypto';
import { mapCreditError } from './credit.js';
import { creditService } from '../services/credit.js';
```

Estrutura (adaptar nomes de variáveis ao handler existente):

```ts
	const customerId = request.currentCustomer?.id;
	if (!customerId) {
		return reply.status(403).send({ message: 'Customer not found' });
	}
	const confirmed =
		(request.body as { useCredits?: boolean } | undefined)?.useCredits === true;
	let creditHandle: { refund: () => Promise<void> } | null = null;
	try {
		creditHandle = await creditService.charge({
			customerId,
			feature: 'editor-ai',
			idempotencyKey: `editor-ai:${customerId}:${crypto.randomUUID()}`,
			confirmed,
		});
	} catch (err) {
		return mapCreditError(err, reply);
	}
	try {
		// ... TODO-EXISTING: chamada atual a editorAiService.generateOrEdit + reply.send
	} catch (err) {
		if (creditHandle) await creditHandle.refund();
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Verificação manual**

- `/editor/ai` sem `useCredits` → 402 `confirmation_required`.
- Com `useCredits: true` e saldo → 200 + `debit`.
- Erro de IA → `refund`.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/editor-ai.ts src/types/editor-ai.ts
git commit -m "feat(credits): editor-IA consome crédito"
```

---

## Phase 8 — Fechamento

### Task 13: Suite final + revisão

**Files:** nenhum novo.

- [ ] **Step 1: Rodar tudo**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: testes PASS, sem erro de tipo, biome sem erros (apenas auto-fixes aceitáveis).

- [ ] **Step 2: Checklist de aceitação (manual, server local)**

- Admin cria pacote → aparece em `GET /credits/packages`; Stripe product/price criados.
- Admin edita custo de `previa` para 3 → `GET /credits/costs` reflete; prévia após cota cobra 3.
- `POST /credits/checkout` retorna `checkoutUrl`; pagar no Stripe test → webhook credita (1 transação `purchase`); reenviar o mesmo evento → não credita 2x.
- `POST /credits/adjust` com `amount` negativo não deixa saldo < 0.
- `GET /credits/history` lista as transações do customer.

- [ ] **Step 3: Commit final (se houver ajustes do lint)**

```bash
git add -A
git commit -m "chore(credits): lint e ajustes finais"
```

---

## Self-Review (preenchido pelo autor do plano)

**Spec coverage:**
- Cota grátis + crédito extra (prévia) → Task 10. ✓
- Consumidores: prévia/vetorização/editor-IA → Tasks 10/11/12. ✓
- Pacotes admin (Stripe) + edição + status → Tasks 1/6/8. ✓
- Custo por feature editável → Tasks 1/6/8. ✓
- Créditos não expiram → sem lógica de expiração (correto). ✓
- Confirmação explícita + refund-on-failure → Task 5 (`charge`) + Tasks 10-12. ✓
- Webhook idempotente → Task 1 (`pl_add_credits`) + Task 9. ✓
- 402 estruturado / 429 enriquecido → Tasks 7 e 10. ✓
- `/credits/adjust` admin → Tasks 6/8. ✓
- Vitest → Tasks 0/5/6. ✓

**Placeholders:** Os `// ... TODO-EXISTING` em Tasks 10-12 referenciam *código já existente* a ser mantido/indentado (não código a inventar); cada um indica exatamente o trecho (início/fim) e a transformação. As Tasks 11/12 começam com um passo de inspeção (`grep`) porque os internals desses handlers não foram lidos na fase de planejamento — o padrão de charge a aplicar está 100% especificado.

**Type consistency:** `creditService.charge` retorna handle `{ cost, balance, refund }` usado consistentemente; `CreditFeature` = `'previa'|'vectorize'|'editor-ai'` idem em types/erros/SQL seed; nomes de colunas SQL em camelCase entre aspas batem com os acessos do repository.
