-- ============================================================
-- PAYMENT LINK TABLE - Banco Master (Profissao Laser API)
-- Links de pagamento únicos com desconto de 99%
-- Rodar no Supabase SQL Editor do banco principal
-- ============================================================

CREATE TABLE pl_payment_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    product_id UUID NOT NULL REFERENCES pl_product(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_cpf TEXT NOT NULL,
    company_name TEXT NOT NULL,
    stripe_coupon_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired')),
    used_at TIMESTAMPTZ,
    stripe_session_id TEXT,
    expires_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_payment_link_token ON pl_payment_link(token);
CREATE INDEX idx_payment_link_product ON pl_payment_link(product_id);
CREATE INDEX idx_payment_link_status ON pl_payment_link(status);
CREATE INDEX idx_payment_link_cpf ON pl_payment_link(customer_cpf);
