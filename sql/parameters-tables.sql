-- ============================================================
-- Tabela de Parametros Laser + interacoes da comunidade
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

CREATE TABLE pl_parameter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material TEXT NOT NULL,                      -- Produto/Material
    "materialType" TEXT,                         -- legado (opcional)
    thickness TEXT,                              -- legado (opcional)
    power INT NOT NULL,                          -- Potencia (%)
    speed INT NOT NULL,                          -- Velocidade (mm/s)
    frequency INT NOT NULL,                      -- Frequencia (Hz)
    passes INT NOT NULL DEFAULT 1,               -- Passadas (Contorno)
    mode TEXT NOT NULL,                          -- Tipo do Trabalho
    gas BOOLEAN NOT NULL DEFAULT false,          -- usa gas/ar comprimido
    machine TEXT,                                -- Maquina
    notes TEXT,                                  -- Notas
    -- Campos do formulario "Novo parametro"
    "powerWatts" INT,                            -- Potencia (W)
    lens TEXT,                                   -- Lente (mm)
    software TEXT,                               -- Software
    line NUMERIC,                                -- Linha (mm)
    "crossHatch" INT,                            -- Preenchimento Cruzado (%)
    angle INT,                                   -- Angulo (graus)
    "passesFill" INT,                            -- Passadas (Preenchimento)
    defocus INT,                                 -- Desfoque (mm, 0-20)
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
