-- ============================================================
-- Gating de eventos/lives por plano em pl_community_event.
-- `allowedPlanKeys`: keys de planos do upvox que podem acessar a sala/stream.
-- Vazio ('{}') = aberto a todos (comportamento atual; eventos existentes
-- continuam abertos). Rodar no Supabase SQL Editor do tenant. Idempotente.
-- ============================================================

ALTER TABLE pl_community_event
    ADD COLUMN IF NOT EXISTS "allowedPlanKeys" TEXT[] NOT NULL DEFAULT '{}';
