/**
 * Gerador de medalha plana (uma peça, corte + gravação).
 *
 * A medalha é desenhada CENTRADA na origem — é a única forma de as quatro formas
 * (disco, polígono, estrela, escudo) compartilharem as mesmas contas de raio — e
 * no fim tudo é transladado para o canto da caixa envolvente, que é o que o
 * nesting e os exportadores esperam (`minX = minY = 0`).
 *
 * As duas armadilhas que este arquivo existe para evitar:
 *
 * 1. DESENHADO vs FINAL no furo da fita. O contorno é externo (cresce k/2 para
 *    fora) e o furo é interno (encolhe k/2). O CENTRO do furo, porém, tem de ser
 *    medido a partir da borda NOMINAL (a que sai da máquina), nunca da borda
 *    desenhada — senão a distância furo↔borda erra em k/2 justamente no ponto
 *    mais frágil da peça.
 * 2. Compensação de contorno não-circular. Num disco a compensação é k/2 no
 *    raio; num polígono/estrela o feixe anda k/2 PERPENDICULAR a cada aresta, e
 *    isso empurra cada vértice `(k/2)/sen α` ao longo do raio (α = ângulo entre a
 *    bissetriz do vértice e a aresta). Compensar estrela com k/2 radial deixa a
 *    peça menor que o pedido nas pontas.
 *
 * Módulo PURO: só `ir`, `kerf` e `tool-errors`. Nada que leia env no topo.
 */

import { ToolEngineError } from '../../tool-errors.js';
import {
	bboxOf,
	bulgeFromSweep,
	type CadPath,
	circle,
	computeStats,
	type Part,
	type Pt,
	polyline,
	type Sketch2D,
	TAU,
	TEXT_WIDTH_FACTOR,
	text,
	translatePath,
} from '../ir.js';
import { assertJoint, holeDiameter, outer } from '../kerf.js';

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export type MedalMaterial = 'mdf' | 'acrilico' | 'compensado';
export type MedalForma = 'disco' | 'estrela' | 'poligono' | 'escudo';
export type MedalAro = 'nenhum' | 'simples' | 'duplo';

export interface MedalParams {
	/** Diâmetro nominal (tip a tip nas formas pontudas), em mm. */
	diametro: number;
	espessura: number;
	material?: MedalMaterial;
	kerf?: number;
	forma?: MedalForma;
	/** Nº de lados (polígono) ou de pontas (estrela). Ignorado nas outras formas. */
	lados?: number;
	/** Ø NOMINAL do furo da fita. Zero = medalha sem furo (ficha/token). */
	furo_fita_diametro?: number;
	/** Distância do CENTRO do furo à borda superior FINAL. */
	furo_distancia_borda?: number;
	aro?: MedalAro;
	gravacao_texto?: string;
	gravacao_altura?: number;
	gravacao_texto2?: string;
	qtd?: number;
}

// ---------------------------------------------------------------------------
// Constantes de projeto
// ---------------------------------------------------------------------------

const MATERIAIS: MedalMaterial[] = ['mdf', 'acrilico', 'compensado'];
const FORMAS: MedalForma[] = ['disco', 'estrela', 'poligono', 'escudo'];
const AROS: MedalAro[] = ['nenhum', 'simples', 'duplo'];

const KERF_PADRAO = 0.15;

/**
 * Abaixo de 25 mm não existe medalha: não sobra anel para o furo da fita, para o
 * aro e para o nome — sobra uma lantejoula.
 */
export const DIAMETRO_MIN = 25;

/** Faixa de lados/pontas. Acima de 12 pontas a estrela vira serra circular. */
export const LADOS_MIN = 3;
export const LADOS_MAX = 12;

/** Raio interno da estrela como fração do externo. */
export const ESTRELA_RAIO_INTERNO = 0.45;

/** Recuo dos dois círculos do aro em relação à borda FINAL, em mm. */
export const ARO_RECUO_EXTERNO = 2;
export const ARO_RECUO_INTERNO = 3.2;

/**
 * Invariantes do furo da fita. Menos de 1,5 Ø de distância à borda (ou menos de
 * 3 mm em absoluto) e a medalha racha na primeira puxada da fita — é o defeito
 * campeão da peça, por isso é erro e não aviso.
 */
