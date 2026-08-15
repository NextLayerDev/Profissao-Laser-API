import { z } from 'zod';
import { montarDigest } from '../../lib/agent-team/core.js';
import { escolherAlternativo, gastoDeFalha } from '../../lib/agent-team/llm.js';
import { extractJson } from '../../lib/llm-json.js';
import { escolherMarca, varsDaMarca } from '../../lib/marca.js';
import {
	type AgentSpec,
	interpolar,
	montarTime,
	ORDEM_DAS_ONDAS,
	pisoDeSucesso,
	toAgentSpec,
} from '../../lib/research/agents.js';
import {
	Budget,
	comLimite,
	estimarCustoUsd,
	LIMITES_PADRAO,
} from '../../lib/research/budget.js';
import {
	conferirFotos,
	ehPaginaDeAnuncio,
	hostPermitido,
	type InspecaoPagina,
	inspecionarPaginas,
} from '../../lib/research/og-image.js';
import {
	type CustoComFonte,
	chaveDeNome,
	chaveUrl,
	conjuntoDeUrls,
	custoComFonte,
	custosDeInsumos,
	extrairObservacao,
	fundirCustos,
	normalizarProdutos,
} from '../../lib/research/oportunidade.js';
import {
	consolidarPrecos,
	extrairPrecos,
	faixaConfiavel,
	type PriceObservation,
} from '../../lib/research/price-stats.js';
import {
	type Citation,
	chamarComBusca,
	FALHA_PARA_TELA,
	filtrarPorTema,
	SearchError,
} from '../../lib/research/search.js';
import {
	resolveTextModel,
	type TextModelEntry,
} from '../../lib/text-models-catalog.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { BlockRunContext, ToolBlock } from '../types.js';

/**
 * `ai.research_team` — o TIME DE PESQUISA, num bloco só.
 *
 * DECISÃO DE ARQUITETURA, e a mais importante desta ferramenta: **não existe
 * runtime multi-agente novo.** O motor (`lib/tool-engine.ts`) continua sendo um
 * `for` + `await` sobre um pipeline linear, e o paralelismo mora DENTRO deste
 * bloco — exatamente como `ai.generate_image` já faz com `variation_count`, que
 * é o único precedente de fan-out do repositório e está em produção.
 *
 * O que se ganha: nenhum `engine_runtime` novo para manter, nenhuma tabela de
 * job, nenhum DAG, e risco zero para as ~100 tools existentes. O que se perde:
 * os especialistas não conversam entre si nem negociam quem faz o quê.
 *
 * O QUE ELES FAZEM SÃO TRÊS ONDAS FIXAS, e a do meio é a única dependência de
 * dado que este produto de fato tem: `descoberta → aprofundamento → síntese`.
 * A versão de duas ondas dizia aqui que "preço, demanda, canal e concorrência
 * são ângulos INDEPENDENTES por natureza" — e isso continua verdade DENTRO de
 * uma onda, mas era falso entre ondas: quem procura o perfil de um concorrente,
 * o portfólio dele, a foto do anúncio ou o custo da peça precisa saber ANTES
 * quais são os produtos e quem são os concorrentes. Medido: com tudo em
 * paralelo, o especialista de custo procurava insumo de copo térmico enquanto o
 * Radar achava acrílico e MDF. Ver `FaseAgente` em `agents.ts`.
 *
 * Três invariantes que o resto do produto depende:
 *   1. Estatística de preço sai de TypeScript, nunca do LLM.
 *   2. Observação sem URL de citação é DESCARTADA aqui, não pedida no prompt.
 *   3. Resposta vazia é falha explícita — é assim que o DeepSeek falha.
 */

/**
 * Quantos especialistas trabalham ao mesmo tempo.
 *
 * 10, e o número sai do TAMANHO DAS ONDAS, não de gosto: no Profundo a onda 1
 * tem 7 a 8 especialistas e a onda 2 tem DEZ (conferido na coleção `agentes`,
 * nos dois escopos). Com 6 de cada vez, a onda 2 vira duas levas cujo segundo
 * turno carrega quatro — 30 s de relógio pagos por 4 de 16 pesquisadores,
 * enquanto a barreira da onda segura todo o resto. Com 10, cada onda cabe numa
 * leva.
 *
 * Não afeta o Rápido: lá nenhuma onda passa de 4 especialistas, então 6 e 10
 * despacham exatamente a mesma leva única.
 *
 * O teto de buscas continua respeitado porque a reserva acontece na autorização
 * (ver `Budget.reservar`), e o de custo também (`podeGastar(previsto)` conta o
 * que está em voo). Foi o que permitiu subir daqui sem reabrir o vazamento que
 * existia com 4.
 */
const CONCORRENCIA_PADRAO = 10;
/**
 * Limite DURO do bloco — não é a política de quantos profissionais aparecem.
 *
 * A política é `TETO_POR_MODO` (5 no rápido, 22 no profundo) e mora em
 * `agents.ts`, junto com a regra de quem não pode ser cortado. Este número aqui
 * só existe porque `agentes` é uma coleção editável por tela: são 26 para caber
 * o time profundo inteiro mais quatro protegidos de folga, e não 60 se alguém
 * semear 60 registros.
 */
const MAX_AGENTES = 26;
/**
 * Quantos registros da coleção `agentes` o bloco lê.
 *
 * ARMADILHA MEDIDA NA MUDANÇA PARA 22: era 30, e o roster do profundo sozinho
 * tem 22 chaves — somadas as exclusivas de `produto`, as exclusivas de
 * `mercado` e as desativadas que o seed deixa para trás (ele DESLIGA quem saiu
 * do time em vez de apagar), a coleção passa de 30 com folga. Uma página curta
 * não dá erro: ela devolve menos especialistas, `montarTime` monta um time
 * menor do que o prometido e a tela anuncia 22 entregando 17 — a mesma classe
 * de falha muda que o campo não declarado em `fields` já causou.
 *
 * 120 fica bem abaixo do teto do repositório (200) e cobre qualquer roster que
 * caiba na cabeça de quem edita pela tela.
 */
const PAGINA_DO_ROSTER = 120;
/**
 * De onde sai a seção "Comece por estes produtos".
 *
 * O bloco precisa conhecer ESTA chave porque a saída tem um campo dedicado que
 * a tela lê (`produtos_para_comecar`) — é o mesmo acoplamento que já existe com
 * `estrategista` no `resumo_curto`. Renomear a chave do especialista na coleção
 * não quebra nada: a seção simplesmente não aparece, e o dossiê continua de pé.
 */
const CHAVE_CURADORIA = 'curadoria';
/**
 * Quem levanta o custo do insumo, EM ORDEM DE PREFERÊNCIA.
 *
 * O bloco precisa conhecer estas chaves pelo mesmo motivo da curadoria: é o
 * JSON delas que autoriza (ou não) a margem de "Comece por estes produtos" a
 * existir. Renomear na coleção não quebra nada — o custo passa a sair como "não
 * apurado", que é o estado honesto de quem não tem fonte.
 *
 * ┌─ POR QUE O `custo_dos_produtos` VEM PRIMEIRO ───────────────────────────┐
 * │ O `margem` é da onda 1: ele varre o ramo em ABSTRATO, ao mesmo tempo em  │
 * │ que o Radar descobre quais produtos existem. Medido num run real de      │
 * │ "brindes corporativos": ele procurava insumo de copo térmico enquanto o  │
 * │ Radar achava acrílico e MDF, e como o custo só vira margem quando o      │
 * │ produto é feito DAQUELE insumo (`falaDoMesmoInsumo`), TODO card saía com │
 * │ "não apurado" — com o custo apurado, citado e inútil.                    │
 * │                                                                          │
 * │ O `custo_dos_produtos` é da onda 2: ele recebe o digest e procura o custo│
 * │ DAQUELES produtos. É a razão de a onda 2 existir, e é por isso que ele   │
 * │ ganha do outro quando os dois acham o mesmo insumo (ver `fundirCustos`). │
 * │ Os dois continuam valendo: um roster antigo, sem a onda 2, cai no        │
 * │ `margem` e funciona como sempre funcionou.                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
const CHAVES_DE_CUSTO = ['custo_dos_produtos', 'margem'] as const;
/**
 * Quem caça FOTO de propósito — a "Galeria de referências" do dossiê.
 *
 * O bloco conhece a chave por um motivo só: a fila de fotos é priorizada e este
 * especialista precisa de cota própria. Sem ela, as páginas que ele trouxe
 * entrariam no fim da fila do ranking de anúncios e a galeria — que é a seção
 * onde "mais imagens" foi pedido literalmente — nasceria vazia num run em que
 * o ranking veio cheio.
 */
const CHAVE_REFERENCIAS = 'referencias_visuais';
/**
 * Teto ABSOLUTO de páginas abertas por run.
 *
 * 36 porque agora são três seções disputando foto: "Comece por estes produtos"
 * (até 12 cards), a "Galeria de referências" (grade grande — "mais imagens" foi
 * pedido literal) e o ranking de anúncios, que antes tinha o teto inteiro para
 * si. Era 18, calibrado quando existiam duas.
 *
 * Este é o teto de CIMA. O de baixo, que é o que costuma valer, sai do relógio
 * — ver `tetoDeFotos`.
 */
const TETO_FOTOS = 36;
/**
 * Quantas páginas cabem numa leva e quanto uma leva custa de relógio.
 *
 * `buscarOgImagens` roda com concorrência 6 e timeout de 6 s por página: uma
 * leva é, no pior caso, 6 s para 6 páginas. Os dois números moram em
 * `og-image.ts` e estão repetidos aqui porque é aqui que se decide QUANTAS
 * páginas pedir — um teto que não conhece o custo de cada leva é um teto que
 * estoura o deadline por enfeite.
 */
const FOTOS_POR_LEVA = 6;
const MS_POR_LEVA_DE_FOTOS = 6_000;
/**
 * Folga que fica de pé DEPOIS das fotos: gravar o cache e devolver o dossiê.
 *
 * Uma leva inteira, para o caso de a última demorar o timeout completo.
 */
const MS_FOLGA_APOS_FOTOS = MS_POR_LEVA_DE_FOTOS;
/**
 * O SEGUNDO custo de relógio da foto: conferir o ARQUIVO de cada uma.
 *
 * Desde que status 200 deixou de valer como prova de imagem (ver
 * `MD5_PLACEHOLDER` em `og-image.ts`), o bloco baixa o começo de cada foto antes
 * de deixá-la virar ladrilho. `conferirFotos` roda com concorrência 12 e timeout
 * de 4 s — uma leva de conferência é, no pior caso, 4 s para 12 fotos.
 *
 * É UM lote no fim, e não 4 s somados dentro de cada leva de páginas, justamente
 * por causa da conta de `tetoDeFotos`: somar por página faria a leva custar 10 s
 * em vez de 6 e cortaria o teto do Rápido pela metade — para conferir fotos que
 * o Rápido quase não tem (4 no run frio medido).
 */
const FOTOS_POR_LEVA_DE_CONFERENCIA = 12;
const MS_POR_LEVA_DE_CONFERENCIA = 4_000;

/**
 * Quantas páginas de foto cabem no relógio que sobrou.
 *
 * ┌─ POR QUE O TETO PASSOU A SAIR DO RELÓGIO ───────────────────────────────┐
 * │ O teto sempre FOI de tempo: 18 páginas eram exatamente as três levas que │
 * │ a reserva fixa de 20 s comportava. Só que o número estava chumbado, e    │
 * │ chumbado com o relógio do RÁPIDO. Subir o teto para 36 por causa da      │
 * │ galeria do Profundo (deadline de 300 s) levaria junto uma reserva de     │
 * │ 40 s no Rápido — que tem 95 s de deadline e ~70 s já gastos quando       │
 * │ chega aqui. O Rápido passaria a pular as fotos em TODO run, com o aviso  │
 * │ "não deu tempo" — mexer no modo que o dono do produto aprovou, para     │
 * │ entregar uma seção que nem existe nele.                                  │
 * │                                                                          │
 * │ Derivando do relógio, os dois ficam certos sem número mágico: com os     │
 * │ ~25 s que sobram no Rápido dá exatamente as 3 levas (18 páginas) de      │
 * │ antes; com os ~120 s que sobram no Profundo dá o teto de cima.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Pura e exportada: é a regra que a regressão quebra e ela não depende de rede.
 */
export function tetoDeFotos(msRestantes: number): number {
	/**
	 * O relógio de N fotos: as levas de PÁGINA mais as levas de CONFERÊNCIA.
	 *
	 * Reservar o pior caso da conferência (12 s, que é o que 36 fotos custam)
	 * como uma constante seria cobrar do Rápido o custo do Profundo: com 25 s
	 * de sobra ele cairia de 18 para 6 fotos, pagando por uma conferência de
	 * 36 que ele nunca vai fazer. Como as duas contas dependem do MESMO N, a
	 * resposta é procurar o maior N que cabe.
	 */
	const custoMs = (n: number) =>
		Math.ceil(n / FOTOS_POR_LEVA) * MS_POR_LEVA_DE_FOTOS +
		Math.ceil(n / FOTOS_POR_LEVA_DE_CONFERENCIA) * MS_POR_LEVA_DE_CONFERENCIA;

	const cabe = msRestantes - MS_FOLGA_APOS_FOTOS;
	let teto = 0;
	for (let n = FOTOS_POR_LEVA; n <= TETO_FOTOS; n += FOTOS_POR_LEVA) {
		if (custoMs(n) > cabe) break;
		teto = n;
	}
	return teto;
}

/**
 * Quantas páginas a seção "Comece por estes produtos" pode tomar.
 *
 * A fila é priorizada (o card sem foto na primeira seção parece ferramenta
 * quebrada), mas prioridade sem teto vira fome do resto: `normalizarProdutos`
 * deixa passar até 12 produtos, e 12 na frente deixariam seis vagas para o
 * ranking de anúncios. Com 5 — o número que o papel do Curador pede ("de 3 a 5
 * produtos"), ou seja, a lista inteira no caso normal — o resto continua tendo
 * o grosso do teto.
 */
const TETO_FOTOS_CURADORIA = 5;
/**
 * Quantas páginas a "Galeria de referências" pode tomar.
 *
 * Um TERÇO do teto vigente, não um número fixo, e a diferença aparece no
 * Rápido: lá o teto é 18 e não existe galeria nenhuma (o especialista é da onda
 * 2, que só existe no Profundo), então uma cota fixa de 12 seria uma reserva
 * para ninguém. Um terço de 36 dá as 12 imagens que a grade quer no Profundo e
 * some sozinho quando não há o que mostrar.
 */
function tetoFotosReferencias(teto: number): number {
	return Math.floor(teto / 3);
}
/**
 * Quantas páginas a AMOSTRA DE PREÇO pode tomar.
 *
 * Metade do teto vigente — 18 no Profundo, 9 no Rápido. A conta fecha em
 * `AMOSTRA_BOA` (`price-stats.ts`): a confiança satura em 8 anúncios, então
 * mesmo a cota do Rápido já entrega a faixa mais sólida que a estatística sabe
 * dar. Passar disso seria tomar vaga da galeria para melhorar um número que não
 * melhora mais.
 */
function tetoPaginasDePreco(teto: number): number {
	return Math.ceil(teto / 2);
}
/**
 * O TAMANHO DO MATERIAL QUE UMA ONDA ENTREGA À SEGUINTE, em caracteres.
 *
 * São dois números porque são duas contas diferentes, e as duas custam dinheiro
 * de verdade (~4 caracteres por token, e o material entra como ENTRADA em cada
 * chamada da onda que o recebe):
 *
 *   ONDA 2 lê a onda 1 (7 a 8 especialistas) e são DEZ chamadas de modelo
 *     barato: 20 mil caracteres = 5 mil tokens × 10 = US$ 0,013 no total. Cada
 *     especialista da descoberta cabe em ~2,5 mil caracteres, que é o bastante
 *     para nomear produto, concorrente e faixa de preço — que é tudo o que a
 *     onda 2 precisa saber para ir pesquisar em cima.
 *
 *   ONDA 3 lê as ondas 1 e 2 (17 a 18 especialistas) e são CINCO chamadas, duas
 *     delas em Sonnet (US$ 2/M na entrada): 28 mil caracteres = 7 mil tokens,
 *     US$ 0,014 por chamada Sonnet. Quem escreve o dossiê precisa do material
 *     inteiro; o teto é o que separa "material inteiro" de "margem de 75%".
 *
 * Ver `montarDigest`: o teto é REPARTIDO entre os especialistas, não cortado no
 * fim — cortar no fim apagava a onda 2 inteira do que a síntese lia.
 */
export const TETO_DIGEST_ONDA2 = 20_000;
export const TETO_DIGEST_ONDA3 = 28_000;
/** Usado quando o digest não é insumo de ninguém (a saída `digest` do bloco). */
const TETO_DIGEST_CHARS = TETO_DIGEST_ONDA3;
/**
 * Teto de segurança do material dentro de `rodarAgente`.
 *
 * Quem monta o material já reparte dentro do teto da onda; este aqui é o cinto
 * para o caso de alguém chamar `rodarAgente` com um texto solto. Fica ACIMA do
 * maior teto de onda de propósito: se ele mordesse antes, voltaria a existir um
 * corte cego no fim — que é exatamente o defeito que `montarDigest` conserta.
 */
const MAX_CHARS_MATERIAL = 40_000;
/** Validade do retrato de mercado. Depois disso, pesquisa de novo. */
const TTL_DIAS = 7;
/** Bump aqui invalida todo o cache de uma vez (mexeu nos prompts). */
const VERSAO_PROMPT = 1;

