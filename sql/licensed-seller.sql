-- O PORTÃO DO VENDEDOR — quem usa a Arte Licenciada declara onde vende.
--
-- A volumetria já responde "quantas peças do Corinthians saíram este mês". Ela
-- não responde a pergunta seguinte, que é a que o clube faz na mesa: "e onde
-- essas peças aparecem?". Sem isso, o relatório é metade da conversa.
--
-- São duas tabelas porque são duas naturezas de dado:
--
--   `..._channel` é uma LISTA VIVA. O aluno adiciona e tira loja o tempo todo.
--   `..._term`    é um REGISTRO DE FATO. Cada aceite é uma linha nova, nunca um
--                 update — é o que se leva para o licenciante.
--
-- Sem FK para `Customers`: cliente nativo do upvox não tem linha lá, e uma FK
-- aqui quebraria justamente quem a ferramenta atende. Mesma armadilha já
-- documentada em `sql/tool-collections.sql` e respeitada em `pl_licensed_art`.
--
-- Idempotente: pode reaplicar.

-- ─────────────────────────────── os canais ───────────────────────────────

create table if not exists public.pl_licensed_seller_channel (
	id uuid primary key default gen_random_uuid(),

	customer_id uuid not null,

	-- O endereço público onde a peça vai aparecer à venda.
	url text not null,

	-- Como o aluno chama esse canal. "Shopee", "minha loja", "o perfil da
	-- oficina". Serve para ele se achar na própria lista, não para o sistema.
	label text,

	created_at timestamptz not null default now(),

	-- Tirar da lista NÃO apaga a linha: um aceite antigo aponta para canais que
	-- existiam naquele dia, e o histórico precisa continuar legível depois.
	removed_at timestamptz
);

comment on column public.pl_licensed_seller_channel.removed_at is
	'Quando o aluno tirou o canal da lista. Nulo = ativo. A linha nunca é apagada porque um aceite anterior a referencia.';

create index if not exists pl_licensed_seller_channel_ativos_idx
	on public.pl_licensed_seller_channel(customer_id, created_at)
	where removed_at is null;

-- ──────────────────────────────── o aceite ────────────────────────────────

create table if not exists public.pl_licensed_seller_term (
	id uuid primary key default gen_random_uuid(),

	customer_id uuid not null,

	-- A versão do texto que ele aceitou. Trocar o texto e subir a versão é o
	-- que obriga todo mundo a aceitar de novo.
	terms_version text not null,

	/*
	 * A LISTA EXATA que ele aceitou, congelada.
	 *
	 * É o coração da tabela. O termo diz "informei TODOS os meus canais" — uma
	 * declaração que só significa alguma coisa junto da lista a que ela se
	 * referia. Guardar só a data responderia "aceitou"; guardar o retrato
	 * responde "declarou exatamente estes, nesta data", que é o que se mostra a
	 * um terceiro.
	 *
	 * E é ele que implementa o reaceite: mexeu na lista, o retrato deixa de
	 * bater com o presente e a declaração vence.
	 */
	channels_snapshot jsonb not null,

	accepted_at timestamptz not null default now(),

	-- Hash, nunca o IP em claro — mesmo tratamento do lead do orçamento
	-- público (`lib/public-quote.ts`).
	accepted_ip_hash text
);

comment on column public.pl_licensed_seller_term.channels_snapshot is
	'Retrato da lista de canais no momento do aceite. Comparado com a lista atual para saber se a declaração ainda vale.';

-- O aceite corrente de cada aluno é o mais recente.
create index if not exists pl_licensed_seller_term_recente_idx
	on public.pl_licensed_seller_term(customer_id, accepted_at desc);
