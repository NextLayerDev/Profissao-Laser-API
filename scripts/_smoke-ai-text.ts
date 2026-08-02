/**
 * Smoke test do bloco `ai.text` contra o OpenRouter de verdade. Confirma, com
 * chamadas reais (custo de frações de centavo):
 *   1. texto simples com o modelo padrão do catálogo;
 *   2. modo JSON com um modelo escolhido pelo admin (`model` no params);
 *   3. fallback silencioso quando o id do modelo não existe no catálogo.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/_smoke-ai-text.ts
 */
import { aiTextBlock } from '../src/tool-blocks/blocks/ai-text.js';
import type { BlockRunContext } from '../src/tool-blocks/types.js';

const ctx: BlockRunContext = { customerId: 'smoke' };

const run = (raw: unknown) =>
	aiTextBlock.run(
		ctx,
		aiTextBlock.paramsSchema.parse(raw) as never,
	) as Promise<{
		text: string;
		json: unknown;
		model: string;
	}>;

async function main() {
	const t0 = Date.now();
	const a = await run({
		system: 'Você é um orçamentista de corte a laser. Responda em uma frase.',
		user: 'Uma peça de aço carbono 2mm com 1200mm de corte e 8 furos. Descreva a peça.',
	});
	console.log(`[1] padrão   modelo=${a.model}  ${Date.now() - t0}ms`);
	console.log(`    ${a.text.slice(0, 160)}`);

	const t1 = Date.now();
	const b = await run({
		system: 'Extraia dados. Responda SÓ com JSON.',
		user: 'Chapa de inox 304, 3 milímetros, 15 peças. Devolva {material, espessura_mm, quantidade}.',
		json: true,
		model: 'anthropic/claude-haiku-4.5',
	});
	console.log(`[2] json     modelo=${b.model}  ${Date.now() - t1}ms`);
	console.log(`    ${JSON.stringify(b.json)}`);

	const c = await run({ user: 'Diga apenas: ok', model: 'vendor/nao-existe' });
	console.log(
		`[3] fallback modelo=${c.model} (esperado: o padrão do catálogo)`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
