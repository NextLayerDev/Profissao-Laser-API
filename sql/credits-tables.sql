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
