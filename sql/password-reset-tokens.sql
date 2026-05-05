-- ============================================================
-- Tokens de recuperação de senha (POST /reset-password)
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

CREATE TABLE IF NOT EXISTS pl_password_reset_tokens (
    token      UUID        PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES "Customers"(id) ON DELETE CASCADE,
    email      TEXT        NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
    ON pl_password_reset_tokens(user_id);
