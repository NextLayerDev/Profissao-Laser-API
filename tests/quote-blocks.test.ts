import { describe, expect, it } from 'vitest';
import { buildBox } from '@/lib/cad/generators/box.js';
import type { Sketch2D } from '@/lib/cad/ir.js';
import { sketchToDxf } from '@/lib/cad/render-dxf.js';
import type { CadMetrics, Diagnostic } from '@/lib/cad/topology.js';
import {
	computeQuote,
	DEFAULT_PROFILE,
	type QuoteMetrics,
} from '@/lib/quote/pricing.js';
import {
	cadDiagnoseBlock,
	cadMetricsBlock,
	cadParseBlock,
	cadPreviewSvgBlock,
	orcamentoPublico,
	quotePriceBlock,
} from '@/tool-blocks/blocks/quote.js';
import { blockRegistry, registerCoreBlocks } from '@/tool-blocks/index.js';
import type { BlockRunContext } from '@/tool-blocks/types.js';

const ctx: BlockRunContext = { customerId: 'cliente-teste' };

interface BlocoExecutavel {
	paramsSchema: { parse(v: unknown): unknown };
	run(c: BlockRunContext, p: never): Promise<Record<string, unknown>>;
}

async function roda<T = Record<string, unknown>>(
	bloco: BlocoExecutavel,
	params: Record<string, unknown>,
): Promise<T> {
	const parsed = bloco.paramsSchema.parse(params);
	return (await bloco.run(ctx, parsed as never)) as T;
}

/** Caixa MDF de verdade — a mesma peça do smoke de ida e volta. */
const CAIXA = buildBox({
	dim_mode: 'externo',
	largura: 200,
	profundidade: 150,
	altura: 80,
	espessura: 3,
	material: 'MDF',
	kerf: 0.15,
	folga: 0.1,
	tampa: 'encaixe',
	fundo: true,
	// A divisória interna traz os rasgos de encaixe: são eles os "furos" abaixo
	// do mínimo de 1,2 × espessura, e é o que exercita o diagnóstico.
	div_x: 1,
});
const DXF_CAIXA = sketchToDxf(CAIXA);

const SVG_QUADRADO = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
	<rect x="0" y="0" width="100" height="50"/>
