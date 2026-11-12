/**
 * Operações morfológicas e de flood fill sobre máscaras 1-canal.
 *
 * Convenção (a mesma de color-quantize.ts e potrace-utils.ts):
 *   0   = SELECIONADO (preto — é o que o potrace traça)
 *   255 = não selecionado (branco)
 *
 * Logo, "erodir" aqui significa ENCOLHER a região de zeros e "dilatar",
 * expandi-la. Tudo é iterativo (nada de recursão: 1200×1200 = 1,44M px
 * estouraria a pilha) e os filtros são separáveis (2 passes, O(n·r)).
 */

/** Fração de pixels selecionados (0..1). */
export function maskCoverage(mask: Buffer): number {
	let n = 0;
	for (let i = 0; i < mask.length; i++) if (mask[i] === 0) n++;
	return mask.length === 0 ? 0 : n / mask.length;
}

/** Min/max filter separável. `pick` = Math.min (dilata os zeros) ou Math.max (erode). */
function separableFilter(
	mask: Buffer,
	w: number,
	h: number,
	radius: number,
	mode: 'min' | 'max',
): Buffer {
	if (radius <= 0) return Buffer.from(mask);
	const isMin = mode === 'min';
	const scratch = Buffer.alloc(w * h);

	// passe horizontal
	for (let y = 0; y < h; y++) {
		const row = y * w;
		for (let x = 0; x < w; x++) {
			let acc = isMin ? 255 : 0;
			const x0 = Math.max(0, x - radius);
			const x1 = Math.min(w - 1, x + radius);
			for (let k = x0; k <= x1; k++) {
				const v = mask[row + k];
				if (isMin ? v < acc : v > acc) acc = v;
				if (isMin ? acc === 0 : acc === 255) break;
			}
			scratch[row + x] = acc;
		}
	}

	// passe vertical
	const out = Buffer.alloc(w * h);
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			let acc = isMin ? 255 : 0;
			const y0 = Math.max(0, y - radius);
			const y1 = Math.min(h - 1, y + radius);
			for (let k = y0; k <= y1; k++) {
				const v = scratch[k * w + x];
				if (isMin ? v < acc : v > acc) acc = v;
				if (isMin ? acc === 0 : acc === 255) break;
			}
			out[y * w + x] = acc;
		}
	}
	return out;
}

/** Expande a região selecionada (zeros) em `radius` px. */
export function dilateMask(
	mask: Buffer,
	w: number,
	h: number,
	radius: number,
): Buffer {
	return separableFilter(mask, w, h, radius, 'min');
}

/** Encolhe a região selecionada (zeros) em `radius` px. */
export function erodeMask(
	mask: Buffer,
	w: number,
	h: number,
	radius: number,
): Buffer {
	return separableFilter(mask, w, h, radius, 'max');
}

/** Fechamento morfológico: dilata e erode no mesmo raio. Fecha vãos finos. */
export function closeMask(
	mask: Buffer,
	w: number,
	h: number,
	radius: number,
): Buffer {
	return erodeMask(dilateMask(mask, w, h, radius), w, h, radius);
}

/**
 * BFS 4-vizinhos partindo de TODA a borda da imagem, andando só por pixels que
 * satisfaçam `passable`. Devolve o Uint8Array de visitados (1 = alcançado).
 * Fila em Int32Array (sem recursão, sem realocação).
 */
function floodFromBorder(
	w: number,
	h: number,
	passable: (idx: number) => boolean,
): Uint8Array {
	const n = w * h;
	const seen = new Uint8Array(n);
	const queue = new Int32Array(n);
	let head = 0;
	let tail = 0;

	const push = (idx: number) => {
		if (seen[idx] || !passable(idx)) return;
		seen[idx] = 1;
		queue[tail++] = idx;
	};
	for (let x = 0; x < w; x++) {
		push(x);
		push((h - 1) * w + x);
	}
	for (let y = 0; y < h; y++) {
		push(y * w);
		push(y * w + (w - 1));
	}

	while (head < tail) {
		const idx = queue[head++];
		const x = idx % w;
		const y = (idx - x) / w;
		if (x > 0) push(idx - 1);
		if (x < w - 1) push(idx + 1);
		if (y > 0) push(idx - w);
		if (y < h - 1) push(idx + w);
	}
	return seen;
}

