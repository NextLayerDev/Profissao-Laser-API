-- ═══════════════════════════════════════════════════════════════════════════
-- Chat ao vivo do suporte — invariante "1 atendimento aberto por cliente"
--
-- Contexto: o widget do aluno criava um chat toda vez que era ABERTO, e nem o
-- front nem o backend checavam se já havia um em andamento. Resultado prático:
-- o mesmo aluno aparecia na fila da staff com quatro atendimentos sobre o
-- mesmo assunto. O bloqueio no serviço resolve o caminho normal; este índice
-- resolve a corrida (duas abas, clique duplo, retry do cliente HTTP).
--
-- ATENÇÃO: este arquivo é DESTRUTIVO — ele encerra atendimentos duplicados
-- existentes. Rodar fora de pico, e DEPOIS de o backend com find-or-create já
-- estar no ar (senão a aplicação volta a criar duplicados e o índice passa a
-- rejeitar inserts, derrubando a abertura de chat).
--
-- Ordem: reconciliação → diagnóstico → saneamento → índice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Reconciliação ────────────────────────────────────────────────────────
-- Estas tabelas foram criadas à mão no Supabase e nunca tiveram DDL no repo.
-- Este bloco existe pra (a) deixar o esquema registrado no versionamento e
-- (b) permitir que um tenant novo, provisionado do zero, ganhe as tabelas.
-- É idempotente: em bancos que já têm as tabelas, não faz nada.

create table if not exists pl_support_chat (
  id                   uuid primary key default gen_random_uuid(),
  "customerId"         text,
  "customerName"       text,
  "attendantId"        text,
  status               text not null default 'ai',
  subject              text,
  "handoffReason"      text,
  "createdAt"          timestamptz not null default now(),
  "updatedAt"          timestamptz not null default now(),
  "closedAt"           timestamptz,
  "lastMessageAt"      timestamptz,
  "lastMessageRole"    text,
  "lastMessagePreview" text
);

create table if not exists pl_support_chat_message (
  id           uuid primary key default gen_random_uuid(),
  "chatId"     uuid not null references pl_support_chat(id) on delete cascade,
  role         text not null,
  "authorId"   text,
  "authorName" text,
  content      text not null,
  "fileUrl"    text,
  "createdAt"  timestamptz not null default now()
);

-- CHECKs como NOT VALID: passam a valer para linhas novas sem exigir varredura
-- da tabela inteira nem quebrar em dados legados fora do enum.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pl_support_chat_status_chk') then
    alter table pl_support_chat
      add constraint pl_support_chat_status_chk
      check (status in ('ai','waiting_human','with_human','closed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pl_support_chat_message_role_chk') then
    alter table pl_support_chat_message
      add constraint pl_support_chat_message_role_chk
      check (role in ('customer','ai','attendant','system')) not valid;
  end if;
end $$;

-- Índices de leitura que as telas já usam na prática.
create index if not exists pl_support_chat_customer_idx
  on pl_support_chat("customerId", "updatedAt" desc);
create index if not exists pl_support_chat_status_idx
  on pl_support_chat(status, "updatedAt" desc);
create index if not exists pl_support_chat_message_chat_idx
  on pl_support_chat_message("chatId", "createdAt");

-- ── 2. Diagnóstico ──────────────────────────────────────────────────────────
-- Rode ISOLADAMENTE antes do passo 3 pra saber o tamanho do estrago.
--
--   select "customerId", count(*) as abertos
--   from pl_support_chat
--   where status <> 'closed' and "customerId" is not null and "customerId" <> ''
--   group by "customerId" having count(*) > 1
--   order by abertos desc;
--
-- E os órfãos, que o índice não cobre e o saneamento trata à parte:
--
--   select count(*) from pl_support_chat
--   where status <> 'closed' and ("customerId" is null or "customerId" = '');

-- ── 3. Saneamento ───────────────────────────────────────────────────────────
-- Mantém APENAS o atendimento aberto mais recente de cada cliente e encerra o
-- resto. O critério é `createdAt desc` com desempate por id, pra ser
-- determinístico se dois chats nasceram no mesmo milissegundo.
--
-- Usa row_number() em vez de subquery correlacionada de propósito: precisa
-- filtrar "customerId" nulo E string vazia. Sem esse filtro as linhas com
-- "customerId" = '' sobrevivem duplicadas (NULL é distinto no btree, mas ''
-- não é) e o CREATE UNIQUE INDEX do passo 4 FALHA.

with ranked as (
  select id,
         row_number() over (
           partition by "customerId"
           order by "createdAt" desc, id desc
         ) as rn
  from pl_support_chat
  where status <> 'closed'
    and "customerId" is not null
    and "customerId" <> ''
)
update pl_support_chat c
   set status = 'closed',
       "closedAt" = coalesce(c."closedAt", now()),
       "updatedAt" = now()
  from ranked r
 where c.id = r.id
   and r.rn > 1;

-- Órfãos (sem cliente identificado) não têm dono pra reabrir e não podem ficar
-- eternamente na fila da staff.
update pl_support_chat
   set status = 'closed',
       "closedAt" = coalesce("closedAt", now()),
       "updatedAt" = now()
 where status <> 'closed'
   and ("customerId" is null or "customerId" = '');

-- ── 4. O invariante ─────────────────────────────────────────────────────────
-- A partir daqui o banco garante o que o serviço promete. Uma segunda aba que
-- tente criar um chat concorrente toma violação de unique, e o serviço
-- responde devolvendo o atendimento que já existe.
--
-- O predicado exclui "customerId" nulo E vazio. Sem o `<> ''`, todas as linhas
-- sem cliente identificado disputariam UM único slot: o primeiro chamador
-- anônimo tomaria o slot e qualquer outro seria "reusado" para dentro da
-- conversa dele — pessoas diferentes lendo o mesmo atendimento. NULL o btree já
-- trata como distinto; '' não.
create unique index if not exists pl_support_chat_one_open_per_customer
  on pl_support_chat("customerId")
  where status <> 'closed'
    and "customerId" is not null
    and "customerId" <> '';
