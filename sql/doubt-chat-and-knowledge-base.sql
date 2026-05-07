-- ============================================================
-- Suporte Online: ticketNumber + Knowledge Base
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

-- ── ticketNumber sequencial em chamados de duvida ────────────────────────────

ALTER TABLE pl_doubt_chat
    ADD COLUMN IF NOT EXISTS "ticketNumber" SERIAL;

CREATE INDEX IF NOT EXISTS idx_doubt_chat_ticket_number
    ON pl_doubt_chat("ticketNumber");

-- ── Knowledge Base ───────────────────────────────────────────────────────────

CREATE TABLE pl_knowledge_base_article (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    type TEXT NOT NULL,                 -- 'article' | 'video'
    content TEXT,
    excerpt TEXT,
    "videoUrl" TEXT,
    "readTime" INT,
    icon TEXT,
    category TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "order" INT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kb_article_category ON pl_knowledge_base_article(category);
CREATE INDEX idx_kb_article_published ON pl_knowledge_base_article("isPublished");
