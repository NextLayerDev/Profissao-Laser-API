-- ============================================================
-- Atualiza pl_parameter pro novo formulario "Novo parametro":
--  + powerWatts, lens, software, line, crossHatch, angle,
--    passesFill, defocus  (colunas novas, nullable)
--  ~ gas: TEXT -> BOOLEAN (caixa liga/desliga)
--  ~ materialType, thickness: deixam de ser obrigatorios
-- Rodar no Supabase SQL Editor, no banco que tem pl_parameter.
-- ============================================================

-- Colunas novas do formulario (nullable: linhas antigas ficam NULL)
ALTER TABLE pl_parameter
  ADD COLUMN IF NOT EXISTS "powerWatts" INT,      -- 2. Potencia (W)
  ADD COLUMN IF NOT EXISTS lens TEXT,             -- 3. Lente (mm)
  ADD COLUMN IF NOT EXISTS software TEXT,         -- 4. Software
  ADD COLUMN IF NOT EXISTS line NUMERIC,          -- 10. Linha (mm)
  ADD COLUMN IF NOT EXISTS "crossHatch" INT,      -- 11. Preenchimento Cruzado (%)
  ADD COLUMN IF NOT EXISTS angle INT,             -- 12. Angulo (graus)
  ADD COLUMN IF NOT EXISTS "passesFill" INT,      -- 14. Passadas (Preenchimento)
  ADD COLUMN IF NOT EXISTS defocus INT;           -- Desfoque (mm, 0-20)

-- materialType / thickness sairam do formulario novo -> opcionais
ALTER TABLE pl_parameter
  ALTER COLUMN "materialType" DROP NOT NULL,
  ALTER COLUMN thickness DROP NOT NULL;

-- gas: TEXT -> BOOLEAN (caixa liga/desliga; gas = ar comprimido no corte).
-- Texto nao-vazio existente vira true; NULL/'' vira false.
-- Dentro de um DO block pra poder rodar de novo sem erro.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pl_parameter'
      AND column_name = 'gas'
      AND data_type <> 'boolean'
  ) THEN
    ALTER TABLE pl_parameter
      ALTER COLUMN gas TYPE BOOLEAN USING (gas IS NOT NULL AND btrim(gas) <> ''),
      ALTER COLUMN gas SET DEFAULT false,
      ALTER COLUMN gas SET NOT NULL;
  END IF;
END $$;
