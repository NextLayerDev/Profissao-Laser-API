/**
 * Estatística de preço de mercado — **em TypeScript, nunca no LLM**.
 *
 * A regra vem do precificador (`lib/quote/pricing.ts`: "nenhum número vem de
 * LLM") e vale em dobro aqui: um preço inventado com cara de pesquisa é pior
 * que preço nenhum, porque o aluno fecha um trabalho em cima dele. O modelo
 * COLETA (é o que ele faz bem); quem conta, ordena e tira mediana é este
 * arquivo.
 *
 * Módulo puro: nenhum import de rede, banco ou env.
 */

/** Uma observação de preço, sempre amarrada à fonte que a sustenta. */
export interface PriceObservation {
	/** Em CENTAVOS inteiros. Dinheiro nunca é float. */
	brlCents: number;
	url: string;
	title?: string;
	/** Qual agente trouxe — aparece no dossiê. */
	agente?: string;
	/** Unidades vendidas, quando o anúncio mostra literalmente. */
	vendidos?: number;
	/** Foto do anúncio, quando a página mostra. Ver a foto do concorrente é
	 *  metade do trabalho de entender por que aquele anúncio vende. */
	imagem_url?: string;
}

export interface PriceStats {
	n: number;
	p25Cents: number;
	medianaCents: number;
	p75Cents: number;
	minCents: number;
	maxCents: number;
	/** 0..1 — vira a faixa colorida na tela. */
	confianca: number;
	/** Quantas observações foram jogadas fora como absurdas. */
	descartados: number;
	/** Por que a confiança é essa, em português, para aparecer na tela. */
	motivo: string;
}

/**
 * Mínimo de anúncios para a gente cravar uma faixa.
 *
 * Abaixo disso a tela NÃO mostra número: mostra "não achei anúncios suficientes
 * para cravar um preço". Falhar visível é melhor que mentir bonito.
 */
export const MIN_AMOSTRA = 3;
/** Acima disto a faixa é sólida. */
const AMOSTRA_BOA = 8;

/**
 * Reconhece preço em real dentro de um texto.
 *
 * Aceita `R$ 1.234,56`, `R$ 89,90`, `R$89`, `1.234,56 reais`. Não aceita número
 * solto: "2000" numa página pode ser o ano, a quantidade vendida ou o CEP —
 * exigir o marcador de moeda é o que separa preço de ruído.
 */
const RE_BRL =
	/(?:R\$\s*|(?<=\s)|^)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?\s*(?:reais)?/gi;

/** Converte "1.234,56" → 123456 centavos. */
function paraCentavos(inteiro: string, decimal?: string): number {
	const i = Number(inteiro.replace(/\./g, ''));
	const d = decimal ? Number(decimal) : 0;
	if (!Number.isFinite(i)) return Number.NaN;
	return Math.round(i * 100 + d);
}

/**
 * Extrai preços de um texto. Só conta o que vier com `R$` explícito ou a
 * palavra "reais" — ver o comentário de `RE_BRL`.
 */
export function extrairPrecos(texto: string): number[] {
	const out: number[] = [];
	for (const m of texto.matchAll(RE_BRL)) {
		const bruto = m[0];
		// Sem marcador de moeda não é preço, é número solto.
		if (!/R\$|reais/i.test(bruto)) continue;
		const cents = paraCentavos(m[1] as string, m[2]);
		if (Number.isFinite(cents) && cents > 0) out.push(cents);
	}
	return out;
}

/** Percentil por interpolação linear sobre a amostra já ordenada. */
function percentil(ordenado: number[], p: number): number {
	if (ordenado.length === 0) return 0;
	if (ordenado.length === 1) return ordenado[0] as number;
	const pos = (ordenado.length - 1) * p;
	const baixo = Math.floor(pos);
	const alto = Math.ceil(pos);
	const a = ordenado[baixo] as number;
	const b = ordenado[alto] as number;
	return Math.round(a + (b - a) * (pos - baixo));
}

export function mediana(valores: number[]): number {
	return percentil(
		[...valores].sort((a, b) => a - b),
		0.5,
	);
}

