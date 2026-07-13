-- OPCIONAL (decisão de negócio) — rodar UMA VEZ no DEPLOY do modelo "cobrança
-- por formato no download".
--
-- Contexto: os vetores criados ANTES desta mudança foram cobrados na GERAÇÃO
-- (modelo antigo: 1 cobrança = todos os formatos liberados). Com o novo modelo,
-- baixar/re-baixar cobra por formato — então, sem este backfill, o cliente
-- pagaria DE NOVO p/ re-baixar um vetor antigo que já pagou. Este UPDATE
-- "aposenta" (grandfather) todos os vetores já existentes como já-pagos nos 3
-- formatos, evitando recobrança do histórico.
--
-- Rodar no projeto do UPVOX (UPVOX_SUPABASE_URL), NO deploy (pega tudo criado
-- sob o modelo antigo). Reversível: `UPDATE ... SET paid_formats = '{}'`.
UPDATE customer_vectors
SET paid_formats = '{svg,png,dxf}'
WHERE paid_formats = '{}';
