/**
 * O ORÇAMENTO EM PORTUGUÊS — a conta explicada, não a conta refeita.
 *
 * `computeQuote` devolve um `QuoteBreakdown` completo e correto, e mesmo assim
 * ilegível para quem tem uma marcenaria a laser: `{ diretoCents: 524,
 * overheadCents: 105 }` não responde "onde está indo o meu dinheiro?". Este
 * módulo pega o breakdown PRONTO e escreve o que ele significa.
 *
 * DUAS REGRAS, e a segunda é a que protege o dinheiro do aluno:
 *
 *  1. **Aqui não se calcula preço.** Nenhuma função deste arquivo multiplica,
 *     divide ou soma dinheiro para produzir um valor novo. Ele só formata o que
 *     já veio decidido de `pricing.ts`. As únicas contas presentes são de
 *     APRESENTAÇÃO (a participação de cada parcela no custo, em %), e elas nunca
 *     voltam para a conta.
 *
 *  2. **Modelo de IA só enxerga `dossieParaModelo`.** Quando um especialista
 *     entrar para explicar o orçamento ao aluno, ou para escrever a proposta do
 *     cliente, ele recebe ESTE dossiê: um objeto congelado em que todo valor é
 *     TEXTO JÁ FORMATADO ("R$ 13,50", "47,8%", "6,8 min"). Não é uma
 *     recomendação de prompt — é o tipo: `DossieOrcamento` não tem um único
 *     campo numérico, então não existe código de bloco que consiga entregar a um
 *     modelo os operandos soltos com que ele "refaria" a conta. Um modelo que
 *     recebe "R$ 6,29" e "R$ 13,50" pode explicar a diferença; não tem como
 *     inventar uma terceira.
 */

import { ToolEngineError } from '../tool-errors.js';
import { brl, duracaoBR, numeroBR, pctBR, plural } from './format.js';
import type { QuoteAlerta, QuoteBreakdown } from './pricing.js';

/* ─────────────────────────── A explicação ─────────────────────────── */

export interface ParcelaExplicada {
	id: string;
	/** "Material — MDF" */
	titulo: string;
	/** "R$ 3,54" */
	valor: string;
	/** "56% do custo da peça" */
	participacao: string;
	/** A conta daquela linha, em português. */
	porque: string;
}

export interface PassoDoPreco {
	rotulo: string;
	valor: string;
	porque: string;
}

export interface PerguntaRespondida {
	pergunta: string;
	resposta: string;
}

export interface QuoteExplicacao {
	/** "10 peças de MDF 3 mm — R$ 128,25" */
	titulo: string;
	/** A frase que decide tudo: dá lucro, empata ou dá prejuízo. */
	veredito: string;
	/** Três a cinco frases: o orçamento inteiro sem tabela nenhuma. */
	resumo: string[];
	custo: {
		parcelas: ParcelaExplicada[];
		porPeca: string;
		doLote: string;
		frase: string;
	};
	preco: { passos: PassoDoPreco[]; frase: string };
	tempo: { frase: string };
	alertas: QuoteAlerta[];
	/** As perguntas que um dono de loja faz — respondidas com o número. */
	perguntas: PerguntaRespondida[];
	/** Tudo acima como texto corrido, pronto para ler, copiar ou imprimir. */
	texto: string;
}

/** Participação da parcela no custo direto — número de LEITURA, não de conta. */
function participacao(cents: number, diretoCents: number): string {
	if (diretoCents <= 0) return '—';
	return `${pctBR(cents / diretoCents)} do custo da peça`;
}

