import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
	guiaDeLayout,
	type LayoutPrompt,
	layoutEfetivo,
	medirLarguraProduto,
} from '../src/lib/previa-layout.js';
import { generatePrompt } from '../src/lib/previa-prompt.js';
import {
	type LaserSettings,
	laserSettingsSchema,
} from '../src/types/previa.js';

/**
 * Layout marcado pelo aluno no editor da Prévia: sem ele a prévia segue
 * automática; com ele a marcação manda — e o prompt não pode mandar o modelo
 * para dois lugares ao mesmo tempo.
 */

const BASE: LaserSettings = {
	tamanho: 'medio',
	posicao: 'central',
	rotacao: 0,
	intensidade: 'media',
	profundidade: 'media',
	comNome: 'com',
	nomePersonalizado: '',
	fonteFamilia: 'arial',
	tamanhoNome: 'medio',
	orientacaoLogo: 'horizontal',
	orientacaoNome: 'horizontal',
	material: 'aco-inox',
	estiloGravacao: 'clean',
	acabamentoSuperficie: 'fosco',
	contraste: 50,
	efeitoSombra: 30,
	moldura: 'nenhuma',
	posicaoTextoRelLogo: 'abaixo',
	espacamentoLogoTexto: 'medio',
	tipoVisualizacao: 'frontal-padrao',
	anguloCamera: 'frontal',
	iluminacao: 'studio-softbox',
	fundoCena: 'cinza-gradiente',
	apenasTexto: false,
	modoLentes: false,
	textoLenteDireita: '',
	textoLenteEsquerda: '',
};

const LOGO = { x: 0.5, y: 0.4, w: 0.2, h: 0.2, rot: 0 };
const TEXTO = { x: 0.5, y: 0.62, w: 0.3, h: 0.06, rot: -10 };
const TEXTO2 = { x: 0.5, y: 0.75, w: 0.25, h: 0.05, rot: 0 };

const sem = { hasLogo: true, texto: 'Ana', texto2: '', modoLentes: false };

describe('schema', () => {
	it('layout é opcional (front antigo continua válido)', () => {
		expect(laserSettingsSchema.safeParse(BASE).success).toBe(true);
	});

	it('aceita layout com caixas válidas e recusa fora de 0–1', () => {
		const ok = laserSettingsSchema.safeParse({
			...BASE,
			layout: { logo: LOGO, texto: TEXTO },
			texto2: 'Desde 2020',
		});
		expect(ok.success).toBe(true);
		const ruim = laserSettingsSchema.safeParse({
			...BASE,
			layout: { logo: { ...LOGO, x: 1.4 } },
		});
		expect(ruim.success).toBe(false);
	});
});

describe('layoutEfetivo', () => {
	it('sem layout ⇒ automático', () => {
		expect(layoutEfetivo(BASE, sem)).toBeNull();
	});

	it('só vale a caixa do elemento que existe nesta geração', () => {
		const s = { ...BASE, layout: { logo: LOGO, texto: TEXTO, texto2: TEXTO2 } };
		expect(layoutEfetivo(s, { ...sem, texto: '' })).toEqual({
			logo: LOGO,
			texto: null,
			texto2: null,
		});
		expect(layoutEfetivo(s, { ...sem, hasLogo: false, texto2: 'x' })).toEqual({
			logo: null,
			texto: TEXTO,
			texto2: TEXTO2,
		});
	});

	it('modo lentes e envolvente 360° ignoram o layout', () => {
		const s = { ...BASE, layout: { logo: LOGO } };
		expect(layoutEfetivo(s, { ...sem, modoLentes: true })).toBeNull();
		expect(layoutEfetivo({ ...s, posicao: 'envolvente-360' }, sem)).toBeNull();
	});
});

function prompt(layout: LayoutPrompt | null, s: LaserSettings = BASE) {
	return generatePrompt(
		'Copo Térmico',
		s,
		true,
		'Ana',
		null,
		false,
		undefined,
		undefined,
		'none',
		'Preto',
		layout,
	);
}

