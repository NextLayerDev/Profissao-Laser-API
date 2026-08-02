/**
 * Gerador de churrasqueira de chapa de aço.
 *
 * Convenções de montagem (3D): X = comprimento (C), Y = largura (W),
 * Z = altura; a "profundidade" do parâmetro é a profundidade da CUBA (a altura
 * das paredes), não uma medida em Y. Cada peça é desenhada no seu próprio plano
 * local com origem em (0, 0) — é o que o nesting e os exportadores esperam.
 *
 * Três construções, três peças diferentes:
 * - `dobrada`: UMA chapa planificada (fundo + 4 abas) com linhas na layer DOBRA
 *   e alívio de canto nos quatro encontros de dobra;
 * - `encaixada`: painéis soltos com tab-and-slot (`fingerGeometry`) + moldura de
 *   topo, que é quem trava as quatro paredes na falta de solda;
 * - `soldada`: painéis soltos, sem dente, com linhas na layer MARCACAO dizendo
 *   ao soldador onde cada parede encosta.
 *
 * Módulo PURO: só `ir`, `kerf`, `bend` e `tool-errors`. Nada que leia env no topo.
 */

import { ToolEngineError } from '../../tool-errors.js';
import {
	type BendMaterial,
	bendAllowance,
	cornerRelief,
	developedLength,
	K_FACTOR,
	validateBend,
} from '../bend.js';
import {
	bboxOf,
	bulgeFromSweep,
	type CadPath,
	circle,
	computeStats,
	type LayerId,
	type Part,
	type Pt,
	polyline,
	rect,
	type Sketch2D,
	slot,
	TEXT_WIDTH_FACTOR,
	text,
} from '../ir.js';
import {
	assertJoint,
	crossLap,
	type FingerGeometry,
	fingerGeometry,
	holeDiameter,
	inner,
	outer,
} from '../kerf.js';

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export type BbqMaterial = 'aco_carbono' | 'inox_304' | 'inox_430' | 'corten';
export type BbqConstrucao = 'dobrada' | 'encaixada' | 'soldada';
export type BbqPes = 'nenhum' | 'chapa_dobrada' | 'cruzado_x' | 'abas';
export type BbqGrelha = 'nenhuma' | 'chapa_vazada' | 'varoes_apoio';
export type BbqRespiros = 'nenhum' | 'furos' | 'rasgos' | 'fundo_perfurado';
export type BbqCinzeiro = 'nenhum' | 'gaveta' | 'fundo_perfurado';

export interface BbqParams {
	/** Nº de pessoas. Maior que zero SOBRESCREVE comprimento e largura. */
	pessoas?: number;
	comprimento?: number;
	largura?: number;
	/** Profundidade da cuba (altura da parede), em mm. */
	profundidade?: number;
	espessura: number;
	material?: BbqMaterial;
	kerf?: number;
	folga?: number;
	construcao?: BbqConstrucao;
	raio_dobra?: number;
	fator_k?: number;
	pes?: BbqPes;
	altura_pes?: number;
	grelha?: BbqGrelha;
	grelha_niveis?: number;
	grelha_passo?: number;
	grelha_rasgo?: number;
	respiros?: BbqRespiros;
	respiro_area_pct?: number;
	cinzeiro?: BbqCinzeiro;
	gravacao_frente?: string;
}

// ---------------------------------------------------------------------------
// Constantes de projeto
// ---------------------------------------------------------------------------

/** Área de grelha por pessoa, em m². É a regra de bolso de churrasqueiro. */
export const AREA_POR_PESSOA_M2 = 0.03;

/** Razão comprimento : largura mantida no dimensionamento automático. */
export const RAZAO_CW = 2;

/** Limites do comprimento no dimensionamento por pessoas. */
export const C_MIN = 400;
export const C_MAX = 2000;

const KERF_PADRAO = 0.2;
const FOLGA_PADRAO = 0.15;
const PROFUNDIDADE_PADRAO = 200;
const ALTURA_PES_PADRAO = 700;
const GRELHA_PASSO_PADRAO = 12;
const GRELHA_RASGO_PADRAO = 8;
const GRELHA_NIVEIS_PADRAO = 2;
const RESPIRO_PCT_PADRAO = 5;

/** Folga lateral da grelha dentro da cuba, por lado. */
const GRELHA_FOLGA = 2;
/** Borda cheia da grelha de chapa vazada (a moldura que segura os rasgos). */
const GRELHA_BORDA_MIN = 12;
/** Vão livre acima do qual a grelha de chapa flete com o peso da carne. */
const GRELHA_VAO_MAX = 600;

/** Dente de apoio da grelha na lateral. */
const APOIO_LARG = 40;
/**
 * O rasgo de apoio é mais longo que o dente: em chapa dobrada o comprimento útil
 * da parede e o da grelha diferem pelo raio da dobra, e essa sobra absorve a
 * diferença sem soltar o apoio.
 */
const APOIO_SOBRA = 6;

/** Diâmetro do varão redondo de apoio (barra comprada, não cortada a laser). */
const VARAO_D = 8;

const CINZEIRO_ALTURA = 40;
const CINZEIRO_FOLGA = 2;
const PUXADOR_L = 60;
const PUXADOR_H = 12;

/** Diâmetro do furo de respiro e comprimento/altura do rasgo de respiro. */
const RESPIRO_D = 8;
const RESPIRO_RASGO_L = 40;
const RESPIRO_RASGO_H = 8;

/** Largura mínima da aba/pé recortado na própria parede. */
const PE_ABA_MIN = 40;
/** Acima disso a saia de chapa deixa de ser pé e vira parede que flamba. */
const PE_ABA_MAX_ALTURA = 150;

/** Aba da moldura de topo para fora da cuba: pega, pingadeira e sobra de rasgo. */
const MOLDURA_ABA = 10;

/**
 * Espessura máxima que uma fibra de bancada corta com qualidade. Inox reflete e
 * exige assistência de N2 — a corrente cai muito antes que no aço carbono.
 */
const ESPESSURA_MAX_FIBRA: Record<BbqMaterial, number> = {
	aco_carbono: 20,
	inox_304: 10,
	inox_430: 10,
	corten: 20,
};

/**
 * `bend.ts` não conhece o 430 (ferrítico). Ele dobra MELHOR que o 304, então
 * emprestar as regras do 304 erra para o lado seguro: raio mínimo maior e bend
 * allowance maior — a peça sai com sobra, não com falta.
 */
const MATERIAL_DOBRA: Record<BbqMaterial, BendMaterial> = {
	aco_carbono: 'aco_carbono',
	inox_304: 'inox_304',
	inox_430: 'inox_304',
	corten: 'corten',
};

const MATERIAIS: BbqMaterial[] = [
	'aco_carbono',
	'inox_304',
	'inox_430',
	'corten',
];

const EPS = 1e-9;

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

function unit(a: Pt, b: Pt): Pt {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const d = Math.hypot(dx, dy);
	return d < EPS ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
}

/**
 * Arredonda os cantos de um polígono fechado devolvendo (pontos, bulges).
 * `raios[i]` é o raio do canto `pts[i]`; 0 mantém o canto vivo. O sinal do bulge
 * sai do sentido da curva (esquerda = positivo), então canto côncavo — o do
 * alívio de canto — vira arco horário sozinho.
 */
function filetar(pts: Pt[], raios: number[]): { pts: Pt[]; bulges: number[] } {
	const n = pts.length;
	const outPts: Pt[] = [];
	const outBul: number[] = [];
	for (let i = 0; i < n; i++) {
		const v = pts[i];
		const anterior = pts[(i - 1 + n) % n];
		const proximo = pts[(i + 1) % n];
		const d0 = unit(anterior, v);
		const d1 = unit(v, proximo);
		const cross = d0.x * d1.y - d0.y * d1.x;
		const dot = d0.x * d1.x + d0.y * d1.y;
		const giro = Math.atan2(cross, dot);
		// Recuo máximo: metade da menor aresta vizinha, senão dois filetes se comem.
		const limite =
			Math.min(
				Math.hypot(v.x - anterior.x, v.y - anterior.y),
				Math.hypot(v.x - proximo.x, v.y - proximo.y),
			) / 2;
		const rf = Math.min(
			raios[i] ?? 0,
			limite / Math.max(EPS, Math.tan(Math.abs(giro) / 2)),
		);
		if (!(rf > 1e-6) || Math.abs(giro) < 1e-9) {
			outPts.push(v);
			outBul.push(0);
			continue;
		}
		const recuo = rf * Math.tan(Math.abs(giro) / 2);
		outPts.push({ x: v.x - d0.x * recuo, y: v.y - d0.y * recuo });
		outBul.push(bulgeFromSweep(giro));
		outPts.push({ x: v.x + d1.x * recuo, y: v.y + d1.y * recuo });
		outBul.push(0);
	}
	return { pts: outPts, bulges: outBul };
}

