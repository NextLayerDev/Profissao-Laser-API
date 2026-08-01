/**
 * Gerador de troféu de encaixe (MDF/acrílico/compensado).
 *
 * Quatro peças, nenhuma gota de cola: BASE (chapa deitada) + DUAS HASTES em
 * cross lap a 90° + PLACA de gravação no topo.
 *
 * Por que duas hastes e não uma: uma chapa sozinha de 3 mm em pé é uma lâmina —
 * rígida no próprio plano e mole no perpendicular. Qualquer encostão lateral a
 * dobra e o troféu tomba. Duas chapas cruzadas a 90° dão rigidez nos dois eixos
 * com o mesmo material, e o cruzamento é o que trava as duas na vertical. O
 * cross lap não é decoração: é a peça estrutural do projeto.
 *
 * Convenções de montagem (3D): X = base_largura, Y = base_profundidade, Z = para
 * cima, origem no canto inferior da base. Cada peça é desenhada no seu próprio
 * plano local com origem em (0, 0) — é o que o nesting e os exportadores esperam.
 * A pose extruda no +z LOCAL (ver `assembly.ts`), então:
 * - base: `rot [0, 0, 0]` (deitada no plano XY);
 * - haste A e placa: `rot [π/2, 0, 0]` (plano XZ, material para −Y);
 * - haste B: `rot [π/2, 0, π/2]` (plano YZ, material para +X).
 *
 * Empilhamento das alturas: `altura_total = base_espessura + Hh + placa_altura`.
 *
 * Módulo PURO: só `ir`, `kerf` e `tool-errors`. Nada que leia env no topo.
 */

import { ToolEngineError } from '../../tool-errors.js';
import {
	BULGE_90,
	bboxOf,
	bulgeFromSweep,
	type CadPath,
	circle,
	computeStats,
	type Part,
	type Pt,
	polyline,
	rect,
	roundRect,
	type Sketch2D,
	TEXT_WIDTH_FACTOR,
	text,
} from '../ir.js';
import { assertJoint, crossLap, holeDiameter, inner, outer } from '../kerf.js';

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export type TrophyMaterial = 'mdf' | 'acrilico' | 'compensado';
export type TrophySilhueta = 'conica' | 'reta' | 'taca' | 'estrela';
export type TrophyPlaca = 'nenhuma' | 'retangular' | 'escudo';
export type TrophyFixacao = 'encaixe' | 'parafuso';

export interface TrophyParams {
	altura_total: number;
	espessura: number;
	material?: TrophyMaterial;
	kerf?: number;
	folga?: number;
	base_largura?: number;
	base_profundidade?: number;
	base_espessura?: number;
	silhueta?: TrophySilhueta;
	placa?: TrophyPlaca;
	placa_altura?: number;
	gravacao_placa?: string;
	gravacao_altura?: number;
	fixacao?: TrophyFixacao;
}

// ---------------------------------------------------------------------------
// Constantes de projeto
// ---------------------------------------------------------------------------

const KERF_PADRAO = 0.15;
const FOLGA_PADRAO = 0.1;

export const MATERIAIS: readonly TrophyMaterial[] = [
	'mdf',
	'acrilico',
	'compensado',
];
export const SILHUETAS: readonly TrophySilhueta[] = [
	'conica',
	'reta',
	'taca',
	'estrela',
];
export const PLACAS: readonly TrophyPlaca[] = [
	'nenhuma',
	'retangular',
	'escudo',
];
export const FIXACOES: readonly TrophyFixacao[] = ['encaixe', 'parafuso'];

/** Rótulo humano do material (vai em `Part.material` e na lista de corte). */
const MATERIAL_LABEL: Record<TrophyMaterial, string> = {
	mdf: 'MDF',
	acrilico: 'Acrílico',
	compensado: 'Compensado',
};

/** Largura da haste no pé e no topo, como fração da altura útil. */
export const LARG_BASE_FRACAO = 0.28;
export const LARG_TOPO_FRACAO = 0.14;

/**
 * Pegada mínima da base: menor lado >= 0,45 × altura total. É a regra de bolso
 * de quem já viu troféu cair de mesa — abaixo disso o centro de massa sai da
 * base com um empurrão de nada.
 */
export const PEGADA_MIN_FRACAO = 0.45;

/** Raio dos cantos da placa e da base. Canto vivo lasca no MDF e trinca no acrílico. */
export const RAIO_CANTO = 3;

/** Diâmetro nominal do furo de parafuso da placa (parafuso 2,2 mm passa folgado). */
export const FURO_PARAFUSO_D = 2.5;

/** Margem mínima entre a fenda da base e a borda da base. */
const MARGEM_BASE_MIN = 4;

/** Ponte de material mínima entre as fendas das duas hastes, no centro da base. */
const PONTE_BASE_MIN = 2;

/** Perna do cross lap mais fina que isto quebra ao montar. */
const PERNA_MIN = 3;

/** Fração da altura da placa que a haste pode invadir na fixação por parafuso. */
const SOBREPOSICAO_MAX_PCT = 0.5;

/** Tolerância de comparação de coordenadas (mm), bem acima do ruído de float. */
const EPS = 1e-6;

function round12(v: number): number {
	return Math.round(v * 1e12) / 1e12;
}