const schema = z.object({
	tool: z.string().min(1).max(60),
	agentes_collection: z.string().min(1).max(40).default('agentes'),
	pesquisas_collection: z.string().min(1).max(40).default('pesquisas'),
	modo: z.enum(['rapido', 'profundo']).default('rapido'),
	/**
	 * `produto` = "tenho esta peça, vale a pena?".
	 * `mercado` = "quero vender neste ramo, o que faço e onde?".
	 * São perguntas diferentes e chamam especialistas diferentes.
	 */
	escopo: z.enum(['produto', 'mercado']).default('produto'),
	/** JSON com `{produto, categoria, categoria_slug, material, uf, ...}`. */
	vars: z.string().default('{}'),
	/** Palavras-chave da categoria, para descartar resultado fora do tema. */
	palavras_chave: z.string().default(''),
	/**
	 * A lista de categorias (saída de um `collection.query`), em JSON.
	 *
	 * O bloco acha aqui as `palavras_chave` da categoria escolhida. Precisa vir
	 * pronta porque o resolvedor do motor é RASO: não há como o pipeline fazer
	 * "pegue o item cujo slug é o que a visão escolheu" numa referência.
	 *
	 * Aceita ARRAY (o que `collection.query` devolve em `json`) ou a string JSON
	 * equivalente — o motor entrega o valor já RESOLVIDO, então na prática chega
	 * array. Exigir string aqui derrubou o primeiro run com 400.
	 */
	categorias: z.unknown().optional(),
	/**
	 * A MARCA DO ALUNO (saída de um `collection.query` em `perfil/marca`),
	 * para o especialista que escreve PARA ELE.
	 *
	 * Mesma tolerância de forma de `categorias`: chega array quando o motor já
	 * resolveu, string JSON quando não. Ausente = time sem marca, que é um
	 * caminho de primeira classe (ver `lib/marca.ts`).
	 *
	 * QUEM RECEBE A MARCA é decidido no ROSTER, não aqui: só o especialista que
	 * escrever `{marca}` na `pergunta` dela enxerga. Duas regras pegam junto, e
	 * as duas são conferidas pelo seed (`conferirMarca`, scripts/seed-agentes.ts):
	 *  • quem recebe a marca TEM que ser `compartilhavel:false` — o cache de 7
	 *    dias é compartilhado entre alunos, e a resposta temperada pela
	 *    identidade de um serviria à pesquisa do outro;
	 *  • quem recebe a marca TEM que ser `motor_busca:'nenhum'` — a `pergunta`
	 *    é o que vira consulta de busca, e identidade de empresa dentro de uma
	 *    consulta é ruído pago.
	 */
	marca: z.unknown().optional(),
	// O teto subiu de 8 para 12 junto com as ondas: a onda 2 do Profundo tem 10
	// especialistas, e um máximo de 8 impediria até de pedir a leva única que o
	// padrão já usa.
	concorrencia: z.coerce
		.number()
		.int()
		.min(1)
		.max(12)
		.default(CONCORRENCIA_PADRAO),
	ttl_dias: z.coerce.number().int().min(0).max(90).default(TTL_DIAS),
	/** Botão "atualizar agora": ignora o cache e paga a pesquisa de novo. */
	forcar: z.coerce.boolean().default(false),
});

type Params = z.infer<typeof schema>;

interface ResultadoAgente {
	chave: string;
	nome: string;
	icone: string;
	cor: string;
	ok: boolean;
	ms: number;
	modelo?: string;
	json?: unknown;
	texto?: string;
	fontes: Citation[];
	erro?: string;
	compartilhavel: boolean;
	/**
	 * O PAPEL dele é pesquisar? (`motor_busca` da coleção, não o que sobrou do
	 * orçamento.)
	 *
	 * Serve a uma decisão só, e ela vale dinheiro: o que entra no cache de 7
	 * dias. Pesquisador que voltou com ZERO citações escreveu de memória — e
	 * memória de LLM sobre preço de insumo é a alucinação medida ("Chapa de MDF
	 * Cru 3mm — R$ 79,90 — Leo Madeiras" com URL fabricada, 2 de 2). Consultor
	 * (`motor_busca: 'nenhum'` por desenho, como o Analista de Riscos) não deve
	 * nada a ninguém: o conhecimento técnico dele é o produto, e sem esta
	 * distinção ele sairia do cache junto.
	 */
	pesquisador: boolean;
}

/** Import dinâmico: o repositório valida env no topo do módulo. */
async function loadDeps() {
	const [
		{ loadPublishedToolDefinition },
		{ resolveCollection },
		{ toolCollectionRepository },
	] = await Promise.all([
		import('../../lib/tool-definitions.js'),
		import('../../lib/tool-collections.js'),
		import('../../repositories/tool-collection.js'),
	]);
	return {
		loadPublishedToolDefinition,
		resolveCollection,
		toolCollectionRepository,
	};
}

/** Aceita array já resolvido pelo motor OU a string JSON equivalente. */
function normalizarLista(v: unknown): unknown[] {
	if (Array.isArray(v)) return v;
	if (typeof v === 'string' && v.trim()) {
		try {
			const p = JSON.parse(v);
			return Array.isArray(p) ? p : [];
		} catch {
			return [];
		}
	}
	return [];
}

function parseVars(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Colhe CANDIDATAS a preço das CITAÇÕES, não do texto do modelo.
 *
 * É a diferença entre "o modelo disse que custa R$ 80" e "esta página, neste
 * link, mostra R$ 80". Cada observação nasce amarrada à URL que a sustenta —
 * o que torna impossível um preço sem fonte chegar ao dossiê, por construção e
 * não por instrução de prompt.
 *
 * ┌─ CANDIDATA, E NÃO OBSERVAÇÃO — a diferença custou a credibilidade da       ┐
 * │ seção de preço em 5 runs de 9.                                            │
 * │                                                                            │
 * │ "O número saiu daquela página" era verdade e não bastava: a página não era │
 * │ o que a tela dizia que era. `yav.com.br/comissoes-marketplace/` cedeu      │
 * │ R$ 79 (o DEGRAU da comissão da Shopee), um artigo de contabilidade cedeu   │
 * │ R$ 100 ("quando você vende por R$ 100…", exemplo hipotético) e um vídeo do │
 * │ YouTube cedeu R$ 20 (frete para o Centro-Oeste). Os três entraram como     │
 * │ "anúncio com preço e link", e a tela cravou mediana R$ 36,50 com selo de   │
 * │ confiável em cima de 12 páginas onde não havia UM anúncio.                 │
 * │                                                                            │
 * │ Aqui cai o que se denuncia pelo ENDEREÇO — é a peneira barata, e ela       │
 * │ existe para não gastar relógio abrindo blog. Quem decide de verdade é      │
 * │ `analisarCabeca`, abrindo a página: ver o portão do preço em `og-image.ts`.│
 * └────────────────────────────────────────────────────────────────────────────┘
 */
function colherPrecos(fontes: Citation[], agente: string): PriceObservation[] {
	const out: PriceObservation[] = [];
	for (const f of fontes) {
		/**
		 * Duas peneiras baratas, e a segunda não é sobre segurança.
		 *
		 * `ehPaginaDeAnuncio` derruba o endereço que se denuncia (blog, listagem,
		 * data no caminho). `hostPermitido` entra porque uma página que a gente
		 * não tem permissão de ABRIR nunca vai conseguir provar que é um anúncio
		 * — carregá-la até a fila só tomaria vaga de quem pode. É o que acontecia
		 * com as transcrições do YouTube (host fora da vitrine, `/watch` no
		 * caminho): entravam na fila e morriam na allowlist, uma vaga por vídeo.
		 *
		 * O preço disso está medido e é aceito: loja brasileira legítima fora de
		 * `.com.br` (`caicobrindes.net.br`, `estampai.com`) sai da amostra junto.
		 * Ela já saía — sem abrir a página não há prova — e alargar a allowlist é
		 * decisão de segurança, não de estatística.
		 */
		if (!ehPaginaDeAnuncio(f.url) || !hostPermitido(f.url)) continue;
		const alvo = `${f.title ?? ''} ${f.content ?? ''}`;
		// Um por fonte: uma página de marketplace lista dezenas de preços de
		// produtos vizinhos, e contar todos inflaria a amostra com o catálogo
		// inteiro do site. A mediana da própria página é o preço dela.
		const precos = extrairPrecos(alvo);
		if (precos.length === 0) continue;
		const ordenado = [...precos].sort((a, b) => a - b);
		const meio = ordenado[Math.floor(ordenado.length / 2)] as number;
		out.push({ brlCents: meio, url: f.url, title: f.title, agente });
	}
	return out;
}

/** Qualquer coisa que tenha link e queira uma foto: observação ou produto do radar. */
interface AlvoFoto {
	url?: unknown;
	imagem_url?: unknown;
}

/**
 * A fila de páginas a abrir: PRIORIDADE COM COTA, quatro faixas.
 *
 * Prioridade sem cota vira fome do resto — foi o defeito relatado quando havia
 * duas faixas: a seção "Comece por estes produtos" entrou na frente e, com até
 * 12 produtos (`MAX_PRODUTOS`), sobravam seis das dezoito vagas para o ranking
 * de anúncios. A galeria de referências entra pelo mesmo motivo e com o mesmo
 * cuidado: cota própria (senão nasce vazia quando o ranking vem cheio) e cota
 * LIMITADA (senão come o ranking inteiro).
 *
 * ┌─ O PREÇO VEM PRIMEIRO, E NÃO POR IMPORTÂNCIA GENÉRICA ───────────────────┐
 * │ Nas outras três faixas a página que não abre custa um ladrilho sem foto.  │
 * │ Nesta, a página que não abre APAGA UM NÚMERO: desde que "é anúncio" passou│
 * │ a ser provado abrindo a página (ver `colherPrecos`), candidata não        │
 * │ inspecionada não entra na amostra. Deixá-la no fim da fila seria pôr a    │
 * │ faixa de preço do dossiê para depender de quantas fotos de enfeite        │
 * │ couberam no relógio.                                                      │
 * │                                                                           │
 * │ Com cota assim mesmo, e por conta que fecha: a confiança satura em        │
 * │ `AMOSTRA_BOA` = 8 anúncios (`price-stats.ts`), então metade do teto —     │
 * │ 18 no Profundo, 9 no Rápido — já entrega a faixa mais sólida que a        │
 * │ estatística sabe dar. O que passasse disso seria tomar vaga da galeria    │
 * │ para melhorar um número que não melhora mais.                             │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O `teto` vem de fora porque ele é de RELÓGIO (`tetoDeFotos`), não de gosto —
 * e é o mesmo motivo de as cotas do preço e da galeria serem proporcionais a
 * ele.
 *
 * Exportada porque é a regra que a regressão quebra, e ela não depende de rede.
 */
export function filaDePaginas(
	precos: string[],
	curadoria: string[],
	referencias: string[],
	resto: string[],
	teto: number,
): string[] {
	const doPreco = [...new Set(precos)].slice(0, tetoPaginasDePreco(teto));
	const daFrente = [...new Set(curadoria)]
		.filter((u) => !doPreco.includes(u))
		.slice(0, TETO_FOTOS_CURADORIA);
	const daGaleria = [...new Set(referencias)]
		.filter((u) => !doPreco.includes(u) && !daFrente.includes(u))
		.slice(0, tetoFotosReferencias(teto));
	const doResto = [...new Set(resto)].filter(
		(u) =>
			!doPreco.includes(u) && !daFrente.includes(u) && !daGaleria.includes(u),
	);
	return [...doPreco, ...daFrente, ...daGaleria, ...doResto].slice(
		0,
		Math.max(0, teto),
	);
}

/**
 * Onde um JSON de especialista guarda a PÁGINA de um item.
 *
 * A lista existe porque o `saida` de cada especialista é DADO editável pela
 * tela: o Radar chama de `url`, quem cataloga referência visual chama de
 * `pagina_url`, quem lista o portfólio do concorrente chama de `url_anuncio`.
 * Chumbar um nome só significaria que a seção do vizinho nasce sem foto e
 * ninguém descobre por quê — o campo simplesmente não é lido.
 */
const CAMPOS_DE_PAGINA = [
	'url',
	'pagina_url',
	'url_pagina',
	'url_anuncio',
	'url_exemplo',
	'link',
];

/**
 * Os itens de um JSON de especialista que querem foto.
 *
 * Varre as LISTAS do JSON até dois níveis (o portfólio de um concorrente é
 * `concorrentes[].produtos[]`) e devolve, para cada item com página, um alvo
 * que LÊ a página de onde quer que ela esteja e ESCREVE a foto sempre em
 * `imagem_url` — que é o campo único que a tela consulta.
 *
 * Substituiu a lista chumbada `anuncios`/`produtos`: com 22 especialistas e
 * `saida` editável por tela, enumerar nome de campo é combinar de esquecer.
 */
/**
 * O "+5.000 VENDIDOS" TEM QUE ESTAR NA PÁGINA — senão vira `null`.
 *
 * Era o último número da tela sem prova. A trava anterior exigia que a PÁGINA
 * estivesse citada, e isso continua valendo — mas ter a página certa não prova
 * o número que está nela: `vendidos` seguia sendo texto escrito pelo modelo,
 * exibido em corpo grande ao lado de um link real, que é a combinação que faz
 * um palpite parecer apurado.
 *
 * A conferência é possível porque a citação carrega o TRECHO da página
 * (`Citation.content`) — é do mesmo lugar que sai o preço em `colherPrecos`.
 * Se os dígitos do número não aparecem no trecho daquela página, o número não
 * sobrevive. Comparo só os DÍGITOS porque a página escreve "+5.000 vendidos",
 * "5 mil vendidos" e "5000" para a mesma coisa, e o modelo normaliza para
 * `5000` — exigir a string idêntica reprovaria número verdadeiro.
 *
 * Some o número, não o item: saber que o produto existe continua valendo; o que
 * não vale é dizer quantos venderam sem ter lido.
 */
export function soVendidosNaPagina(json: unknown, fontes: Citation[]): number {
	const trechoPor = new Map<string, string>();
	for (const f of fontes) {
		if (f?.url) trechoPor.set(chaveUrl(f.url), `${f.content ?? ''}`);
	}
	let apagados = 0;
	for (const item of objetosDe(json)) {
		for (const campo of ['vendidos', 'unidades_vendidas', 'avaliacoes']) {
			const bruto = item[campo];
			if (bruto === null || bruto === undefined || bruto === '') continue;
			const digitos = String(bruto).replace(/\D/g, '');
			const url = typeof item.url === 'string' ? item.url : '';
			const trecho = url ? trechoPor.get(chaveUrl(url)) : undefined;
			// Sem dígito não há o que conferir (ex.: "muitos"); sem página, nada
			// sustenta. Os dois casos caem fora pelo mesmo motivo.
			if (digitos && trecho?.replace(/\D/g, '').includes(digitos)) continue;
			item[campo] = null;
			apagados++;
		}
	}
	return apagados;
}

/**
 * CAÇA A FOTO DOS PRODUTOS ESCOLHIDOS — a busca é NOSSA, o link tem que estar
 * nas citações dela, e a foto sai da página.
 *
 * ┌─ POR QUE ISTO PRECISOU EXISTIR ──────────────────────────────────────────┐
 * │ "Comece por estes produtos" é a seção que o dono do produto abre primeiro │
 * │ e ela saía com todos os cartões sem foto. Três motivos, todos medidos:    │
 * │                                                                          │
 * │ 1. O Curador NÃO pesquisa — ele escolhe entre o que os outros trouxeram,  │
 * │    então quase nunca tem página própria de onde tirar `og:image`.         │
 * │ 2. A herança por nome só salva quando o produto escolhido é um dos que o  │
 * │    Radar abriu, e num ramo amplo o Radar volta com `url: ''` (o vazio     │
 * │    honesto) porque a busca só alcança página de listagem.                 │
 * │ 3. O Curador de Imagens roda na ONDA 2 e a curadoria na 3 — quando ele    │
 * │    procura, os produtos ainda não foram escolhidos.                       │
 * │                                                                          │
 * │ Pedir a foto ao modelo foi o que já se provou desastre: 0 de 6 URLs eram  │
 * │ reais e 4 devolviam o GIF cinza de "imagem indisponível" com HTTP 200.    │
 * │                                                                          │
 * │ Aqui a busca é feita por NÓS, com os nomes que o Curador escolheu, e o    │
 * │ único link aceito é o que aparece nas CITAÇÕES dessa busca — o modelo não │
 * │ tem como escrever endereço, só como apontar para um que o buscador achou. │
 * │                                                                          │
 * │ Procura LOJA, não marketplace, e isso é medição: página de produto do     │
 * │ Mercado Livre responde 302 para verificação de conta e a da Shopee vem    │
 * │ sem nenhuma metatag `og:` (monta no navegador). As 31 fotos boas dos runs │
 * │ gravados vieram todas de loja brasileira (awsli, tcdn, nuvemshop,         │
 * │ irroba, shopify).                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function cacarFotoDosProdutos(
	produtos: { nome: string; imagem_url: string; url_exemplo: string }[],
	modelo: TextModelEntry,
	budget: Budget,
	ctx: BlockRunContext,
): Promise<number> {
	const semFoto = produtos.filter((p) => !p.imagem_url && p.nome).slice(0, 6);
	if (semFoto.length === 0) return 0;
	if (!budget.podeBuscar(1) || !budget.cabeNoTempo(45, 900)) {
		budget.diagnosticar(
			`caça-foto pulada: ${budget.podeBuscar(1) ? 'sem relógio' : 'sem vaga de busca'}`,
		);
		return 0;
	}

	const lista = semFoto.map((p, i) => `${i + 1}. ${p.nome}`).join('\n');
	budget.reservar(1);
	let r: Awaited<ReturnType<typeof chamarComBusca>>;
	try {
		ctx.onProgress?.({
			kind: 'busca',
			chave: 'fotos',
			query: `foto de ${semFoto[0]?.nome ?? ''} e mais ${semFoto.length - 1}`,
			motor: 'perplexity',
		});
		r = await chamarComBusca({
			model: modelo,
			system:
				'Você acha a PÁGINA DE VENDA de um produto em loja brasileira. ' +
				'Prefira loja própria (Nuvemshop, Loja Integrada, Tray, Shopify, Wix) a marketplace: página de produto do Mercado Livre e da Shopee não abre para quem não é navegador. ' +
				'Devolva SÓ o endereço que apareceu no resultado da busca. Se para algum item você não achou página de produto, devolva `url` vazia — endereço montado por você não serve para nada aqui.',
			user: `Ache a página de venda de cada um destes produtos em loja brasileira:\n${lista}\n\nResponda JSON: {"itens":[{"n":1,"url":""}]}`,
			engine: 'perplexity',
			maxResults: 10,
			/**
			 * MARKETPLACE FORA — e isto é medição, não preferência.
			 *
			 * Página de produto do Mercado Livre responde 302 para verificação de
			 * conta e a da Shopee vem com ZERO metatag `og:` (monta no navegador).
			 * Enquanto elas ocupam os 10 resultados, a busca "acha" e nós não
			 * conseguimos foto nenhuma: medido, 3 páginas abertas e 0 com foto.
			 * As 31 fotos boas dos runs gravados vieram todas de loja brasileira.
			 */
			excludeDomains: [
				'mercadolivre.com.br',
				'shopee.com.br',
				'amazon.com.br',
				'magazineluiza.com.br',
				'americanas.com.br',
				'aliexpress.com',
			],
			temperature: 0,
			maxTokens: 700,
			json: true,
			signal: ctx.signal ?? AbortSignal.timeout(45_000),
		});
	} catch {
		return 0;
	} finally {
		budget.liberar(1);
	}
	// Resposta fora do formato (ou dublada em teste) não pode derrubar um run que
	// já entregou: a foto é enfeite do dossiê, não o dossiê.
	if (!r || typeof r !== 'object' || !Array.isArray(r.citations)) return 0;
	budget.registrar(r.buscas ?? 0, r.custoUsd ?? 0);

	const citadas = conjuntoDeUrls(r.citations.map((c) => c.url));
	const escolhas = extractJson(r.text) as { itens?: unknown } | undefined;
	const porIndice = new Map<number, string>();
	const itens = Array.isArray(escolhas?.itens) ? escolhas.itens : [];
	for (const it of itens) {
		if (!it || typeof it !== 'object') continue;
		const o = it as Record<string, unknown>;
		const n = Number(o.n);
		const u = typeof o.url === 'string' ? o.url : '';
		// Só sobrevive endereço que o BUSCADOR trouxe. É a mesma trava do resto do
		// run, e aqui ela é o único motivo de esta busca ser confiável.
		if (Number.isFinite(n) && u && citadas.has(chaveUrl(u)))
			porIndice.set(n, u);
	}
	/**
	 * O QUE O BUSCADOR ACHOU VALE MESMO SEM O MODELO APONTAR.
	 *
	 * Medido: a busca voltou com 10 páginas de loja e o modelo mapeou UMA — os
	 * outros três produtos ficaram sem foto tendo página disponível. O mapa dele
	 * é conveniência, não a fonte: quem lista as páginas é o buscador.
	 *
	 * Aqui cada produto ainda sem par procura a citação cujo TÍTULO fala dele.
	 * O casamento pede duas palavras de conteúdo em comum — uma só ("porta",
	 * "personalizado") casaria qualquer coisa com qualquer coisa.
	 */
	const usadas = new Set(porIndice.values());
	for (const [i, p] of semFoto.entries()) {
		if (porIndice.has(i + 1)) continue;
		const palavras = new Set(
			chaveDeNome(p.nome)
				.split(' ')
				.filter((w) => w.length >= 4),
		);
		if (palavras.size === 0) continue;
		let melhor: { url: string; n: number } | null = null;
		for (const c of r.citations) {
			if (!c.url || usadas.has(c.url)) continue;
			const doTitulo = new Set(chaveDeNome(c.title ?? '').split(' '));
			let n = 0;
			for (const w of palavras) if (doTitulo.has(w)) n++;
			if (n >= 2 && (!melhor || n > melhor.n)) melhor = { url: c.url, n };
		}
		if (melhor) {
			porIndice.set(i + 1, melhor.url);
			usadas.add(melhor.url);
		}
	}

	if (porIndice.size === 0) {
		budget.diagnosticar(
			`caça-foto: ${r.citations.length} citações, nenhuma casou com os produtos`,
		);
		return 0;
	}

	const paginas = [...porIndice.values()];
	const inspecao = await inspecionarPaginas(paginas, ctx.signal);
	const fotos = new Map<string, string>();
	for (const [u, i] of inspecao) if (i.foto) fotos.set(u, i.foto);
	const aprovadas = await conferirFotos([...fotos.values()], ctx.signal);

	let n = 0;
	for (const [i, p] of semFoto.entries()) {
		const pagina = porIndice.get(i + 1);
		if (!pagina) continue;
		const foto = fotos.get(pagina);
		if (!foto || !aprovadas.has(foto)) continue;
		p.imagem_url = foto;
		if (!p.url_exemplo) p.url_exemplo = pagina;
		n++;
	}
	if (n === 0) {
		budget.diagnosticar(
			`caça-foto: ${paginas.length} página(s) abertas, ${fotos.size} com og:image, ${aprovadas.size} aprovadas nos bytes — ${paginas.map((u) => new URL(u).hostname).join(', ')}`,
		);
	}
	if (n > 0) ctx.onProgress?.({ kind: 'fotos', n });
	return n;
}