/**
 * Preenche buracos brancos que NÃO estão conectados à borda da imagem — ou
 * seja, tudo que estiver cercado pela região selecionada passa a ser
 * selecionado. Sem isso, uma máscara que marca só o traço deixa o interior do
 * assunto de fora.
 */
export function fillInteriorHoles(mask: Buffer, w: number, h: number): Buffer {
	const outside = floodFromBorder(w, h, (idx) => mask[idx] !== 0);
	const out = Buffer.alloc(w * h);
	for (let i = 0; i < out.length; i++)
		out[i] = mask[i] === 0 || !outside[i] ? 0 : 255;
	return out;
}

/**
 * Máscara do assunto: 0 (selecionado) = assunto, 255 = fundo.
 *
 * O fundo é definido como "a área VAZIA em volta do desenho": parte da borda da
 * imagem e se espalha por pixels cuja vizinhança não tem desenho nenhum
 * (`density < maxDensity`). Depois esse núcleo é expandido por pixels sem tinta
 * (`gray >= inkThreshold`) para encostar no traço — senão sobraria um colarinho
 * de fundo colado no contorno, que gravaria como um halo.
 *
 * Por que em densidade e não só no cinza: uma parte CLARA do assunto cortada
 * pela moldura da imagem (um cinto, um ombro, a barra de um casaco) é um
 * corredor de pixels sem tinta ligado à borda — no flood puro em cinza ela vira
 * porta de entrada e o assunto é comido de dentro para fora. Na densidade esse
 * corredor tem desenho por perto e não é fundo.
 */
export function subjectByBackgroundDensity(
	gray: Buffer | Uint8Array,
	density: Float32Array,
	w: number,
	h: number,
	inkThreshold: number,
	maxDensity: number,
): Buffer {
	const core = floodFromBorder(w, h, (idx) => density[idx] < maxDensity);

	// expande o núcleo por pixels sem tinta (para no desenho)
	const n = w * h;
	const bg = Uint8Array.from(core);
	const queue = new Int32Array(n);
	let head = 0;
	let tail = 0;
	for (let i = 0; i < n; i++) if (bg[i]) queue[tail++] = i;
	const push = (j: number) => {
		if (bg[j] || gray[j] < inkThreshold) return;
		bg[j] = 1;
		queue[tail++] = j;
	};
	while (head < tail) {
		const idx = queue[head++];
		const x = idx % w;
		const y = (idx - x) / w;
		if (x > 0) push(idx - 1);
		if (x < w - 1) push(idx + 1);
		if (y > 0) push(idx - w);
		if (y < h - 1) push(idx + w);
	}

	const out = Buffer.alloc(n);
	for (let i = 0; i < n; i++) out[i] = bg[i] ? 255 : 0;
	return out;
}

/**
 * Densidade local de tinta: para cada pixel, a fração de pixels com tinta numa
 * janela quadrada de raio `radius`. Calculada por imagem integral (O(n)).
 *
 * É o que separa "área vazia" (densidade ~0) de "desenho" (hachura, malha de
 * tecido) sem depender de componente conexo — o que importa quando as duas
 * regiões se encostam.
 */
export function localInkDensity(
	gray: Buffer | Uint8Array,
	w: number,
	h: number,
	inkThreshold: number,
	radius: number,
): Float32Array {
	// imagem integral com uma linha/coluna de padding
	const sat = new Int32Array((w + 1) * (h + 1));
	for (let y = 0; y < h; y++) {
		let rowSum = 0;
		for (let x = 0; x < w; x++) {
			rowSum += gray[y * w + x] < inkThreshold ? 1 : 0;
			sat[(y + 1) * (w + 1) + (x + 1)] = sat[y * (w + 1) + (x + 1)] + rowSum;
		}
	}

	const out = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		const y0 = Math.max(0, y - radius);
		const y1 = Math.min(h - 1, y + radius);
		for (let x = 0; x < w; x++) {
			const x0 = Math.max(0, x - radius);
			const x1 = Math.min(w - 1, x + radius);
			const sum =
				sat[(y1 + 1) * (w + 1) + (x1 + 1)] -
				sat[y0 * (w + 1) + (x1 + 1)] -
				sat[(y1 + 1) * (w + 1) + x0] +
				sat[y0 * (w + 1) + x0];
			out[y * w + x] = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
		}
	}
	return out;
}

