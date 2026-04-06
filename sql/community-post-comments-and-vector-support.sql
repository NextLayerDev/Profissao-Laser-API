-- ============================================================
-- Comentários em Posts da Comunidade + Suporte de Vetores
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

-- ── Comentários em Posts da Comunidade ───────────────────────────────────────

CREATE TABLE pl_community_post_comment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "postId" UUID NOT NULL REFERENCES pl_community_post(id) ON DELETE CASCADE,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorAvatar" TEXT,
    content TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_comment_post_id ON pl_community_post_comment("postId");

-- ── Suporte de Vetores ────────────────────────────────────────────────────────

CREATE TABLE pl_vector_support_ticket (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    subject TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vector_ticket_customer ON pl_vector_support_ticket("customerId");
CREATE INDEX idx_vector_ticket_status ON pl_vector_support_ticket(status);

CREATE TABLE pl_vector_support_message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ticketId" UUID NOT NULL REFERENCES pl_vector_support_ticket(id) ON DELETE CASCADE,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "isTechnician" BOOLEAN NOT NULL DEFAULT false,
    content TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vector_message_ticket ON pl_vector_support_message("ticketId");

CREATE TABLE pl_vector_support_file (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL REFERENCES pl_vector_support_message(id) ON DELETE CASCADE,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vector_file_message ON pl_vector_support_file("messageId");
