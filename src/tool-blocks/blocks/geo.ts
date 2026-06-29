import sharp from 'sharp';
import { z } from 'zod';
import {
	clamp8,
	type FxOutput,
	fxFromRaster,
	fxSharp,
	loadRaster,
} from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de GEOMETRIA/IMAGEM (categoria `geo`) — port do grupo "Geometry" do
 * ImagR (crop / resize / rotate / flip / tile / border / perspective / skew /
 * text). Preferem `sharp` nativo (extract/resize/rotate/affine/extend/composite);
 * efeitos por pixel (edgeFade) caem no raster RGBA. Saída padrão: `{png,pngBase64}`.
 */

const img = z.instanceof(Buffer);
const _num = (def: number) => z.coerce.number().default(def);
/** Booleano tolerante a "true"/"1"/1. */
const bool = (def: boolean) =>
	z
		.preprocess(
			(v) => v === true || v === 'true' || v === '1' || v === 1,
			z.boolean(),
		)
		.default(def);

/** Açúcar: define um bloco de geometria com schema {image, ...P}. category=geo. */
function block<P extends z.ZodRawShape>(
	id: string,
	description: string,
	shape: P,
	run: (
		params: z.infer<z.ZodObject<P & { image: typeof img }>>,
	) => Promise<FxOutput>,
): ToolBlock {
	const schema = z.object({ image: img, ...shape });
	return {
		id,
		category: 'geo',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/** Lê dimensões via metadata (fallback 1×1 se faltar). */
async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
	const meta = await sharp(buf).metadata();
	return { w: meta.width ?? 1, h: meta.height ?? 1 };
}

/* ───────────────────────────── Transformações ───────────────────────────── */

export const cropBlock = block(
	'geo.crop',
	'Recorte por porcentagem do tamanho (x,y = canto; w,h = tamanho).',
	{
		xPct: z.coerce.number().min(0).max(100).default(0),
		yPct: z.coerce.number().min(0).max(100).default(0),
		wPct: z.coerce.number().min(1).max(100).default(100),
		hPct: z.coerce.number().min(1).max(100).default(100),
	},
	async (p) => {
		const { w, h } = await dims(p.image);
		// px e clamp pra ficar dentro dos limites da imagem.
		let left = Math.round((p.xPct / 100) * w);
		let top = Math.round((p.yPct / 100) * h);
		left = Math.min(Math.max(0, left), w - 1);
		top = Math.min(Math.max(0, top), h - 1);
		const width = Math.min(
			Math.max(1, Math.round((p.wPct / 100) * w)),
			w - left,
		);
		const height = Math.min(
			Math.max(1, Math.round((p.hPct / 100) * h)),
			h - top,
		);
		return fxSharp(p.image, (s) => s.extract({ left, top, width, height }));
	},
);

export const resizeBlock = block(
	'geo.resize',
	'Redimensiona pra uma largura (mantendo proporção ou quadrado).',
	{
		width: z.coerce.number().int().min(1).max(8000).default(800),
		keepAspect: bool(true),
	},
	(p) =>
		fxSharp(p.image, (s) => s.resize(p.width, p.keepAspect ? null : p.width)),
);

export const scaleBlock = block(
	'geo.scale',
	'Escala por fator (0.1 a 4): multiplica largura e altura.',
	{ factor: z.coerce.number().min(0.1).max(4).default(1) },
	async (p) => {
		const { w, h } = await dims(p.image);
		const nw = Math.max(1, Math.round(w * p.factor));
		const nh = Math.max(1, Math.round(h * p.factor));
		return fxSharp(p.image, (s) => s.resize(nw, nh));
	},
);

export const rotateBlock = block(
	'geo.rotate',
	'Rotaciona (-180 a 180 graus) preenchendo o fundo com a cor dada.',
	{
		angle: z.coerce.number().min(-180).max(180).default(0),
		bg: z.string().default('#ffffff'),
	},
	(p) => fxSharp(p.image, (s) => s.rotate(p.angle, { background: p.bg })),
);

export const flipBlock = block(
	'geo.flip',
	'Espelha horizontal (flop) e/ou vertical (flip).',
	{ horizontal: bool(true), vertical: bool(false) },
	(p) =>
		fxSharp(p.image, (s) => {
			let out = s;
			if (p.horizontal) out = out.flop();
			if (p.vertical) out = out.flip();
			return out;
		}),
);

export const tileBlock = block(
	'geo.tile',
	'Repete a imagem numa grade cols×rows (mantém o tamanho original).',
	{
		cols: z.coerce.number().int().min(1).max(10).default(2),
		rows: z.coerce.number().int().min(1).max(10).default(2),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		// Cada célula é a imagem reduzida pra (w/cols, h/rows); compõe via raster.
		const cw = Math.max(1, Math.floor(w / p.cols));
		const ch = Math.max(1, Math.floor(h / p.rows));
		const cellPng = await sharp(
			Buffer.from(src.buffer, src.byteOffset, src.byteLength),
			{ raw: { width: w, height: h, channels: 4 } },
		)
			.resize(cw, ch, { fit: 'fill' })
			.raw()
			.toBuffer();
		const out = new Uint8ClampedArray(w * h * 4);
		for (let cy = 0; cy < p.rows; cy++) {
			for (let cx = 0; cx < p.cols; cx++) {
				const offX = cx * cw;
				const offY = cy * ch;
				for (let y = 0; y < ch; y++) {
					const dy = offY + y;
					if (dy >= h) break;
					for (let x = 0; x < cw; x++) {
						const dx = offX + x;
						if (dx >= w) break;
						const sp = (y * cw + x) * 4;
						const dp = (dy * w + dx) * 4;
						out[dp] = cellPng[sp];
						out[dp + 1] = cellPng[sp + 1];
						out[dp + 2] = cellPng[sp + 2];
						out[dp + 3] = cellPng[sp + 3];
					}
				}
			}
		}
		return fxFromRaster({ data: out, width: w, height: h, channels: 4 });
	},
);

export const borderBlock = block(
	'geo.border',
	'Adiciona uma moldura sólida de N pixels ao redor.',
	{
		size: z.coerce.number().int().min(0).max(200).default(20),
		color: z.string().default('#000000'),
	},
	(p) =>
		fxSharp(p.image, (s) =>
			s.extend({
				top: p.size,
				bottom: p.size,
				left: p.size,
				right: p.size,
				background: p.color,
			}),
		),
);

export const edgeFadeBlock = block(
	'geo.edgeFade',
	'Desvanece as bordas pra transparente (vinheta no canal alpha).',
	{ size: z.coerce.number().int().min(0).max(200).default(40) },
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: d } = r;
		const fade = Math.min(p.size, Math.floor(Math.min(w, h) / 2));
		if (fade <= 0) return fxFromRaster(r);
		for (let y = 0; y < h; y++) {
			// distância às bordas vertical/horizontal → fator de opacidade [0,1].
			const dy = Math.min(y, h - 1 - y);
			const fy = dy >= fade ? 1 : dy / fade;
			for (let x = 0; x < w; x++) {
				const dx = Math.min(x, w - 1 - x);
				const fx = dx >= fade ? 1 : dx / fade;
				const f = Math.min(fx, fy);
				if (f < 1) {
					const q = (y * w + x) * 4 + 3;
					d[q] = clamp8(d[q] * f);
				}
			}
		}
		return fxFromRaster(r);
	},
);

