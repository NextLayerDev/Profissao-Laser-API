import { z } from 'zod';
import { readDxf } from '../../lib/cad/dxf-read.js';
import type { LayerId, Pt, Sketch2D } from '../../lib/cad/ir.js';
import { readDiagnostics } from '../../lib/cad/read-common.js';
import { sketchToSvg } from '../../lib/cad/render-svg.js';
import { readSvg, sniffFormat } from '../../lib/cad/svg-read.js';
import {
	analyzeGeometry,
	type CadMetrics,
	CHAIN_TOL_MM,
	type Diagnostic,
	diagnose,
} from '../../lib/cad/topology.js';
import type { UnitName } from '../../lib/cad/units.js';
import {
	type CuratedSpeedRow,
	type LaserKind,
	resolveCutSpeed,
} from '../../lib/quote/cut-speed.js';
import type {
	MaterialBasis,
	MaterialInput,
} from '../../lib/quote/materials.js';
import {
	computeQuote,
	DEFAULT_PROFILE,
	profileFromCollectionData,
	type QuoteBreakdown,
	type QuoteMetrics,
	type QuoteProfile,
} from '../../lib/quote/pricing.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos da CENTRAL DE CUSTOS (categorias `cad` e `quote`).
 *
 * O caminho é sempre o mesmo e sempre determinístico:
 *   arquivo → `cad.parse` → `cad.metrics` → `cad.diagnose` / `cad.preview_svg`
 *           → `quote.price`
 *
 * A REGRA INVIOLÁVEL desta ferramenta: nenhum número aqui passa por IA. Preço,
 * área, comprimento e peso saem de `lib/cad/*` e `lib/quote/*`, que são puros e
 * testados. Um LLM que "estima" um orçamento produz erro com cara de acerto —
 * o pior modo de falha possível quando alguém vai cobrar por isso.
 *
 * Os dados (materiais, velocidades, perfil de custo) vivem em COLEÇÕES da
 * Fábrica, não em tabela nova: `quote.price` lê a coleção pelo repositório com
 * `import()` dinâmico, exatamente como `blocks/collection.ts` — import estático
 * de `repositories/*` arrastaria validação de env para dentro da suíte.
 */

/* ─────────────────────────── Params compartilhados ─────────────────────────── */

/** `''`/`null` (campo em branco no multipart) contam como ausente, não como 0. */
function vazioComoAusente(v: unknown): unknown {
	return v === '' || v === null ? undefined : v;
}

function desserializa(v: unknown): unknown {
	const limpo = vazioComoAusente(v);
	if (typeof limpo !== 'string') return limpo;
	try {
		return JSON.parse(limpo);
	} catch {
		return limpo;
	}
}

function ehSketch(v: unknown): v is Sketch2D {
	const s = v as Partial<Sketch2D> | null | undefined;
	return (
		!!s && typeof s === 'object' && Array.isArray(s.parts) && s.units === 'mm'
	);
}

function ehMetrics(v: unknown): v is CadMetrics {
	const m = v as Partial<CadMetrics> | null | undefined;
	return (
		!!m &&
		typeof m === 'object' &&
		typeof m.comprimento_corte_mm === 'number' &&
		Array.isArray(m.contornos)
	);
}

const sketchParam: z.ZodType<Sketch2D, unknown> = z.preprocess(
	desserializa,
	z.custom<Sketch2D>(ehSketch, {
		message: 'esperado o desenho (sketch) produzido por cad.parse',
	}),
);

const metricsParam: z.ZodType<CadMetrics, unknown> = z.preprocess(
	desserializa,
	z.custom<CadMetrics>(ehMetrics, {
		message: 'esperado o resultado de cad.metrics',
	}),
);

/**
 * O arquivo enviado. Chega como Buffer (o motor põe o `type:'file'` cru na bag);
 * string é aceita para uma definition poder colar um SVG literal em teste.
 */