/**
 * Os OBJETOS de item de um json de especialista, crus.
 *
 * Mesma regra de descida de `alvosDeFoto` (só por lista, para não entrar em
 * `price_stats` e afins), mas devolve o objeto em vez de um alvo de foto —
 * quem precisa é a herança de foto, que casa item por NOME e não por URL.
 */
export function objetosDe(
	json: unknown,
	profundidade = 2,
): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	const visitar = (v: unknown, nivel: number) => {
		if (!v || typeof v !== 'object' || nivel < 0) return;
		if (Array.isArray(v)) {
			for (const item of v) visitar(item, nivel);
			return;
		}
		const o = v as Record<string, unknown>;
		out.push(o);
		for (const valor of Object.values(o)) {
			if (Array.isArray(valor)) visitar(valor, nivel - 1);
		}
	};
	visitar(json, profundidade);
	return out;
}

export function alvosDeFoto(json: unknown, profundidade = 2): AlvoFoto[] {
	const out: AlvoFoto[] = [];
	const visitar = (v: unknown, nivel: number) => {
		if (!v || typeof v !== 'object' || nivel < 0) return;
		if (Array.isArray(v)) {
			for (const item of v) visitar(item, nivel);
			return;
		}
		const o = v as Record<string, unknown>;
		const campo = CAMPOS_DE_PAGINA.find(
			(c) => typeof o[c] === 'string' && /^https?:\/\//i.test(o[c] as string),
		);
		if (campo) {
			out.push({
				get url() {
					return o[campo];
				},
				get imagem_url() {
					return o.imagem_url;
				},
				set imagem_url(foto: unknown) {
					o.imagem_url = foto;
				},
			});
		}
		// Só desce por LISTA: descer por objeto solto entraria em `price_stats` e
		// afins sem nunca achar item de catálogo.
		for (const valor of Object.values(o)) {
			if (Array.isArray(valor)) visitar(valor, nivel - 1);
		}
	};
	visitar(json, profundidade);
	return out;
}

/**
 * APAGA TODA `imagem_url` QUE O MODELO ESCREVEU. No lugar, muta o próprio JSON.
 *
 * ┌─ FOTO NÃO É OPINIÃO: OU A PÁGINA SERVIU, OU NÃO EXISTE ──────────────────┐
 * │ `og-image.ts` abre dizendo que pedir `imagem_url` ao especialista volta   │
 * │ 0 de 8, e o motivo é estrutural: a busca entrega o TEXTO da página, e a   │
 * │ URL da foto não está no texto. O que o modelo escreve nesse campo é,      │
 * │ portanto, sempre invenção — plausível, e por isso pior.                   │
 * │                                                                           │
 * │ MEDIDO nos 9 runs gravados. As 4 `imagem_url` de Mercado Livre da         │
 * │ `referencias_visuais` de um run apontavam para o MESMO arquivo: o GIF     │
 * │ "imagem indisponível" do próprio ML (8.456 B, 500×500), servido por       │
 * │ redirect. As 2 da Shopee davam 404. Os ids denunciavam a fabricação       │
 * │ (`MLB75432109876`, 13 dígitos). E no run em que a PÁGINA era real e       │
 * │ citada, a `og:image` verdadeira estava a um fetch de distância e não foi  │
 * │ buscada — porque o campo já estava "preenchido" com lixo.                 │
 * │                                                                           │
 * │ POR QUE AQUI, e não no filtro de `abrirPaginas`: o campo é lido em quatro │
 * │ lugares (a grade da galeria, o ranking do radar, o portfólio do           │
 * │ concorrente, a observação de preço) e escrito num quinto (o cache de 7    │
 * │ dias). Fechar porta a porta foi o que a rodada passada tentou — sobraram  │
 * │ duas abertas e foi por elas que os 404 chegaram à tela. Limpando na       │
 * │ ENTRADA, o campo passa a ter um único significado no resto do arquivo:    │
 * │ "foto que nós buscamos".                                                  │
 * │                                                                           │
 * │ O roster também deixou de pedir a foto (`scripts/seed-agentes.ts`), que é │
 * │ o conserto na origem. Este aqui é o mecanismo: a coleção `agentes` é      │
 * │ editável por tela e sem deploy, então a garantia não pode morar lá.       │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function semFotoDoModelo<T>(json: T): T {
	const visitar = (v: unknown) => {
		if (!v || typeof v !== 'object') return;
		if (Array.isArray(v)) {
			for (const item of v) visitar(item);
			return;
		}
		const o = v as Record<string, unknown>;
		if ('imagem_url' in o) delete o.imagem_url;
		for (const valor of Object.values(o)) visitar(valor);
	};
	visitar(json);
	return json;
}

/**
 * APAGA TODO ENDEREÇO QUE O RUN NÃO CITOU. Muta o próprio JSON, como a foto.
 *
 * ┌─ A FOTO ERA METADE: O MODELO INVENTA O ENDEREÇO TAMBÉM ──────────────────┐
 * │ `semFotoDoModelo` fechou o arquivo da imagem. O ENDEREÇO DA PÁGINA        │
 * │ continuava passando inteiro, e ele é a outra metade do mesmo cartão — a   │
 * │ seção se chama, na tela, "Anúncios reais que já estão no ar. Clique no    │
 * │ card para abrir".                                                         │
 * │                                                                          │
 * │ MEDIDO no último run frio de mercado: o Curador de Imagens recebeu 109    │
 * │ citações reais e escreveu SEIS páginas, das quais UMA existia. As outras  │
 * │ cinco eram id montado em sequência —                                      │
 * │ `shopee.com.br/…-i.34567890.1234567890`,                                  │
 * │ `…-i.987654321.0987654321`, `produto.mercadolivre.com.br/MLB-1234567890`, │
 * │ `MLB-987654321`. Elas passam por `ehPaginaDeAnuncio` e pela allowlist (a   │
 * │ FORMA está certa), abrem em 404, e o cartão vinha com uma descrição       │
 * │ detalhada da foto — "o ângulo, o acabamento, a peça em uso" — de uma       │
 * │ página que ninguém abriu.                                                 │
 * │                                                                          │
 * │ POR QUE UNIVERSAL, e não campo a campo: a lista de campos com link já foi │
 * │ tentada e é a mesma armadilha de `alvosDeFoto` — `url`, `pagina_url`,     │
 * │ `url_anuncio`, `url_exemplo`, `custo_fonte_url`, `perfil_url`… com 22     │
 * │ especialistas e `saida` editável pela tela, enumerar nome de campo é      │
 * │ combinar de esquecer. A regra do produto é uma só e vale para todos:      │
 * │ endereço que o run não citou não é endereço, é texto plausível.           │
 * │                                                                          │
 * │ CUSTO MEDIDO no escopo `produto`, que é o que hoje funciona: das 49       │
 * │ páginas de anúncio que os especialistas escreveram, 47 estavam citadas.   │
 * │ Some 2, e as 2 abriam em nada.                                            │
 * │                                                                          │
 * │ RESÍDUO CONHECIDO: o cache grava no máximo 80 fontes (`slice(0, 80)`), e  │
 * │ um run com mais citações que isso perde as últimas — um bloco servido do  │
 * │ cache pode ter o link apagado por truncagem, não por invenção. É o mesmo  │
 * │ resíduo que `normalizarProdutos` já carrega, e ele erra para o lado       │
 * │ seguro: some um link bom, nunca entra um inventado.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function semLinkInventado<T>(json: T, citadas: Set<string>): T {
	const visitar = (v: unknown) => {
		if (!v || typeof v !== 'object') return;
		if (Array.isArray(v)) {
			for (const item of v) visitar(item);
			return;
		}
		const o = v as Record<string, unknown>;
		for (const [k, valor] of Object.entries(o)) {
			if (typeof valor === 'string') {
				const u = valor.trim();
				if (/^https?:\/\//i.test(u) && !citadas.has(chaveUrl(u))) o[k] = '';
				continue;
			}
			visitar(valor);
		}
	};
	visitar(json);
	return json;
}

/**
 * O CARTÃO DA GALERIA SEM PÁGINA NÃO É UM CARTÃO — some a lista inteira dele.
 *
 * Nas outras seções, item sem link continua valendo: o Radar tem ordem de
 * deixar o endereço vazio quando só alcançou a listagem, e "Chaveiro de acrílico
 * está vendendo" é resposta mesmo sem link (é o que o papel dele manda fazer).
 * Aqui não: o item do Curador de Imagens é, inteiro, uma AFIRMAÇÃO SOBRE UMA
 * PÁGINA — `o_que_e` descreve a foto daquele anúncio. Sem a página, o que sobra
 * é a descrição de uma imagem que ninguém viu, que é o pior formato possível
 * para uma invenção: específica, plausível e sem como conferir.
 *
 * A seção ENCOLHE, e encolher é a resposta certa. O especialista continua com
 * lugar na tela — `observacao` é dele e sobrevive.
 */
export function soReferenciasComPagina<T>(json: T): T {
	const o = json as Record<string, unknown> | null;
	if (!o || typeof o !== 'object' || Array.isArray(o)) return json;
	for (const campo of ['referencias', 'imagens', 'fotos', 'itens']) {
		const lista = o[campo];
		if (!Array.isArray(lista)) continue;
		o[campo] = lista.filter((item) => {
			if (!item || typeof item !== 'object') return false;
			const r = item as Record<string, unknown>;
			return CAMPOS_DE_PAGINA.some(
				(c) => typeof r[c] === 'string' && /^https?:\/\//i.test(r[c] as string),
			);
		});
	}
	return json;
}

/**
 * ABRE AS PÁGINAS — a foto real de cada anúncio e a prova de que ele é anúncio.
 *
 * Pedir `imagem_url` ao especialista no prompt voltou 0 de 8: a busca entrega o
 * TEXTO da página e a URL da foto não está no texto. Aqui a foto vem de onde
 * ela de fato existe — a tag que o marketplace serve para o preview de
 * WhatsApp. Muta os alvos no lugar (as observações e o JSON do radar são as
 * mesmas referências que vão para a saída e para o cache).
 *
 * Devolve o que cada página respondeu, porque o CHAMADOR precisa da outra
 * metade: candidata a preço cuja página não provou ser anúncio não entra na
 * amostra (ver `colherPrecos`). Uma leitura de `<head>`, duas respostas.
 *
 * Nunca lança e nunca é essencial: sem tempo no orçamento, pula.
 */
async function abrirPaginas(
	/**
	 * As candidatas a preço. Primeira faixa: aqui a página que não abre apaga um
	 * NÚMERO, e não um ladrilho.
	 */
	precos: AlvoFoto[],
	/** Vão na frente das fotos (a seção "Comece por estes produtos"). */
	prioritarios: AlvoFoto[],
	/** A "Galeria de referências" — cota própria, proporcional ao teto. */
	referencias: AlvoFoto[],
	/** O resto: ranking de anúncios e produtos do radar. */
	resto: AlvoFoto[],
	/**
	 * As páginas que a busca REALMENTE citou nesta execução (`chaveUrl`).
	 *
	 * ┌─ ENDEREÇO NÃO CITADO É INVENÇÃO — e o modelo inventa o ENDEREÇO também ─┐
	 * │ Tirar a `imagem_url` do contrato foi necessário e não bastou. Medido no  │
	 * │ primeiro run frio depois daquela mudança: o Curador de Imagens voltou    │
	 * │ com 10 citações reais e escreveu SEIS páginas que não eram nenhuma       │
	 * │ delas — `shopee.com.br/…-i.34567890.1234567890` e três `MLB-4567890123`, │
	 * │ `MLB-5678901234`, `MLB-6789012345` em sequência. Elas passam por         │
	 * │ `ehPaginaDeAnuncio` e pela allowlist (a FORMA está certa), abrem em 404, │
	 * │ e a galeria continuava zerada — agora por invenção de endereço, não de   │
	 * │ foto.                                                                    │
	 * │                                                                          │
	 * │ O separador está medido e é limpo: das 31 páginas que entregaram foto de │
	 * │ produto nos runs gravados, 31 estavam entre as citações do run. Nenhuma  │
	 * │ das inventadas estava. Custo desta trava nos mesmos runs: ZERO fotos.    │
	 * │                                                                          │
	 * │ É a mesma regra que `oportunidade.ts` já aplica ao Curador de            │
	 * │ Oportunidades, e ela vale igual para quem PESQUISA: ter citação não faz  │
	 * │ do que ele digita uma citação.                                           │
	 * │                                                                          │
	 * │ O JSON dos especialistas JÁ CHEGA limpo (`semLinkInventado` roda antes,  │
	 * │ assim que o conjunto de citações fica pronto), então para eles esta       │
	 * │ conferência é cinto e suspensório. Ela continua fazendo trabalho de       │
	 * │ verdade em `alvosCuradoria`, que não sai de `agentes`: aqueles vêm de     │
	 * │ `produtos_para_comecar`, montados a partir do Curador de Oportunidades.   │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	urlsCitadas: Set<string>,
	budget: Budget,
	ctx: BlockRunContext,
): Promise<Map<string, InspecaoPagina>> {
	/**
	 * `a &&` não é paranoia: os alvos vêm de JSON de LLM, e modelo preenchendo
	 * slot vazio com `null` dentro do array é rotina. Sem a guarda, `a.imagem_url`
	 * lança e derruba um dossiê JÁ PAGO — que é exatamente o oposto da promessa
	 * deste arquivo ("foto é enfeite, nunca derruba o dossiê"). Achado por
	 * verificação adversarial, não por acidente em produção.
	 *
	 * `!a.imagem_url` continua valendo, e agora ele é HONESTO: desde que
	 * `semFotoDoModelo` limpa o campo na saída de cada especialista, o que
	 * sobrevive ali é foto que NÓS buscamos (a de um run cacheado). Antes, uma
	 * `imagem_url` inventada pelo modelo era lida como "este já tem foto" e a
	 * página nunca era aberta — a foto falsa VENCIA a real. Foi a causa medida
	 * de 0 fotos de produto em 4 imagens somando os três runs profundos de
	 * mercado, e dos 404 que chegaram à grade.
	 */
	const elegiveis = (lista: AlvoFoto[]) =>
		lista.filter(
			(a) =>
				a &&
				!a.imagem_url &&
				typeof a.url === 'string' &&
				/^https?:\/\//i.test(a.url) &&
				// Página de busca tem og:image, mas é o LOGOTIPO do marketplace —
				// mostrá-la como foto do produto seria errado parecendo certo.
				ehPaginaDeAnuncio(a.url) &&
				// E o endereço tem que ser de uma página que a busca de fato abriu.
				urlsCitadas.has(chaveUrl(a.url)),
		);
	const doPreco = elegiveis(precos);
	const daFrente = elegiveis(prioritarios);
	const daGaleria = elegiveis(referencias);
	const doResto = elegiveis(resto);
	const semFoto = [...doPreco, ...daFrente, ...daGaleria, ...doResto];

	/**
	 * O teto sai do RELÓGIO, e é medido AQUI — não no começo do run.
	 *
	 * É neste ponto que se sabe quanto sobrou de verdade: um run que gastou mais
	 * do que o previsto nas ondas abre menos páginas em vez de estourar o
	 * deadline, e um run folgado (o Profundo, com 300 s) abre a galeria inteira.
	 */
	const teto = tetoDeFotos(budget.msRestantes());
	const urls = filaDePaginas(
		doPreco.map((a) => a.url as string),
		daFrente.map((a) => a.url as string),
		daGaleria.map((a) => a.url as string),
		doResto.map((a) => a.url as string),
		teto,
	);
	// Portão DEPOIS de saber se há trabalho: avisar "não deu tempo" num run que
	// não tinha página nenhuma para abrir culpa o relógio por algo que não houve.
	if (semFoto.length === 0) return new Map();
	if (urls.length === 0) {
		budget.avisar(
			'Não deu tempo de abrir as páginas dos anúncios para conferir preço e foto.',
		);
		return new Map();
	}

	const inspecao = await inspecionarPaginas(urls, ctx.signal);

	/**
	 * O ARQUIVO É CONFERIDO ANTES DE VIRAR LADRILHO — status 200 não prova nada.
	 *
	 * A tag `og:image` é o que a loja PUBLICA, não o que ela SERVE: página de
	 * produto esgotado, template mal configurada e CDN que responde "imagem
	 * indisponível" com 200 devolvem uma tag perfeitamente formada apontando
	 * para cinza. O caso medido está em `og-image.ts` (`MD5_PLACEHOLDER`): o GIF
	 * de 8.456 B do Mercado Livre chegou quatro vezes à galeria dos runs
	 * gravados, sempre com 200, sempre com `content-type: image/gif`.
	 *
	 * Um lote só, no fim: as fotos distintas de todas as faixas de uma vez (a
	 * mesma URL aparece nas observações de preço e no ranking). O relógio disso
	 * está reservado em `MS_CONFERIR_FOTOS`.
	 */
	const candidatas = new Set<string>();
	for (const a of semFoto) {
		const foto = inspecao.get(a.url as string)?.foto;
		if (foto) candidatas.add(foto);
	}
	const aprovadas = await conferirFotos([...candidatas], ctx.signal);

	// Conta FOTOS distintas, não objetos mutados: a mesma URL costuma aparecer
	// nas observações de preço e no ranking, e contar duas vezes anunciaria
	// "12 fotos" tendo aberto 6 páginas.
	const distintas = new Set<string>();
	for (const a of semFoto) {
		const foto = inspecao.get(a.url as string)?.foto;
		if (!foto || !aprovadas.has(foto)) continue;
		a.imagem_url = foto;
		distintas.add(a.url as string);
	}
	if (distintas.size > 0) {
		ctx.onProgress?.({ kind: 'fotos', n: distintas.size });
	}
	return inspecao;
}

