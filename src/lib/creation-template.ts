import sharp from 'sharp';
import type {
	Creation,
	CreationModel,
	CreationTemplate,
	CreationZone,
} from './tool-definitions.js';

/**
 * MOLDE DE UM FORMATO — a peça física por trás de um "Tipo de Criação".
 *
 * ┌─ POR QUE ISTO EXISTE ───────────────────────────────────────────────────┐
 * │ O formato era só um retângulo em px. O aluno pedia uma capinha e        │
 * │ recebia uma arte 9:16 qualquer: proporção de story, não a do iPhone     │
 * │ dele, e um rosto bem em cima da câmera. Quem grava/imprime tinha de     │
 * │ redesenhar o recorte à mão — exatamente o trabalho que a ferramenta     │
 * │ existe para tirar das costas dele.                                      │
 * │                                                                          │
 * │ O molde descreve a peça em MILÍMETROS (é como o fornecedor passa a       │
 * │ medida): o contorno (retângulo com cantos arredondados ou elipse) e as   │
 * │ zonas proibidas (câmera, alça da caneca, furo do chaveiro). Dele saem    │
 * │ três coisas, todas aqui: a proporção certa da arte, a instrução para a   │
 * │ IA deixar as zonas livres, e a máscara aplicada depois — porque modelo   │
 * │ de imagem não obedece geometria; a máscara obedece.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Coordenadas: origem no canto superior esquerdo da FACE da peça, vista de
 * frente (a capinha vista por trás, como o aluno a segura virada).
 */