// ---------------------------------------------------------------------------
// Blank de bandeja dobrada (usado pelo corpo `dobrada` e pelo cinzeiro gaveta)
// ---------------------------------------------------------------------------

interface BandejaGeom {
	/** Dimensões do blank plano. */
	Lx: number;
	Ly: number;
	/** Tangentes das dobras (limite da face do fundo). */
	x1: number;
	x4: number;
	y1: number;
	y4: number;
	/** Extensão do entalhe de canto medida da borda do blank. */
	ax: number;
	by: number;
	/** Bend allowance e setback usados. */
	ba: number;
	sb: number;
	contorno: CadPath;
	dobras: CadPath[];
	alivio: ReturnType<typeof cornerRelief>;
}

/**
 * Planificação de uma bandeja: fundo C×W com quatro abas de altura H dobradas a
 * 90°. São DUAS cadeias cruzadas de duas dobras cada (uma por eixo) — não uma
 * cadeia de quatro —, e o blank é o retângulo dos dois desenvolvidos.
 *
 * O blank sai em cruz: os quatro cantos são removidos porque, dobrado, o material
 * do canto teria de esticar em duas direções ao mesmo tempo e a chapa RASGA. O
 * entalhe entra `max(profundidade do alívio, bend allowance)` a partir da
 * tangente da dobra: a regra de fábrica pede `r + t`, mas com raio generoso a
 * zona deformada (BA) passa disso e o entalhe precisa terminar DEPOIS dela.
 */
function bandeja(
	C: number,
	W: number,
	H: number,
	t: number,
	k: number,
	r: number,
	K: number,
	rotulo: string,
): BandejaGeom {
	const ba = bendAllowance(90, r, t, K);
	// Setback de uma dobra de 90°: (r + t)·tan(45°).
	const sb = round12(r + t);
	const abaPlana = round12(H - sb);
	if (abaPlana <= 0) {
		throw new ToolEngineError(
			400,
			`${rotulo}: a aba de ${mm(H)} não sobrevive ao setback da dobra (${mm(sb)}). ` +
				'Aumente a profundidade da cuba ou reduza o raio de dobra.',
		);
	}
	const faceX = round12(C - 2 * sb);
	const faceY = round12(W - 2 * sb);
	if (faceX <= 0 || faceY <= 0) {
		throw new ToolEngineError(
			400,
			`${rotulo}: o fundo de ${mm(C)}×${mm(W)} some entre as duas dobras ` +
				`(setback de ${mm(sb)} de cada lado). Aumente as medidas ou reduza o raio.`,
		);
	}

	const dobra = { angulo: 90, raio: r, espessura: t, fatorK: K };
	const Lx = developedLength([H, C, H], [dobra, dobra]);
	const Ly = developedLength([H, W, H], [dobra, dobra]);

	const x1 = abaPlana;
	const x2 = round12(x1 + ba);
	const x3 = round12(x2 + faceX);
	const x4 = round12(x3 + ba);
	const y1 = abaPlana;
	const y2 = round12(y1 + ba);
	const y3 = round12(y2 + faceY);
	const y4 = round12(y3 + ba);

	const alivio = cornerRelief({ t, k, r });
	const entalhe = Math.max(alivio.profundidadeDesenhada, ba);
	const ax = round12(x1 + entalhe);
	const by = round12(y1 + entalhe);
	if (2 * ax >= Lx || 2 * by >= Ly) {
		throw new ToolEngineError(
			400,
			`${rotulo}: os alívios de canto se encontram no meio da peça ` +
				`(entalhe de ${mm(entalhe)} em blank de ${mm(Lx)}×${mm(Ly)}). ` +
				'Aumente as medidas do fundo.',
		);
	}

	const cantos: Pt[] = [
		{ x: ax, y: 0 },
		{ x: Lx - ax, y: 0 },
		{ x: Lx - ax, y: by },
		{ x: Lx, y: by },
		{ x: Lx, y: Ly - by },
		{ x: Lx - ax, y: Ly - by },
		{ x: Lx - ax, y: Ly },
		{ x: ax, y: Ly },
		{ x: ax, y: Ly - by },
		{ x: 0, y: Ly - by },
		{ x: 0, y: by },
		{ x: ax, y: by },
	];
	// Só os quatro cantos CÔNCAVOS (o fundo do entalhe) são filetados: canto vivo
	// em zona que vai deformar é o ponto por onde a trinca começa.
	const rf = alivio.raioFundoDesenhado;
	const raios = [0, 0, rf, 0, 0, rf, 0, 0, rf, 0, 0, rf];
	const fil = filetar(cantos, raios);

	const linha = (a: Pt, b: Pt): CadPath => ({
		layer: 'DOBRA' as LayerId,
		seg: { k: 'line', a, b },
	});
	// Uma linha por dobra, no CENTRO da zona deformada — é onde a dobradeira
	// referencia o eixo da matriz.
	const xm1 = round12(x1 + ba / 2);
	const xm2 = round12(x3 + ba / 2);
	const ym1 = round12(y1 + ba / 2);
	const ym2 = round12(y3 + ba / 2);
	const dobras: CadPath[] = [
		linha({ x: xm1, y: by }, { x: xm1, y: Ly - by }),
		linha({ x: xm2, y: by }, { x: xm2, y: Ly - by }),
		linha({ x: ax, y: ym1 }, { x: Lx - ax, y: ym1 }),
		linha({ x: ax, y: ym2 }, { x: Lx - ax, y: ym2 }),
	];

	return {
		Lx,
		Ly,
		x1,
		x4,
		y1,
		y4,
		ax,
		by,
		ba,
		sb,
		contorno: polyline(fil.pts, true, 'CORTE', fil.bulges),
		dobras,
		alivio,
	};
}

// ---------------------------------------------------------------------------
// Painel retangular com dentes e recortes
// ---------------------------------------------------------------------------

interface DentePainel {
	/** Centro do dente ao longo da aresta. */
	c: number;
	/** Largura DESENHADA do dente. */
	larg: number;
	/** Protrusão DESENHADA (atravessa o painel vizinho e fica rente). */
	alt: number;
}

interface RecorteCentral {
	largura: number;
	altura: number;
}

interface PainelOpts {
	base?: DentePainel[];
	topo?: DentePainel[];
	esq?: DentePainel[];
	dir?: DentePainel[];
	/** Recorte central da aresta de baixo (pé em aba, cross lap). Anula `base`. */
	recorteBase?: RecorteCentral;
	/** Recorte central da aresta de cima. Anula `topo`. */
	recorteTopo?: RecorteCentral;
}

interface PainelGeom {
	pts: Pt[];
	/** Deslocamento aplicado para a peça começar em (0, 0). */
	offX: number;
	offY: number;
}

/**
 * Contorno de um painel L×H com dentes protuberantes e/ou recortes centrais.
 * Os dentes ficam sempre em bandas INTERNAS da aresta (nunca no canto), então o
 * contorno não se auto-intercepta e dois painéis vizinhos nunca disputam o mesmo
 * cubo de canto.
 *
 * O resultado é transladado para o primeiro quadrante: `rotatePath90` (nesting)
 * pressupõe minX = minY = 0, e dente que protrai para a esquerda quebraria isso.
 */