const mm = (v: number): string => `${Math.round(v * 100) / 100} mm`;

function exigePositivo(v: number | undefined, nome: string): number {
	if (v === undefined || !Number.isFinite(v) || v <= 0) {
		throw new ToolEngineError(
			400,
			`O parâmetro "${nome}" precisa ser um número maior que zero (recebido: ${String(v)}).`,
		);
	}
	return v;
}

function exigeOpcao<T extends string>(
	valor: T | undefined,
	permitidos: readonly T[],
	padrao: T,
	nome: string,
): T {
	if (valor === undefined) return padrao;
	if (!permitidos.includes(valor)) {
		throw new ToolEngineError(
			400,
			`Valor inválido para "${nome}": "${String(valor)}". Use um destes: ${permitidos.join(', ')}.`,
		);
	}
	return valor;
}

// ---------------------------------------------------------------------------
// Silhueta
// ---------------------------------------------------------------------------

/** Amostra do perfil: `f` = fração da altura útil, `meia` = meia-largura em mm. */
interface Amostra {
	f: number;
	meia: number;
}

/**
 * Perfil da metade DIREITA da haste, do ombro da base (f = 0) ao topo (f = 1).
 *
 * As quatro silhuetas compartilham o mesmo par de referência — `meiaBase` no pé
 * e `meiaTopo` no topo — e nenhuma passa de `meiaBase`. Isso é de propósito: a
 * caixa envolvente da haste fica igual nas quatro (largura = largura do pé), o
 * nesting não muda de comportamento quando o aluno troca a silhueta, e o topo
 * sempre entrega a MESMA largura de apoio para a placa.
 */
function perfilHaste(
	sil: TrophySilhueta,
	meiaBase: number,
	meiaTopo: number,
): Amostra[] {
	switch (sil) {
		case 'reta':
			// Coluna reta com um pequeno plinto no pé: usa as duas larguras de
			// referência sem afinar ao longo do corpo.
			return [
				{ f: 0, meia: meiaBase },
				{ f: 0.06, meia: meiaBase },
				{ f: 0.12, meia: meiaTopo },
				{ f: 1, meia: meiaTopo },
			];
		case 'taca':
			// Pé largo, garganta, talo fino e bojo que reabre até a largura do pé —
			// e fecha no colo, onde a placa se apoia.
			return [
				{ f: 0, meia: meiaBase },
				{ f: 0.07, meia: meiaBase },
				{ f: 0.14, meia: 0.45 * meiaBase },
				{ f: 0.5, meia: 0.4 * meiaBase },
				{ f: 0.6, meia: 0.55 * meiaBase },
				{ f: 0.82, meia: meiaBase },
				{ f: 0.92, meia: 0.8 * meiaBase },
				{ f: 1, meia: meiaTopo },
			];
		case 'estrela':
			// Coluna afinada com três pontas alternadas no terço superior.
			return [
				{ f: 0, meia: meiaBase },
				{ f: 0.06, meia: meiaBase },
				{ f: 0.12, meia: 0.5 * meiaBase },
				{ f: 0.55, meia: 0.45 * meiaBase },
				{ f: 0.6, meia: 0.32 * meiaBase },
				{ f: 0.66, meia: meiaBase },
				{ f: 0.72, meia: 0.38 * meiaBase },
				{ f: 0.78, meia: 0.95 * meiaBase },
				{ f: 0.84, meia: 0.36 * meiaBase },
				{ f: 0.9, meia: 0.62 * meiaBase },
				{ f: 0.95, meia: meiaTopo },
				{ f: 1, meia: meiaTopo },
			];
		default:
			return [
				{ f: 0, meia: meiaBase },
				{ f: 1, meia: meiaTopo },
			];
	}
}

/** Largura da haste numa fração qualquer da altura (interpolação linear). */
function larguraEm(perfil: Amostra[], f: number): number {
	if (f <= perfil[0].f) return 2 * perfil[0].meia;
	const ultimo = perfil[perfil.length - 1];
	if (f >= ultimo.f) return 2 * ultimo.meia;
	for (let i = 1; i < perfil.length; i++) {
		const a = perfil[i - 1];
		const b = perfil[i];
		if (f <= b.f) {
			const razao = (f - a.f) / (b.f - a.f);
			return 2 * (a.meia + razao * (b.meia - a.meia));
		}
	}
	return 2 * ultimo.meia;
}

/** Menor largura da haste no trecho [f0, f1] — onde a fenda do cross lap corre. */
function larguraMinima(perfil: Amostra[], f0: number, f1: number): number {
	let min = Math.min(larguraEm(perfil, f0), larguraEm(perfil, f1));
	for (const a of perfil) {
		if (a.f > f0 + EPS && a.f < f1 - EPS) min = Math.min(min, 2 * a.meia);
	}
	return min;
}

// ---------------------------------------------------------------------------
// Contorno da haste
// ---------------------------------------------------------------------------

interface Vao {
	x0: number;
	x1: number;
}

