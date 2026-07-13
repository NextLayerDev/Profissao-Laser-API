-- Cobrança POR FORMATO no download da vetorização: registra quais formatos
-- (svg/png/dxf) já foram pagos p/ cada vetor, p/ re-download (inclusive da
-- biblioteca, cross-session) NÃO cobrar de novo. Fonte de verdade da cobrança.
-- Aplicar no projeto do UPVOX (UPVOX_SUPABASE_URL), onde vive customer_vectors.
ALTER TABLE customer_vectors
ADD COLUMN IF NOT EXISTS paid_formats TEXT[] NOT NULL DEFAULT '{}';