/**
 * `escolherAlternativo` e `gastoDeFalha` MORAM EM `lib/agent-team/llm.js`.
 *
 * Os dois são sobre CHAMADA DE MODELO, não sobre pesquisa: "que outro modelo
 * tento quando este falhou" e "o que uma chamada que falhou já custou" valem
 * igual para qualquer time — e o do Ateliê tem o mesmo modo de falha caro (a
 * resposta que o modelo escreveu inteira e não fechou como JSON).
 *
 * Continuam exportados por aqui: é daqui que o teste sempre os importou.
 */
export { escolherAlternativo, gastoDeFalha } from '../../lib/agent-team/llm.js';

/**
 * O que a tela mostra como "consulta" do especialista.
 *
 * Não existe uma string de busca NOSSA para exibir: quem formula os termos é o
 * plugin de busca do OpenRouter, a partir da pergunta que o especialista
 * recebeu. Então é a pergunta que aparece. Inventar aqui um
 * `site:mercadolivre.com.br caneca personalizada` bonito seria encenar uma
 * busca que não foi essa — e esta ferramenta inteira existe para não fazer isso.
 */
function resumirQuery(pergunta: string): string {
	const limpa = pergunta.replace(/\s+/g, ' ').trim();
	const fim = limpa.search(/[.?!]\s/);
	// Só corta na primeira frase se ela já disser alguma coisa; abaixo disso o
	// corte devolveria "Você é o Analista." e não a pergunta.
	return (fim > 20 ? limpa.slice(0, fim + 1) : limpa).slice(0, 140);
}

/**
 * Roda UM agente. Nunca lança — devolve o resultado com `ok:false`.
 *
 * Exportada para o teste: as regressões que este arquivo mais paga (retry sem
 * consultar orçamento, chamada paga com o relógio no fim, gasto de chamada que
 * falhou sumindo da conta) só aparecem AQUI, com o `Budget` de verdade, e
 * testá-las por uma cópia da lógica seria testar a cópia.
 */
