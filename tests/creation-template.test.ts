import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
	appendFormatHint,
	applyTemplateMask,
	buildFormatHint,
	templateSizePx,
} from '@/lib/creation-template.js';
import { bankEntryFormats, resolveFormat } from '@/lib/tool-creations.js';
import type { Creation, CreationTemplate } from '@/lib/tool-definitions.js';
import { ToolEngineError } from '@/lib/tool-errors.js';

/** iPhone em escala simples: 70 × 150 mm, câmera 30 × 30 no canto superior esquerdo. */
const iphone: CreationTemplate = {
	width_mm: 70,
	height_mm: 150,
	corner_radius_mm: 10,
	zones: [{ label: 'câmera', shape: 'rect', x: 5, y: 5, w: 30, h: 30, r: 6 }],
};

const capinha: Creation = {
	id: 'capinha',
	label: 'Capinha',
	width: 1080,
	height: 1920,
	models: [
		{ id: 'iphone-x', label: 'iPhone X', brand: 'Apple', template: iphone },
		{
			id: 'velho',
			label: 'Velho',
			active: false,
			template: { width_mm: 60, height_mm: 120 },
		},
	],
};
const quadro: Creation = {
	id: 'quadro',
	label: 'Quadro',
	width: 1500,
	height: 1500,
};
const doc = { creations: [capinha, quadro] };

async function alphaAt(png: Buffer, x: number, y: number): Promise<number> {
	const { data, info } = await sharp(png)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return data[(y * info.width + x) * info.channels + info.channels - 1];
}

describe('templateSizePx', () => {
	it('mantém o lado maior e tira o menor da proporção física', () => {
		expect(templateSizePx(iphone, 1920)).toEqual({ width: 896, height: 1920 });
		expect(templateSizePx({ width_mm: 200, height_mm: 90 }, 2000)).toEqual({
			width: 2000,
			height: 900,
		});
	});
});

describe('applyTemplateMask', () => {
	it('esvazia a câmera e os cantos, e mantém o miolo opaco', async () => {
		const { width, height } = templateSizePx(iphone, 600);
		const art = await sharp({
			create: { width, height, channels: 3, background: '#e11d48' },
		})
			.png()
			.toBuffer();
		const out = await applyTemplateMask(art, iphone);
		const sx = width / 70;
		const sy = height / 150;
		// meio da câmera (20mm, 20mm) → transparente
		expect(await alphaAt(out, Math.round(20 * sx), Math.round(20 * sy))).toBe(
			0,
		);
		// canto superior direito, dentro do raio → transparente
		expect(await alphaAt(out, width - 1, 0)).toBe(0);
		// miolo da capa → opaco
		expect(
			await alphaAt(out, Math.round(width / 2), Math.round(height * 0.7)),
		).toBe(255);
		const meta = await sharp(out).metadata();
		expect([meta.width, meta.height]).toEqual([width, height]);
	});

	it('elipse: fora do contorno sai transparente', async () => {
		const t: CreationTemplate = {
			width_mm: 50,
			height_mm: 50,
			outline: 'ellipse',
		};
		const art = await sharp({
			create: { width: 200, height: 200, channels: 4, background: '#000' },
		})
			.png()
			.toBuffer();
		const out = await applyTemplateMask(art, t);
		expect(await alphaAt(out, 2, 2)).toBe(0);
		expect(await alphaAt(out, 100, 100)).toBe(255);
	});
});

describe('buildFormatHint', () => {
	it('descreve a zona em porcentagem e posição', () => {
		const hint = buildFormatHint(iphone, { label: 'Capinha · iPhone X' });
		expect(hint).toContain('70 × 150 mm');
		expect(hint).toContain('câmera no canto superior esquerdo');
		expect(hint).toContain('de 7% a 50% da largura');
		expect(hint).toContain('cantos');
	});

	it('sem molde e sem dica: vazio (não mexe no prompt)', () => {
		expect(buildFormatHint(undefined)).toBe('');
		expect(appendFormatHint('gato', '')).toBe('gato');
	});

	it('nunca estoura o limite do bloco cortando o prompt do admin', () => {
		const prompt = 'x'.repeat(7_990);
		expect(appendFormatHint(prompt, 'y'.repeat(500))).toBe(prompt);
		expect(appendFormatHint('gato', 'dica').endsWith('dica')).toBe(true);
	});
});

describe('resolveFormat', () => {
	it('capinha com modelo: tamanho do molde, recorte e dica', () => {
		const f = resolveFormat(doc, 'capinha', 'iphone-x');
		expect(f.width).toBe(896);
		expect(f.height).toBe(1920);
		expect(f.mask).toBe(true);
		expect(f.template).toBe(iphone);
		expect(f.label).toBe('Capinha · iPhone X');
		expect(f.hint).toContain('câmera');
	});

	it('exige o modelo quando o formato tem biblioteca (400)', () => {
		expect(() => resolveFormat(doc, 'capinha', undefined)).toThrow(
			'Escolha o modelo.',
		);
		expect(() => resolveFormat(doc, 'capinha', 'velho')).toThrow(
			ToolEngineError,
		);
	});

	it('respeita os formatos permitidos pelo card', () => {
		expect(() => resolveFormat(doc, 'quadro', undefined, ['capinha'])).toThrow(
			'não está disponível',
		);
		expect(resolveFormat(doc, 'quadro', undefined, []).width).toBe(1500);
	});

	it('formato sem molde continua igual ao legado', () => {
		expect(resolveFormat(doc, 'quadro')).toEqual({
			width: 1500,
			height: 1500,
			template: undefined,
			mask: false,
			hint: '',
			label: 'Quadro',
		});
	});

	it('mask:false mantém só a instrução', () => {
		const caneca: Creation = {
			id: 'caneca',
			label: 'Caneca',
			width: 2000,
			height: 900,
			mask: false,
			template: {
				width_mm: 200,
				height_mm: 90,
				zones: [{ label: 'alça', shape: 'rect', x: 90, y: 0, w: 20, h: 90 }],
			},
		};
		const f = resolveFormat({ creations: [caneca] }, 'caneca');
		expect(f.mask).toBe(false);
		expect(f.hint).toContain('alça');
	});

	it('molde torto é recusado antes de cobrar', () => {
		const torto: Creation = {
			id: 't',
			label: 'T',
			width: 100,
			height: 100,
			template: {
				width_mm: 50,
				height_mm: 50,
				zones: [{ shape: 'rect', x: 40, y: 0, w: 20, h: 10 }],
			},
		};
		expect(() => resolveFormat({ creations: [torto] }, 't')).toThrow(
			'fora da peça',
		);
	});
});

describe('bankEntryFormats', () => {
	it('lê texto separado por vírgula (o que o admin grava)', () => {
		expect(bankEntryFormats({ formats: 'capinha, caneca-11oz,' })).toEqual([
			'capinha',
			'caneca-11oz',
		]);
	});

	it('lê só strings de data.formats', () => {
		expect(bankEntryFormats({ formats: ['a', 1, '', 'b'] })).toEqual([
			'a',
			'b',
		]);
		expect(bankEntryFormats({})).toEqual([]);
		expect(bankEntryFormats(null)).toEqual([]);
	});
});
