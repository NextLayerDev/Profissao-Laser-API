-- ============================================================
-- Mentoria (tool de sala, room_v1) — sessões + presença.
-- A Mentoria é um TEMPLATE (tool publicada no upvox); cada SESSÃO é uma
-- instância dada (data/hora + link externo Zoom/Meet + cap). O acesso é
-- gateado por plano OU voxes (decidido na main API). Reusa o padrão de
-- presença dos Eventos (pl_event_attendance). Rodar no tenant. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pl_mentorship_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "toolKey" TEXT NOT NULL,                 -- tool 'mentoria' publicada que originou
  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  time TEXT,
  "durationMin" INTEGER NOT NULL DEFAULT 60,
  "joinOpensMinutesBefore" INTEGER NOT NULL DEFAULT 10,
  "externalUrl" TEXT NOT NULL,             -- link da sala (revelado só a quem pode)
  cap INTEGER,                             -- NULL = sem limite
  "recordingUrl" TEXT,                     -- replay (preenchido depois)
  "hostId" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_mentorship_session_tool
  ON public.pl_mentorship_session ("toolKey", date);

CREATE TABLE IF NOT EXISTS public.pl_mentorship_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL REFERENCES public.pl_mentorship_session(id) ON DELETE CASCADE,
  "customerId" UUID NOT NULL,
  "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "leftAt" TIMESTAMPTZ,
  -- invocação do upvox que PAGOU a entrada nesta sessão (idempotência da
  -- cobrança: reentrar na mesma sessão não recobra). NULL = entrou grátis.
  "paidInvocationId" UUID
);

-- 1 presença ATIVA por (sessão, customer) — evita inserts duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pl_mentorship_attendance_active_unique
  ON public.pl_mentorship_attendance ("sessionId", "customerId")
  WHERE "leftAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_pl_mentorship_attendance_session
  ON public.pl_mentorship_attendance ("sessionId");