function painel(L: number, H: number, o: PainelOpts): PainelGeom {
	const ord = (d: DentePainel[] | undefined): DentePainel[] =>
		[...(d ?? [])].sort((a, b) => a.c - b.c);
	const pts: Pt[] = [{ x: 0, y: 0 }];

	if (o.recorteBase) {
		const meia = (L - o.recorteBase.largura) / 2;
		pts.push({ x: meia, y: 0 });
		pts.push({ x: meia, y: o.recorteBase.altura });
		pts.push({ x: L - meia, y: o.recorteBase.altura });
		pts.push({ x: L - meia, y: 0 });
	} else {
		for (const d of ord(o.base)) {
			pts.push({ x: d.c - d.larg / 2, y: 0 });
			pts.push({ x: d.c - d.larg / 2, y: -d.alt });
			pts.push({ x: d.c + d.larg / 2, y: -d.alt });
			pts.push({ x: d.c + d.larg / 2, y: 0 });
		}
	}
	pts.push({ x: L, y: 0 });

	for (const d of ord(o.dir)) {
		pts.push({ x: L, y: d.c - d.larg / 2 });
		pts.push({ x: L + d.alt, y: d.c - d.larg / 2 });
		pts.push({ x: L + d.alt, y: d.c + d.larg / 2 });
		pts.push({ x: L, y: d.c + d.larg / 2 });
	}
	pts.push({ x: L, y: H });

	if (o.recorteTopo) {
		const meia = (L - o.recorteTopo.largura) / 2;
		pts.push({ x: L - meia, y: H });
		pts.push({ x: L - meia, y: H - o.recorteTopo.altura });
		pts.push({ x: meia, y: H - o.recorteTopo.altura });
		pts.push({ x: meia, y: H });
	} else {
		for (const d of ord(o.topo).reverse()) {
			pts.push({ x: d.c + d.larg / 2, y: H });
			pts.push({ x: d.c + d.larg / 2, y: H + d.alt });
			pts.push({ x: d.c - d.larg / 2, y: H + d.alt });
			pts.push({ x: d.c - d.larg / 2, y: H });
		}
	}
	pts.push({ x: 0, y: H });

	for (const d of ord(o.esq).reverse()) {
		pts.push({ x: 0, y: d.c + d.larg / 2 });
		pts.push({ x: -d.alt, y: d.c + d.larg / 2 });
		pts.push({ x: -d.alt, y: d.c - d.larg / 2 });
		pts.push({ x: 0, y: d.c - d.larg / 2 });
	}

	let minX = 0;
	let minY = 0;
	for (const p of pts) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
	}
	const offX = -minX;
	const offY = -minY;
	const limpo: Pt[] = [];
	for (const p of pts) {
		const q = { x: round12(p.x + offX), y: round12(p.y + offY) };
		const u = limpo[limpo.length - 1];
		if (u && Math.abs(u.x - q.x) < 1e-9 && Math.abs(u.y - q.y) < 1e-9) continue;
		limpo.push(q);
	}
	return { pts: limpo, offX, offY };
}

/**
 * Centros das bandas INTERNAS de uma aresta dentada (as ímpares). Com `n` ímpar
 * isso exclui a primeira e a última banda, então nenhum dente encosta no canto.
 * Aresta curta demais para sobrar banda interna ganha um dente central único.
 */
function centrosInternos(fg: FingerGeometry, L: number): number[] {
	const out: number[] = [];
	for (let i = 1; i < fg.n; i += 2) out.push(round12((i + 0.5) * fg.p));
	return out.length > 0 ? out : [L / 2];
}

// ---------------------------------------------------------------------------
// Paredes: um plano (u, z) por parede, independente do modo de construção
// ---------------------------------------------------------------------------

/**
 * Uma parede da cuba vista como um plano local: `u` corre ao longo dela e `z` é
 * a altura medida a partir do fundo. Quem escreve as features (respiros, apoios
 * da grelha, gravação) não precisa saber se a parede é um painel solto ou uma
 * aba do blank dobrado — só o mapeamento muda.
 */
interface Parede {
	id: string;
	uMin: number;
	uMax: number;
	/** Altura útil da parede a partir do fundo. */
	zMax: number;
	/** Nasce de uma dobra: features perto de z = 0 respeitam 2,5t + r. */
	dobrada: boolean;
	/** Rotação (graus) de um texto para sair em pé nesta parede. */
	rotTexto: number;
	rasgo: (
		u: number,
		z: number,
		du: number,
		dz: number,
		redondo: boolean,
	) => void;
	furo: (u: number, z: number, dDesenhado: number) => void;
	grava: (u: number, z: number, str: string, h: number) => void;
	/** Linha de posicionamento para o soldador (não corta, não grava fundo). */
	marca: (u0: number, z0: number, u1: number, z1: number) => void;
}

/** Constrói uma parede a partir de um mapeamento afim (u, z) → (x, y) da peça. */
function paredeDe(
	id: string,
	dest: CadPath[],
	map: (u: number, z: number) => Pt,
	lim: { uMin: number; uMax: number; zMax: number },
	dobrada: boolean,
	rotTexto: number,
): Parede {
	const caixa = (u: number, z: number, du: number, dz: number) => {
		const a = map(u - du / 2, z - dz / 2);
		const b = map(u + du / 2, z + dz / 2);
		return {
			x: Math.min(a.x, b.x),
			y: Math.min(a.y, b.y),
			w: Math.abs(b.x - a.x),
			h: Math.abs(b.y - a.y),
		};
	};
	return {
		id,
		uMin: lim.uMin,
		uMax: lim.uMax,
		zMax: lim.zMax,
		dobrada,
		rotTexto,
		rasgo: (u, z, du, dz, redondo) => {
			const r = caixa(u, z, du, dz);
			dest.push(
				redondo
					? slot(r.x, r.y, r.w, r.h, 'CORTE')
					: rect(r.x, r.y, r.w, r.h, 'CORTE'),
			);
		},
		furo: (u, z, d) => {
			dest.push(circle(map(u, z), d / 2, 'CORTE'));
		},
		grava: (u, z, str, h) => {
			dest.push(
				text(map(u, z), str, h, 'GRAVACAO', { rot: rotTexto, anchor: 'c' }),
			);
		},
		marca: (u0, z0, u1, z1) => {
			dest.push({
				layer: 'MARCACAO',
				seg: { k: 'line', a: map(u0, z0), b: map(u1, z1) },
			});
		},
	};
}

// ---------------------------------------------------------------------------
// Distribuição de furos/rasgos por área
// ---------------------------------------------------------------------------

interface GradeResult {
	pos: Array<{ u: number; z: number }>;
	/** Área efetivamente aberta, em mm². */
	area: number;
}

/**
 * Distribui `alvo` mm² de aberturas numa janela retangular respeitando o
 * espaçamento mínimo. Devolve a grade cheia mais próxima do alvo — grade cheia,
 * não "n furos e a última fileira pela metade", porque respiro assimétrico puxa
 * a chama para um lado da cuba.
 */
function gradeDeAberturas(
	janela: { u0: number; u1: number; z0: number; z1: number },
	passoU: number,
	passoZ: number,
	areaUnidade: number,
	alvo: number,
): GradeResult {
	const larg = janela.u1 - janela.u0;
	const alt = janela.z1 - janela.z0;
	if (larg <= 0 || alt <= 0 || areaUnidade <= 0) return { pos: [], area: 0 };
	const colsMax = Math.max(1, Math.floor(larg / passoU) + 1);
	const rowsMax = Math.max(1, Math.floor(alt / passoZ) + 1);
	const nAlvo = Math.max(1, Math.round(alvo / areaUnidade));
	const proporcao = larg / alt;
	let cols = clamp(Math.round(Math.sqrt(nAlvo * proporcao)), 1, colsMax);
	let rows = clamp(Math.round(nAlvo / cols), 1, rowsMax);
	if (cols * rows > nAlvo && cols > 1)
		cols = Math.max(1, Math.floor(nAlvo / rows));
	if (cols * rows < nAlvo) {
		cols = Math.min(colsMax, Math.max(cols, Math.ceil(nAlvo / rows)));
		rows = Math.min(rowsMax, Math.max(rows, Math.round(nAlvo / cols)));
	}
	const spanU = (cols - 1) * passoU;
	const spanZ = (rows - 1) * passoZ;
	const u0 = (janela.u0 + janela.u1) / 2 - spanU / 2;
	const z0 = (janela.z0 + janela.z1) / 2 - spanZ / 2;
	const pos: Array<{ u: number; z: number }> = [];
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			pos.push({ u: round12(u0 + i * passoU), z: round12(z0 + j * passoZ) });
		}
	}
	return { pos, area: round12(pos.length * areaUnidade) };
}