export async function rodarAgente(
	a: AgentSpec,
	vars: Record<string, unknown>,
	palavras: string[],
	budget: Budget,
	ctx: BlockRunContext,
	/** Material das ondas anteriores — quem é da onda 1 não recebe nada. */
	material?: string,
): Promise<ResultadoAgente> {
	const t0 = Date.now();
	const base: ResultadoAgente = {
		chave: a.chave,
		nome: a.nome,
		icone: a.icone,
		cor: a.cor,
		ok: false,
		ms: 0,
		fontes: [],
		compartilhavel: a.compartilhavel,
		pesquisador: a.motorBusca !== 'nenhum',
	};

	/**
	 * Quem o orçamento NÃO pode cortar.
	 *
	 * Mesma regra do teto de time em `agents.ts`: `sintese` é quem lê o time e
	 * escreve o dossiê, `essencial` é quem, faltando, derruba o run no piso de
	 * sucesso. Cortar qualquer um dos dois não economiza nada — troca "caro" por
	 * "run estornado", que custa o dobro e ainda decepciona quem pagou.
	 */
	const protegido = a.fase === 'sintese' || a.essencial;

	/* ── 1. a busca é decidida ANTES de o cartão aparecer na tela ────────── */
	/**
	 * UMA vaga por CHAMADA — a unidade em que o provedor cobra (`search.ts`
	 * contabiliza `buscas = usaBusca ? 1 : 0`, independentemente de quantos
	 * resultados foram pedidos). Reservar `max_buscas`, que é o número de
	 * RESULTADOS, silenciava o Analista de Margem em 100% dos runs de
	 * `mercado+rápido` por uma cobrança que nunca aconteceria: o roster declarava
	 * 6 "vagas" (3+2+1) contra um teto de 5, mas as chamadas cobradas eram TRÊS.
	 *
	 * A reserva acontece na AUTORIZAÇÃO: com seis agentes despachados no mesmo
	 * tick, todos perguntariam "cabe mais uma?" antes de qualquer um registrar
	 * gasto, e todos passariam.
	 */
	let motor = a.motorBusca;
	let vagaDeBusca = 0;
	if (motor !== 'nenhum') {
		if (budget.podeBuscar(1)) {
			budget.reservar(1);
			vagaDeBusca = 1;
		} else {
			motor = 'nenhum';
			/**
			 * A RESSALVA DIZ O QUE MUDOU PARA ELE, e o MOTIVO fica no log.
			 *
			 * "O teto de buscas da execução acabou" é conversa nossa: o aluno não
			 * comprou uma execução com teto, comprou um dossiê. O que ele precisa
			 * saber é que este especialista falou sem abrir página nenhuma — que é
			 * exatamente o que decide se ele confia no que está escrito ali.
			 */
			budget.avisar(
				`${a.nome} trabalhou sem abrir páginas novas nesta pesquisa — o que ele diz não tem página conferida por trás.`,
			);
			budget.diagnosticar(
				`${a.chave}: sem busca — o teto de chamadas com busca do modo acabou.`,
			);
		}
	}

	ctx.onProgress?.({
		kind: 'agente_iniciou',
		chave: a.chave,
		nome: a.nome,
		icone: a.icone,
		cor: a.cor,
		frase: a.fraseTrabalhando,
		/**
		 * "ESTE ESPECIALISTA IA PESQUISAR E FICOU SEM PESQUISAR."
		 *
		 * A semântica é ESTREITA de propósito, e é ela que dá valor ao campo:
		 * `true` só quando o papel dele pede busca (`motorBusca !== 'nenhum'`) e
		 * o run tirou a busca dele — teto de chamadas ou orçamento no fim. Quem
		 * é consultor POR DESENHO (Consultor de Produção, Analista de Riscos:
		 * `motor_busca: 'nenhum'` no roster, `fase` de pesquisa) sai `false`,
		 * porque nada de anormal aconteceu com ele.
		 *
		 * Distinguir os dois é justamente o que a tela não consegue deduzir
		 * sozinha: sem este campo ela só vê "cartão sem evento de busca" e
		 * pintaria de âmbar, em TODO run profundo, 2 dos 10 profissionais que
		 * estão fazendo exatamente o trabalho deles.
		 *
		 * Por isso também a decisão de busca subiu para ANTES deste evento: o
		 * que sai na tela é o que vai acontecer, não o que estava configurado —
		 * um cartão animando como quem varre a web enquanto o especialista roda
		 * sem rede é a mesma encenação que o cartão de cache tem proibida.
		 */
		sem_busca: a.motorBusca !== 'nenhum' && motor === 'nenhum',
	});

	/**
	 * O modelo é do admin, mas quem pesquisa PRECISA funcionar com busca —
	 * `needsWebSearch` descarta os que devolvem resposta vazia cobrando a busca.
	 */
	const model = resolveTextModel(a.modelo, {
		needsWebSearch: motor !== 'nenhum',
	});

	const pergunta = interpolar(a.pergunta, vars);
	const oMaterial = material
		? `\n\n=== MATERIAL DO TIME ===\n${material.slice(0, MAX_CHARS_MATERIAL)}`
		: '';

	/**
	 * ┌─ QUEM PESQUISA RECEBE O MATERIAL NO **SYSTEM**, NÃO NO USER ────────────┐
	 * │ MEDIDO CONTRA O PROVEDOR, com a onda 2 inteira caindo num run real: o   │
	 * │ plugin de busca do OpenRouter formula a consulta a partir da ÚLTIMA     │
	 * │ MENSAGEM DE USUÁRIO. Com o digest colado ali, a "consulta" passa a ser  │
	 * │ um texto de 20 mil caracteres — e o motor `perplexity` devolve HTTP 500 │
	 * │ acima de ~7 mil. Bissecção contra a API real, mensagem de usuário com   │
	 * │ material de N caracteres, `perplexity` + `gemini-3.1-flash-lite`:       │
	 * │     2k ✓   5k ✓   6k ✓   7k ✓   8k ✗   9k ✗   12k ✗   20k ✗            │
	 * │ e o 500 independe do modelo (Haiku também) e do `response_format`.      │
	 * │ `exa` aguenta 20k, e foi por isso que o defeito passou despercebido no  │
	 * │ primeiro run: os quatro especialistas da onda 1 que rodaram usavam      │
	 * │ `exa`, os DEZ da onda 2 usam `perplexity` — e os dez falharam, cada um  │
	 * │ com um retry pago em outro modelo, que falhou de novo pelo mesmo        │
	 * │ motivo. Dez de 22 especialistas cobrados e mudos.                       │
	 * │                                                                          │
	 * │ Com o material no `system` e a pergunta sozinha no `user`, o mesmo       │
	 * │ pedido de 20 mil caracteres passa com 5 citações. E é a forma CERTA por  │
	 * │ mais um motivo, este de qualidade: a consulta que o plugin monta volta   │
	 * │ a ser a PERGUNTA do especialista, e não a pergunta afogada no digest —   │
	 * │ que é exatamente o que `resumirQuery` já diz na tela que está            │
	 * │ acontecendo.                                                             │
	 * │                                                                          │
	 * │ Quem NÃO pesquisa (a síntese) continua recebendo no `user`: ali o        │
	 * │ material é a tarefa, não o contexto, e o resultado desses cinco já foi   │
	 * │ aprovado como está.                                                      │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 */
	const buscando = motor !== 'nenhum';
	const system = buscando ? `${a.papel}${oMaterial}` : a.papel;
	const comMaterial = buscando ? pergunta : `${pergunta}${oMaterial}`;
	const user = a.saida
		? `${comMaterial}\n\nResponda APENAS JSON, neste formato:\n${a.saida}`
		: comMaterial;

	/** Projeção de PIOR CASO desta chamada — é ela que dá dente ao `maxUsd`. */
	const prever = (m: TextModelEntry, comBusca: boolean) =>
		estimarCustoUsd({
			precoIn: m.pricing.in,
			precoOut: m.pricing.out,
			// `system.length`, não `a.papel.length`: com o material no system, usar o
			// papel cru subestimaria a entrada em 20 mil caracteres — e a projeção
			// é justamente o que dá dente ao `maxUsd`.
			charsPrompt: system.length + user.length,
			maxTokensSaida: a.maxTokens,
			comBusca,
		});

	let usdReservado = 0;
	const soltarReserva = () => {
		if (usdReservado > 0) budget.liberarUsd(usdReservado);
		usdReservado = 0;
	};
	const falharCedo = (erro: string): ResultadoAgente => {
		ctx.onProgress?.({ kind: 'agente_falhou', chave: a.chave, erro });
		return { ...base, ms: Date.now() - t0, erro };
	};

	/**
	 * O GASTO DE UMA CHAMADA QUE FALHOU EXISTE DO MESMO JEITO.
	 *
	 * O `registrar` só rodava no caminho de sucesso, então o `custo_usd` gravado
	 * no dossiê e no cache — o número que a gente usaria para conferir a margem
	 * depois de 200 runs — escondia exatamente as chamadas caras: a resposta que
	 * o modelo escreveu inteira e não fechou como JSON, e a que veio vazia com a
	 * busca já cobrada. Com o retry ativo a distorção dobrava (só a segunda
	 * chamada entrava na conta).
	 *
	 * `Set` de erros já contabilizados porque o mesmo objeto de erro passa duas
	 * vezes por aqui quando o retry é recusado (contabiliza e relança).
	 */
	const contabilizados = new Set<unknown>();
	const contabilizarFalha = (err: unknown) => {
		if (contabilizados.has(err)) return;
		contabilizados.add(err);
		const g = gastoDeFalha(err, motor !== 'nenhum');
		if (g) budget.registrar(g.buscas, g.custoUsd);
		// A projeção some assim que a realidade é conhecida — senão o retry seria
		// barrado por um dinheiro contado duas vezes (reserva + gasto real).
		soltarReserva();
	};

	try {
		/* ── 2. o RELÓGIO, antes de gastar ──────────────────────────────── */
		/**
		 * Sem esta porta, o bloco despachava um pesquisador com 20 s de relógio,
		 * cortava o timeout dele para esses mesmos 20 s
		 * (`Math.min(timeoutS, msRestantes)`) e colhia uma falha por TIMEOUT. Ou
		 * seja: pagava-se a chamada para não receber nada. Aqui não sai chamada.
		 *
		 * O `a.maxTokens` vai junto porque o piso é DESTE agente: o portão com
		 * piso único de 15 s continuava despachando o Estrategista (4.000 tokens,
		 * 34–55 s medidos) com 20 s de relógio — exatamente o caso que ele existe
		 * para barrar. Ver `msMinimoUtil`.
		 *
		 * ┌─ E O PROTEGIDO PASSA, PELO MESMO MOTIVO QUE PASSA NO DINHEIRO ─────┐
		 * │ O freio de DINHEIRO ganhou a isenção de `protegido` (logo abaixo,   │
		 * │ na 2ª marcha) e o do RELÓGIO ficou sem nenhuma — o resultado foi    │
		 * │ reproduzido com o `Budget` e o roster reais: em `mercado+rápido`,   │
		 * │ com a onda 1 fechando em 70 s dos 95 s do deadline, sobram 25 s     │
		 * │ contra o piso de 35 s do Estrategista. Ele era PULADO, e como é     │
		 * │ `essencial` o piso de sucesso reprovava o run: 502, `refundInvo-    │
		 * │ cation`, e o aluno que esperou 70 segundos vendo o time inteiro     │
		 * │ entregar recebia erro. Um pesquisador lento basta para chegar lá    │
		 * │ (`brechas` pode legalmente consumir 75 dos 95 s).                   │
		 * │                                                                     │
		 * │ Pular quem escreve o dossiê NÃO economiza o run — ele já está       │
		 * │ perdido. Tentar com o relógio apertado custa uma chamada e às vezes │
		 * │ salva: o piso é calibrado pelo MELHOR caso medido (`MS_POR_TOKEN_   │
		 * │ DE_SAIDA`), então "não cabe" quer dizer "provavelmente não dá", não │
		 * │ "é impossível". Quem é cortável continua sendo pulado: aí a chamada │
		 * │ perdida é prejuízo puro, porque o dossiê sai sem ele de qualquer    │
		 * │ jeito.                                                              │
		 * │                                                                     │
		 * │ APERTADO NÃO É ZERADO: com o deadline já vencido a isenção acaba,   │
		 * │ para o protegido também. O timeout da chamada é o que sobrou do     │
		 * │ relógio (a isenção é para TENTAR, não para furar o deadline), então │
		 * │ com zero ela nasceria abortada — gasto sem nenhuma chance de        │
		 * │ resposta, que é justamente o que este portão existe para evitar.    │
		 * └─────────────────────────────────────────────────────────────────────┘
		 */
		if (!budget.cabeNoTempo(a.timeoutS, a.maxTokens)) {
			if (!protegido || budget.msRestantes() <= 0) {
				// Ressalva de verdade: falta uma seção no dossiê que ele pagou.
				budget.avisar(
					`${a.nome} não chegou a trabalhar nesta pesquisa: o tempo acabou antes da vez dele, e a parte dele não está no dossiê.`,
				);
				budget.diagnosticar(
					`${a.chave}: pulado — relógio da execução no fim (${Math.round(budget.msRestantes() / 1000)}s).`,
				);
				// A conta em segundos ficou no diagnóstico: a tela diz o que faltou
				// para o TRABALHO, não o que faltou para a máquina.
				return falharCedo('não chegou a tempo de entrar nesta pesquisa.');
			}
			// Nada mudou para quem lê: ele trabalhou e a seção dele está lá. Por que
			// o portão foi dispensado é assunto nosso.
			budget.diagnosticar(
				`${a.chave}: relógio no fim (${Math.round(budget.msRestantes() / 1000)}s), rodou por ser protegido.`,
			);
		}

		/* ── 3. o DINHEIRO, com projeção de pior caso ───────────────────── */
		let previsto = prever(model, motor !== 'nenhum');
		if (!budget.podeGastar(previsto) && motor !== 'nenhum') {
			// 1ª marcha do freio: sem busca. Economiza os ~7 mil tokens de entrada
			// que os resultados colam no contexto, não só os US$ 0,005 da busca.
			motor = 'nenhum';
			if (vagaDeBusca > 0) {
				budget.liberar(vagaDeBusca);
				vagaDeBusca = 0;
			}
			previsto = prever(model, false);
			// A ressalva é a MESMA do teto de buscas — para quem lê, o que aconteceu
			// é o mesmo: este especialista falou sem abrir página. A causa (dinheiro
			// ou teto de chamadas) é diagnóstico.
			budget.avisar(
				`${a.nome} trabalhou sem abrir páginas novas nesta pesquisa — o que ele diz não tem página conferida por trás.`,
			);
			budget.diagnosticar(
				`${a.chave}: sem busca — 1ª marcha do freio de custo (previsto US$ ${previsto.toFixed(4)}).`,
			);
		}
		if (!budget.podeGastar(previsto)) {
			if (!protegido) {
				// 2ª marcha, e só para quem não escreve o dossiê: não roda mesmo.
				budget.avisar(
					`${a.nome} não chegou a trabalhar nesta pesquisa, e a parte dele não está no dossiê.`,
				);
				budget.diagnosticar(
					`${a.chave}: pulado pela 2ª marcha do freio de custo (gasto ${budget.gasto().usd.toFixed(4)} de ${budget.limites.maxUsd}).`,
				);
				// "Orçamento" é palavra de máquina e a regra a proíbe na tela; ela já
				// está no diagnóstico logo acima, com o número.
				return falharCedo('não chegou a entrar nesta pesquisa.');
			}
			// O aluno recebeu o trabalho dele por inteiro: não há ressalva nenhuma a
			// fazer. Que o teto de gasto tenha sido furado é conta NOSSA, e é ela
			// que explica um run caro quando alguém for conferir a margem.
			budget.diagnosticar(
				`${a.chave}: teto de gasto do modo estourado (${budget.gasto().usd.toFixed(4)} de ${budget.limites.maxUsd}), rodou por ser protegido.`,
			);
		}
		budget.reservarUsd(previsto);
		usdReservado = previsto;

		/**
		 * O timeout do especialista NUNCA passa do relógio da execução — e não
		 * precisa mais do piso artificial de 5 s que existia aqui: o portão de
		 * tempo acima garante que sobrou pelo menos o mínimo útil. O piso servia
		 * só para dar mais 5 s a uma chamada que já ia morrer no deadline.
		 */
		const timeout = AbortSignal.timeout(
			Math.min(a.timeoutS * 1000, budget.msRestantes()),
		);
		const signal = ctx.signal
			? AbortSignal.any([ctx.signal, timeout])
			: timeout;

		const chamar = (m: TextModelEntry) => {
			/**
			 * ANTES da chamada, não depois: é este evento que faz a tela mostrar o
			 * especialista digitando a consulta enquanto ele de fato espera a
			 * resposta. Sai de novo no retry porque o retry paga (e refaz) a busca.
			 */
			if (motor !== 'nenhum') {
				ctx.onProgress?.({
					kind: 'busca',
					chave: a.chave,
					query: resumirQuery(pergunta),
					motor,
				});
			}
			return chamarComBusca({
				model: m,
				system,
				user,
				engine: motor,
				maxResults: Math.max(3, a.maxBuscas * 5),
				includeDomains: a.dominiosIncluir,
				excludeDomains: a.dominiosExcluir,
				maxTokens: a.maxTokens,
				temperature: a.temperatura,
				json: Boolean(a.saida) && m.json,
				signal,
			});
		};

		/** A mesma página achada duas vezes (o retry refaz a busca) é UMA fonte. */
		const urlsMostradas = new Set<string>();

		/**
		 * UMA TENTATIVA INTEIRA: chamada + filtro de tema + fontes na tela +
		 * validação do JSON.
		 *
		 * A validação do JSON entrou PARA DENTRO daqui porque o `throw` dela vivia
		 * fora do `try` que implementa o retry: para o modo de falha mais comum
		 * deste time — resposta cortada no teto de tokens, que é o que acontece com
		 * quem escreve mais (Estrategista e Redator) — a segunda tentativa que o
		 * comentário prometia NUNCA acontecia. O aluno esperava ~60 s na sala de
		 * guerra e recebia "não cobramos por esta análise".
		 *
		 * As fontes continuam subindo ANTES da validação, de propósito: se o
		 * especialista cair no formato da resposta, as páginas que ele abriu
		 * continuam sendo verdade.
		 */
		const tentar = async (m: TextModelEntry) => {
			const r = await chamar(m);

			/**
			 * O filtro de tema é POR ESPECIALISTA. Quem procura comissão de
			 * marketplace ou tendência de nicho acha páginas que nunca citam o
			 * produto — filtrar essas pelas palavras-chave do produto descartava
			 * 100% do trabalho e o Especialista em Marketplaces vinha com 0 fontes.
			 */
			const { mantidas, descartadas } = a.filtrarPorTema
				? filtrarPorTema(r.citations, palavras)
				: { mantidas: r.citations, descartadas: 0 };
			if (descartadas > 0) {
				// Fica no dossiê: é uma página que ele NÃO viu, e o aluno que confere
				// a lista de fontes merece saber que houve descarte deliberado.
				// "página(s)" é economia de quem escreve cobrada de quem lê: o dossiê
				// é texto para o aluno, não saída de terminal.
				budget.avisar(
					descartadas === 1
						? 'Descartei uma página que a busca trouxe fora do tema.'
						: `Descartei ${descartadas} páginas que a busca trouxe fora do tema.`,
				);
			}

			/**
			 * A FONTE SOBE ASSIM QUE É ACEITA, não no fim do run.
			 *
			 * A coluna de links chegando ao vivo é o antídoto contra "isso aí a IA
			 * inventou": o aluno vê o endereço da página antes de ver a conclusão
			 * que saiu dela.
			 */
			for (const f of mantidas) {
				if (urlsMostradas.has(f.url)) continue;
				urlsMostradas.add(f.url);
				ctx.onProgress?.({
					kind: 'fonte',
					chave: a.chave,
					url: f.url,
					titulo: f.title,
				});
			}

			/**
			 * JSON QUEBRADO É FALHA, NÃO SUCESSO MUDO.
			 *
			 * O especialista que declara `saida` promete um JSON. Se a resposta veio
			 * truncada no teto de tokens, `extractJson` devolve `undefined` e, antes
			 * desta guarda, o bloco marcava `ok: true` com `json: null`. A tela então
			 * mostrava "não apurado" no lugar do veredito, e nada indicava o porquê.
			 */
			// A foto do modelo morre AQUI, na entrada, e não em cada um dos cinco
			// lugares que leem o campo depois. Ver `semFotoDoModelo`.
			const json = semFotoDoModelo(extractJson(r.text));
			if (a.saida && json === undefined) {
				// ~4 caracteres por token: acima de 3,5× o teto a resposta quase certo
				// bateu no limite e veio cortada no meio de uma chave.
				const truncado = r.text.length > a.maxTokens * 3.5;
				/**
				 * O INÍCIO da resposta vai na mensagem de erro.
				 *
				 * "não veio em JSON válido" sozinho não diz nada: pode ser preâmbulo
				 * em prosa, cerca de markdown, aspas quebradas ou corte no meio. Sem o
				 * trecho, diagnosticar exige reproduzir o run inteiro — que custa
				 * dinheiro e nem sempre reproduz. Cortado curto: isto vai para a tela.
				 */
				const trecho = r.text.trim().slice(0, 120).replace(/\s+/g, ' ');
				throw new SearchError(
					`${truncado ? 'a resposta bateu no limite de tokens e veio cortada' : 'a resposta não veio em JSON válido'} (${r.text.length} caracteres, teto ${a.maxTokens} tokens). Começo: "${trecho}…"`,
					'falha',
					// O dinheiro SAIU: o modelo escreveu a resposta inteira (e pagou a
					// busca); o que não veio foi um JSON que fecha.
					{ buscas: r.buscas, custoUsd: r.custoUsd },
					// A frase acima é para o log. O aluno não comprou teto de token
					// nem contagem de caractere — ver `FALHA_PARA_TELA`.
					'trabalhou, mas não conseguiu fechar o relatório dele.',
				);
			}
			return { r, mantidas, json };
		};

		let out: Awaited<ReturnType<typeof tentar>>;
		try {
			out = await tentar(model);
		} catch (primeiro) {
			contabilizarFalha(primeiro);
			/**
			 * RETRY EM OUTRO MODELO — resposta VAZIA ou JSON QUEBRADO.
			 *
			 * Medido: DeepSeek é modelo de RACIOCÍNIO e às vezes gasta todo o
			 * orçamento de saída pensando — devolve `content: ""` com a busca já
			 * cobrada. Não é erro do provedor nem falta de resultado: é o modelo
			 * escolhido não servindo para a tarefa. Uma segunda tentativa salva o
			 * especialista sem o admin precisar descobrir sozinho por que aquele
			 * bloco do dossiê vive em branco.
			 *
			 * UMA tentativa, não um laço, e com portas antes: tem que valer o tipo
			 * da falha, tem que sobrar relógio e — para quem NÃO escreve o dossiê —
			 * tem que caber no orçamento. Sem a porta do dinheiro, o retry escalava
			 * para o modelo mais caro do catálogo sem consultar nada e derrubava a
			 * margem do rápido de 78,6% para 48%, numa falha que acontece em 1 de 7
			 * runs reais; com ela valendo para TODO MUNDO, o essencial que não
			 * cabia derrubava o run inteiro (ver o bloco abaixo).
			 */
			const vale =
				primeiro instanceof SearchError &&
				(primeiro.kind === 'vazio' || primeiro.kind === 'falha');
			if (!vale) throw primeiro;
			/**
			 * O relógio do retry tem a MESMA isenção do portão de entrada e do freio
			 * de dinheiro — e aqui ela sai ainda mais barata: o `signal` foi criado
			 * ANTES da primeira chamada, com o relógio que havia naquele momento, e
			 * não é renovado. O retry do protegido corre dentro do que sobrou daquele
			 * mesmo prazo e não tem como furar o deadline. Barrá-lo era trocar a
			 * última tentativa de salvar o dossiê pelo estorno certo do run.
			 *
			 * Com o relógio ZERADO ninguém refaz, nem o protegido: o `signal` da
			 * primeira chamada já venceu (ele nunca passa do deadline), então a
			 * segunda nasceria abortada.
			 */
			/**
			 * TUDO O QUE DIZ RESPEITO AO RETRY É DIAGNÓSTICO, sem exceção.
			 *
			 * O aluno não precisa saber que houve uma segunda tentativa: ou ela deu
			 * certo (e ele recebeu a seção, sem ressalva nenhuma a fazer) ou não deu
			 * (e o especialista aparece em `falhas`, que é a ressalva de verdade e
			 * já é mostrada na tela). O que não pode acontecer é ele ler o nome do
			 * modelo que estava por trás de um cargo.
			 */
			if (!budget.cabeNoTempo(a.timeoutS, a.maxTokens)) {
				if (!protegido || budget.msRestantes() <= 0) {
					budget.diagnosticar(
						`${a.chave}: sem retry — não sobrou relógio (${Math.round(budget.msRestantes() / 1000)}s).`,
					);
					throw primeiro;
				}
				budget.diagnosticar(
					`${a.chave}: retry com o relógio no fim (${Math.round(budget.msRestantes() / 1000)}s), por ser protegido.`,
				);
			}
			/**
			 * O alternativo tem que ser DIFERENTE de verdade e — para quem NÃO é
			 * protegido — caber no que sobrou.
			 *
			 * A primeira versão pedia o padrão do catálogo — e o Estrategista USA o
			 * padrão, então `alternativo.id === model.id` e o retry nunca disparava
			 * justamente para quem escreve o veredito.
			 *
			 * ┌─ POR QUE O PROTEGIDO NÃO PASSA PELO FREIO ────────────────────────┐
			 * │ O filtro de orçamento entrou na rodada passada SEM esta exceção, e │
			 * │ o resultado foi reproduzido com o `Budget`, o catálogo e o roster  │
			 * │ reais: em `mercado+rápido`, com o Estrategista devolvendo JSON     │
			 * │ cortado (o modo de falha medido deste agente, que por definição    │
			 * │ queimou o teto de saída inteiro), o gasto comprometido             │
			 * │ chega a US$ 0,089–0,099 contra `maxUsd` 0,10. NENHUM modelo do     │
			 * │ catálogo cabe nessa sobra — nem o mais barato —, então             │
			 * │ `alternativo` vinha `null`, o erro era relançado, o essencial      │
			 * │ falhava, o bloco devolvia 502 e o controller ESTORNAVA. Ou seja: o │
			 * │ freio de custo trocava "caro" por "gastamos US$ 0,10, o aluno      │
			 * │ esperou 90 s e a receita foi R$ 0,00" — o oposto do que o          │
			 * │ cabeçalho de `budget.ts` promete e do que a 2ª marcha do freio já  │
			 * │ faz duas telas acima. E o caminho "cabe" era pior ainda: rebaixava │
			 * │ quem escreve o veredito para o modelo mais fraco do catálogo.      │
			 * │                                                                    │
			 * │ Quem é `sintese` ou `essencial` refere-se ao dossiê inteiro: sem   │
			 * │ ele não há o que entregar, e um retry de US$ 0,03 é mais barato    │
			 * │ que o estorno de R$ 2,40. O estouro não fica escondido — vira      │
			 * │ DIAGNÓSTICO no log (`budget.diagnosticar`). Não vira ressalva no   │
			 * │ dossiê porque nada mudou para quem lê: a seção dele está lá.       │
			 * └────────────────────────────────────────────────────────────────────┘
			 */
			const alternativo = escolherAlternativo(
				model.id,
				motor !== 'nenhum',
				protegido
					? undefined
					: (m) => budget.podeGastar(prever(m, motor !== 'nenhum')),
			);
			if (!alternativo) {
				// O motivo tem que ser o VERDADEIRO: para o protegido o filtro de
				// orçamento nem roda, então "não cabia no orçamento" seria mentira —
				// o que faltou foi outro modelo compatível no catálogo.
				budget.diagnosticar(
					protegido
						? `${a.chave}: sem retry — não há outro modelo compatível no catálogo.`
						: `${a.chave}: sem retry — nenhum modelo alternativo cabia no que sobrou do teto de gasto.`,
				);
				throw primeiro;
			}
			budget.diagnosticar(
				`${a.chave}: ${model.id} não devolveu resposta utilizável; refeito em ${alternativo.id}.`,
			);
			ctx.onProgress?.({
				kind: 'agente_retry',
				chave: a.chave,
				de: model.id,
				para: alternativo.id,
			});
			const previstoRetry = prever(alternativo, motor !== 'nenhum');
			// O protegido refaz mesmo estourando, e o estouro é REGISTRADO — no log.
			// É o que permite explicar depois por que um run custou mais que o teto;
			// para quem lê o dossiê, nada mudou: a seção dele está lá.
			if (protegido && !budget.podeGastar(previstoRetry)) {
				budget.diagnosticar(
					`${a.chave}: retry acima do teto de gasto do modo (${budget.gasto().usd.toFixed(4)} de ${budget.limites.maxUsd}), refeito por ser protegido.`,
				);
			}
			budget.reservarUsd(previstoRetry);
			usdReservado = previstoRetry;
			out = await tentar(alternativo);
		}
		budget.registrar(out.r.buscas, out.r.custoUsd);

		const resultado: ResultadoAgente = {
			...base,
			ok: true,
			ms: Date.now() - t0,
			// O que REALMENTE respondeu — pode não ser o pedido, se houve retry.
			modelo: out.r.modelUsado,
			json: out.json,
			texto: out.r.text,
			fontes: out.mantidas,
		};
		ctx.onProgress?.({
			kind: 'agente_concluiu',
			chave: a.chave,
			ms: resultado.ms,
			n_fontes: out.mantidas.length,
		});
		return resultado;
	} catch (err) {
		contabilizarFalha(err);
		/**
		 * DUAS MENSAGENS, e é isso que conserta a regra: a técnica vai para o log
		 * junto com o resto do diagnóstico do run, e a tela recebe uma frase sobre
		 * o TRABALHO que não saiu. O caminho antigo mandava `err.message` inteiro
		 * para os dois lados — "falha na chamada (500)" e "o modelo
		 * 'google/gemini-3.1-flash-lite' devolveu resposta vazia (mas cobrou 3
		 * resultado(s) de busca)" chegavam ao cartão do especialista.
		 */
		const tecnica = err instanceof Error ? err.message : 'falha desconhecida';
		budget.diagnosticar(`${a.chave}: ${tecnica}`);
		const msg =
			err instanceof SearchError ? err.mensagemParaTela : FALHA_PARA_TELA.falha;
		ctx.onProgress?.({ kind: 'agente_falhou', chave: a.chave, erro: msg });
		return { ...base, ms: Date.now() - t0, erro: msg };
	} finally {
		// Devolve a vaga de busca que sobrou. Sem isto, um agente que falha antes
		// de buscar levaria a vaga junto e os últimos do time rodariam sem busca
		// por um teto que ninguém gastou. Mesma coisa para a projeção de custo.
		if (vagaDeBusca > 0) budget.liberar(vagaDeBusca);
		soltarReserva();
	}
}

/**
 * `repartirChars` e `montarDigest` MORAM NO NÚCLEO (`lib/agent-team/core.ts`).
 *
 * A repartição do teto entre N especialistas não é regra de pesquisa: é regra
 * de time, e o Ateliê precisa exatamente da mesma — ondas que alimentam ondas,
 * com um teto de caracteres que não pode apagar ninguém do material. Duas
 * cópias do enchimento por nível é a forma mais fácil de o conserto valer para
 * um time só.
 *
 * `repartirChars` continua sendo exportado por aqui: é daqui que o teste sempre
 * o importou, e o caminho do import não é o que a regressão quebra.
 */
export { repartirChars } from '../../lib/agent-team/core.js';

/** O que um especialista que RODOU agora entrega ao digest. */
function blocoDoResultado(r: ResultadoAgente): { nome: string; corpo: string } {
	return {
		nome: r.nome,
		corpo: r.ok
			? `${(r.texto ?? '').trim()}\n\nFontes:\n${
					r.fontes
						.slice(0, 8)
						.map((f) => `- ${f.title ?? f.url} — ${f.url}`)
						.join('\n') || '(nenhuma)'
				}`
			: `(não consegui pesquisar desta vez: ${r.erro})`,
	};
}

