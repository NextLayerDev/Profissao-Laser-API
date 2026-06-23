-- Drop legacy FKs that reference the `Customers` table.
--
-- Pós-migração, a fonte de verdade dos usuários é a tabela `users` do upvox
-- (banco separado). A `Customers` legada só guarda usuários migrados, então
-- cadastros NATIVOS do upvox não têm linha lá. As FKs abaixo apontam para
-- `Customers(id)` e rejeitam silenciosamente os inserts desses usuários nativos,
-- quebrando: perfil/avatar, salvar vetorizações, dúvidas de aula, chat de
-- suporte, aulas salvas e gamificação.
--
-- Todas as linhas existentes satisfazem essas FKs (são dos usuários migrados),
-- então remover é no-op de dados. As colunas seguem guardando o uuid do usuário
-- do upvox (é como o app já as trata, via request.currentUser.id).
--
-- Idempotente (DROP CONSTRAINT IF EXISTS).

alter table public.pl_community_profile        drop constraint if exists "pl_community_profile_customerId_fkey";
alter table public.customer_vectors            drop constraint if exists customer_vectors_customer_id_fkey;
alter table public.customer_saved_lessons      drop constraint if exists customer_saved_lessons_customer_id_fkey;
alter table public.customer_lesson_completions drop constraint if exists customer_lesson_completions_customer_id_fkey;
alter table public.pl_lesson_doubt             drop constraint if exists pl_lesson_doubt_customer_id_fkey;
alter table public.pl_support_chat             drop constraint if exists pl_support_chat_customer_fk;
alter table public.pl_subscription             drop constraint if exists "pl_subscription_userId_fkey";
alter table public.pl_challenge_participant    drop constraint if exists "pl_challenge_participant_userId_fkey";
alter table public.pl_gamification_profile     drop constraint if exists "pl_gamification_profile_userId_fkey";
alter table public.pl_gamification_study_day   drop constraint if exists "pl_gamification_study_day_userId_fkey";
alter table public.pl_gamification_user_badge  drop constraint if exists "pl_gamification_user_badge_userId_fkey";
alter table public.pl_password_reset_tokens    drop constraint if exists pl_password_reset_tokens_user_id_fkey;
