import { beforeAll, describe, expect, it } from 'vitest';
import type { Assembly } from '@/lib/cad/assembly.js';
import type { NestResult, Sketch2D } from '@/lib/cad/ir.js';
import {
	cadAssemblyBlock,
	cadBbqBlock,
	cadBoxBlock,
	cadMedalBlock,
	cadNestBlock,
	cadRenderSvgBlock,
	cadTrophyBlock,
} from '@/tool-blocks/blocks/cad.js';
import { cadGenerateBlock } from '@/tool-blocks/blocks/dispatch.js';
import {
	outputExportDxfV2Block,
	outputExportSvgSheetBlock,
} from '@/tool-blocks/blocks/output-cad.js';
import { blockRegistry, registerCoreBlocks } from '@/tool-blocks/index.js';
import type { BlockRunContext } from '@/tool-blocks/types.js';

const ctx: BlockRunContext = { customerId: 'cliente-teste' };

/**
 * Roda o bloco como o motor roda: valida os params e executa. O bloco entra pela
 * FORMA e não por `ToolBlock<P>` porque cada bloco tem um `P` diferente e o
 * helper é comum aos cinco.
 */
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

interface SaidaBox {
	sketch: Sketch2D;
	warnings: string[];
	part_count: number;
	cut_length_mm: number;
	engrave_length_mm: number;
	pierces: number;
}

interface SaidaNest {
	result: NestResult;
	sheets_used: number;
	utilization: number[];
	unplaced: string[];
	unplaced_count: number;
}

/** Params como STRING: é como o multipart entrega tudo ao motor. */
const CAIXA_STR = {
	dim_mode: 'externo',
	largura: '200',
	profundidade: '150',
	altura: '80',
	espessura: '3',
	kerf: '0.15',
	folga: '0.1',
};

describe('registro dos blocos de CAD', () => {
	beforeAll(() => {
		registerCoreBlocks();
	});

	it('registra os blocos de CAD com id e categoria estáveis', () => {
		for (const id of [
			'cad.box',
			'cad.bbq',
			'cad.trophy',
			'cad.medal',
			'cad.assembly',
			'cad.nest',
			'cad.render_svg',
			'cad.generate',
		]) {
			expect(blockRegistry.get(id)?.category).toBe('cad');
		}
		for (const id of ['output.export_dxf_v2', 'output.export_svg_sheet']) {
			expect(blockRegistry.get(id)?.category).toBe('output');
		}
	});

	it('não derruba o bloco de DXF antigo, que continua sendo outro id', () => {
		expect(blockRegistry.has('output.export_dxf')).toBe(true);
		expect(outputExportDxfV2Block.id).not.toBe('output.export_dxf');
		expect(outputExportSvgSheetBlock.id).toBe('output.export_svg_sheet');
	});
});

describe('cad.box', () => {
	it('coage params de multipart (string) e devolve sketch + métricas', async () => {
		const out = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		expect(out.sketch.units).toBe('mm');
		expect(out.sketch.parts.map((p) => p.id)).toEqual([
			'fundo',
			'frente',
			'tras',
			'esquerda',
			'direita',
		]);
		expect(out.part_count).toBe(5);
		expect(out.cut_length_mm).toBeGreaterThan(0);
		expect(out.pierces).toBeGreaterThanOrEqual(5);
		expect(Array.isArray(out.warnings)).toBe(true);
	});

	it('propaga os avisos do gerador em vez de engoli-los', async () => {
		// Aresta de 10 mm não comporta dente: o gerador cai para topo colado e avisa.
		const out = await roda<SaidaBox>(cadBoxBlock, {
			...CAIXA_STR,
			altura: '10',
		});
		expect(out.warnings.join(' ')).toContain('topo colado');
	});

	it('deixa o gerador escolher o dente-alvo quando o campo vem em branco', async () => {
		// '' não pode virar 0: zerar o alvo produziria uma caixa com dente de 0 mm.
		const out = await roda<SaidaBox>(cadBoxBlock, {
			...CAIXA_STR,
			dente_alvo: '',
		});
		expect(out.sketch.meta.params.dente_alvo).toBe(Math.max(3 * 3, 8));
	});

	it('reprova dimensão que não fecha, com 400 em PT-BR', async () => {
		// 45 mm de chapa numa caixa externa de 80 mm de altura: não sobra vão.
		await expect(
			roda(cadBoxBlock, { ...CAIXA_STR, espessura: '45' }),
		).rejects.toMatchObject({
			status: 400,
			message: expect.stringContaining('vão interno'),
		});
	});
});

