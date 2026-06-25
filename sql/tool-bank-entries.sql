-- Fábrica de Tools — "Banco do Admin" genérico. Uma tool (qualquer uma) pode
-- declarar um banco (via a seção `bank` da ToolDefinition); o admin alimenta
-- registros aqui e o cliente os consome como galeria. `data jsonb` guarda os
-- campos livres do registro conforme o schema `bank.fields` da tool (ex.:
-- { prompt_script, mode }). Idempotente — pode reaplicar.

create table if not exists public.pl_tool_bank_entry (
	id uuid primary key default gen_random_uuid(),
	tool_key text not null,
	title text not null,
	description text,
	category text,
	position int not null default 0,
	active boolean not null default true,
	data jsonb not null default '{}'::jsonb,
	example_before_url text,
	example_after_url text,
	created_by uuid,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists pl_tool_bank_entry_tool_idx
	on public.pl_tool_bank_entry(tool_key);
create index if not exists pl_tool_bank_entry_active_idx
	on public.pl_tool_bank_entry(tool_key, active);
create index if not exists pl_tool_bank_entry_pos_idx
	on public.pl_tool_bank_entry(tool_key, position);
