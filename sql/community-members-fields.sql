-- ============================================================
-- Novos campos em pl_community_profile para GET /community/members
-- Rodar no Supabase SQL Editor do banco do tenant
-- ============================================================

ALTER TABLE pl_community_profile
    ADD COLUMN IF NOT EXISTS badge          TEXT,
    ADD COLUMN IF NOT EXISTS "featuredRole" TEXT,
    ADD COLUMN IF NOT EXISTS featured       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "lastSeenAt"   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_community_profile_featured
    ON pl_community_profile(featured) WHERE featured = true;

CREATE INDEX IF NOT EXISTS idx_community_profile_last_seen
    ON pl_community_profile("lastSeenAt" DESC);
