/**
 * O QUE CADA UM DOS SEIS ENTREGA — e o que a tela vai ler.
 *
 * ┌─ POR QUE O FORMATO DE SAÍDA É CÓDIGO E NÃO SÓ PROMPT ───────────────────┐
 * │ O roster é dado: o campo `saida` de cada agente é um exemplo de JSON que │
 * │ vai no pedido, e o modelo obedece na maior parte das vezes. "Na maior    │
 * │ parte das vezes" é exatamente o que não serve para a tela: o Redator     │
 * │ devolve `titulo` numa execução e `headline` na outra, e o cartão da peça │
 * │ nasce vazio sem ninguém saber por quê — com o run já cobrado.            │
 * │                                                                          │
 * │ Então quem lê o JSON dos especialistas é este arquivo, ele aceita os     │
 * │ apelidos mais prováveis, e o que ele não reconhecer continua inteiro em  │
 * │ `output.agentes` para auditoria. Mesma disciplina de `oportunidade.ts`   │
 * │ na Central: o modelo ESCOLHE, o TypeScript normaliza.                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS CHAVES SÃO ACOPLAMENTO DECLARADO, e são poucas ─────────────────────┐
 * │ O bloco precisa conhecer a chave de quem alimenta um campo dedicado da   │
 * │ saída — é o mesmo acoplamento que a Central já tem com `curadoria` e     │
 * │ `estrategista`. Renomear um destes na coleção NÃO quebra o run: o campo  │
 * │ dedicado some, o especialista continua aparecendo na mesa de criação com │
 * │ o JSON dele inteiro, e a única coisa que se perde é o atalho.            │
 * │                                                                          │
 * │ A ÚNICA exceção é `prompt_final`: sem ele não há o que gerar, e o bloco  │
 * │ falha explicitamente em vez de entregar uma arte de um prompt vazio.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Módulo puro.
 */

export const CHAVE_LEITOR_PRODUTO = 'leitor_produto';
export const CHAVE_LEITOR_MARCA = 'leitor_marca';
export const CHAVE_LEITOR_REFERENCIAS = 'leitor_referencias';
export const CHAVE_DIRETOR_ARTE = 'diretor_arte';
export const CHAVE_REDATOR = 'redator';
export const CHAVE_PROMPT_FINAL = 'prompt_final';

/**
 * Teto do prompt que sai daqui.
 *
 * 6.000 e o número tem destino: `ai.image_studio` recusa `prompt` acima de
 * 8.000 caracteres (schema Zod), e quem paga esse 400 é um run em que o time
 * inteiro JÁ trabalhou e JÁ foi cobrado — a arte não sai e o dinheiro saiu.
 * Cortar aqui, com folga para a frase de proibição que é acrescentada depois,
 * é a diferença entre um prompt longo e um run perdido.
 */
export const MAX_PROMPT = 6_000;

/** Teto de cada campo de texto que vai para a tela. */
const MAX_LINHA = 400;
const MAX_LEGENDA = 2_000;

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

/** Primeiro apelido presente, já limpo e cortado. */
function texto(
	o: Record<string, unknown> | null,
	nomes: string[],
	max: number,
) {
	if (!o) return '';
	for (const n of nomes) {
		const v = o[n];
		if (typeof v === 'string' && v.trim()) {
			const limpo = v.replace(/\s+/g, ' ').trim();
			return limpo.length > max
				? `${limpo.slice(0, max - 1).trimEnd()}…`
				: limpo;
		}
		// Número puro serve de título ou de chamada tanto quanto uma string.
		if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	}
	return '';
}

export interface CopyDaPeca {
	titulo: string;
	chamada: string;
	legenda: string;
	hashtags: string[];
	/**
	 * A frase que vai DENTRO da arte — e ela não é a mesma coisa que o título.
	 *
	 * O Redator escreve no máximo cinco palavras aqui, e vazio é resposta
	 * legítima: gerador de imagem erra letra em texto longo, e letra errada na
	 * peça perde a arte inteira. Ela tem campo próprio porque quem a consome é o
	 * PROMPT (entre aspas, verbatim), não a legenda do post.
	 */
	texto_na_arte: string;
}

/**
 * O texto da peça, do Redator.
 *
 * Os apelidos não são generosidade: `headline`/`titulo` e `cta`/`chamada` são
 * as duas formas em que o mesmo pedido volta, porque o vocabulário de
 * publicidade é bilíngue por natureza e o roster é escrito por gente.
 */
