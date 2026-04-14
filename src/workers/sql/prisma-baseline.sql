-- ============================================================
-- Registra baseline do Prisma para que o build da Vercel
-- (prisma migrate deploy) nao falhe ao encontrar tabelas
-- ja criadas pelo bootstrap.sql sem _prisma_migrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36)  NOT NULL PRIMARY KEY,
    "checksum"              VARCHAR(64)  NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER      NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
SELECT
    gen_random_uuid()::text,
    'e03059de9e64036d898b65b13ba76a106956b5696713e56d6a99697f1f960337',
    '0_init',
    now(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '0_init'
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
SELECT
    gen_random_uuid()::text,
    'baseline',
    '20260331_add_tabelas_fiscais',
    now(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20260331_add_tabelas_fiscais'
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
SELECT
    gen_random_uuid()::text,
    'baseline',
    '20260401_add_categorias_icones',
    now(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20260401_add_categorias_icones'
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
SELECT
    gen_random_uuid()::text,
    'baseline',
    '20260401_add_ecommerce_module',
    now(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20260401_add_ecommerce_module'
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
SELECT
    gen_random_uuid()::text,
    'baseline',
    '20260413_add_ecommerce_webhooks_tables',
    now(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20260413_add_ecommerce_webhooks_tables'
);