interface HasteOpts {
	/** Largura da caixa envolvente (= largura do pé, a maior do perfil). */
	wMax: number;
	perfil: Amostra[];
	/** Altura útil do corpo, do ombro da base ao topo. */
	Hh: number;
	/** Altura DESENHADA da espiga do pé (atravessa a base e fica rente). */
	hEspigaPe: number;
	espigasPe: Vao[];
	/** Onde fica a fenda do cross lap: metade de cima ou metade de baixo. */
	fenda: 'topo' | 'base';
	/** Largura e profundidade DESENHADAS da fenda do cross lap. */
	slotLarg: number;
	slotProf: number;
	/** Prolongamento das pernas acima do corpo (aba escondida atrás da placa). */
	sobra: number;
	/** Espigas no topo, já DESENHADAS, que entram nos entalhes da placa. */
	espigasTopo: Array<Vao & { alt: number }>;
}

/**
 * Contorno fechado da haste, anti-horário, começando na borda esquerda do ombro.
 *
 * Quatro regiões, nesta ordem de percurso: aresta inferior (com as espigas do pé
 * descendo até y = 0 e, na haste de baixo, a fenda do cross lap subindo pelo vão
 * central), perfil direito, aresta do topo (com a fenda do cross lap na haste de
 * cima ou as espigas da placa) e perfil esquerdo.
 *
 * A fenda da haste de BAIXO nasce no vão entre as duas espigas — que já é vazio
 * de y = 0 até o ombro. Sem isso a fenda seria um bolso fechado e as duas hastes
 * não teriam por onde deslizar uma na outra.
 */
function contornoHaste(o: HasteOpts): Pt[] {
	const xc = o.wMax / 2;
	const hE = o.hEspigaPe;
	const topoCorpo = round12(hE + o.Hh);
	const topo = round12(topoCorpo + o.sobra);
	const meiaTopo = o.perfil[o.perfil.length - 1].meia;
	const pts: Pt[] = [];
	const add = (x: number, y: number): void => {
		pts.push({ x: round12(x), y: round12(y) });
	};

	// --- aresta inferior -------------------------------------------------------
	add(xc - o.perfil[0].meia, hE);
	const e1 = o.espigasPe[0];
	const e2 = o.espigasPe[1];
	add(e1.x0, hE);
	add(e1.x0, 0);
	add(e1.x1, 0);
	add(e1.x1, hE);
	if (o.fenda === 'base') {
		add(xc - o.slotLarg / 2, hE);
		add(xc - o.slotLarg / 2, hE + o.slotProf);
		add(xc + o.slotLarg / 2, hE + o.slotProf);
		add(xc + o.slotLarg / 2, hE);
	}
	add(e2.x0, hE);
	add(e2.x0, 0);
	add(e2.x1, 0);
	add(e2.x1, hE);
	add(xc + o.perfil[0].meia, hE);

	// --- perfil direito, subindo ----------------------------------------------
	for (let i = 1; i < o.perfil.length; i++) {
		add(xc + o.perfil[i].meia, hE + o.perfil[i].f * o.Hh);
	}
	if (o.sobra > 0) add(xc + meiaTopo, topo);

	// --- aresta do topo, da direita para a esquerda ---------------------------
	// Ordem espelhada: espiga direita, fenda central, espiga esquerda.
	const espDir = o.espigasTopo.filter((e) => e.x0 > xc);
	const espEsq = o.espigasTopo.filter((e) => e.x0 <= xc);
	for (const e of espDir) {
		add(e.x1, topo);
		add(e.x1, topo + e.alt);
		add(e.x0, topo + e.alt);
		add(e.x0, topo);
	}
	if (o.fenda === 'topo') {
		// A profundidade útil é medida do TOPO DO CORPO: a sobra da aba de parafuso
		// alonga o rasgo, mas não muda o quanto as duas hastes se abraçam.
		const fundo = round12(topoCorpo - o.slotProf);
		add(xc + o.slotLarg / 2, topo);
		add(xc + o.slotLarg / 2, fundo);
		add(xc - o.slotLarg / 2, fundo);
		add(xc - o.slotLarg / 2, topo);
	}
	for (const e of espEsq) {
		add(e.x1, topo);
		add(e.x1, topo + e.alt);
		add(e.x0, topo + e.alt);
		add(e.x0, topo);
	}
	if (o.sobra > 0) add(xc - meiaTopo, topo);

	// --- perfil esquerdo, descendo --------------------------------------------
	for (let i = o.perfil.length - 1; i >= 1; i--) {
		add(xc - o.perfil[i].meia, hE + o.perfil[i].f * o.Hh);
	}

	// Vértice repetido trava alguns CAMs; e o último ponto não pode coincidir com
	// o primeiro (o fechamento da polilinha é implícito).
	const limpo: Pt[] = [];
	for (const p of pts) {
		const u = limpo[limpo.length - 1];
		if (u && Math.abs(u.x - p.x) <= EPS && Math.abs(u.y - p.y) <= EPS) continue;
		limpo.push(p);
	}
	const primeiro = limpo[0];
	const ultimo = limpo[limpo.length - 1];
	if (
		limpo.length > 1 &&
		Math.abs(primeiro.x - ultimo.x) <= EPS &&
		Math.abs(primeiro.y - ultimo.y) <= EPS
	) {
		limpo.pop();
	}
	return limpo;
}

// ---------------------------------------------------------------------------
// Contorno da placa
// ---------------------------------------------------------------------------

