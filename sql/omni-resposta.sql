-- ═══════════════════════════════════════════════════════════════════════════
-- OmniResposta — atendimento WhatsApp por IA (aba do expert)
-- Tabelas pl_omni_* no Demo_DB. Aditivo e idempotente (aplicado via MCP).
--
-- Modelo: instância (1 WhatsApp conectado, dona = expert upvox) → contatos →
-- chats → mensagens. IA multi-agente (router + especialistas) + base de
-- conhecimento com RAG (pgvector). `pl_omni_turn` audita cada turno da IA e
-- serve de lock anti-corrida (partial unique em status='running').
-- IDs internos são UUID; o JID/número do WhatsApp fica em wa_* (o mesmo número
-- pode existir em duas instâncias sem colidir).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists vector;

-- ── Instância ────────────────────────────────────────────────────────────────
create table if not exists pl_omni_instance (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null,              -- id upvox do expert (quem paga os 0,2/msg)
  name                 text not null default 'Minha instância',
  provider             text not null check (provider in ('zapi','evolution','meta')),
  status               text not null default 'disconnected'
                       check (status in ('disconnected','connecting','qr','connected','error')),
  setup_status         text not null default 'pending'
                       check (setup_status in ('pending','provider_created','qr','connected','ready','error')),
  setup_error          text,
  phone_number         text,
  profile_name         text,
  webhook_secret       text not null,              -- 32 bytes hex; vai na URL do webhook
  -- credenciais por provedor (tokens gravados com encrypt() do lib/crypto.ts)
  zapi_instance_id     text,
  zapi_instance_token  text,
  evolution_instance   text,
  meta_phone_number_id text,
  meta_waba_token      text,
  meta_verify_token    text,
  meta_app_secret      text,
  -- IA
  ia_enabled           boolean not null default true,
  billing_status       text not null default 'ok' check (billing_status in ('ok','no_balance')),
  debounce_seconds     int  not null default 8 check (debounce_seconds between 2 and 30),
  qr_code              text,                       -- último QR (base64), efêmero
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists pl_omni_instance_owner_idx on pl_omni_instance(owner_id);

-- ── Config do negócio (jsonb; validação Zod no service) ─────────────────────
create table if not exists pl_omni_business_config (
  instance_id uuid primary key references pl_omni_instance(id) on delete cascade,
  config      jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- ── Agentes (router + especialistas) ─────────────────────────────────────────
create table if not exists pl_omni_agent (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references pl_omni_instance(id) on delete cascade,
  name             text not null,
  slug             text not null,                  -- vira o nome da tool no router
  role             text not null default 'specialist' check (role in ('router','specialist')),
  system_prompt    text not null default '',
  tool_description text not null default '',       -- como o router enxerga o especialista
  model            text not null default 'google/gemini-2.5-flash',
  temperature      numeric(3,2) not null default 0.40,
  position         int not null default 0,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (instance_id, slug)
);
create unique index if not exists pl_omni_agent_router_uniq
  on pl_omni_agent(instance_id) where role = 'router';

-- ── Contato / Chat / Mensagem ────────────────────────────────────────────────
create table if not exists pl_omni_contact (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null references pl_omni_instance(id) on delete cascade,
  wa_id           text not null,                   -- '5535...@s.whatsapp.net' ou msisdn (meta)
  name            text,
  push_name       text,
  profile_pic_url text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (instance_id, wa_id)
);

create table if not exists pl_omni_chat (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid not null references pl_omni_instance(id) on delete cascade,
  contact_id         uuid not null references pl_omni_contact(id),
  wa_chat_id         text not null,
  last_message       text,
  last_message_at    timestamptz,
  unread_count       int not null default 0,
  assigned_to        text not null default 'ai' check (assigned_to in ('ai','human')),
  assigned_user_id   uuid,
  assigned_user_name text,
  ia_paused          boolean not null default false,
  is_pinned          boolean not null default false,
  is_archived        boolean not null default false,
  status             text not null default 'active'
                     check (status in ('active','waiting','closed','window_closed')),
  lead_step          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (instance_id, wa_chat_id)
);
create index if not exists pl_omni_chat_inbox_idx
  on pl_omni_chat(instance_id, is_archived, last_message_at desc);

create table if not exists pl_omni_message (
  id                  uuid primary key default gen_random_uuid(),
  chat_id             uuid not null references pl_omni_chat(id) on delete cascade,
  instance_id         uuid not null references pl_omni_instance(id) on delete cascade,
  provider_message_id text,
  direction           text not null check (direction in ('in','out')),
  author_type         text not null check (author_type in ('contact','ai','user')),
  author_id           uuid,
  sender_name         text,
  sender_wa_id        text,
  content             text,
  media_url           text,                        -- Bunny (mídia re-hospedada)
  media_type          text check (media_type in ('image','video','audio','document','sticker')),
  file_name           text,
  caption             text,
  quoted              jsonb,
  transcription       text,                        -- áudio transcrito / descrição de imagem
  status              text not null default 'pending'
                      check (status in ('pending','sent','delivered','read','failed')),
  ai_state            text check (ai_state in ('pending','consumed','skipped')),
  billing             text check (billing in ('billed','refunded')),
  error               text,
  wa_timestamp        timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create unique index if not exists pl_omni_message_provider_uniq
  on pl_omni_message(instance_id, provider_message_id) where provider_message_id is not null;
create index if not exists pl_omni_message_chat_idx on pl_omni_message(chat_id, wa_timestamp desc);
create index if not exists pl_omni_message_pending_idx
  on pl_omni_message(chat_id) where ai_state = 'pending';

-- ── Turno da IA (auditoria + lock anti-corrida) ──────────────────────────────
create table if not exists pl_omni_turn (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            uuid not null references pl_omni_chat(id) on delete cascade,
  instance_id        uuid not null,
  status             text not null default 'running'
                     check (status in ('running','done','failed','no_balance')),
  input_message_ids  uuid[] not null default '{}',
  output_message_id  uuid,
  model              text,
  prompt_tokens      int,
  completion_tokens  int,
  voxxys_charged     numeric(12,2) not null default 0,
  error              text,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create unique index if not exists pl_omni_turn_running_uniq
  on pl_omni_turn(chat_id) where status = 'running';
create index if not exists pl_omni_turn_instance_idx
  on pl_omni_turn(instance_id, created_at desc);

-- ── Base de conhecimento (RAG) ───────────────────────────────────────────────
create table if not exists pl_omni_kb_file (
  id          uuid primary key default gen_random_uuid(),
  instance_id uuid not null references pl_omni_instance(id) on delete cascade,
  name        text not null,
  url         text not null,
  mime        text not null,
  size_bytes  bigint not null,
  status      text not null default 'processing'
              check (status in ('processing','ready','error')),
  error       text,
  chunk_count int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists pl_omni_kb_file_instance_idx on pl_omni_kb_file(instance_id);

create table if not exists pl_omni_kb_chunk (
  id          bigint generated always as identity primary key,
  instance_id uuid not null references pl_omni_instance(id) on delete cascade,
  file_id     uuid not null references pl_omni_kb_file(id) on delete cascade,
  seq         int not null,
  content     text not null,
  tokens      int not null default 0,
  embedding   vector(1536),
  tsv         tsvector generated always as (to_tsvector('portuguese', content)) stored,
  created_at  timestamptz not null default now()
);
create index if not exists pl_omni_kb_chunk_embedding_idx
  on pl_omni_kb_chunk using hnsw (embedding vector_cosine_ops);
create index if not exists pl_omni_kb_chunk_tsv_idx on pl_omni_kb_chunk using gin (tsv);
create index if not exists pl_omni_kb_chunk_instance_idx on pl_omni_kb_chunk(instance_id);

-- ── Busca (RPCs; supabase-js chama via .rpc()) ───────────────────────────────
create or replace function pl_omni_match_chunks(
  p_instance_id uuid,
  p_query vector(1536),
  p_k int default 5,
  p_min_similarity float default 0.25
) returns table (chunk_id bigint, file_id uuid, content text, similarity float)
language sql stable as $$
  select c.id, c.file_id, c.content, 1 - (c.embedding <=> p_query)
  from pl_omni_kb_chunk c
  where c.instance_id = p_instance_id
    and c.embedding is not null
    and 1 - (c.embedding <=> p_query) >= p_min_similarity
  order by c.embedding <=> p_query
  limit p_k;
$$;

create or replace function pl_omni_keyword_chunks(
  p_instance_id uuid,
  p_query text,
  p_k int default 5
) returns table (chunk_id bigint, file_id uuid, content text, rank real)
language sql stable as $$
  select c.id, c.file_id, c.content,
         ts_rank(c.tsv, websearch_to_tsquery('portuguese', p_query))
  from pl_omni_kb_chunk c
  where c.instance_id = p_instance_id
    and c.tsv @@ websearch_to_tsquery('portuguese', p_query)
  order by 4 desc
  limit p_k;
$$;
