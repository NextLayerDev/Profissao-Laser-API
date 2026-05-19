-- ============================================================
-- Adiciona "variantId" opcional em pl_product_parameter:
-- permite associar parametro + video-aula a uma VARIACAO
-- especifica do produto (pl_laser_product_variant), nao so ao
-- produto inteiro. NULL = a associacao vale pra qualquer
-- variacao do produto. Rodar no Supabase SQL Editor do master.
-- ============================================================

ALTER TABLE pl_product_parameter
  ADD COLUMN IF NOT EXISTS "variantId" UUID
  REFERENCES pl_laser_product_variant(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_product_parameter_variant
  ON pl_product_parameter("variantId");

COMMENT ON COLUMN pl_product_parameter."variantId" IS
  'Variacao do produto (pl_laser_product_variant) que a associacao mira. NULL = associacao product-level (vale pra qualquer variacao). Preenchido = associacao variant-level (vale so pra aquela variacao).';
