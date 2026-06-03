-- Parâmetros: adiciona as dimensões 'machine' e 'material' ao vocabulário de
-- filtros (pl_parameter_option), antes restrito a lens/category/color/mode.
-- Agora o admin gerencia Máquina e Material na aba Vocabulários (igual às Lentes),
-- e esses viram a fonte do select de máquina + da classificação de material
-- (coluna pl_parameter.materialType) + dos filtros do cliente.
--
-- Aplicada via MCP no Demo_DB; este arquivo é o registro/durabilidade no repo.

alter table pl_parameter_option
  drop constraint if exists pl_parameter_option_dimension_check;
alter table pl_parameter_option
  add constraint pl_parameter_option_dimension_check
  check (dimension in ('lens','category','color','mode','machine','material'));

-- Seed inicial (idempotente) — espelha os antigos consts MACHINE_OPTIONS /
-- MATERIAL_OPTIONS do front, que passam a ser geridos aqui.
insert into pl_parameter_option (dimension, value, "order") values
  ('machine', 'Fiber 20W', 0),
  ('machine', 'Fiber 30W', 1),
  ('machine', 'Fiber 50W', 2),
  ('machine', 'CO2 40W', 3),
  ('machine', 'CO2 80W', 4),
  ('machine', 'UV', 5),
  ('machine', 'Diodo', 6),
  ('material', 'Aço inox', 0),
  ('material', 'Alumínio', 1),
  ('material', 'Acrílico', 2),
  ('material', 'MDF', 3),
  ('material', 'Couro', 4),
  ('material', 'Madeira', 5),
  ('material', 'Vidro', 6),
  ('material', 'Plástico', 7),
  ('material', 'Tecido', 8),
  ('material', 'Papel', 9),
  ('material', 'Borracha', 10),
  ('material', 'Pedra', 11)
on conflict (dimension, value) do nothing;
