import { z } from 'zod';
import { sketchToAssembly } from '../../lib/cad/assembly.js';
import { type BbqParams, buildBbq } from '../../lib/cad/generators/bbq.js';
import { type BoxParams, buildBox } from '../../lib/cad/generators/box.js';
import {
	buildMedal,
	type MedalParams,
} from '../../lib/cad/generators/medal.js';
import {
	buildTrophy,
	type TrophyParams,
} from '../../lib/cad/generators/trophy.js';
import type { NestResult, Sketch2D } from '../../lib/cad/ir.js';
import { FOLGA_MAX, FOLGA_MIN } from '../../lib/cad/kerf.js';
import { gapFromKerf, MARGEM_PADRAO, nestParts } from '../../lib/cad/nest.js';
import { sketchToSvg } from '../../lib/cad/render-svg.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos do motor CAD (categoria `cad`) — a ponta da Fábrica que fala com
 * `lib/cad/*`. Um gerador produz o `Sketch2D` (IR), o nesting o distribui na
 * chapa e o render devolve a prévia; a exportação de arquivo fica em
 * `blocks/output-cad.ts`, porque só ela toca storage.
 *
 * O `sketch` trafega entre nós como OBJETO na bag do motor — não é serializado.
 * Ainda assim os schemas aceitam JSON em string, porque uma definition pode
 * colar um desenho literal no param (gabarito/teste na Fábrica).
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
		// Devolve a string crua: quem reprova é o `z.custom` abaixo, com mensagem
		// de domínio em vez de um "Unexpected token" do JSON.parse.
		return limpo;
	}
}

function ehSketch(v: unknown): v is Sketch2D {
	const s = v as Partial<Sketch2D> | null | undefined;
	return (
		!!s && typeof s === 'object' && Array.isArray(s.parts) && s.units === 'mm'
	);
}

function ehNest(v: unknown): v is NestResult {
	const r = v as Partial<NestResult> | null | undefined;
	return !!r && typeof r === 'object' && Array.isArray(r.sheets);
}

/**
 * A geometria já foi construída por um gerador nosso; revalidá-la caminho a
 * caminho custaria mais do que confiar no produtor. Aqui se confere só a casca —
 * o suficiente para o erro sair como 400 legível em vez de estourar lá dentro.
 */
// A anotação explícita não é decorativa: sem ela o zod infere a ENTRADA do
// `preprocess` como `unknown`, o que inclui `undefined`, e o campo aparece como
// opcional no `z.infer` — o consumidor passa a achar que `sketch` pode faltar
// quando na verdade a validação o exige.
const sketchParam: z.ZodType<Sketch2D, unknown> = z.preprocess(
	desserializa,
	z.custom<Sketch2D>(ehSketch, {
		message: 'esperado o desenho (sketch) produzido por um bloco cad.*',
	}),
);

const nestParam: z.ZodType<NestResult | undefined, unknown> = z.preprocess(
	desserializa,
	z
		.custom<NestResult>(ehNest, {
			message: 'esperado o resultado de um bloco cad.nest',
		})
		.optional(),
);

/** Booleano tolerante a "true"/"1"/1, como nos demais blocos da Fábrica. */
function bool(def: boolean) {
	return z
		.preprocess(
			(v) =>
				v === '' || v === undefined || v === null
					? def
					: v === true || v === 'true' || v === '1' || v === 1,
			z.boolean(),
		)
		.default(def);
}

/** Numérico OPCIONAL: distingue "não informado" de zero. */
function numOpcional(min: number, max: number) {
	return z.preprocess(
		vazioComoAusente,
		z.coerce.number().min(min).max(max).optional(),
	);
}

/* ───────────────────────────────── cad.box ───────────────────────────────── */

