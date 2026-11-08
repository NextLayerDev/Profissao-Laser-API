import sharp from 'sharp';
import type { LaserSettings } from '../types/previa.js';

// Layout marcado pelo aluno sobre a foto do produto (editor da Prévia).
// Tudo normalizado de 0 a 1 em relação à foto [1]: x, y = centro da caixa;
// w, h = tamanho ANTES da rotação; rot em graus, sentido horário.
// Sem layout a prévia segue automática (tamanho/posição/rotação de sempre).

export interface CaixaLayout {
	x: number;
	y: number;
	w: number;
	h: number;
	rot: number;
}

export interface LayoutEfetivo {
	logo: CaixaLayout | null;
	texto: CaixaLayout | null;
	texto2: CaixaLayout | null;
}

/** O que o prompt precisa saber do layout (ver `generatePrompt`). */
export interface LayoutPrompt {
	caixas: LayoutEfetivo;
	/** Índice da imagem-guia na mensagem ([n]). */
	guideIdx: number;
	/** Largura do produto na foto (0..1), quando deu para medir. */
	produtoLargura: number | null;
	texto: string;
	texto2: string;
}

/** Largura do produto na foto quando não dá para medir (copo típico). */
const PRODUTO_LARGURA_ASSUMIDA = 0.45;

/**
 * Caixas que realmente valem: só as dos elementos que existem nesta geração.
 * Modo lentes (texto por lente) e envolvente 360° têm posição própria e
 * ignoram o layout. Sem nenhuma caixa válida → null (automático).
 */
