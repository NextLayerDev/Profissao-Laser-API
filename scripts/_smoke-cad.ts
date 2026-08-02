/**
 * Smoke do motor CAD ponta a ponta, pelos BLOCOS (não pelas libs): gera uma
 * caixa, as três construções de churrasqueira, um troféu e um lote de medalhas,
 * encaixa na chapa, renderiza o SVG e escreve o DXF. Não sobe nada para o
 * storage — os blocos `output.*` são o único trecho que precisa de rede, e eles
 * só embrulham `sketchToDxf`/`sketchToSvg` mais o upload.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/_smoke-cad.ts
 */
import { writeFileSync } from 'node:fs';
import type { Assembly } from '../src/lib/cad/assembly.js';
import type { NestResult, Sketch2D } from '../src/lib/cad/ir.js';
import { sketchToDxf } from '../src/lib/cad/render-dxf.js';
import {
	cadAssemblyBlock,
	cadBoxBlock,
	cadNestBlock,
	cadRenderSvgBlock,
} from '../src/tool-blocks/blocks/cad.js';
import { cadGenerateBlock } from '../src/tool-blocks/blocks/dispatch.js';
import {
	outputExportDxfV2Block,
	outputExportSvgSheetBlock,
} from '../src/tool-blocks/blocks/output-cad.js';
import { registerCoreBlocks } from '../src/tool-blocks/index.js';
import type { BlockRunContext } from '../src/tool-blocks/types.js';

const ctx: BlockRunContext = { customerId: 'smoke' };

/** Chapa de aço de estoque: 2000 × 1000 mm. */
const CHAPA = { w: '2000', h: '1000' };

/** Roda um bloco como o motor roda: valida os params (tudo string) e executa. */
async function roda<T>(
	bloco: {
		paramsSchema: { parse(v: unknown): unknown };
		run(c: BlockRunContext, p: never): Promise<Record<string, unknown>>;
	},
	params: Record<string, unknown>,
): Promise<T> {
	const parsed = bloco.paramsSchema.parse(params);
	return (await bloco.run(ctx, parsed as never)) as T;
}

