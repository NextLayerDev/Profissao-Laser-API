/**
 * Smoke do MOTOR ponta-a-ponta (coerceInputs → refs → pipeline → projeção de
 * saída) com definições no MESMO formato do seed (image.input → op →
 * return_base64). Valida a fiação (refs 'in.buffer'/'input.<name>'). Uso:
 *   npx tsx scripts/smoke-imagr-engine.ts
 */
import sharp from 'sharp';
import { coerceInputs, executeTool } from '../src/lib/tool-engine.js';
import { registerCoreBlocks } from '../src/tool-blocks/index.js';

registerCoreBlocks();

async function sample(): Promise<Buffer> {
	const w = 48;
	const h = 36;
	const data = Buffer.allocUnsafe(w * h * 3);
	for (let i = 0; i < w * h; i++) {
		data[i * 3] = (i * 5) % 255;
		data[i * 3 + 1] = (i * 3) % 255;
		data[i * 3 + 2] = 100;
	}
	return sharp(data, { raw: { width: w, height: h, channels: 3 } })
		.png()
		.toBuffer();
}

// biome-ignore lint/suspicious/noExplicitAny: definição dinâmica de teste
function def(block: string, input: any, opParams: any, hasImage = true): any {
	const pipeline: any[] = [];
	if (hasImage)
		pipeline.push({
			id: 'in',
			block: 'image.input',
			params: { from: 'input.image' },
		});
	pipeline.push({ id: 'op', block, params: opParams });
	pipeline.push({
		id: 'out',
		block: 'output.return_base64',
		params: { from: 'op.png' },
	});
	return {
		input,
		pipeline,
		output: { preview: 'op.pngBase64', primary: 'out.dataUrl' },
	};
}

const IMG = { type: 'image', required: true, accept: ['png'] };

async function main() {
	const buf = await sample();
	const ctx = { customerId: 'smoke' };
	const cases: { name: string; def: any; fields: any; files: any }[] = [
		{
			name: 'adjust.gamma',
			def: def(
				'adjust.gamma',
				{ image: IMG, value: { type: 'number', default: 1, min: 0.1, max: 3 } },
				{ image: 'in.buffer', value: 'input.value' },
			),
			fields: { value: '1.5' },
			files: { image: buf },
		},
		{
			name: 'laser.materialPreset',
			def: def(
				'laser.materialPreset',
				{
					image: IMG,
					material: { type: 'enum', options: ['wood'], default: 'wood' },
					algorithm: { type: 'enum', options: ['norton'], default: 'norton' },
				},
				{
					image: 'in.buffer',
					material: 'input.material',
					algorithm: 'input.algorithm',
				},
			),
			fields: { material: 'wood', algorithm: 'norton' },
			files: { image: buf },
		},
		{
			name: 'stylize.duotone',
			def: def(
				'stylize.duotone',
				{
					image: IMG,
					shadowColor: { type: 'string', default: '#1a1a2e' },
					highlightColor: { type: 'string', default: '#e94560' },
					intensity: { type: 'number', default: 1, min: 0, max: 1 },
				},
				{
					image: 'in.buffer',
					shadowColor: 'input.shadowColor',
					highlightColor: 'input.highlightColor',
					intensity: 'input.intensity',
				},
			),
			fields: {
				shadowColor: '#101820',
				highlightColor: '#e0a040',
				intensity: '1',
			},
			files: { image: buf },
		},
		{
			name: 'util.dpiTest (sem imagem)',
			def: def(
				'util.dpiTest',
				{ dpi: { type: 'int', default: 254, min: 72, max: 1200 } },
				{ dpi: 'input.dpi' },
				false,
			),
			fields: { dpi: '254' },
			files: {},
		},
	];

	let ok = 0;
	for (const c of cases) {
		try {
			const bag = coerceInputs(c.def.input, c.fields, c.files);
			const out = await executeTool(c.def, bag, ctx);
			const okOut =
				typeof out.preview === 'string' &&
				out.preview.startsWith('data:image') &&
				typeof out.primary === 'string' &&
				out.primary.startsWith('data:');
			if (okOut) {
				ok++;
				console.log(`✓ ${c.name}`);
			} else {
				console.error(
					`✗ ${c.name}: saída inesperada ${JSON.stringify(Object.keys(out))}`,
				);
			}
		} catch (e) {
			console.error(`✗ ${c.name}: ${(e as Error).message}`);
		}
	}
	console.log(`\n== motor == ok=${ok}/${cases.length}`);
	process.exit(ok === cases.length ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
