-- ============================================================
-- Tabelas de Parametros Laser + interacoes da comunidade
-- (base + extensoes por software + tipos de linha)
--
-- Roda via Supabase MCP `apply_migration`. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pl_parameter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material TEXT NOT NULL,
    "materialType" TEXT,
    thickness TEXT,
    power INT NOT NULL,
    speed INT NOT NULL,
    frequency INT NOT NULL,
    passes INT NOT NULL DEFAULT 1,
    mode TEXT NOT NULL,
    gas BOOLEAN NOT NULL DEFAULT false,
    machine TEXT,
    notes TEXT,
    "powerWatts" INT,
    lens TEXT,
    software TEXT,
    line NUMERIC,
    "crossHatch" BOOLEAN NOT NULL DEFAULT false,
    angle INT,
    "passesFill" INT,
    defocus INT,
    -- Campos software-specific
    "tamanhoLinha" NUMERIC,       -- Lightburn
    "tamanhoDivisao" NUMERIC,     -- Ezcad
    sobreposicao NUMERIC,         -- Ezcad
    "forcarSeparacao" BOOLEAN,    -- Lightburn
    "axisRotative" BOOLEAN,       -- todos
    "lineTypeId" UUID,            -- FK opcional
    -- Meta
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_parameter_material ON public.pl_parameter(material);
CREATE INDEX IF NOT EXISTS idx_pl_parameter_machine ON public.pl_parameter(machine);
CREATE INDEX IF NOT EXISTS idx_pl_parameter_is_public ON public.pl_parameter("isPublic");
CREATE INDEX IF NOT EXISTS idx_pl_parameter_created_by ON public.pl_parameter("createdBy");

CREATE TABLE IF NOT EXISTS public.pl_parameter_machine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pl_parameter_material (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    "commonThicknesses" TEXT[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pl_parameter_save (
    "parameterId" UUID NOT NULL REFERENCES public.pl_parameter(id) ON DELETE CASCADE,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("parameterId", "customerId")
);

CREATE TABLE IF NOT EXISTS public.pl_parameter_like (
    "parameterId" UUID NOT NULL REFERENCES public.pl_parameter(id) ON DELETE CASCADE,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("parameterId", "customerId")
);

CREATE TABLE IF NOT EXISTS public.pl_parameter_rating (
    "parameterId" UUID NOT NULL REFERENCES public.pl_parameter(id) ON DELETE CASCADE,
    "customerId" TEXT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("parameterId", "customerId")
);

-- Catalogo de Tipos de Linha por software (admin faz upload das imagens)
CREATE TABLE IF NOT EXISTS public.pl_laser_line_type (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    software TEXT NOT NULL CHECK (software IN ('Ezcad', 'Lightburn', 'LaserGRBL')),
    name TEXT NOT NULL,
    "imageUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_laser_line_type_software_order
    ON public.pl_laser_line_type (software, "order");

ALTER TABLE public.pl_parameter
    DROP CONSTRAINT IF EXISTS fk_pl_parameter_line_type;
ALTER TABLE public.pl_parameter
    ADD CONSTRAINT fk_pl_parameter_line_type
    FOREIGN KEY ("lineTypeId") REFERENCES public.pl_laser_line_type(id) ON DELETE SET NULL;