async function main() {
	// Params como STRING de propósito: é assim que o multipart entrega, e é o que
	// os `z.coerce` dos blocos existem para absorver.
	const caixa = await roda<{
		sketch: Sketch2D;
		warnings: string[];
		part_count: number;
		cut_length_mm: number;
		engrave_length_mm: number;
		pierces: number;
	}>(cadBoxBlock, {
		dim_mode: 'externo',
		largura: '200',
		profundidade: '150',
		altura: '80',
		espessura: '3',
		kerf: '0.15',
		folga: '0.1',
		material: 'MDF',
		tampa: 'encaixe',
		div_x: '1',
		gravacao_tampa: 'PROFISSAO LASER',
	});

	console.log('— cad.box —————————————————————————————————');
	console.log(`peças (instâncias): ${caixa.part_count}`);
	console.log(`  ids: ${caixa.sketch.parts.map((p) => p.id).join(', ')}`);
	console.log(`corte:   ${caixa.cut_length_mm.toFixed(1)} mm`);
	console.log(`gravura: ${caixa.engrave_length_mm.toFixed(1)} mm`);
	console.log(`perfurações: ${caixa.pierces}`);
	for (const w of caixa.warnings) console.log(`  aviso: ${w}`);

	const nest = await roda<{
		result: NestResult;
		sheets_used: number;
		utilization: number[];
		unplaced: string[];
	}>(cadNestBlock, {
		sketch: caixa.sketch,
		chapa_w: '600',
		chapa_h: '400',
		margem: '5',
		rotacao: 'true',
	});

	console.log('\n— cad.nest ————————————————————————————————');
	console.log(`chapas: ${nest.sheets_used}`);
	console.log(
		`aproveitamento: ${nest.result.utilization
			.map((u) => `${(u * 100).toFixed(1)}%`)
			.join(' · ')}`,
	);
	console.log(`gap: ${nest.result.gap} mm   margem: ${nest.result.margin} mm`);
	console.log(
		`não couberam: ${nest.unplaced.length ? nest.unplaced.join(', ') : 'nenhuma'}`,
	);

	const render = await roda<{ svg: string; dataUrl: string }>(
		cadRenderSvgBlock,
		{ sketch: caixa.sketch, nest: nest.result, modo: 'chapa' },
	);

	writeFileSync('/tmp/smoke-cad.svg', render.svg, 'utf8');
	const dxf = sketchToDxf(caixa.sketch, nest.result);
	writeFileSync('/tmp/smoke-cad.dxf', dxf, 'utf8');

	console.log('\n— saída ———————————————————————————————————');
	console.log(
		`/tmp/smoke-cad.svg  ${(render.svg.length / 1024).toFixed(1)} kB  dataUrl ${(render.dataUrl.length / 1024).toFixed(1)} kB`,
	);
	console.log(`/tmp/smoke-cad.dxf  ${(dxf.length / 1024).toFixed(1)} kB`);

	// Os blocos de saída só acrescentam o upload; validar os params aqui prova
	// que eles aceitam o mesmo sketch/nest sem precisar de credencial de storage.
	for (const bloco of [outputExportDxfV2Block, outputExportSvgSheetBlock]) {
		bloco.paramsSchema.parse({
			sketch: caixa.sketch,
			nest: nest.result,
			folder: 'tool-output',
		});
		console.log(`params de ${bloco.id}: OK`);
	}

	console.log('primeiros bytes do DXF:');
	console.log(
		dxf
			.split(/\r?\n/)
			.slice(0, 12)
			.map((l) => `  ${l}`)
			.join('\n'),
	);

	await churrasqueiras();
	await trofeuEMedalhas();
}

/**
 * Churrasqueira para 20 pessoas nas TRÊS construções, sempre pelo dispatcher
 * `cad.generate` — assim o smoke prova de uma vez o gerador, o `passthrough` do
 * dispatcher (se ele podasse os params, as três sairiam iguais e no tamanho
 * padrão) e o nesting em chapa de estoque.
 */
