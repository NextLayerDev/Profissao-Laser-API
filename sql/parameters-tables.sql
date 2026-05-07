-- ============================================================
-- Tabela de Parametros Laser + interacoes da comunidade
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

CREATE TABLE pl_parameter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    thickness TEXT NOT NULL,
    power INT NOT NULL,
    speed INT NOT NULL,
    frequency INT NOT NULL,
    passes INT NOT NULL DEFAULT 1,
    mode TEXT NOT NULL,
    gas TEXT,
    machine TEXT,
    notes TEXT,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_parameter_material ON pl_parameter(material);
CREATE INDEX idx_parameter_machine ON pl_parameter(machine);
CREATE INDEX idx_parameter_is_public ON pl_parameter("isPublic");
CREATE INDEX idx_parameter_created_by ON pl_parameter("createdBy");

CREATE TABLE pl_parameter_machine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pl_parameter_material (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    "commonThicknesses" TEXT[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pl_parameter_save (
    "parameterId" UUID NOT NULL REFERENCES pl_parameter(id) ON DELETE CASCADE,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("parameterId", "customerId")
);

CREATE TABLE pl_parameter_like (
    "parameterId" UUID NOT NULL REFERENCES pl_parameter(id) ON DELETE CASCADE,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("parameterId", "customerId")
);

CREATE TABLE pl_parameter_rating (
    "parameterId" UUID NOT NULL REFERENCES pl_parameter(id) ON DELETE CASCADE,
    "customerId" TEXT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("parameterId", "customerId")
);
