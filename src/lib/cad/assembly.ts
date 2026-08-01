/**
 * IR → montagem 3D: `Sketch2D` vira um JSON leve que o front extruda direto.
 *
 * O contrato com o cliente é: ele NÃO sabe o que é bulge, arco, layer ou kerf.
 * Recebe polígonos já achatados (contorno + furos), a espessura e uma pose, e
 * faz `ExtrudeGeometry` + `position/rotation`. Toda a inteligência geométrica
 * (achatar arco, decidir quem é furo, descartar gravura) mora AQUI — se vazar
 * para o front, cada tela reimplementa e cada uma erra de um jeito diferente.
 *
 * Convenção da pose (a mesma que `generators/box.ts` já emite): `rot` está em
 * RADIANOS e é aplicada X → Y → Z, ou seja `R = Rz · Ry · Rx`. No Three.js isso
 * é `new Euler(rx, ry, rz, 'ZYX')` — usar a ordem padrão 'XYZ' monta a caixa
 * com as laterais viradas para fora.
 *
 * Módulo PURO: só `./ir.js` e built-ins. Nada que leia env no topo.
 */

import {
	arcFromBulge,
	type CadPath,
	type Part,
	type Pt,
	type Seg,
	type Sketch2D,
	sweepFromBulge,
	TAU,
} from './ir.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Anel fechado: o último ponto NÃO repete o primeiro (o fechamento é implícito). */
type Ring = [number, number][];

export interface AssemblyPart {
	id: string;
	label: string;
	thickness: number;
	material: string;
	/** Contorno externo, anti-horário, arcos já achatados. */
	outline: [number, number][];
	/** Furos internos, horários, arcos já achatados. */
	holes: [number, number][][];
	pose: { pos: [number, number, number]; rot: [number, number, number] };
	bends?: {
		at: [number, number];
		dir: [number, number];
		angle: number;
		radius: number;
	}[];
}

export interface Assembly {
	units: 'mm';
	parts: AssemblyPart[];
	bbox: { min: [number, number, number]; max: [number, number, number] };
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * Tolerância de corda do achatamento, em mm: distância máxima entre o arco real
 * e a poligonal que o substitui. 0,05 mm é meio décimo — some na tela e some na
 * peça (é menos que o kerf de qualquer laser). Apertar mais só engorda o JSON.
 */
export const TOL_CORDA_MM = 0.05;

/** Folga entre peças no layout de fallback (peças sem `pose`), em mm. */
const GAP_FALLBACK_MM = 10;

/** Tolerância de coincidência de pontos (mm), bem acima do ruído de float. */
const EPS_PT = 1e-6;

/** Casas decimais das coordenadas: 1e-4 mm = 0,1 µm. Além disso é peso morto no JSON. */
function r4(v: number): number {
	const r = Math.round(v * 1e4) / 1e4;
	return Object.is(r, -0) ? 0 : r;
}

// ---------------------------------------------------------------------------
// Achatamento de arcos
// ---------------------------------------------------------------------------

/**
 * Nº de cordas para varrer `sweep` radianos num raio `r` sem passar da
 * tolerância. Uma corda de ângulo Δ tem flecha `r·(1 − cos(Δ/2))`; igualando à
 * tolerância sai `Δ = 2·acos(1 − tol/r)`, e o nº de cordas é `ceil(sweep/Δ)`.
 * Raio menor que a própria tolerância não tem o que refinar: uma corda basta.
 */
function arcSteps(r: number, sweep: number, tol: number): number {
	if (!(r > tol)) return 1;
	const passo = 2 * Math.acos(1 - tol / r);
	if (!(passo > 0)) return 1;
	return Math.max(1, Math.ceil(sweep / passo));
}

/**
 * Pontos INTERMEDIÁRIOS de um arco (extremidades excluídas) — quem emite os
 * extremos é o anel, senão cada junta de dois segmentos duplicaria o vértice.
 */
function arcInner(
	c: Pt,
	r: number,
	a0: number,
	sweep: number,
	ccw: boolean,
	tol: number,
): Ring {
	const n = arcSteps(r, sweep, tol);
	const out: Ring = [];
	const dir = ccw ? 1 : -1;
	for (let i = 1; i < n; i++) {
		const a = a0 + dir * sweep * (i / n);
		out.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]);
	}
	return out;
}

/** Círculo inteiro como polígono anti-horário. */
function circleRing(c: Pt, r: number, tol: number): Ring {
	// Piso de 8 lados: um furo pequeno respeitaria a tolerância virando triângulo,
	// mas na tela vira um buraco quadrado — e o aluno acha que o desenho tem bug.
	const n = Math.max(8, arcSteps(r, TAU, tol));
	const out: Ring = [];
	for (let i = 0; i < n; i++) {
		const a = (TAU * i) / n;
		out.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]);
	}
	return out;
}

