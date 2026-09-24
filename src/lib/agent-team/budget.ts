/**
 * TETOS DE GASTO DE UMA EXECUÇÃO DE TIME — o mecanismo, não a política.
 *
 * Existem porque o custo aqui é REAL e por execução: cada chamada com busca sai
 * US$ 0,005 e cada especialista queima token. Sem teto, um agente mal
 * configurado (ou um prompt que faz o modelo pesquisar em loop) transforma uma
 * ferramenta de 2 voxxys num prejuízo silencioso — e ninguém descobre até a
 * fatura.
 *
 * O teto é do BLOCO, não do agente: um agente sozinho não sabe quanto os
 * outros já gastaram.
 *
 * ┌─ O QUE MORA AQUI E O QUE MORA NO PRODUTO ───────────────────────────────┐
 * │ Aqui: a CLASSE (reserva de vaga de busca, projeção de pior caso, relógio │
 * │ de parede, os dois canais de mensagem) e as réguas de estimativa. Tudo   │
 * │ isso é igual para qualquer time.                                         │
 * │                                                                          │
 * │ No produto: os NÚMEROS. `LIMITES_PADRAO` da Central (`lib/research/      │
 * │ budget.ts`) foi medido em runs frios de 5 e 22 especialistas; o do       │
 * │ Ateliê (`lib/atelie/agents.ts`) é outro time, outro relógio e outro      │
 * │ preço. Misturá-los num arquivo só faria um número calibrado para um      │
 * │ produto virar padrão do outro por proximidade de arquivo.                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Módulo puro.
 */

export interface BudgetLimits {
	/**
	 * Teto de CHAMADAS COM BUSCA da execução inteira.
	 *
	 * A UNIDADE ESTAVA ERRADA e custava um especialista por run. Quem cobra é o
	 * provedor, e ele cobra por CHAMADA: `search.ts` contabiliza
	 * `buscas = usaBusca ? 1 : 0` por requisição, não importa se o especialista
	 * pediu 3 ou 10 resultados (`max_results` só dimensiona o que volta). A
	 * versão anterior reservava `max_buscas` VAGAS, e em `mercado+rápido` o
	 * roster declara 6 vagas (radar 3 + brechas 2 + margem 1) contra um teto de
	 * 5: o Analista de Margem — a ÚNICA fonte de custo de insumo do time —
	 * rodava sem busca em 100% das execuções, e TODO card de "Comece por estes
	 * produtos" saía com "não apurado". As chamadas de fato cobradas naquele run
	 * eram TRÊS, de um teto de cinco.
	 */
	maxBuscas: number;
	/** Teto de custo estimado, em dólar. Ver `podeGastar`. */
	maxUsd: number;
	/** Relógio de parede. */
	deadlineMs: number;
}

/**
 * US$ por CHAMADA com busca. É o mesmo número de `research/search.ts`
 * (`USD_POR_BUSCA`), repetido aqui porque este módulo é puro e não pode
 * importar quem fala com a rede — `search.ts` importa o cliente OpenRouter no
 * topo.
 */
export const USD_POR_CHAMADA_COM_BUSCA = 0.005;

/**
 * Quantos tokens de ENTRADA os resultados da busca acrescentam à chamada.
 *
 * Medido: um pesquisador cujo prompt tem ~1,5 mil caracteres (≈ 400 tokens)
 * fecha a chamada com ~8 mil tokens de entrada quando o plugin de busca está
 * ligado. A diferença são os resultados colados no contexto. É esta parcela —
 * e não os US$ 0,005 da busca — que faz "rodar sem busca" ser uma economia de
 * verdade, e não um teatro.
 */
const TOKENS_DE_RESULTADO_DE_BUSCA = 7_000;

/** ~4 caracteres por token: a mesma régua que o bloco usa para detectar corte. */
const CHARS_POR_TOKEN = 4;