</svg>`;

describe('registro dos blocos da Central de Custos', () => {
	it('registra os cinco blocos no registry', () => {
		registerCoreBlocks();
		for (const id of [
			'cad.parse',
			'cad.metrics',
			'cad.diagnose',
			'cad.preview_svg',
			'quote.price',
		]) {
			expect(blockRegistry.has(id), id).toBe(true);
		}
	});

	it('nenhum bloco da Central é pulado no preview', () => {
		// Espelha `skipInPreview` do controller: o orçamento ao vivo depende de
		// todos eles rodarem no preview (nenhum sobe arquivo nem chama IA).
		for (const id of [
			'cad.parse',
			'cad.metrics',
			'cad.diagnose',
			'cad.preview_svg',
			'quote.price',
		]) {
			expect(id.startsWith('output.')).toBe(false);
			expect(id.startsWith('ai.')).toBe(false);
			expect(id.endsWith('.persist')).toBe(false);
			expect(id.endsWith('.save')).toBe(false);
		}
	});
});

describe('cad.parse', () => {
	it('lê um DXF e devolve a mesma IR dos geradores', async () => {
		const out = await roda<{
			sketch: Sketch2D;
			unit: string;
			unit_detected: string;
			entity_count: number;
			format: string;
		}>(cadParseBlock, {
			file: Buffer.from(DXF_CAIXA, 'utf8'),
			filename: 'caixa.dxf',
		});
		expect(out.format).toBe('dxf');
		expect(out.sketch.units).toBe('mm');
		expect(out.sketch.schema).toBe(1);
		expect(out.sketch.parts.length).toBe(1);
		expect(out.unit).toBe('mm');
		// O escritor grava `$INSUNITS`, então a unidade não é adivinhada.
		expect(out.unit_detected).toBe('insunits');
		expect(out.entity_count).toBeGreaterThan(0);
	});

	it('lê um SVG e respeita a unidade física do width/height', async () => {
		const out = await roda<{ format: string; bbox_w_mm: number }>(
			cadParseBlock,
			{ file: Buffer.from(SVG_QUADRADO, 'utf8'), filename: 'peca.svg' },
		);
		expect(out.format).toBe('svg');
		expect(out.bbox_w_mm).toBeCloseTo(100, 3);
	});

	it('decide o formato pelo CONTEÚDO, não pela extensão mentirosa', async () => {
		const out = await roda<{ format: string }>(cadParseBlock, {
			file: Buffer.from(SVG_QUADRADO, 'utf8'),
			filename: 'na-verdade-e-svg.dxf',
		});
		expect(out.format).toBe('svg');
	});

	it('recusa arquivo que não é DXF nem SVG', async () => {
		await expect(
			roda(cadParseBlock, { file: Buffer.from('PKbinario') }),
		).rejects.toThrow(/DXF/);
	});

	it('recusa arquivo vazio no schema', () => {
		expect(() =>
			cadParseBlock.paramsSchema.parse({ file: Buffer.alloc(0) }),
		).toThrow();
	});

	it('`pol` vira polegada e multiplica a peça por 25,4', async () => {
		const semUnidade = SVG_QUADRADO.replace(/width="100mm" height="50mm"/, '');
		const emMm = await roda<{ bbox_w_mm: number }>(cadParseBlock, {
			file: Buffer.from(semUnidade, 'utf8'),
			unit_hint: 'mm',
		});
		const emPol = await roda<{ bbox_w_mm: number }>(cadParseBlock, {
			file: Buffer.from(semUnidade, 'utf8'),
			unit_hint: 'pol',
		});
		expect(emPol.bbox_w_mm / emMm.bbox_w_mm).toBeCloseTo(25.4, 6);
	});
});

describe('cad.metrics', () => {
	it('mede o DXF lido com o mesmo comprimento que o gerador declarou', async () => {
		const { sketch } = await roda<{ sketch: Sketch2D }>(cadParseBlock, {
			file: Buffer.from(DXF_CAIXA, 'utf8'),
		});
		const out = await roda<{
			metrics: CadMetrics;
			length_mm: number;
			pieces: number;
			holes: number;
			area_net_mm2: number;
		}>(cadMetricsBlock, { sketch });

		const esperado = CAIXA.meta.stats.cutLengthMm;
		// Ida e volta: gerar → escrever DXF → ler → medir. Bem dentro de 0,5%.
		expect(Math.abs(out.length_mm - esperado) / esperado).toBeLessThan(0.005);
		expect(out.pieces).toBe(CAIXA.parts.length);
		expect(out.area_net_mm2).toBeGreaterThan(0);
	});

	it('devolve o objeto de métricas SEM arredondar (é ele que vira preço)', async () => {
		const { sketch } = await roda<{ sketch: Sketch2D }>(cadParseBlock, {
			file: Buffer.from(DXF_CAIXA, 'utf8'),
		});
		const out = await roda<{ metrics: CadMetrics; length_mm: number }>(
			cadMetricsBlock,
			{ sketch },
		);
		// Erro RELATIVO, não absoluto: o que sobra do ida e volta é a precisão
		// decimal com que o escritor de DXF grava cada coordenada (~1e-6 mm no
		// total de 5,2 m de corte), não perda de geometria.
		const rel =
			Math.abs(
				out.metrics.comprimento_corte_mm - CAIXA.meta.stats.cutLengthMm,
			) / CAIXA.meta.stats.cutLengthMm;
		expect(rel).toBeLessThan(1e-8);
		// O campo de exibição é o arredondado; a fonte não.
		expect(out.length_mm).toBe(
			Math.round(out.metrics.comprimento_corte_mm * 1000) / 1000,
		);
	});

	it('rejeita um sketch que não é sketch', () => {
		expect(() =>
			cadMetricsBlock.paramsSchema.parse({ sketch: { a: 1 } }),
		).toThrow();
	});
});

describe('cad.diagnose', () => {
	async function diagnostica(chapa?: { w: number; h: number }) {
		const { sketch } = await roda<{ sketch: Sketch2D }>(cadParseBlock, {
			file: Buffer.from(DXF_CAIXA, 'utf8'),
		});
		const { metrics } = await roda<{ metrics: CadMetrics }>(cadMetricsBlock, {
			sketch,
		});
		return roda<{
			warnings: Diagnostic[];
			public_warnings: { code: string; ids?: string[] }[];
			has_error: boolean;
			codes: string[];
		}>(cadDiagnoseBlock, {
			sketch,
			metrics,
			espessura_mm: 3,
			...(chapa ? { chapa_w: chapa.w, chapa_h: chapa.h } : {}),
		});
	}

	it('acha o furo pequeno demais para vazar em MDF 3 mm', async () => {
		const out = await diagnostica();
		expect(out.codes).toContain('furo_pequeno');
	});

	it('a peça não cabe numa chapa de 100×100 e isso é ERRO', async () => {
		const out = await diagnostica({ w: 100, h: 100 });
		expect(out.codes).toContain('peca_maior_que_chapa');
		expect(out.has_error).toBe(true);
	});

	it('`peca_maior_que_chapa` NUNCA vai para o cliente final', async () => {
		// A mensagem cita a medida da chapa e a mesa da máquina — capacidade
		// instalada do profissional, não assunto de orçamento.
		const out = await diagnostica({ w: 100, h: 100 });
		expect(out.warnings.map((d) => d.code)).toContain('peca_maior_que_chapa');
		expect(out.public_warnings.map((d) => d.code)).not.toContain(
			'peca_maior_que_chapa',
		);
	});

	it('a versão pública não carrega ids internos de contorno', async () => {
		const out = await diagnostica();
		expect(out.public_warnings.length).toBeGreaterThan(0);
		for (const d of out.public_warnings) {
			expect(d.ids).toBeUndefined();
		}
		// ...mas a versão interna carrega, para o profissional caçar a geometria.
		const comIds = out.warnings.filter((d) => (d.ids?.length ?? 0) > 0);
		expect(comIds.length).toBeGreaterThan(0);
	});
});

describe('cad.preview_svg', () => {
	it('devolve SVG em mm e data URL base64 inline', async () => {
		const { sketch } = await roda<{ sketch: Sketch2D }>(cadParseBlock, {
			file: Buffer.from(DXF_CAIXA, 'utf8'),
		});
		const out = await roda<{ svg: string; dataUrl: string }>(
			cadPreviewSvgBlock,
			{ sketch },
		);
		expect(out.svg.startsWith('<svg')).toBe(true);
		expect(out.svg).toContain('data-units="mm"');
		expect(out.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
		// Base64 obrigatório: em utf8 cru o `#` das cores trunca o documento.
		const decodificado = Buffer.from(
			out.dataUrl.slice('data:image/svg+xml;base64,'.length),
			'base64',
		).toString('utf8');
		expect(decodificado).toBe(out.svg);
		// Nada de URL de storage: o preview é inline, sempre.
		expect(out.dataUrl).not.toContain('http');
	});
});

