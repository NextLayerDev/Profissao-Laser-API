-- ============================================================
-- LASER PRODUCT CATALOG - Banco Master (Profissao Laser API)
-- Catalogo de produtos engravaveis (admin) + variants (cor/tipo).
-- Substitui o customer ter que mandar imagebase_url/imageproduct_url
-- no POST /previas/generate — agora ele só seleciona um variant.
-- Rodar no Supabase SQL Editor do banco principal.
-- ============================================================

-- 1. Produto base (caneca, tabua, abridor, caneta, etc.)
CREATE TABLE pl_laser_product (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,                       -- 'caneca', 'tabua', 'abridor', 'caneta', etc.
    "defaultMaterial" TEXT,                       -- hint pro prompt: 'aco-inox', 'madeira', etc.
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_laser_product_category ON pl_laser_product(category);
CREATE INDEX idx_laser_product_status ON pl_laser_product(status);
CREATE INDEX idx_laser_product_tags ON pl_laser_product USING GIN (tags);

-- 2. Variants de cada produto (diferentes cores/tipos com fotos próprias)
CREATE TABLE pl_laser_product_variant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL REFERENCES pl_laser_product(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                           -- ex: 'Prata Escovado', 'Tampa Branca'
    "colorName" TEXT,                             -- ex: 'Prata', 'Preto Fosco'
    "colorHex" TEXT,                              -- ex: '#C0C0C0' (opcional)
    "tipo" TEXT,                                  -- ex: 'pequeno', 'grande' (alternativa a cor)
    "imageUrl" TEXT NOT NULL,                     -- foto do produto nessa variant (Bunny CDN)
    "order" INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Pelo menos colorName OU tipo deve estar preenchido
    CONSTRAINT variant_has_color_or_tipo CHECK ("colorName" IS NOT NULL OR "tipo" IS NOT NULL)
);

CREATE INDEX idx_laser_variant_product ON pl_laser_product_variant("productId");
CREATE INDEX idx_laser_variant_status ON pl_laser_product_variant(status);
CREATE INDEX idx_laser_variant_order ON pl_laser_product_variant("productId", "order");
