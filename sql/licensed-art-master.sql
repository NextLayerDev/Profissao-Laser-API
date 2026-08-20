-- AMPLIAR A TIRAGEM sem gerar de novo.
--
-- A tiragem é escolhida ANTES de o modelo rodar, então o aluno encomenda 50
-- peças no escuro. Guardando a arte-mãe, "gerei 10, vendi bem, quero mais 40"
-- deixa de exigir uma nova geração: são só carimbo e licença — e é exatamente
-- a decomposição do preço (geração ≠ peça) provando o próprio valor.
--
-- SEM TABELA DE LOTE, de propósito: o lote não tem estado próprio nenhum além
-- da arte-mãe. Marca, licenciante, título e tamanho já vivem na peça. Uma
-- tabela aqui seria uma linha com uma coluna útil e dois estados para manter
-- em sincronia.
--
-- Idempotente: pode reaplicar.

alter table public.pl_licensed_art
	add column if not exists master_path text;

comment on column public.pl_licensed_art.master_path is
	'Caminho da arte-mãe SEM carimbo, no storage. NUNCA é serializado ao cliente: é o que permite ampliar a tiragem sem nova geração. Nulo nas peças anteriores a este recurso.';

-- A numeração dentro do lote é única: "peça 23 de 50" tem de significar UMA
-- peça. O unique por invocação continua existindo e cuida da idempotência de
-- retentativa; este cuida da integridade da contagem quando o lote CRESCE, com
-- uma invocação nova.
create unique index if not exists pl_licensed_art_batch_piece_uniq
	on public.pl_licensed_art(batch_id, piece_index)
	where batch_id is not null;