describe('cad.nest', () => {
	it('encaixa a caixa inteira numa chapa 600×400 sem sobras', async () => {
		const caixa = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		const out = await roda<SaidaNest>(cadNestBlock, {
			sketch: caixa.sketch,
			chapa_w: '600',
			chapa_h: '400',
		});
		expect(out.sheets_used).toBe(1);
		expect(out.unplaced_count).toBe(0);
		expect(out.result.sheets[0].placements).toHaveLength(5);
		expect(out.utilization[0]).toBeGreaterThan(0);
		expect(out.utilization[0]).toBeLessThanOrEqual(1);
		// Gap derivado do kerf do desenho: max(2·0,15; 1,5) = 1,5.
		expect(out.result.gap).toBe(1.5);
	});

	it('respeita rotacao=false — nenhuma peça sai girada', async () => {
		const caixa = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		const livre = await roda<SaidaNest>(cadNestBlock, {
			sketch: caixa.sketch,
			chapa_w: '600',
			chapa_h: '400',
			rotacao: 'true',
		});
		const travado = await roda<SaidaNest>(cadNestBlock, {
			sketch: caixa.sketch,
			chapa_w: '600',
			chapa_h: '400',
			rotacao: 'false',
		});
		const rots = (n: SaidaNest) =>
			n.result.sheets.flatMap((s) => s.placements.map((p) => p.rot));
		expect(rots(livre)).toContain(90);
		expect(new Set(rots(travado))).toEqual(new Set([0]));
	});

	it('aceita o sketch como JSON serializado', async () => {
		const caixa = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		const out = await roda<SaidaNest>(cadNestBlock, {
			sketch: JSON.stringify(caixa.sketch),
			chapa_w: '600',
			chapa_h: '400',
		});
		expect(out.sheets_used).toBe(1);
	});

	it('rejeita um sketch que não é sketch', () => {
		expect(() =>
			cadNestBlock.paramsSchema.parse({ sketch: 'nada disso' }),
		).toThrow();
	});
});