async function churrasqueiras() {
	// O dispatcher acha o gerador pelo registry, não por import.
	registerCoreBlocks();

	for (const construcao of ['dobrada', 'encaixada', 'soldada'] as const) {
		const bbq = await roda<{
			sketch: Sketch2D;
			warnings: string[];
			part_count: number;
			cut_length_mm: number;
			engrave_length_mm: number;
			pierces: number;
		}>(cadGenerateBlock, {
			modelo: 'churrasqueira',
			pessoas: '20',
			profundidade: '200',
			espessura: '2',
			material: 'aco_carbono',
			kerf: '0.2',
			construcao,
			pes: 'chapa_dobrada',
			altura_pes: '700',
			grelha: 'chapa_vazada',
			respiros: 'furos',
			cinzeiro: 'gaveta',
			gravacao_frente: 'PROFISSAO LASER',
		});

		const nest = await roda<{
			result: NestResult;
			sheets_used: number;
			utilization: number[];
			unplaced: string[];
		}>(cadNestBlock, {
			sketch: bbq.sketch,
			chapa_w: CHAPA.w,
			chapa_h: CHAPA.h,
			margem: '10',
			rotacao: 'true',
		});

		const render = await roda<{ svg: string }>(cadRenderSvgBlock, {
			sketch: bbq.sketch,
			nest: nest.result,
			modo: 'chapa',
		});
		const dxf = sketchToDxf(bbq.sketch, nest.result);
		writeFileSync(`/tmp/smoke-bbq-${construcao}.svg`, render.svg, 'utf8');
		writeFileSync(`/tmp/smoke-bbq-${construcao}.dxf`, dxf, 'utf8');

		// Linhas de DOBRA: só a planificada tem. Conta CAMINHOS na layer, e a poly
		// de dobra (se houver) conta como um caminho só — é uma dobra, uma linha.
		const dobras = bbq.sketch.parts.reduce(
			(n, p) =>
				n +
				p.paths.filter((c) => c.layer === 'DOBRA').length * Math.max(p.qty, 1),
			0,
		);

		const montagem = await roda<{ assembly: Assembly; part_count: number }>(
			cadAssemblyBlock,
			{ sketch: bbq.sketch },
		);

		console.log(
			`\n— churrasqueira 20 pessoas · ${construcao} ————————————————`,
		);
		console.log(
			`peças (instâncias): ${bbq.part_count}   distintas: ${bbq.sketch.parts.length}`,
		);
		console.log(`  ids: ${bbq.sketch.parts.map((p) => p.id).join(', ')}`);
		console.log(`corte:   ${bbq.cut_length_mm.toFixed(1)} mm`);
		console.log(`gravura: ${bbq.engrave_length_mm.toFixed(1)} mm`);
		console.log(`perfurações: ${bbq.pierces}`);
		console.log(`linhas de DOBRA: ${dobras}`);
		console.log(
			`chapas 2000×1000: ${nest.sheets_used}   aproveitamento: ${nest.result.utilization
				.map((u) => `${(u * 100).toFixed(1)}%`)
				.join(' · ')}`,
		);
		console.log(
			`não couberam: ${nest.unplaced.length ? nest.unplaced.join(', ') : 'nenhuma'}`,
		);
		console.log(
			`montagem 3D: ${montagem.part_count} corpo(s)   bbox ${montagem.assembly.bbox.max
				.map((v, i) => (v - montagem.assembly.bbox.min[i]).toFixed(1))
				.join(' × ')} mm`,
		);
		console.log(
			`/tmp/smoke-bbq-${construcao}.svg  ${(render.svg.length / 1024).toFixed(1)} kB   ` +
				`/tmp/smoke-bbq-${construcao}.dxf  ${(dxf.length / 1024).toFixed(1)} kB`,
		);
		for (const w of bbq.warnings) console.log(`  aviso: ${w}`);
	}
}

/** Nome das layers presentes no DXF, na ordem em que aparecem na tabela LAYER. */
function layersDoDxf(dxf: string): string[] {
	// A tabela LAYER escreve o nome no grupo 2 logo depois do `AcDbLayerTableRecord`.
	// Ler a tabela (e não os grupos 8 das entidades) é o que prova que a layer foi
	// DECLARADA — LightBurn ignora entidade em layer que a tabela não anuncia.
	const linhas = dxf.split(/\r?\n/).map((l) => l.trim());
	const nomes: string[] = [];
	for (let i = 0; i < linhas.length; i++) {
		if (linhas[i] !== 'AcDbLayerTableRecord') continue;
		const g2 = linhas.indexOf('2', i);
		if (g2 > 0) nomes.push(linhas[g2 + 1]);
	}
	return nomes;
}

/**
 * Troféu e medalhas, sempre pelo dispatcher `cad.generate` — mesma prova do
 * `churrasqueiras()`: se o `passthrough` do dispatcher podasse os params, o
 * troféu sairia no tamanho padrão e a medalha viria disco em vez de estrela.
 *
 * A medalha é o caso que mais interessa aqui: `qtd` NÃO é montagem, é quantidade
 * a cortar, então ela multiplica o nesting (12 estrelas de Ø60 numa chapa
 * 600×400) enquanto `sketch.parts.length` continua 1.
 */