export function extrairCopy(json: unknown): CopyDaPeca {
	const o = obj(json);
	const hashtagsBrutas = o?.hashtags;
	const hashtags = (
		Array.isArray(hashtagsBrutas)
			? hashtagsBrutas
			: typeof hashtagsBrutas === 'string'
				? hashtagsBrutas.split(/[\s,]+/)
				: []
	)
		.map((h) => String(h).trim())
		.filter(Boolean)
		// A cerquilha é do formato, não do modelo: metade das respostas devolve
		// com e metade sem, e a tela não pode ter duas aparências por sorteio.
		.map((h) => (h.startsWith('#') ? h : `#${h}`))
		.slice(0, 12);

	return {
		titulo: texto(o, ['titulo', 'título', 'headline', 'title'], MAX_LINHA),
		chamada: texto(
			o,
			['chamada', 'cta', 'subtitulo', 'subtítulo', 'subheadline'],
			MAX_LINHA,
		),
		legenda: texto(o, ['legenda', 'caption', 'post', 'texto'], MAX_LEGENDA),
		hashtags,
		texto_na_arte: texto(
			o,
			['texto_na_arte', 'texto_da_arte', 'frase_na_arte'],
			MAX_LINHA,
		),
	};
}

export interface PromptDaArte {
	/** O prompt que vai para o gerador de imagem. Vazio = o run não vale. */
	prompt: string;
	/** O que NÃO pode aparecer. Vai junto no prompt e separado para a tela. */
	negativo: string;
}

/**
 * O PROMPT, do especialista de síntese.
 *
 * Aceita o JSON (`{prompt, negativo}`) e também o TEXTO CRU: um roster pode
 * legitimamente não declarar `saida` para este agente — o produto dele é um
 * parágrafo, não uma ficha, e exigir JSON de quem só tem uma string a dizer é
 * criar um modo de falha (JSON cortado no teto) para não ganhar nada.
 */
export function extrairPrompt(json: unknown, textoCru = ''): PromptDaArte {
	const o = obj(json);
	const doJson = texto(
		o,
		['prompt', 'prompt_final', 'prompt_da_imagem', 'image_prompt'],
		MAX_PROMPT,
	);
	/**
	 * `o_que_nao_pode_aparecer` é o nome que o ROSTER usa (seed do Ateliê), e é
	 * por isso que ele vem primeiro. Os outros são os apelidos com que a mesma
	 * ideia volta quando alguém edita a `saida` pela tela.
	 */
	const negativo = texto(
		o,
		[
			'o_que_nao_pode_aparecer',
			'negativo',
			'prompt_negativo',
			'nao_usar',
			'evitar',
			'negative_prompt',
		],
		MAX_LINHA,
	);
	if (doJson) return { prompt: doJson, negativo };

	/**
	 * Sem JSON utilizável, vale o texto — mas só se ele for texto de verdade.
	 * Uma resposta que começa com `{` é JSON quebrado, e mandar JSON quebrado
	 * para um gerador de imagem produz uma arte com chaves e aspas desenhadas
	 * dentro. Já aconteceu com prompt colado de resposta de modelo.
	 */
	const cru = textoCru.trim();
	if (!cru || cru.startsWith('{') || cru.startsWith('[')) {
		return { prompt: '', negativo };
	}
	return { prompt: cru.slice(0, MAX_PROMPT), negativo };
}

/**
 * O PROMPT FINAL, com a proibição colada — e a colagem é do CÓDIGO.
 *
 * O gerador de imagem lê UMA string: `ai.image_studio` não tem campo de prompt
 * negativo, e não vai ter (é limitação do provedor, não da nossa tool). Então o
 * "não use" da marca — que é o campo que mais segura o modelo, ver
 * `lib/marca.ts` — só existe se estiver DENTRO do prompt.
 *
 * Deixar isso por conta do especialista é apostar que ele nunca esquece; ele
 * esquece. Aqui a frase entra sempre, uma vez só (se ele já escreveu, não
 * repete) e em caixa alta, que é a única forma de proibição que sobrevive à
 * leitura de um modelo de imagem.
 */
export function comporPrompt(p: PromptDaArte): string {
	const base = p.prompt.trim();
	if (!base || !p.negativo.trim()) return base.slice(0, MAX_PROMPT);
	/**
	 * DUAS FORMAS DE JÁ TER, e as duas são o roster funcionando.
	 *
	 * O especialista de síntese é instruído a terminar o pedido com uma frase
	 * começando em "NÃO:" — quando ele obedece, a proibição JÁ está lá e
	 * acrescentar a nossa produz duas listas de proibição no mesmo prompt, com o
	 * risco de a segunda contradizer a primeira. Então basta a SEÇÃO existir; e,
	 * para o roster que não pede essa frase, vale o texto igual.
	 */
	const temSecao = /\bN[ÃA]O\s*(:|INCLUA)/i.test(base);
	const temTexto = base.toLowerCase().includes(p.negativo.trim().toLowerCase());
	const completo =
		temSecao || temTexto
			? base
			: `${base}\n\nNÃO INCLUA: ${p.negativo.trim()}.`;
	return completo.slice(0, MAX_PROMPT);
}