describe('cad.render_svg', () => {
	it('desenha a chapa do nesting em escala real', async () => {
		const caixa = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		const nest = await roda<SaidaNest>(cadNestBlock, {
			sketch: caixa.sketch,
			chapa_w: '600',
			chapa_h: '400',
		});
		const out = await roda<{ svg: string; dataUrl: string }>(
			cadRenderSvgBlock,
			{ sketch: caixa.sketch, nest: nest.result, modo: 'chapa' },
		);
		expect(out.svg).toContain('width="608mm"');
		expect(out.svg).toContain('data-part="__chapa"');
		expect(out.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
		// A data URL tem que ser o MESMO documento, não um render diferente.
		const decodificado = Buffer.from(
			out.dataUrl.split(',')[1],
			'base64',
		).toString('utf8');
		expect(decodificado).toBe(out.svg);
	});

	it('modo `pecas` ignora o nesting e não desenha a chapa', async () => {
		const caixa = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		const nest = await roda<SaidaNest>(cadNestBlock, {
			sketch: caixa.sketch,
			chapa_w: '600',
			chapa_h: '400',
		});
		const out = await roda<{ svg: string }>(cadRenderSvgBlock, {
			sketch: caixa.sketch,
			nest: nest.result,
			modo: 'pecas',
		});
		expect(out.svg).not.toContain('__chapa');
		expect(out.svg).toContain('data-part="fundo"');
	});

	it('nest ausente ou vazio não quebra a prévia', async () => {
		const caixa = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		const out = await roda<{ svg: string }>(cadRenderSvgBlock, {
			sketch: caixa.sketch,
			nest: '',
		});
		expect(out.svg).toContain('<svg');
	});
});

describe('cad.bbq', () => {
	/** 20 pessoas em chapa de 2 mm — o caso do smoke, e o do relatório. */
	const BBQ_STR = {
		pessoas: '20',
		profundidade: '200',
		espessura: '2',
		material: 'aco_carbono',
		kerf: '0.2',
		construcao: 'dobrada',
	};

	it('coage params de multipart e dimensiona por pessoas (0,03 m², razão 2:1)', async () => {
		const out = await roda<SaidaBox>(cadBbqBlock, BBQ_STR);
		const p = out.sketch.meta.params as Record<string, number>;
		// √(2·0,03·20) m → 1095,445115 mm, com W = C/2.
		expect(p.comprimento).toBeCloseTo(1095.445115, 6);
		expect(p.largura).toBeCloseTo(547.722558, 6);
		expect((p.comprimento * p.largura) / 1e6).toBeCloseTo(0.6, 9);
		expect(out.sketch.units).toBe('mm');
		expect(out.cut_length_mm).toBeGreaterThan(0);
	});

	it('a construção dobrada sai como UMA chapa planificada com linhas de DOBRA', async () => {
		const out = await roda<SaidaBox>(cadBbqBlock, BBQ_STR);
		expect(out.sketch.parts.map((p) => p.id)).toEqual(['corpo']);
		const dobras = out.sketch.parts[0].paths.filter(
			(c) => c.layer === 'DOBRA',
		).length;
		expect(dobras).toBe(4);
	});

	it('encaixada tem 6 peças (a 6ª é a moldura) e soldada tem 5', async () => {
		const enc = await roda<SaidaBox>(cadBbqBlock, {
			...BBQ_STR,
			construcao: 'encaixada',
		});
		expect(enc.sketch.parts.map((p) => p.id)).toContain('moldura');
		expect(enc.sketch.parts).toHaveLength(6);
		const sold = await roda<SaidaBox>(cadBbqBlock, {
			...BBQ_STR,
			construcao: 'soldada',
		});
		expect(sold.sketch.parts).toHaveLength(5);
		// Sem solda não há marcação de soldador; com solda, há.
		const marcas = sold.sketch.parts.flatMap((p) =>
			p.paths.filter((c) => c.layer === 'MARCACAO'),
		);
		expect(marcas.length).toBeGreaterThan(0);
	});

	it('campo numérico em branco cai no default do gerador, não em zero', async () => {
		// '' virando 0 daria raio de dobra 0 (chapa rachada) e profundidade 0.
		const out = await roda<SaidaBox>(cadBbqBlock, {
			...BBQ_STR,
			raio_dobra: '',
			profundidade: '',
			fator_k: '',
		});
		const p = out.sketch.meta.params as Record<string, number>;
		expect(p.raio_dobra).toBe(2); // = espessura
		expect(p.profundidade).toBe(200);
	});

	it('reprova material desconhecido no schema, antes do gerador', async () => {
		await expect(
			roda(cadBbqBlock, { ...BBQ_STR, material: 'titanio' }),
		).rejects.toThrow();
	});
});

describe('cad.assembly', () => {
	it('converte o sketch da caixa em montagem 3D com contorno e pose', async () => {
		const caixa = await roda<SaidaBox>(cadBoxBlock, CAIXA_STR);
		const out = await roda<{
			assembly: Assembly;
			json: string;
			part_count: number;
		}>(cadAssemblyBlock, { sketch: caixa.sketch });
		expect(out.assembly.units).toBe('mm');
		expect(out.part_count).toBe(out.assembly.parts.length);
		expect(out.part_count).toBeGreaterThanOrEqual(5);
		for (const p of out.assembly.parts) {
			expect(p.outline.length).toBeGreaterThanOrEqual(3);
			expect(p.pose.pos).toHaveLength(3);
		}
		// O `json` é o MESMO objeto, não um segundo cálculo.
		expect(JSON.parse(out.json)).toEqual(out.assembly);
	});

	it('recusa qualquer coisa que não seja um sketch, com mensagem de domínio', async () => {
		await expect(
			roda(cadAssemblyBlock, { sketch: '{"parts":[]}' }),
		).rejects.toThrow(/sketch/);
	});
});

describe('cad.trophy', () => {
	const TROFEU_STR = { altura_total: '300', espessura: '6' };

	it('coage params de multipart (string) e devolve as quatro peças', async () => {
		const out = await roda<SaidaBox>(cadTrophyBlock, TROFEU_STR);
		expect(out.sketch.units).toBe('mm');
		expect(out.sketch.meta.generator).toContain('trophy');
		expect(out.sketch.parts.map((p) => p.id)).toEqual([
			'base',
			'haste_topo',
			'haste_base',
			'placa',
		]);
		expect(out.part_count).toBe(4);
		expect(out.cut_length_mm).toBeGreaterThan(0);
	});

	it('deixa base/placa em branco caírem no default do gerador, não em zero', async () => {
		// Campo vazio no multipart chega como `''`. Se ele virasse 0 aqui, a base
		// sairia com largura zero e a placa desapareceria sem aviso.
		const out = await roda<SaidaBox>(cadTrophyBlock, {
			...TROFEU_STR,
			base_largura: '',
			base_profundidade: '',
			base_espessura: '',
			placa_altura: '',
		});
		const p = out.sketch.meta.params as Record<string, number>;
		expect(p.base_largura).toBe(150); // 0,5 × 300
		expect(p.base_espessura).toBe(12); // max(2t, 6)
		expect(p.placa_altura).toBe(48); // 0,16 × 300
	});

	it('repassa a silhueta e a placa escolhidas', async () => {
		const out = await roda<SaidaBox>(cadTrophyBlock, {
			...TROFEU_STR,
			silhueta: 'taca',
			placa: 'escudo',
			gravacao_placa: 'CAMPEAO',
		});
		const p = out.sketch.meta.params as Record<string, string>;
		expect(p.silhueta).toBe('taca');
		expect(p.placa).toBe('escudo');
		expect(p.gravacao_placa).toBe('CAMPEAO');
	});
});

describe('cad.medal', () => {
	const MEDALHA_STR = { diametro: '60', espessura: '3' };

	it('coage params de multipart (string) e devolve uma peça com qty = qtd', async () => {
		const out = await roda<SaidaBox>(cadMedalBlock, {
			...MEDALHA_STR,
			qtd: '12',
		});
		expect(out.sketch.meta.generator).toContain('medal');
		// Uma peça DISTINTA, doze instâncias: medalha é quantidade a cortar, não
		// montagem — quem confundir isso nesta os dois números vai errar o nesting.
		expect(out.sketch.parts).toHaveLength(1);
		expect(out.sketch.parts[0].qty).toBe(12);
		expect(out.part_count).toBe(12);
	});

	it('`lados` em branco não vira aviso; preenchido em forma que o ignora, vira', async () => {
		const semLados = await roda<SaidaBox>(cadMedalBlock, {
			...MEDALHA_STR,
			forma: 'disco',
			lados: '',
		});
		expect(semLados.warnings.join(' ')).not.toContain('lados');
		const comLados = await roda<SaidaBox>(cadMedalBlock, {
			...MEDALHA_STR,
			forma: 'disco',
			lados: '6',
		});
		expect(comLados.warnings.join(' ')).toContain('lados');
	});

	it('furo_fita_diametro = 0 é ficha sem furo, e vazio cai no default', async () => {
		const semFuro = await roda<SaidaBox>(cadMedalBlock, {
			...MEDALHA_STR,
			furo_fita_diametro: '0',
		});
		expect(
			semFuro.sketch.parts[0].paths.some((c) => c.id === 'furo_fita'),
		).toBe(false);
		const comFuro = await roda<SaidaBox>(cadMedalBlock, {
			...MEDALHA_STR,
			furo_fita_diametro: '',
		});
		expect(
			comFuro.sketch.parts[0].paths.some((c) => c.id === 'furo_fita'),
		).toBe(true);
	});

	it('aro e gravação saem na layer GRAVACAO, não na de corte', async () => {
		const out = await roda<SaidaBox>(cadMedalBlock, {
			...MEDALHA_STR,
			aro: 'duplo',
			gravacao_texto: '1o LUGAR',
		});
		const gravacao = out.sketch.parts[0].paths.filter(
			(c) => c.layer === 'GRAVACAO',
		);
		expect(gravacao.map((c) => c.id)).toEqual([
			'aro_externo',
			'aro_interno',
			'gravacao_1',
		]);
		// Os dois círculos do aro têm comprimento; o texto vale 0 mm porque quem
		// traça a fonte é o RIP da máquina (ver `segLength`).
		expect(out.engrave_length_mm).toBeGreaterThan(0);
	});
});

describe('cad.generate (dispatcher)', () => {
	// O dispatcher acha o filho no REGISTRY, não por import: sem este registro o
	// bloco existe e mesmo assim falha com "bloco indisponível". (É idempotente.)
	beforeAll(() => {
		registerCoreBlocks();
	});

	it('delega para os quatro geradores pelo `modelo`', async () => {
		const caixa = await roda<SaidaBox>(cadGenerateBlock, {
			modelo: 'caixa',
			...CAIXA_STR,
		});
		expect(caixa.sketch.meta.generator).toContain('box');
		const bbq = await roda<SaidaBox>(cadGenerateBlock, {
			modelo: 'churrasqueira',
			pessoas: '20',
			espessura: '2',
		});
		expect(bbq.sketch.meta.generator).toContain('bbq');
		const trofeu = await roda<SaidaBox>(cadGenerateBlock, {
			modelo: 'trofeu',
			altura_total: '300',
			espessura: '6',
		});
		expect(trofeu.sketch.meta.generator).toContain('trophy');
		const medalha = await roda<SaidaBox>(cadGenerateBlock, {
			modelo: 'medalha',
			diametro: '60',
			espessura: '3',
			forma: 'estrela',
		});
		expect(medalha.sketch.meta.generator).toContain('medal');
		// `passthrough` de novo: com schema `strip` a `forma` morreria aqui e a
		// estrela sairia disco.
		expect((medalha.sketch.meta.params as Record<string, string>).forma).toBe(
			'estrela',
		);
	});

	it('repassa os params do gerador em vez de podá-los (passthrough)', async () => {
		// Com schema `strip`, `pessoas` morreria aqui e as duas sairiam iguais.
		const a = await roda<SaidaBox>(cadGenerateBlock, {
			modelo: 'churrasqueira',
			pessoas: '20',
			espessura: '2',
		});
		const b = await roda<SaidaBox>(cadGenerateBlock, {
			modelo: 'churrasqueira',
			pessoas: '4',
			espessura: '2',
		});
		const pa = a.sketch.meta.params as Record<string, number>;
		const pb = b.sketch.meta.params as Record<string, number>;
		expect(pa.comprimento).toBeGreaterThan(pb.comprimento);
	});

	it('modelo desconhecido é 400 em PT-BR, não desenho vazio', async () => {
		await expect(
			roda(cadGenerateBlock, { modelo: 'foguete', espessura: '2' }),
		).rejects.toThrow(/Modelo de CAD desconhecido/);
	});
});
