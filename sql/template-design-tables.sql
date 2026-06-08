-- ============================================================
-- TEMPLATE + DESIGN TABLES - Banco Master (Profissao Laser API)
-- Catalogo de templates curados (admin) + designs do customer (canvas Fabric.js)
-- Rodar no Supabase SQL Editor do banco principal
-- ============================================================

-- 1. Templates: catalogo curado (gerenciado pelo staff)
CREATE TABLE pl_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    "categoryId" TEXT NOT NULL,                 -- ex: 'caneca', 'chaveiro', 'abridor', 'tabua'
    "tipoImagem" TEXT NOT NULL DEFAULT 'base'   -- 'base' (referencia de composicao), 'exemplo' (referencia visual), 'referencia' (logo de exemplo)
        CHECK ("tipoImagem" IN ('base','exemplo','referencia')),
    "imageUrl" TEXT NOT NULL,                   -- thumbnail/imagem base no Bunny CDN
    "canvasJson" JSONB,                         -- estado inicial do Fabric.js (opcional)
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    width INTEGER NOT NULL DEFAULT 1024,
    height INTEGER NOT NULL DEFAULT 1024,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
    "createdBy" TEXT,                           -- id do staff que criou
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_template_category ON pl_template("categoryId");
CREATE INDEX idx_template_tipo ON pl_template("tipoImagem");
CREATE INDEX idx_template_status ON pl_template(status);
CREATE INDEX idx_template_tags ON pl_template USING GIN (tags);
CREATE INDEX idx_template_created_at ON pl_template("createdAt" DESC);

-- 2. Designs: projetos do cliente (Fabric.js canvas state)
CREATE TABLE pl_design (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" TEXT NOT NULL,
    name TEXT NOT NULL,
    "templateId" UUID REFERENCES pl_template(id) ON DELETE SET NULL,
    "canvasJson" JSONB NOT NULL,                -- estado completo Fabric.js
    "thumbnailUrl" TEXT,                        -- preview PNG (export do canvas)
    width INTEGER NOT NULL DEFAULT 1024,
    height INTEGER NOT NULL DEFAULT 1024,
    notes TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_design_customer ON pl_design("customerId");
CREATE INDEX idx_design_template ON pl_design("templateId");
CREATE INDEX idx_design_created_at ON pl_design("createdAt" DESC);
