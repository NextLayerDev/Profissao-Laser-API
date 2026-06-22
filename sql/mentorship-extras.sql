-- M4 da Mentoria (room_v1): materiais/anexos + chat por sessão.
-- Aditivo e idempotente. Aplicar no Demo_DB (lkfifggdfyzvlzavhobl).

-- Materiais/anexos de uma sessão (URL externa colada pelo admin).
create table if not exists public.pl_mentorship_material (
	id uuid primary key default gen_random_uuid(),
	"sessionId" uuid not null
		references public.pl_mentorship_session(id) on delete cascade,
	title text not null,
	url text not null,
	"createdAt" timestamptz not null default now()
);
create index if not exists idx_pl_mentorship_material_session
	on public.pl_mentorship_material("sessionId");

-- Chat ao vivo de uma sessão.
create table if not exists public.pl_mentorship_message (
	id uuid primary key default gen_random_uuid(),
	"sessionId" uuid not null
		references public.pl_mentorship_session(id) on delete cascade,
	"customerId" uuid not null,
	content text not null,
	"createdAt" timestamptz not null default now()
);
create index if not exists idx_pl_mentorship_message_session
	on public.pl_mentorship_message("sessionId", "createdAt");