/** Remove vértices coincidentes, inclusive o fechamento repetido no fim. */
function dedupe(ring: Ring): Ring {
	const out: Ring = [];
	for (const p of ring) {
		const u = out[out.length - 1];
		if (u && Math.abs(u[0] - p[0]) <= EPS_PT && Math.abs(u[1] - p[1]) <= EPS_PT)
			continue;
		out.push(p);
	}
	const a = out[0];
	const b = out[out.length - 1];
	if (
		out.length > 1 &&
		a &&
		b &&
		Math.abs(a[0] - b[0]) <= EPS_PT &&
		Math.abs(a[1] - b[1]) <= EPS_PT
	) {
		out.pop();
	}
	return out;
}

/**
 * Segmento → anel fechado, ou `null` quando o segmento não delimita área.
 * Reta, arco solto, polilinha ABERTA e texto não fecham contorno: viram nada
 * aqui (no 3D não existe "meia parede"). Só polilinha fechada e círculo passam.
 */
function segToRing(seg: Seg, tol: number): Ring | null {
	if (seg.k === 'circle') {
		return seg.r > EPS_PT ? circleRing(seg.c, seg.r, tol) : null;
	}
	if (seg.k !== 'poly' || !seg.closed || seg.pts.length < 3) return null;
	const total = seg.pts.length;
	const out: Ring = [];
	for (let i = 0; i < total; i++) {
		const p1 = seg.pts[i];
		const p2 = seg.pts[(i + 1) % total];
		out.push([p1.x, p1.y]);
		const b = seg.bulges?.[i] ?? 0;
		if (Math.abs(b) < EPS_PT) continue;
		const arc = arcFromBulge(p1, p2, b);
		if (!arc) continue;
		out.push(
			...arcInner(
				arc.c,
				arc.r,
				arc.a0,
				Math.abs(sweepFromBulge(b)),
				b > 0,
				tol,
			),
		);
	}
	const limpo = dedupe(out);
	return limpo.length >= 3 ? limpo : null;
}

// ---------------------------------------------------------------------------
// Área com sinal e continência
// ---------------------------------------------------------------------------

/** Shoelace: positivo = anti-horário. O SINAL é o que diz a orientação do anel. */
function signedArea(ring: Ring): number {
	let s = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
	}
	return s / 2;
}

function withOrientation(ring: Ring, ccw: boolean): Ring {
	const area = signedArea(ring);
	return area >= 0 === ccw ? ring : [...ring].reverse();
}

/** Ray casting clássico: paridade de cruzamentos de uma semirreta horizontal. */
function pointInRing(ring: Ring, x: number, y: number): boolean {
	let dentro = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			dentro = !dentro;
		}
	}
	return dentro;
}

/**
 * `ring` está dentro de `outer`? Vota a MAIORIA dos vértices em vez de testar um
 * só: um vértice pode cair exatamente sobre a linha do contorno (fenda de
 * encaixe que encosta na borda, rasgo tangente) e aí a paridade é indefinida —
 * um único voto azarado transformaria o furo em peça solta.
 */
function ringInside(ring: Ring, outer: Ring): boolean {
	let dentro = 0;
	for (const [x, y] of ring) {
		if (pointInRing(outer, x, y)) dentro++;
	}
	return dentro * 2 > ring.length;
}

// ---------------------------------------------------------------------------
// Dobras
// ---------------------------------------------------------------------------

/**
 * Linhas da camada DOBRA viram eixos de dobra. A IR guarda só o TRAÇO — não
 * carrega ângulo nem raio —, então assume-se o caso de bancada: 90° com raio
 * interno igual à espessura (r ≈ t é a regra de ouro da dobradeira; raio menor
 * trinca a fibra externa).
 *
 * `angle` sai em RADIANOS porque o consumidor é o Three.js. Não é a convenção do
 * `bend.ts`, que recebe o ângulo em GRAUS (`bendAllowance(theta, …)`): jogar este
 * campo lá dentro cru calcula a planificação de 1,57 GRAU e erra a chapa por um
 * fator de ~57. Converta.
 */
function bendsOf(part: Part): AssemblyPart['bends'] {
	const out: NonNullable<AssemblyPart['bends']> = [];
	const push = (a: Pt, b: Pt): void => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy);
		if (len <= EPS_PT) return;
		out.push({
			at: [r4((a.x + b.x) / 2), r4((a.y + b.y) / 2)],
			dir: [r4(dx / len), r4(dy / len)],
			angle: Math.PI / 2,
			radius: part.thickness,
		});
	};
	for (const path of part.paths) {
		if (path.layer !== 'DOBRA') continue;
		if (path.seg.k === 'line') {
			push(path.seg.a, path.seg.b);
		} else if (path.seg.k === 'poly') {
			const pts = path.seg.pts;
			const last = path.seg.closed ? pts.length : pts.length - 1;
			for (let i = 0; i < last; i++) push(pts[i], pts[(i + 1) % pts.length]);
		}
	}
	return out.length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Pose e caixa envolvente
// ---------------------------------------------------------------------------

