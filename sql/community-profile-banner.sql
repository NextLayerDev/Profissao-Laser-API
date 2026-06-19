-- ============================================================
-- Banner do perfil do customer em pl_community_profile.
-- Guarda a URL do banner: um dos padrões (/banners/banner-*.png) ou foto
-- enviada (Bunny). NULL = usa o padrão via fallback no front.
-- Rodar no Supabase SQL Editor do banco do tenant. Idempotente.
-- ============================================================

ALTER TABLE pl_community_profile
    ADD COLUMN IF NOT EXISTS banner TEXT;

-- Distribui o banner padrão (Copa do Mundo 2026) a todos os clientes:
--   - quem ainda não escolheu nenhum (NULL);
--   - quem estava no padrão antigo (banner-3, "moeda Voxxys").
-- Idempotente: re-rodar não muda nada. Bancos que sobem agora já vão direto
-- pro Copa; quem rodou a versão anterior é migrado do banner-3 pro Copa.
UPDATE pl_community_profile
    SET banner = '/banners/banner-copa.png'
    WHERE banner IS NULL
       OR banner = '/banners/banner-3.png';
