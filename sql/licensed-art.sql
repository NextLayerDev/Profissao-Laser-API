-- Arte licenciada — o direito de uso nasce da GERAÇÃO, não de uma compra.
--
-- Ninguém compra "ser licenciado". A pessoa gera uma arte com a marca de um
-- time numa ferramenta da plataforma, paga a geração em voxxys, e recebe o
-- direito de usar AQUELA peça — atestado por um código e um QR que vão
-- gravados junto com a arte.
--
-- Idempotente: pode reaplicar.

create table if not exists public.pl_licensed_art (
	id uuid primary key default gen_random_uuid(),

	-- Quem gerou. Sem FK de propósito: `customer_id` vem do Supabase de auth,
	-- que é outro banco — a mesma decisão do resto do repo.
	customer_id uuid not null,

	-- A marca licenciada, no formato `clube:corinthians`. É a string que o
	-- staff amarra ao prompt e a única coisa aqui que NÃO pode ser renomeada
	-- depois de emitida: renomear quebra todo QR já gravado em peça física.
	feature_key text not null,
	-- Nome de gente para a tela pública. "clube:corinthians" não se mostra a
	-- quem escaneia um chaveiro.
	licensor_name text,

	-- O código em claro, exibido e gravado na peça.
	code text not null,
	-- sha256 do código normalizado. TODA busca bate aqui, nunca no claro.
	code_hash text not null,

	tool_key text not null,
	-- `tool_invocations.id` da rodada cobrada. É a CHAVE DE IDEMPOTÊNCIA:
	-- reenvio devolve o código de antes em vez de emitir um segundo.
	invocation_id text,

	-- A arte, para a página pública mostrar o que foi autenticado.
	preview_url text,
	prompt_title text,

	revoked_at timestamptz,
	revoke_reason text,

	created_at timestamptz not null default now()
);

-- Busca do QR público.
create unique index if not exists pl_licensed_art_code_hash_uniq
	on public.pl_licensed_art(code_hash);

-- Idempotência da emissão. Parcial porque `invocation_id` é nulo numa emissão
-- manual (concessão de staff), e nulos não devem colidir entre si.
create unique index if not exists pl_licensed_art_invocation_uniq
	on public.pl_licensed_art(invocation_id)
	where invocation_id is not null;

create index if not exists pl_licensed_art_customer_idx
	on public.pl_licensed_art(customer_id, created_at desc);

create index if not exists pl_licensed_art_feature_idx
	on public.pl_licensed_art(feature_key);