/**
 * PROJEÇÃO de pior caso de uma chamada, em dólar.
 *
 * Pior caso de propósito: é isto que transforma `maxUsd` em freio. Uma projeção
 * pelo custo típico só reprova depois que o dinheiro já saiu — e o gasto só é
 * conhecido DEPOIS da resposta, que é exatamente o furo que deixava
 * `podeGastar()` sempre verdadeiro (com concorrência 6, a onda inteira pergunta
 * "cabe?" com `usd = 0`).
 *
 * Os preços vêm do catálogo (`text-models-catalog.ts`), que é conferido contra
 * o provedor — nenhum número aqui é chutado.
 *
 * ┌─ IMAGEM NÃO ENTRA POR AQUI ─────────────────────────────────────────────┐
 * │ Quem manda foto paga a foto como TOKEN DE ENTRADA, e o número não sai do │
 * │ tamanho do arquivo: uma imagem reduzida a 1024 px (ver `imagem.ts`) vale │
 * │ ~1.500 tokens em qualquer modelo do catálogo. Quem chama com imagem soma │
 * │ isso ao `charsPrompt` em caracteres equivalentes — ver `CHARS_POR_IMAGEM`│
 * │ em `lib/atelie/agents.ts`. Deixar a conta do lado de fora é o que evita  │
 * │ este módulo ter que saber o que é uma foto.                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function estimarCustoUsd(o: {
	/** US$ por 1M de tokens de entrada. */
	precoIn: number;
	/** US$ por 1M de tokens de saída. */
	precoOut: number;
	/** Tamanho do prompt (system + user + material) em caracteres. */
	charsPrompt: number;
	/** Teto de saída do especialista — o pior caso é ele inteiro. */
	maxTokensSaida: number;
	comBusca: boolean;
}): number {
	const tokensIn =
		Math.ceil(Math.max(0, o.charsPrompt) / CHARS_POR_TOKEN) +
		(o.comBusca ? TOKENS_DE_RESULTADO_DE_BUSCA : 0);
	const tokens =
		(tokensIn * o.precoIn + Math.max(0, o.maxTokensSaida) * o.precoOut) / 1e6;
	return tokens + (o.comBusca ? USD_POR_CHAMADA_COM_BUSCA : 0);
}

/**
 * Latência de abertura da chamada: handshake, fila do provedor e (quando há
 * busca) o tempo até o primeiro token. Medido em ~2 a 3 s nos runs de teste.
 */
const MS_ABERTURA_DA_CHAMADA = 3_000;
/**
 * Quanto tempo cada token de SAÍDA custa de relógio, no MELHOR caso medido.
 *
 * "Melhor caso" de propósito: este número serve para responder "esta chamada
 * ainda tem alguma chance?", não "ela vai dar certo". O Estrategista fechou em
 * 34 s no run mais rápido dos 7 medidos, com teto de 4.000 tokens de saída —
 * 34.000 / 4.000 ≈ 8,5 ms por token. Calibrar pelo PIOR caso (55 s) faria o
 * portão descartar chamadas que costumam dar certo, e a alternativa a tentar é
 * o estorno: com o essencial pulado, a receita é zero de qualquer jeito.
 */
const MS_POR_TOKEN_DE_SAIDA = 8;

/**
 * O relógio mínimo para uma chamada com este teto de saída valer a tentativa.
 *
 * A régua reproduz o piso antigo onde ele estava certo e o corrige onde estava
 * errado: o JSON mais curto do time (1.800 tokens) dá 17 s — praticamente os
 * 15 s que o número fixo cravava —, enquanto o Estrategista (4.000 tokens) dá
 * 35 s, que é o piso que ele sempre precisou e nunca teve.
 */
export function msMinimoUtil(maxTokensSaida: number): number {
	return (
		MS_ABERTURA_DA_CHAMADA + Math.max(0, maxTokensSaida) * MS_POR_TOKEN_DE_SAIDA
	);
}

