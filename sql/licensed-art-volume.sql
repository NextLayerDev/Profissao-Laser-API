-- VOLUMETRIA POR MARCA — o número que se mostra ao licenciante.
--
-- É o que o cliente quis dizer com "esse controle faria a diferença para a
-- gente vender para todo mundo": sentar com um clube e dizer "seu escudo saiu
-- em 320 peças este mês, aqui estão os códigos". Sem isso, a tiragem é um dado
-- interno que não vira conversa comercial.
--
-- `archived_at` NÃO filtra, pelo mesmo motivo de `buscarPorCodigo`: arquivar é
-- o aluno arrumando a estante dele. A contagem do licenciante é de peças que
-- EXISTEM no mundo — e uma peça arquivada pode estar gravada num chaveiro.
--
-- Revogadas contam separado, em coluna própria: elas aconteceram, e some-las
-- ao total esconderia justamente o caso que o clube mais quer ver.
--
-- Idempotente: pode reaplicar.

create or replace view public.pl_licensed_art_volume as
select
	a.feature_key,
	b.display_name,
	b.active as marca_ativa,
	date_trunc('month', a.created_at)::date as mes,
	count(*)::int as pecas,
	count(*) filter (where a.revoked_at is null)::int as pecas_validas,
	count(*) filter (where a.revoked_at is not null)::int as pecas_revogadas,
	count(distinct a.invocation_id)::int as rodadas,
	count(distinct a.batch_id)::int as lotes,
	count(distinct a.customer_id)::int as alunos,
	min(a.created_at) as primeira,
	max(a.created_at) as ultima
from public.pl_licensed_art a
left join public.pl_licensed_brand b on b.feature_key = a.feature_key
group by a.feature_key, b.display_name, b.active, date_trunc('month', a.created_at);

-- A view é lida pelo service role da main-api, atrás de rota staff. Nenhum
-- papel anônimo ou de aluno tem o que fazer com o consumo de todo mundo.
revoke all on public.pl_licensed_art_volume from anon, authenticated;

comment on view public.pl_licensed_art_volume is
	'Peças licenciadas por marca e por mês. A prestação de contas ao licenciante.';
