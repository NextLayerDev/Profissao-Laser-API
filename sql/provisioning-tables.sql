-- ============================================================
-- PROVISIONING TABLES - Banco Master (Profissao Laser API)
-- Rodar no Supabase SQL Editor do banco principal
-- ============================================================

-- Clientes que compraram o sistema
CREATE TABLE pl_provisioning_customer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    phone TEXT,
    stripe_customer_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Pedidos de provisionamento
CREATE TABLE pl_provisioning_order (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES pl_provisioning_customer(id),
    stripe_session_id TEXT NOT NULL UNIQUE,
    stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    plan TEXT NOT NULL CHECK (plan IN ('prata', 'ouro', 'platina')),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_provisioning_order_customer ON pl_provisioning_order(customer_id);
CREATE INDEX idx_provisioning_order_status ON pl_provisioning_order(status);

-- Jobs de provisionamento com maquina de estados
CREATE TABLE pl_provisioning_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES pl_provisioning_order(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'created',
    slug TEXT NOT NULL UNIQUE,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,

    -- Supabase
    supabase_org_id TEXT,
    supabase_project_ref TEXT,
    supabase_db_pass_encrypted TEXT,
    supabase_url TEXT,
    supabase_anon_key TEXT,
    supabase_service_role_key_encrypted TEXT,

    -- Vercel
    vercel_project_id TEXT,
    vercel_deployment_id TEXT,
    vercel_url TEXT,
    blob_store_id TEXT,
    blob_token_encrypted TEXT,

    -- Admin
    admin_email TEXT,
    admin_password_encrypted TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_provisioning_job_order ON pl_provisioning_job(order_id);
CREATE INDEX idx_provisioning_job_status ON pl_provisioning_job(status);
CREATE INDEX idx_provisioning_job_slug ON pl_provisioning_job(slug);

-- Log de auditoria de cada transicao de estado
CREATE TABLE pl_provisioning_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES pl_provisioning_job(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_provisioning_audit_job ON pl_provisioning_audit_log(job_id);
CREATE INDEX idx_provisioning_audit_created ON pl_provisioning_audit_log(created_at DESC);

-- Registro permanente do tenant provisionado (sobrevive a recompras)
CREATE TABLE pl_tenant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES pl_provisioning_customer(id),
    provisioning_job_id UUID NOT NULL REFERENCES pl_provisioning_job(id),
    slug TEXT NOT NULL UNIQUE,
    current_plan TEXT NOT NULL CHECK (current_plan IN ('prata', 'ouro', 'platina')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),

    -- Credenciais do tenant (copia do job para independencia)
    supabase_project_ref TEXT NOT NULL,
    supabase_db_pass_encrypted TEXT NOT NULL,
    supabase_url TEXT NOT NULL,
    supabase_anon_key TEXT NOT NULL,
    supabase_service_role_key_encrypted TEXT NOT NULL,
    vercel_project_id TEXT NOT NULL,
    vercel_url TEXT NOT NULL,

    plan_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tenant_customer ON pl_tenant(customer_id);
CREATE INDEX idx_tenant_slug ON pl_tenant(slug);
CREATE INDEX idx_tenant_status ON pl_tenant(status);

-- Historico de mudancas de plano (auditoria)
CREATE TABLE pl_tenant_plan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES pl_tenant(id),
    from_plan TEXT,
    to_plan TEXT NOT NULL CHECK (to_plan IN ('prata', 'ouro', 'platina')),
    change_type TEXT NOT NULL CHECK (change_type IN ('initial', 'upgrade', 'downgrade', 'renewal')),
    stripe_session_id TEXT,
    stripe_subscription_id TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_plan_history_tenant ON pl_tenant_plan_history(tenant_id);
CREATE INDEX idx_plan_history_created ON pl_tenant_plan_history(created_at DESC);
