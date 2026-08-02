-- ============================================================================
-- Fábrica de Tools — COLEÇÕES (generalização do "Banco do Admin")
-- ============================================================================
-- `pl_tool_bank_entry` já era um armazém genérico por tool (`data jsonb` com os
-- campos declarados em `bank.fields`), mas só servia galeria de prompts:
-- escrita só de admin, sem moderação, sem paginação, sem facetas, sem social.
--
-- Esta migração o transforma no armazém de QUALQUER dataset declarado por
-- QUALQUER tool. Depois dela, criar uma ferramenta de catálogo (Metallic,
-- materiais, velocidades de corte, biblioteca de estilos) é escrever JSON na
-- `definition` — sem DDL nova, nunca mais.
--
-- SEGURANÇA DESTA MIGRAÇÃO:
--   * 100% ADITIVA — nenhuma coluna existente é alterada ou removida.
--   * IDEMPOTENTE — pode reaplicar (`if not exists` em tudo).
--   * Os defaults preservam o comportamento atual: toda linha que já existe
--     vira `collection='default'` + `status='approved'`, que é exatamente como
--     o Prompts Mágicos já a enxergava (`active = true`).
--
-- ARMADILHA RESPEITADA: nenhuma FK para `Customers(id)`. Tabelas `pl_*` com
-- essa FK quebram usuários NATIVOS da upvox, que não têm linha em `Customers`
-- (ver `sql/drop-legacy-customers-fks.sql`). `owner_id`/`customer_id` são TEXT
-- sem FK, de propósito.
-- ============================================================================

-- ─────────────────────────── 1. Coleções ───────────────────────────

alter table public.pl_tool_bank_entry
  -- Várias coleções por tool. `default` é o banco de hoje (Prompts Mágicos).
  add column if not exists collection  text not null default 'default',

  -- Moderação. Default `approved` para que TODA linha existente continue
  -- visível — o filtro do cliente vira `status='approved' and active`.
  add column if not exists status      text not null default 'approved',
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,

  -- Quem submeteu (aluno). Null = registro da equipe. SEM FK, de propósito.
  add column if not exists owner_id    text,

  -- `owner` = só o dono vê (ex.: tabela de custos particular do profissional).
  add column if not exists visibility  text not null default 'public',

  -- Ranking materializado (confiança por Laplace, curtidas…). Leitura é ~100×
  -- mais frequente que escrita, então vale materializar em vez de agregar.
  add column if not exists score       numeric,

  -- Contadores desnormalizados: {ok, parcial, falha, likes, saves, ratings}.
  add column if not exists stats       jsonb not null default '{}'::jsonb;

