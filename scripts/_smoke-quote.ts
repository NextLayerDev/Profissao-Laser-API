/**
 * Smoke da CENTRAL DE CUSTOS — o teste de IDA E VOLTA que prova o leitor.
 *
 * Gera uma caixa de MDF real com `buildBox`, escreve o DXF com `sketchToDxf`,
 * LÊ ESSE MESMO DXF de volta com `readDxf` e compara o comprimento de corte
 * medido por `analyzeGeometry` com o que o gerador declarou em
 * `meta.stats.cutLengthMm`. Se o leitor perder uma entidade, trocar uma unidade
 * ou tesselar grosso demais, o erro aparece aqui — e nenhum orçamento depois
 * disso vale nada.
 *
 * Depois roda o diagnóstico e o orçamento completo com um perfil de exemplo,
 * imprimindo o cálculo linha a linha em R$.
 *
 * Uso:
 *   npx tsx scripts/_smoke-quote.ts
 */
import { readDxf } from '../src/lib/cad/dxf-read.js';
import { buildBox } from '../src/lib/cad/generators/box.js';
import { sketchToDxf } from '../src/lib/cad/render-dxf.js';
import { analyzeGeometry, diagnose } from '../src/lib/cad/topology.js';
import { resolveCutSpeed } from '../src/lib/quote/cut-speed.js';
import type { MaterialInput } from '../src/lib/quote/materials.js';
import {
	computeQuote,
	DEFAULT_PROFILE,
	type QuoteProfile,
} from '../src/lib/quote/pricing.js';
import {
	cadDiagnoseBlock,
	cadMetricsBlock,
	cadParseBlock,
	cadPreviewSvgBlock,
} from '../src/tool-blocks/blocks/quote.js';
import type { BlockRunContext } from '../src/tool-blocks/types.js';

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`;
const pad = (s: string, n: number) => s.padEnd(n, ' ');
const padL = (s: string, n: number) => s.padStart(n, ' ');

/* ── 1. Caixa MDF de verdade ────────────────────────────────────────────── */

const caixa = buildBox({
	dim_mode: 'externo',
	largura: 200,
	profundidade: 150,
	altura: 80,
	espessura: 3,
	material: 'MDF',
	kerf: 0.15,
	folga: 0.1,
	encaixe: 'dente',
	tampa: 'encaixe',
	fundo: true,
	div_x: 1,
	gravacao_tampa: 'PROFISSAO LASER',
});

console.log('═'.repeat(72));
console.log('CENTRAL DE CUSTOS — smoke de ida e volta (DXF)');
console.log('═'.repeat(72));
console.log(
	`gerador: ${caixa.meta.generator} · ${caixa.parts.length} peças distintas`,
);
console.log(
	`  corte declarado    : ${caixa.meta.stats.cutLengthMm.toFixed(6)} mm`,
);
console.log(
	`  gravação declarada : ${caixa.meta.stats.engraveLengthMm.toFixed(6)} mm`,
);
console.log(`  peças (com qty)    : ${caixa.meta.stats.partCount}`);
if (caixa.meta.warnings.length) {
	console.log(`  avisos do gerador  : ${caixa.meta.warnings.join(' | ')}`);
}

/* ── 2. Escreve o DXF e lê de volta ─────────────────────────────────────── */

const dxf = sketchToDxf(caixa);
console.log(
	`\nDXF escrito: ${dxf.length.toLocaleString('pt-BR')} bytes, ${dxf.split('\n').length.toLocaleString('pt-BR')} linhas`,
);

const lido = readDxf(dxf, { label: 'caixa-mdf.dxf' });
const diag = lido.meta.params?.diagnostico as
	| {
			unidade: { detected: string; source: string };
			lidas: Record<string, number>;
			layersUsadas: string[];
	  }
	| undefined;
console.log(
	`DXF lido de volta: unidade ${diag?.unidade.detected} (por ${diag?.unidade.source}), ` +
		`entidades ${JSON.stringify(diag?.lidas)}, layers ${diag?.layersUsadas.join(', ')}`,
);

const metrics = analyzeGeometry(lido);

/* ── 3. O veredito do ida e volta ───────────────────────────────────────── */

const esperado = caixa.meta.stats.cutLengthMm;
const medido = metrics.comprimento_corte_mm;
const erroPct = Math.abs(medido - esperado) / esperado;

console.log(`\n${'─'.repeat(72)}`);
console.log('IDA E VOLTA — comprimento de corte');
console.log('─'.repeat(72));
console.log(`  gerador declarou : ${esperado.toFixed(6)} mm`);
console.log(`  leitor mediu     : ${medido.toFixed(6)} mm`);
console.log(
	`  erro             : ${(erroPct * 100).toFixed(4)} %  (limite: 0,5 %)`,
);
console.log(
	`  gravação         : declarada ${caixa.meta.stats.engraveLengthMm.toFixed(3)} mm · ` +
		`medida ${metrics.comprimento_gravacao_mm.toFixed(3)} mm`,
);
console.log(
	`  topologia        : ${metrics.n_contornos} contornos, ${metrics.n_pecas} peças, ` +
		`${metrics.n_furos} furos, ${metrics.n_abertos} abertos, ${metrics.n_piercings} perfurações`,
);
console.log(
	`  áreas            : bruta ${(metrics.area_bruta_mm2 / 100).toFixed(2)} cm² · ` +
		`líquida ${(metrics.area_liquida_mm2 / 100).toFixed(2)} cm²`,
);
console.log(
	`  bbox             : ${metrics.bbox.w.toFixed(2)} × ${metrics.bbox.h.toFixed(2)} mm`,
);

if (!(erroPct <= 0.005)) {
	console.error(
		`\n✗ FALHOU: erro de ${(erroPct * 100).toFixed(4)}% acima de 0,5% — o leitor não está fiel ao gerador.`,
	);
	process.exit(1);
}
console.log('\n✓ ida e volta dentro de 0,5%');

/* ── 4. Diagnóstico ─────────────────────────────────────────────────────── */

const avisos = diagnose(lido, metrics, {
	chapa: { w: 600, h: 400 },
	espessura: 3,
});
console.log(`\n${'─'.repeat(72)}`);
console.log(`DIAGNÓSTICO — ${avisos.length} item(ns)`);
console.log('─'.repeat(72));
for (const d of avisos) {
	console.log(`  [${d.severity}] ${d.code}${d.count ? ` (${d.count})` : ''}`);
	console.log(`      ${d.message}`);
}
if (avisos.length === 0) console.log('  (arquivo limpo)');

/* ── 5. Orçamento ───────────────────────────────────────────────────────── */

/** Perfil de exemplo: CO2 de 100 W de bancada, o cenário mais comum em MDF. */
const perfil: QuoteProfile = {
	...DEFAULT_PROFILE,
	laser: 'co2',
	potenciaW: 100,
	vGravMmS: 250,
	lineMm: 0.1,
	energiaKw: 1.4,
	precoKwh: 0.95,
	consumiveisHora: 1.5,
	manutencaoHora: 1,
	valorMaquina: 22000,
	vidaUtilH: 12000,
	custoHoraOperador: 22,
	setupS: 240,
	overheadPct: 0.2,
	markupPct: 1,
	impostoPct: 0.06,
	precificarPor: 'markup',
	regraArredondamento: '0.50',
	pedidoMinimo: 50,
	materialBasis: 'bbox',
};

const material: MaterialInput = {
	nome: 'MDF 3 mm',
	familia: 'mdf',
	espessuraMm: 3,
	precoKg: 8,
	chapaWmm: 2750,
	chapaHmm: 1830,
	custoFixoChapa: 0,
	basis: 'bbox',
};

const QTD = 10;

const speed = resolveCutSpeed({
	familia: material.familia ?? material.nome,
	espessuraMm: material.espessuraMm,
	laser: perfil.laser,
	potenciaW: perfil.potenciaW,
});

const entryPoints = metrics.contornos
	.filter((c) => c.layer === 'CORTE')
	.map((c) => c.pts[0])
	.filter((p): p is { x: number; y: number } => !!p);

const orc = computeQuote(
	{
		cutLengthMm: metrics.comprimento_corte_mm,
		pierces: metrics.n_piercings,
		// Gravação: a topologia mede COMPRIMENTO e o precificador cobra ÁREA
		// varrida. `L × passo_de_linha` é a conversão exata para gravação vetorial
		// (o tempo cai em (L·line)/(v·line) = L/v).
		engraveAreaMm2: metrics.comprimento_gravacao_mm * perfil.lineMm,
		netAreaMm2: metrics.area_liquida_mm2,
		bboxAreaMm2: metrics.area_bruta_mm2,
		bbox: { w: metrics.bbox.w, h: metrics.bbox.h },
		entryPoints,
	},
	perfil,
	{ qty: QTD, material, speed },
);

console.log(`\n${'─'.repeat(72)}`);
console.log(`ORÇAMENTO — ${QTD} caixas de MDF 3 mm`);
console.log('─'.repeat(72));
console.log(
	`velocidade: ${orc.velocidade.speedMmS} mm/s × ${orc.velocidade.passes} passada(s) · ` +
		`fonte ${orc.velocidade.source} · confiança ${orc.velocidade.confidence}`,
);
console.log(`            ${orc.velocidade.detalhe}`);
console.log(
	`material  : ${(orc.material.areaCobradaMm2 / 1e6).toFixed(4)} m² (${orc.material.basis}) · ` +
		`${orc.material.pesoKg?.toFixed(3)} kg · densidade ${orc.material.densidade} g/cm³`,
);
console.log(
	`tempos/pç : corte ${orc.tempos.corteS.toFixed(1)}s · perfuração ${orc.tempos.pierceS.toFixed(1)}s · ` +
		`deslocamento ${orc.tempos.rapidS.toFixed(1)}s · gravação ${orc.tempos.gravacaoS.toFixed(1)}s`,
);
console.log(
	`            ineficiência ${orc.tempos.ineficienciaS.toFixed(1)}s · setup rateado ${orc.tempos.setupRateadoS.toFixed(1)}s ` +
		`→ ${(orc.tempos.unitarioS / 60).toFixed(2)} min/peça · lote ${(orc.tempos.loteS / 60).toFixed(1)} min`,
);
console.log(`máquina   : ${brl(orc.maquina.taxaHoraCents)}/h`);

console.log('\nCUSTO POR PEÇA');
for (const l of orc.custos.linhas) {
	console.log(`  ${pad(l.label, 26)} ${padL(brl(l.cents), 10)}`);
	if (l.detalhe) console.log(`  ${' '.repeat(26)} ${l.detalhe}`);
}
console.log(
	`  ${pad('Custo direto', 26)} ${padL(brl(orc.custos.diretoCents), 10)}`,
);
console.log(
	`  ${pad(`Overhead (${(perfil.overheadPct * 100).toFixed(0)}%)`, 26)} ${padL(brl(orc.custos.overheadCents), 10)}`,
);
console.log(
	`  ${pad('CUSTO TOTAL / peça', 26)} ${padL(brl(orc.custos.totalCents), 10)}`,
);

console.log('\nPREÇO');
for (const [tipo, v] of [
	['markup', orc.precos.markup],
	['margem', orc.precos.margem],
] as const) {
	console.log(
		`  ${pad(`${tipo} ${(v.pct * 100).toFixed(0)}%`, 26)} ${padL(brl(v.precoUnitCents), 10)}` +
			`   (líquido ${brl(v.precoLiquidoCents)} + imposto ${brl(v.impostoCents)}` +
			` → margem efetiva ${(v.margemEfetivaPct * 100).toFixed(1)}%)`,
	);
}
console.log(
	`  ${pad(`escolhido: ${orc.precos.escolhido}`, 26)} ${padL(brl(orc.precos.precoUnitCents), 10)} / peça`,
);
console.log(
	`  ${pad(`Subtotal (${orc.qty} pç)`, 26)} ${padL(brl(orc.precos.subtotalCents), 10)}`,
);
console.log(
	`  ${pad(`Desconto ${(orc.precos.descontoPct * 100).toFixed(0)}% (faixa ${orc.precos.descontoFaixaMinQtd ?? '—'})`, 26)} ${padL(`-${brl(orc.precos.descontoCents)}`, 10)}`,
);
console.log(
	`  ${pad('TOTAL DO PEDIDO', 26)} ${padL(brl(orc.precos.precoTotalCents), 10)}`,
);
console.log(`  ${pad('Prazo', 26)} ${padL(`${orc.prazoDias} dias`, 10)}`);

if (orc.avisos.length) {
	console.log('\nAVISOS DO ORÇAMENTO');
	for (const a of orc.avisos) console.log(`  • ${a}`);
}

/* ── 6. Os mesmos passos, agora PELOS BLOCOS ────────────────────────────── */

/**
 * Repete o caminho pelos blocos do motor (não pelas libs), que é como a tool
 * roda de verdade: o Buffer entra em `cad.parse` como o multipart entrega, e
 * cada saída alimenta o param do próximo nó. `quote.price` fica de fora daqui
 * porque lê coleção (precisa de banco) — ele é exercitado pela tool.
 */
const ctx: BlockRunContext = { customerId: 'smoke' };
const parse = await cadParseBlock.run(
	ctx,
	cadParseBlock.paramsSchema.parse({
		file: Buffer.from(dxf, 'utf8'),
		filename: 'caixa-mdf.dxf',
		unit_hint: 'auto',
		tolerance_mm: 0.05,
	}),
);
const met = await cadMetricsBlock.run(
	ctx,
	cadMetricsBlock.paramsSchema.parse({ sketch: parse.sketch }),
);
const dia = await cadDiagnoseBlock.run(
	ctx,
	cadDiagnoseBlock.paramsSchema.parse({
		sketch: parse.sketch,
		metrics: met.metrics,
		chapa_w: 600,
		chapa_h: 400,
		espessura_mm: 3,
	}),
);
const prev = await cadPreviewSvgBlock.run(
	ctx,
	cadPreviewSvgBlock.paramsSchema.parse({ sketch: parse.sketch }),
);

console.log(`\n${'─'.repeat(72)}`);
console.log('BLOCOS DO MOTOR');
console.log('─'.repeat(72));
console.log(
	`  cad.parse       : formato ${parse.format} · unidade ${parse.unit} (por ${parse.unit_detected}) · ` +
		`${parse.entity_count} entidades · ${parse.bbox_w_mm} × ${parse.bbox_h_mm} mm`,
);
console.log(
	`  cad.metrics     : ${met.length_mm} mm de corte · ${met.pieces} peças · ${met.holes} furos · ` +
		`${met.area_net_mm2} mm² líquidos`,
);
console.log(
	`  cad.diagnose    : ${dia.warning_count} aviso(s), ${dia.error_count} erro(s) · ` +
		`públicos: ${(dia.public_warnings as { code: string }[]).map((d) => d.code).join(', ') || '—'}`,
);
console.log(
	`  cad.preview_svg : ${(prev.svg as string).length.toLocaleString('pt-BR')} bytes de SVG · ` +
		`data URL inline de ${(prev.dataUrl as string).length.toLocaleString('pt-BR')} chars (nada subiu ao storage)`,
);

console.log(`\n${'═'.repeat(72)}`);
