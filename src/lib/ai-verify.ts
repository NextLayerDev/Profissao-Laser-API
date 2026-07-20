import sharp from 'sharp';

// ─────────────────────────────────────────────────────────────────────
// VERIFICAÇÃO ESTRUTURAL da saída da IA — trava anti-alucinação.
//
// Compara a imagem de ENTRADA com o que a IA devolveu, só com sharp (sem
// chamada de IA extra, sem custo). Não é um medidor de QUALIDADE: é um detector
// de "veio outra figura". Um logo que volta como 4 retratos em grade, uma saída
// em branco, uma chapa preta ou um reenquadramento são pegos aqui; um traço
// mais grosso ou uma hachura diferente NÃO são — e nem devem ser.
//
// Todos os limiares estão deliberadamente longe da banda observada em acertos
// (correlação fiel ~0.55–0.90 contra um piso de 0.15): falso positivo custa uma
// geração boa jogada fora, então o teste só dispara em catástrofe.
// ─────────────────────────────────────────────────────────────────────

export type VerifyReason =
	| 'aspect_changed'
	| 'blank_output'
	| 'black_output'
	| 'layout_mismatch'
	| 'tiled_output';

export interface VerifyMetrics {
	corr: number;
	occIn: number;
	occOut: number;
	arIn: number;
	arOut: number;
	tileLROut: number;
	tileTBOut: number;
	tileLRIn: number;
	tileTBIn: number;
}

export interface VerifyResult {
	ok: boolean;
	reasons: VerifyReason[];
	metrics: VerifyMetrics;
}

const GRID = 64; // resolução de trabalho (4096 amostras)
const INK_T = 160; // limiar de tinta no grid de 8 bits
const ASPECT_TOL = 1.25; // reenquadramento
const MIN_OCC = 0.02; // saída em branco
const MAX_OCC = 0.9; // saída toda preta
const MIN_CORR = 0.15; // figura completamente diferente
const TILE_OUT_MIN = 0.6; // metades da saída auto-similares
const TILE_IN_MAX = 0.35; // entrada NÃO auto-similar (guarda logo simétrico)
const GUTTER_MAX_INK = 0.04; // faixa de calha considerada vazia
const GUTTER_MIN_OCC = 0.15; // só testa calha em arte não-esparsa
const BAND_FROM = 29; // faixa central do grid (29..34)
const BAND_TO = 34;

/**
 * Reduz a imagem a um grid GRID×GRID de cinza normalizado.
 *
 * `fit: 'fill'` é intencional — comparamos COMPOSIÇÃO num grid comum, e
 * mudança real de proporção já foi pega antes (`aspect_changed`), então a
 * distorção aqui não consegue mascarar uma falha.
 */
async function toGrid(buffer: Buffer): Promise<Uint8Array> {
	const { data } = await sharp(buffer, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.resize(GRID, GRID, { fit: 'fill' })
		.grayscale()
		.toColourspace('b-w')
		.normalise()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return new Uint8Array(data.buffer, data.byteOffset, GRID * GRID);
}

/** Pearson centrado na média. Devolve 0 quando algum lado é constante. */
function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
	const n = Math.min(a.length, b.length);
	if (n === 0) return 0;
	let sa = 0;
	let sb = 0;
	for (let i = 0; i < n; i++) {
		sa += a[i];
		sb += b[i];
	}
	const ma = sa / n;
	const mb = sb / n;
	let num = 0;
	let da = 0;
	let db = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i] - ma;
		const y = b[i] - mb;
		num += x * y;
		da += x * x;
		db += y * y;
	}
	if (da === 0 || db === 0) return 0;
	return num / Math.sqrt(da * db);
}

/** Correlação entre as metades esquerda/direita e topo/baixo do grid. */
function selfSimilarity(g: Uint8Array): { lr: number; tb: number } {
	const half = GRID / 2;
	const left: number[] = [];
	const right: number[] = [];
	for (let y = 0; y < GRID; y++) {
		for (let x = 0; x < half; x++) {
			left.push(g[y * GRID + x]);
			right.push(g[y * GRID + x + half]);
		}
	}
	const top: number[] = [];
	const bottom: number[] = [];
	for (let y = 0; y < half; y++) {
		for (let x = 0; x < GRID; x++) {
			top.push(g[y * GRID + x]);
			bottom.push(g[(y + half) * GRID + x]);
		}
	}
	return { lr: pearson(left, right), tb: pearson(top, bottom) };
}