export const FURO_MARGEM_FATOR = 1.5;
export const FURO_MARGEM_MIN = 3;

/**
 * Piso da PONTE de material — a espessura de peça que sobra entre o furo e o
 * contorno, medida PERPENDICULAR ao contorno.
 *
 * `furo_distancia_borda` é radial: é o que o aluno controla. Numa ponta de
 * estrela, porém, o contorno se fecha em volta do furo e a ponte real é uma
 * fração da distância radial — é ela que arrebenta, não a radial. Como o
 * parâmetro pode estar perfeitamente legal e a ponte ainda assim ficar fina, isto
 * é aviso e não erro.
 */
const PONTE_MIN_FATOR = 0.5;

/** Ø e distância do furo quando o aluno não informa: proporcionais ao tamanho. */
const FURO_D_FATOR = 0.11;
const FURO_D_MIN = 3;
const FURO_D_MAX = 8;
const FURO_DIST_FATOR = 1.6;

/** Proporções do escudo, como frações do diâmetro nominal. */
const ESCUDO_MEIA_LARGURA = 0.42;
/** Fração da altura ocupada pelas laterais RETAS (os "ombros"). */
const ESCUDO_OMBRO = 0.65;
/** Raio da ponta inferior arredondada. */
const ESCUDO_PONTA = 0.1;

/** Fração do diâmetro inscrito que a gravação pode ocupar em largura. */
const TEXTO_LARGURA_UTIL = 0.85;
const TEXTO_ALTURA_FATOR = 0.12;
const TEXTO_ALTURA_MIN = 3;
const TEXTO_ALTURA_MAX = 12;
/** Entrelinha como fração da altura do texto. */
const TEXTO_ENTRELINHA = 0.45;
/** Abaixo disso a gravação em MDF fecha e vira borrão. */
export const TEXTO_LEGIVEL_MIN = 2.5;

/**
 * Teto de quantidade. Não é frescura: `qtd` multiplica o nesting, e um pedido de
 * 100 mil medalhas trava o processo antes de virar chapa.
 */
export const QTD_MAX = 500;

/**
 * Piso do seno usado na compensação de vértice: abaixo disso `(k/2)/sen α`
 * explode e passaria a inventar geometria — a ponta aguda é arredondada pelo
 * próprio feixe, nenhuma conta a salva.
 */
const SENO_MIN_UTIL = 0.15;

/** Abaixo deste seno o vértice é agudo demais e vira aviso ao aluno. */
const SENO_AVISO = 0.3;

const EPS = 1e-9;
/** Tolerância de comparação de parâmetros informados (mm). */
const TOL_PARAM = 1e-9;

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const mm = (v: number): string => `${Math.round(v * 100) / 100} mm`;

function round12(v: number): number {
	return Math.round(v * 1e12) / 1e12;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

function exigePositivo(v: number | undefined, nome: string): number {
	if (v === undefined || !Number.isFinite(v) || v <= 0) {
		throw new ToolEngineError(
			400,
			`O parâmetro "${nome}" precisa ser um número maior que zero (recebido: ${String(v)}).`,
		);
	}
	return v;
}

/**
 * Menor distância de um ponto às CORDAS de um contorno fechado. Ignorar o bojo
 * dos arcos é seguro de propósito: a corda está sempre mais perto do interior
 * que um arco convexo, então o resultado é um limite INFERIOR — erra para o lado
 * de sobrar material, nunca para o de trincar a peça.
 */
function distanciaAoContorno(pts: Pt[], p: Pt): number {
	let melhor = Number.POSITIVE_INFINITY;
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len2 = dx * dx + dy * dy;
		// Projeção do ponto no segmento, presa nas pontas (canto conta como ponto).
		const u =
			len2 < EPS
				? 0
				: clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
		const d = Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
		if (d < melhor) melhor = d;
	}
	return Number.isFinite(melhor) ? melhor : 0;
}

/** Polígono regular de `n` lados inscrito em `r`, primeiro vértice no TOPO, sentido anti-horário. */
function poligonoPts(r: number, n: number): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const a = Math.PI / 2 + (TAU * i) / n;
		out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
	}
	return out;
}