/** Área de um obround (rasgo de pontas redondas) w×h. */
function areaObround(w: number, h: number): number {
	const menor = Math.min(w, h);
	const maior = Math.max(w, h);
	return menor * (maior - menor) + (Math.PI * menor * menor) / 4;
}

// ---------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------

export function buildBbq(params: BbqParams): Sketch2D {
	const warnings: string[] = [];

	// --- entradas ------------------------------------------------------------
	const t = exigePositivo(params.espessura, 'espessura');
	const k = params.kerf ?? KERF_PADRAO;
	if (!Number.isFinite(k) || k < 0) {
		throw new ToolEngineError(
			400,
			`O kerf precisa ser um número maior ou igual a zero (recebido: ${String(k)}).`,
		);
	}
	const c = params.folga ?? FOLGA_PADRAO;
	if (!Number.isFinite(c)) {
		throw new ToolEngineError(400, 'A folga precisa ser um número.');
	}
	const material: BbqMaterial = params.material ?? 'aco_carbono';
	if (!MATERIAIS.includes(material)) {
		throw new ToolEngineError(
			400,
			`Material desconhecido: "${String(material)}". Use um destes: ${MATERIAIS.join(', ')}.`,
		);
	}
	const bendMat = MATERIAL_DOBRA[material];
	const K = params.fator_k ?? K_FACTOR[bendMat];
	const construcao: BbqConstrucao = params.construcao ?? 'dobrada';
	// Raio interno igual à espessura é o padrão de chão de fábrica: matriz V de
	// 8·t, dobra limpa e sem marca de ombro.
	const r = params.raio_dobra ?? t;

	if (t > ESPESSURA_MAX_FIBRA[material]) {
		warnings.push(
			`Chapa de ${mm(t)} em ${material} passa do que uma fibra de bancada corta com ` +
				`qualidade (~${mm(ESPESSURA_MAX_FIBRA[material])}). Corte por plasma/oxicorte ` +
				'ou reduza a espessura.',
		);
	}

	// --- dimensionamento -------------------------------------------------------
	const pessoas =
		Number.isFinite(params.pessoas) && (params.pessoas ?? 0) > 0
			? Math.round(params.pessoas as number)
			: 0;
	let C: number;
	let W: number;
	if (pessoas > 0) {
		// A = 0,03 m²/pessoa com razão 2:1 → C·(C/2) = A ⇒ C = √(2A) em metros.
		const area = AREA_POR_PESSOA_M2 * pessoas;
		const bruto = Math.sqrt(RAZAO_CW * area) * 1000;
		C = round12(clamp(bruto, C_MIN, C_MAX));
		W = round12(C / RAZAO_CW);
		if (Math.abs(C - bruto) > 1e-6) {
			warnings.push(
				`O comprimento calculado para ${pessoas} pessoa(s) (${mm(bruto)}) foi limitado a ` +
					`${mm(C)}. A área de grelha resultante atende ${Math.floor(
						(C * W) / 1e6 / AREA_POR_PESSOA_M2,
					)} pessoa(s) — faça duas churrasqueiras ou aceite o rodízio.`,
			);
		}
		if (params.comprimento !== undefined || params.largura !== undefined) {
			warnings.push(
				`Comprimento e largura informados foram substituídos pelo dimensionamento ` +
					`por pessoas (${mm(C)} × ${mm(W)}). Zere "pessoas" para usar suas medidas.`,
			);
		}
	} else {
		C = exigePositivo(params.comprimento, 'comprimento');
		W = exigePositivo(params.largura, 'largura');
	}
	const H = params.profundidade ?? PROFUNDIDADE_PADRAO;
	exigePositivo(H, 'profundidade');
	const areaGrelhaM2 = round12((C * W) / 1e6);

	// --- invariantes de dobra --------------------------------------------------
	if (construcao === 'dobrada') {
		const v = validateBend({ t, r, material: bendMat, flange: H });
		if (v.fatal.length > 0) throw new ToolEngineError(400, v.fatal.join(' '));
		warnings.push(...v.warnings);
	}

	const parts: Part[] = [];
	const novaPeca = (
		id: string,
		label: string,
		paths: CadPath[],
		qty: number,
		pose: NonNullable<Part['pose']>,
		/** Onde cada instância fica, quando `qty > 1` e elas não são coincidentes. */
		poses?: NonNullable<Part['poses']>,
	): Part => {
		const bb = bboxOf(paths);
		const part: Part = {
			id,
			label,
			thickness: t,
			material,
			paths,
			bbox: { w: bb.w, h: bb.h },
			qty,
			pose,
			...(poses ? { poses } : {}),
		};
		parts.push(part);
		return part;
	};

	// --- pés: decisões que mexem nas paredes -----------------------------------
	let pes: BbqPes = params.pes ?? 'nenhum';
	const alturaPes =
		pes === 'nenhum' ? 0 : (params.altura_pes ?? ALTURA_PES_PADRAO);
	if (pes !== 'nenhum') exigePositivo(alturaPes, 'altura_pes');
	if (pes === 'abas' && construcao === 'dobrada') {
		// Na chapa dobrada a parede NASCE no fundo: não existe aba abaixo do fundo
		// para virar pé sem uma segunda dobra em sentido contrário.
		pes = 'chapa_dobrada';
		warnings.push(
			'Pés em aba não existem na construção dobrada (a parede nasce no fundo). ' +
				'Foram trocados por pés de chapa dobrada.',
		);
	}
	if (pes === 'abas' && alturaPes > PE_ABA_MAX_ALTURA) {
		warnings.push(
			`Pé em aba de ${mm(alturaPes)} é saia de chapa, não pé: ela flamba com o peso ` +
				`da churrasqueira cheia. Acima de ${mm(PE_ABA_MAX_ALTURA)} use chapa_dobrada ou cruzado_x.`,
		);
	}
	const saia = pes === 'abas' ? alturaPes : 0;

	// --- cuba ------------------------------------------------------------------
	const alvoDente = clamp(Math.max(4 * t, 20), 6, 25);
	let cavC: number;
	let cavW: number;
	let paredeFrente: Parede;
	let paredeTras: Parede;
	let paredeEsq: Parede;
	let paredeDir: Parede;
	/** Campo perfurável do fundo: (x, y, w, h) e onde empurrar os caminhos. */
	let campoFundo: {
		push: (p: CadPath) => void;
		x0: number;
		y0: number;
		w: number;
		h: number;
	};
	let planificacao: Record<string, unknown> = {};

	if (construcao === 'dobrada') {
		const bj = bandeja(C, W, H, t, k, r, K, 'Corpo');
		const paths: CadPath[] = [bj.contorno, ...bj.dobras];
		const zMax = bj.y1;
		cavC = round12(C - 2 * t);
		cavW = round12(W - 2 * t);
		const uMaxX = round12(bj.Lx - 2 * bj.ax);
		const uMaxY = round12(bj.Ly - 2 * bj.by);
		// Texto na aba frontal sai de cabeça para baixo se não girar 180°: no blank
		// o "para cima" da parede aponta para −y.
		paredeFrente = paredeDe(
			'frente',
			paths,
			(u, z) => ({ x: bj.ax + u, y: bj.y1 - z }),
			{ uMin: 0, uMax: uMaxX, zMax },
			true,
			180,
		);
		paredeTras = paredeDe(
			'tras',
			paths,
			(u, z) => ({ x: bj.ax + u, y: bj.y4 + z }),
			{ uMin: 0, uMax: uMaxX, zMax },
			true,
			0,
		);
		paredeEsq = paredeDe(
			'esquerda',
			paths,
			(u, z) => ({ x: bj.x1 - z, y: bj.by + u }),
			{ uMin: 0, uMax: uMaxY, zMax: bj.x1 },
			true,
			90,
		);
		paredeDir = paredeDe(
			'direita',
			paths,
			(u, z) => ({ x: bj.x4 + z, y: bj.by + u }),
			{ uMin: 0, uMax: uMaxY, zMax: bj.x1 },
			true,
			270,
		);
		const fx0 = round12(bj.x1 + bj.ba);
		const fy0 = round12(bj.y1 + bj.ba);
		campoFundo = {
			push: (p) => paths.push(p),
			x0: fx0,
			y0: fy0,
			w: round12(bj.x4 - bj.ba - fx0),
			h: round12(bj.y4 - bj.ba - fy0),
		};
		planificacao = {
			blank: { x: bj.Lx, y: bj.Ly },
			bend_allowance: bj.ba,
			setback: bj.sb,
			alivio_canto: {
				entalhe_x: bj.ax,
				entalhe_y: bj.by,
				tangente_x: bj.x1,
				tangente_y: bj.y1,
				largura_final: bj.alivio.largura,
				profundidade_final: bj.alivio.profundidade,
			},
		};
		novaPeca('corpo', 'Corpo planificado (fundo + 4 abas)', paths, 1, {
			pos: [0, 0, 0],
			rot: [0, 0, 0],
		});
	} else {
		const encaixada = construcao === 'encaixada';
		const Hparede = encaixada ? H : round12(H - t);
		if (Hparede <= 0) {
			throw new ToolEngineError(
				400,
				`A profundidade de ${mm(H)} não comporta o fundo de ${mm(t)}. ` +
					'Aumente a profundidade da cuba.',
			);
		}
		cavC = round12(encaixada ? C - 3 * t : C - 2 * t);
		cavW = round12(W - 2 * t);
		if (cavC <= 0 || cavW <= 0) {
			throw new ToolEngineError(
				400,
				`Chapa de ${mm(t)} não deixa cavidade em ${mm(C)} × ${mm(W)}. ` +
					'Aumente as medidas ou use chapa mais fina.',
			);
		}
		// No encaixe o fundo entra ACIMA do pé da parede. A saia que sobra abaixo
		// dele mantém o piso fora da bancada e — o que importa de verdade — deixa
		// material sob a fileira de rasgos: com o fundo rente ao pé sobra um lábio
		// de uma espessura, que rasga na primeira montagem.
		const zFundo = encaixada ? round12(Math.max(3 * t, 10)) : 0;
		/** Altura do piso da cuba acima da base do painel de parede. */
		const piso = encaixada ? round12(zFundo + t) : 0;
		const zMax = round12(Hparede - piso);
		if (zMax <= 0) {
			throw new ToolEngineError(
				400,
				`A parede fica com ${mm(zMax)} acima do piso da cuba. Aumente a profundidade.`,
			);
		}
		const larguraFrente = C;
		const larguraLateral = cavW;
		const dentes = encaixada;

		const fgV = dentes
			? fingerGeometry({ L: Hparede, t, tOposta: t, k, c, alvo: alvoDente })
			: null;
		const fgBaseX = dentes
			? fingerGeometry({ L: cavC, t, tOposta: t, k, c, alvo: alvoDente })
			: null;
		const fgBaseY = dentes
			? fingerGeometry({ L: cavW, t, tOposta: t, k, c, alvo: alvoDente })
			: null;
		const fgTopoC = dentes
			? fingerGeometry({
					L: larguraFrente,
					t,
					tOposta: t,
					k,
					c,
					alvo: alvoDente,
				})
			: null;
		const fgTopoW = dentes
			? fingerGeometry({
					L: larguraLateral,
					t,
					tOposta: t,
					k,
					c,
					alvo: alvoDente,
				})
			: null;
		for (const [L, fg] of [
			[Hparede, fgV],
			[cavC, fgBaseX],
			[cavW, fgBaseY],
		] as Array<[number, FingerGeometry | null]>) {
			if (fg) warnings.push(...assertJoint({ t, k, c, p: fg.p, n: fg.n, L }));
		}

		const denteAltura = outer(t, k);
		const fendaEsp = inner(t + c, k);
		if (dentes && fendaEsp <= 0) {
			throw new ToolEngineError(
				400,
				`O rasgo do encaixe ficaria com ${mm(fendaEsp)} de largura. ` +
					'Aumente a folga ou reduza o kerf.',
			);
		}
		const dentesDe = (fg: FingerGeometry | null, L: number): DentePainel[] =>
			fg
				? centrosInternos(fg, L).map((cc) => ({
						c: cc,
						larg: fg.denteLargura,
						alt: denteAltura,
					}))
				: [];
		const recortePe = (L: number): RecorteCentral | undefined =>
			saia > 0
				? {
						largura: round12(L - 2 * Math.max(PE_ABA_MIN, 0.12 * L)),
						altura: saia,
					}
				: undefined;

		// Paredes longas (frente/trás): mandam nos cantos verticais e recebem os
		// dentes das laterais e do fundo.
		const criaLonga = (id: string, label: string, poseY: number): Parede => {
			const geom = painel(larguraFrente, saia + Hparede, {
				topo: dentesDe(fgTopoC, larguraFrente).map((d) => ({ ...d })),
				recorteBase: recortePe(larguraFrente),
			});
			const paths: CadPath[] = [polyline(geom.pts, true, 'CORTE')];
			const pd = paredeDe(
				id,
				paths,
				// local x = 0 é o mundo x = 0, e a cavidade começa em 1,5t (encaixe) ou
				// t (solda) — daí o deslocamento do u.
				(u, z) => ({
					x: geom.offX + u + (encaixada ? 1.5 * t : t),
					y: geom.offY + saia + z + piso,
				}),
				{ uMin: 0, uMax: cavC, zMax },
				false,
				0,
			);
			novaPeca(id, label, paths, 1, {
				pos: [0, poseY, 0],
				rot: [Math.PI / 2, 0, 0],
			});
			return pd;
		};
		paredeFrente = criaLonga('frente', 'Parede frontal', 0);
		paredeTras = criaLonga('tras', 'Parede traseira', round12(W - t));

		const criaLateral = (id: string, label: string, poseX: number): Parede => {
			const geom = painel(larguraLateral, saia + Hparede, {
				esq: dentes
					? centrosInternos(fgV as FingerGeometry, Hparede).map((cc) => ({
							c: saia + cc,
							larg: (fgV as FingerGeometry).denteLargura,
							alt: denteAltura,
						}))
					: [],
				dir: dentes
					? centrosInternos(fgV as FingerGeometry, Hparede).map((cc) => ({
							c: saia + cc,
							larg: (fgV as FingerGeometry).denteLargura,
							alt: denteAltura,
						}))
					: [],
				topo: dentesDe(fgTopoW, larguraLateral),
				recorteBase: recortePe(larguraLateral),
			});
			const paths: CadPath[] = [polyline(geom.pts, true, 'CORTE')];
			const pd = paredeDe(
				id,
				paths,
				(u, z) => ({
					x: geom.offX + u,
					y: geom.offY + saia + z + piso,
				}),
				{ uMin: 0, uMax: cavW, zMax },
				false,
				0,
			);
			novaPeca(id, label, paths, 1, {
				pos: [poseX, t, 0],
				rot: [Math.PI / 2, 0, Math.PI / 2],
			});
			return pd;
		};
		paredeEsq = criaLateral('esquerda', 'Lateral esquerda', round12(t / 2));
		paredeDir = criaLateral('direita', 'Lateral direita', round12(C - 1.5 * t));

		// Fundo --------------------------------------------------------------------
		const fundoGeom = dentes
			? painel(cavC, cavW, {
					base: dentesDe(fgBaseX, cavC),
					topo: dentesDe(fgBaseX, cavC),
					esq: dentesDe(fgBaseY, cavW),
					dir: dentesDe(fgBaseY, cavW),
				})
			: painel(cavC, cavW, {});
		const fundoPaths: CadPath[] = [polyline(fundoGeom.pts, true, 'CORTE')];
		if (!dentes) {
			// Linha de posicionamento para o soldador: a face INTERNA de cada parede.
			fundoPaths.push(
				rect(t, t, round12(cavC - 2 * t), round12(cavW - 2 * t), 'MARCACAO'),
			);
		}
		campoFundo = {
			push: (p) => fundoPaths.push(p),
			x0: fundoGeom.offX,
			y0: fundoGeom.offY,
			w: cavC,
			h: cavW,
		};
		novaPeca('fundo', 'Fundo da cuba', fundoPaths, 1, {
			pos: [encaixada ? 1.5 * t : t, t, zFundo],
			rot: [0, 0, 0],
		});

		if (dentes && fgV && fgBaseX && fgBaseY) {
			// Rasgos que recebem os dentes. O dente da lateral entra DEITADO na parede
			// longa (a espessura vai no eixo u), o do fundo entra em pé — por isso os
			// dois pares (du, dz) aparecem trocados.
			for (const pd of [paredeFrente, paredeTras]) {
				for (const cc of centrosInternos(fgV, Hparede)) {
					const z = round12(cc - piso);
					pd.rasgo(0, z, fendaEsp, fgV.fendaLargura, false);
					pd.rasgo(cavC, z, fendaEsp, fgV.fendaLargura, false);
				}
				for (const cc of centrosInternos(fgBaseX, cavC)) {
					// O fundo está t/2 ABAIXO do piso da cuba (é a chapa do piso): o
					// rasgo que o recebe cai em z negativo, dentro da saia.
					pd.rasgo(cc, -t / 2, fgBaseX.fendaLargura, fendaEsp, false);
				}
			}
			for (const pd of [paredeEsq, paredeDir]) {
				for (const cc of centrosInternos(fgBaseY, cavW)) {
					pd.rasgo(cc, -t / 2, fgBaseY.fendaLargura, fendaEsp, false);
				}
			}
		}
		if (!dentes) {
			// Onde a lateral encosta na parede longa — o soldador monta sem gabarito.
			for (const pd of [paredeFrente, paredeTras]) {
				for (const u of [0, cavC]) pd.marca(u, 0, u, zMax);
			}
		}

		// Moldura de topo (só no encaixe) -------------------------------------------
		if (dentes && fgTopoC && fgTopoW) {
			const larguraBanda = Math.max(15, 5 * t);
			const mw = round12(C + 2 * MOLDURA_ABA);
			const mh = round12(W + 2 * MOLDURA_ABA);
			const abertura = {
				x: round12(MOLDURA_ABA + 1.5 * t + larguraBanda),
				y: round12(MOLDURA_ABA + t + larguraBanda),
			};
			const molduraPaths: CadPath[] = [rect(0, 0, mw, mh, 'CORTE')];
			const abW = round12(mw - 2 * abertura.x);
			const abH = round12(mh - 2 * abertura.y);
			if (abW <= 0 || abH <= 0) {
				warnings.push(
					'A moldura de topo fecharia a boca da cuba: a banda ficou mais larga que a ' +
						'própria cavidade. A moldura foi omitida.',
				);
			} else {
				molduraPaths.push(rect(abertura.x, abertura.y, abW, abH, 'CORTE'));
				for (const cc of centrosInternos(fgTopoC, larguraFrente)) {
					const x = round12(MOLDURA_ABA + cc);
					for (const y of [
						round12(MOLDURA_ABA + t / 2),
						round12(MOLDURA_ABA + W - t / 2),
					]) {
						molduraPaths.push(
							rect(
								round12(x - fgTopoC.fendaLargura / 2),
								round12(y - fendaEsp / 2),
								fgTopoC.fendaLargura,
								fendaEsp,
								'CORTE',
							),
						);
					}
				}
				for (const cc of centrosInternos(fgTopoW, larguraLateral)) {
					const y = round12(MOLDURA_ABA + t + cc);
					for (const x of [
						round12(MOLDURA_ABA + t),
						round12(MOLDURA_ABA + C - t),
					]) {
						molduraPaths.push(
							rect(
								round12(x - fendaEsp / 2),
								round12(y - fgTopoW.fendaLargura / 2),
								fendaEsp,
								fgTopoW.fendaLargura,
								'CORTE',
							),
						);
					}
				}
				novaPeca('moldura', 'Moldura de topo', molduraPaths, 1, {
					pos: [-MOLDURA_ABA, -MOLDURA_ABA, round12(Hparede - t)],
					rot: [0, 0, 0],
				});
			}
		}
	}

	const paredes = [paredeFrente, paredeTras, paredeEsq, paredeDir];
	/** Distância mínima de uma feature à linha de dobra (furo sai oval antes disso). */
	const distDobra = round12(2.5 * t + r);

	// --- níveis de apoio da grelha ---------------------------------------------
	const grelha: BbqGrelha = params.grelha ?? 'nenhuma';
	const niveisPedidos =
		grelha === 'nenhuma'
			? 0
			: Math.max(1, Math.round(params.grelha_niveis ?? GRELHA_NIVEIS_PADRAO));
	if (grelha === 'nenhuma' && params.grelha_niveis) {
		warnings.push(
			'Os níveis de grelha foram ignorados: esta churrasqueira saiu sem grelha.',
		);
	}
	const apoioDu = inner(APOIO_LARG + APOIO_SOBRA + c, k);
	const apoioDz = inner(t + c, k);
	const zTopo = Math.min(paredeFrente.zMax, paredeEsq.zMax);
	const passoNivel = Math.max(30, 0.15 * H);
	const niveis: number[] = [];
	for (let i = 0; i < niveisPedidos; i++) {
		const z = round12(0.35 * H + i * passoNivel);
		if (z + apoioDz / 2 > zTopo - Math.max(10, 2 * t)) {
			warnings.push(
				`Só couberam ${niveis.length} nível(is) de grelha em ${mm(H)} de cuba — ` +
					`o nível ${i + 1} cairia a ${mm(z)}, colado na boca. Aumente a profundidade.`,
			);
			break;
		}
		if (paredeFrente.dobrada && z - apoioDz / 2 < distDobra) {
			warnings.push(
				`O nível de grelha a ${mm(z)} fica a menos de ${mm(distDobra)} da dobra do ` +
					'fundo: o rasgo deforma junto com a chapa. Ele foi subido para fora da zona.',
			);
			niveis.push(round12(distDobra + apoioDz / 2));
			continue;
		}
		niveis.push(z);
	}
	const uApoio = (p: Parede): number[] => [
		round12(p.uMin + 0.25 * (p.uMax - p.uMin)),
		round12(p.uMin + 0.75 * (p.uMax - p.uMin)),
	];

	if (grelha === 'chapa_vazada') {
		// O apoio vai nas paredes LONGAS de propósito: assim o vão livre da grelha é
		// a MENOR dimensão da cuba, e chapa vazada flete com o quadrado do vão.
		for (const p of [paredeFrente, paredeTras]) {
			for (const z of niveis) {
				for (const u of uApoio(p)) p.rasgo(u, z, apoioDu, apoioDz, false);
			}
		}
	} else if (grelha === 'varoes_apoio') {
		const dFuro = holeDiameter(VARAO_D + c, k);
		if (dFuro <= 0.5) {
			throw new ToolEngineError(
				400,
				`O furo do varão (${mm(VARAO_D)}) some com o kerf. Reduza o kerf.`,
			);
		}
		const passoVarao = Math.max(25, 3 * VARAO_D);
		let porNivel = 0;
		for (const p of [paredeFrente, paredeTras]) {
			for (const z of niveis) {
				const util = p.uMax - p.uMin - 2 * VARAO_D * 2;
				const n = Math.max(1, Math.floor(util / passoVarao) + 1);
				porNivel = n;
				const inicio = (p.uMin + p.uMax) / 2 - ((n - 1) * passoVarao) / 2;
				for (let i = 0; i < n; i++) {
					p.furo(round12(inicio + i * passoVarao), z, dFuro);
				}
			}
		}
		if (porNivel > 0) {
			warnings.push(
				`Os varões NÃO saem do laser: compre ${porNivel} barra(s) redonda(s) de ` +
					`Ø${VARAO_D} mm com ${mm(cavW + 2 * t)} de comprimento por nível.`,
			);
		}
	}

	// --- grelha de chapa vazada -------------------------------------------------
	const passoGrelha = params.grelha_passo ?? GRELHA_PASSO_PADRAO;
	const rasgoGrelha = params.grelha_rasgo ?? GRELHA_RASGO_PADRAO;
	if (grelha === 'chapa_vazada') {
		if (!(rasgoGrelha > 0) || !(passoGrelha > rasgoGrelha)) {
			throw new ToolEngineError(
				400,
				`Passo (${mm(passoGrelha)}) e rasgo (${mm(rasgoGrelha)}) da grelha inválidos: ` +
					'o passo precisa ser maior que o rasgo, senão não sobra barra nenhuma.',
			);
		}
		// A barra é o que sobra entre dois rasgos, medida DEPOIS do corte: o rasgo é
		// vazio (desenhado k menor), então a barra desenhada já vem k mais larga.
		const barra = round12(passoGrelha - rasgoGrelha);
		const barraMin = Math.max(3, 1.5 * t);
		if (barra < barraMin - EPS) {
			warnings.push(
				`A barra da grelha ficou com ${mm(barra)} (passo ${mm(passoGrelha)} − rasgo ` +
					`${mm(rasgoGrelha)}), abaixo do mínimo de ${mm(barraMin)}. Ela entorta com o ` +
					'peso da carne — aumente o passo ou estreite o rasgo.',
			);
		}
		const gC = round12(cavC - 2 * GRELHA_FOLGA);
		const gW = round12(cavW - 2 * GRELHA_FOLGA);
		if (gC <= 0 || gW <= 0) {
			throw new ToolEngineError(
				400,
				`A cavidade de ${mm(cavC)} × ${mm(cavW)} não comporta a grelha com ` +
					`${mm(GRELHA_FOLGA)} de folga por lado.`,
			);
		}
		if (cavW > GRELHA_VAO_MAX) {
			warnings.push(
				`A grelha vence ${mm(cavW)} de vão livre (limite prático ${mm(GRELHA_VAO_MAX)}). ` +
					'Ela vai fletir com o peso — use varões ou um apoio central.',
			);
		}
		const denteGrelha = {
			larg: outer(APOIO_LARG, k),
			alt: round12(GRELHA_FOLGA + outer(t, k)),
		};
		const dentesGrelha: DentePainel[] = [0.25, 0.75].map((f) => ({
			c: round12(f * gC),
			larg: denteGrelha.larg,
			alt: denteGrelha.alt,
		}));
		const geom = painel(gC, gW, { base: dentesGrelha, topo: dentesGrelha });
		const paths: CadPath[] = [polyline(geom.pts, true, 'CORTE')];
		const borda = Math.max(GRELHA_BORDA_MIN, 2 * t);
		const campoW = round12(gC - 2 * borda);
		const campoH = round12(gW - 2 * borda);
		const rasgoDesenhado = inner(rasgoGrelha, k);
		if (campoW <= 0 || campoH <= 0 || rasgoDesenhado <= 0) {
			warnings.push(
				'A grelha ficou pequena demais para vazar: ela sai como chapa inteira. ' +
					'Aumente a churrasqueira ou reduza a borda.',
			);
		} else {
			const n = Math.max(0, Math.floor((campoH + barra) / passoGrelha));
			const ocupado = round12(n * passoGrelha - barra);
			const y0 = round12(geom.offY + borda + (campoH - ocupado) / 2);
			for (let i = 0; i < n; i++) {
				paths.push(
					slot(
						round12(geom.offX + borda),
						round12(y0 + i * passoGrelha + (rasgoGrelha - rasgoDesenhado) / 2),
						campoW,
						rasgoDesenhado,
						'CORTE',
					),
				);
			}
			if (n === 0) {
				warnings.push(
					`Nenhum rasgo coube na grelha com passo de ${mm(passoGrelha)}. ` +
						'Reduza o passo ou aumente a churrasqueira.',
				);
			}
		}
		novaPeca('grelha', 'Grelha de chapa vazada', paths, 1, {
			pos: [GRELHA_FOLGA, GRELHA_FOLGA, niveis[0] ?? 0],
			rot: [0, 0, 0],
		});
	}

	// --- respiros e cinzeiro ----------------------------------------------------
	const respiros: BbqRespiros = params.respiros ?? 'nenhum';
	const cinzeiro: BbqCinzeiro = params.cinzeiro ?? 'nenhum';
	const pct = params.respiro_area_pct ?? RESPIRO_PCT_PADRAO;
	if (!Number.isFinite(pct) || pct < 0 || pct > 40) {
		throw new ToolEngineError(
			400,
			`O parâmetro "respiro_area_pct" precisa estar entre 0 e 40 (recebido: ${String(pct)}). ` +
				'Acima disso não sobra chapa entre os respiros.',
		);
	}

	if (respiros === 'furos' || respiros === 'rasgos') {
		const ehFuro = respiros === 'furos';
		const d = RESPIRO_D;
		const larguraAb = ehFuro ? d : RESPIRO_RASGO_L;
		const alturaAb = ehFuro ? d : RESPIRO_RASGO_H;
		// Espaçamento ≥ 2d e nunca a menos de 1,0·d da borda; perto de uma dobra
		// vale a regra mais dura (2,5t + r), senão o furo sai oval.
		const passoU = round12(Math.max(2 * d, larguraAb + d));
		const passoZ = round12(Math.max(2 * d, alturaAb + d));
		const areaUnidade = ehFuro
			? (Math.PI * d * d) / 4
			: areaObround(larguraAb, alturaAb);
		for (const p of [paredeEsq, paredeDir]) {
			const margemU = round12(Math.max(d, larguraAb / 2 + d / 2));
			const zBase = round12(
				Math.max(d, alturaAb / 2 + d / 2) + (p.dobrada ? distDobra : 0),
			);
			const janela = {
				u0: round12(p.uMin + margemU),
				u1: round12(p.uMax - margemU),
				z0: zBase,
				// Respiro é entrada de ar: fica na metade de baixo, sob a brasa.
				z1: round12(Math.max(zBase, 0.45 * p.zMax)),
			};
			const alvo = (pct / 100) * (p.uMax - p.uMin) * p.zMax;
			const g = gradeDeAberturas(janela, passoU, passoZ, areaUnidade, alvo);
			if (g.pos.length === 0) {
				warnings.push(
					`Não coube nenhum respiro na parede ${p.id}: a faixa útil ficou menor que ` +
						`${mm(passoU)} × ${mm(passoZ)}. Aumente a cuba ou tire os respiros.`,
				);
				continue;
			}
			for (const pos of g.pos) {
				if (ehFuro) p.furo(pos.u, pos.z, holeDiameter(d, k));
				else
					p.rasgo(pos.u, pos.z, inner(larguraAb, k), inner(alturaAb, k), true);
			}
			const pctReal = (100 * g.area) / ((p.uMax - p.uMin) * p.zMax);
			if (Math.abs(pctReal - pct) > 0.2 * pct) {
				warnings.push(
					`Os respiros da parede ${p.id} abriram ${pctReal.toFixed(1)}% da face, e não ` +
						`os ${pct}% pedidos: o espaçamento mínimo de ${mm(passoU)} não deixa passar mais.`,
				);
			}
		}
	}

	const perfuraFundo =
		respiros === 'fundo_perfurado' || cinzeiro === 'fundo_perfurado';
	if (perfuraFundo || cinzeiro === 'gaveta') {
		const d = RESPIRO_D;
		const passo = round12(2 * d);
		const margem = round12(
			construcao === 'dobrada' ? Math.max(d, distDobra) : Math.max(d, 2 * t),
		);
		const janela = {
			u0: round12(campoFundo.x0 + margem),
			u1: round12(campoFundo.x0 + campoFundo.w - margem),
			z0: round12(campoFundo.y0 + margem),
			z1: round12(campoFundo.y0 + campoFundo.h - margem),
		};
		const alvo = (pct / 100) * campoFundo.w * campoFundo.h;
		const g = gradeDeAberturas(
			janela,
			passo,
			passo,
			(Math.PI * d * d) / 4,
			alvo,
		);
		if (g.pos.length === 0) {
			warnings.push(
				'O fundo não comportou nenhum furo respeitando a distância da dobra. ' +
					'Aumente a churrasqueira.',
			);
		}
		for (const pos of g.pos) {
			campoFundo.push(
				circle({ x: pos.u, y: pos.z }, holeDiameter(d, k) / 2, 'CORTE'),
			);
		}
	}
	if (cinzeiro === 'gaveta' && !perfuraFundo) {
		warnings.push(
			'A gaveta de cinzas só recebe cinza se o fundo for perfurado — o fundo foi ' +
				'furado automaticamente. Use respiros = fundo_perfurado para controlar a área.',
		);
	}

	if (cinzeiro === 'gaveta') {
		const cgC = round12(cavC - 2 * CINZEIRO_FOLGA);
		const cgW = round12(cavW - 2 * CINZEIRO_FOLGA);
		const bj = bandeja(cgC, cgW, CINZEIRO_ALTURA, t, k, r, K, 'Cinzeiro');
		const paths: CadPath[] = [bj.contorno, ...bj.dobras];
		// Puxador na aba frontal: rasgo obround (canto vivo em puxador rasga a mão).
		const zPuxador = CINZEIRO_ALTURA / 2;
		const folgaDobra = round12(zPuxador - PUXADOR_H / 2);
		if (folgaDobra < distDobra) {
			warnings.push(
				`O puxador do cinzeiro fica a ${mm(folgaDobra)} da dobra (mínimo ${mm(distDobra)}): ` +
					'ele vai deformar junto com a aba. Aumente a altura da gaveta.',
			);
		}
		const pw = inner(PUXADOR_L, k);
		const ph = inner(PUXADOR_H, k);
		if (pw > 0 && ph > 0 && bj.y1 > PUXADOR_H) {
			paths.push(
				slot(
					round12(bj.Lx / 2 - pw / 2),
					round12(bj.y1 - zPuxador - ph / 2),
					pw,
					ph,
					'CORTE',
				),
			);
		} else {
			warnings.push(
				'A aba frontal do cinzeiro não comporta o puxador de 60 × 12 mm — ele foi omitido.',
			);
		}
		novaPeca('cinzeiro', 'Cinzeiro (gaveta)', paths, 1, {
			pos: [CINZEIRO_FOLGA, CINZEIRO_FOLGA, -CINZEIRO_ALTURA],
			rot: [0, 0, 0],
		});
	}

	// --- pés ---------------------------------------------------------------------
	if (pes === 'chapa_dobrada') {
		const abaFix = 40;
		const pegadaPe = round12(clamp(0.3 * alturaPes, 60, 250));
		const dobra = { angulo: 90, raio: r, espessura: t, fatorK: K };
		const dev = developedLength([abaFix, alturaPes, pegadaPe], [dobra, dobra]);
		const v = validateBend({ t, r, material: bendMat, flange: abaFix });
		if (v.fatal.length > 0) throw new ToolEngineError(400, v.fatal.join(' '));
		warnings.push(...v.warnings);
		const sb = round12(r + t);
		const ba = bendAllowance(90, r, t, K);
		const larguraPe = round12(0.8 * W);
		const x1 = round12(abaFix - sb);
		const x2 = round12(x1 + ba);
		const x3 = round12(x2 + (alturaPes - 2 * sb));
		if (x3 <= x2) {
			throw new ToolEngineError(
				400,
				`Pé de ${mm(alturaPes)} some entre as duas dobras (setback de ${mm(sb)}). ` +
					'Aumente a altura dos pés.',
			);
		}
		const paths: CadPath[] = [rect(0, 0, dev, larguraPe, 'CORTE')];
		for (const x of [round12(x1 + ba / 2), round12(x3 + ba / 2)]) {
			paths.push({
				layer: 'DOBRA',
				seg: { k: 'line', a: { x, y: 0 }, b: { x, y: larguraPe } },
			});
		}
		// Os dois pés são a MESMA peça cortada duas vezes (`qty: 2`, uma linha só na
		// lista de corte), mas ficam a 20% e a 80% do comprimento — sem as duas
		// poses a montagem 3D mostraria a churrasqueira apoiada num pé só.
		const posePe = (x: number): NonNullable<Part['pose']> => ({
			pos: [round12(x * C), 0, -alturaPes],
			rot: [0, 0, 0],
		});
		novaPeca('pe', 'Pé de chapa dobrada', paths, 2, posePe(0.2), [
			posePe(0.2),
			posePe(0.8),
		]);
		if (alturaPes > Math.min(C, W)) {
			warnings.push(
				`Os pés (${mm(alturaPes)}) são mais altos que a menor dimensão da churrasqueira ` +
					`(${mm(Math.min(C, W))}). Chumbe na parede ou abra a base.`,
			);
		}
	} else if (pes === 'cruzado_x') {
		const cl = crossLap({ tOutra: t, k, c, H: alturaPes });
		if (cl.slotLarg <= 0) {
			throw new ToolEngineError(
				400,
				`O rasgo do cross lap ficaria com ${mm(cl.slotLarg)}. Reduza o kerf ou aumente a folga.`,
			);
		}
		const lenA = round12(0.8 * C);
		const lenB = round12(0.8 * W);
		const pegada = Math.min(lenA, lenB);
		// Invariante de tombamento: pegada de menos e a churrasqueira vira quando
		// alguém apoia o cotovelo na borda.
		if (pegada < 0.6 * alturaPes - EPS) {
			warnings.push(
				`Pegada dos pés em X de ${mm(pegada)} contra ${mm(alturaPes)} de altura: abaixo ` +
					`de 0,6 × altura (${mm(0.6 * alturaPes)}) a churrasqueira tomba. Reduza a altura ` +
					'ou aumente a churrasqueira.',
			);
		}
		const recorte = { largura: cl.slotLarg, altura: cl.slotProf };
		const gA = painel(lenA, alturaPes, { recorteTopo: recorte });
		const gB = painel(lenB, alturaPes, { recorteBase: recorte });
		novaPeca(
			'pe_x_a',
			'Pé em X — chapa do comprimento',
			[polyline(gA.pts, true, 'CORTE')],
			1,
			{
				pos: [round12(C / 2), round12(W / 2), -alturaPes],
				rot: [Math.PI / 2, 0, 0],
			},
		);
		novaPeca(
			'pe_x_b',
			'Pé em X — chapa da largura',
			[polyline(gB.pts, true, 'CORTE')],
			1,
			{
				pos: [round12(C / 2), round12(W / 2), -alturaPes],
				rot: [Math.PI / 2, 0, Math.PI / 2],
			},
		);
	} else if (pes === 'abas') {
		const pegada = Math.min(C, W);
		if (pegada < 0.6 * alturaPes - EPS) {
			warnings.push(
				`Pegada de ${mm(pegada)} contra ${mm(alturaPes)} de pé: abaixo de 0,6 × altura ` +
					`(${mm(0.6 * alturaPes)}) a churrasqueira tomba. Reduza a altura dos pés.`,
			);
		}
	}

	// --- gravação ----------------------------------------------------------------
	const gravacao = params.gravacao_frente?.trim();
	if (gravacao) {
		const p = paredeFrente;
		const util = p.uMax - p.uMin;
		// O comprimento do texto é quem manda: sem este teto um nome longo sai mais
		// largo que a parede e a gravação cai fora da peça.
		const larguraMax = (0.8 * util) / (gravacao.length * TEXT_WIDTH_FACTOR);
		const altura = Math.max(4, Math.min(40, 0.15 * p.zMax, larguraMax));
		const z = Math.max(
			p.dobrada ? distDobra + altura : altura,
			round12(0.15 * p.zMax),
		);
		if (z + altura > p.zMax) {
			warnings.push(
				'A parede frontal não tem altura livre para a gravação — ela foi omitida.',
			);
		} else {
			p.grava(round12((p.uMin + p.uMax) / 2), z, gravacao, altura);
			const alvo = parts.find((x) => x.id === p.id) ?? parts[0];
			// A caixa foi medida antes deste texto existir; bbox subdimensionada faz o
			// nesting reservar menos espaço do que a peça ocupa.
			const bb = bboxOf(alvo.paths);
			alvo.bbox = { w: bb.w, h: bb.h };
		}
	}

	return {
		units: 'mm',
		schema: 1,
		parts,
		meta: {
			generator: 'cad/bbq@1',
			params: {
				pessoas,
				comprimento: C,
				largura: W,
				profundidade: H,
				espessura: t,
				material,
				kerf: k,
				folga: c,
				construcao,
				raio_dobra: r,
				fator_k: K,
				pes,
				altura_pes: alturaPes,
				grelha,
				grelha_niveis: niveis.length,
				grelha_passo: passoGrelha,
				grelha_rasgo: rasgoGrelha,
				niveis_z: niveis,
				respiros,
				respiro_area_pct: pct,
				cinzeiro,
				gravacao_frente: gravacao ?? '',
				area_grelha_m2: areaGrelhaM2,
				cavidade: { comprimento: cavC, largura: cavW },
				planificacao,
				paredes: paredes.map((p) => p.id),
				dist_min_dobra: distDobra,
			},
			kerf: k,
			clearance: c,
			warnings: [...new Set(warnings)],
			stats: computeStats(parts),
		},
	};
}