const boxSchema = z.object({
	/** `interno` mede o vão útil; `externo` mede a caixa montada. */
	dim_mode: z.enum(['interno', 'externo']).default('interno'),
	largura: z.coerce.number().positive().max(3000),
	profundidade: z.coerce.number().positive().max(3000),
	altura: z.coerce.number().positive().max(3000),
	espessura: z.coerce.number().positive().max(50),
	material: z.string().max(40).default('MDF'),
	/** Largura do risco do feixe. 0,15 mm é o CO2 típico em MDF 3 mm. */
	kerf: z.coerce.number().min(0).max(3).default(0.15),
	folga: z.coerce.number().min(FOLGA_MIN).max(FOLGA_MAX).default(0.1),
	encaixe: z.enum(['dente', 'dente_reforcado', 'topo_colado']).default('dente'),
	/** Sem valor, o gerador usa max(3t, 8) e limita a [6, 25]. */
	dente_alvo: numOpcional(1, 100),
	fundo: bool(true),
	tampa: z
		.enum(['nenhuma', 'deslizante', 'encaixe', 'solta'])
		.default('nenhuma'),
	tampa_folga: z.coerce.number().min(0).max(3).default(0.2),
	div_x: z.coerce.number().int().min(0).max(20).default(0),
	div_y: z.coerce.number().int().min(0).max(20).default(0),
	div_altura_pct: z.coerce.number().min(1).max(100).default(100),
	gravacao_tampa: z.string().max(200).default(''),
});

export const cadBoxBlock: ToolBlock<z.infer<typeof boxSchema>> = {
	id: 'cad.box',
	category: 'cad',
	description:
		'Gera uma caixa paramétrica com encaixe de dente (finger joint), tampa, fundo e divisórias. Devolve o desenho (sketch) para nesting, prévia e exportação.',
	paramsSchema: boxSchema,
	async run(_ctx, p) {
		// `dente_alvo` ausente tem que SUMIR do objeto: um `undefined` explícito
		// atropelaria o default do gerador (max(3t, 8)).
		const params: BoxParams = {
			dim_mode: p.dim_mode,
			largura: p.largura,
			profundidade: p.profundidade,
			altura: p.altura,
			espessura: p.espessura,
			material: p.material,
			kerf: p.kerf,
			folga: p.folga,
			encaixe: p.encaixe,
			fundo: p.fundo,
			tampa: p.tampa,
			tampa_folga: p.tampa_folga,
			div_x: p.div_x,
			div_y: p.div_y,
			div_altura_pct: p.div_altura_pct,
			gravacao_tampa: p.gravacao_tampa,
			...(p.dente_alvo !== undefined ? { dente_alvo: p.dente_alvo } : {}),
		};
		const sketch = buildBox(params);
		const st = sketch.meta.stats;
		return {
			sketch,
			warnings: sketch.meta.warnings,
			part_count: st.partCount,
			cut_length_mm: Math.round(st.cutLengthMm * 100) / 100,
			// Gravação sai num passe próprio da máquina: orçamento que só conta corte
			// erra o tempo de job em toda caixa com logotipo na tampa.
			engrave_length_mm: Math.round(st.engraveLengthMm * 100) / 100,
			pierces: st.pierces,
		};
	},
};

/* ───────────────────────────────── cad.bbq ───────────────────────────────── */

const bbqSchema = z.object({
	/**
	 * Maior que zero SOBRESCREVE comprimento/largura (0,03 m² por pessoa, razão
	 * 2:1). O gerador avisa quando substitui — o aviso vai em `warnings`.
	 */
	pessoas: numOpcional(0, 500),
	comprimento: numOpcional(1, 5000),
	largura: numOpcional(1, 3000),
	/** Profundidade da CUBA (altura da parede), não uma medida em Y. */
	profundidade: numOpcional(1, 1000),
	espessura: z.coerce.number().positive().max(50),
	material: z
		.enum(['aco_carbono', 'inox_304', 'inox_430', 'corten'])
		.default('aco_carbono'),
	/** Fibra em chapa de aço risca mais largo que CO2 em MDF: 0,2 mm é o típico. */
	kerf: z.coerce.number().min(0).max(3).default(0.2),
	folga: z.coerce.number().min(FOLGA_MIN).max(FOLGA_MAX).default(0.15),
	construcao: z.enum(['dobrada', 'encaixada', 'soldada']).default('dobrada'),
	/** Raio INTERNO da dobra. Sem valor, o gerador usa a própria espessura. */
	raio_dobra: numOpcional(0, 100),
	/**
	 * Fator K da fibra neutra. Sem valor, sai da tabela do material em `bend.ts`.
	 * Nunca chamar de `k`: neste motor `k` é kerf, e trocar os dois erra a
	 * planificação em milímetros.
	 */
	fator_k: numOpcional(0.01, 0.5),
	pes: z
		.enum(['nenhum', 'chapa_dobrada', 'cruzado_x', 'abas'])
		.default('nenhum'),
	altura_pes: numOpcional(1, 2000),
	grelha: z
		.enum(['nenhuma', 'chapa_vazada', 'varoes_apoio'])
		.default('nenhuma'),
	grelha_niveis: numOpcional(1, 6),
	grelha_passo: numOpcional(1, 100),
	grelha_rasgo: numOpcional(1, 100),
	respiros: z
		.enum(['nenhum', 'furos', 'rasgos', 'fundo_perfurado'])
		.default('nenhum'),
	/** Área aberta de respiro, em % da parede/fundo. */
	respiro_area_pct: numOpcional(0, 50),
	cinzeiro: z.enum(['nenhum', 'gaveta', 'fundo_perfurado']).default('nenhum'),
	gravacao_frente: z.string().max(200).default(''),
});

