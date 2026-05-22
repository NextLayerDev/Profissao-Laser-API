-- Tabela de eventos da comunidade (live, workshop, qa).
-- Inclui os campos novos para sala de espera + embed YouTube/Vimeo.
CREATE TABLE IF NOT EXISTS public.pl_community_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  time TEXT,
  type TEXT NOT NULL CHECK (type IN ('workshop', 'live', 'qa')),
  -- Sala de espera + stream
  "streamUrl" TEXT,
  "streamProvider" TEXT CHECK ("streamProvider" IS NULL OR "streamProvider" IN ('youtube', 'vimeo')),
  "waitingRoomOpensMinutesBefore" INTEGER NOT NULL DEFAULT 15,
  "hostId" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_community_event_date ON public.pl_community_event (date);

-- Presença na sala de espera. Linhas com leftAt NULL = customer ativo no momento.
-- Realtime no front escuta inserts/updates/deletes filtrados por eventId.
CREATE TABLE IF NOT EXISTS public.pl_event_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL REFERENCES public.pl_community_event(id) ON DELETE CASCADE,
  "customerId" UUID NOT NULL,
  "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "leftAt" TIMESTAMPTZ
);

-- Garante 1 presença ativa por (event, customer). Se o customer sair, gera nova linha.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pl_event_attendance_active_unique
  ON public.pl_event_attendance ("eventId", "customerId")
  WHERE "leftAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_pl_event_attendance_event
  ON public.pl_event_attendance ("eventId", "joinedAt" DESC);
