-- Parâmetros: vocabulário de opções de filtro (gerido pelo admin).
-- Aplicada via MCP no Demo_DB; este arquivo é o registro/durabilidade no repo.
--
-- Cada linha é uma opção (value) de uma dimensão de filtro (lens/category/
-- color/mode), com `order` para a ordenação no front e `status` (ativo/inativo)
-- pra esconder opções sem apagá-las. O par (dimension, value) é único.

create table if not exists pl_parameter_option (
  id uuid primary key default gen_random_uuid(),
  dimension text not null check (dimension in ('lens','category','color','mode')),
  value text not null,
  "order" integer not null default 0,
  status text not null default 'ativo' check (status in ('ativo','inativo')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create unique index if not exists idx_pl_parameter_option_uniq
  on pl_parameter_option (dimension, value);

create index if not exists idx_pl_parameter_option_dim
  on pl_parameter_option (dimension, "order");

-- Seed inicial (idempotente). `order` segue o índice do array.
insert into pl_parameter_option (dimension, value, "order") values
  ('lens', '70x70', 0),
  ('lens', '110x110', 1),
  ('lens', '150x150', 2),
  ('lens', '200x200', 3),
  ('lens', '300x300', 4),
  ('category', 'Copos', 0),
  ('category', 'Metais', 1),
  ('category', 'Madeira', 2),
  ('category', 'Acrílico', 3),
  ('category', 'Brindes', 4),
  ('category', 'Outros', 5),
  ('mode', 'Gravacao', 0),
  ('mode', 'Corte', 1),
  ('mode', 'Preenchimento', 2),
  ('mode', 'Limpeza', 3),
  ('color', 'Preto', 0),
  ('color', 'Branco', 1),
  ('color', 'Dourado', 2),
  ('color', 'Prata', 3),
  ('color', 'Vermelho', 4),
  ('color', 'Azul', 5),
  ('color', 'Verde', 6),
  ('color', 'Transparente', 7),
  ('color', 'Outros', 8)
on conflict (dimension, value) do nothing;