/**
 * Consolida observações em faixa de mercado.
 *
 * Duas defesas contra lixo, nesta ordem:
 *
 * 1. **Observação sem URL é DESCARTADA.** Não é o prompt que garante isso — é
 *    este código. Prompt é pedido, não mecanismo: um modelo pode ignorar
 *    "só cite o que tem fonte" e ninguém saberia.
 * 2. **Outlier fora de `[mediana/5, mediana×5]` cai fora.** Página de
 *    marketplace mistura o preço do produto com frete, parcela e "a partir
 *    de R$ 9,90" de outro item. A mediana é robusta o bastante para servir de
 *    âncora ANTES de podar, e é por isso que a poda vem depois dela.
 */
export function consolidarPrecos(observacoes: PriceObservation[]): {
	stats: PriceStats | null;
	usadas: PriceObservation[];
} {
	const comFonte = observacoes.filter(
		(o) => typeof o.url === 'string' && /^https?:\/\//i.test(o.url),
	);
	const semFonte = observacoes.length - comFonte.length;

	const validos = comFonte.filter(
		(o) => Number.isFinite(o.brlCents) && o.brlCents > 0,
	);
	if (validos.length === 0) {
		return {
			stats: null,
			usadas: [],
		};
	}

	const ancora = mediana(validos.map((o) => o.brlCents));
	const usadas = validos.filter(
		(o) => o.brlCents >= ancora / 5 && o.brlCents <= ancora * 5,
	);
	const descartados = semFonte + (validos.length - usadas.length);

	if (usadas.length === 0) return { stats: null, usadas: [] };

	const ordenado = usadas.map((o) => o.brlCents).sort((a, b) => a - b);
	const n = ordenado.length;

	/**
	 * Confiança pela AMOSTRA e pela DISPERSÃO. Dez anúncios que variam 20× não
	 * valem mais que três que concordam — a dispersão é o que diz se existe
	 * "preço de mercado" ou se cada um cobra o que quer.
	 */
	const p25 = percentil(ordenado, 0.25);
	const p75 = percentil(ordenado, 0.75);
	const med = percentil(ordenado, 0.5);
	const dispersao = med > 0 ? (p75 - p25) / med : 1;

	const porAmostra = Math.min(1, n / AMOSTRA_BOA);
	const porDispersao = dispersao <= 0.5 ? 1 : dispersao >= 2 ? 0.3 : 0.6;
	const confianca = Number((porAmostra * porDispersao).toFixed(2));

	/**
	 * O `motivo` é IMPRESSO AO ALUNO (`dossie.tsx`), então é frase, não log:
	 * "só 1 anúncio(s)" saiu na tela num run real. Plural preguiçoso é economia
	 * de quem escreve cobrada de quem lê.
	 *
	 * E "anúncios" aqui é palavra literal: desde que a amostra passou a exigir
	 * que a PÁGINA assine que vende (ver `analisarCabeca`), estes n são mesmo
	 * anúncios. Antes eram 12 páginas onde não havia um.
	 */
	const motivo =
		n < MIN_AMOSTRA
			? n === 1
				? 'só um anúncio com preço e fonte — não dá para cravar uma faixa'
				: `só ${n} anúncios com preço e fonte — não dá para cravar uma faixa`
			: dispersao >= 2
				? `${n} anúncios, mas com preços muito diferentes entre si`
				: `${n} anúncios com preço e link`;

	return {
		stats: {
			n,
			p25Cents: p25,
			medianaCents: med,
			p75Cents: p75,
			minCents: ordenado[0] as number,
			maxCents: ordenado[n - 1] as number,
			confianca,
			descartados,
			motivo,
		},
		usadas,
	};
}

/**
 * Confiança mínima para a faixa virar "preço de mercado" na tela.
 *
 * Três anúncios que variam de R$ 19,99 a R$ 60,00 têm amostra suficiente e
 * confiança 0,22 — apresentar isso como preço de mercado seria exatamente o
 * tipo de número plausível-e-errado que o produto não pode entregar. Aconteceu
 * num run de teste e por isso o piso existe além do `MIN_AMOSTRA`.
 */
export const CONFIANCA_MINIMA = 0.35;

/**
 * Tem amostra E concordância para mostrar preço?
 *
 * `false` NÃO é erro: é a tela dizendo "não achei anúncios suficientes para
 * cravar um preço" e oferecendo ao aluno informar por quanto ele viu vendendo.
 * Meio dossiê honesto vale mais que um dossiê inteiro inventado.
 */
export function faixaConfiavel(stats: PriceStats | null): boolean {
	return (
		stats !== null &&
		stats.n >= MIN_AMOSTRA &&
		stats.confianca >= CONFIANCA_MINIMA
	);
}