export const cadBbqBlock: ToolBlock<z.infer<typeof bbqSchema>> = {
	id: 'cad.bbq',
	category: 'cad',
	description:
		'Gera uma churrasqueira de chapa de aço paramétrica (dobrada, encaixada ou soldada) com pés, grelha, respiros e cinzeiro. Devolve o desenho (sketch) para nesting, prévia e exportação.',
	paramsSchema: bbqSchema,
	async run(_ctx, p) {
		// Os opcionais entram como `undefined` de propósito: todo default do
		// gerador é `?? PADRÃO`, e `undefined` explícito cai no mesmo ramo que a
		// chave ausente — inclusive no `params.comprimento !== undefined` que
		// decide se avisa "suas medidas foram substituídas por pessoas".
		const params: BbqParams = {
			pessoas: p.pessoas,
			comprimento: p.comprimento,
			largura: p.largura,
			profundidade: p.profundidade,
			espessura: p.espessura,
			material: p.material,
			kerf: p.kerf,
			folga: p.folga,
			construcao: p.construcao,
			raio_dobra: p.raio_dobra,
			fator_k: p.fator_k,
			pes: p.pes,
			altura_pes: p.altura_pes,
			grelha: p.grelha,
			grelha_niveis: p.grelha_niveis,
			grelha_passo: p.grelha_passo,
			grelha_rasgo: p.grelha_rasgo,
			respiros: p.respiros,
			respiro_area_pct: p.respiro_area_pct,
			cinzeiro: p.cinzeiro,
			gravacao_frente: p.gravacao_frente,
		};
		const sketch = buildBbq(params);
		const st = sketch.meta.stats;
		return {
			sketch,
			warnings: sketch.meta.warnings,
			part_count: st.partCount,
			cut_length_mm: Math.round(st.cutLengthMm * 100) / 100,
			engrave_length_mm: Math.round(st.engraveLengthMm * 100) / 100,
			pierces: st.pierces,
		};
	},
};

/* ─────────────────────────────── cad.trophy ─────────────────────────────── */

const trophySchema = z.object({
	altura_total: z.coerce.number().positive().max(3000),
	espessura: z.coerce.number().positive().max(50),
	material: z.enum(['mdf', 'acrilico', 'compensado']).default('mdf'),
	kerf: z.coerce.number().min(0).max(3).default(0.15),
	folga: z.coerce.number().min(FOLGA_MIN).max(FOLGA_MAX).default(0.1),
	/** Sem valor, o gerador usa 0,5 × altura (acima da pegada mínima de 0,45). */
	base_largura: numOpcional(1, 3000),
	base_profundidade: numOpcional(1, 3000),
	/** Sem valor, max(2t, 6): a base é o contrapeso, não pode ser fina como a haste. */
	base_espessura: numOpcional(1, 100),
	silhueta: z.enum(['conica', 'reta', 'taca', 'estrela']).default('conica'),
	placa: z.enum(['nenhuma', 'retangular', 'escudo']).default('retangular'),
	/** Sem valor, 0,16 × altura. Entra no empilhamento base + haste + placa. */
	placa_altura: numOpcional(1, 1000),
	gravacao_placa: z.string().max(200).default(''),
	/** Sem valor, max(4, 0,35 × placa_altura) — e o gerador ainda limita pela largura. */
	gravacao_altura: numOpcional(0.5, 200),
	fixacao: z.enum(['encaixe', 'parafuso']).default('encaixe'),
});

