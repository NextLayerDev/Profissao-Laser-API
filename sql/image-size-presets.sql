-- Resoluções padrão que o admin cadastra pra usar como tamanho de saída da
-- IA (`ai.generate_image`) nos itens do Banco (ex.: "Prompts Mágicos").
-- Globais (não por tool) — um preset serve qualquer tool que use o banco.
-- Idempotente — pode reaplicar.

create table if not exists public.pl_image_size_preset (
	id uuid primary key default gen_random_uuid(),
	name text not null unique,
	width int not null check (width between 64 and 4096),
	height int not null check (height between 64 and 4096),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);
