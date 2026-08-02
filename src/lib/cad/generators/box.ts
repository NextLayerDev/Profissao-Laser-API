/**
 * Gerador de caixa com finger joints (MDF/acrílico).
 *
 * Convenções de montagem (3D): X = largura, Y = profundidade, Z = altura, com a
 * origem no canto externo inferior-frontal-esquerdo. Cada painel é desenhado no
 * seu próprio plano local (x, y) com origem em (0, 0) — é o que o nesting e os
 * exportadores esperam.
 *
 * Quem fica com o "cubo de canto": as 4 PAREDES têm dente nas pontas de todas as
 * suas arestas; fundo, tampa e as laterais esquerda/direita cedem as pontas. Sem
 * essa regra única, três painéis disputam o mesmo cubo de t×t×t e a caixa não
 * fecha. As arestas verticais são o caso famoso: frente/trás mandam, esquerda/
 * direita obedecem.
 *
 * Módulo PURO: só `ir`, `kerf` e `tool-errors`. Nada que leia env no topo.
 */

import { ToolEngineError } from '../../tool-errors.js';
import {
	bboxOf,
	type CadPath,
	computeStats,
	type Part,
	type Pt,
	polyline,
	rect,
	type Sketch2D,
	TEXT_WIDTH_FACTOR,
	text,
} from '../ir.js';
import {
	assertJoint,
	crossLap,
	type FingerGeometry,
	fingerGeometry,
	inner,
} from '../kerf.js';

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export type BoxDimMode = 'interno' | 'externo';
export type BoxEncaixe = 'dente' | 'dente_reforcado' | 'topo_colado';
export type BoxTampa = 'nenhuma' | 'deslizante' | 'encaixe' | 'solta';

export interface BoxParams {
	dim_mode?: BoxDimMode;
	largura: number;
	profundidade: number;
	altura: number;
	espessura: number;
	material?: string;
	kerf?: number;
	folga?: number;
	encaixe?: BoxEncaixe;
	dente_alvo?: number;
	fundo?: boolean;
	tampa?: BoxTampa;
	tampa_folga?: number;
	div_x?: number;
	div_y?: number;
	div_altura_pct?: number;
	gravacao_tampa?: string;
}

/** Abaixo disto as letras fecham e a gravação vira borrão. Mesmo critério do gerador de medalha. */
const TEXTO_LEGIVEL_MIN = 2.5;

const MATERIAL_PADRAO = 'MDF';
const KERF_PADRAO = 0.15;
const FOLGA_PADRAO = 0.1;
const TAMPA_FOLGA_PADRAO = 0.2;
const DIV_ALTURA_PCT_PADRAO = 100;

/** Abaixo disso a aresta não comporta dente nenhum — vira topo colado. */
export const ARESTA_MIN_DENTE = 15;

/** Folga entre o topo da tampa deslizante e o topo da parede, em mm. */
const RECUO_TAMPA_TOPO = 1.5;

/** Tolerância de comparação de coordenadas (mm). Bem acima do ruído de float. */
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Perfil de aresta
// ---------------------------------------------------------------------------

/** Trecho de aresta onde o material é REMOVIDO, com a profundidade do corte. */
interface Span {
	s0: number;
	s1: number;
	d: number;
}

/**
 * Fendas ao longo de uma aresta de comprimento `L`.
 *
 * As bandas são os `n` trechos de passo `p`. `pontaFemea` decide a paridade:
 * `true` → fendas nas bandas pares (inclui a primeira e a última, que por isso
 * são estendidas até a ponta do painel — o vizinho é quem ocupa o canto);
 * `false` → fendas nas bandas ímpares, todas internas, e o painel fica com dente
 * nas duas pontas.
 *
 * A fenda é desenhada CENTRADA na banda com largura `fendaLargura`; o que sobra
 * entre duas fendas é exatamente `denteLargura`. É daí que sai a folga `c` do
 * contrato — desenhar dente e fenda em chamadas separadas de `fingerGeometry` é
 * o caminho mais curto para uma caixa que não fecha.
 */
function fendaSpans(
	L: number,
	fg: FingerGeometry,
	pontaFemea: boolean,
	prof: number,
): Span[] {
	const paridade = pontaFemea ? 0 : 1;
	const out: Span[] = [];
	for (let i = 0; i < fg.n; i++) {
		if (i % 2 !== paridade) continue;
		const centro = (i + 0.5) * fg.p;
		out.push({
			s0: i === 0 ? 0 : centro - fg.fendaLargura / 2,
			s1: i === fg.n - 1 ? L : centro + fg.fendaLargura / 2,
			d: prof,
		});
	}
	return out;
}