export function explicaOrcamento(b: QuoteBreakdown): QuoteExplicacao {
	const { qty, custos, precos, material, tempos, velocidade } = b;
	const pecas = `${numeroBR(qty, 0)} ${plural(qty, 'peça')}`;
	const nomeMaterial = `${material.nome} ${numeroBR(material.espessuraMm, material.espessuraMm % 1 === 0 ? 0 : 1)} mm`;

	const titulo = `${pecas} de ${nomeMaterial} — ${brl(precos.precoTotalCents)}`;

	const lucro = precos.lucroPedidoCents;
	const veredito =
		lucro > 0
			? `Neste pedido sobram ${brl(lucro)} para você, depois de pagar material, máquina, sua hora e o imposto.`
			: lucro === 0
				? `Este pedido empata: paga o custo e não deixa nada.`
				: `Este pedido tira ${brl(-lucro)} do seu bolso — o preço não cobre o que ele custa para fazer.`;

	/* ── custo ── */
	const parcelas: ParcelaExplicada[] = custos.linhas.map((l) => ({
		id: l.id,
		titulo: l.label,
		valor: brl(l.cents),
		participacao: participacao(l.cents, custos.diretoCents),
		porque: l.detalhe ?? '',
	}));
	parcelas.push({
		id: 'overhead',
		titulo: 'Aluguel, luz, contador e o resto',
		valor: brl(custos.overheadCents),
		participacao: participacao(custos.overheadCents, custos.diretoCents),
		porque: `são as despesas que a oficina tem mesmo parada, rateadas em ${pctBR(custos.overheadCents / Math.max(1, custos.diretoCents))} sobre o custo direto desta peça`,
	});

	const maior = [...custos.linhas].sort((x, y) => y.cents - x.cents)[0];
	const custoFrase = maior
		? `Cada peça custa ${brl(custos.totalCents)} para sair da sua oficina, e ${pctBR(maior.cents / Math.max(1, custos.diretoCents))} disso é ${maior.label.toLowerCase()}. O lote inteiro custa ${brl(precos.custoLoteCents)}.`
		: `Cada peça custa ${brl(custos.totalCents)}.`;

	/* ── preço ── */
	const passos: PassoDoPreco[] = [
		{
			rotulo: 'Custo da peça',
			valor: brl(custos.totalCents),
			porque:
				'material, máquina, sua mão de obra e o rateio das despesas fixas',
		},
		{
			rotulo:
				precos.escolhido === 'markup'
					? `Seu ganho em cima do custo (${pctBR(precos.markup.pct)})`
					: `Sua margem sobre a venda (${pctBR(precos.margem.pct)})`,
			valor: brl(
				precos.escolhido === 'markup'
					? precos.markup.precoLiquidoCents
					: precos.margem.precoLiquidoCents,
			),
			porque:
				precos.escolhido === 'markup'
					? 'é o custo mais o quanto você quer ganhar por peça'
					: 'é o preço em que a sua margem cai sobre o valor da venda',
		},
	];
	const variante =
		precos.escolhido === 'markup' ? precos.markup : precos.margem;
	if (precos.impostoPct > 0) {
		passos.push({
			rotulo: `Imposto (${pctBR(precos.impostoPct)} da nota)`,
			valor: brl(variante.impostoCents),
			porque:
				'o imposto sai de dentro do preço, então ele entra por cima para não comer o seu ganho',
		});
	}
	if (precos.precoUnitCents !== variante.precoComImpostoCents) {
		passos.push({
			rotulo: 'Arredondamento',
			valor: brl(precos.precoUnitCents - variante.precoComImpostoCents),
			porque: 'a sua regra de arredondar preço, sempre para cima',
		});
	}
	passos.push({
		rotulo: `Preço da peça × ${pecas}`,
		valor: brl(precos.subtotalCents),
		porque: `${brl(precos.precoUnitCents)} cada`,
	});
	if (precos.descontoCents > 0) {
		passos.push({
			rotulo: `Desconto de ${pctBR(precos.descontoPct)}${precos.descontoFaixaMinQtd ? ` (sua faixa a partir de ${precos.descontoFaixaMinQtd} peças)` : ' (negociado neste pedido)'}`,
			valor: `-${brl(precos.descontoCents)}`,
			porque: 'sai depois do imposto, sobre o valor cheio do pedido',
		});
	}
	if (precos.aplicouPedidoMinimo) {
		passos.push({
			rotulo: 'Pedido mínimo da sua oficina',
			valor: brl(precos.pedidoMinimoCents),
			porque:
				'o cálculo deu menos que o seu mínimo, então o que vale é o mínimo',
		});
	}
	passos.push({
		rotulo: 'TOTAL do pedido',
		valor: brl(precos.precoTotalCents),
		porque: `${brl(precos.precoUnitEfetivoCents)} por peça, na prática`,
	});

	const precoFrase = `Você cobra ${brl(precos.precoUnitCents)} por peça e ${brl(precos.precoTotalCents)} pelo pedido${precos.descontoCents > 0 ? `, já com ${pctBR(precos.descontoPct)} de desconto` : ''}. Na prática cada peça sai por ${brl(precos.precoUnitEfetivoCents)}.`;

	/* ── tempo ── */
	const tempoFrase = `Cada peça ocupa ${duracaoBR(tempos.unitarioS)} de máquina; o lote inteiro leva ${duracaoBR(tempos.loteComManualS)}${tempos.manualS > 0 ? ` (${duracaoBR(tempos.manualS)} deles na mão, fora da máquina)` : ''}. Prazo: ${b.prazoDias} ${plural(b.prazoDias, 'dia')}.`;

	/* ── as perguntas do dono ── */
	const perguntas: PerguntaRespondida[] = [
		{
			pergunta: 'Quanto eu cobro nessa peça?',
			resposta: `${brl(precos.precoUnitCents)} a peça, ${brl(precos.precoTotalCents)} o pedido de ${pecas}.`,
		},
		{
			pergunta: 'Estou ganhando ou perdendo dinheiro?',
			resposta:
				lucro > 0
					? `Ganhando ${brl(lucro)} no pedido (${brl(precos.lucroPorPecaCents)} por peça), o que dá ${pctBR(precos.margemEfetivaComDescontoPct)} de margem.`
					: lucro === 0
						? 'Nem uma coisa nem outra: o preço paga exatamente o custo.'
						: `Perdendo ${brl(-lucro)} neste pedido.`,
		},
		{
			pergunta: 'Onde está indo o meu dinheiro?',
			resposta: parcelas
				.map((p) => `${p.titulo}: ${p.valor} (${p.participacao})`)
				.join(' · '),
		},
		{
			pergunta: 'Qual é o mínimo que eu posso cobrar sem perder dinheiro?',
			resposta: `${brl(precos.precoUnitMinimoCents)} por peça. Abaixo disso, com o desconto e o imposto deste pedido, você paga para trabalhar.`,
		},
		{
			pergunta: 'Quanto de desconto eu posso dar?',
			resposta:
				precos.descontoMaximoPct > 0
					? `Até ${pctBR(precos.descontoMaximoPct, 1)} — daí para baixo o pedido deixa de pagar o custo.${precos.descontoPct > 0 ? ` Você já está dando ${pctBR(precos.descontoPct)}.` : ''}`
					: 'Nenhum: este preço já está no limite do custo.',
		},
		{
			pergunta: 'Quanto tempo isso me ocupa?',
			resposta: tempoFrase,
		},
	];

	const resumo = [
		veredito,
		custoFrase,
		precoFrase,
		tempoFrase,
		velocidade.estimativa
			? `Atenção: a velocidade de corte usada é ${velocidade.source === 'modelo' ? 'estimada por cálculo' : 'a média de outros alunos'} (${pctBR(velocidade.confidence)} de confiança). Corte uma peça de teste antes de fechar.`
			: `A velocidade de corte usada é medida (${pctBR(velocidade.confidence)} de confiança).`,
	];

	const explicacao: QuoteExplicacao = {
		titulo,
		veredito,
		resumo,
		custo: {
			parcelas,
			porPeca: brl(custos.totalCents),
			doLote: brl(precos.custoLoteCents),
			frase: custoFrase,
		},
		preco: { passos, frase: precoFrase },
		tempo: { frase: tempoFrase },
		alertas: b.alertas,
		perguntas,
		texto: '',
	};
	explicacao.texto = montaTexto(explicacao);
	return explicacao;
}