export function layoutEfetivo(
	s: LaserSettings,
	c: { hasLogo: boolean; texto: string; texto2: string; modoLentes: boolean },
): LayoutEfetivo | null {
	const l = s.layout;
	if (!l || c.modoLentes || s.posicao === 'envolvente-360') return null;
	const efetivo: LayoutEfetivo = {
		logo: c.hasLogo ? (l.logo ?? null) : null,
		texto: c.texto ? (l.texto ?? null) : null,
		texto2: c.texto2 ? (l.texto2 ?? null) : null,
	};
	return efetivo.logo || efetivo.texto || efetivo.texto2 ? efetivo : null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function giro(rot: number): string {
	const g = Math.round(rot);
	if (g === 0) return 'no rotation (upright)';
	return `rotated ${Math.abs(g)}° ${g > 0 ? 'clockwise' : 'counter-clockwise'}`;
}

/** Largura da caixa em % da largura do produto (não da foto). */
export function fracaoDoProduto(w: number, produtoLargura: number | null) {
	const base = produtoLargura && produtoLargura > 0 ? produtoLargura : null;
	return Math.min(1, w / (base ?? PRODUTO_LARGURA_ASSUMIDA));
}

/**
 * Bloco do prompt com o layout do aluno. Substitui os blocos de posição e
 * tamanho automáticos: a marcação manda. Cada elemento vai na sua caixa da
 * imagem-guia, com coordenadas em texto como reforço.
 */
export function layoutPromptLines(l: LayoutPrompt): string[] {
	const { caixas: c, guideIdx: g } = l;
	const linhas: string[] = [];
	const caixa = (
		papel: string,
		cor: string,
		b: CaixaLayout,
		conteudo: string,
	) => {
		const doProduto = Math.round(fracaoDoProduto(b.w, l.produtoLargura) * 100);
		linhas.push(
			`• ${papel} → the ${cor} rectangle on guide [${g}]: centered ${pct(b.x)} from the left and ${pct(b.y)} from the top of photo [1], ${pct(b.w)} of the image width by ${pct(b.h)} of its height (≈${doProduto}% of the product width), ${giro(b.rot)}. ${conteudo}`,
		);
		if (doProduto <= 35) {
			linhas.push(
				`  ${papel} must look clearly SMALL and discreet, with plenty of empty product surface around it. Image models tend to OVERSIZE small elements: if in doubt go smaller, never larger.`,
			);
		}
	};
	const TEXTO_NA_CAIXA =
		'Set the text centered in that box, as large as fits without overflowing, with the same orientation as the box; keep it on a single line when the box is wide.';

	linhas.push('🎯 USER-DEFINED LAYOUT (HIGHEST PRIORITY FOR PLACEMENT):');
	linhas.push(
		`Image [${g}] is a PLACEMENT GUIDE: photo [1] with colored rectangles marking where each element goes. The student placed them by hand — this overrides every default position, size and rotation in this prompt.`,
	);
	linhas.push(
		`The guide is reference ONLY: the colored rectangles${l.produtoLargura ? ', the green dashed line' : ''} and their fills NEVER appear in the output.`,
	);
	if (l.produtoLargura && c.logo) {
		linhas.push(
			'The GREEN dashed line on the guide is the full product width — keep exactly the proportion between it and each rectangle.',
		);
	}
	if (c.logo) {
		caixa(
			'LOGO (image [2])',
			'CYAN',
			c.logo,
			'The logo fills that box keeping its own aspect ratio — never stretched.',
		);
	}
	if (c.texto) {
		caixa(`TEXT 1 "${l.texto}"`, 'ORANGE', c.texto, TEXTO_NA_CAIXA);
	}
	if (c.texto2) {
		caixa(
			`TEXT 2 "${l.texto2}"`,
			'MAGENTA',
			c.texto2,
			`${TEXTO_NA_CAIXA} Same font and engraving finish as the other text.`,
		);
	}
	const n = [c.logo, c.texto, c.texto2].filter(Boolean).length;
	if (n > 1) {
		linhas.push(
			'The elements are SEPARATE, each at its own spot: not a lockup. Add nothing between them and do not move one to sit next to another.',
		);
	}
	linhas.push(
		'Keep those same physical spots on the product (e.g. upper body, near the base, on the handle side) even if the final camera angle or framing differs from photo [1]. Never move or re-proportion the product to make room.',
	);
	return linhas;
}

/**
 * Largura do produto na foto (0..1) pela caixa que sobra ao cortar o fundo
 * liso. Null quando a medição não é confiável (fundo com textura/cena).
 */
export async function medirLarguraProduto(b64: string): Promise<number | null> {
	try {
		const input = Buffer.from(b64, 'base64');
		const W = (await sharp(input).metadata()).width ?? 0;
		if (!W) return null;
		const { info } = await sharp(input)
			.trim({ threshold: 25 })
			.toBuffer({ resolveWithObject: true });
		const frac = info.width / W;
		return frac > 0.1 && frac < 0.95 ? frac : null;
	} catch {
		return null;
	}
}

const LADO_GUIA = 1024;

/**
 * Imagem-guia: a foto do produto com as caixas do layout desenhadas como
 * retângulos girados (ciano = logo, laranja = texto 1, magenta = texto 2) e,
 * se medida, a cota verde da largura do produto. Devolve base64 de PNG.
 */
export async function guiaDeLayout(
	productB64: string,
	caixas: LayoutEfetivo,
	produtoLargura: number | null,
): Promise<string> {
	const input = await sharp(Buffer.from(productB64, 'base64'))
		.resize(LADO_GUIA, LADO_GUIA, { fit: 'inside', withoutEnlargement: true })
		.toBuffer();
	const meta = await sharp(input).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	if (!W || !H) throw new Error('Formato de imagem não suportado');

	const stroke = Math.max(3, Math.round(Math.min(W, H) * 0.006));
	const ret = (r: CaixaLayout, fill: string, line: string) => {
		const cx = r.x * W;
		const cy = r.y * H;
		const w = r.w * W;
		const h = r.h * H;
		return `<g transform="rotate(${r.rot} ${cx} ${cy})"><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="${fill}" stroke="${line}" stroke-width="${stroke}"/></g>`;
	};
	let cota = '';
	const ref = caixas.logo ?? caixas.texto ?? caixas.texto2;
	if (produtoLargura && ref) {
		const pw = produtoLargura * W;
		const y = Math.max(
			stroke * 5,
			(ref.y - ref.h / 2) * H - Math.min(W, H) * 0.04,
		);
		const x1 = W / 2 - pw / 2;
		const x2 = W / 2 + pw / 2;
		cota = `<g stroke="#00C853" stroke-width="${stroke}" stroke-dasharray="${stroke * 3} ${stroke * 2}" fill="none"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - stroke * 4}" x2="${x1}" y2="${y + stroke * 4}"/><line x1="${x2}" y1="${y - stroke * 4}" x2="${x2}" y2="${y + stroke * 4}"/></g>`;
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${cota}${caixas.logo ? ret(caixas.logo, 'rgba(0,229,255,0.28)', '#00E5FF') : ''}${caixas.texto ? ret(caixas.texto, 'rgba(255,152,0,0.30)', '#FF9800') : ''}${caixas.texto2 ? ret(caixas.texto2, 'rgba(213,0,249,0.28)', '#D500F9') : ''}</svg>`;

	const png = await sharp(input)
		.composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
		.png({ compressionLevel: 6 })
		.toBuffer();
	return png.toString('base64');
}
