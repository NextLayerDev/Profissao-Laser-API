-- ============================================================
-- Adiciona flag `isAddon` em pl_product para marcar produtos
-- que podem ser adicionados como item extra a uma assinatura
-- existente (ex.: função paga a mais, cobrada junto do plano
-- principal no mesmo ciclo do Stripe).
--
-- Usada pelas rotas:
--   POST   /subscription/addon
--   DELETE /subscription/addon/:itemId
--   GET    /subscription/addons
-- ============================================================

ALTER TABLE "pl_product"
  ADD COLUMN IF NOT EXISTS "isAddon" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "pl_product"."isAddon" IS
  'true = produto é um addon (item extra que pode ser anexado a uma assinatura ativa, cobrado junto do plano principal). false = produto comum (plano principal ou compra avulsa).';
