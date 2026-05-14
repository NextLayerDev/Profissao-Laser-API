-- ============================================================
-- CUSTOMER WATERMARK - Banco Master (Profissao Laser API)
-- Logo da empresa do customer pra usar como marca d'agua nas previas.
-- Singleton: 1 watermark por customer (PK = customerId).
-- Rodar no Supabase SQL Editor do banco principal.
-- ============================================================

CREATE TABLE pl_customer_watermark (
    "customerId" TEXT PRIMARY KEY,
    "imageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
