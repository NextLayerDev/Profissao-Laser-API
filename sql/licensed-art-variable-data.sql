-- DADOS VARIÁVEIS: o que muda de uma peça para a outra dentro do mesmo lote.
--
-- Até aqui um lote era N cópias da MESMA arte, cada uma com seu código. É o
-- caso do brinde: 50 copos iguais. O caso que faltava é o oposto e é o que a
-- loja de fato vende — 30 canecas, cada uma com o nome (ou a foto) de uma
-- pessoa diferente. Ali cada peça é uma geração própria, não uma cópia.
--
-- `piece_label` é o dado que gerou a peça, guardado em claro: o nome, a frase.
-- Serve para o aluno achar "a caneca da Marina" na biblioteca sem abrir 30
-- arquivos, e para o cupom do QR dizer de quem é a peça. Não é chave de nada.
--
-- Nulo continua sendo a resposta certa para todo lote uniforme — e para as 66
-- peças que já existem.

alter table public.pl_licensed_art
	add column if not exists piece_label text;

comment on column public.pl_licensed_art.piece_label is
	'Dado variável da peça (nome, frase) quando o lote é personalizado. Nulo em lote uniforme.';