/** Aplica `R = Rz · Ry · Rx` (Euler 'ZYX' do Three.js) e translada. */
function poseApply(
	p: [number, number, number],
	pose: AssemblyPart['pose'],
): [number, number, number] {
	const [rx, ry, rz] = pose.rot;
	let [x, y, z] = p;
	let c = Math.cos(rx);
	let s = Math.sin(rx);
	[y, z] = [y * c - z * s, y * s + z * c];
	c = Math.cos(ry);
	s = Math.sin(ry);
	[x, z] = [x * c + z * s, -x * s + z * c];
	c = Math.cos(rz);
	s = Math.sin(rz);
	[x, y] = [x * c - y * s, x * s + y * c];
	return [x + pose.pos[0], y + pose.pos[1], z + pose.pos[2]];
}

function ringBounds(ring: Ring): { minX: number; minY: number; maxX: number } {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	for (const [x, y] of ring) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
	}
	return { minX, minY, maxX };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Converte o sketch na montagem 3D.
 *
 * Regras que valem a pena saber antes de debugar o resultado:
 * - só `layer === 'CORTE'` vira geometria: GRAVACAO e MARCACAO são passe de
 *   baixa potência, marcam a superfície e NÃO atravessam a chapa — virar furo
 *   no 3D seria mentira visual (a peça apareceria vazada onde só tem desenho);
 * - o anel de MAIOR área é o contorno externo; os que estão contidos nele são
 *   furos. Anéis fora do contorno são descartados: uma `Part` é UM corpo, e
 *   geometria solta ali é sinal de gerador errado, não de peça com duas ilhas;
 * - peça sem nenhum contorno fechado de CORTE não vira sólido e é omitida.
 */
export function sketchToAssembly(sketch: Sketch2D): Assembly {
	const parts: AssemblyPart[] = [];
	let cursorX = 0;

	for (const part of sketch.parts) {
		const aneis: Ring[] = [];
		for (const path of part.paths as CadPath[]) {
			if (path.layer !== 'CORTE') continue;
			const ring = segToRing(path.seg, TOL_CORDA_MM);
			if (ring) aneis.push(ring);
		}
		if (aneis.length === 0) continue;

		// Maior área = contorno. Comparação por MÓDULO da área: o gerador não
		// garante orientação nenhuma, então um contorno horário tem área negativa.
		let outline = aneis[0];
		for (const r of aneis) {
			if (Math.abs(signedArea(r)) > Math.abs(signedArea(outline))) outline = r;
		}
		outline = withOrientation(outline, true);

		// Furos em sentido horário: é a convenção que o `THREE.Shape` espera para
		// `holes`, e deixa o sinal da área dizer sozinho quem é vazio.
		const holes = aneis
			.filter((r) => r !== outline && ringInside(r, outline))
			.map((r) => withOrientation(r, false).map(([x, y]) => [r4(x), r4(y)]));

		const bounds = ringBounds(outline);
		// Uma peça com `qty > 1` só vira vários CORPOS se o gerador disser ONDE cada
		// instância fica (`poses`). Com `qty` sozinho não dá para inventar posição:
		// duas cópias na mesma pose ficariam uma dentro da outra, e espalhá-las por
		// conta própria seria mostrar geometria que ninguém projetou. `qty` continua
		// valendo para o nesting e para as estatísticas, que são contagem, não lugar.
		const poses: AssemblyPart['pose'][] = part.poses?.length
			? part.poses
			: part.pose
				? [part.pose]
				: // Sem pose, as peças ficariam todas empilhadas na origem, uma dentro
					// da outra. Enfileirar no plano Z=0 pelo menos deixa o desenho legível
					// — e deixa óbvio que o gerador não informou montagem.
					[
						{
							pos: [r4(cursorX - bounds.minX), r4(-bounds.minY), 0],
							rot: [0, 0, 0],
						},
					];
		if (!part.pose && !part.poses?.length) {
			cursorX += bounds.maxX - bounds.minX + GAP_FALLBACK_MM;
		}

		const bends = bendsOf(part);
		const contorno = outline.map(
			([x, y]) => [r4(x), r4(y)] as [number, number],
		);
		poses.forEach((pose, i) => {
			parts.push({
				// Instância além da primeira ganha sufixo: o id é a chave do corpo na
				// cena 3D, e dois corpos com o mesmo id se sobrescrevem no viewer.
				id: i === 0 ? part.id : `${part.id}#${i + 1}`,
				label: part.label,
				thickness: part.thickness,
				material: part.material,
				outline: contorno,
				holes: holes as [number, number][][],
				pose,
				...(bends ? { bends } : {}),
			});
		});
	}

	// Caixa da montagem: contorno externo nas duas faces (z local 0 e espessura),
	// já com a pose aplicada. Furo nunca amplia caixa, então fica de fora.
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (const p of parts) {
		for (const [x, y] of p.outline) {
			for (const z of [0, p.thickness]) {
				const w = poseApply([x, y, z], p.pose);
				for (let i = 0; i < 3; i++) {
					if (w[i] < min[i]) min[i] = w[i];
					if (w[i] > max[i]) max[i] = w[i];
				}
			}
		}
	}
	const vazio = !Number.isFinite(min[0]);

	return {
		units: 'mm',
		parts,
		bbox: vazio
			? { min: [0, 0, 0], max: [0, 0, 0] }
			: {
					min: [r4(min[0]), r4(min[1]), r4(min[2])],
					max: [r4(max[0]), r4(max[1]), r4(max[2])],
				},
	};
}
