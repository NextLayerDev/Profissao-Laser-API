import { z } from 'zod';
import {
	laserPrep,
	MATERIAL_KEYS,
	MATERIAL_PRESETS,
	type MaterialKey,
} from '../../lib/laser-prep.js';
import {
	applyLut,
	buildLut,
	clamp8,
	type FxOutput,
	fxFromRaster,
	fxSharp,
	loadRaster,
} from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de GRAVAÇÃO LASER avançada (categoria `laser`) — port dos preparos de
 * fotogravação do ImagR/XCS pra `sharp`/raster. Reaproveita o motor 1-clique
 * (`laserPrep`) e os perfis de material (`MATERIAL_PRESETS`). Saída padrão de
 * filtro: `{ png, pngBase64 }` (o `oneClick` adiciona metadados físicos).
 */

const img = z.instanceof(Buffer);

/** Enum de materiais reaproveitando as chaves do motor 1-clique. */
const materialEnum = z.enum(MATERIAL_KEYS as unknown as [string, ...string[]]);

/** Bool tolerante a "true"/"1"/1/true (mesma coerção dos blocos de toggle). */
const bool = z
	.preprocess(
		(v) => v === true || v === 'true' || v === '1' || v === 1,
		z.boolean(),
	)
	.default(false);

/** Açúcar: define um bloco de laser com schema {image, ...P}. */
function block<P extends z.ZodRawShape>(
	id: string,
	description: string,
	shape: P,
	run: (
		params: z.infer<z.ZodObject<P & { image: typeof img }>>,
	) => Promise<FxOutput | Record<string, unknown>>,
): ToolBlock {
	const schema = z.object({ image: img, ...shape });
	return {
		id,
		category: 'laser',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ─────────────────────────── Gravação 1-Clique ─────────────────────────── */

export const oneClickBlock = block(
	'laser.oneClick',
	'Gravação 1-Clique: preparo completo (tom por material + resize físico + dithering).',
	{
		material: materialEnum.default('wood'),
		width_mm: z.coerce.number().min(1).max(2000).default(100),
		dpi: z.coerce
			.number()
			.int()
			.refine((v) => [203, 254, 300, 600].includes(v), {
				message: 'dpi deve ser 203, 254, 300 ou 600',
			})
			.default(254),
		noDither: bool,
		cleanBackground: bool,
	},
	async (p) => {
		// Delega ao motor de fotogravação (porte 1:1 do pipeline ImagR).
		const r = await laserPrep(p.image, {
			material: p.material as MaterialKey,
			width_mm: p.width_mm,
			dpi: p.dpi,
			noDither: p.noDither,
			cleanBackground: p.cleanBackground,
			bgMargin: 16,
		});
		return {
			png: r.pngBuffer,
			pngBase64: `data:image/png;base64,${r.pngBuffer.toString('base64')}`,
			width_mm: r.widthMm,
			height_mm: r.heightMm,
			dpi: r.dpi,
		};
	},
);

/* ─────────────────────────── Preset de material ─────────────────────────── */

/**
 * Curvas tonais nomeadas (presets de preparo p/ laser conhecidos). Cada algoritmo
 * é aproximado por uma LUT grayscale característica (gamma + S-curve/contraste).
 * `i` é o tom de entrada 0..255; devolve o tom de saída.
 */
const TONE_ALGORITHMS: Record<string, (i: number) => number> = {
	// old: linear suave — leve realce de contraste, sem distorção tonal.
	old: (i) => {
		const x = i / 255;
		const y = (x - 0.5) * 1.05 + 0.5;
		return y * 255;
	},
	// norton: alto contraste p/ azulejo — gamma ~0.8 + S forte.
	norton: (i) => {
		let x = (i / 255) ** (1 / 0.8); // gamma 0.8 → escurece meios
		const s = 3 * x * x - 2 * x * x * x; // smoothstep
		x = x + (s - x) * 0.6; // S forte
		return x * 255;
	},
	// co2: gamma ~1.2 médio — clareia levemente os meios-tons.
	co2: (i) => {
		const x = (i / 255) ** (1 / 1.2);
		return x * 255;
	},
	// co2v2: co2 + sharpen leve no tom (mais contraste de microtom).
	co2v2: (i) => {
		let x = (i / 255) ** (1 / 1.2);
		x = (x - 0.5) * 1.12 + 0.5; // contraste leve extra
		return x * 255;
	},
	// baning: realce de meios-tons — S médio + brilho.
	baning: (i) => {
		let x = i / 255;
		const s = 3 * x * x - 2 * x * x * x;
		x = x + (s - x) * 0.4; // S médio
		x += 0.06; // brilho
		return x * 255;
	},
	// marcin: contraste alto + sombras fundas (gamma <1 que afunda as sombras).
	marcin: (i) => {
		let x = (i / 255) ** (1 / 0.7); // afunda sombras
		x = (x - 0.5) * 1.4 + 0.5; // contraste alto
		return x * 255;
	},
	// sketch: quase line-art — limiar suave/alto contraste.
	sketch: (i) => {
		const x = i / 255;
		// sigmoide acentuada em torno do meio → quase binário, mas com transição.
		const y = 1 / (1 + Math.exp(-14 * (x - 0.5)));
		return y * 255;
	},
	// nero: escurece (gamma >1) — p/ materiais que gravam claro.
	nero: (i) => {
		const x = (i / 255) ** (1 / 1.6); // gamma 1.6 → escurece o geral
		return x * 255;
	},
	// kasia: suave clareando meios (gamma >1 leve, sem contraste).
	kasia: (i) => {
		const x = (i / 255) ** (1 / 1.3);
		return x * 255;
	},
	// skeldon: detalhe fino — contraste forte (o unsharp real é por convolução,
	// aqui a curva acentua o microtom pra preservar detalhe).
	skeldon: (i) => {
		let x = i / 255;
		x = (x - 0.5) * 1.35 + 0.5; // contraste forte
		const s = 3 * x * x - 2 * x * x * x;
		x = x + (s - x) * 0.25; // leve S de definição
		return x * 255;
	},
};

export const materialPresetBlock = block(
	'laser.materialPreset',
	'Preset de material: aplica uma curva tonal nomeada + grayscale + inversão do material.',
	{
		material: materialEnum.default('wood'),
		algorithm: z
			.enum([
				'old',
				'norton',
				'co2',
				'co2v2',
				'baning',
				'marcin',
				'sketch',
				'nero',
				'kasia',
				'skeldon',
			])
			.default('norton'),
	},
	async (p) => {
		const preset = MATERIAL_PRESETS[p.material as MaterialKey];
		const tone = TONE_ALGORITHMS[p.algorithm] ?? TONE_ALGORITHMS.old;
		// LUT = curva do algoritmo + inversão do material no fim (grava claro/escuro).
		const lut = buildLut((i) => {
			const v = clamp8(tone(i));
			return preset.invert ? 255 - v : v;
		});
		// Grayscale primeiro (Rec.709), depois aplica a curva na mão (sem dithering).
		const fxGray = await fxSharp(p.image, (s) => s.grayscale());
		const r = await loadRaster(fxGray.png);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── One-Touch ───────────────────────────── */

export const oneTouchBlock = block(
	'laser.oneTouch',
	'One-Touch: toggles rápidos (gama / remover ruído / nitidez) em cadeia.',
	{
		gamma: bool,
		denoise: bool,
		sharpen: bool,
	},
	(p) =>
		fxSharp(p.image, (s) => {
			let chain = s;
			if (p.gamma) chain = chain.gamma(1.4); // clareia meios-tons
			if (p.denoise) chain = chain.median(3); // remove sal-e-pimenta
			if (p.sharpen) chain = chain.sharpen(); // realça bordas
			return chain;
		}),
);

/* ─────────────────────────── Gravação em cristal ─────────────────────────── */

export const crystalEngravingBlock = block(
	'laser.crystalEngraving',
	'Gravação em cristal: prévia do mapa de profundidade (grayscale posterizado em camadas).',
	{
		depthLevels: z.coerce.number().int().min(2).max(16).default(8),
	},
	async (p) => {
		// Aprox. de gravação 3D em cristal: cada nível de cinza vira uma CAMADA de
		// profundidade. O arquivo XCS real (com Z por camada) é gerado no export
		// (output.export_*); aqui é só a PRÉVIA do mapa de profundidade.
		const n = p.depthLevels - 1;
		const lut = buildLut((i) =>
			Math.round((Math.round((i / 255) * n) / n) * 255),
		);
		const fxGray = await fxSharp(p.image, (s) => s.grayscale());
		const r = await loadRaster(fxGray.png);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

/** Todos os blocos de laser avançado, pra registro no index. */
export const laserExtraBlocks: ToolBlock[] = [
	oneClickBlock,
	materialPresetBlock,
	oneTouchBlock,
	crystalEngravingBlock,
];