/** Estrela de `pontas` pontas: raios externo/interno alternados, ponta no TOPO. */
function estrelaPts(r: number, rInterno: number, pontas: number): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < 2 * pontas; i++) {
		const a = Math.PI / 2 + (Math.PI * i) / pontas;
		const rr = i % 2 === 0 ? r : rInterno;
		out.push({ x: rr * Math.cos(a), y: rr * Math.sin(a) });
	}
	return out;
}

/**
 * Compensação de kerf de um contorno estrelado em torno da origem (disco,
 * polígono regular, estrela): cada vértice anda `off / sen α` ao longo do
 * próprio raio, onde α é o ângulo entre a bissetriz do vértice e a aresta que
 * dele sai. Vale porque nestas formas a bissetriz É radial, por simetria — não
 * use em polígono qualquer.
 *
 * Note que o vértice CÔNCAVO (o vale da estrela) também cresce para fora: dar
 * material à peça é rasar o fundo do vale, não afundá-lo. A fórmula acerta o
 * sinal sozinha porque só usa |sen α|.
 *
 * Devolve também o menor seno encontrado — é o medidor de "ponta aguda demais".
 */
function compensaRadial(
	pts: Pt[],
	off: number,
): { pts: Pt[]; senoMin: number } {
	let senoMin = 1;
	const n = pts.length;
	const out: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const v = pts[i];
		const prox = pts[(i + 1) % n];
		const rv = Math.hypot(v.x, v.y);
		const ex = prox.x - v.x;
		const ey = prox.y - v.y;
		const le = Math.hypot(ex, ey);
		if (rv < EPS || le < EPS) {
			out.push({ x: v.x, y: v.y });
			continue;
		}
		// |sen α| = |r̂ × ê|.
		const seno = Math.abs((v.x / rv) * ey - (v.y / rv) * ex) / le;
		if (seno < senoMin) senoMin = seno;
		const escala = (rv + off / Math.max(seno, SENO_MIN_UTIL)) / rv;
		out.push({ x: round12(v.x * escala), y: round12(v.y * escala) });
	}
	return { pts: out, senoMin };
}

/**
 * Escudo: topo reto, laterais retas (os ombros), flancos convergentes e ponta
 * inferior ARREDONDADA — um arco tangente aos dois flancos, não um bico cortado.
 * O arco vai como `bulge` na polilinha (arco nativo no DXF, sem facetar).
 *
 * `off` é a compensação de kerf. O topo, as laterais e o círculo da ponta são
 * offsetados exatamente; o ponto de ombro mantém o Y nominal, o que desloca a
 * quina em menos de k/2·(1−cos θ) do offset ideal — abaixo do que a máquina
 * resolve, e o flanco é RECALCULADO tangente ao círculo já crescido.
 */
function escudoPts(D: number, off: number): { pts: Pt[]; bulges: number[] } {
	const R = D / 2 + off;
	const a = ESCUDO_MEIA_LARGURA * D + off;
	const rp = ESCUDO_PONTA * D + off;
	const yOmbro = D / 2 - ESCUDO_OMBRO * D;
	// Offsetar um círculo não move o centro: por isso `cy` é o mesmo com e sem kerf.
	const cy = -R + rp;

	const px = -a;
	const dy = yOmbro - cy;
	const dpc = Math.hypot(px, dy);
	if (dpc <= rp + EPS) {
		// Só aconteceria se alguém mexesse nas proporções acima até o ombro entrar
		// dentro do círculo da ponta — aí não existe tangente e o escudo não fecha.
		throw new ToolEngineError(
			400,
			'As proporções do escudo não fecham para este diâmetro. Use outra forma.',
		);
	}
	const base = Math.atan2(dy, px);
	const phi = Math.acos(clamp(rp / dpc, -1, 1));
	const cand = [base + phi, base - phi].map((ang) => ({
		x: round12(rp * Math.cos(ang)),
		y: round12(cy + rp * Math.sin(ang)),
	}));
	// Das duas tangentes possíveis, a do flanco é a mais à ESQUERDA (a outra
	// atravessaria a peça).
	const tEsq = cand[0].x <= cand[1].x ? cand[0] : cand[1];
	const tDir = { x: -tEsq.x, y: tEsq.y };

	// Arco anti-horário de tEsq a tDir passando pelo fundo (0, −R): o sentido de
	// percurso do contorno é anti-horário, e ponta convexa ⇒ bulge positivo.
	const a0 = Math.atan2(tEsq.y - cy, tEsq.x);
	const a1 = Math.atan2(tDir.y - cy, tDir.x);
	const sweep = (((a1 - a0) % TAU) + TAU) % TAU;

	return {
		pts: [
			{ x: -a, y: yOmbro },
			tEsq,
			tDir,
			{ x: a, y: yOmbro },
			{ x: a, y: R },
			{ x: -a, y: R },
		],
		// bulges[i] vale para o trecho que SAI do vértice i (convenção do DXF).
		bulges: [0, round12(bulgeFromSweep(sweep)), 0, 0, 0, 0],
	};
}