/** Tinta média na faixa central de linhas e de colunas. */
function centerBands(ink: Uint8Array): { row: number; col: number } {
	let rowSum = 0;
	let rowN = 0;
	let colSum = 0;
	let colN = 0;
	for (let y = BAND_FROM; y <= BAND_TO; y++) {
		for (let x = 0; x < GRID; x++) {
			rowSum += ink[y * GRID + x];
			rowN++;
		}
	}
	for (let x = BAND_FROM; x <= BAND_TO; x++) {
		for (let y = 0; y < GRID; y++) {
			colSum += ink[y * GRID + x];
			colN++;
		}
	}
	return { row: rowSum / rowN, col: colSum / colN };
}

/**
 * Verifica se a saída da IA ainda é a MESMA arte da entrada. Nunca lança:
 * qualquer falha de decodificação vira `ok: true` (na dúvida, entrega — o
 * cliente pagou e o resultado pode estar bom).
 */
export async function verifyStructure(
	input: Buffer,
	output: Buffer,
): Promise<VerifyResult> {
	const reasons: VerifyReason[] = [];
	const metrics: VerifyMetrics = {
		corr: 0,
		occIn: 0,
		occOut: 0,
		arIn: 0,
		arOut: 0,
		tileLROut: 0,
		tileTBOut: 0,
		tileLRIn: 0,
		tileTBIn: 0,
	};

	try {
		const [metaIn, metaOut] = await Promise.all([
			sharp(input, { failOn: 'none' }).metadata(),
			sharp(output, { failOn: 'none' }).metadata(),
		]);
		const arIn = (metaIn.width ?? 1) / (metaIn.height ?? 1);
		const arOut = (metaOut.width ?? 1) / (metaOut.height ?? 1);
		metrics.arIn = arIn;
		metrics.arOut = arOut;
		if (
			arIn > 0 &&
			arOut > 0 &&
			Math.abs(Math.log(arIn / arOut)) > Math.log(ASPECT_TOL)
		) {
			reasons.push('aspect_changed');
		}

		const [gIn, gOut] = await Promise.all([toGrid(input), toGrid(output)]);

		const inkIn = new Uint8Array(GRID * GRID);
		const inkOut = new Uint8Array(GRID * GRID);
		let sumIn = 0;
		let sumOut = 0;
		for (let i = 0; i < gIn.length; i++) {
			inkIn[i] = gIn[i] < INK_T ? 1 : 0;
			inkOut[i] = gOut[i] < INK_T ? 1 : 0;
			sumIn += inkIn[i];
			sumOut += inkOut[i];
		}
		const occIn = sumIn / inkIn.length;
		const occOut = sumOut / inkOut.length;
		metrics.occIn = occIn;
		metrics.occOut = occOut;

		if (occOut < MIN_OCC) reasons.push('blank_output');
		else if (occOut > MAX_OCC) reasons.push('black_output');

		// Correlação de layout. O `abs` não é cosmético: entrada com fundo
		// escuro, redesenhada corretamente em preto-sobre-branco, dá r
		// fortemente NEGATIVO — `|r|` deixa o teste agnóstico a polaridade.
		const corr = pearson(gIn, gOut);
		metrics.corr = corr;
		if (Math.abs(corr) < MIN_CORR) reasons.push('layout_mismatch');

		// Grade / contact sheet: a saída virou repetição do mesmo assunto.
		const simOut = selfSimilarity(gOut);
		const simIn = selfSimilarity(gIn);
		metrics.tileLROut = simOut.lr;
		metrics.tileTBOut = simOut.tb;
		metrics.tileLRIn = simIn.lr;
		metrics.tileTBIn = simIn.tb;

		const halvesRepeat =
			Math.min(simOut.lr, simOut.tb) > TILE_OUT_MIN &&
			Math.min(simIn.lr, simIn.tb) < TILE_IN_MAX;

		// Calha: faixa central vazia que a ENTRADA não tem. Basta uma das duas
		// direções (grade 1×4 só tem calha vertical), mas sempre comparada com
		// a entrada — só acusamos separação que a IA inventou.
		const bandOut = centerBands(inkOut);
		const bandIn = centerBands(inkIn);
		const gutter =
			occOut > GUTTER_MIN_OCC &&
			((bandOut.row < GUTTER_MAX_INK && bandIn.row >= GUTTER_MAX_INK) ||
				(bandOut.col < GUTTER_MAX_INK && bandIn.col >= GUTTER_MAX_INK));

		if (halvesRepeat || gutter) reasons.push('tiled_output');
	} catch {
		// Não conseguimos decodificar → não bloqueia a entrega.
		return { ok: true, reasons: [], metrics };
	}

	return { ok: reasons.length === 0, reasons, metrics };
}
