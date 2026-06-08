-- ============================================================
-- Biblioteca de Vetores: extensoes (favoritos, contadores, categorias)
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

-- ── Campos novos em pl_vector_library_file ──────────────────────────────────

ALTER TABLE pl_vector_library_file
    ADD COLUMN IF NOT EXISTS formats TEXT[],
    ADD COLUMN IF NOT EXISTS "downloadCount" INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_vlf_category ON pl_vector_library_file(category);
CREATE INDEX IF NOT EXISTS idx_vlf_featured ON pl_vector_library_file(featured);

-- ── Favoritos ───────────────────────────────────────────────────────────────

CREATE TABLE pl_vector_library_favorite (
    "fileId" UUID NOT NULL REFERENCES pl_vector_library_file(id) ON DELETE CASCADE,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("fileId", "customerId")
);

CREATE INDEX idx_vlf_favorite_customer ON pl_vector_library_favorite("customerId");
