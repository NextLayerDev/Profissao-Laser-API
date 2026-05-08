-- ============================================================
-- PREVIA TABLES - Banco Master (Profissao Laser API)
-- Historico de previas de gravacao a laser geradas via IA (Nano Banana 2)
-- Rodar no Supabase SQL Editor do banco principal
-- ============================================================

CREATE TABLE pl_previa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productColor" TEXT,
    "imagebaseUrl" TEXT NOT NULL,
    "imageproductUrl" TEXT NOT NULL,
    "imagelogoUrl" TEXT,
    "previewUrl" TEXT NOT NULL,
    "personalizationType" TEXT NOT NULL CHECK ("personalizationType" IN ('logo','text','both')),
    "customName" TEXT,
    "instrucoesPersonalizadas" TEXT,
    "textoLenteDireita" TEXT,
    "textoLenteEsquerda" TEXT,
    "modoLentes" BOOLEAN NOT NULL DEFAULT false,
    "laserSettings" JSONB NOT NULL,
    notes TEXT,
    prompt TEXT,
    "aiModel" TEXT NOT NULL DEFAULT 'google/gemini-3-pro-image-preview',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_previa_customer ON pl_previa("customerId");
CREATE INDEX idx_previa_created_at ON pl_previa("createdAt" DESC);
