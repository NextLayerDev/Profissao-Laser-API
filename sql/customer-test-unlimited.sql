-- Conta de teste ilimitada: flag em Customers.
-- Aplicado no Demo_DB via Supabase MCP (migration: customer_test_unlimited).
-- Mirror para a convenção do repo.

ALTER TABLE "Customers"
  ADD COLUMN IF NOT EXISTS "isTestUnlimited" boolean NOT NULL DEFAULT false;

-- Marca a conta de teste (idempotente).
UPDATE "Customers" SET "isTestUnlimited" = true WHERE email = 'usuario@gmail.com';