// ---------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------

export function buildMedal(params: MedalParams): Sketch2D {
	const warnings: string[] = [];

	// --- entradas ------------------------------------------------------------
	const D = exigePositivo(params.diametro, 'diametro');
	if (D < DIAMETRO_MIN) {
		throw new ToolEngineError(
			400,
			`Medalha de ${mm(D)} é pequena demais: abaixo de ${mm(DIAMETRO_MIN)} não ` +
				'sobra anel para o furo da fita, para o aro e para o nome. Aumente o diâmetro.',
		);
	}
	const t = exigePositivo(params.espessura, 'espessura');
	const k = params.kerf ?? KERF_PADRAO;
	if (!Number.isFinite(k) || k < 0) {
		throw new ToolEngineError(
			400,
			`O kerf precisa ser um número maior ou igual a zero (recebido: ${String(k)}).`,
		);
	}
	const material: MedalMaterial = params.material ?? 'mdf';
	if (!MATERIAIS.includes(material)) {
		throw new ToolEngineError(
			400,
			`Material desconhecido: "${String(material)}". Use um destes: ${MATERIAIS.join(', ')}.`,
		);
	}
	const forma: MedalForma = params.forma ?? 'disco';
	if (!FORMAS.includes(forma)) {
		throw new ToolEngineError(
			400,
			`Forma desconhecida: "${String(forma)}". Use uma destas: ${FORMAS.join(', ')}.`,
		);
	}
	const aro: MedalAro = params.aro ?? 'nenhum';
	if (!AROS.includes(aro)) {
		throw new ToolEngineError(
			400,
			`Aro desconhecido: "${String(aro)}". Use um destes: ${AROS.join(', ')}.`,
		);
	}

	const precisaLados = forma === 'poligono' || forma === 'estrela';
	const lados = Math.round(params.lados ?? (forma === 'estrela' ? 5 : 6));
	if (
		precisaLados &&
		(!Number.isFinite(lados) || lados < LADOS_MIN || lados > LADOS_MAX)
	) {
		throw new ToolEngineError(
			400,
			`A forma "${forma}" precisa de ${LADOS_MIN} a ${LADOS_MAX} ` +
				`${forma === 'estrela' ? 'pontas' : 'lados'} (recebido: ${String(params.lados)}).`,
		);
	}
	if (!precisaLados && params.lados !== undefined) {
		warnings.push(
			`O parâmetro "lados" só vale para polígono e estrela — foi ignorado na forma "${forma}".`,
		);
	}

	const qtd = Math.round(params.qtd ?? 1);
	if (!Number.isFinite(qtd) || qtd < 1) {
		throw new ToolEngineError(
			400,
			`A quantidade precisa ser um inteiro maior ou igual a 1 (recebido: ${String(params.qtd)}).`,
		);
	}
	if (qtd > QTD_MAX) {
		throw new ToolEngineError(
			400,
			`Quantidade de ${qtd} medalhas passa do teto de ${QTD_MAX} por job. ` +
				'Divida o pedido em lotes.',
		);
	}

	// --- contorno: nominal (para medir) e desenhado (para cortar) -------------
	const R = D / 2;
	let ptsNominal: Pt[] = [];
	let contorno: CadPath;
	let vertices = 0;
	let senoMin = 1;

	if (forma === 'disco') {
		// Contorno é material: desenhar Ø + k para SAIR com Ø.
		contorno = circle({ x: 0, y: 0 }, outer(D, k) / 2, 'CORTE');
	} else if (forma === 'escudo') {
		ptsNominal = escudoPts(D, 0).pts;
		const desenhado = escudoPts(D, k / 2);
		contorno = polyline(desenhado.pts, true, 'CORTE', desenhado.bulges);
		vertices = desenhado.pts.length;
	} else {
		ptsNominal =
			forma === 'poligono'
				? poligonoPts(R, lados)
				: estrelaPts(R, R * ESTRELA_RAIO_INTERNO, lados);
		const comp = compensaRadial(ptsNominal, k / 2);
		senoMin = comp.senoMin;
		contorno = polyline(comp.pts, true, 'CORTE');
		vertices = comp.pts.length;
	}
	contorno.id = 'contorno';
	if (senoMin < SENO_AVISO) {
		warnings.push(
			`As pontas desta forma abrem só ${Math.round((Math.asin(senoMin) * 360) / Math.PI)}° — ` +
				'o feixe arredonda a ponta e ela sai levemente mais curta que o desenho. ' +
				'Reduza o número de pontas ou aceite a ponta romba.',
		);
	}

	// Raio inscrito NOMINAL: o maior círculo que caberia na peça pronta. É ele que
	// limita aro e gravação — um aro de R−2 numa estrela sairia pela ponta e
	// gravaria a mesa da máquina.
	const raioInscrito =
		forma === 'disco' ? R : distanciaAoContorno(ptsNominal, { x: 0, y: 0 });

	const paths: CadPath[] = [contorno];

	// --- furo da fita ---------------------------------------------------------
	const dFuro =
		params.furo_fita_diametro ??
		clamp(D * FURO_D_FATOR, FURO_D_MIN, FURO_D_MAX);
	if (!Number.isFinite(dFuro) || dFuro < 0) {
		throw new ToolEngineError(
			400,
			`O Ø do furo da fita precisa ser um número maior ou igual a zero (recebido: ${String(dFuro)}).`,
		);
	}
	const temFuro = dFuro > 0;
	const distBorda =
		params.furo_distancia_borda ??
		Math.max(FURO_MARGEM_MIN, FURO_DIST_FATOR * dFuro);
	let furoCentro: Pt | null = null;
	let furoDesenhado = 0;

	if (temFuro) {
		const margemMin = Math.max(FURO_MARGEM_MIN, FURO_MARGEM_FATOR * dFuro);
		if (distBorda < margemMin - TOL_PARAM) {
			throw new ToolEngineError(
				400,
				`O furo da fita a ${mm(distBorda)} da borda racha a medalha na primeira ` +
					`puxada. Use ao menos ${mm(margemMin)} — ${FURO_MARGEM_FATOR}× o Ø do furo ` +
					`(${mm(dFuro)}) e nunca menos de ${mm(FURO_MARGEM_MIN)}.`,
			);
		}
		if (distBorda >= R - TOL_PARAM) {
			throw new ToolEngineError(
				400,
				`O furo da fita a ${mm(distBorda)} da borda cairia no centro de uma medalha ` +
					`de ${mm(D)}. Ele é para pendurar: aproxime-o da borda superior.`,
			);
		}
		// A ARMADILHA: o centro sai da borda NOMINAL (R), não da desenhada (R + k/2).
		// Medir na borda desenhada erraria a distância furo↔borda em k/2 exatamente
		// onde a peça é mais frágil.
		furoCentro = { x: 0, y: round12(R - distBorda) };
		// Furo é vazio: desenhar Ø − k para SAIR com Ø.
		furoDesenhado = holeDiameter(dFuro, k);
		const furo = circle(furoCentro, furoDesenhado / 2, 'CORTE');
		furo.id = 'furo_fita';
		paths.push(furo);

		// Ponte de material entre o furo e o contorno. O invariante acima olha o
		// parâmetro (radial); aqui olha a GEOMETRIA (perpendicular) — numa ponta de
		// estrela o contorno se fecha em volta do furo e a ponte real é uma fração da
		// distância radial informada.
		if (ptsNominal.length > 0) {
			const ponte = distanciaAoContorno(ptsNominal, furoCentro) - dFuro / 2;
			const ponteMin = Math.max(FURO_MARGEM_MIN, PONTE_MIN_FATOR * dFuro);
			if (ponte < ponteMin - TOL_PARAM) {
				warnings.push(
					`Na forma "${forma}" sobra só ${mm(Math.max(0, ponte))} de material em volta ` +
						`do furo (o mínimo é ${mm(ponteMin)}): a peça afina justo onde a fita puxa, ` +
						'porque a ponta se fecha em volta do furo. Desça o furo, use menos pontas ' +
						'ou troque para disco.',
				);
			}
		}
		if (material === 'acrilico' && distBorda < 2 * dFuro - TOL_PARAM) {
			warnings.push(
				`Acrílico trinca com o balanço da fita: com ${mm(distBorda)} de margem a ` +
					`medalha vive no limite. Em acrílico use ao menos 2× o Ø do furo (${mm(2 * dFuro)}).`,
			);
		}
	} else {
		warnings.push(
			'Sem furo de fita: esta peça sai como ficha/token, não dá para pendurar.',
		);
	}

	// --- aro gravado ----------------------------------------------------------
	// O aro NÃO é corte e NÃO leva kerf: a gravação é uma linha sobre a face, sem
	// largura de contorno a compensar. Os recuos se medem a partir da borda FINAL.
	const aroRaios: number[] = [];
	if (aro !== 'nenhum') {
		const recuos =
			aro === 'duplo'
				? [ARO_RECUO_EXTERNO, ARO_RECUO_INTERNO]
				: [ARO_RECUO_EXTERNO];
		for (const recuo of recuos) {
			const r = round12(raioInscrito - recuo);
			if (r <= 0) {
				warnings.push(
					`O aro não cabe: com ${mm(raioInscrito)} de raio inscrito o círculo de ` +
						`recuo ${mm(recuo)} some. Aumente o diâmetro ou desligue o aro.`,
				);
				continue;
			}
			aroRaios.push(r);
		}
		for (let i = 0; i < aroRaios.length; i++) {
			const c = circle({ x: 0, y: 0 }, aroRaios[i], 'GRAVACAO');
			c.id = i === 0 ? 'aro_externo' : 'aro_interno';
			paths.push(c);
		}
	}

	// --- gravação de texto ----------------------------------------------------
	const linhas = [params.gravacao_texto, params.gravacao_texto2]
		.map((s) => s?.trim() ?? '')
		.filter((s) => s.length > 0);
	let alturaTexto = 0;
	if (linhas.length > 0) {
		const pedida =
			params.gravacao_altura ??
			clamp(D * TEXTO_ALTURA_FATOR, TEXTO_ALTURA_MIN, TEXTO_ALTURA_MAX);
		if (!Number.isFinite(pedida) || pedida <= 0) {
			throw new ToolEngineError(
				400,
				`A altura da gravação precisa ser um número maior que zero (recebido: ${String(
					params.gravacao_altura,
				)}).`,
			);
		}
		// Quem manda é o COMPRIMENTO da linha mais longa: sem este teto um nome
		// grande sai mais largo que a medalha e a gravação cai fora da peça. As duas
		// linhas dividem a MESMA altura — alturas diferentes ficariam tortas.
		const maisLonga = Math.max(...linhas.map((s) => s.length));
		// Com aro, o campo do texto é o círculo mais INTERNO do aro: escrever por
		// cima do aro é o que faz a medalha parecer amadora. Sem aro, o campo é o
		// raio inscrito. O fator embute a folga e o fato de que a linha de cima e a
		// de baixo pegam uma corda mais curta que o diâmetro.
		const campo = aroRaios.length > 0 ? Math.min(...aroRaios) : raioInscrito;
		const larguraUtil = 2 * campo * TEXTO_LARGURA_UTIL;
		const tetoLargura = larguraUtil / (maisLonga * TEXT_WIDTH_FACTOR);
		alturaTexto = round12(Math.min(pedida, tetoLargura));
		if (alturaTexto < TEXTO_LEGIVEL_MIN) {
			warnings.push(
				`A gravação teve de cair para ${mm(alturaTexto)} de altura para caber em ` +
					`${mm(larguraUtil)} de largura útil. Abaixo de ${mm(TEXTO_LEGIVEL_MIN)} as ` +
					'letras fecham e viram borrão: encurte o texto ou aumente a medalha.',
			);
		}
		// Bloco centrado na peça. Com duas linhas: base da 1ª em +entrelinha/2 e a 2ª
		// uma altura + entrelinha abaixo — o bloco inteiro fica simétrico em Y.
		const entre = alturaTexto * TEXTO_ENTRELINHA;
		const baseTopo = linhas.length > 1 ? entre / 2 : -alturaTexto / 2;
		for (let i = 0; i < linhas.length; i++) {
			const y = round12(baseTopo - i * (alturaTexto + entre));
			const g = text({ x: 0, y }, linhas[i], alturaTexto, 'GRAVACAO', {
				anchor: 'c',
			});
			g.id = `gravacao_${i + 1}`;
			paths.push(g);
		}
	}

	// --- invariantes de material/kerf ----------------------------------------
	// Reaproveita o validador do motor: pega kerf ≥ espessura (feixe mais largo que
	// a chapa) e furo que some com o kerf. Sem folga de encaixe: a medalha é uma
	// peça só, `clearance` = 0.
	warnings.push(...assertJoint({ t, k, c: 0, furos: temFuro ? [dFuro] : [] }));

	// --- peça -----------------------------------------------------------------
	// Origem no canto da caixa envolvente: é o que `rotatePath90` (nesting) e os
	// exportadores pressupõem. A caixa mede TODOS os caminhos, gravação incluída —
	// bbox subdimensionada faz o nesting sobrepor peças na chapa.
	const bbCentrada = bboxOf(paths);
	// Onde o centro da medalha foi parar. Não é o centro da caixa: numa estrela de
	// 5 pontas a caixa é mais alta acima do centro que abaixo, e quem for cotar o
	// furo ou o aro a partir de `bbox/2` erra.
	const cx = round12(-bbCentrada.minX);
	const cy = round12(-bbCentrada.minY);
	const noCanto = paths.map((p) => translatePath(p, cx, cy));
	const bb = bboxOf(noCanto);
	const part: Part = {
		id: 'medalha',
		label: 'Medalha',
		thickness: t,
		material,
		paths: noCanto,
		bbox: { w: bb.w, h: bb.h },
		// `qtd` é quantidade a CORTAR: o nesting expande, a montagem 3D mostra uma.
		// Ninguém faz uma medalha só, mas 30 medalhas não são uma montagem.
		qty: qtd,
		pose: { pos: [0, 0, 0], rot: [0, 0, 0] },
	};

	const parts = [part];
	return {
		units: 'mm',
		schema: 1,
		parts,
		meta: {
			generator: 'cad/medal@1',
			params: {
				diametro: D,
				espessura: t,
				material,
				kerf: k,
				forma,
				lados: precisaLados ? lados : 0,
				furo_fita_diametro: dFuro,
				furo_distancia_borda: temFuro ? distBorda : 0,
				// Já em coordenadas locais da peça (pós-translação), como a geometria.
				furo_centro: furoCentro
					? { x: round12(furoCentro.x + cx), y: round12(furoCentro.y + cy) }
					: null,
				centro: { x: cx, y: cy },
				furo_diametro_desenhado: round12(furoDesenhado),
				aro,
				aro_raios: aroRaios,
				gravacao_texto: linhas[0] ?? '',
				gravacao_texto2: linhas[1] ?? '',
				gravacao_altura: alturaTexto,
				qtd,
				raio_nominal: R,
				raio_inscrito: round12(raioInscrito),
				vertices,
			},
			kerf: k,
			clearance: 0,
			warnings: [...new Set(warnings)],
			stats: computeStats(parts),
		},
	};
}
