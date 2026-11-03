-- Modelo "Só licenciar — arte pronta" para TODA marca licenciada já cadastrada.
--
-- Marcas criadas ou editadas depois deste deploy ganham o registro sozinhas
-- (`garantirModeloCarimbo`, em src/lib/licensed-stamp-entry.ts). Este arquivo
-- cobre as que já existiam. Idempotente: roda quantas vezes quiser.
--
-- ATENÇÃO — a definition `arte_licenciada` mora no Supabase da upvox-api, não
-- aqui. Para o admin poder ESCOLHER o modo na Fábrica, o enum `mode` de
-- `bank.fields` daquela definition precisa listar 'carimbo' (o front já tolera a
-- ausência, mas o select não mostra). No Supabase da upvox-api:
--
--   update ai_tool_definitions
--   set definition = jsonb_set(definition, '{bank,fields}', (
--     select jsonb_agg(
--       case when f->>'name' = 'mode' and not (f->'options' ? 'carimbo')
--            then jsonb_set(f, '{options}', (f->'options') || '["carimbo"]'::jsonb)
--            else f end)
--     from jsonb_array_elements(definition->'bank'->'fields') f))
--   where tool_key = 'arte_licenciada' and status = 'published';

insert into public.pl_tool_bank_entry (tool_key, title, description, position, active, data)
select
	'arte_licenciada',
	'Só licenciar — arte pronta',
	'Envie sua arte finalizada e receba o código de autenticidade gravado nela. Nada é gerado: a arte sai como entrou.',
	0,
	true,
	jsonb_build_object(
		'mode', 'carimbo',
		'max_images', 1,
		'feature_key', b.feature_key,
		'licensor_name', b.display_name
	)
from public.pl_licensed_brand b
where not exists (
	select 1
	from public.pl_tool_bank_entry e
	where e.tool_key = 'arte_licenciada'
		and e.data->>'mode' = 'carimbo'
		and lower(e.data->>'feature_key') = lower(b.feature_key)
);
