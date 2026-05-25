-- Granular RBAC: per-role grants + super-admin flag + label; per-user overrides.
-- Applied to Demo_DB via Supabase MCP (migration: granular_rbac). Mirror for repo convention.

ALTER TABLE "Permissions"
  ADD COLUMN IF NOT EXISTS "grants" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "isSuperAdmin" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "label" text;

ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "overrides" jsonb NOT NULL DEFAULT '{"granted":[],"revoked":[]}'::jsonb;

-- Seed the 4 existing roles (fixed ids; idempotent).
UPDATE "Permissions" SET "isSuperAdmin" = true,  "label" = 'Super Admin',   "grants" = '[]'::jsonb WHERE id = 1;
UPDATE "Permissions" SET "isSuperAdmin" = true,  "label" = 'Administrador', "grants" = '[]'::jsonb WHERE id = 4;
UPDATE "Permissions" SET "isSuperAdmin" = false, "label" = 'Financeiro',    "grants" = '["home.view","produtos.view","produtos.price","vendas.view","relatorios.view"]'::jsonb WHERE id = 2;
UPDATE "Permissions" SET "isSuperAdmin" = false, "label" = 'Colaborador',   "grants" = '["home.view"]'::jsonb WHERE id = 3;