async function trofeuEMedalhas() {
	registerCoreBlocks();

	type Gen = {
		sketch: Sketch2D;
		warnings: string[];
		part_count: number;
		cut_length_mm: number;
		engrave_length_mm: number;
		pierces: number;
	};

	const jobs: {
		arquivo: string;
		titulo: string;
		params: Record<string, unknown>;
	}[] = [
		{
			arquivo: 'smoke-trofeu',
			titulo: 'troféu 300 mm · MDF 6 mm',
			params: {
				modelo: 'trofeu',
				altura_total: '300',
				espessura: '6',
				material: 'mdf',
				kerf: '0.15',
				folga: '0.1',
				silhueta: 'taca',
				placa: 'escudo',
				gravacao_placa: 'CAMPEAO 2026',
				fixacao: 'encaixe',
			},
		},
		{
			arquivo: 'smoke-medalha',
			titulo: '12 medalhas Ø60 mm · MDF 3 mm · estrela',
			params: {
				modelo: 'medalha',
				diametro: '60',
				espessura: '3',
				material: 'mdf',
				kerf: '0.15',
				forma: 'estrela',
				lados: '5',
				aro: 'simples',
				gravacao_texto: '1o LUGAR',
				qtd: '12',
			},
		},
	];

	for (const job of jobs) {
		const gen = await roda<Gen>(cadGenerateBlock, job.params);

		const nest = await roda<{
			result: NestResult;
			sheets_used: number;
			utilization: number[];
			unplaced: string[];
		}>(cadNestBlock, {
			sketch: gen.sketch,
			chapa_w: '600',
			chapa_h: '400',
			margem: '5',
			rotacao: 'true',
		});

		const render = await roda<{ svg: string }>(cadRenderSvgBlock, {
			sketch: gen.sketch,
			nest: nest.result,
			modo: 'chapa',
		});
		const dxf = sketchToDxf(gen.sketch, nest.result);
		writeFileSync(`/tmp/${job.arquivo}.svg`, render.svg, 'utf8');
		writeFileSync(`/tmp/${job.arquivo}.dxf`, dxf, 'utf8');

		const montagem = await roda<{ assembly: Assembly; part_count: number }>(
			cadAssemblyBlock,
			{ sketch: gen.sketch },
		);
		const layers = layersDoDxf(dxf);

		console.log(`\n— ${job.titulo} ————————————————`);
		console.log(
			`peças (instâncias): ${gen.part_count}   distintas: ${gen.sketch.parts.length}`,
		);
		console.log(
			`  ids: ${gen.sketch.parts.map((p) => `${p.id}×${p.qty}`).join(', ')}`,
		);
		console.log(`corte:   ${gen.cut_length_mm.toFixed(1)} mm`);
		console.log(`gravura: ${gen.engrave_length_mm.toFixed(1)} mm`);
		console.log(`perfurações: ${gen.pierces}`);
		console.log(
			`chapas 600×400: ${nest.sheets_used}   aproveitamento: ${nest.result.utilization
				.map((u) => `${(u * 100).toFixed(1)}%`)
				.join(' · ')}`,
		);
		console.log(
			`não couberam: ${nest.unplaced.length ? nest.unplaced.join(', ') : 'nenhuma'}`,
		);
		console.log(
			`montagem 3D: ${montagem.part_count} corpo(s)   bbox ${montagem.assembly.bbox.max
				.map((v, i) => (v - montagem.assembly.bbox.min[i]).toFixed(1))
				.join(' × ')} mm`,
		);
		console.log(
			`layers do DXF: ${layers.join(', ')}   CORTE=${layers.includes('CORTE') ? 'sim' : 'NÃO'}   GRAVACAO=${layers.includes('GRAVACAO') ? 'sim' : 'NÃO'}`,
		);
		console.log(
			`/tmp/${job.arquivo}.svg  ${(render.svg.length / 1024).toFixed(1)} kB   ` +
				`/tmp/${job.arquivo}.dxf  ${(dxf.length / 1024).toFixed(1)} kB`,
		);
		console.log(
			`avisos: ${gen.warnings.length === 0 ? 'nenhum' : ''}`.trimEnd(),
		);
		for (const w of gen.warnings) console.log(`  aviso: ${w}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
