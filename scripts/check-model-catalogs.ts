/**
 * Confere TODOS os ids dos catálogos de modelo (imagem e texto) contra a lista
 * real do OpenRouter, usando a `OPENROUTER_API_KEY` do ambiente.
 *
 * Por que este script existe: em 2026-07-11 o catálogo de imagem tinha 6 ids
 * mortos (`gpt-image-1`, `flux`, `sd`, `recraft`, `ideogram`) escritos de
 * memória. Um id morto não quebra o build, não quebra o teste e não quebra o
 * dropdown do admin — ele quebra em RUNTIME, na cara do aluno, depois do
 * voxxy já ter sido debitado. A única defesa é conferir contra a fonte.
 *
 * Rode antes de mergear qualquer mudança nos catálogos:
 *   npx tsx --env-file=.env scripts/check-model-catalogs.ts
 *
 * Sai com código 1 se algum id não existir, para poder virar passo de CI.
 */
import { IMAGE_MODELS_CATALOG } from '../src/lib/image-models-catalog.js';
import { TEXT_MODELS_CATALOG } from '../src/lib/text-models-catalog.js';

interface OpenRouterModel {
	id: string;
	architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

async function fetchModelIds(): Promise<Map<string, OpenRouterModel>> {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) {
		console.error('OPENROUTER_API_KEY ausente. Rode com --env-file=.env');
		process.exit(1);
	}
	const res = await fetch('https://openrouter.ai/api/v1/models', {
		headers: { Authorization: `Bearer ${key}` },
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		console.error(`OpenRouter /models respondeu ${res.status}`);
		process.exit(1);
	}
	const body = (await res.json()) as { data: OpenRouterModel[] };
	return new Map(body.data.map((m) => [m.id, m]));
}

interface UnifiedImagesModel {
	id: string;
	supported_parameters?: Record<string, { values?: string[] }>;
}

async function fetchUnifiedImagesModels(): Promise<
	Map<string, UnifiedImagesModel>
> {
	const key = process.env.OPENROUTER_API_KEY;
	const res = await fetch('https://openrouter.ai/api/v1/images/models', {
		headers: { Authorization: `Bearer ${key}` },
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		console.error(`OpenRouter /images/models respondeu ${res.status}`);
		process.exit(1);
	}
	const body = (await res.json()) as { data: UnifiedImagesModel[] };
	return new Map(body.data.map((m) => [m.id, m]));
}

/**
 * Confere os capability flags de `IMAGE_MODELS_CATALOG` (`unifiedImagesApi`,
 * `apiAspectRatios`, `apiResolutions`, `apiQuality`) contra o que a OpenRouter
 * REALMENTE aceita hoje em `GET /v1/images/models`. Esses flags foram
 * populados com dados reais em 2026-08-01 (não suposição) — mas a API pode
 * mudar; esse check evita que o catálogo fique desatualizado em silêncio.
 */
function checkUnifiedImagesCapabilities(
	live: Map<string, UnifiedImagesModel>,
): number {
	console.log(
		'\n== Capabilities /v1/images (aspect_ratio/resolution/quality) ==',
	);
	let bad = 0;
	for (const m of IMAGE_MODELS_CATALOG) {
		if (!m.unifiedImagesApi) continue;
		const liveModel = live.get(m.id);
		if (!liveModel) {
			console.log(
				`  SEM /v1/images  ${m.id} (catálogo diz unifiedImagesApi:true)`,
			);
			bad++;
			continue;
		}
		const params = liveModel.supported_parameters ?? {};
		const checks: Array<[string, string[] | undefined, boolean]> = [
			[
				'apiAspectRatios',
				m.apiAspectRatios as string[] | undefined,
				!!params.aspect_ratio,
			],
			[
				'apiResolutions',
				m.apiResolutions as string[] | undefined,
				!!params.resolution,
			],
			['apiQuality', m.apiQuality as string[] | undefined, !!params.quality],
		];
		let modelBad = false;
		for (const [field, catalogValues, liveHasParam] of checks) {
			if (catalogValues?.length && !liveHasParam) {
				console.log(
					`  DIVERGE  ${m.id}: catálogo tem ${field} mas a API não suporta o parâmetro`,
				);
				modelBad = true;
			}
		}
		if (modelBad) bad++;
		else console.log(`  ok     ${m.id}`);
	}
	return bad;
}

function check(
	label: string,
	ids: string[],
	live: Map<string, OpenRouterModel>,
	requireImageOutput: boolean,
): number {
	console.log(`\n== ${label} (${ids.length}) ==`);
	let bad = 0;
	for (const id of ids) {
		const model = live.get(id);
		if (!model) {
			console.log(`  MORTO  ${id}`);
			bad++;
			continue;
		}
		// Um modelo de texto no catálogo de imagem existe, mas nunca devolve
		// imagem — falha silenciosa que o "existe?" sozinho não pega.
		const out = model.architecture?.output_modalities ?? [];
		if (requireImageOutput && !out.includes('image')) {
			console.log(`  SEM IMAGEM  ${id} (output: ${out.join(',') || '?'})`);
			bad++;
			continue;
		}
		console.log(`  ok     ${id}`);
	}
	return bad;
}

async function main() {
	const live = await fetchModelIds();
	console.log(`OpenRouter respondeu com ${live.size} modelos.`);

	let bad =
		check(
			'Catálogo de IMAGEM',
			IMAGE_MODELS_CATALOG.map((m) => m.id),
			live,
			true,
		) +
		check(
			'Catálogo de TEXTO',
			TEXT_MODELS_CATALOG.map((m) => m.id),
			live,
			false,
		);

	const liveUnifiedImages = await fetchUnifiedImagesModels();
	bad += checkUnifiedImagesCapabilities(liveUnifiedImages);

	if (bad > 0) {
		console.error(`\n${bad} problema(s) encontrado(s). NÃO mergear.`);
		process.exit(1);
	}
	console.log('\nTodos os ids e capabilities conferidos.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
