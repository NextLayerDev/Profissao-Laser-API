-- ============================================================
-- MACHINE CATALOG + PRODUCT PARAMETERS - Banco Master (Profissao Laser API)
-- Catalogo dinamico de maquinas a laser (Fiber/UV/CO2/Diodo) + opcoes,
-- associacao produto<->maquina<->parametro (+ video) e maquina salva
-- do cliente. Rodar no Supabase SQL Editor do banco principal.
-- ============================================================

-- 1. Tipo de maquina
CREATE TABLE pl_machine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_machine_status ON pl_machine(status);
CREATE INDEX idx_machine_order ON pl_machine("order");

-- 2. Opcao generica de maquina (potencia / lente / software / eixo / operacao)
CREATE TABLE pl_machine_option (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "machineId" UUID NOT NULL REFERENCES pl_machine(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('power','lens','software','axis','operation')),
    value TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_machine_option_machine ON pl_machine_option("machineId", category);
CREATE INDEX idx_machine_option_status ON pl_machine_option(status);

-- 3. Associacao produto <-> maquina <-> parametro (+ config opcional + video)
CREATE TABLE pl_product_parameter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL REFERENCES pl_laser_product(id) ON DELETE CASCADE,
    "machineId" UUID NOT NULL REFERENCES pl_machine(id) ON DELETE CASCADE,
    "parameterId" UUID NOT NULL REFERENCES pl_parameter(id) ON DELETE CASCADE,
    "powerOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "lensOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "softwareOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "axisOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "operationOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    -- variacao opcional do produto: NULL = associacao product-level (vale
    -- pra qualquer variacao); preenchido = associacao variant-level
    "variantId" UUID REFERENCES pl_laser_product_variant(id) ON DELETE CASCADE,
    -- pl_lesson.id é TEXT (não UUID) — FK precisa ser TEXT pra casar
    "lessonId" TEXT REFERENCES pl_lesson(id) ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_parameter_lookup ON pl_product_parameter("productId", "machineId");
CREATE INDEX idx_product_parameter_parameter ON pl_product_parameter("parameterId");
CREATE INDEX idx_product_parameter_variant ON pl_product_parameter("variantId");

-- 4. Maquinas salvas do cliente (multi-row, 1 padrao por customer)
CREATE TABLE pl_customer_machine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "customerId" TEXT NOT NULL,
    name TEXT,                                     -- rotulo do customer (opcional)
    "machineId" UUID NOT NULL REFERENCES pl_machine(id) ON DELETE CASCADE,
    "powerOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "lensOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "softwareOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "axisOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "operationOptionId" UUID REFERENCES pl_machine_option(id) ON DELETE SET NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_machine_customer ON pl_customer_machine("customerId");
CREATE UNIQUE INDEX idx_customer_machine_default
    ON pl_customer_machine("customerId") WHERE "isDefault";

-- ============================================================
-- SEED — 4 maquinas + opcoes (select pronto "quando a comunidade subir")
-- ============================================================

INSERT INTO pl_machine (name, description, "order") VALUES
    ('Fiber', 'Máquina Fiber de gravação', 0),
    ('UV',    'Máquina de gravação UV',    1),
    ('CO2',   'Máquina CO2',               2),
    ('Diodo', 'Máquina Diodo',             3);

-- Fiber: power / lens / software / axis
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'power', v.value, v.ord FROM pl_machine, (VALUES
    ('20w',0),('30w',1),('50w',2)) AS v(value,ord) WHERE name = 'Fiber';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'lens', v.value, v.ord FROM pl_machine, (VALUES
    ('110x110',0),('175x175',1),('200x200',2),('300x300',3)) AS v(value,ord) WHERE name = 'Fiber';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'software', v.value, v.ord FROM pl_machine, (VALUES
    ('Lightburn',0),('Ezcad',1)) AS v(value,ord) WHERE name = 'Fiber';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'axis', v.value, v.ord FROM pl_machine, (VALUES
    ('Com eixo',0),('Sem eixo',1)) AS v(value,ord) WHERE name = 'Fiber';

-- UV: power / lens / software / axis
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'power', v.value, v.ord FROM pl_machine, (VALUES
    ('3w',0),('5w',1)) AS v(value,ord) WHERE name = 'UV';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'lens', v.value, v.ord FROM pl_machine, (VALUES
    ('110x110',0),('200x200',1),('300x300',2)) AS v(value,ord) WHERE name = 'UV';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'software', v.value, v.ord FROM pl_machine, (VALUES
    ('Lightburn',0),('Ezcad',1)) AS v(value,ord) WHERE name = 'UV';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'axis', v.value, v.ord FROM pl_machine, (VALUES
    ('Com eixo',0),('Sem eixo',1)) AS v(value,ord) WHERE name = 'UV';

-- CO2: power / operation / axis
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'power', v.value, v.ord FROM pl_machine, (VALUES
    ('50w',0),('80w',1),('100w',2),('130w',3),('150w',4)) AS v(value,ord) WHERE name = 'CO2';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'operation', v.value, v.ord FROM pl_machine, (VALUES
    ('Corte',0),('Gravação',1)) AS v(value,ord) WHERE name = 'CO2';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'axis', v.value, v.ord FROM pl_machine, (VALUES
    ('Com eixo',0),('Sem eixo',1)) AS v(value,ord) WHERE name = 'CO2';

-- Diodo: power / operation
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'power', v.value, v.ord FROM pl_machine, (VALUES
    ('10w',0)) AS v(value,ord) WHERE name = 'Diodo';
INSERT INTO pl_machine_option ("machineId", category, value, "order")
SELECT id, 'operation', v.value, v.ord FROM pl_machine, (VALUES
    ('Corte',0),('Gravação',1)) AS v(value,ord) WHERE name = 'Diodo';