/** O que o motor precisa saber do formato escolhido para gerar e recortar. */
export interface ResolvedFormat {
	width?: number;
	height?: number;
	/** Molde efetivo (do modelo escolhido, ou do próprio formato). */
	template?: CreationTemplate;
	/** Aplicar o recorte no pós-processamento (default: sim, quando há molde). */
	mask: boolean;
	/** Instrução de formato anexada ao prompt (vazia = nada a dizer). */
	hint: string;
	/** Nome legível do formato (ex.: "Capinha · iPhone 17"). */
	label?: string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtMm = (v: number) =>
	Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');

/** Modelos ativos de um formato (os inativos ficam guardados, mas o aluno não vê). */
export function activeModels(c: Pick<Creation, 'models'>): CreationModel[] {
	return (c.models ?? []).filter((m) => m.active !== false);
}

/**
 * Tamanho em px da arte a partir do molde. O lado MAIOR é o que o admin fixou
 * no formato (`width`/`height` — é a resolução que ele escolheu para a peça);
 * o menor sai da proporção física. Assim trocar o iPhone muda a proporção sem
 * mudar a qualidade.
 */
export function templateSizePx(
	t: CreationTemplate,
	longSidePx: number,
): { width: number; height: number } {
	const clamp = (n: number) => Math.min(4096, Math.max(64, Math.round(n)));
	if (t.width_mm >= t.height_mm) {
		return {
			width: clamp(longSidePx),
			height: clamp((longSidePx * t.height_mm) / t.width_mm),
		};
	}
	return {
		width: clamp((longSidePx * t.width_mm) / t.height_mm),
		height: clamp(longSidePx),
	};
}

/** Onde, em palavras, fica uma zona — "canto superior esquerdo", "centro"... */
function describePosition(z: CreationZone, t: CreationTemplate): string {
	const cx = (z.x + z.w / 2) / t.width_mm;
	const cy = (z.y + z.h / 2) / t.height_mm;
	const v = cy < 0.34 ? 'superior' : cy > 0.66 ? 'inferior' : 'central';
	const h = cx < 0.34 ? 'esquerdo' : cx > 0.66 ? 'direito' : 'centro';
	if (v === 'central' && h === 'centro') return 'no centro';
	if (h === 'centro') return `na parte ${v}, no meio`;
	if (v === 'central')
		return `na lateral ${h === 'esquerdo' ? 'esquerda' : 'direita'}`;
	return `no canto ${v} ${h}`;
}

/**
 * A instrução de formato que vai junto do prompt. Em português, como os
 * prompts do banco; números em PORCENTAGEM da arte, que é o que o modelo
 * consegue relacionar com a imagem que está desenhando (milímetro ele não vê).
 */
export function buildFormatHint(
	t: CreationTemplate | undefined,
	opts: { label?: string; extra?: string } = {},
): string {
	const parts: string[] = [];
	if (t) {
		const orient =
			t.width_mm > t.height_mm
				? 'horizontal'
				: t.width_mm < t.height_mm
					? 'vertical'
					: 'quadrada';
		parts.push(
			`FORMATO DA PEÇA${opts.label ? ` (${opts.label})` : ''}: ${fmtMm(t.width_mm)} × ${fmtMm(t.height_mm)} mm, arte ${orient}. Preencha a área inteira, sem bordas brancas nem moldura.`,
		);
		if (t.outline === 'ellipse') {
			parts.push(
				'A peça é redonda/oval: mantenha o assunto principal centralizado, longe das bordas, que serão cortadas.',
			);
		} else if ((t.corner_radius_mm ?? 0) > 0) {
			parts.push(
				'Os cantos da peça são arredondados e serão cortados: nada importante nos cantos.',
			);
		}
		for (const z of t.zones ?? []) {
			const nome = z.label?.trim() || 'área proibida';
			parts.push(
				`ÁREA LIVRE — ${nome} ${describePosition(z, t)} (de ${pct(z.x / t.width_mm)} a ${pct((z.x + z.w) / t.width_mm)} da largura e de ${pct(z.y / t.height_mm)} a ${pct((z.y + z.h) / t.height_mm)} da altura): deixe só fundo contínuo e liso ali, sem rosto, texto, logo ou elemento importante. Essa área será recortada.`,
			);
		}
		const margem = t.safe_margin_mm ?? 0;
		if (margem > 0) {
			parts.push(
				`Mantenha textos e elementos importantes a pelo menos ${fmtMm(margem)} mm (${pct(margem / Math.min(t.width_mm, t.height_mm))} do lado menor) das bordas.`,
			);
		}
	}
	if (opts.extra?.trim()) parts.push(opts.extra.trim());
	return parts.join('\n');
}

/** Junta o prompt e a instrução de formato sem estourar o limite do bloco. */
export function appendFormatHint(
	prompt: string,
	hint: string,
	max = 8_000,
): string {
	if (!hint) return prompt;
	const joined = `${prompt}\n\n${hint}`;
	if (joined.length <= max) return joined;
	// O prompt do admin é o que importa; a dica corta antes dele.
	const room = max - prompt.length - 2;
	return room > 40 ? `${prompt}\n\n${hint.slice(0, room)}` : prompt;
}

function zoneShape(z: CreationZone, sx: number, sy: number): string {
	const x = z.x * sx;
	const y = z.y * sy;
	const w = z.w * sx;
	const h = z.h * sy;
	if (z.shape === 'ellipse') {
		return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#000"/>`;
	}
	const r = Math.min((z.r ?? 0) * sx, w / 2, h / 2);
	return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#000"/>`;
}

/**
 * SVG da máscara em px: branco = fica, preto = sai. Opaco (fundo preto) de
 * propósito — a máscara vira o canal alfa pela luminância, sem depender de
 * `<mask>`/`fill-rule` do renderizador.
 */
export function buildMaskSvg(
	t: CreationTemplate,
	width: number,
	height: number,
): string {
	const sx = width / t.width_mm;
	const sy = height / t.height_mm;
	const outline =
		t.outline === 'ellipse'
			? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="#fff"/>`
			: (() => {
					const r = Math.min(
						(t.corner_radius_mm ?? 0) * sx,
						width / 2,
						height / 2,
					);
					return `<rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/>`;
				})();
	const zones = (t.zones ?? []).map((z) => zoneShape(z, sx, sy)).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#000"/>${outline}${zones}</svg>`;
}

/**
 * Aplica o recorte: tudo fora do contorno e dentro das zonas sai com alfa 0.
 * Preserva o alfa que a arte já tinha (multiplica, não substitui) e devolve a
 * arte no MESMO tamanho em que chegou.
 */
export async function applyTemplateMask(
	png: Buffer,
	t: CreationTemplate,
): Promise<Buffer> {
	const img = sharp(png).ensureAlpha();
	const { width, height } = await img.metadata();
	if (!width || !height) return png;
	const mask = await sharp(Buffer.from(buildMaskSvg(t, width, height)))
		.resize(width, height, { fit: 'fill' })
		.extractChannel(0)
		.raw()
		.toBuffer();
	const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
	const ch = info.channels;
	for (let i = 0, p = 0; p < mask.length; p++, i += ch) {
		data[i + ch - 1] = Math.round((data[i + ch - 1] * mask[p]) / 255);
	}
	return sharp(data, { raw: { width, height, channels: ch } })
		.png()
		.toBuffer();
}

/** Valida a geometria do molde — um molde torto vira arte cortada errado. */
export function templateProblem(t: CreationTemplate): string | null {
	if (!(t.width_mm > 0 && t.height_mm > 0)) return 'medidas do molde inválidas';
	for (const z of t.zones ?? []) {
		if (!(z.w > 0 && z.h > 0)) return `zona "${z.label ?? '?'}" sem tamanho`;
		if (
			z.x < 0 ||
			z.y < 0 ||
			z.x + z.w > t.width_mm + 0.01 ||
			z.y + z.h > t.height_mm + 0.01
		) {
			return `zona "${z.label ?? '?'}" fora da peça`;
		}
	}
	return null;
}
