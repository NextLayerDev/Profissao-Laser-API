-- ============================================================
-- GLOBAL PROMO LINK TABLES - Banco Master (Profissao Laser API)
-- Links promocionais GLOBAIS: desconto configurável sem produto fixo
-- O cliente escolhe qual produto comprar ao acessar o link
-- Rodar no Supabase SQL Editor do banco principal
-- ============================================================

-- 1. Tabela principal: links promocionais globais (sem product_id)
CREATE TABLE pl_global_promo_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
    duration_months INTEGER NOT NULL CHECK (duration_months > 0),
    max_redemptions INTEGER NOT NULL CHECK (max_redemptions > 0),
    current_redemptions INTEGER NOT NULL DEFAULT 0,
    stripe_coupon_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'exhausted', 'expired')),
    expires_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_global_promo_link_token ON pl_global_promo_link(token);
CREATE INDEX idx_global_promo_link_status ON pl_global_promo_link(status);

-- 2. Tabela de resgates: rastreia quem usou cada link e QUAL produto escolheu
CREATE TABLE pl_global_promo_link_redemption (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    global_promo_link_id UUID NOT NULL REFERENCES pl_global_promo_link(id),
    product_id UUID NOT NULL REFERENCES pl_product(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_cpf TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    company_name TEXT NOT NULL,
    stripe_session_id TEXT,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_global_promo_redemption_link ON pl_global_promo_link_redemption(global_promo_link_id);
CREATE INDEX idx_global_promo_redemption_cpf_phone ON pl_global_promo_link_redemption(global_promo_link_id, customer_cpf, customer_phone);
