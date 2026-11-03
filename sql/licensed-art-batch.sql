-- A TIRAGEM: uma rodada passa a poder emitir N peças, cada uma com seu código.
--
-- É o coração do controle de volumetria. Enquanto uma geração valia UM código,
-- o aluno gerava uma arte genérica e gravava em 50 copos: a plataforma cobrava
-- uma peça e o clube licenciante não via nada dos outros 49. Agora 50 peças são
-- 50 arquivos, 50 códigos e 50 créditos — e gravar a 51ª exige repetir um
-- código.
--
-- Idempotente: pode reaplicar.

alter table public.pl_licensed_art
	add column if not exists batch_id uuid,
	add column if not exists piece_index int not null default 1,
	add column if not exists batch_size int not null default 1;

comment on column public.pl_licensed_art.batch_id is
	'O lote a que esta peça pertence. Nulo nas peças emitidas antes da tiragem.';
comment on column public.pl_licensed_art.piece_index is
	'A posição da peça no lote, de 1 a batch_size. É o nome do arquivo entregue.';
comment on column public.pl_licensed_art.batch_size is
	'Quantas peças o lote tem. 1 nas peças anteriores à tiragem.';

-- A idempotência deixa de ser por rodada e passa a ser por PEÇA da rodada.
--
-- O `not null default 1` do `piece_index` é a parte que sustenta isto: com
-- nulo, o unique `(invocation_id, null)` não colidiria com nada — em Postgres
-- nulos são distintos entre si num unique — e a idempotência das linhas JÁ
-- EMITIDAS evaporaria. Com default 1, toda linha antiga é a peça 1 e uma
-- retentativa de rodada de uma peça colide igualzinho a antes.
drop index if exists pl_licensed_art_invocation_uniq;
create unique index if not exists pl_licensed_art_invocation_piece_uniq
	on public.pl_licensed_art(invocation_id, piece_index)
	where invocation_id is not null;

-- A biblioteca lista por dono e agrupa por lote.
create index if not exists pl_licensed_art_batch_idx
	on public.pl_licensed_art(batch_id, piece_index)
	where batch_id is not null;