-- CHECKs adicionados à parte: `add column ... check` não aceita `if not exists`
-- no constraint, então usamos DO/EXCEPTION para manter a idempotência.
do $$
begin
  alter table public.pl_tool_bank_entry
    add constraint pl_tool_bank_entry_status_chk
    check (status in ('draft', 'pending', 'approved', 'rejected'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pl_tool_bank_entry
    add constraint pl_tool_bank_entry_visibility_chk
    check (visibility in ('public', 'owner', 'staff'));
exception when duplicate_object then null;
end $$;

-- Listagem: (tool, coleção, status) + ordem. Cobre o caminho quente da tela.
create index if not exists pl_tool_bank_entry_col_idx
  on public.pl_tool_bank_entry (tool_key, collection, status, position);

-- FACETAS. Sem índice, filtrar por um campo dentro de `data` é sequential scan
-- na tabela inteira — o Metallic com dezenas de milhares de receitas ficaria
-- inutilizável.
--
-- É um GIN COMPOSTO (`tool_key`, `collection`, `data`), não um GIN só em `data`.
-- Medido a 50k linhas: com o GIN puro o planner resolve `data @> {...}` pelo
-- índice mas deixa `tool_key`/`collection` como Filter no heap; com o composto
-- os três entram no Recheck Cond, ou seja, tudo é resolvido no índice. E toda
-- consulta nossa SEMPRE escopa por tool_key + collection, então o composto
-- domina o puro em todos os casos — não vale manter os dois (dois GIN na mesma
-- tabela dobram o custo de escrita).
--
-- `jsonb_path_ops` é menor e mais rápido que o GIN padrão para o operador de
-- contenção `@>`, que é o único que usamos nas facetas.
create extension if not exists btree_gin;

create index if not exists pl_tool_bank_entry_facet_gin
  on public.pl_tool_bank_entry
  using gin (tool_key, collection, data jsonb_path_ops);

-- Ordenação por confiança/relevância.
create index if not exists pl_tool_bank_entry_score_idx
  on public.pl_tool_bank_entry (tool_key, collection, score desc nulls last);

-- "Minhas submissões" e o filtro de visibilidade `owner`.
create index if not exists pl_tool_bank_entry_owner_idx
  on public.pl_tool_bank_entry (owner_id, tool_key)
  where owner_id is not null;

-- Fila de moderação da equipe.
create index if not exists pl_tool_bank_entry_pending_idx
  on public.pl_tool_bank_entry (tool_key, collection, created_at desc)
  where status = 'pending';

comment on column public.pl_tool_bank_entry.collection is
  'Nome da coleção dentro da tool (definition.collections). `default` = o banco legado.';
comment on column public.pl_tool_bank_entry.status is
  'Moderação. Linhas legadas nascem `approved` para não sumirem da galeria.';
comment on column public.pl_tool_bank_entry.owner_id is
  'Quem submeteu. TEXT sem FK de propósito — FK para Customers quebra usuário nativo da upvox.';
comment on column public.pl_tool_bank_entry.score is
  'Ranking materializado. Para coleções com feedback, confiança de Laplace.';

-- ─────────────────────── 2. Feedback e engajamento ───────────────────────
-- Uma tabela genérica para like/save/rating E para o relato de "funcionou /
-- não funcionou". No Metallic, `payload.adjustments` (o que a pessoa mudou
-- para o corte dar certo) é o ativo mais valioso da base: é o gradiente
-- empírico que calibra a interpolação da "receita mais próxima".

create table if not exists public.pl_tool_entry_feedback (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null
    references public.pl_tool_bank_entry(id) on delete cascade,
  customer_id text not null,                        -- SEM FK, de propósito
  kind        text not null
    check (kind in ('like', 'save', 'rating', 'result')),
  value       numeric,                              -- rating 1..5
  outcome     text
    check (outcome is null or outcome in ('sucesso', 'parcial', 'falha')),
  payload     jsonb not null default '{}'::jsonb,   -- {symptom, adjustments, photoUrl}
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Um relato por pessoa por tipo. O CRUD faz upsert nesta chave.
  unique (entry_id, customer_id, kind)
);

create index if not exists pl_tool_entry_feedback_entry_idx
  on public.pl_tool_entry_feedback (entry_id, kind);

create index if not exists pl_tool_entry_feedback_customer_idx
  on public.pl_tool_entry_feedback (customer_id, created_at desc);

comment on table public.pl_tool_entry_feedback is
  'Engajamento e relato de resultado por registro de coleção. Genérica: serve qualquer tool.';
comment on column public.pl_tool_entry_feedback.payload is
  'Metallic: {symptom, adjustments:{speed:+15,...}, photoUrl}. `adjustments` calibra a interpolação.';

-- ─────────────────────── 3. Recálculo do score ───────────────────────
-- Confiança com prior de Laplace, para 1 voto positivo NÃO virar "100% confiável":
--     score = (2*ok + parcial + 1) / (2*(ok + parcial + falha) + 2)
-- Sem o prior, uma receita com um único relato de sucesso apareceria acima de
-- uma com 50 relatos e 90% de acerto — que é o oposto do que o usuário quer.

create or replace function public.pl_tool_entry_recalc_score(p_entry_id uuid)
returns void language plpgsql as $$
declare
  v_ok      int;
  v_parcial int;
  v_falha   int;
  v_likes   int;
  v_saves   int;
  v_rating  numeric;
  v_ratings int;
begin
  select
    count(*) filter (where kind = 'result' and outcome = 'sucesso'),
    count(*) filter (where kind = 'result' and outcome = 'parcial'),
    count(*) filter (where kind = 'result' and outcome = 'falha'),
    count(*) filter (where kind = 'like'),
    count(*) filter (where kind = 'save'),
    coalesce(avg(value) filter (where kind = 'rating'), 0),
    count(*) filter (where kind = 'rating')
  into v_ok, v_parcial, v_falha, v_likes, v_saves, v_rating, v_ratings
  from public.pl_tool_entry_feedback
  where entry_id = p_entry_id;

  update public.pl_tool_bank_entry
     set score = case
           when (v_ok + v_parcial + v_falha) > 0
             then (2 * v_ok + v_parcial + 1)::numeric
                  / (2 * (v_ok + v_parcial + v_falha) + 2)
           -- Sem relato de resultado, o rating manual serve de proxy (0..1).
           when v_ratings > 0 then v_rating / 5
           else null
         end,
         stats = jsonb_build_object(
           'ok', v_ok, 'parcial', v_parcial, 'falha', v_falha,
           'likes', v_likes, 'saves', v_saves,
           'rating', round(v_rating, 2), 'ratings', v_ratings
         ),
         updated_at = now()
   where id = p_entry_id;
end $$;

-- Mantém `score`/`stats` sempre coerentes, inclusive em DELETE (uma pessoa que
-- apaga o próprio relato de falha tem que fazer a confiança subir de novo).
create or replace function public.pl_tool_entry_feedback_sync()
returns trigger language plpgsql as $$
begin
  perform public.pl_tool_entry_recalc_score(
    coalesce(new.entry_id, old.entry_id)
  );
  return null;
end $$;

drop trigger if exists pl_tool_entry_feedback_trg
  on public.pl_tool_entry_feedback;
create trigger pl_tool_entry_feedback_trg
  after insert or update or delete on public.pl_tool_entry_feedback
  for each row execute function public.pl_tool_entry_feedback_sync();
