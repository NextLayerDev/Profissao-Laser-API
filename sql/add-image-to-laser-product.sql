-- ============================================================
-- Adiciona "imageUrl" opcional em pl_laser_product: foto do
-- produto em si, alem das fotos por variant. NULL = produto
-- sem foto propria. Rodar no Supabase SQL Editor do master.
-- ============================================================

ALTER TABLE pl_laser_product
  ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

COMMENT ON COLUMN pl_laser_product."imageUrl" IS
  'Foto do produto em si (Bunny CDN). Opcional — as variants tem foto propria em pl_laser_product_variant."imageUrl".';
