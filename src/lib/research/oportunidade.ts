/**
 * "Comece por estes produtos" — a seção que o aluno veio buscar no escopo
 * `mercado`, normalizada e ORDENADA EM CÓDIGO.
 *
 * O Curador de Oportunidades (um especialista de síntese) lê o que os
 * pesquisadores trouxeram e ESCOLHE os produtos. Ele entrega classe e faixa —
 * "margem alta", "concorrência baixa", "custa uns R$ 12" — e nada mais. Quem
 * calcula a margem, quem decide o que vem primeiro e quem descarta o que veio
 * mal formado é este arquivo.
 *
 * ┌─ POR QUE A MARGEM NÃO PODE VIR DO MODELO ───────────────────────────────┐
 * │ Mesma regra de `price-stats.ts` e do precificador: o aluno vai investir  │
 * │ dinheiro em cima deste número. Um LLM que faz `(80-12)/80` erra de vez   │
 * │ em quando e erra CONVINCENTEMENTE — e "margem de 85%" num produto de 40% │
 * │ é a diferença entre um mês de lucro e um mês de prejuízo. Aqui o modelo  │
 * │ só diz o preço que ele VIU e o custo que ele VIU; a conta é aritmética   │
 * │ de TypeScript, e quando falta número a margem fica `null` — nunca        │
 * │ "estimada".                                                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ E POR QUE FAZER A CONTA EM TYPESCRIPT NÃO BASTA ────────────────────────┐
 * │ Achado por verificação adversarial, com reprodução ao vivo: o Analista   │
 * │ de Margem rodando SEM BUSCA inventou "Chapa de MDF Cru 3mm — R$ 79,90 —  │
 * │ Leo Madeiras" com URL fabricada em 2 de 2 tentativas. O Curador copiou o │
 * │ número, esta função dividiu certinho, e o card saiu com "Sobra para você │
 * │ 68% · calculado do preço e do custo achados" em verde. A conta estava    │
 * │ certa; o INSUMO da conta era texto solto de LLM.                          │
 * │                                                                          │
 * │ Por isso `normalizarProdutos` agora exige FONTE para o custo: ou o       │
 * │ produto traz a URL da página do insumo e ela está entre as citações do   │
 * │ run, ou o número bate com o `custo_peca_brl` que o Analista de Margem    │
 * │ trouxe COM página (ver `custoComFonte`). Sem isso o custo é DESCARTADO   │
 * │ (`custo_estimado_brl: null`) e a margem sai `nao_apurado` — que é o      │
 * │ estado âmbar que a tela já sabe mostrar ("custo do material sem fonte"). │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ E POR QUE "TER FONTE" TAMBÉM NÃO BASTAVA ───────────────────────────────┐
 * │ Segunda verificação adversarial, também com reprodução: "tem fonte"      │
 * │ provava só que o Analista de Margem ABRIU alguma página. O custo de      │
 * │ R$ 12,40 de uma chapa de acrílico saía carimbado com a URL de uma caixa  │
 * │ de papelão de R$ 1,20, e o mesmo número era EMPRESTADO a todo produto    │
 * │ cujo valor batesse — troféu de acrílico, tábua de MDF e caneca, os três  │
 * │ com a página da caneca embaixo, os três em verde.                        │
 * │                                                                          │
 * │ Agora o número anda amarrado ao INSUMO de onde saiu, dos dois lados:     │
 * │ `custoComFonte` só aceita `custo_peca_brl` que seja o preço de um insumo │
 * │ com página citada, e `normalizarProdutos` só empresta esse número a      │
 * │ produto feito daquele insumo (`falaDoMesmoInsumo`). Quando a amarração   │
 * │ não fecha, o custo NÃO existe — "não apurado" é resposta; fonte que não  │
 * │ sustenta o número não é.                                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Módulo PURO: nenhum import de rede, banco ou env. Importar controller ou
 * repositório aqui puxa o cliente Supabase junto e quebra os testes de mesa.
 */

export type MargemFaixa = 'alta' | 'media' | 'baixa' | 'nao_apurado';
export type NivelConcorrencia = 'baixa' | 'media' | 'alta' | 'nao_apurado';
/**
 * `nao_apurado` existe aqui pelo mesmo motivo que existe na margem: o modelo
 * que não respondeu não pode virar "médio". Era o ÚNICO campo do card em que
 * ausência virava afirmação — todos os outros já caíam em âmbar.
 */
export type Esforco = 'facil' | 'medio' | 'dificil' | 'nao_apurado';

/** Um produto pronto para o aluno começar a vender. */
export interface ProdutoOportunidade {
	nome: string;
	por_que_agora: string;
	publico: string;
	preco_venda_brl: { min: number | null; max: number | null };
	/** Só sobrevive com FONTE. Sem página que o sustente, `null`. */
	custo_estimado_brl: number | null;
	/** A página que sustenta o custo. Vazio quando não há custo apurado. */
	custo_fonte_url: string;
	/** CALCULADO AQUI. `null` quando falta preço ou custo com fonte. */
	margem_pct: number | null;
	/**
	 * A faixa da CONTA. Sem conta, `nao_apurado` — nunca a classe do modelo.
	 *
	 * Foi assim que um produto sem número nenhum ganhava o realce esmeralda de
	 * "margem alta · pouca briga" enquanto o próprio card dizia "Você cobra: não
	 * apurado / Sobra para você: não apurado". O que o modelo achou continua
	 * disponível em `margem_declarada`, separado e sem se passar por apurado.
	 */
	margem_faixa: MargemFaixa;
	/** O que o Curador CLASSIFICOU, sem conta por trás. Serve à ordenação. */
	margem_declarada: MargemFaixa;
	concorrencia: NivelConcorrencia;
	por_que_pouca_concorrencia: string;
	esforco: Esforco;
	material: string;
	onde_vender: string;
	primeiro_passo: string;
	url_exemplo: string;
	imagem_url: string;
}

/**
 * Quantos produtos sobrevivem à normalização.
 *
 * A grade da tela mostra 12 — o mesmo número que já governa o teto de fotos no
 * bloco. Passar disso vira rolagem infinita de sugestão fraca: a lista está
 * ordenada por qualidade, então o 13º é, por construção, o pior.
 */
export const MAX_PRODUTOS = 12;

/**
 * Onde uma faixa de margem começa.
 *
 * Números de personalização a laser, não de indústria: o insumo (MDF, acrílico,
 * copo base) costuma ser fração pequena do preço, e o que se vende é o serviço.
 * Abaixo de 35% o frete e a hora de máquina comem o lucro — é por isso que a
 * fronteira de "baixa" está aí, e não nos 20% de um varejo comum.
 */