/** Entalhe aberto na aresta inferior da placa (recebe a espiga do topo da haste). */
interface Entalhe {
	x0: number;
	x1: number;
	prof: number;
}

/** Curvatura das laterais do escudo: 30° de varrido, convexo para fora. */
const BULGE_ESCUDO = bulgeFromSweep(Math.PI / 6);

/** Altura, em fração da altura da placa, onde o escudo começa a fechar. */
const ESCUDO_OMBRO = 0.55;

/** Largura da aresta inferior reta do escudo, em fração da largura. */
const ESCUDO_BASE_PCT = 0.55;

/**
 * Contorno da placa com os entalhes na aresta inferior. Devolve pontos e bulges
 * (os cantos são arcos de 90°, não polilinha facetada — mesma razão do
 * `roundRect`). Sem entalhes, a placa retangular usa `roundRect` direto.
 */
function contornoPlaca(
	tipo: 'retangular' | 'escudo',
	w: number,
	h: number,
	r: number,
	entalhes: Entalhe[],
): { pts: Pt[]; bulges: number[] } {
	const pts: Pt[] = [];
	const bulges: number[] = [];
	const add = (x: number, y: number, b = 0): void => {
		pts.push({ x: round12(x), y: round12(y) });
		bulges.push(b);
	};
	const entalhesOrdenados = [...entalhes].sort((a, b) => a.x0 - b.x0);
	const bordaEntalhes = (): void => {
		for (const e of entalhesOrdenados) {
			add(e.x0, 0);
			add(e.x0, e.prof);
			add(e.x1, e.prof);
			add(e.x1, 0);
		}
	};

	if (tipo === 'escudo') {
		const xb0 = ((1 - ESCUDO_BASE_PCT) / 2) * w;
		const xb1 = w - xb0;
		const yOmbro = ESCUDO_OMBRO * h;
		add(xb0, 0);
		bordaEntalhes();
		add(xb1, 0, BULGE_ESCUDO);
		add(w, yOmbro);
		add(w, h - r, BULGE_90);
		add(w - r, h);
		add(r, h, BULGE_90);
		add(0, h - r);
		add(0, yOmbro, BULGE_ESCUDO);
		return { pts, bulges };
	}

	add(r, 0);
	bordaEntalhes();
	add(w - r, 0, BULGE_90);
	add(w, r);
	add(w, h - r, BULGE_90);
	add(w - r, h);
	add(r, h, BULGE_90);
	add(0, h - r);
	add(0, r, BULGE_90);
	return { pts, bulges };
}

// ---------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------