describe('quote.price — validação de params', () => {
	it('exige espessura (sem ela não há peso nem velocidade)', () => {
		expect(() =>
			quotePriceBlock.paramsSchema.parse({
				metrics: { comprimento_corte_mm: 1, contornos: [] },
				qtd: 1,
			}),
		).toThrow();
	});

	it('cai na tool `central_custos` e no perfil do sistema por padrão', () => {
		const p = quotePriceBlock.paramsSchema.parse({
			metrics: { comprimento_corte_mm: 1, contornos: [] },
			espessura_mm: 3,
		}) as { tool: string; qtd: number; base_area: string };
		expect(p.tool).toBe('central_custos');
		expect(p.qtd).toBe(1);
		expect(p.base_area).toBe('perfil');
	});

	it('aceita métricas serializadas em JSON (param vindo como string)', () => {
		const p = quotePriceBlock.paramsSchema.parse({
			metrics: JSON.stringify({ comprimento_corte_mm: 10, contornos: [] }),
			espessura_mm: '3',
			qtd: '25',
		}) as { metrics: CadMetrics; qtd: number; espessura_mm: number };
		expect(p.metrics.comprimento_corte_mm).toBe(10);
		expect(p.qtd).toBe(25);
		expect(p.espessura_mm).toBe(3);
	});
});

