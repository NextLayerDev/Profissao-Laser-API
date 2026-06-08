-- ============================================================
-- Adiciona flag `only_profissao` em pl_tenant pra rastrear
-- quais tenants estão em modo course-only (sem Supabase próprio,
-- só acessam Profissão Laser via API central pelo /curso).
--
-- Não muda lógica de nenhum endpoint da API — apenas metadata
-- pra dashboards de suporte e pro script de migração.
-- ============================================================

ALTER TABLE "pl_tenant"
  ADD COLUMN IF NOT EXISTS "only_profissao" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "pl_tenant"."only_profissao" IS
  'true = tenant sem Supabase/User_System próprio. Acessa apenas a aba Profissão Laser via API central (rota /curso no system_porteira). false = tenant com gestão completa.';

-- Índice parcial — usado pelos scripts de migração e dashboards de suporte.
CREATE INDEX IF NOT EXISTS "idx_pl_tenant_only_profissao"
  ON "pl_tenant"("only_profissao") WHERE "only_profissao" = true;

-- ============================================================
-- BACKFILL — popula a flag a partir do metadata da order
-- existente em pl_provisioning_order. Idempotente: só seta true
-- quando há order completa com only_profissao=true.
-- ============================================================
UPDATE "pl_tenant" t
SET "only_profissao" = true
WHERE t."only_profissao" = false
  AND EXISTS (
    SELECT 1
    FROM "pl_provisioning_order" o
    WHERE o."customer_id" = t."customer_id"
      AND o."status" = 'completed'
      AND (o."metadata"->>'only_profissao')::boolean = true
  );

-- (opcional) log de quantos foram afetados
SELECT
  COUNT(*) FILTER (WHERE only_profissao = true)  AS only_profissao_count,
  COUNT(*) FILTER (WHERE only_profissao = false) AS full_count
FROM "pl_tenant";
