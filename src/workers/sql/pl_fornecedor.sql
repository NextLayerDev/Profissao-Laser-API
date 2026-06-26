-- Tool "Fornecedores" (Demo_DB) — entidade real que substitui a gambiarra que
-- lia mensagens do canal da comunidade (c24d2250-7ecc-4427-90c5-0cc0ba24f8e7).
-- SEM FK para Customers (armadilha: usuários nativos do upvox não têm linha em
-- Customers). `sourceMessageId` rastreia a origem e torna o backfill idempotente.
-- Já aplicado no Demo_DB via migration `create_pl_fornecedor` (2026-06-26).

create table if not exists public.pl_fornecedor (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  content text not null,
  "imageUrl" text,
  "authorName" text,
  "authorAvatar" text,
  "isActive" boolean not null default true,
  "order" integer not null default 0,
  "sourceMessageId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists idx_pl_fornecedor_active_order
  on public.pl_fornecedor ("isActive", "order", "createdAt");

create unique index if not exists uq_pl_fornecedor_source
  on public.pl_fornecedor ("sourceMessageId")
  where "sourceMessageId" is not null;

-- Backfill verbatim dos fornecedores já alimentados no canal da comunidade.
-- Empresa parseada de "🏢 Empresa: <X>"; conteúdo preservado sem mudança.
insert into public.pl_fornecedor
  (company, content, "imageUrl", "authorName", "authorAvatar", "isActive", "order", "sourceMessageId", "createdAt", "updatedAt")
select
  coalesce(nullif(trim(substring(m.content from '🏢 Empresa:\s*([^\r\n]+)')), ''), 'Fornecedor'),
  m.content,
  m."fileUrl",
  m."authorName",
  m."authorAvatar",
  true,
  (row_number() over (order by m."createdAt"))::int,
  m.id,
  m."createdAt",
  m."createdAt"
from public.pl_community_message m
where m."channelId" = 'c24d2250-7ecc-4427-90c5-0cc0ba24f8e7'
  -- só fichas de fornecedor (têm o marcador 🏢 Empresa:); ignora mensagens
  -- avulsas que por acaso existam no canal. As 15 atuais casam todas.
  and m.content like '%🏢 Empresa:%'
order by m."createdAt"
on conflict ("sourceMessageId") where "sourceMessageId" is not null do nothing;
