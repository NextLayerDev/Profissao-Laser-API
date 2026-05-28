-- Curtidas persistidas de projetos da comunidade (1 por customer/projeto).
-- Espelha pl_community_post_like. Idempotente.

CREATE TABLE IF NOT EXISTS pl_community_project_like (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL REFERENCES pl_community_project(id) ON DELETE CASCADE,
    "customerId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE ("projectId", "customerId")
);

CREATE INDEX IF NOT EXISTS idx_project_like_project ON pl_community_project_like("projectId");
CREATE INDEX IF NOT EXISTS idx_project_like_customer ON pl_community_project_like("customerId");

NOTIFY pgrst, 'reload schema';