const MARGEM_ALTA_PCT = 60;
const MARGEM_MEDIA_PCT = 35;

/**
 * Piso para o produto com número ganhar a frente da fila.
 *
 * É o mesmo 35% da fronteira "média": abaixo disso o frete e a hora de máquina
 * comem o lucro, então "margem apurada" deixa de ser uma boa notícia. Sem este
 * piso, o grupo "tem número" vencia INCONDICIONALMENTE e a lista abria com um
 * copo de 5,7% em mercado lotado e uma luminária de −80% (prejuízo medido, não
 * hipótese) na frente de dois produtos que a pesquisa classificou como margem
 * alta e pouca concorrência. O subtítulo da seção diz "o primeiro é a melhor
 * combinação dos dois" — era exatamente o contrário.
 */
const PISO_MARGEM_APURADA_PCT = MARGEM_MEDIA_PCT;

/**
 * Peso da concorrência na ordenação.
 *
 * `nao_apurado` fica ENTRE `media` e `alta` de propósito: não saber quem mais
 * vende é pior que saber que há alguns concorrentes e melhor que saber que o
 * mercado está lotado. Empurrar o desconhecido para o topo seria premiar a
 * ausência de pesquisa, que é exatamente o que esta ferramenta combate.
 */
const PESO_CONCORRENCIA: Record<NivelConcorrencia, number> = {
	baixa: 1,
	media: 0.7,
	nao_apurado: 0.55,
	alta: 0.4,
};

/** Nota de margem para quem só tem CLASSE, sem número. */
const NOTA_FAIXA: Record<MargemFaixa, number> = {
	alta: 70,
	media: 45,
	baixa: 20,
	nao_apurado: 0,
};

const ORDEM_ESFORCO: Record<Esforco, number> = {
	facil: 0,
	medio: 1,
	dificil: 2,
	// Quem não classificou o esforço não pode desempatar na frente de quem
	// classificou como fácil — mas também não é "difícil". Fica por último.
	nao_apurado: 3,
};

/* ══════════════════════ leitura de JSON de LLM ══════════════════════ */

/**
 * Nome de produto normalizado para casar item entre especialistas.
 *
 * Serve à herança de foto: o Curador escolhe entre o que os outros trouxeram e
 * quase nunca tem página própria, então o cartão dele nasce sem foto. Casando o
 * NOME com o item que o Radar abriu, a foto (que já veio de página aberta e
 * conferida) atravessa. Pontuação e espaço extra somem porque "Caneca Térmica
 * 500ml" e "caneca termica 500 ml" são a mesma peça escrita por dois papéis.
 */