export const aiResearchTeamBlock: ToolBlock<Params> = {
	id: 'ai.research_team',
	category: 'ai',
	description:
		'Dispara o time de agentes de pesquisa em paralelo (config vem da coleção `agentes`), com tetos de busca/custo/tempo, cache de mercado e estatística de preço calculada em código.',
	paramsSchema: schema,
	async run(ctx, p) {
		const {
			loadPublishedToolDefinition,
			resolveCollection,
			toolCollectionRepository: repo,
		} = await loadDeps();

		const doc = (ctx.toolDoc ??
			(
				await loadPublishedToolDefinition(
					p.tool,
					ctx.customerId,
					ctx.authHeader,
				)
			).definition) as Record<string, unknown>;

		/**
		 * A ficha da visão MAIS a identidade da marca, no mesmo saco de variáveis.
		 *
		 * É de propósito que a marca entre por `vars` e não por um caminho novo:
		 * `interpolar` já troca `{chave}` na `pergunta` de cada especialista, já
		 * some com o token quando a variável está vazia (levando junto a
		 * preposição que a introduzia) e já é o mecanismo por onde `{produto}` e
		 * `{material}` chegam. Assim "este especialista usa a marca" vira uma
		 * edição de DADO no roster — e "o aluno não tem marca" vira a mesma
		 * ausência silenciosa que o time já sabe tratar, sem um `if` a mais.
		 *
		 * As chaves da marca são todas prefixadas (`marca`, `marca_nome`,
		 * `marca_tom`, `marca_publico`, `marca_nao_usar`), então nenhuma delas
		 * pode sombrear `produto`, `categoria`, `material` ou `uf`.
		 */
		const marca = escolherMarca(p.marca);
		const vars = { ...parseVars(p.vars), ...varsDaMarca(marca) };
		const categoriaSlug = String(vars.categoria_slug ?? '').trim();

		/**
		 * Palavras-chave da categoria escolhida — a defesa determinística contra o
		 * lixo que a busca semântica traz (no teste, "placa de PIX" restrita ao
		 * Mercado Livre devolveu cooler de PC). Vêm do parâmetro explícito ou,
		 * mais comum, da lista de categorias que o pipeline já carregou.
		 */
		const palavras = (() => {
			const explicitas = p.palavras_chave
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			if (explicitas.length) return explicitas;
			// O motor entrega o valor JÁ RESOLVIDO, então `cats.json` chega como
			// ARRAY, não como string. Aceitar os dois evita que a definition
			// precise saber dessa sutileza do motor.
			const lista = normalizarLista(p.categorias);
			const achada = lista.find(
				(c) => (c as { slug?: string })?.slug === categoriaSlug,
			) as { palavras_chave?: string } | undefined;
			return String(achada?.palavras_chave ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		})();

		/* ── 1. o time, em UMA leitura ─────────────────────────────────────── */
		const cfgAgentes = resolveCollection(doc, p.agentes_collection);
		const listaAgentes = await repo.list(
			p.tool,
			p.agentes_collection,
			cfgAgentes,
			{
				// `isStaff:true` é OBRIGATÓRIO: a coleção é `visibility:'staff'` (é o
				// que protege os system prompts), e o repositório esconde `staff` de
				// quem não é. `collection.query` não serve aqui exatamente por isso.
				viewer: { customerId: ctx.customerId, isStaff: true },
				// Ver `PAGINA_DO_ROSTER`: uma página curta não dá erro, ela entrega um
				// time menor do que o que a tela prometeu.
				pageSize: PAGINA_DO_ROSTER,
				page: 1,
				sort: 'position',
			},
		);
		const todos = listaAgentes.items
			.map((e) => toAgentSpec(e))
			.filter((a): a is AgentSpec => a !== null);

		if (todos.filter((a) => a.ativo).length === 0) {
			throw new ToolEngineError(
				400,
				'Nenhum agente de pesquisa configurado. Cadastre o time na coleção `agentes`.',
			);
		}

		/* ── 2. cache de mercado ───────────────────────────────────────────── */
		// O escopo entra na CHAVE: "o que vender em brindes" e "quanto vale este
		// copo" são retratos diferentes, e misturá-los serviria a resposta errada.
		const cacheKey = `${p.escopo}|${categoriaSlug || 'outros'}|${String(vars.uf ?? 'BR')}|v${VERSAO_PROMPT}`;
		const cacheavel = Boolean(categoriaSlug) && categoriaSlug !== 'outros';
		let cacheQuente = false;
		let cachePayload: unknown = null;
		let cacheIdadeDias: number | null = null;
		/** Chaves de agente que o cache já cobre — nem toda quente cobre tudo. */
		const cobertos = new Set<string>();

		if (cacheavel && !p.forcar && p.ttl_dias > 0) {
			try {
				const cfgP = resolveCollection(doc, p.pesquisas_collection);
				const achados = await repo.list(p.tool, p.pesquisas_collection, cfgP, {
					viewer: { customerId: ctx.customerId, isStaff: true },
					filters: { cache_key: { kind: 'eq', value: cacheKey } },
					pageSize: 1,
					page: 1,
				});
				const linha = achados.items[0];
				const geradoEm = (linha?.data as { gerado_em?: string })?.gerado_em;
				if (linha && geradoEm) {
					const idade = (Date.now() - Date.parse(geradoEm)) / 86_400_000;
					if (Number.isFinite(idade) && idade <= p.ttl_dias) {
						cacheQuente = true;
						cacheIdadeDias = Math.floor(idade);
						cachePayload = extractJson(
							String((linha.data as { payload?: string }).payload ?? '{}'),
						);
						/**
						 * QUAIS agentes o cache já cobre.
						 *
						 * Sem isto o cache é bom demais: uma execução RÁPIDA (2 agentes
						 * compartilháveis) marcava a categoria inteira como quente, e a
						 * PROFUNDA seguinte pulava concorrência, canais e nichos — que
						 * nunca tinham rodado. O aluno pagava 6 voxxys por um dossiê
						 * sem as seções que justificam o modo profundo.
						 */
						const ags = (cachePayload as { agentes?: { chave?: string }[] })
							?.agentes;
						if (Array.isArray(ags)) {
							for (const x of ags) if (x?.chave) cobertos.add(x.chave);
						}
					}
				}
			} catch {
				// Cache é otimização: se a leitura falhar, pesquisa-se de novo.
			}
		}

		/* ── 3. quem roda ──────────────────────────────────────────────────── */
		/**
		 * O TIME INTEIRO vai para a tela; só uma PARTE dele roda.
		 *
		 * `time` tem sempre os 5 (rápido) ou 22 (profundo) que o aluno viu serem
		 * prometidos; `paraRodar` é quem trabalha agora; `aproveitados` é quem já
		 * estava no cache. Antes o cache SUMIA com o especialista, e a tela
		 * anunciava "1/3 PROFISSIONAIS" logo depois de o botão prometer o time
		 * inteiro.
		 */
		const { time, paraRodar, aproveitados } = montarTime(todos, {
			modo: p.modo,
			escopo: p.escopo,
			// Pula só o que o cache REALMENTE tem, agente a agente.
			jaCobertos: cacheQuente ? cobertos : undefined,
			teto: MAX_AGENTES,
		});
		/**
		 * O piso conta só quem VAI RODAR — o `total` do evento e o piso são
		 * coisas diferentes. Contar o aproveitado no piso faria um cache quente
		 * derrubar o run por "não entregar" quem nem foi chamado para trabalhar.
		 */
		const piso = pisoDeSucesso(paraRodar);

		const budget = new Budget(LIMITES_PADRAO[p.modo], Date.now());
		if (cacheQuente) {
			budget.avisar(
				`Aproveitei a pesquisa de mercado de ${cacheIdadeDias ?? 0} dia(s) atrás. Seu custo e seu lucro são calculados agora, com os seus números.`,
			);
		}

		/* ── caça-foto dos produtos escolhidos ─────────────────────────────── */
		/**
		 * As páginas que cada especialista do cache abriu no dia em que rodou.
		 *
		 * Usadas em dois lugares: a contagem no cartão dele e — o que o dono do
		 * produto pediu — os LINKS no feed de fontes, para a pesquisa
		 * reaproveitada poder ser conferida em vez de só contada.
		 */
		const fontesNoCache = new Map<string, Citation[]>();
		for (const c of ((cachePayload as { agentes?: unknown[] })?.agentes ??
			[]) as {
			chave?: string;
			n_fontes?: number;
			fontes?: Citation[];
		}[]) {
			if (!c?.chave) continue;
			const lista = Array.isArray(c.fontes)
				? c.fontes.filter((f) => f?.url)
				: [];
			// Linha de cache ANTIGA guardava só a contagem. Sem os links, o cartão
			// mostra o número que ela tem e o feed não ganha entrada — melhor que
			// fingir zero, e some sozinho quando o cache de 7 dias vira.
			if (lista.length === 0 && Number(c.n_fontes) > 0) {
				fontesNoCache.set(
					c.chave,
					Array.from({ length: Number(c.n_fontes) }, () => ({ url: '' })),
				);
				continue;
			}
			fontesNoCache.set(c.chave, lista);
		}

		ctx.onProgress?.({
			kind: 'time_montado',
			total: time.length,
			cache_quente: cacheQuente,
			cache_idade_dias: cacheIdadeDias,
			agentes: time.map((a) => ({
				chave: a.chave,
				nome: a.nome,
				icone: a.icone,
				cor: a.cor,
				frase: a.fraseTrabalhando,
				fase: a.fase,
				/**
				 * `aproveitado` NASCE CONCLUÍDO na tela e não anima como quem está
				 * pesquisando. Fingir trabalho que não está acontecendo é exatamente
				 * o que esta ferramenta existe para não fazer — e o aluno que vê
				 * "pesquisando" por 0,2 s e o cartão já concluído percebe a encenação.
				 */
				estado: aproveitados.includes(a) ? 'aproveitado' : 'vai_rodar',
				/**
				 * Quantas páginas ele abriu NO DIA em que rodou.
				 *
				 * Sem isto o cartão de cache era o único do time sem contagem, e lia-se
				 * como "este não trouxe nada" — quando é justamente o que já tinha
				 * trazido. O número vem do payload do cache, que grava `n_fontes` por
				 * especialista desde que a contagem parou de sair chumbada em zero.
				 */
				n_fontes: aproveitados.includes(a)
					? fontesNoCache.get(a.chave)?.length
					: undefined,
			})),
		});

		/**
		 * AS FONTES DO CACHE ENTRAM NO FEED, como as de agora.
		 *
		 * Sem isto o painel "Fontes encontradas" mostrava só o que os poucos
		 * especialistas não-cacheados abriram — num run com cache quente, dez
		 * cartões diziam "aproveitado" e o feed ficava com duas linhas, como se a
		 * pesquisa reaproveitada não tivesse página nenhuma por trás. Elas são
		 * emitidas logo depois do time montado, antes de qualquer trabalho novo,
		 * porque é isso que elas são: o que JÁ estava registrado.
		 */
		for (const [chave, lista] of fontesNoCache) {
			for (const f of lista) {
				if (!f.url) continue;
				ctx.onProgress?.({
					kind: 'fonte',
					chave,
					url: f.url,
					titulo: f.title,
				});
			}
		}

		/* ── 4. TRÊS ONDAS: descoberta → aprofundamento → síntese ─────────── */
		/**
		 * A forma do time é `identificar → paralelo → REDUZIR`, não um fan-out
		 * plano. Rodar tudo junto fez o Estrategista responder "não foi fornecido
		 * material" no primeiro run completo — ele terminava antes de os
		 * pesquisadores existirem.
		 *
		 * A ONDA DO MEIO é a novidade, e ela existe por um defeito medido, não por
		 * simetria: o Analista de Margem procurava insumo de copo térmico enquanto
		 * o Radar achava acrílico e MDF, porque os dois corriam ao mesmo tempo.
		 * Quem investiga CONCORRENTE, PORTFÓLIO, RECLAMAÇÃO, FOTO ou CUSTO precisa
		 * saber ANTES quais são os produtos e quem são os concorrentes — e isso
		 * não é paralelizável, é dependência de dado.
		 *
		 * Cada onda é uma BARREIRA: `await` fecha a anterior antes de a seguinte
		 * ser despachada, e o material vai crescendo (a onda 3 lê 1 e 2).
		 */
		const doCacheAgentesTexto = (
			(cachePayload as { agentes?: { chave?: string; texto?: string }[] })
				?.agentes ?? []
		).filter((x) => x?.texto);
		/**
		 * O que já estava no cache entra no material desde a PRIMEIRA virada, e
		 * DISPUTANDO A MESMA COTA de quem rodou agora.
		 *
		 * Duas coisas mudaram aqui, e a segunda é um defeito que a primeira criou:
		 *
		 * (1) antes o cache só alimentava a síntese, porque a síntese era a única
		 *     onda que recebia material. Agora a onda 2 também pesquisa em cima do
		 *     que a 1 achou — e um especialista aproveitado do cache é exatamente
		 *     alguém que "já achou". Deixá-lo de fora faria um run com cache quente
		 *     mandar a onda 2 investigar produto nenhum.
		 *
		 * (2) o texto do cache era CONCATENADO depois do digest e o conjunto
		 *     cortado no teto. Como o digest sozinho já usa o teto inteiro, o corte
		 *     caía 100% em cima do cache: num run com cache quente o material
		 *     reaproveitado — a única coisa que o aluno está pagando menos para ter
		 *     — nunca chegava a ninguém. Entrando como bloco, ele é repartido junto
		 *     e ninguém é apagado.
		 *
		 * Sem seção "Fontes": o payload do cache guarda a CONTAGEM, não as URLs de
		 * cada especialista. Escrever "(nenhuma)" ali diria ao Auditor que o
		 * material reaproveitado não tem fonte, que é falso.
		 */
		const doCacheBlocos = doCacheAgentesTexto.map((x) => ({
			nome: todos.find((a) => a.chave === x.chave)?.nome ?? String(x.chave),
			corpo: String(x.texto ?? ''),
		}));
		/** Chaves cujo material JÁ está no digest — alimentam o evento `onda`. */
		const doCacheChaves = doCacheAgentesTexto.map((x) => String(x.chave));

		const colher = (rs: PromiseSettledResult<ResultadoAgente>[]) =>
			rs
				.map((r) => (r.status === 'fulfilled' ? r.value : null))
				.filter((r): r is ResultadoAgente => r !== null);

		const ondas = ORDEM_DAS_ONDAS.map((fase) => ({
			fase,
			agentes: paraRodar.filter((a) => a.fase === fase),
		}));
		/**
		 * Quanto material cada onda RECEBE. A onda 1 não recebe nada (é ela que
		 * descobre); as outras duas têm tetos diferentes porque leem times de
		 * tamanhos diferentes com modelos de preços diferentes — ver as constantes.
		 */
		const TETO_POR_ONDA: Record<string, number> = {
			descoberta: 0,
			aprofundamento: TETO_DIGEST_ONDA2,
			sintese: TETO_DIGEST_ONDA3,
		};

		const resultados: ResultadoAgente[] = [];
		for (const onda of ondas) {
			if (onda.agentes.length === 0) continue;
			const teto = TETO_POR_ONDA[onda.fase] ?? TETO_DIGEST_ONDA3;
			/**
			 * O MATERIAL desta onda: tudo o que já entregou (as ondas anteriores)
			 * mais o cache, repartido dentro do teto.
			 *
			 * `montarDigest` REPARTE em vez de cortar no fim — com 17 especialistas
			 * alimentando a síntese, um `slice` cego apagaria a onda 2 inteira do
			 * que o Estrategista lê. Ver `repartirChars`.
			 */
			const material = teto
				? montarDigest(
						[...resultados.map(blocoDoResultado), ...doCacheBlocos],
						teto,
					)
				: undefined;

			/**
			 * A VIRADA DA ONDA — e é aqui que o "cruzando dados" da tela deixa de
			 * ser enfeite: `de` são as chaves cujo material está DENTRO do digest
			 * que esta onda acabou de receber, `para` são as que vão lê-lo. O feixe
			 * que a animação desenha corresponde a uma dependência que existe no
			 * motor. Na onda 1, `de` é vazio: nada a alimenta.
			 *
			 * O cacheado entra em `de` porque o texto dele está no digest de
			 * verdade — é a única coisa que um especialista aproveitado faz nesta
			 * execução.
			 */
			ctx.onProgress?.({
				kind: 'onda',
				fase: onda.fase,
				de: material
					? [
							...new Set([
								...resultados.filter((r) => r.ok).map((r) => r.chave),
								...doCacheChaves,
							]),
						]
					: [],
				para: onda.agentes.map((a) => a.chave),
			});

			resultados.push(
				...colher(
					await comLimite(
						onda.agentes.map(
							(a) => () =>
								rodarAgente(a, vars, palavras, budget, ctx, material),
						),
						p.concorrencia,
					),
				),
			);
		}

		const okCount = resultados.filter((r) => r.ok).length;
		const falhas = resultados.filter((r) => !r.ok);

		/**
		 * PISO DE SUCESSO. Abaixo dele o run FALHA — e o controller estorna. É a
		 * regra que evita cobrar 6 voxxys por um dossiê vazio.
		 */
		/**
		 * O piso é NOMINAL, não uma contagem.
		 *
		 * A versão anterior comparava `okCount` (total) com o NÚMERO de
		 * essenciais: com 2 essenciais e 7 entregas, passava mesmo que os DOIS
		 * essenciais tivessem falhado. Foi o que aconteceu — o Estrategista caiu,
		 * o run foi cobrado, e o dossiê saiu sem veredito nenhum.
		 */
		const essenciaisFalhos = paraRodar
			.filter((a) => a.essencial)
			.filter((a) => !resultados.some((r) => r.chave === a.chave && r.ok));

		if (essenciaisFalhos.length > 0 || okCount < piso) {
			const quem = essenciaisFalhos.map((a) => a.nome).join(', ');
			throw new ToolEngineError(
				502,
				quem
					? `${quem} não conseguiu concluir e sem isso o resultado não vale. Não cobramos por esta análise.`
					: `A pesquisa não voltou com o mínimo necessário (${okCount} de ${piso}). Não cobramos por isso.`,
			);
		}

		/* ── 4b. "Comece por estes produtos" ──────────────────────────────── */
		/**
		 * A resposta que o aluno veio buscar no escopo `mercado`.
		 *
		 * O Curador ESCOLHE (é o que modelo faz bem); a margem, a ordem e o
		 * descarte do que veio mal formado saem de `oportunidade.ts`, em
		 * TypeScript. O JSON cru continua em `agentes` — quem quiser auditar o que
		 * o especialista disse não fica dependendo da nossa normalização.
		 *
		 * SEM FALLBACK DE CACHE, e isto é decisão, não esquecimento. Havia aqui um
		 * `?? doCacheJson(CHAVE_CURADORIA)` justificado por escrito com "o Curador
		 * é `compartilhavel`" — o roster diz `compartilhavel: false` desde que se
		 * mediu o estrago: a saída dele é função do material DAQUELA execução (de
		 * quantos especialistas rodaram e de o Analista de Margem ter tido ou não
		 * busca), então servir a lista de um `mercado+rápido` de 2 voxxys a todo
		 * `mercado+profundo` de 6 voxxys da mesma categoria pelos 7 dias seguintes
		 * entrega lista de segunda mão pelo triplo do preço. O fallback já era
		 * código morto (`compartilhado` filtra por `r.compartilhavel`, e as linhas
		 * de cache conferidas não têm `curadoria`); o que ele guardava era o
		 * caminho de volta, caso alguém religasse a chave pela tela.
		 *
		 * Consequência assumida: o Curador roda em TODO run de mercado, inclusive
		 * com cache quente (Haiku, ~US$ 0,016). Se ele falhar, a seção não aparece
		 * — que é o estado honesto, e não uma lista velha com cara de nova.
		 */
		const doCacheJson = (chave: string) =>
			(
				cachePayload as { agentes?: { chave?: string; json?: unknown }[] }
			)?.agentes?.find((c) => c?.chave === chave)?.json;
		const jsonCuradoria = resultados.find(
			(r) => r.chave === CHAVE_CURADORIA && r.ok,
		)?.json;

		/**
		 * AS PÁGINAS QUE ESTE RUN DE FATO CITOU.
		 *
		 * É contra este conjunto que os links do Curador são conferidos. Ele roda
		 * com `motor_busca: 'nenhum'` — não abriu página nenhuma —, então todo
		 * endereço que ele escreve ou é cópia do digest ou é invenção plausível, e
		 * a única forma de separar os dois é comparar com o que foi citado de
		 * verdade. As do cache entram porque o material do cache também entrou no
		 * digest que ele leu.
		 */
		const fontesDoRun = (() => {
			const doCacheFontes = ((cachePayload as { fontes?: Citation[] })
				?.fontes ?? []) as Citation[];
			const mapa = new Map<string, Citation>();
			for (const f of [
				...doCacheFontes,
				...resultados.flatMap((r) => r.fontes),
			]) {
				if (f?.url) mapa.set(f.url, f);
			}
			return [...mapa.values()];
		})();
		const urlsCitadas = conjuntoDeUrls(fontesDoRun.map((f) => f.url));

		/**
		 * ┌─ A CONFERÊNCIA DOS LINKS ACONTECE AQUI, UMA VEZ, PARA TODO MUNDO ────┐
		 * │ É o primeiro ponto do run em que se sabe o que foi citado de verdade  │
		 * │ (a união do que rodou agora com o que veio do cache), e é ANTES de    │
		 * │ qualquer consumidor: `alvosDeFoto` não vai gastar vaga de foto        │
		 * │ abrindo página inventada, `normalizarProdutos` recebe o json já       │
		 * │ limpo, e o que sai em `output.agentes` — que é o que a tela lê — não  │
		 * │ tem mais um endereço sequer que o time não tenha aberto.              │
		 * │                                                                       │
		 * │ Vale para TODOS os especialistas, inclusive quem não pesquisa: ter    │
		 * │ citação não faz do que ele digita uma citação (é a mesma regra que    │
		 * │ `oportunidade.ts` aplica ao Curador de Oportunidades).                │
		 * └───────────────────────────────────────────────────────────────────────┘
		 */
		for (const r of resultados) {
			if (!r.ok || !r.json) continue;
			semLinkInventado(r.json, urlsCitadas);
			soVendidosNaPagina(r.json, fontesDoRun);
			if (r.chave === CHAVE_REFERENCIAS) soReferenciasComPagina(r.json);
		}

		/**
		 * O CUSTO QUE PODE VIRAR MARGEM — o que tem página, de QUEM O LEVANTOU.
		 *
		 * Conferir contra as citações DO PRÓPRIO especialista quando ele rodou
		 * agora: é o mais estrito possível, e é o que derruba a alucinação medida
		 * (rodando sem busca ele devolve loja e link plausíveis com ZERO
		 * citações). Só quando o custo vem do cache — onde as citações são
		 * gravadas em bloco, sem dono — vale a união do run.
		 *
		 * São DUAS fontes desde a onda 2 (ver `CHAVES_DE_CUSTO`), na ordem de
		 * preferência declarada lá: quem procurou o custo DOS PRODUTOS QUE A ONDA
		 * 1 ACHOU ganha de quem varreu o ramo em abstrato. `fundirCustos` derruba
		 * a duplicata — sem ele, as duas listas trariam a mesma caneca e o
		 * casamento ficaria AMBÍGUO, ou seja: acrescentar uma fonte de custo
		 * apagaria a margem dos produtos que passaram a ter custo duas vezes.
		 */
		const custoPorFonte = CHAVES_DE_CUSTO.map((chave) => {
			const res = resultados.find((r) => r.chave === chave && r.ok);
			const json = res?.json ?? doCacheJson(chave);
			const urls = res
				? conjuntoDeUrls(res.fontes.map((f) => f.url))
				: urlsCitadas;
			return { json, urls };
		});
		/**
		 * O custo por peça DECLARADO (`custo_peca_brl`) — o que o Curador copia.
		 *
		 * O primeiro que tiver um é o que vale: a lista está em ordem de
		 * preferência e o segundo falaria de outro insumo, não do mesmo com outro
		 * número.
		 */
		const custoDoInsumo = custoPorFonte.reduce<CustoComFonte | null>(
			(achado, f) => achado ?? custoComFonte(f.json, f.urls),
			null,
		);
		const produtosParaComecar = normalizarProdutos(jsonCuradoria, {
			custoComFonte: custoDoInsumo,
			// O especialista obediente devolve `custo_peca_brl: null` e o preço do
			// LOTE nos insumos; sem esta lista, a lista de produtos saía inteira sem
			// margem mesmo com o custo apurado e citado. Medido em run real.
			custosDeInsumos: fundirCustos(
				custoPorFonte.map((f) => custosDeInsumos(f.json, f.urls)),
			),
			urlsCitadas,
		});
		/**
		 * O aviso DIZ O QUE FALTOU, e não "alguns agentes rodaram sem busca".
		 *
		 * Quando a lista existe mas nenhum custo tem página, todos os cards saem
		 * com "não apurado" — e o aluno merece ler o motivo na seção de ressalvas
		 * em vez de deduzi-lo de um chip âmbar repetido cinco vezes.
		 *
		 * A condição olha o RESULTADO, não só `custoDoInsumo`: desde que o custo
		 * do Analista passou a valer apenas para produto feito DAQUELE insumo
		 * (ver `oportunidade.ts`), existe o caso "achei o custo da caneca com
		 * página, mas a lista é de troféu de acrílico e tábua de MDF" — nenhum
		 * card apurado, e o motivo continua sendo o mesmo para quem lê.
		 */
		if (
			produtosParaComecar.length > 0 &&
			produtosParaComecar.every((p) => p.custo_estimado_brl === null)
		) {
			budget.avisar(
				'Não achei o custo do material com fonte para estes produtos, então a sobra de cada um ficou como não apurada.',
			);
		}

		/* ── 5. preço: estatística em CÓDIGO ───────────────────────────────── */
		/**
		 * Junta o que ACABOU de ser coletado com o que já estava no cache.
		 *
		 * Sem essa junção o cache quente apagava o preço do dossiê: as observações
		 * vinham só dos agentes que rodaram agora, e com o Caçador de Preço
		 * cacheado sobravam zero — o aluno pagava e recebia um dossiê sem a única
		 * informação que ele foi buscar. Apareceu no terceiro run de teste.
		 *
		 * Dedupe por URL: a mesma página vista em duas execuções é UM anúncio,
		 * não dois, e contá-la duas vezes inflaria a amostra (e a confiança).
		 */
		const doCache = ((cachePayload as { observacoes?: PriceObservation[] })
			?.observacoes ?? []) as PriceObservation[];
		const agora = resultados
			.filter((r) => r.ok)
			.flatMap((r) => colherPrecos(r.fontes, r.chave));

		const porUrl = new Map<string, PriceObservation>();
		for (const o of [...doCache, ...agora]) {
			if (o?.url) porUrl.set(o.url, o);
		}

		/**
		 * Enriquece com o TÍTULO que os especialistas capturaram.
		 *
		 * O preço vem da citação (é o que garante que existe fonte); o título do
		 * anúncio vem do JSON do especialista, casado pela URL — é a referência
		 * de copy que o Redator usa, e a citação nem sempre traz.
		 *
		 * A FOTO NÃO VEM MAIS DAQUI, e a linha que a copiava (`alvo.imagem_url =
		 * img`) era o quarto caminho pelo qual uma URL inventada pelo modelo
		 * chegava à grade da tela — os outros três estavam fechados e este não.
		 * Hoje nem existe o que copiar: `semFotoDoModelo` apaga o campo na
		 * entrada. A foto destas observações é buscada na própria página, em
		 * `abrirPaginas`, logo abaixo.
		 */
		for (const r of resultados) {
			const j = r.json as {
				anuncios?: Record<string, unknown>[];
				produtos?: Record<string, unknown>[];
			} | null;
			for (const a of [...(j?.anuncios ?? []), ...(j?.produtos ?? [])]) {
				const url = typeof a?.url === 'string' ? a.url : '';
				const alvo = url ? porUrl.get(url) : undefined;
				if (!alvo) continue;
				const tit = a.titulo_anuncio ?? a.titulo ?? a.nome;
				if (!alvo.title && typeof tit === 'string' && tit.trim()) {
					alvo.title = tit.trim();
				}
			}
		}

		const candidatas = [...porUrl.values()];

		/**
		 * AS PÁGINAS SÃO ABERTAS ANTES DE `consolidarPrecos`, e a ordem inverteu.
		 *
		 * Era o contrário, e a economia estava certa PARA O MUNDO DE ANTES: com a
		 * foto sendo só enfeite, abrir a página de um anúncio que a poda de
		 * outlier ia descartar era gastar segundo à toa. Não vale mais. Abrir a
		 * página deixou de ser sobre a foto e passou a ser a PROVA de que aquela
		 * página é um anúncio (ver `colherPrecos`), e prova que chega depois da
		 * conta não prova nada: `consolidarPrecos` estaria tirando mediana de uma
		 * amostra ainda não verificada.
		 *
		 * O preço da inversão é abrir algumas páginas que a poda descarta depois —
		 * poucas, e todas elas páginas cujo número a gente ia afirmar na tela.
		 *
		 * ANTES de regravar o cache: assim a foto entra no payload e a próxima
		 * execução com cache quente já nasce com o dossiê ilustrado, de graça.
		 */
		/**
		 * Todo item com página, de TODO especialista que entregou.
		 *
		 * Era uma lista chumbada de dois campos (`produtos` do radar). Com 22
		 * especialistas e `saida` editável pela tela, enumerar nome de campo é
		 * combinar de esquecer: o portfólio do concorrente, a queixa com link e a
		 * referência visual nasceriam todos sem foto, sem erro nenhum. Ver
		 * `alvosDeFoto`.
		 *
		 * A galeria sai SEPARADA porque ela tem cota própria na fila — sem isso,
		 * as páginas dela entrariam atrás do ranking inteiro e a seção onde "mais
		 * imagens" foi pedido nasceria vazia num run em que o ranking veio cheio.
		 */
		const daGaleria: AlvoFoto[] = [];
		const doRestoDoTime: AlvoFoto[] = [];
		for (const r of resultados) {
			if (!r.ok) continue;
			/**
			 * O JSON CRU DO CURADOR FICA DE FORA, e não por economia de linha.
			 *
			 * O que a tela mostra dele é `produtos_para_comecar`, que já entra na
			 * primeira faixa da fila — e que passou por `normalizarProdutos`, onde
			 * o `url_exemplo` NÃO CITADO é descartado. O json cru ainda tem esse
			 * link, e varrê-lo aqui gastaria vaga de foto (e um segundo de
			 * relógio) abrindo uma página que o dossiê já decidiu não mostrar.
			 */
			if (r.chave === CHAVE_CURADORIA) continue;
			(r.chave === CHAVE_REFERENCIAS ? daGaleria : doRestoDoTime).push(
				...alvosDeFoto(r.json),
			);
		}
		/**
		 * "Comece por estes produtos" entra PRIMEIRO na fila da foto, COM COTA.
		 *
		 * O teto de páginas abertas é de RELÓGIO (`tetoDeFotos`), e no escopo
		 * `mercado` esta é a primeira seção da tela — card sem foto ali parece
		 * ferramenta quebrada, enquanto no ranking de anúncios parece só um
		 * anúncio sem capa. A cota (`TETO_FOTOS_CURADORIA`) existe porque
		 * prioridade sem teto é fome do resto: 12 produtos na frente deixariam
		 * seis vagas para o ranking, que antes tinha catorze.
		 *
		 * O par get/set existe porque `abrirPaginas` grava no objeto que recebe:
		 * o campo do produto se chama `url_exemplo`, não `url`, e copiar o objeto
		 * faria a foto ser escrita numa cópia e sumir.
		 */
		const alvosCuradoria: AlvoFoto[] = produtosParaComecar.map((prod) => ({
			url: prod.url_exemplo,
			get imagem_url() {
				return prod.imagem_url;
			},
			set imagem_url(v: unknown) {
				prod.imagem_url = String(v);
			},
		}));
		const inspecao = await abrirPaginas(
			candidatas,
			alvosCuradoria,
			daGaleria,
			doRestoDoTime,
			urlsCitadas,
			budget,
			ctx,
		);

		/**
		 * O PRODUTO CURADO HERDA A FOTO DO ITEM QUE O TIME ABRIU.
		 *
		 * O Curador não pesquisa: ele ESCOLHE entre o que os outros trouxeram.
		 * Então ele quase nunca tem página própria, e sem página não há
		 * `og:image` para buscar — no escopo `mercado` isso deixava a seção
		 * principal do dossiê com todos os cartões sem foto, que foi exatamente o
		 * que o dono do produto viu na tela e reprovou.
		 *
		 * A foto herdada NÃO é invenção: é a mesma peça, e a imagem veio de uma
		 * página que o time de fato abriu e que passou pela conferência de bytes.
		 * O que se copia junto é a PÁGINA de origem — foto sem a página dela seria
		 * uma afirmação sem prova, e a tela usa as duas como par.
		 *
		 * O casamento é por nome normalizado, e exige unicidade: dois itens
		 * diferentes com o mesmo nome não decidem nada, e no ambíguo o certo é o
		 * cartão continuar sem foto.
		 */
		const comFoto = new Map<string, { foto: string; pagina: string }>();
		for (const r of resultados) {
			if (!r.ok || !r.json) continue;
			for (const item of objetosDe(r.json)) {
				const foto = typeof item.imagem_url === 'string' ? item.imagem_url : '';
				const pagina = typeof item.url === 'string' ? item.url : '';
				if (!foto || !pagina) continue;
				for (const bruto of [item.nome, item.produto, item.titulo_anuncio]) {
					const k = chaveDeNome(bruto);
					if (!k) continue;
					// Nome repetido em itens diferentes: marca como ambíguo e sai.
					const ja = comFoto.get(k);
					if (ja && ja.foto !== foto) comFoto.set(k, { foto: '', pagina: '' });
					else if (!ja) comFoto.set(k, { foto, pagina });
				}
			}
		}
		let herdadas = 0;
		for (const prod of produtosParaComecar) {
			if (prod.imagem_url) continue;
			const achado = comFoto.get(chaveDeNome(prod.nome));
			if (!achado?.foto) continue;
			prod.imagem_url = achado.foto;
			// Só sobrescreve o link quando o produto não tinha um conferido.
			if (!prod.url_exemplo) prod.url_exemplo = achado.pagina;
			herdadas++;
		}
		if (herdadas > 0) {
			ctx.onProgress?.({ kind: 'fotos', n: herdadas });
		}

		// E o que a herança não cobriu ganha uma busca própria — ver o cabeçalho
		// de `cacarFotoDosProdutos` para o porquê de ela ser a última tentativa.
		await cacarFotoDosProdutos(
			produtosParaComecar,
			// Modelo BARATO com busca: o trabalho aqui é apontar para um link que o
			// buscador já achou, não redigir — e quem confere o link é o código.
			resolveTextModel('google/gemini-3.1-flash-lite', {
				needsWebSearch: true,
			}),
			budget,
			ctx,
		);

		/**
		 * ┌─ A PENEIRA: SÓ VIRA "ANÚNCIO" O QUE A PÁGINA ASSINOU ────────────────┐
		 * │ Aqui a candidata deixa de ser "um R$ que apareceu numa página citada" │
		 * │ e vira observação de preço de mercado — ou não vira nada.             │
		 * │                                                                       │
		 * │ Página que não abriu cai junto com a que abriu e não é anúncio, e é    │
		 * │ de propósito: o dossiê afirma "N anúncios com preço e link", e um      │
		 * │ link que não responde não sustenta afirmação nenhuma. `false` NÃO é    │
		 * │ erro — é a tela dizendo "não achei anúncios suficientes para cravar    │
		 * │ um preço" e oferecendo ao aluno informar por quanto ele viu vendendo   │
		 * │ (ver `faixaConfiavel`). Meio dossiê honesto vale mais que um dossiê    │
		 * │ inteiro inventado.                                                     │
		 * │                                                                       │
		 * │ MEDIDO reabrindo as 111 observações dos 9 runs gravados: no escopo     │
		 * │ `mercado` sobra ZERO das 40 (eram tabela de comissão, exemplo de       │
		 * │ artigo fiscal, frete dito num vídeo e página de categoria — a tela     │
		 * │ imprimia "12 anúncios com preço e link" e cravava mediana R$ 36,50);   │
		 * │ no escopo `produto` sobram 7 de 25, 12 de 27, 5 de 10 e 5 de 9, todas  │
		 * │ acima do `MIN_AMOSTRA`. Some a faixa que era mentira, fica de pé a     │
		 * │ que era verdade.                                                       │
		 * └───────────────────────────────────────────────────────────────────────┘
		 */
		const observacoes = candidatas.filter(
			(o) => inspecao.get(o.url)?.anuncio === true,
		);
		const naoProvadas = candidatas.length - observacoes.length;
		const { stats, usadas } = consolidarPrecos(observacoes);
		/**
		 * A RESSALVA SÓ SAI QUANDO ELA EXPLICA O QUE O ALUNO ESTÁ VENDO.
		 *
		 * `avisos` é a seção "O que este dossiê NÃO garante", e a regra do campo
		 * é dura: ressalva sobre o RESULTADO, nunca sobre como se chegou nele
		 * (isso é `budget.diagnosticos`, que morre no log). Com a faixa de pé e
		 * oito anúncios de verdade na tela, "descartei 14 páginas" não ressalva
		 * coisa nenhuma — é contabilidade nossa, e enche a seção de ruído.
		 *
		 * Sem a faixa, é o contrário: sem esta frase o aluno lê "não achei
		 * anúncios suficientes para cravar um preço" sem uma palavra de por quê,
		 * logo abaixo de uma lista de fontes cheia. Aí a ressalva É a resposta.
		 */
		if (naoProvadas > 0 && !faixaConfiavel(stats)) {
			// A conta é "de quantas, quantas caíram": dizer só as que caíram
			// esconderia que uma ou duas ficaram de pé, e o aluno leria "não achei
			// nada" onde o certo é "achei pouco".
			//
			// A concordância é feita à mão porque o caso de UMA acontece de verdade
			// — o run frio de `mercado+rápido` imprimiu "Das 1 páginas com preço que
			// achei, 1 não abriram", numa seção que o aluno lê como texto de gente.
			const frase =
				candidatas.length === 1
					? 'A única página com preço que achei não abriu ou não era um anúncio de verdade — era artigo, vídeo ou página de categoria.'
					: naoProvadas === 1
						? `Das ${candidatas.length} páginas com preço que achei, uma não abriu ou não era um anúncio de verdade — era artigo, vídeo ou página de categoria.`
						: `Das ${candidatas.length} páginas com preço que achei, ${naoProvadas} não abriram ou não eram anúncios de verdade — eram artigo, vídeo ou página de categoria.`;
			budget.avisar(
				`${frase} Sobrou pouco para cravar uma faixa de mercado, e prefiro não cravar.`,
			);
		}

		/* ── 6. regrava o cache ────────────────────────────────────────────── */
		/**
		 * O QUE PODE ENVELHECER 7 DIAS: só o que tem PÁGINA por trás.
		 *
		 * `ok && compartilhavel` não bastava, e o furo foi reproduzido: um
		 * pesquisador que volta com ZERO citações (busca vazia, ou o freio de
		 * orçamento tendo tirado a busca dele) escreve de memória — no Analista
		 * de Margem isso deu "Chapa de MDF Cru 3mm — R$ 79,90 — Leo Madeiras" com
		 * URL fabricada, 2 de 2 medidas. Gravado, esse texto voltava por 7 dias
		 * com o selo "pesquisa reaproveitada", que a tela lê como conferido: o
		 * run que INVENTOU mostrava âmbar honesto, e o run seguinte, com o mesmo
		 * dado e nenhuma citação a mais, mostrava número e link clicáveis.
		 *
		 * Quem é consultor por desenho (`motor_busca: 'nenhum'`, como o Analista
		 * de Riscos) continua entrando: dele nunca se esperou citação, e o
		 * conhecimento técnico é o produto.
		 */
		const compartilhado = resultados.filter(
			(r) =>
				r.ok && r.compartilhavel && (!r.pesquisador || r.fontes.length > 0),
		);
		if (cacheavel && compartilhado.length > 0) {
			try {
				const cfgP = resolveCollection(doc, p.pesquisas_collection);
				// FUNDE: o que o cache já tinha + o que rodou agora. Sem isso, uma
				// execução profunda depois de uma rápida sobrescreveria o cache e
				// perderia os agentes que a rápida havia coletado.
				const antigos = (
					(cachePayload as { agentes?: { chave?: string }[] })?.agentes ?? []
				).filter(
					(x) => x?.chave && !compartilhado.some((r) => r.chave === x.chave),
				);
				const payload = JSON.stringify({
					agentes: [
						...antigos,
						...compartilhado.map((r) => ({
							chave: r.chave,
							json: r.json,
							texto: r.texto?.slice(0, 4_000),
							/**
							 * QUANTAS PÁGINAS ESTE especialista citou quando rodou.
							 *
							 * O payload guardava só `{chave, json, texto}`, e na volta o
							 * bloco devolvia `n_fontes: 0` chumbado para todo agente
							 * servido do cache. A tela, sem como distinguir "veio do cache"
							 * de "não abriu página nenhuma", precisou tratar `do_cache`
							 * como prova de apuração — e aí bastava um run cego gravar
							 * para o número inventado voltar como fato pelos 7 dias
							 * seguintes. Guardando a contagem, "tem fonte" continua sendo
							 * uma pergunta respondível depois.
							 */
							n_fontes: r.fontes.length,
							/**
							 * AS PÁGINAS, e não só quantas — para a pesquisa reaproveitada
							 * poder ser CONFERIDA, não só contada.
							 *
							 * Pedido do dono do produto olhando um run com cache quente:
							 * "uma pesquisa que já tinha sido feita e aproveitada, temos que
							 * apontar as fontes que temos ali da mesma maneira, para que a
							 * pessoa possa ver pesquisas já registradas". A contagem sozinha
							 * dizia "confie, ele abriu 10 páginas"; a lista deixa o aluno
							 * abrir as mesmas 10 e conferir — que é a promessa do dossiê
							 * inteiro, e ela não pode valer menos porque o trabalho é de
							 * três dias atrás.
							 *
							 * 12 por especialista: o payload é uma linha de jsonb e o dossiê
							 * já mostra no máximo essa ordem de grandeza por cartão.
							 */
							fontes: r.fontes
								.slice(0, 12)
								.map((f) => ({ url: f.url, title: f.title })),
						})),
					],
					// Já é a união (cache + agora), então regravar não perde histórico.
					price_stats: stats,
					observacoes: usadas.slice(0, 40),
				});
				const dados = {
					cache_key: cacheKey,
					categoria_slug: categoriaSlug,
					uf: String(vars.uf ?? 'BR'),
					versao_prompt: VERSAO_PROMPT,
					// Campo de `data`, e não `created_at`: "atualizar agora" é UPDATE na
					// mesma chave, e o `created_at` ficaria congelado na primeira vez.
					gerado_em: new Date().toISOString(),
					payload,
					fontes: JSON.stringify(
						(() => {
							const doCache = ((cachePayload as { fontes?: Citation[] })
								?.fontes ?? []) as Citation[];
							const mapa = new Map<string, Citation>();
							for (const f of [
								...doCache,
								...compartilhado.flatMap((r) => r.fontes),
							]) {
								if (f?.url) mapa.set(f.url, f);
							}
							return [...mapa.values()].slice(0, 80);
						})(),
					),
					n_anuncios: stats?.n ?? 0,
					confianca: stats?.confianca ?? 0,
					custo_usd: budget.gasto().usd,
				};

				const achados = await repo.list(p.tool, p.pesquisas_collection, cfgP, {
					viewer: { customerId: ctx.customerId, isStaff: true },
					filters: { cache_key: { kind: 'eq', value: cacheKey } },
					pageSize: 1,
					page: 1,
				});
				const existente = achados.items[0];
				if (existente) {
					await repo.update(existente.id, p.tool, p.pesquisas_collection, {
						data: dados,
					});
				} else {
					await repo.create({
						toolKey: p.tool,
						collection: p.pesquisas_collection,
						title: categoriaSlug,
						data: dados,
						status: 'approved',
						// Cache é de TODO MUNDO: sem dono, senão o filtro "meus" de um
						// aluno passaria a devolver a pesquisa compartilhada como dele.
						ownerId: null,
						visibility: 'public',
						createdBy: ctx.customerId,
					});
				}
			} catch (err) {
				// Falhar ao gravar o cache não pode derrubar um run que deu certo.
				console.warn('[research] não consegui gravar o cache', err);
			}
		}

		const gasto = budget.gasto();
		ctx.onProgress?.({
			kind: 'time_concluido',
			ok: okCount,
			falhas: falhas.length,
			buscas: gasto.buscas,
			ms: gasto.ms,
		});

		/**
		 * OS ESPECIALISTAS DO CACHE VOLTAM PARA A SAÍDA.
		 *
		 * É a raiz de três bugs seguidos — preço sumindo, "TODAS AS FONTES (0)" e
		 * o ranking do ramo não aparecendo. Com cache quente, os especialistas
		 * compartilhados não rodam, então não estavam em `agentes` — e a tela, que
		 * lê tudo de lá, mostrava um dossiê vazio como se a pesquisa tivesse
		 * falhado. Consertar caso a caso na tela seria remendo: o contrato certo é
		 * a saída ser IGUAL, com cache quente ou frio.
		 */
		const doCacheAgentes = (
			(
				cachePayload as {
					agentes?: {
						chave?: string;
						json?: unknown;
						texto?: string;
						n_fontes?: number;
						fontes?: Citation[];
					}[];
				}
			)?.agentes ?? []
		).filter(
			(c) =>
				c?.chave &&
				!resultados.some((r) => r.chave === c.chave) &&
				/**
				 * SÓ QUEM ESTÁ NO TIME DESTA EXECUÇÃO.
				 *
				 * O cache é gravado por categoria e pode ter material de um run
				 * PROFUNDO anterior. Sem este filtro, um run rápido que prometeu
				 * cinco profissionais devolvia um dossiê com doze cartões — vindos
				 * de gente que o aluno nunca viu trabalhando. Com ele vale a
				 * invariante: `output.agentes` é exatamente o time do evento
				 * `time_montado`, com cache quente ou frio.
				 */
				time.some((a) => a.chave === c.chave),
		);

		const cacheados = doCacheAgentes.map((c) => {
			const spec = todos.find((a) => a.chave === c.chave);
			return {
				chave: String(c.chave),
				nome: spec?.nome ?? String(c.chave),
				icone: spec?.icone ?? 'search',
				cor: spec?.cor ?? '#f59e0b',
				ok: true,
				ms: 0,
				modelo: undefined as string | undefined,
				/**
				 * O BLOCO DO CACHE PASSA PELO MESMO PORTÃO DE LINK.
				 *
				 * Ele foi gravado por um run anterior e devolve os endereços que
				 * AQUELE modelo escreveu — inventados na mesma proporção. Sem esta
				 * linha, bastava a segunda execução da mesma categoria para o link
				 * fabricado voltar por sete dias, e voltar com o selo "pesquisa
				 * reaproveitada", que a tela lê como conferido. As citações do run
				 * incluem as do cache (ver `fontesDoRun`), então o que era real
				 * quando foi gravado continua de pé.
				 */
				json: c.json
					? (() => {
							const j = semLinkInventado(c.json, urlsCitadas);
							return c.chave === CHAVE_REFERENCIAS
								? soReferenciasComPagina(j)
								: j;
						})()
					: null,
				/**
				 * A CONTAGEM REAL DE QUANDO ELE RODOU — não um zero chumbado.
				 *
				 * Era zero para todo agente do cache, e isso obrigava a tela a
				 * tratar `do_cache` como prova de apuração (senão todo bloco
				 * reaproveitado apareceria como "não abriu página nenhuma"). O
				 * preço dessa gambiarra era exato: bastava um run cego gravar, e
				 * o número inventado voltava com número e link clicáveis.
				 *
				 * Linha antiga, gravada antes deste campo, conta 0: "não sei"
				 * cai para o lado seguro, e ela expira em no máximo 7 dias.
				 */
				n_fontes: Math.max(0, Number(c.n_fontes ?? 0)) || 0,
				/**
				 * AS PÁGINAS, para o dossiê poder LISTÁ-LAS — não só contá-las.
				 *
				 * O cartão do especialista reaproveitado mostrava o número e o
				 * dossiê não tinha como abrir nenhuma delas: "confie, ele leu dez
				 * páginas". A promessa desta ferramenta é o contrário — todo
				 * número tem link —, e ela não pode valer menos porque o trabalho
				 * foi feito três dias atrás.
				 */
				fontes: Array.isArray(c.fontes)
					? c.fontes.filter((f) => f?.url).slice(0, 12)
					: [],
				erro: null as string | null,
				/** A tela avisa que este bloco veio da pesquisa reaproveitada. */
				do_cache: true,
			};
		});

		/**
		 * O DIAGNÓSTICO SAI NO LOG, e é aqui que ele deixa de ser jogado fora.
		 *
		 * Retry, troca de modelo, freio de custo e relógio apertado explicam por
		 * que um run custou o que custou — informação que a gente precisa e que o
		 * aluno não comprou. Uma linha só, com o gasto do run junto, para que
		 * "este run custou US$ 0,36" e "por quê" fiquem lado a lado no log.
		 */
		if (budget.diagnosticos.length > 0) {
			console.warn(
				`[research] ${p.escopo}+${p.modo} US$ ${gasto.usd.toFixed(4)} · ${budget.diagnosticos.join(' | ')}`,
			);
		}

		return {
			agentes: [...cacheados, ...resultados].map((r) =>
				'do_cache' in r
					? r
					: {
							chave: r.chave,
							nome: r.nome,
							icone: r.icone,
							cor: r.cor,
							ok: r.ok,
							ms: r.ms,
							/**
							 * O `modelo` NÃO SAI DAQUI.
							 *
							 * Ele existe em `ResultadoAgente` porque o retry troca de
							 * modelo e o diagnóstico precisa saber qual respondeu — isso
							 * é conta nossa. Na SAÍDA ele viajava 42 vezes por run
							 * profundo (`anthropic/claude-sonnet-5`,
							 * `google/gemini-3.1-flash-lite`) dentro do payload que o
							 * browser recebe: nenhum componente da tela lê o campo, e um
							 * "ver código-fonte" entregava nome de modelo ao aluno que
							 * comprou um time de profissionais.
							 */
							json: r.json ?? null,
							n_fontes: r.fontes.length,
							erro: r.erro ?? null,
							do_cache: false,
						},
			),
			digest: montarDigest(resultados.map(blocoDoResultado), TETO_DIGEST_CHARS),
			/**
			 * Resumo CURTO para o histórico.
			 *
			 * O `digest` é o material inteiro do time e passa de 20 mil caracteres —
			 * gravá-lo no campo `resumo` da coleção derrubava o run com 400 no fim,
			 * depois de a pesquisa já ter sido paga. O card do histórico só precisa
			 * de uma linha; o material completo vai para `raw`.
			 */
			resumo_curto: (() => {
				const est = resultados.find((r) => r.chave === 'estrategista');
				const j = est?.json as
					| { nota?: number; veredito?: string; resumo_simples?: string }
					| undefined;
				const partes = [
					j?.nota !== undefined ? `Nota ${j.nota}/100` : '',
					j?.veredito ?? '',
					j?.resumo_simples ?? '',
				].filter(Boolean);
				return (
					partes.join(' — ').slice(0, 4_000) ||
					montarDigest(
						resultados.map(blocoDoResultado),
						TETO_DIGEST_CHARS,
					).slice(0, 4_000)
				);
			})(),
			/** Dossiê inteiro, já cortado no teto do campo da coleção. */
			dossie_json: JSON.stringify({
				agentes: resultados.map((r) => ({ chave: r.chave, json: r.json })),
			}).slice(0, 19_000),
			/**
			 * A seção "Comece por estes produtos", já com margem calculada em
			 * TypeScript e na ordem que o CÓDIGO decidiu. É o que a tela lê; o JSON
			 * cru do Curador continua disponível em `agentes` para auditoria.
			 */
			produtos_para_comecar: produtosParaComecar,
			/** "Não achei custo de insumo para nenhum destes" — a ressalva do Curador. */
			produtos_observacao: extrairObservacao(jsonCuradoria),
			cache: cachePayload,
			cache_quente: cacheQuente,
			cache_idade_dias: cacheIdadeDias,
			price_stats: stats,
			// `faixaConfiavel` é o que a tela consulta para decidir entre mostrar a
			// faixa e dizer "não achei anúncios suficientes para cravar um preço".
			preco_confiavel: faixaConfiavel(stats),
			observacoes: usadas,
			/**
			 * União das fontes de AGORA com as do cache — a MESMA lista que serviu
			 * para conferir os links do Curador (`fontesDoRun`).
			 *
			 * Mesma classe de bug que já apagou o preço: com cache quente, só os
			 * agentes que rodaram nesta execução tinham fontes, e o dossiê saía
			 * com "TODAS AS FONTES (0)" logo abaixo de sete anúncios com link.
			 * Dedupe por URL — a mesma página vista em duas execuções é uma fonte.
			 *
			 * SEM O `content`: o trecho raspado é insumo DESTE bloco (é dele que
			 * `colherPrecos` tira o `R$`) e não tem um consumidor sequer na tela —
			 * a lista "Todas as fontes" mostra endereço e título. Eram 77 a 109 KB
			 * por run indo ao browser sem ninguém para ler, e junto ia o que a
			 * busca raspou de dentro de doc de API (`curl`, `Bearer $TOKEN`).
			 * Continua inteiro no cache, onde ele de fato serve.
			 */
			fontes: fontesDoRun.map((f) => ({ url: f.url, title: f.title })),
			/**
			 * O NOME da marca que temperou este run, ou `''`.
			 *
			 * Não é enfeite de tela: é a única maneira de responder "o anúncio saiu
			 * com a identidade dele?" olhando a resposta, em vez de deduzindo pelo
			 * texto. Sem isto, uma marca que não foi lida (a tool dona em draft, o
			 * `collection.query` engolindo o erro por ser `optional`, o aluno sem
			 * cadastro) produz exatamente o mesmo dossiê de antes — e a diferença
			 * entre "não tem marca" e "a marca não chegou" some.
			 *
			 * Só o NOME: o resto da identidade é dado do aluno e não tem consumidor
			 * fora do prompt.
			 */
			marca_usada:
				typeof marca?.nome === 'string' ? marca.nome.slice(0, 120) : '',
			ok_count: okCount,
			falhas: falhas.map((f) => ({
				chave: f.chave,
				nome: f.nome,
				erro: f.erro,
			})),
			buscas: gasto.buscas,
			custo_usd: Number(gasto.usd.toFixed(4)),
			/**
			 * AS RESSALVAS DELE — e só elas.
			 *
			 * `dossie.tsx` imprime esta lista verbatim na etapa "O que este dossiê
			 * NÃO garante". O que conta COMO chegamos ao resultado (retry, troca de
			 * modelo, teto de gasto, relógio apertado) sai por `budget.diagnosticos`
			 * e morre no log — ver o comentário de `diagnosticos` em budget.ts.
			 */
			avisos: budget.avisos,
		};
	},
};
