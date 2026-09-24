-- Marcas licenciadas — o escudo pertence à MARCA, não ao prompt.
--
-- Antes o brasão era um campo de imagem em cada registro do Banco do Admin.
-- Com isso, um clube com caneca, capinha e chaveiro exigia três uploads do
-- mesmo escudo — e trocar a arte oficial obrigava a lembrar de todos.
--
-- Aqui a marca é cadastrada uma vez e os prompts apenas apontam para ela pela
-- `feature_key`. Um upload serve todos; trocar a arte atualiza tudo.
--
-- Idempotente: pode reaplicar.

create table if not exists public.pl_licensed_brand (
	id uuid primary key default gen_random_uuid(),

	-- A chave que o prompt referencia e que vai na licença da peça.
	-- É a única coisa aqui que NÃO pode ser renomeada depois de emitida:
	-- renomear quebra todo QR já gravado em peça física.
	feature_key text not null,

	-- Nome de gente para a tela pública. "clube:corinthians" não se mostra a
	-- quem escaneia um chaveiro.
	display_name text not null,

	-- Arte oficial, entregue pelo licenciante.
	crest_url text,
	mascot_url text,

	-- Contrato encerrado → para de gerar, sem apagar histórico. Os QR já
	-- gravados continuam resolvendo, que é o que precisa acontecer.
	active boolean not null default true,

	notes text,
	created_by uuid,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- Uma marca por chave. É o que garante que o prompt resolva sem ambiguidade.
create unique index if not exists pl_licensed_brand_key_uniq
	on public.pl_licensed_brand(feature_key);

create index if not exists pl_licensed_brand_active_idx
	on public.pl_licensed_brand(active);

-- Mesma gramática do resto da casa.
do $$
begin
	if not exists (
		select 1 from pg_constraint where conname = 'pl_licensed_brand_key_grammar'
	) then
		alter table public.pl_licensed_brand
			add constraint pl_licensed_brand_key_grammar
			check (feature_key ~ '^[a-z0-9]+:[a-z0-9-]+$');
	end if;
end $$;