export const cadTrophyBlock: ToolBlock<z.infer<typeof trophySchema>> = {
	id: 'cad.trophy',
	category: 'cad',
	description:
		'Gera um troféu de encaixe em quatro peças (base + duas hastes em cross lap a 90° + placa de gravação), sem cola. Devolve o desenho (sketch) para nesting, prévia e exportação.',
	paramsSchema: trophySchema,
	async run(_ctx, p) {
		// Os opcionais viajam como `undefined` de propósito: todo default do gerador
		// é `?? PADRÃO`, e `undefined` cai no mesmo ramo que a chave ausente.
		const params: TrophyParams = {
			altura_total: p.altura_total,
			espessura: p.espessura,
			material: p.material,
			kerf: p.kerf,
			folga: p.folga,
			base_largura: p.base_largura,
			base_profundidade: p.base_profundidade,
			base_espessura: p.base_espessura,
			silhueta: p.silhueta,
			placa: p.placa,
			placa_altura: p.placa_altura,
			gravacao_placa: p.gravacao_placa,
			gravacao_altura: p.gravacao_altura,
			fixacao: p.fixacao,
		};
		const sketch = buildTrophy(params);
		const st = sketch.meta.stats;
		return {
			sketch,
			warnings: sketch.meta.warnings,
			part_count: st.partCount,
			cut_length_mm: Math.round(st.cutLengthMm * 100) / 100,
			engrave_length_mm: Math.round(st.engraveLengthMm * 100) / 100,
			pierces: st.pierces,
		};
	},
};

/* ─────────────────────────────── cad.medal ──────────────────────────────── */

const medalSchema = z.object({
	diametro: z.coerce.number().positive().max(2000),
	espessura: z.coerce.number().positive().max(50),
	material: z.enum(['mdf', 'acrilico', 'compensado']).default('mdf'),
	kerf: z.coerce.number().min(0).max(3).default(0.15),
	forma: z.enum(['disco', 'estrela', 'poligono', 'escudo']).default('disco'),
	/**
	 * Nº de lados (polígono) ou de pontas (estrela). OPCIONAL de propósito: o
	 * gerador avisa "lados só vale para polígono e estrela" quando o campo vem
	 * preenchido numa forma que o ignora, e um default fixo aqui faria esse aviso
	 * disparar em todo disco.
	 */
	lados: numOpcional(3, 12),
	/** Zero é resposta VÁLIDA (ficha/token sem furo) — daí o opcional em vez de default. */
	furo_fita_diametro: numOpcional(0, 100),
	furo_distancia_borda: numOpcional(0, 1000),
	aro: z.enum(['nenhum', 'simples', 'duplo']).default('nenhum'),
	gravacao_texto: z.string().max(200).default(''),
	gravacao_texto2: z.string().max(200).default(''),
	gravacao_altura: numOpcional(0.5, 200),
	/** Quantidade a CORTAR (multiplica o nesting), não peças de montagem. */
	qtd: numOpcional(1, 500),
});

export const cadMedalBlock: ToolBlock<z.infer<typeof medalSchema>> = {
	id: 'cad.medal',
	category: 'cad',
	description:
		'Gera medalhas planas (disco, estrela, polígono ou escudo) com furo de fita, aro e gravação de texto. Devolve o desenho (sketch) para nesting, prévia e exportação.',
	paramsSchema: medalSchema,
	async run(_ctx, p) {
		// `lados` em branco chega como `undefined`, e isso é o que importa: o gerador
		// só avisa "lados só vale para polígono e estrela" quando o campo vem
		// PREENCHIDO. Um default fixo no schema faria esse aviso aparecer em todo
		// disco/escudo.
		const params: MedalParams = {
			diametro: p.diametro,
			espessura: p.espessura,
			material: p.material,
			kerf: p.kerf,
			forma: p.forma,
			lados: p.lados,
			furo_fita_diametro: p.furo_fita_diametro,
			furo_distancia_borda: p.furo_distancia_borda,
			aro: p.aro,
			gravacao_texto: p.gravacao_texto,
			gravacao_texto2: p.gravacao_texto2,
			gravacao_altura: p.gravacao_altura,
			qtd: p.qtd,
		};
		const sketch = buildMedal(params);
		const st = sketch.meta.stats;
		return {
			sketch,
			warnings: sketch.meta.warnings,
			part_count: st.partCount,
			cut_length_mm: Math.round(st.cutLengthMm * 100) / 100,
			engrave_length_mm: Math.round(st.engraveLengthMm * 100) / 100,
			pierces: st.pierces,
		};
	},
};

/* ────────────────────────────── cad.assembly ────────────────────────────── */

const assemblySchema = z.object({ sketch: sketchParam });

