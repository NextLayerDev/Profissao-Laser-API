-- Config global de agendamentos (singleton — 1 linha).
CREATE TABLE IF NOT EXISTS public.pl_appointment_settings_global (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workingDays" JSONB NOT NULL DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":false,"sun":false}'::jsonb,
  "workingHourStart" TEXT NOT NULL DEFAULT '08:00',
  "workingHourEnd" TEXT NOT NULL DEFAULT '18:00',
  "lunchStart" TEXT,
  "lunchEnd" TEXT,
  "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedBy" UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pl_appointment_settings_global_singleton
  ON public.pl_appointment_settings_global ((TRUE));

-- Feriados: bloqueiam o dia inteiro pra todos os técnicos.
CREATE TABLE IF NOT EXISTS public.pl_appointment_holiday (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  label TEXT NOT NULL,
  "recurringYearly" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_appointment_holiday_date
  ON public.pl_appointment_holiday (date);

-- Folgas: por técnico (technicianId não nulo) ou globais (technicianId NULL).
CREATE TABLE IF NOT EXISTS public.pl_appointment_day_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "technicianId" UUID,
  date DATE NOT NULL,
  reason TEXT,
  "createdBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_appointment_day_off_technician_date
  ON public.pl_appointment_day_off ("technicianId", date);

-- Override de horário por técnico.
CREATE TABLE IF NOT EXISTS public.pl_appointment_technician_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "technicianId" UUID NOT NULL UNIQUE,
  "workingDays" JSONB,
  "workingHourStart" TEXT,
  "workingHourEnd" TEXT,
  "lunchStart" TEXT,
  "lunchEnd" TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.pl_appointment_settings_global ("id")
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.pl_appointment_settings_global);
