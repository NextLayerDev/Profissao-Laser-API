-- Parâmetros: workflow de revisão (envio do membro → admin aprova/rejeita) +
-- campo "Cor" (nova dimensão de filtro) + "Q-pulse" (recipe, usado p/ UV).
-- Aplicada via MCP no Demo_DB; este arquivo é o registro/durabilidade no repo.
--
-- status: 'pending' (envio do membro aguardando análise), 'approved' (público),
-- 'rejected' (bloqueado, com motivo em reviewNote). DEFAULT 'approved' preserva
-- todos os parâmetros já existentes (criados pelo admin) — sem backfill.

alter table pl_parameter
  add column if not exists "status"      text not null default 'approved',
  add column if not exists "reviewNote"  text,
  add column if not exists "reviewedBy"  text,
  add column if not exists "reviewedAt"  timestamptz,
  add column if not exists "submittedBy" text,
  add column if not exists color         text,
  add column if not exists "qPulse"      numeric;

-- CHECK do status (idempotente — só adiciona se ainda não existir).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pl_parameter_status_check'
  ) then
    alter table pl_parameter
      add constraint pl_parameter_status_check
      check ("status" in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists idx_pl_parameter_status on pl_parameter ("status");
create index if not exists idx_pl_parameter_color  on pl_parameter (color);
