-- ============================================================
-- Intervalo mínimo entre atendimentos do MESMO cliente ("cooldown").
--
-- Opcional: com "clientCooldownEnabled" = FALSE nada muda no comportamento
-- atual. Ligado, quem tem atendimento na segunda só consegue marcar outro
-- depois de "clientCooldownHours" horas (24/48/72...).
--
-- A distância é medida entre os DATETIMES dos atendimentos (date + time), não
-- entre os momentos em que foram criados. Horários no MESMO dia são isentos —
-- são a mesma visita.
--
-- Idempotente. Rodar no SQL Editor do Supabase.
-- ============================================================

ALTER TABLE public.pl_appointment_settings_global
    ADD COLUMN IF NOT EXISTS "clientCooldownEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "clientCooldownHours" INTEGER NOT NULL DEFAULT 48,
    ADD COLUMN IF NOT EXISTS "clientCooldownMatchPhone" BOOLEAN NOT NULL DEFAULT TRUE;

-- Guarda-corpo: horas fora de (0, 720] é erro de digitação, não configuração.
ALTER TABLE public.pl_appointment_settings_global
    DROP CONSTRAINT IF EXISTS pl_appointment_settings_global_cooldown_hours_check;
ALTER TABLE public.pl_appointment_settings_global
    ADD CONSTRAINT pl_appointment_settings_global_cooldown_hours_check
    CHECK ("clientCooldownHours" > 0 AND "clientCooldownHours" <= 720);

-- A checagem varre uma janela curta de datas (± ceil(horas/24) dias) e filtra o
-- cliente em memória: e-mail é case-insensitive e telefone precisa de
-- normalização de dígitos — nada disso usaria índice. O índice que importa é o
-- de data, que também serve o `listByDate(date, technicianId)` já existente
-- (hoje sem índice nenhum).
CREATE INDEX IF NOT EXISTS idx_pl_appointment_date_technician
    ON public.pl_appointment (date, "technicianId");

-- Serve o `listByEmail` (tela "meus agendamentos"), hoje um seq scan.
CREATE INDEX IF NOT EXISTS idx_pl_appointment_customer_email
    ON public.pl_appointment ("customerEmail", date);
