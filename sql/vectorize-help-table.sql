-- ============================================================
-- VECTORIZE HELP - Banco Master (Profissao Laser API)
-- Itens de ajuda (cards: tutoriais, videos, dicas) exibidos na
-- pagina de vetorizacao. Admin gerencia, aluno consome os ativos.
-- Rodar no Supabase SQL Editor do banco principal.
-- ============================================================

CREATE TABLE pl_vectorize_help (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description VARCHAR(500) NOT NULL,
    icon VARCHAR(50) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text','video')),
    content TEXT,
    video_url TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vectorize_help_order ON pl_vectorize_help("order");
CREATE INDEX idx_vectorize_help_active ON pl_vectorize_help(active);