const arquivoParam: z.ZodType<Buffer, unknown> = z.preprocess(
	(v) =>
		typeof v === 'string' && v.trim() !== '' ? Buffer.from(v, 'utf8') : v,
	z.custom<Buffer>((v) => Buffer.isBuffer(v) && v.byteLength > 0, {
		message: 'envie o arquivo DXF ou SVG (input type:"file")',
	}),
);

/** Numérico OPCIONAL: distingue "não informado" de zero. */
function numOpcional(min: number, max: number) {
	return z.preprocess(
		vazioComoAusente,
		z.coerce.number().min(min).max(max).optional(),
	);
}

function txtOpcional(max: number) {
	return z.preprocess(
		vazioComoAusente,
		z.string().trim().min(1).max(max).optional(),
	);
}

/** R$ a partir de centavos, na grafia que o profissional lê na tela. */
function brl(cents: number): string {
	return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ───────────────────────────────── cad.parse ───────────────────────────────── */

/**
 * `auto` = deixa o arquivo mandar (`$INSUNITS` no DXF, `width`/`height` com
 * unidade no SVG) e cai na heurística de tamanho quando ele não diz nada.
 * `pol` é sinônimo de `in` porque é como o profissional fala.
 */
const UNIDADES = ['auto', 'mm', 'cm', 'm', 'in', 'pol', 'ft', 'px'] as const;

function hintDe(u: (typeof UNIDADES)[number]): UnitName | undefined {
	if (u === 'auto') return undefined;
	if (u === 'pol') return 'in';
	return u;
}

const parseSchema = z.object({
	file: arquivoParam,
	/**
	 * Nome do arquivo. O motor publica `input.<nome>__filename` na bag, então a
	 * definition liga este param nele. Serve só de DESEMPATE: o formato é decidido
	 * pelo conteúdo (`sniffFormat`), porque a extensão mente com frequência.
	 */
	filename: txtOpcional(300),
	unit_hint: z.enum(UNIDADES).default('auto'),
	/** Tolerância de corda da tesselação, em mm. */
	tolerance_mm: z.coerce.number().min(0.001).max(1).default(0.05),
});

export const cadParseBlock: ToolBlock<z.infer<typeof parseSchema>> = {
	id: 'cad.parse',
	category: 'cad',
	description:
		'Lê um arquivo DXF ou SVG e devolve o desenho na IR do CAD (mesma forma dos geradores), com a unidade detectada e o diagnóstico da leitura.',
	paramsSchema: parseSchema,
	async run(_ctx, p) {
		const formato = sniffFormat(p.file) ?? formatoPelaExtensao(p.filename);
		if (!formato) {
			throw new ToolEngineError(
				400,
				'não reconheci o arquivo como DXF nem como SVG. DXF binário e ZIP não são suportados: exporte como DXF ASCII (R12/2000+) ou SVG.',
			);
		}

		const texto = p.file.toString('utf8');
		const opts = {
			eps: p.tolerance_mm,
			unitHint: hintDe(p.unit_hint),
			label: p.filename ?? 'arquivo',
		};
		const sketch =
			formato === 'dxf' ? readDxf(texto, opts) : readSvg(texto, opts);

		const diag = readDiagnostics(sketch);
		const entityCount = diag
			? Object.values(diag.lidas).reduce((s, n) => s + n, 0)
			: 0;
		const bbox = sketch.parts[0]?.bbox ?? { w: 0, h: 0 };

		return {
			sketch,
			// `unit` é a UNIDADE em que o arquivo foi lido ("in"); `unit_detected` é
			// COMO isso foi decidido ("insunits" | "svg" | "hint" | "heuristica").
			// São coisas diferentes e as duas importam: unidade errada muda o preço
			// por 25×, e a tela precisa saber se deve pedir confirmação.
			unit: diag?.unidade.detected ?? 'mm',
			unit_detected: diag?.unidade.source ?? 'hint',
			unit_warning: diag?.unidade.warning ?? '',
			entity_count: entityCount,
			format: formato,
			bbox_w_mm: r3(bbox.w),
			bbox_h_mm: r3(bbox.h),
			warnings: sketch.meta.warnings,
			// Diagnóstico serializado, para a definition projetar em `output.*` sem
			// o motor precisar carregar um objeto na saída de texto.
			json: JSON.stringify(diag ?? {}),
		};
	},
};

function formatoPelaExtensao(filename?: string): 'dxf' | 'svg' | null {
	const ext = (filename ?? '').toLowerCase().split('.').pop();
	if (ext === 'dxf') return 'dxf';
	if (ext === 'svg') return 'svg';
	return null;
}

/* ──────────────────────────────── cad.metrics ──────────────────────────────── */

const metricsSchema = z.object({
	sketch: sketchParam,
	/** Distância máxima entre pontas para o encadeamento juntá-las (mm). */
	tolerance_mm: z.coerce.number().min(0.001).max(5).default(CHAIN_TOL_MM),
	eps_mm: z.coerce.number().min(0.001).max(1).default(0.05),
});

export const cadMetricsBlock: ToolBlock<z.infer<typeof metricsSchema>> = {
	id: 'cad.metrics',
	category: 'cad',
	description:
		'Mede o desenho: comprimento de corte, gravação, contornos, furos, peças, área bruta e líquida. Tudo determinístico — é o que a precificação cobra.',
	paramsSchema: metricsSchema,
	async run(_ctx, p) {
		const metrics = analyzeGeometry(p.sketch, {
			tol: p.tolerance_mm,
			eps: p.eps_mm,
		});
		return {
			// O objeto vai INTEIRO e SEM arredondar para `quote.price`: os campos
			// abaixo são só para exibição, e arredondar a fonte encareceria/baratearia
			// o orçamento por um erro de exibição.
			metrics,
			json: JSON.stringify(metrics),
			length_mm: r3(metrics.comprimento_corte_mm),
			engrave_length_mm: r3(metrics.comprimento_gravacao_mm),
			pieces: metrics.n_pecas,
			holes: metrics.n_furos,
			contours: metrics.n_contornos,
			open_contours: metrics.n_abertos,
			pierces: metrics.n_piercings,
			width_mm: r3(metrics.bbox.w),
			height_mm: r3(metrics.bbox.h),
			area_net_mm2: r3(metrics.area_liquida_mm2),
			area_gross_mm2: r3(metrics.area_bruta_mm2),
			warnings: metrics.avisos,
		};
	},
};

/* ─────────────────────────────── cad.diagnose ─────────────────────────────── */

/**
 * Diagnósticos que PODEM ir para o cliente final (o cliente da assistência, não
 * o profissional). ALLOWLIST, nunca blocklist: cada código aqui foi lido um a
 * um e fala só do ARQUIVO que o cliente mandou — o que ele precisa corrigir no
 * CAD dele.
 *
 * `peca_maior_que_chapa` fica DE FORA de propósito: a mensagem cita a medida da
 * chapa que o profissional compra e o formato da mesa da máquina dele. Isso é
 * capacidade instalada, é informação de negócio, e não vai num orçamento.
 */
export const DIAG_PUBLICOS = new Set([
	'contorno_quase_fechado',
	'linha_solta',
	'linha_duplicada',
	'texto_nao_vetorizado',
	'geometria_degenerada',
	'bifurcacao',
	'auto_intersecao',
	'area_duvidosa',
	'entidade_nao_suportada',
	'escala_suspeita',
	'furo_pequeno',
	'sem_peca',
]);

const diagnoseSchema = z.object({
	sketch: sketchParam,
	metrics: metricsParam,
	/** Chapa disponível (mm) — habilita o teste de "peça maior que a chapa". */
	chapa_w: numOpcional(1, 20_000),
	chapa_h: numOpcional(1, 20_000),
	/** Espessura do material (mm) — habilita o teste de furo pequeno demais. */
	espessura_mm: numOpcional(0.01, 100),
});

export const cadDiagnoseBlock: ToolBlock<z.infer<typeof diagnoseSchema>> = {
	id: 'cad.diagnose',
	category: 'cad',
	description:
		'Aponta problemas do arquivo em PT-BR acionável (contorno aberto, linha duplicada, texto não vetorizado, peça maior que a chapa, furo que não vaza). Separa o que pode ser mostrado ao cliente final.',
	paramsSchema: diagnoseSchema,
	async run(_ctx, p) {
		const chapa =
			p.chapa_w && p.chapa_h ? { w: p.chapa_w, h: p.chapa_h } : null;
		const warnings = diagnose(p.sketch, p.metrics, {
			chapa,
			espessura: p.espessura_mm ?? null,
		});

		// `ids` são identificadores internos de contorno (`arquivo#12`): úteis para
		// o profissional caçar a geometria, ruído (e vazamento de processo) num
		// orçamento. Saem da versão pública.
		const publicos = warnings
			.filter((d) => DIAG_PUBLICOS.has(d.code))
			.map(({ code, severity, message, count }) => ({
				code,
				severity,
				message,
				count,
			}));

		const erros = warnings.filter((d) => d.severity === 'erro');
		return {
			warnings,
			public_warnings: publicos,
			json: JSON.stringify(warnings),
			error_count: erros.length,
			warning_count: warnings.length,
			/** `true` = tem erro que impede orçar com confiança. */
			has_error: erros.length > 0,
			codes: warnings.map((d: Diagnostic) => d.code),
		};
	},
};

/* ────────────────────────────── cad.preview_svg ────────────────────────────── */

const previewSchema = z.object({
	sketch: sketchParam,
	/** Fundo do SVG; vazio deixa transparente. */
	fundo: z.string().max(40).default(''),
});

export const cadPreviewSvgBlock: ToolBlock<z.infer<typeof previewSchema>> = {
	id: 'cad.preview_svg',
	category: 'cad',
	description:
		'Prévia do arquivo lido, em SVG na escala real (mm) e com as cores de cada camada. Devolve inline (data URL) — não sobe nada para o storage.',
	paramsSchema: previewSchema,
	async run(_ctx, p) {
		// Sem `nest`: arquivo lido é uma peça só, e o que o profissional quer ver é
		// o desenho dele, não uma simulação de chapa.
		const svg = sketchToSvg(p.sketch, undefined, {
			...(p.fundo ? { background: p.fundo } : {}),
		});
		return {
			svg,
			// Montada aqui (e não com `sketchToDataUrl`) só para não renderizar o
			// mesmo desenho duas vezes. Base64 é obrigatório: em data URL utf8 crua
			// o `#` das cores vira início de fragmento e trunca o SVG.
			dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
		};
	},
};

/* ─────────────────────────────── quote.price ─────────────────────────────── */

/**
 * Carrega definition + coleções SOB DEMANDA — mesmo motivo de
 * `blocks/collection.ts`: `tool-definitions` e o cliente Supabase validam env no
 * topo do módulo, e este arquivo entra no registry, que todo teste do motor
 * importa.
 */
async function loadDeps() {
	const [
		{ loadPublishedToolDefinition },
		{ resolveCollection },
		{ toolCollectionRepository },
	] = await Promise.all([
		import('../../lib/tool-definitions.js'),
		import('../../lib/tool-collections.js'),
		import('../../repositories/tool-collection.js'),
	]);
	return {
		loadPublishedToolDefinition,
		resolveCollection,
		toolCollectionRepository,
	};
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const priceSchema = z.object({
	metrics: metricsParam,
	/** Tool dona das coleções. Outra tool é permitido: coleção é dado compartilhado. */
	tool: z.string().min(1).max(60).default('central_custos'),
	qtd: z.coerce.number().int().min(1).max(100_000).default(1),
	espessura_mm: z.coerce.number().min(0.01).max(100),

	// ── material: id/família na coleção, ou tudo à mão ───────────────────────
	/** Id do registro em `materiais` (UUID) OU a família ("mdf", "aço carbono"). */
	material_id: txtOpcional(120),
	material_nome: txtOpcional(120),
	material_familia: txtOpcional(80),
	preco_kg: numOpcional(0, 100_000),
	preco_m2: numOpcional(0, 100_000),
	densidade: numOpcional(0.01, 25),
	chapa_w: numOpcional(1, 20_000),
	chapa_h: numOpcional(1, 20_000),
	custo_fixo_chapa: numOpcional(0, 100_000),
	base_area: z.enum(['perfil', 'liquido', 'bbox', 'chapa']).default('perfil'),

	// ── perfil de precificação (coleção `perfis`, privada do dono) ───────────
	perfil_id: txtOpcional(120),

	// ── overrides de velocidade (nível 0 da cascata) ─────────────────────────
	velocidade_mm_s: numOpcional(0.01, 20_000),
	passadas: z.preprocess(
		vazioComoAusente,
		z.coerce.number().int().min(1).max(50).optional(),
	),
	pierce_s: numOpcional(0, 120),
	/** Nome da coleção de velocidades consultada. */
	velocidades_collection: z.string().min(1).max(40).default('velocidades'),

	// ── ajustes do orçamento ─────────────────────────────────────────────────
	acabamento: numOpcional(0, 100_000),
	tempo_manual_min: numOpcional(0, 10_000),
	desconto_pct: numOpcional(0, 99),
	precificar_por: z.enum(['perfil', 'markup', 'margem']).default('perfil'),
});

type PriceParams = z.infer<typeof priceSchema>;

/** `data` de um registro de coleção — sempre chaves soltas vindas do banco. */
type Row = Record<string, unknown>;

function num(v: unknown): number | undefined {
	if (v === undefined || v === null || v === '') return undefined;
	const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
	return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
	if (v === undefined || v === null) return undefined;
	const s = String(v).trim();
	return s === '' ? undefined : s;
}

/**
 * Traduz `CadMetrics` (o que o arquivo TEM) em `QuoteMetrics` (o que o preço
 * PRECISA). As duas armadilhas desta ponte:
 *
 * 1. `CadMetrics` já vem multiplicado pelo `qty` de cada peça do sketch; um
 *    arquivo lido tem sempre `qty: 1` (`finalizeSketch`), então a métrica é de
 *    UMA unidade e o `qtd` do pedido multiplica por cima. Se o desenho já
 *    trouxer cópias, isso vira AVISO — em vez de dobrar o preço em silêncio.
 * 2. gravação: a topologia mede COMPRIMENTO de traço e o precificador cobra
 *    ÁREA varrida. `area = comprimento × passo_de_linha` é a conversão EXATA
 *    para gravação vetorial, porque o tempo cai em `(L·line)/(v·line) = L/v`.
 */
function toQuoteMetrics(
	m: CadMetrics,
	profile: QuoteProfile,
	extra: { tempoManualMin?: number },
): { metrics: QuoteMetrics; avisos: string[] } {
	const avisos: string[] = [];
	const copias = m.pecas.reduce((mx, p) => Math.max(mx, p.qty), 1);
	if (copias > 1) {
		avisos.push(
			`o desenho já traz ${copias} cópia(s) da peça: a quantidade pedida multiplica sobre isso`,
		);
	}

	const entryPoints: Pt[] = [];
	for (const c of m.contornos) {
		if ((c.layer as LayerId) !== 'CORTE') continue;
		const p0 = c.pts[0];
		if (p0) entryPoints.push(p0);
	}

	return {
		avisos,
		metrics: {
			cutLengthMm: m.comprimento_corte_mm,
			pierces: m.n_piercings,
			engraveAreaMm2: m.comprimento_gravacao_mm * profile.lineMm,
			netAreaMm2: m.area_liquida_mm2,
			bboxAreaMm2: m.area_bruta_mm2,
			bbox: { w: m.bbox.w, h: m.bbox.h },
			entryPoints,
			...(extra.tempoManualMin !== undefined
				? { manualMinutes: extra.tempoManualMin }
				: {}),
		},
	};
}

/** Registro de `materiais` → entrada de material do precificador. */
function materialDaColecao(
	p: PriceParams,
	entry: { title: string; data: Row } | null,
	profile: QuoteProfile,
): MaterialInput {
	const d = entry?.data ?? {};

	// Material marcado como não-cortável é BLOQUEIO, não aviso: PVC no laser
	// libera cloro (vira ácido clorídrico e come a máquina e o pulmão de quem
	// está na sala), policarbonato e ABS derretem. Preço plausível para um
	// trabalho que não se faz é pior que erro nenhum.
	const laserDoMaterial = str(d.laser);
	if (laserDoMaterial === 'nao') {
		throw new ToolEngineError(
			400,
			`'${entry?.title ?? p.material_id}' não pode ser cortado a laser (libera cloro ou derrete em vez de cortar). Escolha outro material.`,
		);
	}

	const nome = p.material_nome ?? entry?.title ?? p.material_id;
	if (!nome) {
		throw new ToolEngineError(
			400,
			'escolha o material (material_id) ou informe material_nome com preço',
		);
	}
	const familia = p.material_familia ?? str(d.familia) ?? nome;
	const basis: MaterialBasis | undefined =
		p.base_area === 'perfil' ? undefined : p.base_area;

	return {
		nome,
		familia,
		espessuraMm: p.espessura_mm,
		densidade: p.densidade ?? num(d.densidade_g_cm3),
		precoKg: p.preco_kg ?? num(d.preco_kg),
		precoM2: p.preco_m2 ?? num(d.preco_m2),
		custoFixoChapa: p.custo_fixo_chapa ?? num(d.custo_fixo_chapa),
		chapaWmm: p.chapa_w ?? num(d.chapa_w_mm),
		chapaHmm: p.chapa_h ?? num(d.chapa_h_mm),
		aproveitamento: profile.aproveitamentoChapa,
		...(basis ? { basis } : {}),
	};
}

/** Registro de `velocidades` → linha curada da cascata de velocidade. */
function linhaVelocidade(d: Row): CuratedSpeedRow | null {
	const espessuraMm = num(d.espessura_mm);
	const speedMmS = num(d.velocidade_mm_s);
	if (!(espessuraMm && espessuraMm > 0) || !(speedMmS && speedMmS > 0)) {
		return null;
	}
	const laser = str(d.laser);
	// `tempo_perfuracao_ms` é a MESMA coluna da coleção `receitas` do Metallic —
	// em MILISSEGUNDOS. A cascata pede segundos.
	const pierceMs = num(d.tempo_perfuracao_ms);
	return {
		espessuraMm,
		speedMmS,
		passes: num(d.passadas),
		pierceS: pierceMs === undefined ? undefined : pierceMs / 1000,
		potenciaW: num(d.potencia_w),
		familia: str(d.material),
		laser:
			laser === 'fibra' || laser === 'co2' ? (laser as LaserKind) : undefined,
		fonte: str(d.maquina),
	};
}

/**
 * Orçamento público: o que pode ser copiado e mandado para o cliente final.
 *
 * Nada de custo, taxa-hora, markup, margem, imposto ou pedido mínimo — esses
 * são o negócio do profissional. Também NÃO leva `breakdown.avisos`, que citam
 * exatamente isso ("pedido mínimo aplicado: o cálculo deu R$ 12,30…").
 *
 * Exportada só para o teste-guarda: ele varre o payload achatado atrás de
 * qualquer chave de custo/margem e quebra no dia em que alguém acrescentar uma
 * aqui dentro.
 */
export function orcamentoPublico(
	b: QuoteBreakdown,
	m: CadMetrics,
	espessuraMm: number,
) {
	return {
		quantidade: b.qty,
		material: b.material.nome,
		espessura_mm: espessuraMm,
		peca: {
			largura_mm: r3(m.bbox.w),
			altura_mm: r3(m.bbox.h),
			furos: m.n_furos,
			corte_mm: r3(m.comprimento_corte_mm),
		},
		// Quando o pedido mínimo entra, `precoTotalCents` é SUBSTITUÍDO pelo mínimo
		// mas o unitário e o desconto continuam os originais — e o cliente recebia
		// um documento onde `qty × unitário − desconto` não dá o total (50 × 0,50 −
		// 10% = 22,50, total 50,00). Nesse caso publicamos o unitário efetivo
		// (`total / qty`) e zeramos o desconto, sem citar o valor calculado, que é
		// negócio do profissional. Fora dele nada muda: a conta já fechava.
		preco_unitario: brl(
			b.precos.aplicouPedidoMinimo
				? b.precos.precoUnitEfetivoCents
				: b.precos.precoUnitCents,
		),
		preco_unitario_cents: b.precos.aplicouPedidoMinimo
			? b.precos.precoUnitEfetivoCents
			: b.precos.precoUnitCents,
		desconto_pct: b.precos.aplicouPedidoMinimo
			? 0
			: r3(b.precos.descontoPct * 100),
		pedido_minimo: b.precos.aplicouPedidoMinimo,
		total: brl(b.precos.precoTotalCents),
		total_cents: b.precos.precoTotalCents,
		prazo_dias: b.prazoDias,
		// A tela TEM que dizer isto ao cliente quando for verdade: o preço saiu de
		// velocidade estimada, não medida na máquina.
		estimativa: b.velocidade.estimativa,
	};
}

export const quotePriceBlock: ToolBlock<PriceParams> = {
	id: 'quote.price',
	category: 'quote',
	description:
		'Calcula custo e preço de venda do trabalho: material, tempo de máquina, deslocamento, mão de obra, overhead, markup/margem, imposto, desconto por quantidade e prazo. Material, velocidade de corte e perfil vêm das coleções — nenhum número passa por IA.',
	paramsSchema: priceSchema,
	async run(ctx, p) {
		const {
			loadPublishedToolDefinition,
			resolveCollection,
			toolCollectionRepository: repo,
		} = await loadDeps();
		// `ctx.toolDoc` = definition já carregada pelo chamador (link público, que
		// não tem Bearer para falar com o upvox por HTTP). Ausente = caminho de
		// sempre, pelo loader com cache.
		const doc =
			(ctx.toolDoc as Parameters<typeof resolveCollection>[0] | undefined) ??
			(
				await loadPublishedToolDefinition(
					p.tool,
					ctx.customerId,
					ctx.authHeader,
				)
			).definition;
		const viewer = { customerId: ctx.customerId, isStaff: false };

		/* ── perfil de precificação ─────────────────────────────────────────── */
		let profile: QuoteProfile = DEFAULT_PROFILE;
		const avisos: string[] = [];
		if (p.perfil_id) {
			const perfil = await repo.findById(p.perfil_id, p.tool, 'perfis');
			if (!perfil) {
				throw new ToolEngineError(404, 'perfil de custo não encontrado');
			}
			// `visibility:'owner'`: perfil é preço de custo, salário e margem. Nem
			// staff lê o de outra pessoa por aqui — quem pede o orçamento tem que
			// ser o dono do perfil que o precifica.
			if (perfil.owner_id && perfil.owner_id !== ctx.customerId) {
				throw new ToolEngineError(403, 'este perfil de custo não é seu');
			}
			profile = profileFromCollectionData(perfil.data);
		} else {
			avisos.push(
				'sem perfil de custo: o orçamento saiu com os valores padrão do sistema. Crie o seu perfil para o preço valer para a SUA máquina.',
			);
		}

		/* ── material ───────────────────────────────────────────────────────── */
		let matEntry: { title: string; data: Row } | null = null;
		if (p.material_id) {
			const cfgMat = resolveCollection(doc, 'materiais');
			if (UUID_RE.test(p.material_id)) {
				matEntry = await repo.findById(p.material_id, p.tool, 'materiais');
			} else {
				// Não é UUID: é a FAMÍLIA escolhida no dropdown da tela (o enum da
				// definition não pode listar ids que só existem depois do seed).
				const achados = await repo.list(p.tool, 'materiais', cfgMat, {
					viewer,
					filters: { familia: { kind: 'eq', value: p.material_id } },
					pageSize: 1,
					page: 1,
				});
				matEntry = achados.items[0] ?? null;
			}
			if (!matEntry) {
				throw new ToolEngineError(
					404,
					`material '${p.material_id}' não está na base de materiais`,
				);
			}
		}
		const material = materialDaColecao(p, matEntry, profile);

		/* ── velocidade de corte (cascata) ──────────────────────────────────── */
		const curated: CuratedSpeedRow[] = [];
		if (p.velocidade_mm_s === undefined) {
			try {
				const cfgVel = resolveCollection(doc, p.velocidades_collection);
				const hits = await repo.nearest(
					p.tool,
					p.velocidades_collection,
					cfgVel,
					{ espessura_mm: p.espessura_mm, potencia_w: profile.potenciaW },
					{ material: material.familia ?? material.nome, operacao: 'corte' },
				);
				for (const h of hits.slice(0, 12)) {
					const linha = linhaVelocidade(h.entry.data);
					if (linha) curated.push(linha);
				}
			} catch (err) {
				// Coleção ausente na definition não pode derrubar o orçamento: a
				// cascata tem mais dois níveis abaixo (comunidade e curva do modelo).
				if (!(err instanceof ToolEngineError && err.status === 404)) throw err;
			}
		}

		const speed = resolveCutSpeed(
			{
				familia: material.familia ?? material.nome,
				espessuraMm: p.espessura_mm,
				laser: profile.laser,
				potenciaW: profile.potenciaW,
				speedMmS: p.velocidade_mm_s,
				passes: p.passadas,
				pierceS: p.pierce_s,
			},
			{ curated },
		);

		/* ── preço ──────────────────────────────────────────────────────────── */
		const ponte = toQuoteMetrics(p.metrics, profile, {
			tempoManualMin: p.tempo_manual_min,
		});
		const breakdown = computeQuote(ponte.metrics, profile, {
			qty: p.qtd,
			material,
			speed,
			...(p.acabamento !== undefined
				? { acabamentoPorPeca: p.acabamento }
				: {}),
			...(p.tempo_manual_min !== undefined
				? { tempoManualMin: p.tempo_manual_min }
				: {}),
			...(p.precificar_por !== 'perfil'
				? { precificarPor: p.precificar_por }
				: {}),
			// Vem em 0–100 na tela (é como o profissional digita "10% de desconto"),
			// e o precificador trabalha em fração.
			...(p.desconto_pct !== undefined
				? { descontoPct: p.desconto_pct / 100 }
				: {}),
		});
		breakdown.avisos.unshift(...avisos, ...ponte.avisos);

		const publico = orcamentoPublico(breakdown, p.metrics, p.espessura_mm);
		return {
			breakdown,
			json: JSON.stringify(breakdown),
			public: publico,
			public_json: JSON.stringify(publico),
			price_unit_cents: breakdown.precos.precoUnitCents,
			price_total_cents: breakdown.precos.precoTotalCents,
			price_unit: brl(breakdown.precos.precoUnitCents),
			price_total: brl(breakdown.precos.precoTotalCents),
			cost_unit_cents: breakdown.custos.totalCents,
			lead_time_days: breakdown.prazoDias,
			confidence: breakdown.velocidade.confidence,
			speed_source: breakdown.velocidade.source,
			/** `true` = velocidade estimada; a tela pede confirmação antes de fechar. */
			estimate: breakdown.velocidade.estimativa,
			minutes_unit: r3(breakdown.tempos.unitarioS / 60),
			warnings: breakdown.avisos,
		};
	},
};

/** Blocos da Central de Custos, para registro no index. */
export const quoteBlocks: ToolBlock[] = [
	cadParseBlock,
	cadMetricsBlock,
	cadDiagnoseBlock,
	cadPreviewSvgBlock,
	quotePriceBlock,
];
