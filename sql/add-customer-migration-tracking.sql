-- ============================================================
-- Adiciona campos de rastreio para migração de tenants
-- only_profissao=true (gerenciamentoSistema=false) para o
-- modo course-only no system_porteira (deploy compartilhado).
-- ============================================================

ALTER TABLE "pl_provisioning_customer"
  ADD COLUMN IF NOT EXISTS "migrated_to_course_only_at" TIMESTAMPTZ;

ALTER TABLE "pl_provisioning_customer"
  ADD COLUMN IF NOT EXISTS "migration_notes" TEXT;

COMMENT ON COLUMN "pl_provisioning_customer"."migrated_to_course_only_at"
  IS 'Quando o cliente foi migrado do tenant Vercel/Supabase próprio para o deploy compartilhado course-only. NULL = ainda usa tenant próprio (ou nunca teve).';

COMMENT ON COLUMN "pl_provisioning_customer"."migration_notes"
  IS 'Notas livres sobre a migração (ex: slug antigo do tenant, refs deletadas, decisões manuais).';

CREATE INDEX IF NOT EXISTS "idx_pl_provisioning_customer_migrated_to_course_only"
  ON "pl_provisioning_customer"("migrated_to_course_only_at")
  WHERE "migrated_to_course_only_at" IS NOT NULL;
