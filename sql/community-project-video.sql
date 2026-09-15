-- Vídeo na vitrine da comunidade (mesmo composer da home). Idempotente.
-- A URL é do Bunny Storage (CDN), servida direto para a tag <video>.
ALTER TABLE pl_community_project ADD COLUMN IF NOT EXISTS video TEXT;
