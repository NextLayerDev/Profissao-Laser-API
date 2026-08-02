import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { imageStudioBlock } from '../src/tool-blocks/blocks/image-studio.js';

/**
 * Smoke dos SETE modos do Estúdio de Imagens, com chamada REAL ao OpenRouter
 * (a chave sai do `.env`). Salva cada saída em /tmp e imprime tempo, tamanho e
 * dimensão — é o único jeito de saber se um modo é bom ou só compila.
 *
 * Os modos que precisam de imagem de entrada (variação, edição, ampliar,
 * remover fundo) reusam a saída do modo anterior, exatamente como o aluno faz:
 * gera, olha, mexe em cima.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/_smoke-image-studio.ts
 *   npx tsx --env-file=.env scripts/_smoke-image-studio.ts --model google/gemini-3.1-flash-image
 *   npx tsx --env-file=.env scripts/_smoke-image-studio.ts --only textura,vetorizavel
 */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const model = flag('model');
const only = flag('only')
	?.split(',')
	.map((s) => s.trim());

const ctx = { customerId: 'smoke' };
const OUT = '/tmp';

/** Máscara: metade esquerda branca (repintar), direita preta (preservar). */
async function halfMask(width: number, height: number): Promise<Buffer> {
	const raw = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const v = x < width / 2 ? 255 : 0;
			const i = (y * width + x) * 3;
			raw[i] = v;
			raw[i + 1] = v;
			raw[i + 2] = v;
		}
	}
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.png()
		.toBuffer();
}

/** Diferença média entre a coluna 0 e a W-1 — a medida de "tileável". */
async function seamX(buf: Buffer): Promise<number> {
	const { data, info } = await sharp(buf)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height, channels } = info;
	let sum = 0;
	for (let y = 0; y < height; y++)
		for (let c = 0; c < channels; c++)
			sum += Math.abs(
				data[y * width * channels + c] -
					data[(y * width + width - 1) * channels + c],
			);
	return sum / (height * channels);
}

type Result = { png: Buffer; [k: string]: unknown };

async function runMode(
	nome: string,
	params: Record<string, unknown>,
): Promise<Result | null> {
	if (only && !only.includes(nome)) return null;
	const t0 = Date.now();
	try {
		const parsed = imageStudioBlock.paramsSchema.parse({
			...params,
			...(model ? { model } : {}),
		});
		const out = (await imageStudioBlock.run(ctx, parsed)) as Result;
		const ms = Date.now() - t0;
		const meta = await sharp(out.png).metadata();
		const file = `${OUT}/estudio-${nome}.png`;
		await writeFile(file, out.png);
		const extras = [
			out.vectorReady ? 'vectorReady' : '',
			out.tileable ? 'tileable' : '',
			`custo ${out.cost_multiplier}×`,
		]
			.filter(Boolean)
			.join(' · ');
		console.log(
			`OK   ${nome.padEnd(15)} ${String(ms / 1000).padStart(6)}s  ` +
				`${String((out.png.length / 1024).toFixed(0)).padStart(6)} KB  ` +
				`${meta.width}×${meta.height}  ${extras}  → ${file}`,
		);
		return out;
	} catch (err) {
		const ms = Date.now() - t0;
		const msg = err instanceof Error ? err.message : String(err);
		console.log(
			`FALHA ${nome.padEnd(15)} ${String(ms / 1000).padStart(6)}s  ${msg}`,
		);
		return null;
	}
}

async function main() {
	if (!process.env.OPENROUTER_API_KEY) {
		console.error('sem OPENROUTER_API_KEY — rode com --env-file=.env');
		process.exit(1);
	}
	console.log(`modelo: ${model ?? '(default do catálogo)'}\n`);

	const base = await runMode('texto_imagem', {
		mode: 'texto_imagem',
		prompt:
			'Uma coruja estilizada de frente, formas geométricas simples, traço grosso e uniforme, alto contraste, fundo liso.',
		aspect: '1:1',
	});

	await runMode('variacao', {
		mode: 'variacao',
		prompt: 'A mesma coruja, agora de perfil, olhando para a esquerda.',
		image: base?.png,
		aspect: '1:1',
	});

	const semFundo = await runMode('remover_fundo', {
		mode: 'remover_fundo',
		image: base?.png,
	});

	await runMode('ampliar', {
		mode: 'ampliar',
		image: semFundo?.png ?? base?.png,
		factor: '2',
	});

	const meta = base ? await sharp(base.png).metadata() : null;
	await runMode('editar_mascara', {
		mode: 'editar_mascara',
		prompt: 'Coloque um chapéu de cangaceiro na coruja.',
		image: base?.png,
		mask: meta
			? await halfMask(meta.width ?? 1024, meta.height ?? 1024)
			: undefined,
	});

	const textura = await runMode('textura', {
		mode: 'textura',
		prompt:
			'Madeira de carvalho envelhecida, veios longos e nós pequenos, vista de cima.',
		aspect: '1:1',
	});
	if (textura) {
		console.log(
			`     └─ costura (coluna 0 vs W-1): ${(await seamX(textura.png)).toFixed(2)}/255`,
		);
	}

	const vetor = await runMode('vetorizavel', {
		mode: 'vetorizavel',
		prompt:
			'Um cavalo marinho ornamental, contorno fechado, sem preenchimento.',
		aspect: '1:1',
	});
	if (vetor) {
		const { data } = await sharp(vetor.png)
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const tons = new Set<number>();
		for (const v of data) tons.add(v);
		const pretos = data.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
		console.log(
			`     └─ tons distintos: ${tons.size} (${[...tons].join(', ')}) · ` +
				`${((pretos / data.length) * 100).toFixed(1)}% de traço`,
		);
	}
	process.exit(0);
}

main().catch((e) => {
	console.error('SMOKE_FAIL:', e?.message || e);
	process.exit(1);
});