/** A explicação inteira em texto corrido — é o que se copia e se cola. */
function montaTexto(e: QuoteExplicacao): string {
	const linhas: string[] = [e.titulo, '', ...e.resumo, '', 'O CUSTO DA PEÇA'];
	for (const p of e.custo.parcelas) {
		linhas.push(`- ${p.titulo}: ${p.valor} (${p.participacao}) — ${p.porque}`);
	}
	linhas.push(
		`= ${e.custo.porPeca} por peça · ${e.custo.doLote} o lote`,
		'',
		'COMO O PREÇO FOI MONTADO',
	);
	for (const p of e.preco.passos) {
		linhas.push(`- ${p.rotulo}: ${p.valor} — ${p.porque}`);
	}
	if (e.alertas.length > 0) {
		linhas.push('', 'O QUE VOCÊ PRECISA OLHAR');
		for (const a of e.alertas) linhas.push(`- ${a.titulo}: ${a.mensagem}`);
	}
	linhas.push('', 'PERGUNTAS');
	for (const q of e.perguntas) linhas.push(`- ${q.pergunta} ${q.resposta}`);
	return linhas.join('\n');
}

/* ─────────────────── A única porta para um modelo ─────────────────── */

/**
 * O orçamento como TEXTO, e só texto.
 *
 * Repare que não existe um campo numérico neste tipo — é de propósito e é o
 * ponto do módulo. Um bloco de IA que queira explicar o orçamento, escrever a
 * proposta do cliente ou dar uma opinião sobre o preço recebe isto e nada mais:
 * valores já formatados, prontos, fechados. Não há operando solto para o modelo
 * multiplicar, nenhuma unidade para ele converter e nenhuma chance de a nota
 * chegar ao cliente com um número que a máquina de calcular do produto nunca
 * produziu.
 */