export class Budget {
	private buscas = 0;
	/**
	 * Chamadas com busca JÁ AUTORIZADAS e ainda não cobradas.
	 *
	 * Sem isto o teto vaza com concorrência alta: os 6 agentes da primeira leva
	 * chamam `podeBuscar` antes de qualquer um chamar `registrar`, todos veem o
	 * contador zerado e todos passam.
	 */
	private reservadas = 0;
	private usd = 0;
	/** Projeção de pior caso das chamadas em voo. Mesma ideia de `reservadas`. */
	private usdReservado = 0;
	private readonly inicio: number;
	/**
	 * RESSALVAS DELE — o que entra na entrega que o aluno pagou.
	 *
	 * Só cabe aqui o que MUDA O QUE ELE RECEBEU e está escrito na voz do
	 * produto: um especialista que não trabalhou, uma pesquisa reaproveitada, um
	 * custo que ficou sem página. Ver `diagnosticos` para o outro lado.
	 */
	readonly avisos: string[] = [];
	/**
	 * DIAGNÓSTICO NOSSO — vai para o log, nunca para a tela.
	 *
	 * ┌─ POR QUE ISTO PRECISOU SER UM CANAL SEPARADO ───────────────────────────┐
	 * │ Havia um canal só, e ele desembocava em `output.avisos`, que o dossiê    │
	 * │ imprime verbatim na seção de ressalvas. O aluno pagou 6 voxxys por um    │
	 * │ time de PROFISSIONAIS e lia, no fim da página: "O orçamento desta        │
	 * │ execução estourou, mas refiz 'Estrategista de Negócio' assim mesmo" e    │
	 * │ "O modelo de 'Curador de Oportunidades' não devolveu resposta            │
	 * │ utilizável; refiz com Gemini 3 Flash (redação)". Não é hipótese: os três │
	 * │ runs frios medidos gravaram as duas frases.                             │
	 * │                                                                          │
	 * │ Quem lê a entrega não comprou uma execução, comprou a entrega. Nome de   │
	 * │ modelo, teto de gasto, retry e orçamento são vocabulário de máquina —    │
	 * │ e a regra da tela bane a palavra "agente" exatamente para que o aluno    │
	 * │ leia pessoas, não engrenagem. Perder essa informação também não serve:   │
	 * │ ela é o que explica um run caro depois. Por isso ela continua sendo      │
	 * │ produzida, e vai para o log do servidor.                                 │
	 * │                                                                          │
	 * │ A PERGUNTA QUE SEPARA OS DOIS: "isto muda o que ele recebeu?" Se a       │
	 * │ resposta mudou de conteúdo (faltou um especialista, faltou fonte, a      │
	 * │ pesquisa é reaproveitada), é `avisar`. Se só conta COMO chegamos lá      │
	 * │ (refiz, troquei de modelo, o teto estourou e passei assim mesmo), é      │
	 * │ `diagnosticar`.                                                          │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 */
	readonly diagnosticos: string[] = [];

	constructor(
		readonly limites: BudgetLimits,
		agora: number,
	) {
		this.inicio = agora;
	}

	gasto(): { buscas: number; usd: number; ms: number } {
		return { buscas: this.buscas, usd: this.usd, ms: Date.now() - this.inicio };
	}

	msRestantes(): number {
		return Math.max(0, this.limites.deadlineMs - (Date.now() - this.inicio));
	}

	/**
	 * Ainda dá para gastar busca?
	 *
	 * Quando a resposta é não, o agente NÃO é cancelado — ele roda **sem
	 * busca**, com o que já foi coletado. Degradar é melhor que sumir: uma
	 * entrega com um bloco a menos ainda serve; uma entrega que não sai, não.
	 */
	podeBuscar(quantas = 1): boolean {
		return this.buscas + this.reservadas + quantas <= this.limites.maxBuscas;
	}

	/**
	 * Toma as vagas de busca NA AUTORIZAÇÃO, não na cobrança.
	 *
	 * UMA por chamada, porque é assim que o provedor cobra. Quem reserva é
	 * obrigado a `liberar` o que não usou — inclusive quando o agente falha. Do
	 * contrário o teto encolhe sozinho ao longo do run e os últimos
	 * especialistas rodam sem busca sem que nada tenha sido gasto.
	 */
	reservar(quantas = 1): void {
		this.reservadas += Math.max(0, quantas);
	}

	liberar(quantas = 1): void {
		this.reservadas = Math.max(0, this.reservadas - Math.max(0, quantas));
	}

	/**
	 * Cabe mais uma chamada de `previsto` dólares?
	 *
	 * Sem argumento responde a pergunta antiga ("o orçamento já estourou?").
	 * COM argumento — que é como o bloco chama — a conta inclui o que está em
	 * voo, e é isso que faz o teto valer com seis agentes despachados no mesmo
	 * tick.
	 */
	podeGastar(previsto = 0): boolean {
		const comprometido = this.usd + this.usdReservado;
		if (previsto <= 0) return comprometido < this.limites.maxUsd;
		return comprometido + previsto <= this.limites.maxUsd;
	}

