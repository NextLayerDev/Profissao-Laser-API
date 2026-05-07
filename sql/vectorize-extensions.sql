-- ============================================================
-- Vetorizacao: campos extras em customer_vectors
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

ALTER TABLE customer_vectors
    ADD COLUMN IF NOT EXISTS dxf_url TEXT,
    ADD COLUMN IF NOT EXISTS png_url TEXT,
    ADD COLUMN IF NOT EXISTS params JSONB;
