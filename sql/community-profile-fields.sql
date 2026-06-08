-- ============================================================
-- Campos de perfil editáveis pelo próprio customer em pl_community_profile.
-- A coluna `image` (avatar, já existente) é o avatar do perfil + comunidade.
-- Rodar no Supabase SQL Editor do banco do tenant. Idempotente.
-- ============================================================

ALTER TABLE pl_community_profile
    ADD COLUMN IF NOT EXISTS nickname TEXT,
    ADD COLUMN IF NOT EXISTS bio      TEXT;