export interface DossieOrcamento {
	readonly trabalho: string;
	readonly peca: string;
	readonly preco_por_peca: string;
	readonly preco_por_peca_na_pratica: string;
	readonly preco_total: string;
	readonly desconto: string;
	readonly prazo: string;
	readonly custo_por_peca: string;
	readonly custo_do_lote: string;
	readonly lucro_do_pedido: string;
	readonly margem_do_pedido: string;
	readonly preco_minimo_por_peca: string;
	readonly desconto_maximo: string;
	readonly tempo: string;
	readonly confianca_da_velocidade: string;
	readonly onde_vai_o_dinheiro: readonly string[];
	readonly como_o_preco_foi_montado: readonly string[];
	readonly alertas: readonly string[];
	readonly regra: string;
}

/** Um valor "R$ 13,50" é texto; "13.50" seria operando. Só o primeiro passa. */
const SO_NUMERO = /^-?[\d.,\s]+$/;

/**
 * Exportada para ter teste próprio: é ela que garante, em tempo de execução, o
 * que o tipo `DossieOrcamento` garante em tempo de compilação.
 */
export function exigeTextoFormatado(caminho: string, v: unknown): void {
	if (typeof v !== 'string') {
		throw new ToolEngineError(
			500,
			`dossiê do orçamento com valor não-texto em '${caminho}': um modelo não pode receber número solto`,
		);
	}
	if (v !== '' && SO_NUMERO.test(v)) {
		throw new ToolEngineError(
			500,
			`dossiê do orçamento com número cru em '${caminho}': '${v}' — todo valor tem que sair formatado (R$, %, min)`,
		);
	}
}

/**
 * Monta o dossiê a partir de um orçamento JÁ CALCULADO e o congela.
 *
 * A checagem em tempo de execução é redundante com o tipo — e existe justamente
 * por isso: o tipo protege quem compila, e isto protege quem editar este arquivo
 * no futuro com um `as` no meio do caminho.
 */
export function dossieParaModelo(b: QuoteBreakdown): DossieOrcamento {
	const e = explicaOrcamento(b);
	const { precos, material, velocidade } = b;

	const dossie: DossieOrcamento = {
		trabalho: e.titulo,
		peca: `${numeroBR(material.areaPecaMm2 / 100, 1)} cm² de área, cobrando ${material.basis === 'liquido' ? 'só a peça' : material.basis === 'bbox' ? 'o retângulo em volta' : 'a chapa inteira'}`,
		preco_por_peca: brl(precos.precoUnitCents),
		preco_por_peca_na_pratica: brl(precos.precoUnitEfetivoCents),
		preco_total: brl(precos.precoTotalCents),
		desconto:
			precos.descontoCents > 0
				? `${pctBR(precos.descontoPct)} (${brl(precos.descontoCents)})`
				: 'sem desconto',
		prazo: `${b.prazoDias} ${plural(b.prazoDias, 'dia')}`,
		custo_por_peca: brl(b.custos.totalCents),
		custo_do_lote: brl(precos.custoLoteCents),
		lucro_do_pedido:
			precos.lucroPedidoCents >= 0
				? `${brl(precos.lucroPedidoCents)} de lucro`
				: `${brl(-precos.lucroPedidoCents)} de PREJUÍZO`,
		margem_do_pedido: pctBR(precos.margemEfetivaComDescontoPct),
		preco_minimo_por_peca: brl(precos.precoUnitMinimoCents),
		desconto_maximo: pctBR(precos.descontoMaximoPct, 1),
		tempo: e.tempo.frase,
		confianca_da_velocidade: `${pctBR(velocidade.confidence)}${velocidade.estimativa ? ' — ESTIMATIVA, confirmar num corte de teste' : ' — medida'}`,
		onde_vai_o_dinheiro: e.custo.parcelas.map(
			(p) => `${p.titulo}: ${p.valor} (${p.participacao})`,
		),
		como_o_preco_foi_montado: e.preco.passos.map(
			(p) => `${p.rotulo}: ${p.valor} — ${p.porque}`,
		),
		alertas: e.alertas.map((a) => `${a.titulo}: ${a.mensagem}`),
		regra:
			'Todos os valores acima já estão calculados e conferidos. Use-os exatamente como estão: não some, não converta, não arredonde e não invente nenhum outro número.',
	};

	for (const [chave, valor] of Object.entries(dossie)) {
		if (Array.isArray(valor)) {
			for (const [i, v] of valor.entries()) {
				exigeTextoFormatado(`${chave}[${i}]`, v);
			}
			Object.freeze(valor);
			continue;
		}
		exigeTextoFormatado(chave, valor);
	}
	return Object.freeze(dossie);
}
