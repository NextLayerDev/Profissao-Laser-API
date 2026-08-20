-- Arquivar uma peça — some da biblioteca, NÃO some do mundo.
--
-- A peça arquivada continua existindo porque o QR dela pode já estar GRAVADO
-- num chaveiro que saiu daqui. Apagar a linha transformaria esse QR num 404, e
-- a página pública trata código inexistente como sinal de falsificação — o
-- aluno arrumando a própria biblioteca acabaria acusando a própria peça.
--
-- Reversível de propósito: `archived_at` volta a nulo e a peça reaparece.
--
-- Idempotente: pode reaplicar.

alter table public.pl_licensed_art
	add column if not exists archived_at timestamptz;

comment on column public.pl_licensed_art.archived_at is
	'Quando o aluno tirou a peça da biblioteca dele. Nulo = visível. A licença e o QR seguem valendo.';

-- A listagem da biblioteca filtra por dono e por não-arquivada; o índice
-- existente é (customer_id, created_at desc) e continua servindo.
create index if not exists pl_licensed_art_customer_ativas_idx
	on public.pl_licensed_art(customer_id, created_at desc)
	where archived_at is null;
