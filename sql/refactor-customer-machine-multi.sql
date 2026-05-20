-- ============================================================
-- pl_customer_machine: singleton -> multi-row por customer.
-- + id UUID PK (novo); customerId vira NOT NULL (sem PK).
-- + name TEXT opcional (rotulo do customer).
-- + isDefault BOOLEAN com unique partial index (1 default/customer).
-- Linhas existentes (singletons) viram default automaticamente.
-- Rodar no Supabase SQL Editor do banco master.
-- ============================================================

-- 1. Drop a PK antiga (customerId) — idempotente
ALTER TABLE pl_customer_machine
  DROP CONSTRAINT IF EXISTS pl_customer_machine_pkey;

-- 2. Add id UUID com default — popula linhas antigas com UUIDs distintos
ALTER TABLE pl_customer_machine
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

-- 3. Set id como nova PK (guard pra re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'pl_customer_machine'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE pl_customer_machine
      ADD CONSTRAINT pl_customer_machine_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- 4. Colunas novas
ALTER TABLE pl_customer_machine
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- 5. Linhas pre-existentes (singletons) viram default — so na 1a passagem
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pl_customer_machine WHERE "isDefault") THEN
    UPDATE pl_customer_machine SET "isDefault" = true;
  END IF;
END $$;

-- 6. Indices
CREATE INDEX IF NOT EXISTS idx_customer_machine_customer
  ON pl_customer_machine("customerId");

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_machine_default
  ON pl_customer_machine("customerId") WHERE "isDefault";