/** Centros das bandas de DENTE (o complemento de `fendaSpans`). */
function centrosDente(fg: FingerGeometry, pontaFemea: boolean): number[] {
	const paridade = pontaFemea ? 1 : 0;
	const out: number[] = [];
	for (let i = 0; i < fg.n; i++) {
		if (i % 2 === paridade) out.push((i + 0.5) * fg.p);
	}
	return out;
}

/** Pontos (parâmetro, profundidade) de uma aresta, em ordem de parâmetro. */
function pontosAresta(
	spans: Span[],
	L: number,
): Array<{ s: number; d: number }> {
	const out: Array<{ s: number; d: number }> = [];
	for (let i = 0; i < spans.length; i++) {
		const sp = spans[i];
		const anterior = spans[i - 1];
		const proximo = spans[i + 1];
		const inicioNoCanto = sp.s0 <= EPS;
		const fimNoCanto = sp.s1 >= L - EPS;
		// Spans encostados um no outro (ex.: última fenda do encaixe vertical e o
		// rasgo da tampa deslizante) viram um degrau só, sem subir à linha externa.
		const coladoAtras = anterior !== undefined && anterior.s1 >= sp.s0 - EPS;
		const coladoNaFrente = proximo !== undefined && sp.s1 >= proximo.s0 - EPS;
		if (!inicioNoCanto) {
			if (!coladoAtras) out.push({ s: sp.s0, d: 0 });
			out.push({ s: sp.s0, d: sp.d });
		}
		out.push({ s: sp.s1, d: sp.d });
		if (!fimNoCanto && !coladoNaFrente) out.push({ s: sp.s1, d: 0 });
	}
	return out;
}

interface Arestas {
	bottom?: Span[];
	right?: Span[];
	top?: Span[];
	left?: Span[];
}

function ordena(spans: Span[] | undefined): Span[] {
	return [...(spans ?? [])].sort((a, b) => a.s0 - b.s0);
}

/**
 * Contorno fechado de um painel retangular W×H com fendas nas quatro arestas.
 *
 * Cada aresta é parametrizada numa direção FIXA (base e topo pelo x crescente,
 * esquerda e direita pelo y crescente) para que dois painéis vizinhos calculem
 * as mesmas posições de banda; a ordem de percurso do contorno é outra coisa e
 * inverte no topo e na esquerda.
 *
 * Os quatro cantos são calculados à parte: quando as duas arestas que se
 * encontram num canto têm fenda ali, o canto vira um recorte em L e o vértice
 * certo é o cruzamento das duas profundidades — emitir aresta por aresta sem
 * isso produz contorno auto-interceptado.
 */