export const cadAssemblyBlock: ToolBlock<z.infer<typeof assemblySchema>> = {
	id: 'cad.assembly',
	category: 'cad',
	description:
		'Converte o desenho 2D na montagem 3D (contornos e furos achatados, pose de cada peça) para a prévia interativa. Devolve o objeto e o mesmo conteúdo em JSON.',
	paramsSchema: assemblySchema,
	async run(_ctx, p) {
		const assembly = sketchToAssembly(p.sketch);
		return {
			assembly,
			// O `json` existe para a definition poder projetar a montagem em
			// `output.assembly` sem o motor tentar serializar um objeto na saída de
			// texto — e para colar num viewer externo em depuração.
			json: JSON.stringify(assembly),
			part_count: assembly.parts.length,
		};
	},
};

/* ──────────────────────────────── cad.nest ──────────────────────────────── */

const nestSchema = z.object({
	sketch: sketchParam,
	chapa_w: z.coerce.number().positive().max(20_000).default(600),
	chapa_h: z.coerce.number().positive().max(20_000).default(400),
	margem: z.coerce.number().min(0).max(200).default(MARGEM_PADRAO),
	/** Desligue com material que tem veio/direção (compensado, acrílico texturado). */
	rotacao: bool(true),
	/** Sem valor, sai do kerf do próprio desenho: max(2k, 1,5 mm). */
	gap: numOpcional(0, 200),
});

export const cadNestBlock: ToolBlock<z.infer<typeof nestSchema>> = {
	id: 'cad.nest',
	category: 'cad',
	description:
		'Encaixa as peças do desenho em chapas (MaxRects), respeitando margem e espaçamento. Devolve as posições, o aproveitamento e o que não coube.',
	paramsSchema: nestSchema,
	async run(_ctx, p) {
		const result = nestParts(
			p.sketch.parts,
			{ w: p.chapa_w, h: p.chapa_h },
			{
				margin: p.margem,
				gap: p.gap ?? gapFromKerf(p.sketch.meta?.kerf ?? 0),
				rotate: p.rotacao,
			},
		);
		return {
			result,
			sheets_used: result.sheets.length,
			utilization: result.utilization.map((u) => Math.round(u * 1000) / 1000),
			unplaced: result.unplaced,
			// `unplaced` repete o id uma vez por instância perdida; o contador poupa a
			// tela de saber disso para dizer "3 peças não couberam".
			unplaced_count: result.unplaced.length,
		};
	},
};

/* ───────────────────────────── cad.render_svg ───────────────────────────── */

const renderSvgSchema = z.object({
	sketch: sketchParam,
	nest: nestParam,
	/**
	 * `chapa` desenha a chapa do nesting (o que vai para a máquina); `pecas`
	 * ignora o nesting e mostra uma cópia de cada peça distinta lado a lado — é
	 * conferência de desenho, não simulação de chapa.
	 */
	modo: z.enum(['chapa', 'pecas']).default('chapa'),
	/** Qual chapa desenhar quando o nesting usou mais de uma (0-based). */
	folha: z.coerce.number().int().min(0).max(200).default(0),
	/** Fundo do SVG; vazio deixa transparente. */
	fundo: z.string().max(40).default(''),
});

export const cadRenderSvgBlock: ToolBlock<z.infer<typeof renderSvgSchema>> = {
	id: 'cad.render_svg',
	category: 'cad',
	description:
		'Renderiza o desenho como SVG em escala real (mm) com as cores de cada camada. Modo `chapa` usa o nesting; `pecas` mostra as peças lado a lado.',
	paramsSchema: renderSvgSchema,
	async run(_ctx, p) {
		const svg = sketchToSvg(p.sketch, p.modo === 'chapa' ? p.nest : undefined, {
			sheet: p.folha,
			...(p.fundo ? { background: p.fundo } : {}),
		});
		return {
			svg,
			// Data URL montada aqui (e não com `sketchToDataUrl`) só para não
			// renderizar o mesmo desenho duas vezes. Base64 é obrigatório: em data
			// URL utf8 crua o `#` das cores vira início de fragmento e trunca o SVG.
			dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
		};
	},
};

/** Todos os blocos de CAD, pra registro no index. */
export const cadBlocks: ToolBlock[] = [
	cadBoxBlock,
	cadBbqBlock,
	cadTrophyBlock,
	cadMedalBlock,
	cadAssemblyBlock,
	cadNestBlock,
	cadRenderSvgBlock,
];
