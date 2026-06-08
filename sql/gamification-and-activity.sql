-- ============================================================
-- Gamification + Activity Feed
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

-- ── Gamification ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pl_gamification_badge (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS pl_gamification_profile (
    "userId"        UUID PRIMARY KEY REFERENCES "Customers"(id) ON DELETE CASCADE,
    level           INT NOT NULL DEFAULT 1,
    "currentXp"     INT NOT NULL DEFAULT 0,
    "nextLevelXp"   INT NOT NULL DEFAULT 500,
    "dailyXp"       INT NOT NULL DEFAULT 0,
    "dailyXpGoal"   INT NOT NULL DEFAULT 100,
    "currentStreak" INT NOT NULL DEFAULT 0,
    "bestStreak"    INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pl_gamification_user_badge (
    "userId"   UUID NOT NULL REFERENCES "Customers"(id) ON DELETE CASCADE,
    "badgeId"  UUID NOT NULL REFERENCES pl_gamification_badge(id) ON DELETE CASCADE,
    "earnedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId", "badgeId")
);

CREATE TABLE IF NOT EXISTS pl_gamification_study_day (
    "userId" UUID NOT NULL REFERENCES "Customers"(id) ON DELETE CASCADE,
    date     DATE NOT NULL,
    PRIMARY KEY ("userId", date)
);

CREATE TABLE IF NOT EXISTS pl_challenge (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    type          TEXT NOT NULL,
    goal          INT NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT false,
    "endsAt"      TIMESTAMPTZ,
    "rewardXp"    INT NOT NULL DEFAULT 0,
    "rewardBadge" UUID REFERENCES pl_gamification_badge(id),
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pl_challenge_participant (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "challengeId" UUID NOT NULL REFERENCES pl_challenge(id) ON DELETE CASCADE,
    "userId"      UUID NOT NULL REFERENCES "Customers"(id) ON DELETE CASCADE,
    progress      INT NOT NULL DEFAULT 0,
    "joinedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE ("challengeId", "userId")
);

-- ── Activity feed ─────────────────────────────────────────────────────────────

-- Necessário para o tipo member_joined
ALTER TABLE "Customers"
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- FKs para os joins PostgREST do feed de atividade

DO $$ BEGIN
    ALTER TABLE customer_lesson_completions
        ADD CONSTRAINT fk_completion_lesson
        FOREIGN KEY (lesson_id) REFERENCES pl_lesson(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE pl_lesson
        ADD CONSTRAINT fk_lesson_product
        FOREIGN KEY ("productId") REFERENCES pl_product(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índices úteis para performance do feed
CREATE INDEX IF NOT EXISTS idx_lesson_completions_completed_at
    ON customer_lesson_completions(completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_gamification_user_badge_earned_at
    ON pl_gamification_user_badge("earnedAt" DESC);

CREATE INDEX IF NOT EXISTS idx_challenge_participant_joined_at
    ON pl_challenge_participant("joinedAt" DESC);
