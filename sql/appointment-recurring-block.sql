-- Bloqueios recorrentes (TODA semana) na agenda. Fecham um dia da semana o dia
-- inteiro ("startTime"/"endTime" nulos) ou só uma faixa de horário (ex.: toda
-- sexta 16:00–17:00). Por técnico ("technicianId") ou globais (NULL = todos).
CREATE TABLE IF NOT EXISTS public.pl_appointment_recurring_block (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "technicianId" UUID,
  weekday TEXT NOT NULL CHECK (weekday IN ('mon','tue','wed','thu','fri','sat','sun')),
  "startTime" TEXT,
  "endTime" TEXT,
  reason TEXT,
  "createdBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_appointment_recurring_block_weekday
  ON public.pl_appointment_recurring_block (weekday, "technicianId");