function contorno(W: number, H: number, e: Arestas): Pt[] {
	const b = ordena(e.bottom);
	const r = ordena(e.right);
	const t = ordena(e.top);
	const l = ordena(e.left);
	const dIni = (s: Span[]): number => (s[0] && s[0].s0 <= EPS ? s[0].d : 0);
	const dFim = (s: Span[], L: number): number => {
		const u = s[s.length - 1];
		return u && u.s1 >= L - EPS ? u.d : 0;
	};

	const pts: Pt[] = [{ x: dIni(l), y: dIni(b) }];
	for (const q of pontosAresta(b, W)) pts.push({ x: q.s, y: q.d });
	pts.push({ x: W - dIni(r), y: dFim(b, W) });
	for (const q of pontosAresta(r, H)) pts.push({ x: W - q.d, y: q.s });
	pts.push({ x: W - dFim(r, H), y: H - dFim(t, W) });
	for (const q of pontosAresta(t, W).reverse())
		pts.push({ x: q.s, y: H - q.d });
	pts.push({ x: dIni(t), y: H - dFim(l, H) });
	for (const q of pontosAresta(l, H).reverse()) pts.push({ x: q.d, y: q.s });

	// Cantos sem recorte fazem o vértice do canto coincidir com o primeiro ponto
	// da aresta seguinte; polilinha com vértice repetido trava alguns CAMs.
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
// Validação de entrada
// ---------------------------------------------------------------------------

function exigePositivo(v: number, nome: string): number {
	if (!Number.isFinite(v) || v <= 0) {
		throw new ToolEngineError(
			400,
			`O parâmetro "${nome}" precisa ser um número maior que zero (recebido: ${String(v)}).`,
		);
	}
	return v;
}

function inteiroNaoNegativo(v: number | undefined, nome: string): number {
	const n = Math.trunc(v ?? 0);
	if (!Number.isFinite(n) || n < 0) {
		throw new ToolEngineError(
			400,
			`O parâmetro "${nome}" precisa ser um inteiro maior ou igual a zero.`,
		);
	}
	return n;
}

const mm = (v: number): string => `${Math.round(v * 100) / 100} mm`;

// ---------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------

export function buildBox(params: BoxParams): Sketch2D {
	const warnings: string[] = [];

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
	const material = params.material?.trim() || MATERIAL_PADRAO;
	const dimMode: BoxDimMode = params.dim_mode ?? 'interno';
	const tampa: BoxTampa = params.tampa ?? 'nenhuma';
	const temFundo = params.fundo !== false;
	const tampaFolga = params.tampa_folga ?? TAMPA_FOLGA_PADRAO;

	const lg = exigePositivo(params.largura, 'largura');
	const pf = exigePositivo(params.profundidade, 'profundidade');
	const al = exigePositivo(params.altura, 'altura');

	// A conversão é sempre 2t nos três eixos — a altura nominal considera fundo e
	// tampa. Sem fundo (ou sem tampa) a cavidade real fica t mais alta; isso é
	// convenção declarada, não erro de conta.
	const We = dimMode === 'interno' ? lg + 2 * t : lg;
	const De = dimMode === 'interno' ? pf + 2 * t : pf;
	const He = dimMode === 'interno' ? al + 2 * t : al;
	const Wi = We - 2 * t;
	const Di = De - 2 * t;
	const Hi = He - 2 * t;
	if (Wi <= 0 || Di <= 0 || Hi <= 0) {
		throw new ToolEngineError(
			400,
			`Espessura de ${mm(t)} não cabe nas dimensões externas ` +
				`${mm(We)}×${mm(De)}×${mm(He)}: não sobra vão interno. ` +
				'Aumente a caixa ou use chapa mais fina.',
		);
	}

	// Só a tampa SOLTA se apoia sobre as paredes; a de encaixe é dentada (entra
	// intercalada, a parede sobe até o topo) e a deslizante corre por dentro.
	const Hp = tampa === 'solta' ? He - t : He;
	if (Hp <= 0) {
		throw new ToolEngineError(
			400,
			`A altura externa (${mm(He)}) não comporta uma tampa solta de ${mm(t)}.`,
		);
	}

	// --- tampa deslizante: rasgo e rebaixo da face frontal --------------------
	const deslizante = tampa === 'deslizante';
	let rasgoTampaAlt = 0;
	let zRasgo = 0;
	let alturaFrente = Hp;
	if (deslizante) {
		rasgoTampaAlt = inner(t + tampaFolga, k);
		if (rasgoTampaAlt <= 0) {
			throw new ToolEngineError(
				400,
				`O rasgo da tampa deslizante ficaria com ${mm(rasgoTampaAlt)} de altura. ` +
					'Aumente a folga da tampa ou reduza o kerf.',
			);
		}
		zRasgo = Hp - (t + RECUO_TAMPA_TOPO) - rasgoTampaAlt;
		if (zRasgo < ARESTA_MIN_DENTE) {
			throw new ToolEngineError(
				400,
				`A altura de ${mm(He)} não comporta uma tampa deslizante: sobrariam ` +
					`${mm(Math.max(0, zRasgo))} de face frontal. Aumente a altura da caixa ` +
					'ou troque o tipo de tampa.',
			);
		}
		alturaFrente = zRasgo;
	}

	// --- tipo de encaixe -------------------------------------------------------
	let encaixe: BoxEncaixe = params.encaixe ?? 'dente';
	const arestasDentadas = [We, De, Hp, alturaFrente];
	const menorAresta = Math.min(...arestasDentadas);
	if (encaixe !== 'topo_colado' && menorAresta < ARESTA_MIN_DENTE) {
		encaixe = 'topo_colado';
		warnings.push(
			`Uma das arestas mede ${mm(menorAresta)}, abaixo do mínimo de ` +
				`${mm(ARESTA_MIN_DENTE)} para dente. O encaixe caiu para topo colado — ` +
				'monte com cola e esquadro.',
		);
	}
	const dentes = encaixe !== 'topo_colado';
	// "Reforçado" = passo menor: mais dentes, mais área de cola e menos alavanca
	// em cada dente. `fingerGeometry` limita o alvo a [6, 25] de qualquer forma.
	const alvoBase = params.dente_alvo ?? Math.max(3 * t, 8);
	const alvo = encaixe === 'dente_reforcado' ? alvoBase * 0.6 : alvoBase;

	// --- famílias de encaixe (uma chamada por aresta compartilhada) -----------
	const fgW = dentes
		? fingerGeometry({ L: We, t, tOposta: t, k, c, alvo })
		: null;
	const fgD = dentes
		? fingerGeometry({ L: De, t, tOposta: t, k, c, alvo })
		: null;
	const fgV = dentes
		? fingerGeometry({ L: Hp, t, tOposta: t, k, c, alvo })
		: null;
	const fgVFrente =
		dentes && deslizante
			? fingerGeometry({ L: alturaFrente, t, tOposta: t, k, c, alvo })
			: fgV;

	for (const [L, fg] of [
		[We, fgW],
		[De, fgD],
		[Hp, fgV],
		[alturaFrente, fgVFrente],
	] as Array<[number, FingerGeometry | null]>) {
		if (!fg) continue;
		warnings.push(...assertJoint({ t, k, c, p: fg.p, n: fg.n, L }));
	}

	const prof = fgW?.fendaProf ?? t;
	const larguraPD = dentes ? De : Di;

	// --- cavidade e divisórias -------------------------------------------------
	const zCavidade = temFundo ? t : 0;
	const topoCavidade = deslizante ? zRasgo : tampa === 'encaixe' ? He - t : Hp;
	const hCavidade = topoCavidade - zCavidade;
	const divX = inteiroNaoNegativo(params.div_x, 'div_x');
	const divY = inteiroNaoNegativo(params.div_y, 'div_y');
	const divPct = params.div_altura_pct ?? DIV_ALTURA_PCT_PADRAO;
	if (!Number.isFinite(divPct) || divPct <= 0 || divPct > 100) {
		throw new ToolEngineError(
			400,
			`O parâmetro "div_altura_pct" precisa estar entre 1 e 100 (recebido: ${String(divPct)}).`,
		);
	}
	const hDiv = (hCavidade * divPct) / 100;
	const temDiv = (divX > 0 || divY > 0) && hDiv > 0;
	if ((divX > 0 || divY > 0) && hDiv <= 0) {
		warnings.push(
			'A cavidade não tem altura útil para divisórias — elas foram omitidas.',
		);
	}
	if (temDiv && !temFundo) {
		warnings.push(
			'A caixa não tem fundo: as divisórias ficam apoiadas só pelos encaixes. ' +
				'Cole-as ou ative o fundo.',
		);
	}
	if (temDiv && hDiv < ARESTA_MIN_DENTE) {
		warnings.push(
			`As divisórias têm apenas ${mm(hDiv)} de altura — abaixo de ` +
				`${mm(ARESTA_MIN_DENTE)} elas entram sem dente, apenas coladas.`,
		);
	}

	const dentesDiv = temDiv && dentes && hDiv >= ARESTA_MIN_DENTE;
	const fgDiv = dentesDiv
		? fingerGeometry({ L: hDiv, t, tOposta: t, k, c, alvo })
		: null;
	if (fgDiv) {
		warnings.push(...assertJoint({ t, k, c, p: fgDiv.p, n: fgDiv.n, L: hDiv }));
	}
	const rasgoDivLarg = inner(t + c, k);
	if (temDiv && rasgoDivLarg <= 0) {
		throw new ToolEngineError(
			400,
			`O rasgo da divisória ficaria com ${mm(rasgoDivLarg)} de largura. ` +
				'Aumente a folga ou reduza o kerf.',
		);
	}

	// Posições dos planos de divisória, em coordenadas de mundo.
	const posDivX: number[] = [];
	for (let i = 0; i < divX; i++) posDivX.push(t + (Wi * (i + 1)) / (divX + 1));
	const posDivY: number[] = [];
	for (let j = 0; j < divY; j++) posDivY.push(t + (Di * (j + 1)) / (divY + 1));
	if (temDiv) {
		const vaoX = Wi / (divX + 1);
		const vaoY = Di / (divY + 1);
		const menorVao = Math.min(divX > 0 ? vaoX : vaoY, divY > 0 ? vaoY : vaoX);
		if (menorVao < 2 * t + 5) {
			warnings.push(
				`Os compartimentos ficam com ${mm(menorVao)} de vão — quase sem espaço útil. ` +
					'Reduza o número de divisórias.',
			);
		}
	}

	// --- montagem das peças ----------------------------------------------------
	const parts: Part[] = [];
	const novaPeca = (
		id: string,
		label: string,
		pts: Pt[],
		internos: CadPath[],
		pose: NonNullable<Part['pose']>,
	): Part => {
		const paths: CadPath[] = [polyline(pts, true, 'CORTE'), ...internos];
		const bb = bboxOf(paths);
		const part: Part = {
			id,
			label,
			thickness: t,
			material,
			paths,
			bbox: { w: bb.w, h: bb.h },
			qty: 1,
			pose,
		};
		parts.push(part);
		return part;
	};

	// Rasgos das divisórias numa parede: um bolso por banda de dente da divisória.
	const rasgosDivisoria = (posicoes: number[]): CadPath[] => {
		if (!posicoes.length) return [];
		const out: CadPath[] = [];
		for (const pos of posicoes) {
			if (fgDiv) {
				for (const centro of centrosDente(fgDiv, true)) {
					out.push(
						rect(
							pos - rasgoDivLarg / 2,
							zCavidade + centro - fgDiv.fendaLargura / 2,
							rasgoDivLarg,
							fgDiv.fendaLargura,
							'CORTE',
						),
					);
				}
			}
		}
		return out;
	};

	// Fundo -------------------------------------------------------------------
	if (temFundo) {
		const w = dentes ? We : Wi;
		const d = dentes ? De : Di;
		const pts = dentes
			? contorno(w, d, {
					bottom: fendaSpans(We, fgW as FingerGeometry, true, prof),
					top: fendaSpans(We, fgW as FingerGeometry, true, prof),
					left: fendaSpans(De, fgD as FingerGeometry, true, prof),
					right: fendaSpans(De, fgD as FingerGeometry, true, prof),
				})
			: contorno(w, d, {});
		novaPeca('fundo', 'Fundo', pts, [], {
			pos: [dentes ? 0 : t, dentes ? 0 : t, 0],
			rot: [0, 0, 0],
		});
	}

	// Paredes frente/trás ------------------------------------------------------
	const fendasVerticaisParede = (
		L: number,
		fg: FingerGeometry | null,
	): Span[] => (fg ? fendaSpans(L, fg, false, prof) : []);

	const arestasFrente: Arestas = {
		left: fendasVerticaisParede(alturaFrente, fgVFrente),
		right: fendasVerticaisParede(alturaFrente, fgVFrente),
		bottom: temFundo && fgW ? fendaSpans(We, fgW, false, prof) : [],
		top:
			!deslizante && tampa === 'encaixe' && fgW
				? fendaSpans(We, fgW, false, prof)
				: [],
	};
	novaPeca(
		'frente',
		'Parede frontal',
		contorno(We, alturaFrente, arestasFrente),
		rasgosDivisoria(posDivX),
		{ pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0] },
	);

	const rasgoTampaTras: CadPath[] =
		deslizante && We - 2 * t > 0
			? [rect(t, zRasgo, We - 2 * t, rasgoTampaAlt, 'CORTE')]
			: [];
	novaPeca(
		'tras',
		'Parede traseira',
		contorno(We, Hp, {
			left: fendasVerticaisParede(Hp, fgV),
			right: fendasVerticaisParede(Hp, fgV),
			bottom: temFundo && fgW ? fendaSpans(We, fgW, false, prof) : [],
			top: tampa === 'encaixe' && fgW ? fendaSpans(We, fgW, false, prof) : [],
		}),
		[...rasgosDivisoria(posDivX), ...rasgoTampaTras],
		{ pos: [0, De - t, 0], rot: [Math.PI / 2, 0, 0] },
	);

	// Paredes esquerda/direita -------------------------------------------------
	// A aresta frontal é fêmea (a frente manda no canto) e, com tampa deslizante,
	// só vai até o topo da face frontal rebaixada; acima disso não há frente para
	// encaixar. O rasgo da tampa entra como fenda MUITO profunda na mesma aresta.
	const spansFrontalPD: Span[] = [];
	if (fgVFrente) {
		spansFrontalPD.push(...fendaSpans(alturaFrente, fgVFrente, true, prof));
	}
	if (deslizante) {
		spansFrontalPD.push({
			s0: zRasgo,
			s1: zRasgo + rasgoTampaAlt,
			d: larguraPD - t,
		});
	}
	const arestasPD: Arestas = {
		left: spansFrontalPD,
		right: fgV ? fendaSpans(Hp, fgV, true, prof) : [],
		bottom: temFundo && fgD ? fendaSpans(De, fgD, false, prof) : [],
		top: tampa === 'encaixe' && fgD ? fendaSpans(De, fgD, false, prof) : [],
	};
	const ptsPD = contorno(larguraPD, Hp, arestasPD);
	const rasgosPD = rasgosDivisoria(posDivY.map((y) => (dentes ? y : y - t)));
	novaPeca('esquerda', 'Lateral esquerda', ptsPD, rasgosPD, {
		pos: [0, dentes ? 0 : t, 0],
		rot: [Math.PI / 2, 0, Math.PI / 2],
	});
	novaPeca('direita', 'Lateral direita', ptsPD, rasgosPD, {
		pos: [We - t, dentes ? 0 : t, 0],
		rot: [Math.PI / 2, 0, Math.PI / 2],
	});

	// Tampa --------------------------------------------------------------------
	let tampaPeca: Part | null = null;
	if (tampa === 'encaixe' && dentes && fgW && fgD) {
		tampaPeca = novaPeca(
			'tampa',
			'Tampa de encaixe',
			contorno(We, De, {
				bottom: fendaSpans(We, fgW, true, prof),
				top: fendaSpans(We, fgW, true, prof),
				left: fendaSpans(De, fgD, true, prof),
				right: fendaSpans(De, fgD, true, prof),
			}),
			[],
			{ pos: [0, 0, He - t], rot: [0, 0, 0] },
		);
		warnings.push(
			'A tampa de encaixe é dentada como o fundo: fecha por pressão e não foi ' +
				'projetada para abrir e fechar todo dia.',
		);
	} else if (tampa === 'solta' || (tampa === 'encaixe' && !dentes)) {
		tampaPeca = novaPeca('tampa', 'Tampa solta', contorno(We, De, {}), [], {
			pos: [0, 0, He - t],
			rot: [0, 0, 0],
		});
		if (tampa === 'encaixe') {
			warnings.push(
				'Sem dentes a tampa de encaixe vira uma tampa solta, apenas apoiada.',
			);
		}
	} else if (deslizante) {
		// Corpo até a face interna da traseira + língua central que entra no rasgo
		// da traseira. É a língua que impede a tampa de levantar no fundo do curso.
		const corpo = larguraPD - t;
		const lingua = t / 2;
		const temLingua = We - 2 * t > 0;
		const pts: Pt[] = temLingua
			? [
					{ x: 0, y: 0 },
					{ x: We, y: 0 },
					{ x: We, y: corpo },
					{ x: We - t, y: corpo },
					{ x: We - t, y: corpo + lingua },
					{ x: t, y: corpo + lingua },
					{ x: t, y: corpo },
					{ x: 0, y: corpo },
				]
			: [
					{ x: 0, y: 0 },
					{ x: We, y: 0 },
					{ x: We, y: corpo },
					{ x: 0, y: corpo },
				];
		tampaPeca = novaPeca('tampa', 'Tampa deslizante', pts, [], {
			pos: [0, dentes ? 0 : t, zRasgo],
			rot: [0, 0, 0],
		});
	}

	// Gravação da tampa --------------------------------------------------------
	const gravacao = params.gravacao_tampa?.trim();
	if (gravacao) {
		if (!tampaPeca) {
			warnings.push(
				'A gravação foi ignorada: esta caixa não tem tampa para gravar.',
			);
		} else {
			const { w, h } = tampaPeca.bbox;
			// A altura sai da menor dimensão da tampa, mas o COMPRIMENTO do texto é
			// quem manda: sem este teto, um nome longo sai mais largo que a tampa e
			// a gravação cai fora da peça. 0,9·w deixa uma margem de respiro.
			const larguraMax = (0.9 * w) / (gravacao.length * TEXT_WIDTH_FACTOR);
			const base = Math.min(20, Math.max(4, Math.min(w, h) * 0.15));
			// Clamp honesto: um piso aqui ANULARIA o teto de largura acima, e o
			// texto sairia mais largo que a tampa — o laser grava fora da peça e a
			// bbox inflada faz o nesting reservar chapa a mais. Se o teto força uma
			// altura ilegível, avisa em vez de entregar borrão calado (é o que
			// `medal` e `trophy` já fazem).
			const alturaTexto = Math.min(base, larguraMax);
			if (alturaTexto < TEXTO_LEGIVEL_MIN) {
				warnings.push(
					`A gravação "${gravacao.slice(0, 24)}${gravacao.length > 24 ? '…' : ''}" ficaria com ${alturaTexto.toFixed(2)} mm de altura para caber na tampa (${w.toFixed(0)} mm): abaixo de ${TEXTO_LEGIVEL_MIN} mm as letras fecham e viram borrão. Use um texto mais curto ou uma tampa maior.`,
				);
			}
			tampaPeca.paths.push(
				text(
					{ x: w / 2, y: (h - alturaTexto) / 2 },
					gravacao,
					alturaTexto,
					'GRAVACAO',
					{
						anchor: 'c',
					},
				),
			);
			// A caixa foi medida em `novaPeca`, ANTES deste texto existir. Um nome
			// longo transborda a tampa, e uma bbox subdimensionada faz o nesting
			// reservar menos espaço do que a peça ocupa — peças sobrepostas na chapa.
			const bb = bboxOf(tampaPeca.paths);
			tampaPeca.bbox = { w: bb.w, h: bb.h };
		}
	}

	// Divisórias ---------------------------------------------------------------
	if (temDiv) {
		const cl = crossLap({ tOutra: t, k, c, H: hDiv });
		const spansTopo = (posicoes: number[], base: number): Span[] =>
			posicoes.map((pos) => ({
				s0: pos - base - cl.slotLarg / 2,
				s1: pos - base + cl.slotLarg / 2,
				d: cl.slotProf,
			}));

		// Divisórias perpendiculares a X: correm na profundidade, encaixam em
		// frente/trás e recebem o cruzamento POR CIMA.
		const larguraDivX = dentesDiv ? De : Di;
		for (let i = 0; i < divX; i++) {
			const pts = contorno(larguraDivX, hDiv, {
				left: fgDiv ? fendaSpans(hDiv, fgDiv, true, prof) : [],
				right: fgDiv ? fendaSpans(hDiv, fgDiv, true, prof) : [],
				top: spansTopo(posDivY, dentesDiv ? 0 : t),
			});
			novaPeca(`div_x_${i}`, `Divisória vertical ${i + 1}`, pts, [], {
				pos: [posDivX[i] - t / 2, dentesDiv ? 0 : t, zCavidade],
				rot: [Math.PI / 2, 0, Math.PI / 2],
			});
		}

		// Divisórias perpendiculares a Y: correm na largura e recebem o cruzamento
		// POR BAIXO — é o par do rasgo de cima da outra, senão elas não se cruzam.
		const larguraDivY = dentesDiv ? We : Wi;
		for (let j = 0; j < divY; j++) {
			const pts = contorno(larguraDivY, hDiv, {
				left: fgDiv ? fendaSpans(hDiv, fgDiv, true, prof) : [],
				right: fgDiv ? fendaSpans(hDiv, fgDiv, true, prof) : [],
				bottom: spansTopo(posDivX, dentesDiv ? 0 : t),
			});
			novaPeca(`div_y_${j}`, `Divisória horizontal ${j + 1}`, pts, [], {
				pos: [dentesDiv ? 0 : t, posDivY[j] - t / 2, zCavidade],
				rot: [Math.PI / 2, 0, 0],
			});
		}
	}

	return {
		units: 'mm',
		schema: 1,
		parts,
		meta: {
			generator: 'cad/box@1',
			params: {
				dim_mode: dimMode,
				largura: lg,
				profundidade: pf,
				altura: al,
				espessura: t,
				material,
				kerf: k,
				folga: c,
				encaixe,
				dente_alvo: alvo,
				fundo: temFundo,
				tampa,
				tampa_folga: tampaFolga,
				div_x: divX,
				div_y: divY,
				div_altura_pct: divPct,
				gravacao_tampa: gravacao ?? '',
				externo: { largura: We, profundidade: De, altura: He },
				interno: { largura: Wi, profundidade: Di, altura: Hi },
			},
			kerf: k,
			clearance: c,
			warnings: [...new Set(warnings)],
			stats: computeStats(parts),
		},
	};
}
