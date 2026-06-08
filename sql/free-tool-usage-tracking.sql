-- Tabela para rastrear uso de ferramentas IA por usuários sem saldo de voxes (free tier).
-- Usuários sem saldo têm limites grátis: prévia 2/semana, vetorização 5/dia, editor-ai 2/semana.
-- Cada uso bem-sucedido em modo gratuito é logado aqui para contar contra o limite.
-- Usuários com saldo > 0 são cobrados normalmente em pl_credit_transaction e NÃO entram aqui.
CREATE TABLE IF NOT EXISTS public.pl_free_tool_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('previa', 'vectorize', 'editor-ai')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pl_free_tool_usage_customer_feature_created
  ON public.pl_free_tool_usage ("customerId", feature, "createdAt" DESC);

COMMENT ON TABLE public.pl_free_tool_usage IS
  'Logs free-tier (zero balance) usage of AI tools. Counted against weekly/daily limits per feature.';