export function buildTrophy(params: TrophyParams): Sketch2D {
	const warnings: string[] = [];

	// --- entrada ---------------------------------------------------------------
	const H = exigePositivo(params.altura_total, 'altura_total');
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
	const material = exigeOpcao(params.material, MATERIAIS, 'mdf', 'material');
	const silhueta = exigeOpcao(params.silhueta, SILHUETAS, 'conica', 'silhueta');
	const fixacao = exigeOpcao(params.fixacao, FIXACOES, 'encaixe', 'fixacao');
	let placa = exigeOpcao(params.placa, PLACAS, 'retangular', 'placa');

	// Base default a 0,5 × altura: acima da pegada mínima de 0,45, sem virar
	// prato. Espessura da base default ao dobro da chapa — base é peso.
	const W = params.base_largura ?? round12(0.5 * H);
	const D = params.base_profundidade ?? round12(0.5 * H);
	exigePositivo(W, 'base_largura');
	exigePositivo(D, 'base_profundidade');
	const tb = params.base_espessura ?? Math.max(2 * t, 6);
	exigePositivo(tb, 'base_espessura');

	let placaAltura = params.placa_altura ?? round12(0.16 * H);
	if (placa !== 'nenhuma' && !(placaAltura > 0)) {
		warnings.push(
			`A placa foi pedida com altura ${mm(placaAltura)} — sem altura não há placa. ` +
				'Informe "placa_altura" maior que zero.',
		);
		placa = 'nenhuma';
	}
	if (placa === 'nenhuma') placaAltura = 0;

	// Invariantes de chapa/kerf antes de qualquer geometria (kerf >= espessura é
	// fatal: o feixe é mais largo que o material).
	warnings.push(
		...assertJoint({
			t,
			k,
			c,
			furos:
				placa !== 'nenhuma' && fixacao === 'parafuso' ? [FURO_PARAFUSO_D] : [],
		}),
	);

	// --- alturas ---------------------------------------------------------------
	const Hh = round12(H - tb - placaAltura);
	if (Hh <= 0) {
		throw new ToolEngineError(
			400,
			`A altura total de ${mm(H)} não sobra nada para a haste depois da base ` +
				`(${mm(tb)}) e da placa (${mm(placaAltura)}). Aumente a altura total ou ` +
				'reduza a base/placa.',
		);
	}
	if (placaAltura > 0.4 * H) {
		warnings.push(
			`A placa (${mm(placaAltura)}) ocupa mais de 40% da altura total (${mm(H)}): ` +
				'sobra pouca haste e o troféu vira letreiro. Reduza "placa_altura".',
		);
	}

	const wPe = round12(LARG_BASE_FRACAO * Hh);
	const wTopo = round12(LARG_TOPO_FRACAO * Hh);
	const perfil = perfilHaste(silhueta, wPe / 2, wTopo / 2);
	const xc = wPe / 2;

	// --- cross lap -------------------------------------------------------------
	// H = Hh: as DUAS fendas somadas têm de dar a altura útil da haste, senão as
	// duas chapas disputam o mesmo espaço (fenda mais funda que a metade) ou
	// sobra vão no cruzamento e elas escorregam na vertical (fenda mais rasa).
	const cl = crossLap({ tOutra: t, k, c, H: Hh });
	if (cl.slotLarg <= 0) {
		throw new ToolEngineError(
			400,
			`A fenda do cross lap ficaria com ${mm(cl.slotLarg)} de largura. ` +
				'Reduza o kerf ou aumente a folga.',
		);
	}
	if (cl.slotProf <= 0) {
		throw new ToolEngineError(
			400,
			`A fenda do cross lap ficaria com ${mm(cl.slotProf)} de profundidade. ` +
				'Aumente a altura total do troféu.',
		);
	}
	// A fenda de cima corre de f = 0,5 a 1; a de baixo, de 0 a 0,5. A perna mais
	// fina do cruzamento manda no aviso.
	const larguraMinCruz = Math.min(
		larguraMinima(perfil, 0.5, 1),
		larguraMinima(perfil, 0, 0.5),
	);
	const pernaCruz = round12((larguraMinCruz - cl.slotLarg) / 2);
	const pernaMin = Math.max(PERNA_MIN, t);
	if (pernaCruz < pernaMin) {
		warnings.push(
			`As pernas do cross lap ficam com ${mm(Math.max(0, pernaCruz))} de largura ` +
				`(mínimo ${mm(pernaMin)}): elas quebram ao montar. Aumente a altura total ` +
				'(a haste engorda com ela) ou use uma silhueta menos afinada.',
		);
	}

	// --- espigas do pé e fendas da base ---------------------------------------
	// Duas espigas de w/3, passantes e rentes: a altura DESENHADA leva +k para
	// sair exatamente `tb` e ficar rasante com a face de baixo da base.
	const espPeNominal = round12(wPe / 3);
	const espPeLarg = outer(espPeNominal, k);
	const hEspigaPe = outer(tb, k);
	if (espPeLarg <= 0) {
		throw new ToolEngineError(
			400,
			`A espiga do pé ficaria com ${mm(espPeLarg)} de largura. ` +
				'Aumente a altura total do troféu ou reduza o kerf.',
		);
	}
	// Espigas centradas em ±w/4: sobra ombro nas duas bordas e um vão no meio
	// por onde passa a fenda do cross lap da haste de baixo.
	const espigasPe: Vao[] = [
		{
			x0: round12(xc - wPe / 4 - espPeLarg / 2),
			x1: round12(xc - wPe / 4 + espPeLarg / 2),
		},
		{
			x0: round12(xc + wPe / 4 - espPeLarg / 2),
			x1: round12(xc + wPe / 4 + espPeLarg / 2),
		},
	];
	const vaoCentral = round12(espigasPe[1].x0 - espigasPe[0].x1);
	if (vaoCentral <= cl.slotLarg + 1) {
		warnings.push(
			`O vão entre as espigas do pé (${mm(vaoCentral)}) não deixa a fenda do cross ` +
				`lap (${mm(cl.slotLarg)}) passar com folga. Aumente a altura total do troféu ` +
				'ou use chapa mais fina.',
		);
	}

	const fendaBaseLarg = inner(espPeNominal + c, k);
	const fendaBaseEsp = inner(t + c, k);
	if (fendaBaseLarg <= 0 || fendaBaseEsp <= 0) {
		throw new ToolEngineError(
			400,
			`A fenda da base ficaria com ${mm(Math.min(fendaBaseLarg, fendaBaseEsp))}. ` +
				'Reduza o kerf ou aumente a folga.',
		);
	}

	// --- base: cabe? -----------------------------------------------------------
	const pegada = Math.min(W, D);
	const pegadaMin = round12(PEGADA_MIN_FRACAO * H);
	if (pegada < pegadaMin - EPS) {
		warnings.push(
			`A base mede ${mm(W)} × ${mm(D)} para um troféu de ${mm(H)} de altura: o menor ` +
				`lado precisa de ${mm(pegadaMin)} (0,45 × altura) para não tombar — faltam ` +
				`${mm(pegadaMin - pegada)}. Aumente base_largura e base_profundidade para ` +
				`pelo menos ${mm(pegadaMin)}.`,
		);
	}
	const alcanceFenda = round12(wPe / 4 + fendaBaseLarg / 2);
	const margemX = round12(W / 2 - alcanceFenda);
	const margemY = round12(D / 2 - alcanceFenda);
	if (Math.min(margemX, margemY) < MARGEM_BASE_MIN) {
		warnings.push(
			`As fendas da base chegam a ${mm(Math.min(margemX, margemY))} da borda ` +
				`(mínimo ${mm(MARGEM_BASE_MIN)}): a base racha na montagem. Aumente a base ` +
				`para pelo menos ${mm(2 * (alcanceFenda + MARGEM_BASE_MIN))} em cada lado.`,
		);
	}
	// Ponte de material entre a fenda de uma haste e a da outra, no centro da base:
	// a fenda comprida de uma chega a `wPe/4 − fendaBaseLarg/2` do centro e a fenda
	// estreita da outra ocupa `fendaBaseEsp/2`. O mesmo número vale nos dois eixos.
	const ponte = round12(wPe / 4 - fendaBaseLarg / 2 - fendaBaseEsp / 2);
	if (ponte < PONTE_BASE_MIN) {
		warnings.push(
			`A ponte de material entre as fendas das duas hastes tem ${mm(Math.max(0, ponte))} ` +
				`(mínimo ${mm(PONTE_BASE_MIN)}): o centro da base solta. Aumente a altura total ` +
				'do troféu ou use chapa mais fina.',
		);
	}
	if (tb < 1.5 * t) {
		warnings.push(
			`A base tem ${mm(tb)} contra ${mm(t)} da haste: base fina não dá peso nem ` +
				`aperto às espigas. Use pelo menos ${mm(1.5 * t)} na base.`,
		);
	}

	// --- avisos de material ----------------------------------------------------
	if (material === 'acrilico' && c < 0.15) {
		warnings.push(
			`Acrílico não perdoa encaixe forçado: com folga de ${mm(c)} a peça trinca ao ` +
				'montar. Use folga de 0,15 mm a 0,25 mm.',
		);
	}
	if (material === 'compensado') {
		warnings.push(
			'Compensado lasca na saída do feixe e o kerf real varia com a lâmina de cola: ' +
				'corte um cupom de teste do encaixe antes da peça final.',
		);
	}
	// Esbeltez: a haste é uma chapa em pé, e a flecha na ponta cresce com o cubo
	// da altura. 1 mm de chapa por 120 mm de troféu (nunca menos de 3 mm) é o que
	// segura a ponta sem tremer quando alguém pega o troféu pela placa.
	const espessuraMin = round12(Math.max(3, H / 120));
	if (t < espessuraMin - EPS) {
		warnings.push(
			`Chapa de ${mm(t)} num troféu de ${mm(H)}: as hastes flexionam e a placa ` +
				`treme. Use pelo menos ${mm(espessuraMin)}.`,
		);
	}

	// --- placa: largura, espigas do topo e aba de parafuso --------------------
	const gravacao = params.gravacao_placa?.trim() ?? '';
	const alturaTextoPedida =
		params.gravacao_altura ?? Math.max(4, round12(0.35 * placaAltura));
	if (!Number.isFinite(alturaTextoPedida) || alturaTextoPedida <= 0) {
		throw new ToolEngineError(
			400,
			`O parâmetro "gravacao_altura" precisa ser maior que zero (recebido: ${String(
				params.gravacao_altura,
			)}).`,
		);
	}

	// Largura da placa: o dobro e pouco do topo da haste, ou o que o texto pedir,
	// nunca mais que a base (placa em voadeira sobre a base fica pior que pequena).
	const larguraTexto = gravacao
		? (gravacao.length * alturaTextoPedida * TEXT_WIDTH_FACTOR) / 0.85
		: 0;
	const wPlaca =
		placa === 'nenhuma'
			? 0
			: round12(Math.min(W, Math.max(2.2 * wTopo, wTopo + 8, larguraTexto)));

	// Perna do topo (o que sobra da largura do topo depois da fenda do cross lap)
	// e centro dela — é onde a placa se apoia, encaixada ou aparafusada.
	const pernaTopo = round12((wTopo - cl.slotLarg) / 2);
	const dPerna = round12((cl.slotLarg / 2 + wTopo / 2) / 2);

	const temPlaca = placa !== 'nenhuma';
	const porParafuso = temPlaca && fixacao === 'parafuso';
	// Aba: a haste sobe um pouco ATRÁS da placa para o parafuso ter o que morder.
	// Ela não muda a altura total — a placa é que cresce para baixo o mesmo tanto.
	const sobra = porParafuso
		? round12(
				Math.min(
					Math.max(3 * t, 10),
					SOBREPOSICAO_MAX_PCT * placaAltura,
					0.5 * cl.slotProfFinal,
				),
			)
		: 0;

	let espigaPlacaLarg = 0;
	let espigaPlacaAlt = 0;
	const espigasTopo: Array<Vao & { alt: number }> = [];
	const entalhesPlaca: Entalhe[] = [];
	if (temPlaca && !porParafuso) {
		const nominalLarg = round12(Math.max(2.5, 0.6 * pernaTopo));
		const nominalAlt = round12(Math.min(Math.max(2 * t, 6), 0.4 * placaAltura));
		if (pernaTopo < nominalLarg + 1 || nominalAlt <= 0) {
			warnings.push(
				`As pernas do topo têm ${mm(Math.max(0, pernaTopo))} — não comportam espiga ` +
					'para a placa. A placa fica apenas apoiada: use fixacao "parafuso" ou ' +
					'aumente a altura total do troféu.',
			);
		} else {
			espigaPlacaLarg = outer(nominalLarg, k);
			espigaPlacaAlt = outer(nominalAlt, k);
			for (const sinal of [-1, 1]) {
				const centro = round12(xc + sinal * dPerna);
				espigasTopo.push({
					x0: round12(centro - espigaPlacaLarg / 2),
					x1: round12(centro + espigaPlacaLarg / 2),
					alt: espigaPlacaAlt,
				});
				// O entalhe da placa é o negativo da espiga: largura com +c e fundo com
				// +c também, para a placa assentar no OMBRO da perna e não no fundo do
				// entalhe (assentar no fundo deixa a placa boiando acima do ombro).
				const centroPlaca = round12(wPlaca / 2 + sinal * dPerna);
				const larg = inner(nominalLarg + c, k);
				entalhesPlaca.push({
					x0: round12(centroPlaca - larg / 2),
					x1: round12(centroPlaca + larg / 2),
					prof: round12(nominalAlt + c - k / 2),
				});
			}
		}
	}
	if (porParafuso && pernaTopo < FURO_PARAFUSO_D + 3) {
		warnings.push(
			`A perna do topo tem ${mm(Math.max(0, pernaTopo))} para um furo de ` +
				`${mm(FURO_PARAFUSO_D)}: sobra menos de 1,5 mm de borda e o furo arrebenta. ` +
				'Aumente a altura total do troféu.',
		);
	}
	if (porParafuso) {
		warnings.push(
			'Na fixação por parafuso a placa é aparafusada na FACE das hastes (2 furos ' +
				`de ${mm(FURO_PARAFUSO_D)}): use parafuso M2 com porca ou parafuso de ` +
				'cabeça chata do lado da gravação.',
		);
	}

	// --- peças -----------------------------------------------------------------
	const parts: Part[] = [];
	const novaPeca = (
		id: string,
		label: string,
		paths: CadPath[],
		espessuraPeca: number,
		pose: NonNullable<Part['pose']>,
	): Part => {
		const bb = bboxOf(paths);
		const part: Part = {
			id,
			label,
			thickness: espessuraPeca,
			material: MATERIAL_LABEL[material],
			paths,
			bbox: { w: bb.w, h: bb.h },
			qty: 1,
			pose,
		};
		parts.push(part);
		return part;
	};

	// Base: contorno + 4 fendas passantes (2 por haste). Fenda para espiga de
	// canto vivo é RETÂNGULO, não `slot`: ponta arredondada deixaria a espiga
	// quadrada apoiada só no meio e com vão nos cantos.
	const basePaths: CadPath[] = [roundRect(0, 0, W, D, RAIO_CANTO, 'CORTE')];
	for (const sinal of [-1, 1]) {
		// Haste A corre em X: fenda comprida em X, na linha central em Y.
		basePaths.push(
			rect(
				round12(W / 2 + sinal * (wPe / 4) - fendaBaseLarg / 2),
				round12(D / 2 - fendaBaseEsp / 2),
				fendaBaseLarg,
				fendaBaseEsp,
				'CORTE',
			),
		);
		// Haste B corre em Y: a mesma fenda girada 90°.
		basePaths.push(
			rect(
				round12(W / 2 - fendaBaseEsp / 2),
				round12(D / 2 + sinal * (wPe / 4) - fendaBaseLarg / 2),
				fendaBaseEsp,
				fendaBaseLarg,
				'CORTE',
			),
		);
	}
	novaPeca('base', 'Base', basePaths, tb, { pos: [0, 0, 0], rot: [0, 0, 0] });

	// Haste A (fenda no topo) — é ela que carrega a placa.
	const hasteA = contornoHaste({
		wMax: wPe,
		perfil,
		Hh,
		hEspigaPe,
		espigasPe,
		fenda: 'topo',
		slotLarg: cl.slotLarg,
		slotProf: cl.slotProf,
		sobra,
		espigasTopo,
	});
	const pathsA: CadPath[] = [polyline(hasteA, true, 'CORTE')];
	if (porParafuso) {
		for (const sinal of [-1, 1]) {
			pathsA.push(
				circle(
					{
						x: round12(xc + sinal * dPerna),
						y: round12(hEspigaPe + Hh - sobra / 2),
					},
					holeDiameter(FURO_PARAFUSO_D, k) / 2,
					'CORTE',
				),
			);
		}
	}
	novaPeca('haste_topo', 'Haste — fenda no topo', pathsA, t, {
		pos: [round12((W - wPe) / 2), round12(D / 2 + t / 2), 0],
		rot: [Math.PI / 2, 0, 0],
	});

	// Haste B (fenda na base), girada 90° em Z.
	const hasteB = contornoHaste({
		wMax: wPe,
		perfil,
		Hh,
		hEspigaPe,
		espigasPe,
		fenda: 'base',
		slotLarg: cl.slotLarg,
		slotProf: cl.slotProf,
		sobra: 0,
		espigasTopo: [],
	});
	novaPeca(
		'haste_base',
		'Haste — fenda na base',
		[polyline(hasteB, true, 'CORTE')],
		t,
		{
			pos: [round12(W / 2 - t / 2), round12((D - wPe) / 2), 0],
			rot: [Math.PI / 2, 0, Math.PI / 2],
		},
	);

	// Placa.
	if (temPlaca) {
		// `placa` é reatribuível (cai para 'nenhuma' se vier sem altura), então o
		// tipo é fixado aqui — dentro do bloco 'nenhuma' já está descartado.
		const tipoPlaca: 'retangular' | 'escudo' =
			placa === 'escudo' ? 'escudo' : 'retangular';
		const hPlaca = round12(placaAltura + sobra);
		const raio = Math.min(RAIO_CANTO, wPlaca / 4, hPlaca / 4);
		const contorno: CadPath =
			tipoPlaca === 'retangular' && entalhesPlaca.length === 0
				? roundRect(0, 0, wPlaca, hPlaca, raio, 'CORTE')
				: (() => {
						const g = contornoPlaca(
							tipoPlaca,
							wPlaca,
							hPlaca,
							raio,
							entalhesPlaca,
						);
						return polyline(g.pts, true, 'CORTE', g.bulges);
					})();
		const pathsPlaca: CadPath[] = [contorno];
		if (porParafuso) {
			for (const sinal of [-1, 1]) {
				pathsPlaca.push(
					circle(
						{
							x: round12(wPlaca / 2 + sinal * dPerna),
							y: round12(sobra / 2),
						},
						holeDiameter(FURO_PARAFUSO_D, k) / 2,
						'CORTE',
					),
				);
			}
		}

		// Gravação: centrada na parte VISÍVEL da placa (a aba de parafuso fica
		// escondida atrás/abaixo). No escudo o centro óptico sobe: a ponta de baixo
		// não é área útil.
		const yBase = sobra;
		const bandaVisivel = placaAltura;
		if (gravacao) {
			const larguraMax =
				(0.85 * wPlaca) / Math.max(1, gravacao.length * TEXT_WIDTH_FACTOR);
			const alturaTexto = Math.min(
				alturaTextoPedida,
				0.6 * bandaVisivel,
				larguraMax,
			);
			if (alturaTexto < alturaTextoPedida - EPS) {
				warnings.push(
					`A gravação "${gravacao}" não cabe a ${mm(alturaTextoPedida)} na placa de ` +
						`${mm(wPlaca)} × ${mm(placaAltura)}: a altura do texto caiu para ` +
						`${mm(alturaTexto)}. Encurte o texto, aumente a placa ou reduza ` +
						'"gravacao_altura".',
				);
			}
			if (alturaTexto < 1.5) {
				warnings.push(
					`A ${mm(alturaTexto)} de altura a gravação vira borrão — o traço do laser ` +
						'fecha as letras. Encurte o texto ou aumente a placa.',
				);
			}
			const centroY =
				tipoPlaca === 'escudo'
					? yBase + 0.58 * bandaVisivel
					: yBase + bandaVisivel / 2;
			pathsPlaca.push(
				text(
					{ x: round12(wPlaca / 2), y: round12(centroY - alturaTexto / 2) },
					gravacao,
					alturaTexto,
					'GRAVACAO',
					{ anchor: 'c' },
				),
			);
		}

		novaPeca(
			'placa',
			tipoPlaca === 'escudo' ? 'Placa em escudo' : 'Placa retangular',
			pathsPlaca,
			t,
			{
				pos: [
					round12((W - wPlaca) / 2),
					// Encaixada, a placa é COPLANAR com a haste do topo (empilha na
					// aresta). Aparafusada, ela vai na face da frente, +t em Y.
					round12(D / 2 + t / 2 + (porParafuso ? t : 0)),
					round12(tb + Hh - sobra),
				],
				rot: [Math.PI / 2, 0, 0],
			},
		);
	} else if (gravacao) {
		warnings.push(
			'A gravação foi ignorada: este troféu não tem placa. Escolha placa ' +
				'"retangular" ou "escudo".',
		);
	}

	return {
		units: 'mm',
		schema: 1,
		parts,
		meta: {
			generator: 'cad/trophy@1',
			params: {
				altura_total: H,
				espessura: t,
				material,
				kerf: k,
				folga: c,
				base_largura: W,
				base_profundidade: D,
				base_espessura: tb,
				silhueta,
				placa,
				placa_altura: placaAltura,
				gravacao_placa: gravacao,
				gravacao_altura: alturaTextoPedida,
				fixacao,
				altura_haste: Hh,
				largura_haste_pe: wPe,
				largura_haste_topo: wTopo,
				largura_placa: wPlaca,
				pegada_minima: pegadaMin,
				cruzamento: {
					fenda_larg_desenhada: cl.slotLarg,
					fenda_prof_desenhada: cl.slotProf,
					fenda_larg_final: cl.slotLargFinal,
					fenda_prof_final: cl.slotProfFinal,
					perna: pernaCruz,
				},
				espiga_pe: {
					largura_nominal: espPeNominal,
					largura_desenhada: espPeLarg,
					altura_desenhada: hEspigaPe,
					fenda_base_largura: fendaBaseLarg,
					fenda_base_espessura: fendaBaseEsp,
				},
				espiga_placa: {
					largura_desenhada: espigaPlacaLarg,
					altura_desenhada: espigaPlacaAlt,
					sobreposicao_parafuso: sobra,
				},
			},
			kerf: k,
			clearance: c,
			warnings: [...new Set(warnings)],
			stats: computeStats(parts),
		},
	};
}
