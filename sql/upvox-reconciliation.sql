-- ─────────────────────────────────────────────────────────────────────
-- upvox-api reconciliação pendente.
--
-- A upvox-api cobra voxes de forma atômica no POST /v1/tool/:toolKey/invoke,
-- mas não expõe endpoint público de refund. Quando o handler local da feature
-- (prévia, vetorize, editor-ai, …) falha APÓS a cobrança, registramos a
-- invocation aqui para um admin reembolsar manualmente via POST /v1/voxes/adjust.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS upvox_reconciliation_pending (
    id BIGSERIAL PRIMARY KEY,
    invocation_id UUID NOT NULL,
    customer_id TEXT NOT NULL,
    tool_key TEXT NOT NULL,
    course_slug TEXT NOT NULL,
    voxes_spent INT NOT NULL CHECK (voxes_spent > 0),
    reason TEXT NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upvox_reconciliation_pending_open_idx
    ON upvox_reconciliation_pending (created_at DESC)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS upvox_reconciliation_pending_customer_idx
    ON upvox_reconciliation_pending (customer_id);