/* ───────────────── Regressões da revisão adversarial ───────────────── */

describe('regressões: orçamento público', () => {
	const PECA: QuoteMetrics = {
		cutLengthMm: 120,
		pierces: 1,
		netAreaMm2: 900,
		bboxAreaMm2: 900,
		bbox: { w: 30, h: 30 },
	};
	const MAT = { nome: 'MDF 3 mm', espessuraMm: 3, precoM2: 40 };
	const VEL = {
		speedMmS: 20,
		passes: 1,
		pierceS: 0.4,
		source: 'curated' as const,
		confidence: 1,
		estimativa: false,
		avisos: [],
	};
	/** Só os campos que o `orcamentoPublico` realmente lê. */
	const METRICS = {
		bbox: { w: 30, h: 30, minX: 0, minY: 0, maxX: 30, maxY: 30 },
		n_furos: 0,
		comprimento_corte_mm: 120,
	} as unknown as CadMetrics;

	function publico(over: Partial<typeof DEFAULT_PROFILE>, qty: number) {
		const b = computeQuote(
			PECA,
			{ ...DEFAULT_PROFILE, ...over },
			{
				qty,
				material: MAT,
				speed: VEL,
			},
		);
		return { b, pub: orcamentoPublico(b, METRICS, 3) };
	}

	it('com pedido mínimo, a conta do cliente FECHA com o total', () => {
		const { b, pub } = publico(
			{ pedidoMinimo: 50, descontos: [{ minQtd: 10, pct: 0.1 }] },
			50,
		);
		expect(b.precos.aplicouPedidoMinimo).toBe(true);
		// O documento não pode dizer "50 × 0,50 com 10% de desconto = 50,00".
		expect(pub.desconto_pct).toBe(0);
		expect(pub.pedido_minimo).toBe(true);
		expect(pub.preco_unitario_cents * pub.quantidade).toBeGreaterThanOrEqual(
			pub.total_cents,
		);
		// E não vaza o valor calculado, que é negócio do profissional.
		expect(JSON.stringify(pub)).not.toContain('22');
	});

	it('sem pedido mínimo, o unitário de tabela e o desconto continuam iguais', () => {
		const { b, pub } = publico(
			{ pedidoMinimo: 0, descontos: [{ minQtd: 10, pct: 0.1 }] },
			200,
		);
		expect(b.precos.aplicouPedidoMinimo).toBe(false);
		expect(pub.preco_unitario_cents).toBe(b.precos.precoUnitCents);
		expect(pub.desconto_pct).toBe(10);
		expect(pub.pedido_minimo).toBe(false);
		// A conta do cliente fecha no centavo.
		const conta =
			pub.preco_unitario_cents * pub.quantidade -
			Math.round(pub.preco_unitario_cents * pub.quantidade * 0.1);
		expect(conta).toBe(pub.total_cents);
	});

	it('o payload público não carrega NENHUMA chave de custo', () => {
		// Guarda: o dia em que alguém acrescentar um campo de custo aqui, quebra.
		const { pub } = publico({}, 100);
		const proibido =
			/custo|markup|margem|taxa|imposto|overhead|hora|kwh|maquina|minimo|setup|kg|m2|densidade|peso|velocidade|confid/i;
		const chaves: string[] = [];
		const anda = (v: unknown, path = '') => {
			if (v && typeof v === 'object' && !Array.isArray(v)) {
				for (const [k, val] of Object.entries(v)) {
					chaves.push(path ? `${path}.${k}` : k);
					anda(val, path ? `${path}.${k}` : k);
				}
			}
		};
		anda(pub);
		// `pedido_minimo` é um booleano deliberado (o cliente PRECISA saber que o
		// preço é o piso da loja) — o resto tem que estar limpo.
		expect(
			chaves.filter((k) => proibido.test(k) && k !== 'pedido_minimo'),
		).toEqual([]);
	});
});