/**
 * Expande uma remoção já feita: partindo dos pixels que estavam selecionados em
 * `original` e não estão mais em `current`, continua removendo vizinhos ainda
 * selecionados e SEM tinta. Para exatamente no traço desenhado.
 *
 * É o que apaga o halo que a janela de densidade deixa em volta do desenho.
 * Muta `current` e devolve quantos pixels removeu a mais.
 */
export function growRemovalThroughNonInk(
	current: Buffer,
	original: Buffer,
	gray: Buffer | Uint8Array,
	w: number,
	h: number,
	inkThreshold: number,
): number {
	const n = w * h;
	const queue = new Int32Array(n);
	let head = 0;
	let tail = 0;
	for (let i = 0; i < n; i++) {
		if (original[i] === 0 && current[i] !== 0) queue[tail++] = i;
	}

	let grown = 0;
	const push = (j: number) => {
		if (current[j] !== 0 || gray[j] < inkThreshold) return; // já removido ou é traço
		current[j] = 255;
		grown++;
		queue[tail++] = j;
	};

	while (head < tail) {
		const idx = queue[head++];
		const x = idx % w;
		const y = (idx - x) / w;
		if (x > 0) push(idx - 1);
		if (x < w - 1) push(idx + 1);
		if (y > 0) push(idx - w);
		if (y < h - 1) push(idx + w);
	}
	return grown;
}

/** União de duas máscaras (0 = selecionado → byte-wise min). */
export function unionMasks(a: Buffer, b: Buffer): Buffer {
	const out = Buffer.alloc(a.length);
	for (let i = 0; i < a.length; i++) out[i] = a[i] < b[i] ? a[i] : b[i];
	return out;
}

/** Interseção de duas máscaras (0 = selecionado → byte-wise max). */
export function intersectMasks(a: Buffer, b: Buffer): Buffer {
	const out = Buffer.alloc(a.length);
	for (let i = 0; i < a.length; i++) out[i] = a[i] > b[i] ? a[i] : b[i];
	return out;
}

/**
 * Remove as ilhas pequenas da seleção: componentes conexos (4-vizinhança) com
 * área menor que `minFraction` da MAIOR ilha. Devolve a máscara nova e quantos
 * pixels saíram. O assunto é a ilha grande; as pequenas soltas no fundo são
 * manchas do alpha do segmentador.
 */
export function dropSmallIslands(
	mask: Buffer,
	w: number,
	h: number,
	minFraction: number,
): { mask: Buffer; removed: number } {
	const label = new Int32Array(w * h);
	const areas: number[] = [0];
	const stack: number[] = [];
	for (let start = 0; start < mask.length; start++) {
		if (mask[start] !== 0 || label[start] !== 0) continue;
		const id = areas.length;
		let area = 0;
		label[start] = id;
		stack.push(start);
		while (stack.length) {
			const p = stack.pop()!;
			area++;
			const x = p % w;
			const vizinhos = [
				x > 0 ? p - 1 : -1,
				x < w - 1 ? p + 1 : -1,
				p >= w ? p - w : -1,
				p < (h - 1) * w ? p + w : -1,
			];
			for (const q of vizinhos) {
				if (q < 0 || mask[q] !== 0 || label[q] !== 0) continue;
				label[q] = id;
				stack.push(q);
			}
		}
		areas.push(area);
	}
	const largest = Math.max(0, ...areas);
	const minArea = largest * minFraction;
	const out = Buffer.from(mask);
	let removed = 0;
	for (let i = 0; i < out.length; i++) {
		if (label[i] !== 0 && areas[label[i]] < minArea) {
			out[i] = 255;
			removed++;
		}
	}
	return { mask: out, removed };
}
