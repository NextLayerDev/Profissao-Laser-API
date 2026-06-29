/**
 * Smoke-test dos blocos ImagR: roda cada bloco registrado com uma imagem de
 * amostra e confere que a saída é um PNG válido. Uso:
 *   npx tsx scripts/smoke-imagr-blocks.ts
 */
import sharp from 'sharp';
import { blockRegistry, registerCoreBlocks } from '../src/tool-blocks/index.js';

registerCoreBlocks();

// Amostra 64×48 com gradiente colorido (exercita luma/convolução/integral).
async function sample(): Promise<Buffer> {
	const w = 64;
	const h = 48;
	const data = Buffer.allocUnsafe(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const p = (y * w + x) * 3;
			data[p] = (x / w) * 255;
			data[p + 1] = (y / h) * 255;
			data[p + 2] = 128;
		}
	}
	return sharp(data, { raw: { width: w, height: h, channels: 3 } })
		.png()
		.toBuffer();
}

// Params mínimos por bloco (usa defaults; só passa o que não tem default sensato).
const PARAMS: Record<string, Record<string, unknown>> = {
	'adjust.channelMixer': { rr: 0.9, gg: 0.9, bb: 0.9, rg: 0.1 },
	'laser.photoengrave': { material: 'wood', width_mm: 100 },
};

// Blocos que tocam rede/IA/storage — não entram no smoke local.
const NETWORK = new Set([
	'ai.generate_image',
	'ai.backgroundRemoval',
	'ai.colorize',
	'ai.restoration',
	'output.upload_png',
	'output.upload_svg',
	'output.export_dxf',
	'output.export_lbrn2',
	'util.http_request',
	'util.text_template',
	'util.math',
	'util.condition',
]);
// Blocos cujo input é `from` (não `image`).
const NEEDS_FROM = new Set(['image.input', 'output.return_base64']);
// Blocos sem imagem de entrada.
const NO_IMAGE = new Set(['util.dpiTest']);

async function isPng(out: Record<string, unknown>): Promise<boolean> {
	const png = (out.png ?? out.buffer) as Buffer | undefined;
	if (!Buffer.isBuffer(png)) {
		// blocos que só devolvem base64/dataUrl/svg/url também contam como ok
		return (
			typeof out.pngBase64 === 'string' ||
			typeof out.dataUrl === 'string' ||
			typeof out.svg === 'string' ||
			typeof out.url === 'string'
		);
	}
	const meta = await sharp(png).metadata();
	return (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0;
}

async function main() {
	const buf = await sample();
	const ctx = { customerId: 'smoke' };
	const ids = blockRegistry.keys().filter((id) => !NETWORK.has(id));
	let ok = 0;
	let fail = 0;
	for (const id of ids) {
		const block = blockRegistry.get(id);
		if (!block) continue;
		const params = NO_IMAGE.has(id)
			? { ...(PARAMS[id] ?? {}) }
			: NEEDS_FROM.has(id)
				? { from: buf, ...(PARAMS[id] ?? {}) }
				: { image: buf, ...(PARAMS[id] ?? {}) };
		const parsed = block.paramsSchema.safeParse(params);
		if (!parsed.success) {
			console.error(`✗ ${id}: schema — ${parsed.error.issues[0]?.message}`);
			fail++;
			continue;
		}
		try {
			const out = await block.run(ctx, parsed.data);
			if (await isPng(out)) {
				ok++;
				console.log(`✓ ${id}`);
			} else {
				fail++;
				console.error(`✗ ${id}: saída sem PNG/base64 válido`);
			}
		} catch (e) {
			fail++;
			console.error(`✗ ${id}: ${(e as Error).message}`);
		}
	}
	console.log(`\n== smoke == ok=${ok} fail=${fail} (de ${ids.length})`);
	process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
