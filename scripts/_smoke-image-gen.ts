import { generateToolImage } from '../src/lib/image-gen.js';
import { uploadToolOutput } from '../src/lib/storage.js';

/**
 * Smoke test da geração de imagem. Roda UMA chamada de `generateToolImage` e
 * sobe o resultado pro Bunny, imprimindo `UPLOAD_OK_URL=...`. Usado pra:
 *  - confirmar `OPENROUTER_API_KEY` e Gemini 3 Pro na main API;
 *  - trocar de modelo via `--model` pra testar a injeção per-tool sem
 *    precisar mexer no banco;
 *  - testar `--system-prompt` (substitui o prompt laser padrão).
 *
 * Uso:
 *   pnpm tsx scripts/_smoke-image-gen.ts
 *   pnpm tsx scripts/_smoke-image-gen.ts --model openai/gpt-image-1
 *   pnpm tsx scripts/_smoke-image-gen.ts \
 *     --model recraft-ai/recraft-v3 \
 *     --prompt "Poster Copa do Mundo 2026, Vini Jr" \
 *     --system-prompt "Você é um designer de cartazes de futebol."
 */
type Args = {
	model?: string;
	prompt?: string;
	systemPrompt?: string;
};

function parseArgs(argv: readonly string[]): Args {
	const out: Args = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--model') out.model = argv[++i];
		else if (a === '--prompt') out.prompt = argv[++i];
		else if (a === '--system-prompt') out.systemPrompt = argv[++i];
	}
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const prompt =
		args.prompt ??
		'Mandala ornamental circular simétrica, linhas pretas finas sobre fundo branco, alto contraste, estilo gravação a laser, sem cinza.';
	const tag = args.model ? ` [${args.model}]` : ' [default Gemini]';
	console.log('gerando 1 imagem de teste' + tag + '...');
	const { png } = await generateToolImage(prompt, [], undefined, {
		model: args.model,
		systemPromptOverride: args.systemPrompt,
	});
	console.log('png bytes =', png.length);
	const url = await uploadToolOutput(
		'prompts-magicos',
		png,
		`_smoke-${Date.now()}.png`,
		'image/png',
	);
	console.log('UPLOAD_OK_URL=' + url);
	process.exit(0);
}
main().catch((e) => {
	console.error('SMOKE_FAIL:', e?.message || e);
	process.exit(1);
});