	reservarUsd(valor: number): void {
		this.usdReservado += Math.max(0, valor);
	}

	liberarUsd(valor: number): void {
		this.usdReservado = Math.max(0, this.usdReservado - Math.max(0, valor));
	}

	/**
	 * Sobrou tempo para mais um agente com este timeout e este teto de saída?
	 *
	 * USADO, e não decorativo: `rodarAgente` chama antes de gastar dinheiro. Sem
	 * ele o bloco despachava um pesquisador com 20 s de relógio, cortava o
	 * timeout dele para 20 s (`Math.min(timeoutS, msRestantes)`) e colhia uma
	 * falha por timeout. Ou seja: pagava a chamada para não receber nada. Pular
	 * com aviso honesto custa zero e dá a mesma informação ao aluno mais cedo.
	 *
	 * PERGUNTA, NÃO SENTENÇA — e a diferença é o que separa este método do
	 * `rodarAgente`. Aqui só se responde pelo relógio; quem decide o que fazer
	 * com o "não" é o chamador, e ele trata `sintese`/`essencial` como trata no
	 * dinheiro: o protegido roda assim mesmo, com aviso. Pular quem escreve a
	 * entrega não salva run nenhum — devolve 502 e estorno com a onda 1 já paga.
	 *
	 * `maxTokensSaida` NÃO É ENFEITE — é a correção do defeito que a versão
	 * anterior deixou de pé. O piso era um número único de 15 s, calibrado pelo
	 * agente MAIS CURTO do time e aplicado ao MAIS LONGO: com 20 s de relógio o
	 * Estrategista (4.000 tokens, 34–55 s medidos) passava no portão, tinha o
	 * timeout cortado para 20 s, morria por timeout — que não é retriável — e o
	 * run era estornado com a onda 1 já paga. Agora o piso sai do que ESTE
	 * agente precisa escrever (`msMinimoUtil`).
	 *
	 * Continua sendo o MENOR entre o timeout do agente e esse piso: um agente
	 * que só tem 30 s de timeout não usaria os 35 s de um teto de 4.000 tokens
	 * nem se os tivesse — exigir mais do que ele pode gastar o eliminaria de
	 * todo run degradado por um tempo que ele nunca usaria.
	 */
	cabeNoTempo(timeoutS: number, maxTokensSaida: number): boolean {
		return (
			this.msRestantes() >=
			Math.min(timeoutS * 1000, msMinimoUtil(maxTokensSaida))
		);
	}

	registrar(buscas: number, usd: number): void {
		this.buscas += buscas;
		this.usd += usd;
	}

	/** Ressalva da ENTREGA. Escreva na voz do produto — o aluno lê isto. */
	avisar(msg: string): void {
		if (!this.avisos.includes(msg)) this.avisos.push(msg);
	}

	/** Diagnóstico NOSSO. Vai para o log do servidor, nunca para a tela. */
	diagnosticar(msg: string): void {
		if (!this.diagnosticos.includes(msg)) this.diagnosticos.push(msg);
	}

	/** Resumo em português, para entrar na entrega quando algo foi cortado. */
	resumo(): string | null {
		if (this.avisos.length === 0) return null;
		return this.avisos.join(' ');
	}
}

/**
 * Limite de concorrência sem dependência nova.
 *
 * `p-limit` resolveria, mas são 15 linhas e o repositório hoje tem ZERO
 * dependência de concorrência — não vale um pacote a mais na árvore por isso.
 */
export async function comLimite<T>(
	itens: (() => Promise<T>)[],
	limite: number,
): Promise<PromiseSettledResult<T>[]> {
	const resultados: PromiseSettledResult<T>[] = new Array(itens.length);
	let proximo = 0;

	async function trabalhador(): Promise<void> {
		while (proximo < itens.length) {
			const i = proximo++;
			const fn = itens[i];
			if (!fn) continue;
			try {
				resultados[i] = { status: 'fulfilled', value: await fn() };
			} catch (reason) {
				resultados[i] = { status: 'rejected', reason };
			}
		}
	}

	const n = Math.max(1, Math.min(limite, itens.length));
	await Promise.all(Array.from({ length: n }, trabalhador));
	return resultados;
}
