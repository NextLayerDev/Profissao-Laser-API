-- ============================================================
-- Banner do perfil do customer em pl_community_profile.
-- Guarda a URL do banner: um dos padrões (/banners/banner-*.png) ou foto
-- enviada (Bunny). NULL = usa o padrão via fallback no front.
-- Rodar no Supabase SQL Editor do banco do tenant. Idempotente.
-- ============================================================

ALTER TABLE pl_community_profile
    ADD COLUMN IF NOT EXISTS banner TEXT;

-- Distribui o banner padrão (Banner 3 — moeda Voxxys) a todos os clientes
-- já existentes que ainda não escolheram nenhum. Idempotente: re-rodar não
-- altera quem já tem banner.
UPDATE pl_community_profile
    SET banner = '/banners/banner-3.png'
    WHERE banner IS NULL;
