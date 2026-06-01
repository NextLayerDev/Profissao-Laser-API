-- Parâmetros: imagem + categoria + multi-passada (self-referential).
-- Aplicada via MCP no Demo_DB; este arquivo é o registro/durabilidade no repo.
--
-- Multi-passada: um parâmetro "pai" (isParent=true) é a passada 1 e tem N
-- filhos (parentId = pai, passOrder = 2..N), cada filho um recipe diferente.
-- Parâmetros avulsos: isParent=false, parentId=null. A listagem filtra
-- parentId IS NULL (não mostra as passadas-filhas).

alter table pl_parameter
  add column if not exists "imageUrl" text,
  add column if not exists category text,
  add column if not exists "parentId" uuid references pl_parameter(id) on delete cascade,
  add column if not exists "passOrder" integer,
  add column if not exists "isParent" boolean not null default false;

create index if not exists idx_pl_parameter_parent
  on pl_parameter("parentId", "passOrder")
  where "parentId" is not null;