describe('prompt', () => {
	const layout: LayoutPrompt = {
		caixas: { logo: LOGO, texto: TEXTO, texto2: TEXTO2 },
		guideIdx: 3,
		produtoLargura: 0.5,
		texto: 'Ana',
		texto2: 'Desde 2020',
	};

	it('sem layout o prompt automático fica como estava', () => {
		const p = prompt(null);
		expect(p).toContain('CRITICAL - EXACT LOGO POSITIONING');
		expect(p).toContain('SIZE REFERENCE GUIDE');
		expect(p).not.toContain('USER-DEFINED LAYOUT');
		expect(p).not.toContain('placement guide');
	});

	it('com layout troca os blocos automáticos pela marcação', () => {
		const p = prompt(layout, { ...BASE, rotacao: 45, posicao: 'superior' });
		expect(p).toContain('USER-DEFINED LAYOUT');
		expect(p).toContain('[3] placement guide');
		// nada de posição/tamanho/rotação automáticos competindo com a caixa
		expect(p).not.toContain('CRITICAL - EXACT LOGO POSITIONING');
		expect(p).not.toContain('VISUAL POSITIONING GUIDE');
		expect(p).not.toContain('SIZE REFERENCE GUIDE');
		expect(p).not.toContain('Rotation:   45°');
		expect(p).not.toContain('UPPER THIRD');
		// texto sai da regra "abaixo da logo" e vai para a caixa laranja
		expect(p).toContain('EXACTLY inside the ORANGE box');
		expect(p).not.toContain('TEXT SIZE SPECIFICATIONS');
	});

	it('cada caixa vira coordenadas, % do produto e giro', () => {
		const p = prompt(layout);
		expect(p).toContain(
			'LOGO (image [2]) → the CYAN rectangle on guide [3]: centered 50% from the left and 40% from the top of photo [1], 20% of the image width by 20% of its height (≈40% of the product width), no rotation (upright).',
		);
		expect(p).toContain('TEXT 1 "Ana" → the ORANGE rectangle');
		expect(p).toContain('rotated 10° counter-clockwise');
		expect(p).toContain('TEXT 2 "Desde 2020" → the MAGENTA rectangle');
		expect(p).toContain('The elements are SEPARATE');
		expect(p).toContain('NEVER appear in the output');
	});

	it('caixa pequena ganha o aviso contra aumentar a arte', () => {
		const p = prompt({
			...layout,
			caixas: { logo: { ...LOGO, w: 0.1 }, texto: null, texto2: null },
		});
		expect(p).toContain('must look clearly SMALL');
		expect(p).not.toContain('The elements are SEPARATE');
	});
});

async function fotoDeProduto(): Promise<string> {
	// fundo branco liso, "produto" cinza de 40% da largura no meio
	const W = 400;
	const H = 400;
	const produto = await sharp({
		create: { width: 160, height: 300, channels: 3, background: '#555555' },
	})
		.png()
		.toBuffer();
	const png = await sharp({
		create: { width: W, height: H, channels: 3, background: '#ffffff' },
	})
		.composite([{ input: produto, left: 120, top: 50 }])
		.png()
		.toBuffer();
	return png.toString('base64');
}

describe('imagem-guia', () => {
	it('mede a largura do produto em fundo liso', async () => {
		const w = await medirLarguraProduto(await fotoDeProduto());
		expect(w).toBeCloseTo(0.4, 1);
	});

	it('desenha as caixas nas cores do prompt, no lugar marcado', async () => {
		const b64 = await guiaDeLayout(
			await fotoDeProduto(),
			{ logo: LOGO, texto: TEXTO, texto2: null },
			0.4,
		);
		const { data, info } = await sharp(Buffer.from(b64, 'base64'))
			.raw()
			.toBuffer({ resolveWithObject: true });
		const px = (x: number, y: number) => {
			const i =
				(Math.round(y * info.height) * info.width +
					Math.round(x * info.width)) *
				info.channels;
			return [data[i], data[i + 1], data[i + 2]];
		};
		// centro da caixa da logo: cinza do produto tingido de ciano
		const [r, g, b] = px(LOGO.x, LOGO.y);
		expect(b).toBeGreaterThan(r + 30);
		expect(g).toBeGreaterThan(r + 30);
		// centro da caixa do texto: laranja (vermelho > azul)
		const [r2, , b2] = px(TEXTO.x, TEXTO.y);
		expect(r2).toBeGreaterThan(b2 + 30);
		// fora das caixas a foto fica intacta
		expect(px(0.05, 0.95)).toEqual([255, 255, 255]);
	});
});
