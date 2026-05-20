-- ============================================================
-- Ajustes em pl_parameter conforme feedback do Fernando:
--
-- 1. crossHatch: INT 0-100 -> BOOLEAN NOT NULL DEFAULT false
--    (e um liga/desliga, nao um percentual).
--    Conversao de valores antigos: 0 -> false, > 0 -> true,
--    NULL -> false.
--
-- 2. defocus: a coluna ja e INT (que aceita negativos
--    nativamente). Sem DDL aqui — so o Zod da API muda pra
--    aceitar -20..20 (era 0..20). Mantido como nullable.
--
-- Idempotente: o DO block so executa se crossHatch ainda
-- estiver como INT/numeric. Rodar no Supabase SQL Editor.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pl_parameter'
      AND column_name = 'crossHatch'
      AND data_type <> 'boolean'
  ) THEN
    ALTER TABLE pl_parameter
      ALTER COLUMN "crossHatch" TYPE BOOLEAN
      USING (COALESCE("crossHatch", 0) > 0);

    UPDATE pl_parameter
       SET "crossHatch" = false
     WHERE "crossHatch" IS NULL;

    ALTER TABLE pl_parameter
      ALTER COLUMN "crossHatch" SET DEFAULT false,
      ALTER COLUMN "crossHatch" SET NOT NULL;
  END IF;
END $$;