export const perspectiveBlock = block(
	'geo.perspective',
	'Perspectiva (aprox.): cisalhamento via affine simulando inclinação.',
	{
		horizontal: z.coerce.number().min(-0.4).max(0.4).default(0),
		vertical: z.coerce.number().min(-0.4).max(0.4).default(0),
	},
	// aprox.: perspectiva real exige mapa não-linear; aqui usamos shear afim.
	(p) =>
		fxSharp(p.image, (s) =>
			s.affine([1, p.horizontal, p.vertical, 1], { background: '#ffffff' }),
		),
);

export const skewBlock = block(
	'geo.skew',
	'Cisalhamento (skew) em X e Y via transformação afim.',
	{
		skewX: z.coerce.number().min(-0.5).max(0.5).default(0),
		skewY: z.coerce.number().min(-0.5).max(0.5).default(0),
	},
	(p) =>
		fxSharp(p.image, (s) =>
			s.affine([1, p.skewX, p.skewY, 1], { background: '#ffffff' }),
		),
);

export const addTextBlock = block(
	'geo.addText',
	'Compõe um texto sobre a imagem na posição x,y (% do tamanho).',
	{
		text: z.string().default('Texto'),
		size: z.coerce.number().int().min(8).max(200).default(48),
		color: z.string().default('#000000'),
		x: z.coerce.number().min(0).max(100).default(50),
		y: z.coerce.number().min(0).max(100).default(50),
	},
	async (p) => {
		const { w, h } = await dims(p.image);
		// escapa pro SVG e estima a largura do texto (aprox. 0.6em por caractere).
		const safe = p.text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
		// clampa a caixa de texto pra nunca exceder a imagem (composite exige
		// overlay menor/igual). aprox.: largura estimada por caractere.
		const tw = Math.min(w, Math.ceil(safe.length * p.size * 0.6) + 4);
		const th = Math.min(h, Math.ceil(p.size * 1.4));
		const baseline = Math.min(p.size, th - 2);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}"><text x="0" y="${baseline}" font-family="sans-serif" font-size="${p.size}" fill="${p.color}">${safe}</text></svg>`;
		// centraliza o bloco de texto no ponto x,y e clampa dentro da imagem.
		let left = Math.round((p.x / 100) * w - tw / 2);
		let top = Math.round((p.y / 100) * h - th / 2);
		left = Math.min(Math.max(0, left), Math.max(0, w - tw));
		top = Math.min(Math.max(0, top), Math.max(0, h - th));
		return fxSharp(p.image, (s) =>
			s.composite([{ input: Buffer.from(svg), top, left }]),
		);
	},
);

/** Todos os blocos de geometria, pra registro no index. */
export const geoBlocks: ToolBlock[] = [
	cropBlock,
	resizeBlock,
	scaleBlock,
	rotateBlock,
	flipBlock,
	tileBlock,
	borderBlock,
	edgeFadeBlock,
	perspectiveBlock,
	skewBlock,
	addTextBlock,
];
