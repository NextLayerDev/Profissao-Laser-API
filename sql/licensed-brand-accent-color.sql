-- Cor oficial do clube, usada como fundo do campo do escudo na tela da
-- ferramenta Arte Licenciada. Nula é legítimo: nem toda marca tem uma cor
-- chapada que funcione atrás do escudo, e nesses casos a tela cai no cinza.
alter table public.pl_licensed_brand
	add column if not exists accent_color text;

comment on column public.pl_licensed_brand.accent_color is
	'Hex #rrggbb da cor oficial da marca. Nulo = usa o cinza neutro da interface.';