export function chaveDeNome(v: unknown): string {
	if (typeof v !== 'string') return '';
	return chave(v)
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Sem acento e em minúsculas — "Média" e "media" são a mesma palavra. */
function chave(v: string): string {
	return v
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase();
}

/**
 * Texto de um campo que o modelo pode ter respondido de quatro jeitos.
 *
 * Lista virando string, `null` no meio do array e número onde se esperava
 * frase JÁ derrubaram a tela de um dossiê PAGO. Aqui tudo vira string ou vazio;
 * nada lança.
 */
function texto(v: unknown, limite = 600): string {
	if (typeof v === 'string') return v.trim().slice(0, limite);
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	if (Array.isArray(v)) {
		return v
			.map((x) => texto(x, limite))
			.filter(Boolean)
			.join('; ')
			.slice(0, limite);
	}
	return '';
}

/**
 * `"1.234,56"` → 1234.56. A vírgula decide: se ela existe, o ponto é separador
 * de milhar; se não existe, `1.234` é milhar e `12.5` é decimal.
 */
function valorBr(bruto: string): number | null {
	const limpo = bruto.replace(/[.,]$/, '');
	let normalizado: string;
	if (limpo.includes(',')) {
		normalizado = limpo.replace(/\./g, '').replace(',', '.');
	} else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
		normalizado = limpo.replace(/\./g, '');
	} else {
		normalizado = limpo;
	}
	const n = Number(normalizado);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Números em real dentro de um texto de LLM.
 *
 * Formatos reais já vistos: `64.9`, `"R$ 64,90"`, `"R$ 1.234,56"`, `"de 50 a
 * 80 reais"`, `"a partir de R$12"`.
 *
 * PORCENTAGEM NÃO É DINHEIRO: `"cerca de 15% do preço"` devolvia `[15]`, e 15
 * reais de custo em cima de um preço de 30 vira "margem de 50% calculada" na
 * célula mais visível da seção. Número colado num `%` é descartado.
 */
export function numerosBrl(v: unknown): number[] {
	if (typeof v === 'number') {
		return Number.isFinite(v) && v > 0 ? [v] : [];
	}
	if (typeof v !== 'string') return [];
	const out: number[] = [];
	for (const m of v.matchAll(/\d[\d.,]*/g)) {
		const bruto = m[0];
		const depois = v.slice((m.index ?? 0) + bruto.length);
		if (/^\s*%/.test(depois)) continue;
		const n = valorBr(bruto);
		if (n !== null) out.push(n);
	}
	return out;
}

/** Primeiro número em real do valor, ou `null`. */
export function numeroBrl(v: unknown): number | null {
	return numerosBrl(v)[0] ?? null;
}

/**
 * Valor monetário ESTRITO: o campo inteiro é um preço, ou não é nada.
 *
 * Para o custo do insumo não serve "pegue o primeiro número que aparecer".
 * Reproduzido: `"cerca de 15% do preço"` virava custo 15 e margem 50%;
 * `"R$ 89,90 o pacote com 50 canecas"` virava custo de R$ 89,90 POR PEÇA e
 * margem de −157% — e as duas subiam para o grupo privilegiado da ordenação.
 * Prosa é ausência de número, e ausência tem que virar "não apurado".
 */
export function numeroBrlEstrito(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
	if (typeof v !== 'string') return null;
	const m = v.trim().match(/^(?:r\$\s*)?(\d[\d.,]*)\s*(?:reais|real|brl)?$/i);
	return m?.[1] ? valorBr(m[1]) : null;
}

/**
 * Faixa de preço a partir do que o modelo mandou.
 *
 * Aceita `{min,max}`, `[min,max]`, `"R$ 50 a R$ 80"` e um número solto (que
 * vira só `min` — um preço único não é faixa, e inventar o outro extremo seria
 * criar informação).
 */
function faixaPreco(v: unknown): { min: number | null; max: number | null } {
	if (v && typeof v === 'object' && !Array.isArray(v)) {
		const o = v as { min?: unknown; max?: unknown };
		return ordenarFaixa(numeroBrl(o.min), numeroBrl(o.max));
	}
	if (Array.isArray(v)) {
		return ordenarFaixa(numeroBrl(v[0]), numeroBrl(v[1]));
	}
	const ns = numerosBrl(v);
	return ordenarFaixa(ns[0] ?? null, ns[1] ?? null);
}

function ordenarFaixa(
	min: number | null,
	max: number | null,
): { min: number | null; max: number | null } {
	if (min !== null && max !== null && min > max) return { min: max, max: min };
	return { min, max };
}

/**
 * Sinônimos que o modelo usa sem pedir licença ("médio", "alto", "difícil").
 *
 * `medio↔media` aparece nos dois sentidos porque as duas listas de enum têm
 * gênero diferente (concorrência é feminina, esforço é masculino) e o modelo
 * não respeita isso. Não há ambiguidade: `umDe` só consulta este mapa DEPOIS de
 * falhar a comparação direta com a lista de valores válidos daquele campo.
 */
const SINONIMOS: Record<string, string> = {
	baixo: 'baixa',
	medio: 'media',
	alto: 'alta',
	media: 'medio',
	facil: 'facil',
	dificil: 'dificil',
};

function umDe<T extends string>(v: unknown, valores: readonly T[], alt: T): T {
	const k = chave(texto(v, 40));
	if (!k) return alt;
	const direto = valores.find((x) => x === k);
	if (direto) return direto;
	const sin = SINONIMOS[k];
	const porSinonimo = valores.find((x) => x === sin);
	return porSinonimo ?? alt;
}

/** Só http(s) vira link clicável — `data:` e `javascript:` não entram na tela. */
function url(v: unknown): string {
	const s = texto(v, 500);
	return /^https?:\/\//i.test(s) ? s : '';
}

/**
 * Duas URLs que apontam para a MESMA página viram a mesma chave.
 *
 * Serve para conferir o link do modelo contra as citações do run. O modelo
 * copia o endereço do digest e come o `www.`, a barra final ou o
 * `#position=1&search_layout=grid` que o marketplace pendura — e uma comparação
 * literal descartaria um link legítimo. Query e âncora saem porque nenhum
 * marketplace brasileiro identifica anúncio por elas (o id vive no caminho).
 */
export function chaveUrl(u: string): string {
	return u
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/[#?].*$/, '')
		.replace(/\/+$/, '');
}

/** Conjunto de comparação a partir das citações realmente coletadas. */
export function conjuntoDeUrls(urls: Iterable<string>): Set<string> {
	const s = new Set<string>();
	for (const u of urls) {
		const k = chaveUrl(String(u ?? ''));
		if (k) s.add(k);
	}
	return s;
}

/* ══════════════════════ o custo, e a página que o sustenta ══════════════════════ */

/**
 * Custo por peça QUE TEM PÁGINA — o único que pode virar margem.
 *
 * Os três campos andam JUNTOS de propósito: o número, a página de onde ele saiu
 * e o INSUMO que aquela página vende. Sem o `item`, "tem fonte" só provava que o
 * Analista de Margem abriu alguma página — ver `custoComFonte`.
 */
export interface CustoComFonte {
	/** O insumo que a página vende, como o especialista o nomeou. */
	item: string;
	brl: number;
	url: string;
}

/**
 * Lê o JSON do Analista de Margem e devolve o custo por peça SE ele tiver
 * página conferida — E se a página for a DAQUELE número.
 *
 * Quatro condições, todas verificáveis em código:
 *   1. `custo_peca_brl` é um valor monetário de verdade (não prosa, não %);
 *   2. algum insumo aponta para uma URL que ESTÁ entre as citações do run — ou
 *      seja, uma página que o especialista de fato abriu;
 *   3. o `preco_brl` DESSE insumo é o próprio `custo_peca_brl`;
 *   4. aquela página vende UMA PEÇA, e não um lote: `rende_pecas > 1` diz, com
 *      todas as letras, que o preço é da chapa/caixa inteira.
 *
 * ┌─ POR QUE A CONDIÇÃO 3 EXISTE ───────────────────────────────────────────┐
 * │ A versão anterior parava na 2 e devolvia `{brl, url}` com a URL do       │
 * │ PRIMEIRO insumo citado, sem ligação com o insumo de onde o número veio.  │
 * │ Reproduzido pelo verificador: `custo_peca_brl: 12,40` (chapa de acrílico,│
 * │ página NÃO citada) + insumos com uma caixa de papelão de R$ 1,20 citada  │
 * │ devolvia `{brl: 12,40, url: ".../caixa-10x10"}`. O card saía "material   │
 * │ ≈ R$ 12,40" em verde, com fonte clicável, e a fonte era de outra coisa.  │
 * │                                                                          │
 * │ Com a condição 3 o número é o preço DAQUELA página. O papel do Analista  │
 * │ já manda o mesmo ("um custo por peça só entra em `custo_peca_brl` se a   │
 * │ PÁGINA vender a peça avulsa", e proíbe dividir e multiplicar), então     │
 * │ quem cumpre o papel passa. Quem dividiu a chapa por um rendimento que    │
 * │ ele mesmo estimou não passa — e não passar é o certo: esse número não    │
 * │ está em página nenhuma.                                                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ E POR QUE A CONDIÇÃO 4 EXISTE ──────────────────────────────────────────┐
 * │ Sozinhas, as três primeiras PREMIAVAM QUEM VIOLA O PAPEL. Quem obedece   │
 * │ ("não divida") e não acha a peça avulsa devolve o preço da chapa em      │
 * │ `insumos` e `null` em `custo_peca_brl`: não vira margem nenhuma, que é o │
 * │ certo. Quem desobedece e COPIA o preço da chapa para `custo_peca_brl`    │
 * │ passava na condição 3 — o número é mesmo o daquela página — e saía na    │
 * │ tela como custo apurado.                                                 │
 * │                                                                          │
 * │ Reproduzido pelo verificador: "Chapa de MDF Cru 3mm 2,75×1,85m" a        │
 * │ R$ 79,90 com `rende_pecas: 20`, página citada, copiada em                │
 * │ `custo_peca_brl`. O card do porta-retrato de R$ 35–60 saía "material ≈   │
 * │ R$ 79,90 · Sobra para você −128% · calculado do preço e do custo         │
 * │ achados" — um prejuízo de −128% apresentado como conta com fonte, ao     │
 * │ lado da linha que prova o erro ("rende 20 peças" ⇒ ~R$ 4 por peça).      │
 * │                                                                          │
 * │ O sinal para distinguir chapa de peça JÁ VINHA no JSON e ninguém lia:    │
 * │ `rende_pecas` é campo do schema do Analista ("quantas peças rendem").    │
 * │ `> 1` ⇒ o `preco_brl` é do lote. Dividir aqui está fora de cogitação:    │
 * │ nº de peças por chapa é estimativa do modelo, e o número dividido não    │
 * │ está em página nenhuma — é a mesma invenção que a condição 3 barra.      │
 * │ `null` e `1` continuam passando: é a peça em branco (caneca, tábua,      │
 * │ chaveiro) que a página vende avulsa, exatamente o que o papel pede.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `urlsCitadas` deve ser o conjunto de citações DESTE especialista quando ele
 * rodou agora. Só no cache — onde as citações são gravadas em bloco, sem dono —
 * vale passar a união do run.
 */
export function custoComFonte(
	jsonMargem: unknown,
	urlsCitadas: Set<string>,
): CustoComFonte | null {
	const raiz = raizDe(jsonMargem);
	if (Array.isArray(raiz)) return null;
	const brl = numeroBrlEstrito(raiz.custo_peca_brl);
	if (brl === null) return null;

	const insumos = Array.isArray(raiz.insumos) ? raiz.insumos : [];
	for (const bruto of insumos) {
		if (!bruto || typeof bruto !== 'object') continue;
		const i = bruto as Record<string, unknown>;
		const u = url(i.url);
		if (!u || !urlsCitadas.has(chaveUrl(u))) continue;
		const preco = numeroBrlEstrito(i.preco_brl);
		if (preco === null || !mesmoValor(brl, preco)) continue;
		// PREÇO DE CHAPA NÃO É PREÇO DE PEÇA. Ver a condição 4 no cabeçalho.
		if (vendidoEmLote(i)) continue;
		// Sem nome do insumo não dá para conferir se o produto é feito DELE — e
		// sem essa conferência o número volta a poder ser emprestado a qualquer
		// produto da lista (ver `normalizarProdutos`).
		const item = texto(i.item, 120);
		if (!item) continue;
		return { item, brl, url: u };
	}
	return null;
}

/**
 * Unidades de compra que NUNCA são uma peça.
 *
 * Ou são material contínuo (chapa, rolo, barra, litro, metro) ou são embalagem
 * de muitos (kit, pacote, cento, milheiro). O preço de qualquer uma delas é o
 * preço do LOTE. `caixa` NÃO está aqui de propósito: "Caixa de papelão 10x10" é
 * a embalagem de UMA peça e tem preço unitário legítimo — o que denuncia a
 * caixa-lote é o "com 50" da regra abaixo, não a palavra.
 */
const UNIDADES_DE_LOTE = new Set([
	'barra',
	'barras',
	'bobina',
	'bobinas',
	'chapa',
	'chapas',
	'cento',
	'duzia',
	'duzias',
	'fardo',
	'folha',
	'folhas',
	'galao',
	'kg',
	'kit',
	'kits',
	'litro',
	'litros',
	'metro',
	'metros',
	'milheiro',
	'pacote',
	'pacotes',
	'quilo',
	'quilos',
	'resma',
	'rolo',
	'rolos',
	'saco',
	'sacos',
]);

/**
 * Esta página vende um LOTE em vez de uma peça?
 *
 * Três sinais, nesta ordem de confiança, e todos vêm do schema que o papel do
 * Analista de Margem já pede ("a unidade em que é vendido… e quantas peças
 * rendem"):
 *   1. `rende_pecas > 1` — a própria resposta dizendo que uma unidade de compra
 *      vira várias peças;
 *   2. a unidade de compra (ou o nome do insumo) É uma unidade de lote —
 *      "Chapa de MDF Cru 3mm 2,75×1,85m" não deixa dúvida, e o modelo omite
 *      `rende_pecas` com frequência;
 *   3. "com N" com N > 1 — "caixa com 50", "kit com 4": o preço é dos 50.
 *
 * O erro possível aqui é para MENOS: recusar um custo que era legítimo devolve
 * "não apurado", uma célula âmbar que a tela já sabe mostrar. O erro para mais
 * — preço de chapa virando custo de peça — é o que estampou "Sobra para você
 * −128%" como conta feita, com fonte clicável, num dossiê pago.
 */
function vendidoEmLote(i: Record<string, unknown>): boolean {
	const rende = Number(i.rende_pecas);
	if (Number.isFinite(rende) && rende > 1) return true;

	const dito = chave(`${texto(i.unidade_compra, 120)} ${texto(i.item, 120)}`);
	for (const t of dito.split(/[^a-z0-9]+/)) {
		if (UNIDADES_DE_LOTE.has(t)) return true;
	}
	const comN = dito.match(/\bcom (\d+)\b/);
	return comN ? Number(comN[1]) > 1 : false;
}

/** O mesmo número, tolerando arredondamento de centavo (o Curador COPIA). */
function mesmoValor(a: number, b: number): boolean {
	return Math.abs(a - b) <= Math.max(0.01, b * 0.02);
}

/**
 * Quantas peças o LOTE tem — só quando a própria página diz o número.
 *
 * ┌─ POR QUE ISTO PRECISOU EXISTIR ─────────────────────────────────────────┐
 * │ Medido num run real de "brindes corporativos": o Analista de Margem     │
 * │ trouxe "Caneca de Cerâmica Branca 325ml · Caixa com 36 unidades ·       │
 * │ R$ 287,64 · rende_pecas 36", com página citada — e o Curador devolveu   │
 * │ ZERO produtos, dizendo com todas as letras que faltava "custo unitário  │
 * │ calculado (não apenas pacotes)". Ou seja: a informação estava toda lá,  │
 * │ com fonte, e a seção que o dono do produto pediu saía vazia.            │
 * │                                                                        │
 * │ A regra que barrava isso está CERTA para chapa e ERRADA para caixa. Em  │
 * │ "Chapa 2,75×1,85 m que rende ~20 peças", o 20 é ESTIMATIVA do modelo    │
 * │ (depende do encaixe das peças) e dividir seria inventar. Em "Caixa com  │
 * │ 36 unidades", o 36 está ESCRITO NA PÁGINA — dividir é aritmética sobre  │
 * │ dois números da mesma fonte, exatamente como a mediana de preço já é    │
 * │ calculada aqui. O que a regra nº 3 do projeto proíbe é o MODELO fazer a │
 * │ conta, não a conta existir.                                            │
 * │                                                                        │
 * │ O teste que separa os dois é verificável em código e não depende de     │
 * │ vocabulário: o número de peças tem que APARECER na descrição da unidade │
 * │ de compra. "Caixa com 36 unidades" + 36 ⇒ divide. "Chapa 2,75×1,85m" +  │
 * │ 20 ⇒ o 20 não está lá, é estimativa, recusa.                            │
 * └────────────────────────────────────────────────────────────────────────┘
 */
function unidadesDeclaradasNaPagina(i: Record<string, unknown>): number | null {
	const rende = Number(i.rende_pecas);
	if (!Number.isFinite(rende) || rende <= 1 || !Number.isInteger(rende)) {
		return null;
	}
	const dito = texto(i.unidade_compra, 160);
	if (!dito) return null;
	// Casa o número inteiro, não um pedaço dele: "2,75x1,85" não pode virar
	// prova de "5 unidades" por conter o dígito 5.
	const numeros = (dito.match(/\d+/g) ?? []).map(Number);
	return numeros.includes(rende) ? rende : null;
}

/** Arredonda para centavo — o resultado da divisão vai para a tela. */
function centavos(v: number): number {
	return Math.round(v * 100) / 100;
}

/**
 * TODOS os custos por peça que este run consegue sustentar com página.
 *
 * Dois caminhos, ambos terminando num número que está (ou sai de números que
 * estão) numa página que o especialista de fato abriu:
 *   • DIRETO   — a página vende a peça avulsa e `preco_brl` é o preço dela;
 *   • DERIVADO — a página vende um lote cuja contagem ela mesma declara, e a
 *                divisão é feita AQUI, em TypeScript.
 *
 * Devolve lista porque o Analista traz vários insumos e cada produto do Curador
 * é feito de um deles — quem casa produto com insumo é `falaDoMesmoInsumo`.
 */
export function custosDeInsumos(
	jsonMargem: unknown,
	urlsCitadas: Set<string>,
): CustoComFonte[] {
	const raiz = raizDe(jsonMargem);
	if (Array.isArray(raiz)) return [];
	const insumos = Array.isArray(raiz.insumos) ? raiz.insumos : [];
	const out: CustoComFonte[] = [];

	for (const bruto of insumos) {
		if (!bruto || typeof bruto !== 'object') continue;
		const i = bruto as Record<string, unknown>;
		const u = url(i.url);
		if (!u || !urlsCitadas.has(chaveUrl(u))) continue;
		const preco = numeroBrlEstrito(i.preco_brl);
		if (preco === null || preco <= 0) continue;
		const item = texto(i.item, 120);
		if (!item) continue;

		if (!vendidoEmLote(i)) {
			out.push({ item, brl: preco, url: u });
			continue;
		}
		const n = unidadesDeclaradasNaPagina(i);
		if (n !== null) out.push({ item, brl: centavos(preco / n), url: u });
	}
	return out;
}

/**
 * Junta os custos de VÁRIOS especialistas em uma lista sem duplicata.
 *
 * ┌─ POR QUE SOMAR AS DUAS LISTAS SERIA UMA REGRESSÃO ──────────────────────┐
 * │ Desde que existe a onda 2, dois especialistas levantam preço de insumo:  │
 * │ o `custo_dos_produtos` (que já sabe QUAIS produtos a onda 1 achou) e o   │
 * │ `margem` (que varre o ramo em abstrato). Os dois costumam achar A MESMA  │
 * │ caneca, em lojas diferentes, por preços parecidos.                       │
 * │                                                                          │
 * │ Concatenar sem funder entrega DOIS candidatos que casam com o mesmo      │
 * │ produto, e `custoDoProduto` — que recusa o ambíguo de propósito —        │
 * │ devolveria `null`. Ou seja: ADICIONAR uma fonte de custo faria a margem  │
 * │ sumir de exatamente os produtos que agora têm custo apurado duas vezes.  │
 * │ Duplicata não é ambiguidade; ambiguidade é "caneca de cerâmica" contra   │
 * │ "caneca térmica de inox", e essa continua sendo recusada.                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `porFonte` vem em ORDEM DE PREFERÊNCIA: quem investigou os produtos que a
 * onda 1 achou ganha de quem varreu o ramo em abstrato. Dentro de uma mesma
 * lista nada é fundido — ali a repetição é do próprio especialista e a regra do
 * ambíguo continua valendo.
 */
export function fundirCustos(porFonte: CustoComFonte[][]): CustoComFonte[] {
	const out: CustoComFonte[] = [];
	for (const lista of porFonte) {
		// Fotografado ANTES de aceitar esta lista: a comparação é só contra o que
		// veio de fontes ANTERIORES. Comparar contra o que esta mesma lista já
		// acrescentou apagaria a ambiguidade interna de um especialista — e essa é
		// REAL ("caneca de cerâmica" contra "caneca térmica de inox"), tem que
		// continuar chegando a `custoDoProduto` para ser recusada lá.
		const jaAceitos = [...out];
		for (const c of lista) {
			const repetido = jaAceitos.some(
				(j) =>
					chaveUrl(j.url) === chaveUrl(c.url) ||
					falaDoMesmoInsumo(j.item, c.item),
			);
			if (!repetido) out.push(c);
		}
	}
	return out;
}

/** O candidato cujo insumo casa com o produto, se houver exatamente um. */
function custoDoProduto(
	candidatos: CustoComFonte[],
	produto: string,
): CustoComFonte | null {
	const casam = candidatos.filter((c) => falaDoMesmoInsumo(produto, c.item));
	// Dois insumos casando com o mesmo produto ("caneca de cerâmica" e "caneca
	// térmica de inox") é ambiguidade, e no ambíguo o certo é não afirmar: errar
	// para menos aqui custa um "não apurado"; errar para mais é um preço de
	// custo falso dentro de uma recomendação de compra.
	return casam.length === 1 ? (casam[0] as CustoComFonte) : null;
}

/**
 * Palavras que aparecem em QUALQUER insumo e não identificam nenhum.
 *
 * São a forma de comprar ("chapa", "caixa", "pacote"), o adjetivo de catálogo
 * ("branca", "personalizado") e o preenchimento gramatical. Sem esta lista,
 * "Chapa de MDF" e "Chapa de acrílico" se casariam pela palavra `chapa` — que é
 * a embalagem do insumo, não o insumo.
 */
const PALAVRAS_VAGAS = new Set([
	'avulsa',
	'avulsas',
	'avulso',
	'avulsos',
	'barra',
	'bobina',
	'branca',
	'brancas',
	'branco',
	'brancos',
	'caixa',
	'chapa',
	'colorida',
	'colorido',
	'com',
	'cru',
	'crua',
	'custo',
	'das',
	'dos',
	'embalagem',
	'embalagens',
	'folha',
	'grande',
	'kit',
	'linha',
	'litro',
	'loja',
	'marca',
	'material',
	'materiais',
	'media',
	'medio',
	'metro',
	'pacote',
	'padrao',
	'para',
	'peca',
	'pecas',
	'pequena',
	'pequeno',
	'personalizada',
	'personalizadas',
	'personalizado',
	'personalizados',
	'placa',
	'por',
	'preco',
	'produto',
	'produtos',
	'rolo',
	'saco',
	'sem',
	'simples',
	'tipo',
	'uma',
	'unidade',
	'unidades',
	'venda',
]);

/** As palavras de um texto que ainda identificam um material. */
function palavrasDeInsumo(s: string): Set<string> {
	const out = new Set<string>();
	for (const t of chave(s).split(/[^a-z0-9]+/)) {
		// 3 e não 4: "MDF", "EVA" e "PVC" são o nome do material inteiro. Quem
		// tem dígito é medida ("3mm", "325ml", "2x1"), não material.
		if (t.length < 3 || /\d/.test(t) || PALAVRAS_VAGAS.has(t)) continue;
		out.add(t);
	}
	return out;
}

/**
 * Famílias de MATERIAL, para poder detectar contradição.
 *
 * Não é dicionário de material: é a lista das famílias que se EXCLUEM entre si
 * numa oficina de personalizados. Cerâmica não é inox, e um preço de uma nunca
 * é o custo da outra. Os sinônimos caem na mesma família de propósito — MDF e
 * compensado são os dois "madeira" e disputar qual é qual aqui só criaria
 * recusa onde não há contradição.
 *
 * Fora da lista, a palavra não opina: "caneca" e "chaveiro" são FORMATO, não
 * material, e é justamente por confundir os dois que o custo de uma caneca de
 * cerâmica virava a margem de uma caneca de inox.
 */
const FAMILIA_DE_MATERIAL: Record<string, string> = {
	acrilica: 'acrilico',
	acrilicas: 'acrilico',
	acrilico: 'acrilico',
	acrilicos: 'acrilico',
	aco: 'metal',
	alumino: 'metal',
	aluminio: 'metal',
	bambu: 'madeira',
	borracha: 'borracha',
	cedro: 'madeira',
	ceramica: 'ceramica',
	ceramicas: 'ceramica',
	ceramico: 'ceramica',
	ceramicos: 'ceramica',
	compensado: 'madeira',
	couro: 'couro',
	courino: 'couro',
	cristal: 'vidro',
	eucalipto: 'madeira',
	eva: 'eva',
	feltro: 'tecido',
	ferro: 'metal',
	gesso: 'gesso',
	hdf: 'madeira',
	inox: 'metal',
	latao: 'metal',
	louca: 'ceramica',
	madeira: 'madeira',
	madeiras: 'madeira',
	marmore: 'pedra',
	mdf: 'madeira',
	mdp: 'madeira',
	metal: 'metal',
	metalica: 'metal',
	metalico: 'metal',
	papel: 'papel',
	papelao: 'papel',
	petg: 'plastico',
	pinus: 'madeira',
	plastico: 'plastico',
	poliester: 'tecido',
	polipropileno: 'plastico',
	porcelana: 'ceramica',
	pvc: 'plastico',
	resina: 'resina',
	silicone: 'borracha',
	tecido: 'tecido',
	vidro: 'vidro',
};

function familiasDe(palavras: Set<string>): Set<string> {
	const f = new Set<string>();
	for (const t of palavras) {
		const familia = FAMILIA_DE_MATERIAL[t];
		if (familia) f.add(familia);
	}
	return f;
}

/**
 * O produto é feito DO INSUMO que sustenta o número?
 *
 * É o segundo lado da amarração. `custoComFonte` garante que o número saiu da
 * página; esta função garante que a página é do material DAQUELE produto.
 *
 * Reproduzido pelo verificador, no escopo `mercado`: o Analista de Margem
 * devolve UM `custo_peca_brl` (aqui, R$ 8,50 de uma caneca branca avulsa) e o
 * papel do Curador manda COPIAR esse número em todos os produtos. Sem esta
 * conferência, "Troféu em acrílico 20cm" saía com 90,6% de margem e "Tábua de
 * churrasco em MDF" com 87,9%, os dois carimbados com a página da CANECA, os
 * dois em verde esmeralda no topo da lista. O aluno compraria chapa de acrílico
 * contando com uma sobra calculada em cima do preço de outra coisa.
 *
 * A comparação é por palavra de material, não por igualdade: o Curador escreve
 * "Acrílico 3mm" onde a loja escreve "Chapa de acrílico transparente 3mm".
 *
 * ┌─ POR QUE A PALAVRA EM COMUM NÃO BASTA ───────────────────────────────────┐
 * │ Casar por palavra deixava passar o mesmo defeito num raio mais estreito, │
 * │ e o verificador reproduziu: insumo "Caneca branca de cerâmica 325ml" a   │
 * │ R$ 8,50 com página; o Curador lista "Caneca de cerâmica personalizada" e │
 * │ "Caneca térmica de inox 500ml" e copia o número nos dois, como o papel   │
 * │ dele manda. `caneca` é palavra dos dois lados, então a de INOX saía com  │
 * │ 85,8% de margem e a página da cerâmica como fonte — margem maior que a   │
 * │ legítima, logo primeira da lista e com o realce de "melhor combinação".  │
 * │ Caneca térmica de inox custa R$ 25–35 no atacado: a sobra real é ~55%.   │
 * │                                                                          │
 * │ A palavra que casou era o FORMATO. Agora, quando os dois lados dizem de  │
 * │ que MATERIAL são feitos, famílias diferentes derrubam o casamento — e    │
 * │ derrubar significa `nao_apurado`, não outro número. Quando só um lado    │
 * │ (ou nenhum) nomeia o material — "Caneca personalizada", que é como o     │
 * │ Curador escreve quando deixa `material` vazio — nada foi contrariado e o │
 * │ casamento por palavra continua valendo: é o caso legítimo que a rodada   │
 * │ anterior verificou (75,7% na caneca de cerâmica). Errar para MENOS aqui  │
 * │ custa uma célula "não apurado"; errar para mais manda o aluno comprar    │
 * │ material contando com uma sobra que não existe.                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function falaDoMesmoInsumo(produto: string, item: string): boolean {
	const doItem = palavrasDeInsumo(item);
	if (doItem.size === 0) return false;
	const doProduto = palavrasDeInsumo(produto);

	const famItem = familiasDe(doItem);
	const famProduto = familiasDe(doProduto);
	if (famItem.size > 0 && famProduto.size > 0) {
		let compartilham = false;
		for (const f of famItem) if (famProduto.has(f)) compartilham = true;
		if (!compartilham) return false;
	}

	for (const t of doItem) if (doProduto.has(t)) return true;
	return false;
}

/* ══════════════════════ a conta ══════════════════════ */

/**
 * Margem em % sobre o PREÇO DE VENDA, e a faixa correspondente.
 *
 * Usa o MENOR preço da faixa quando os dois extremos existem. É a escolha
 * conservadora e é deliberada: o aluno vai decidir se compra material com base
 * nisto, e prometer a margem do topo da faixa é a mesma mentira bonita que o
 * piso de confiança de `price-stats.ts` existe para evitar. Se a margem do pior
 * caso já é boa, a oportunidade é boa de verdade.
 *
 * `null` quando falta preço ou custo — nunca "estimado". Margem negativa é
 * mantida como número: um produto que dá prejuízo é informação, não erro.
 *
 * Esta função NÃO sabe se o custo tem fonte, e é por isso que ela não é a última
 * palavra: quem cobra a fonte é `normalizarProdutos`, que só passa para cá um
 * custo já conferido.
 */
export function calcularMargem(
	precoMin: number | null | undefined,
	precoMax: number | null | undefined,
	custo: number | null | undefined,
): { pct: number | null; faixa: MargemFaixa } {
	const min = Number.isFinite(precoMin as number) ? (precoMin as number) : null;
	const max = Number.isFinite(precoMax as number) ? (precoMax as number) : null;
	const preco = min ?? max;
	const c = Number.isFinite(custo as number) ? (custo as number) : null;

	// Custo zero não existe em produto físico: é campo em branco disfarçado de
	// número, e tratá-lo como real devolveria "margem de 100%".
	if (preco === null || preco <= 0 || c === null || c <= 0) {
		return { pct: null, faixa: 'nao_apurado' };
	}

	const pct = Math.round(((preco - c) / preco) * 1000) / 10;
	return { pct, faixa: faixaDaMargem(pct) };
}

function faixaDaMargem(pct: number): MargemFaixa {
	if (pct >= MARGEM_ALTA_PCT) return 'alta';
	if (pct >= MARGEM_MEDIA_PCT) return 'media';
	return 'baixa';
}

/**
 * A ordem da lista é decisão de CÓDIGO, não do modelo.
 *
 * Pedir "ordene por oportunidade" no prompt devolve a ordem em que o modelo
 * pensou nos produtos, que é a ordem em que eles apareceram no material —
 * ou seja, a ordem do marketplace, não a do lucro do aluno.
 *
 * Duas camadas:
 *   1. QUEM TEM NÚMERO BOM vem na frente: margem apurada a partir de
 *      `PISO_MARGEM_APURADA_PCT`. O piso é a correção do defeito relatado —
 *      "tem número" sozinho não é qualidade, e 5,7% apurados não valem mais que
 *      "margem alta" declarada só por terem passado pela divisão.
 *   2. Dentro de cada grupo: margem × peso da concorrência. Margem gorda num
 *      mercado lotado não é oportunidade — é briga de preço. Quem não tem conta
 *      entra com a nota da CLASSE declarada; quem tem conta abaixo do piso entra
 *      com a própria porcentagem (prejuízo vira 0 e afunda, que é o certo).
 * Empate desfeito pelo esforço (o fácil primeiro) e pelo nome, para a lista não
 * mudar de ordem entre dois runs iguais.
 */
export function ordenarProdutos(
	produtos: ProdutoOportunidade[],
): ProdutoOportunidade[] {
	const apurado = (p: ProdutoOportunidade) =>
		p.margem_pct !== null && p.margem_pct >= PISO_MARGEM_APURADA_PCT;
	const nota = (p: ProdutoOportunidade) => {
		const base =
			p.margem_pct !== null
				? Math.max(0, Math.min(100, p.margem_pct))
				: NOTA_FAIXA[p.margem_declarada];
		return base * PESO_CONCORRENCIA[p.concorrencia];
	};
	return [...produtos].sort((a, b) => {
		const grupo = Number(!apurado(a)) - Number(!apurado(b));
		if (grupo !== 0) return grupo;
		const porNota = nota(b) - nota(a);
		if (porNota !== 0) return porNota;
		const porEsforco = ORDEM_ESFORCO[a.esforco] - ORDEM_ESFORCO[b.esforco];
		if (porEsforco !== 0) return porEsforco;
		return a.nome.localeCompare(b.nome, 'pt-BR');
	});
}

/* ══════════════════════ a porta de entrada ══════════════════════ */

/** A raiz do JSON do curador, aceitando o que o modelo costuma inventar. */
function raizDe(json: unknown): Record<string, unknown> | unknown[] {
	if (typeof json === 'string') {
		try {
			return raizDe(JSON.parse(json));
		} catch {
			return [];
		}
	}
	if (Array.isArray(json)) return json;
	if (json && typeof json === 'object') return json as Record<string, unknown>;
	return [];
}

function listaDeProdutos(json: unknown): unknown[] {
	const raiz = raizDe(json);
	if (Array.isArray(raiz)) return raiz;
	const p = raiz.produtos;
	if (Array.isArray(p)) return p;
	// "produtos": "nenhum produto relevante" — o modelo respondendo em prosa
	// onde o schema pedia lista. Já aconteceu e derrubou a tela.
	if (typeof p === 'string') {
		try {
			const parsed = JSON.parse(p);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

/** A observação do curador ("não achei custo de insumo para nenhum destes"). */
export function extrairObservacao(json: unknown): string {
	const raiz = raizDe(json);
	if (Array.isArray(raiz)) return '';
	return texto(raiz.observacao, 1_000);
}

export interface OpcoesNormalizacao {
	/**
	 * O custo por peça que o Analista de Margem trouxe COM página conferida.
	 *
	 * É a única forma de o custo do Curador virar margem quando ele não manda a
	 * URL do insumo: o papel dele manda COPIAR este número ("use o custo por
	 * peça que o Analista de Margem trouxe"), então um valor que bate com ele é
	 * rastreável até aquela página; um valor diferente é invenção.
	 *
	 * Bater o valor é METADE: o número só é emprestado a produto feito daquele
	 * insumo (`item`). Emprestar a todos era o que punha a página de uma caneca
	 * de R$ 8,50 embaixo da margem de um troféu de acrílico.
	 */
	custoComFonte?: CustoComFonte | null;
	/** Custos por peça sustentados por página — ver `custosDeInsumos`. */
	custosDeInsumos?: CustoComFonte[];
	/**
	 * Chaves (`chaveUrl`) das páginas que o run de fato citou.
	 *
	 * O Curador é `motor_busca: 'nenhum'` — ele NÃO abriu página nenhuma. Todo
	 * link que ele escreve é cópia do digest ou invenção, e a única forma de
	 * distinguir os dois é conferir contra as citações. Sem o conjunto, os links
	 * do modelo são preservados (é o comportamento antigo, usado nos testes de
	 * formato).
	 */
	urlsCitadas?: Set<string>;
}

/**
 * JSON cru do Curador → lista limpa, com margem calculada e já ordenada.
 *
 * Nunca lança e nunca devolve `null` no meio da lista: é a última fronteira
 * antes da tela, e a tela já caiu uma vez por confiar no formato prometido pelo
 * prompt. Produto sem nome é descartado — sem nome não há o que o aluno
 * comece a vender.
 */
export function normalizarProdutos(
	json: unknown,
	opts: OpcoesNormalizacao = {},
): ProdutoOportunidade[] {
	const vistos = new Set<string>();
	const out: ProdutoOportunidade[] = [];
	const citadas = opts.urlsCitadas;

	for (const bruto of listaDeProdutos(json)) {
		if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) continue;
		const p = bruto as Record<string, unknown>;

		const nome = texto(p.nome, 120);
		if (!nome) continue;
		const k = chave(nome);
		if (vistos.has(k)) continue;
		vistos.add(k);

		const preco = faixaPreco(p.preco_venda_brl);

		/**
		 * O CUSTO SÓ ENTRA COM PÁGINA — E COM A PÁGINA CERTA.
		 *
		 * Ordem de preferência: (1) a URL do insumo que o próprio produto trouxe,
		 * se ela estiver entre as citações do run; (2) o custo por peça que o
		 * Analista de Margem apurou com página, quando o número bate E o produto é
		 * feito daquele insumo. Fora disso o número é descartado, e a tela mostra
		 * "custo do material sem fonte" em vez de uma porcentagem verde.
		 *
		 * A segunda condição do caminho (2) é a correção do defeito reproduzido:
		 * bater o VALOR provava só que o Curador copiou o número que o papel dele
		 * manda copiar — e como o Analista devolve UM custo por execução, o mesmo
		 * R$ 8,50 da caneca virava margem calculada para o troféu de acrílico e
		 * para a tábua de MDF, com a página da caneca como fonte de todos. Ver
		 * `falaDoMesmoInsumo`. Sobra `nao_apurado`, que é a verdade.
		 */
		const declarado = numeroBrlEstrito(p.custo_estimado_brl);
		const urlDoProduto = url(p.custo_fonte_url ?? p.custo_url ?? p.fonte_custo);
		const doProduto =
			declarado !== null &&
			urlDoProduto &&
			(!citadas || citadas.has(chaveUrl(urlDoProduto)));
		const doAnalista =
			declarado !== null &&
			opts.custoComFonte != null &&
			mesmoValor(declarado, opts.custoComFonte.brl) &&
			falaDoMesmoInsumo(
				// O material é a resposta certa para "do que isto é feito"; o nome
				// entra junto porque "Caneca personalizada" costuma trazer o insumo
				// no próprio nome e deixar `material` vazio.
				`${texto(p.material, 200)} ${nome}`,
				opts.custoComFonte.item,
			);
		/**
		 * Terceiro caminho: o Curador não deu custo nenhum, mas o Analista trouxe
		 * o insumo DESTE produto com página.
		 *
		 * É o caso mais comum quando o Analista obedece ao papel: ele acha "Caixa
		 * com 36 canecas por R$ 287,64" e, proibido de dividir, devolve
		 * `custo_peca_brl: null`. O Curador então não tem custo para copiar e a
		 * lista inteira saía sem margem — foi o que aconteceu no primeiro run real
		 * de "brindes corporativos". Aqui a divisão é nossa, sobre dois números da
		 * mesma página, e só quando a página declara a contagem.
		 */
		const derivado =
			!doProduto && !doAnalista
				? custoDoProduto(
						opts.custosDeInsumos ?? [],
						`${texto(p.material, 200)} ${nome}`,
					)
				: null;

		const custo = doProduto || doAnalista ? declarado : (derivado?.brl ?? null);
		const custoUrl = doProduto
			? urlDoProduto
			: doAnalista
				? (opts.custoComFonte?.url ?? '')
				: (derivado?.url ?? '');

		const { pct, faixa } = calcularMargem(preco.min, preco.max, custo);

		/**
		 * Link do exemplo: só sobrevive se apontar para uma página CITADA.
		 *
		 * É a única prova clicável do card, e o Curador não visitou nada — um
		 * permalink de marketplace plausível e inventado leva o aluno a um 404
		 * dentro de um dossiê pago.
		 */
		const exemplo = url(p.url_exemplo);
		const url_exemplo =
			!citadas || (exemplo && citadas.has(chaveUrl(exemplo))) ? exemplo : '';

		out.push({
			nome,
			por_que_agora: texto(p.por_que_agora),
			publico: texto(p.publico, 200),
			preco_venda_brl: preco,
			custo_estimado_brl: custo,
			custo_fonte_url: custoUrl,
			margem_pct: pct,
			/**
			 * A CONTA ou nada. Deixar a classe do modelo em `margem_faixa` quando
			 * não há conta foi o que pintou de esmeralda um card cujo próprio corpo
			 * dizia "não apurado" duas vezes. A opinião do time continua legível em
			 * `margem_declarada`, onde ninguém a confunde com apuração.
			 */
			margem_faixa: pct !== null ? faixa : 'nao_apurado',
			margem_declarada: umDe(
				p.margem_faixa,
				['alta', 'media', 'baixa', 'nao_apurado'] as const,
				'nao_apurado',
			),
			concorrencia: umDe(
				p.concorrencia,
				['baixa', 'media', 'alta', 'nao_apurado'] as const,
				'nao_apurado',
			),
			por_que_pouca_concorrencia: texto(p.por_que_pouca_concorrencia),
			esforco: umDe(
				p.esforco,
				['facil', 'medio', 'dificil', 'nao_apurado'] as const,
				'nao_apurado',
			),
			material: texto(p.material, 200),
			onde_vender: texto(p.onde_vender, 200),
			primeiro_passo: texto(p.primeiro_passo),
			url_exemplo,
			/**
			 * A FOTO DO MODELO É SEMPRE DESCARTADA.
			 *
			 * O Curador roda com `motor_busca: 'nenhum'`: ele não abriu página, logo
			 * não pode ter visto a `og:image` de nenhuma. O que ele escrevia aqui era
			 * um CDN plausível (`http2.mlstatic.com/D_NQ_…/produto.jpg`) que o filtro
			 * `!a.imagem_url` de `preencherFotos` interpretava como "este já tem
			 * foto" — a imagem inventada VENCIA a real e o card caía no ícone cinza
			 * de pacote. Zerando aqui, a foto vem da própria página do anúncio.
			 */
			imagem_url: '',
		});
	}

	return ordenarProdutos(out).slice(0, MAX_PRODUTOS);
}
