-- ============================================================
-- SHOPEE SHOP → TENANT MAPPING - Banco Master (Profissao Laser API)
-- Rodar no Supabase SQL Editor do banco central pl-master.
-- ============================================================
--
-- Tabela usada pelo proxy de webhook da Shopee Open Platform:
--   - O painel da Shopee só aceita UMA "Push URL" por app, mas temos N deploys
--     Vercel (um por tenant). Tudo cai em /webhooks/shopee da API central.
--   - Quando recebe um push, a API central lê `shop_id` do body, faz lookup
--     nessa tabela pra descobrir pra qual tenant_slug forwardar o evento.
--   - O mapping é populado pelo endpoint /internal/shopee-shop/register, chamado
--     pelos próprios tenants (system_porteira) após OAuth bem-sucedido.

CREATE TABLE IF NOT EXISTS pl_tenant_shopee_shop (
    shop_id     TEXT PRIMARY KEY,
    tenant_slug TEXT NOT NULL REFERENCES pl_tenant(slug) ON DELETE CASCADE,
    store_id    TEXT NOT NULL,
    company_id  UUID,
    region      TEXT NOT NULL DEFAULT 'BR',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopee_shop_tenant
    ON pl_tenant_shopee_shop(tenant_slug);
