-- Vídeo no feed da comunidade. Idempotente.
-- A URL é do Bunny Storage (CDN), servida direto para a tag <video>.
ALTER TABLE pl_community_post ADD COLUMN IF NOT EXISTS video TEXT;
