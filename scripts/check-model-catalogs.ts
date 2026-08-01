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

	const bad =
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

	if (bad > 0) {
		console.error(`\n${bad} id(s) inválido(s). NÃO mergear.`);
		process.exit(1);
	}
	console.log('\nTodos os ids conferidos e vivos.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
