import { z } from 'zod';
import {
	Budget,
	comLimite,
	estimarCustoUsd,
} from '../../lib/agent-team/budget.js';
import {
	bool,
	interpolar,
	montarDigest,
	ORDEM_DAS_ONDAS,
	pisoDeSucesso,
} from '../../lib/agent-team/core.js';
import {
	ChamadaError,
	type Citation,
	chamarModelo,
	escolherAlternativo,
	FALHA_PARA_TELA,
	gastoDeFalha,
} from '../../lib/agent-team/llm.js';
import {
	type ArtAgentSpec,
	CHARS_POR_IMAGEM,
	CONCORRENCIA_PADRAO,
	LIMITES_ATELIE,
	montarTimeDoAtelie,
	TETO_DE_AGENTES,
	toArtAgentSpec,
} from '../../lib/atelie/agents.js';
import {
	CHAVE_DIRETOR_ARTE,
	CHAVE_LEITOR_MARCA,
	CHAVE_LEITOR_PRODUTO,
	CHAVE_LEITOR_REFERENCIAS,
	CHAVE_PROMPT_FINAL,
	CHAVE_REDATOR,
	comporPrompt,
	extrairCopy,
	extrairPrompt,
} from '../../lib/atelie/saidas.js';
import { extractJson } from '../../lib/llm-json.js';
import { escolherMarca, varsDaMarca } from '../../lib/marca.js';
import {
	resolveTextModel,
	type TextModelEntry,
} from '../../lib/text-models-catalog.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { BlockRunContext, ToolBlock } from '../types.js';

/**
 * `ai.art_team` — O TIME DO ATELIÊ, e ele entrega O PROMPT, não a imagem.
 *
 * ┌─ A DECISÃO MAIS IMPORTANTE DESTE BLOCO ─────────────────────────────────┐
 * │ Ele podia gerar a arte no fim e devolver o PNG. Não gera, e isso é       │
 * │ contrato, não preguiça:                                                  │
 * │                                                                          │
 * │  • QUEM MANDA NO MODELO, NO FORMATO E NO CUSTO CONTINUA SENDO A          │
 * │    DEFINITION. O nó seguinte é um `ai.image_studio` comum, com o         │
 * │    `model` que o admin escolheu na Fábrica e o `aspect`/`width`/`height` │
 * │    que a tela pediu. Enfiar a geração aqui dentro faria o time carregar  │
 * │    um segundo catálogo de modelos e um segundo lugar onde o formato do   │
 * │    Story pode sair errado.                                               │
 * │                                                                          │
 * │  • O BLOCO FICA TESTÁVEL SEM QUEIMAR GERAÇÃO. Um teste do time é seis    │
 * │    chamadas de texto dubláveis; um teste do time+imagem exigiria dublar  │
 * │    o gerador ou pagar a arte para conferir um parágrafo.                 │
 * │                                                                          │
 * │  • O PREVIEW NÃO COBRADO (`/api/tool-run/:key/preview`) passa a poder    │
 * │    rodar o time sem gastar geração de imagem.                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ COMO ISTO SE LIGA NO PIPELINE ─────────────────────────────────────────┐
 * │  1. `collection.query`  → a marca do aluno (`perfil/marca`)              │
 * │  2. `ai.art_team`       → `prompt_final`, `titulo`, `legenda`, `agentes` │
 * │  3. `ai.image_studio`   → `set_prompt: <nó do time>.prompt_final`        │
 * │                                                                          │
 * │ ARMADILHA DA DEFINITION (custou uma rodada na Central): `output` é       │
 * │ ALLOW-LIST. Chave emitida aqui e não listada lá é calculada, PAGA e      │
 * │ jogada fora sem erro. O mapa completo do que este bloco emite está em    │
 * │ `SAIDAS` (logo abaixo) — quem escrever a definition tem que listar todas │
 * │ as que a tela lê.                                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * O resto é a arquitetura do time da Central, com a política deste produto:
 * roster lido da coleção pelo REPOSITÓRIO (a coleção é `visibility:'staff'`,
 * porque os prompts são o produto), `montarTime`, três ondas com barreira,
 * digest crescente, progresso ao vivo e piso de sucesso.
 */

/**
 * O QUE ESTE BLOCO EMITE — e o que a definition tem que listar em `output`.
 *
 * ┌─ cada especialista tem o SEU ponto de render, e a regra é dura ─────────┐
 * │ "Todo especialista pago precisa de ponto de render na tela" reprovou     │
 * │ quatro rodadas da Central. Aqui isso se lê assim:                        │
 * │                                                                          │
 * │  Leitor do Produto ...... `ficha_produto`     (+ cartão em `agentes`)    │
 * │  Leitor da Marca ........ `regras_visuais`    (+ cartão em `agentes`)    │
 * │  Leitor das Referências . `referencias_lidas` (+ cartão em `agentes`)    │
 * │  Diretor de Arte ........ `direcao_arte`      (+ cartão em `agentes`)    │
 * │  Redator ................ `titulo`, `chamada`, `legenda`, `hashtags`,    │
 * │                           `texto_na_arte`                                │
 * │  Prompt Final ........... `prompt_final`, `prompt_negativo`,             │
 * │                           `por_que_assim`                                │
 * │                                                                          │
 * │ `agentes` é a MESA DE CRIAÇÃO e é o contrato genérico: ele carrega TODOS │
 * │ os que rodaram, inclusive um sétimo que o admin cadastre amanhã. Os      │
 * │ campos nomeados acima são atalhos para os seis de hoje — se um deles for │
 * │ renomeado na coleção, o atalho some e o cartão dele continua de pé.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export const SAIDAS = [
	'agentes',
	'briefing',
	'ficha_produto',
	'regras_visuais',
	'referencias_lidas',
	'direcao_arte',
	'titulo',
	'chamada',
	'legenda',
	'hashtags',
	'texto_na_arte',
	'prompt_final',
	'prompt_negativo',
	'por_que_assim',
	'marca_usada',
	'marca_logo_url',
	'ok_count',
	'falhas',
	'avisos',
	'custo_usd',
	'ms',
] as const;

/**
 * Quantos registros da coleção `agentes` o bloco lê.
 *
 * 60 para um time de 6: a coleção guarda também os desativados (o seed DESLIGA
 * quem saiu do time em vez de apagar) e o admin pode ter rascunhos. Uma página
 * curta não dá erro — ela devolve menos especialistas, o time monta menor do
 * que o prometido e a mesa de criação anuncia seis entregando quatro.
 */
const PAGINA_DO_ROSTER = 60;

/**
 * Quanto material cada onda RECEBE, em caracteres.
 *
 * ONDA 2 lê os três leitores. Cada ficha cabe em ~2,5 mil caracteres — é o
 *   bastante para dizer o que é o produto, que material, que ângulo, que cores
 *   a marca manda usar e o que os anúncios de referência fazem com o texto.
 * ONDA 3 lê os cinco anteriores. O Prompt Final precisa do material inteiro:
 *   ele é quem transforma cinco fichas numa frase só.
 *
 * A conta em dinheiro: 12 mil caracteres = 3 mil tokens; no modelo mais caro
 * que faz sentido aqui (Sonnet, US$ 2/M na entrada) são US$ 0,006 por chamada
 * da onda 3, e ela é UMA. Ver `montarDigest`: o teto é REPARTIDO entre os
 * especialistas, não cortado no fim.
 */
export const TETO_DIGEST_ONDA2 = 8_000;
export const TETO_DIGEST_ONDA3 = 12_000;
/** Cinto de segurança dentro de `rodarAgenteDeArte`. Fica ACIMA do maior teto. */
const MAX_CHARS_MATERIAL = 20_000;

// O motor injeta `null` num input de imagem não preenchido (`coerceInputs`), e
// só `z.instanceof(Buffer)` recusaria o caminho "não subi referência nenhuma".
const imagemOpcional = z.union([z.instanceof(Buffer), z.null(), z.undefined()]);

/**
 * `z.coerce.boolean()` NÃO SERVE aqui: `Boolean('false')` é `true`, e um
 * parâmetro que a definition escreve como a string `"false"` ligaria a busca em
 * todo run. A leitura é a mesma do roster (`bool`, em `agent-team/core.ts`).
 */
const ligado = z
	.unknown()
	.optional()
	.transform((v) => bool(v));

const schema = z.object({
	/** Tool dona da coleção `agentes`. */
	tool: z.string().min(1).max(60),
	agentes_collection: z.string().min(1).max(40).default('agentes'),
	/** A foto do produto do aluno. Quem declarou `entrada:'foto_produto'` a vê. */
	foto_produto: imagemOpcional,
	/**
	 * Os anúncios de referência ("um anúncio que você gostou").
	 *
	 * Três parâmetros e não uma lista porque o resolvedor do motor é RASO: uma
	 * referência dentro de array/objeto aninhado viaja literal (ver `set_<campo>`
	 * em `tool-engine`). Três inputs de imagem é como `ai.image_studio` já
	 * recebe as dele, e é o que a tela do Ateliê promete (até 2, com folga).
	 */
	referencia: imagemOpcional,
	referencia2: imagemOpcional,
	referencia3: imagemOpcional,
	/**
	 * A MARCA DO ALUNO — saída de um `collection.query` em `perfil/marca` (o
	 * contêiner do cadastro, ver `lib/marca.ts`). Ausente = time sem marca, que é caminho de
	 * primeira classe (ver `lib/marca.ts`). Quem lê a marca é `lib/marca.ts`, e
	 * ela chega aos especialistas como `{marca}` na `pergunta` do roster.
	 */
	marca: z.unknown().optional(),
	/** JSON com o que o aluno digitou: `{produto, publico, objetivo, ...}`. */
	vars: z.string().default('{}'),
	/**
	 * O CAMINHO escolhido, em slug: `post`, `anuncio`, `cena` ou `gravar`.
	 *
	 * Serve a duas coisas: filtrar o roster (um especialista pode declarar
	 * `entrega: 'gravar'` e só entrar naquele caminho) e alimentar `{entrega}`
	 * quando a definition não mandar a frase. Vazio = ninguém é filtrado.
	 */
	entrega: z.string().max(60).default(''),
	/**
	 * A FRASE do caminho ("um post para redes"), que é o que entra em
	 * `{entrega}` no pedido de cada especialista.
	 *
	 * Existe separada do slug porque o roster escreve "uma arte de {entrega}", e
	 * "uma arte de post" é o tipo de frase torta que o modelo copia para dentro
	 * do prompt da imagem. A frase é CONTEÚDO e mora na definition, não aqui.
	 */
	entrega_frase: z.string().max(120).default(''),
	/** O formato pedido (1:1, 9:16, 4:5). Vira `{formato}`. */
	formato: z.string().max(20).default(''),
	/**
	 * A paleta lida da imagem (saída de `image.palette` no logo ou na foto).
	 * Vira `{paleta}` — cores que EXISTEM no material, não cores lembradas.
	 */
	paleta: z.unknown().optional(),
	concorrencia: z.coerce
		.number()
		.int()
		.min(1)
		.max(8)
		.default(CONCORRENCIA_PADRAO),
	/**
	 * "Olhar o que o mercado está fazendo" — o botão que a tela vai ter (F3).
	 *
	 * DESLIGADO por padrão, e é a decisão de produto: o time trabalha com o que
	 * o aluno deu. Ligado, cada especialista usa o `motor_busca` que o roster
	 * declarar; desligado, o campo do roster é ignorado e ninguém paga busca.
	 */
	busca: ligado,
});

type Params = z.infer<typeof schema>;

interface ResultadoAgente {
	chave: string;
	nome: string;
	icone: string;
	cor: string;
	fase: string;
	ok: boolean;
	ms: number;
	json?: unknown;
	texto?: string;
	fontes: Citation[];
	erro?: string;
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

function parseVars(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * A paleta virando texto de briefing.
 *
 * `image.palette` devolve `colors` (lista de hex) ou a lista já pronta quando o
 * pipeline referencia `<nó>.colors`. Aceitar as duas formas evita que a
 * definition precise saber qual saída referenciar — a mesma tolerância que
 * `categorias` precisou ter na Central.
 */
export function paletaEmTexto(v: unknown): string {
	const lista = Array.isArray(v)
		? v
		: v && typeof v === 'object'
			? ((v as { colors?: unknown }).colors ?? [])
			: typeof v === 'string'
				? v.split(',')
				: [];
	if (!Array.isArray(lista)) return '';
	return lista
		.map((c) =>
			typeof c === 'string'
				? c.trim()
				: typeof (c as { hex?: unknown })?.hex === 'string'
					? String((c as { hex: string }).hex).trim()
					: '',
		)
		.filter((c) => /^#?[0-9a-f]{3,8}$/i.test(c))
		.slice(0, 8)
		.join(', ');
}

/**
 * AS FOTOS QUE ESTE ESPECIALISTA VAI OLHAR — só as que ele declarou.
 *
 * É aqui que o campo `entrada` do roster vira dinheiro: uma foto custa ~1.500
 * tokens de entrada, e mandar a foto do produto para os seis especialistas
 * multiplicaria por seis o item mais caro do prompt para que quatro deles não
 * usassem a informação. Quem não declarou nada recebe texto puro.
 */
export function imagensDoAgente(
	a: ArtAgentSpec,
	fotos: { produto: Buffer | null; referencias: Buffer[] },
): Buffer[] {
	if (a.entrada === 'foto_produto') return fotos.produto ? [fotos.produto] : [];
	if (a.entrada === 'referencias') return fotos.referencias;
	return [];
}

/**
 * Roda UM especialista. Nunca lança — devolve o resultado com `ok:false`.
 *
 * Exportada para o teste: as regressões caras deste caminho (retry sem
 * consultar orçamento, chamada paga com o relógio no fim, gasto de chamada que
 * falhou sumindo da conta, foto indo para quem não pediu) só aparecem AQUI, com
 * o `Budget` de verdade — testá-las por uma cópia da lógica seria testar a
 * cópia.
 */
export async function rodarAgenteDeArte(
	a: ArtAgentSpec,
	vars: Record<string, unknown>,
	fotos: { produto: Buffer | null; referencias: Buffer[] },
	budget: Budget,
	ctx: BlockRunContext,
	opts: { busca: boolean; material?: string },
): Promise<ResultadoAgente> {
	const t0 = Date.now();
	const base: ResultadoAgente = {
		chave: a.chave,
		nome: a.nome,
		icone: a.icone,
		cor: a.cor,
		fase: a.fase,
		ok: false,
		ms: 0,
		fontes: [],
	};

	/**
	 * Quem o orçamento e o relógio NÃO podem cortar. Mesma regra do núcleo:
	 * `sintese` é quem escreve o prompt (sem ele não há arte) e `essencial` é
	 * quem, faltando, derruba o run no piso. Cortar qualquer um dos dois troca
	 * "caro" por "estornado", que custa o dobro.
	 */
	const protegido = a.fase === 'sintese' || a.essencial;

	const imagens = imagensDoAgente(a, fotos);

	/* ── 1. a busca é decidida ANTES de o cartão aparecer na tela ────────── */
	let motor = opts.busca ? a.motorBusca : 'nenhum';
	let vagaDeBusca = 0;
	if (motor !== 'nenhum') {
		if (budget.podeBuscar(1)) {
			budget.reservar(1);
			vagaDeBusca = 1;
		} else {
			motor = 'nenhum';
			budget.avisar(
				`${a.nome} trabalhou sem olhar nada além do que você mandou.`,
			);
			budget.diagnosticar(
				`${a.chave}: sem busca — o teto de chamadas com busca do run acabou.`,
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
		fase: a.fase,
		/**
		 * O QUE ELE ESTÁ OLHANDO — e é a informação que a mesa de criação precisa
		 * para não mentir. O cartão do Leitor do Produto mostra a miniatura da
		 * foto; o do Redator não mostra imagem nenhuma, porque ele não viu
		 * nenhuma. `n_imagens` é o que separa "olhou a referência" de "olhou as
		 * duas referências".
		 */
		olhando: imagens.length > 0 ? a.entrada : null,
		n_imagens: imagens.length,
	});

	// Quem recebe foto PRECISA enxergar; `needsVision` descarta do catálogo quem
	// não vê, e `resolveTextModel` nunca derruba o run por causa disso.
	const model = resolveTextModel(a.modelo, {
		needsVision: imagens.length > 0,
		needsWebSearch: motor !== 'nenhum',
	});

	const pergunta = interpolar(a.pergunta, vars);
	const oMaterial = opts.material
		? `\n\n=== O QUE O TIME JÁ LEVANTOU ===\n${opts.material.slice(0, MAX_CHARS_MATERIAL)}`
		: '';

	/**
	 * QUEM PESQUISA RECEBE O MATERIAL NO **SYSTEM**, NÃO NO USER — medido contra
	 * o provedor na Central: o plugin de busca formula a consulta a partir da
	 * última mensagem de usuário, e um digest colado ali vira uma "consulta" de
	 * 20 mil caracteres (HTTP 500 no `perplexity` acima de ~7 mil). Aqui a busca
	 * nasce desligada, mas a regra vale no dia em que o botão existir.
	 *
	 * Quem NÃO pesquisa recebe no `user`: ali o material é a tarefa, não o
	 * contexto.
	 */
	const buscando = motor !== 'nenhum';
	const system = buscando ? `${a.papel}${oMaterial}` : a.papel;
	const comMaterial = buscando ? pergunta : `${pergunta}${oMaterial}`;
	const user = a.saida
		? `${comMaterial}\n\nResponda APENAS JSON, neste formato:\n${a.saida}`
		: comMaterial;

	/**
	 * Projeção de PIOR CASO desta chamada — é ela que dá dente ao `maxUsd`.
	 * A FOTO ENTRA NA CONTA: ela é o item mais caro da entrada de quem olha, e
	 * uma projeção que a ignora deixa o freio cego justamente nas duas chamadas
	 * que mais custam.
	 */
	const prever = (m: TextModelEntry, comBusca: boolean) =>
		estimarCustoUsd({
			precoIn: m.pricing.in,
			precoOut: m.pricing.out,
			charsPrompt:
				system.length + user.length + imagens.length * CHARS_POR_IMAGEM,
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
	 * O GASTO DE UMA CHAMADA QUE FALHOU EXISTE DO MESMO JEITO — e é justamente
	 * o caro (o modelo escreveu a resposta inteira e ela não fechou como JSON).
	 * Sem isto o `custo_usd` do run esconde os runs caros, que são exatamente os
	 * que a gente usaria para conferir a margem.
	 */
	const contabilizados = new Set<unknown>();
	const contabilizarFalha = (err: unknown) => {
		if (contabilizados.has(err)) return;
		contabilizados.add(err);
		const g = gastoDeFalha(err, motor !== 'nenhum');
		if (g) budget.registrar(g.buscas, g.custoUsd);
		soltarReserva();
	};

	try {
		/* ── 2. o RELÓGIO, antes de gastar ──────────────────────────────── */
		if (!budget.cabeNoTempo(a.timeoutS, a.maxTokens)) {
			if (!protegido || budget.msRestantes() <= 0) {
				budget.avisar(
					`${a.nome} não chegou a trabalhar nesta arte: o tempo acabou antes da vez dele.`,
				);
				budget.diagnosticar(
					`${a.chave}: pulado — relógio do run no fim (${Math.round(budget.msRestantes() / 1000)}s).`,
				);
				return falharCedo('não chegou a tempo de entrar nesta arte.');
			}
			budget.diagnosticar(
				`${a.chave}: relógio no fim (${Math.round(budget.msRestantes() / 1000)}s), rodou por ser protegido.`,
			);
		}

		/* ── 3. o DINHEIRO, com projeção de pior caso ───────────────────── */
		let previsto = prever(model, motor !== 'nenhum');
		if (!budget.podeGastar(previsto) && motor !== 'nenhum') {
			// 1ª marcha: sem busca. Economiza os ~7 mil tokens de entrada que os
			// resultados colam no contexto, não só os US$ 0,005 da busca.
			motor = 'nenhum';
			if (vagaDeBusca > 0) {
				budget.liberar(vagaDeBusca);
				vagaDeBusca = 0;
			}
			previsto = prever(model, false);
			budget.avisar(
				`${a.nome} trabalhou sem olhar nada além do que você mandou.`,
			);
			budget.diagnosticar(
				`${a.chave}: sem busca — 1ª marcha do freio de custo (previsto US$ ${previsto.toFixed(4)}).`,
			);
		}
		if (!budget.podeGastar(previsto)) {
			if (!protegido) {
				// 2ª marcha, e só para quem não escreve o prompt: não roda mesmo.
				budget.avisar(
					`${a.nome} não chegou a trabalhar nesta arte, e a parte dele não está aqui.`,
				);
				budget.diagnosticar(
					`${a.chave}: pulado pela 2ª marcha do freio de custo (gasto ${budget.gasto().usd.toFixed(4)} de ${budget.limites.maxUsd}).`,
				);
				return falharCedo('não chegou a entrar nesta arte.');
			}
			// Nada mudou para quem lê: a parte dele está lá. Que o teto tenha sido
			// furado é conta NOSSA, e é ela que explica um run caro depois.
			budget.diagnosticar(
				`${a.chave}: teto de gasto do run estourado (${budget.gasto().usd.toFixed(4)} de ${budget.limites.maxUsd}), rodou por ser protegido.`,
			);
		}
		budget.reservarUsd(previsto);
		usdReservado = previsto;

		const timeout = AbortSignal.timeout(
			Math.min(a.timeoutS * 1000, budget.msRestantes()),
		);
		const signal = ctx.signal
			? AbortSignal.any([ctx.signal, timeout])
			: timeout;

		const chamar = (m: TextModelEntry) =>
			chamarModelo({
				model: m,
				system,
				user,
				imagens,
				engine: motor,
				maxResults: Math.max(3, a.maxBuscas * 5),
				includeDomains: a.dominiosIncluir,
				excludeDomains: a.dominiosExcluir,
				maxTokens: a.maxTokens,
				temperature: a.temperatura,
				// Ver `raciocinio` em `lib/atelie/agents.ts`: é o que impede o modelo
				// de gastar o teto pensando e entregar JSON pela metade.
				raciocinio: a.raciocinio,
				json: Boolean(a.saida) && m.json,
				signal,
				titulo: 'Profissão Laser - Ateliê',
			});

		/**
		 * UMA TENTATIVA INTEIRA: chamada + validação do JSON.
		 *
		 * A validação mora DENTRO da tentativa porque o modo de falha mais comum
		 * de quem escreve muito é a resposta cortada no teto de tokens — e com o
		 * `throw` fora do `try` do retry, a segunda tentativa nunca acontecia
		 * justamente para quem mais precisa dela.
		 */
		const tentar = async (m: TextModelEntry) => {
			const r = await chamar(m);
			const json = extractJson(r.text);
			if (a.saida && json === undefined) {
				// ~4 caracteres por token: acima de 3,5× o teto a resposta quase certo
				// bateu no limite e veio cortada no meio de uma chave.
				const truncado = r.text.length > a.maxTokens * 3.5;
				const trecho = r.text.trim().slice(0, 120).replace(/\s+/g, ' ');
				throw new ChamadaError(
					`${truncado ? 'a resposta bateu no limite de tokens e veio cortada' : 'a resposta não veio em JSON válido'} (${r.text.length} caracteres, teto ${a.maxTokens} tokens). Começo: "${trecho}…"`,
					'falha',
					// O dinheiro SAIU: o modelo escreveu a resposta inteira.
					{ buscas: r.buscas, custoUsd: r.custoUsd },
					// A frase acima é para o log; o aluno não comprou teto de token.
					'trabalhou, mas não conseguiu fechar a parte dele.',
				);
			}
			return { r, json };
		};

		let out: Awaited<ReturnType<typeof tentar>>;
		try {
			out = await tentar(model);
		} catch (primeiro) {
			contabilizarFalha(primeiro);
			/**
			 * RETRY EM OUTRO MODELO — resposta VAZIA ou JSON QUEBRADO. Uma
			 * tentativa, não um laço, e com portas antes: tem que valer o tipo da
			 * falha, tem que sobrar relógio e — para quem NÃO escreve o prompt —
			 * tem que caber no orçamento. O protegido refaz mesmo apertado: um
			 * retry de US$ 0,02 é mais barato que o estorno do run inteiro.
			 */
			const vale =
				primeiro instanceof ChamadaError &&
				(primeiro.kind === 'vazio' || primeiro.kind === 'falha');
			if (!vale) throw primeiro;
			if (!budget.cabeNoTempo(a.timeoutS, a.maxTokens)) {
				if (!protegido || budget.msRestantes() <= 0) {
					budget.diagnosticar(
						`${a.chave}: sem retry — não sobrou relógio (${Math.round(budget.msRestantes() / 1000)}s).`,
					);
					throw primeiro;
				}
				budget.diagnosticar(
					`${a.chave}: retry com o relógio no fim, por ser protegido.`,
				);
			}
			const alternativo = escolherAlternativo(
				model.id,
				motor !== 'nenhum',
				protegido
					? undefined
					: (m) => budget.podeGastar(prever(m, motor !== 'nenhum')),
			);
			/**
			 * O ALTERNATIVO TAMBÉM PRECISA ENXERGAR.
			 *
			 * `escolherAlternativo` filtra por busca e por JSON, não por visão — ele
			 * nasceu num time onde ninguém olha foto. Sem esta linha, o retry do
			 * Leitor do Produto poderia cair num modelo sem visão: a chamada iria
			 * com a imagem, o provedor recusaria ou ignoraria a foto, e a segunda
			 * tentativa seria dinheiro gasto para receber uma ficha escrita de
			 * imaginação. Hoje todo o catálogo tem visão, e é exatamente por isso
			 * que a guarda precisa existir agora: ela é grátis e o dia em que
			 * alguém acrescentar um modelo só-texto ninguém vai lembrar disto.
			 */
			if (!alternativo || (imagens.length > 0 && !alternativo.vision)) {
				budget.diagnosticar(
					`${a.chave}: sem retry — não há outro modelo compatível${imagens.length ? ' (com visão)' : ''} que caiba.`,
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
			if (protegido && !budget.podeGastar(previstoRetry)) {
				budget.diagnosticar(
					`${a.chave}: retry acima do teto de gasto do run, refeito por ser protegido.`,
				);
			}
			budget.reservarUsd(previstoRetry);
			usdReservado = previstoRetry;
			out = await tentar(alternativo);
		}
		budget.registrar(out.r.buscas, out.r.custoUsd);

		for (const f of out.r.citations) {
			if (!f.url) continue;
			ctx.onProgress?.({
				kind: 'fonte',
				chave: a.chave,
				url: f.url,
				titulo: f.title,
			});
		}

		const resultado: ResultadoAgente = {
			...base,
			ok: true,
			ms: Date.now() - t0,
			json: out.json,
			texto: out.r.text,
			fontes: out.r.citations,
		};
		ctx.onProgress?.({
			kind: 'agente_concluiu',
			chave: a.chave,
			ms: resultado.ms,
		});
		return resultado;
	} catch (err) {
		contabilizarFalha(err);
		/**
		 * DUAS MENSAGENS: a técnica vai para o log com o resto do diagnóstico, e a
		 * tela recebe uma frase sobre o TRABALHO que não saiu. O caminho ingênuo
		 * manda `err.message` para os dois lados — e aí o cartão do especialista
		 * exibe "falha na chamada (500)" e o id do modelo para quem comprou uma
		 * arte.
		 */
		const tecnica = err instanceof Error ? err.message : 'falha desconhecida';
		budget.diagnosticar(`${a.chave}: ${tecnica}`);
		const msg =
			err instanceof ChamadaError
				? err.mensagemParaTela
				: FALHA_PARA_TELA.falha;
		ctx.onProgress?.({ kind: 'agente_falhou', chave: a.chave, erro: msg });
		return { ...base, ms: Date.now() - t0, erro: msg };
	} finally {
		// Devolve a vaga de busca e a projeção que sobraram. Sem isto, um agente
		// que falha antes de chamar leva a vaga junto e os últimos do time rodam
		// degradados por um teto que ninguém gastou.
		if (vagaDeBusca > 0) budget.liberar(vagaDeBusca);
		soltarReserva();
	}
}

/** O que um especialista entrega ao material da onda seguinte. */
function blocoDoResultado(r: ResultadoAgente): { nome: string; corpo: string } {
	return {
		nome: r.nome,
		corpo: r.ok
			? (r.texto ?? '').trim()
			: `(não conseguiu concluir desta vez: ${r.erro})`,
	};
}

export const aiArtTeamBlock: ToolBlock<Params> = {
	id: 'ai.art_team',
	category: 'ai',
	description:
		'Time do Ateliê: lê a foto do produto, a marca cadastrada e os anúncios de referência, e escreve o PROMPT da arte (a imagem é gerada pelo nó seguinte).',
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

		/* ── 1. o time, em UMA leitura ─────────────────────────────────────── */
		const cfgAgentes = resolveCollection(doc, p.agentes_collection);
		const listaAgentes = await repo.list(
			p.tool,
			p.agentes_collection,
			cfgAgentes,
			{
				// `isStaff:true` é OBRIGATÓRIO: a coleção é `visibility:'staff'` (é o
				// que protege os prompts, que são o produto), e o repositório esconde
				// `staff` de quem não é. `collection.query` não serve aqui por isso.
				viewer: { customerId: ctx.customerId, isStaff: true },
				pageSize: PAGINA_DO_ROSTER,
				page: 1,
				sort: 'position',
			},
		);
		const todos = listaAgentes.items
			.map((e) => toArtAgentSpec(e))
			.filter((a): a is ArtAgentSpec => a !== null);

		if (todos.filter((a) => a.ativo).length === 0) {
			throw new ToolEngineError(
				400,
				'Nenhum especialista configurado para o Ateliê. Cadastre o time na coleção `agentes`.',
			);
		}

		const { time, paraRodar } = montarTimeDoAtelie(todos, {
			entrega: p.entrega,
			teto: TETO_DE_AGENTES,
		});

		/* ── 2. o briefing: a marca, o que ele digitou e a paleta ──────────── */
		/**
		 * A marca entra por `vars` e não por um caminho novo: `interpolar` já
		 * troca `{marca}` na `pergunta` de cada especialista, já some com o token
		 * quando a variável está vazia (levando junto a preposição que a
		 * introduzia) e já é o mecanismo por onde `{produto}` chega. Assim "este
		 * especialista usa a marca" é edição de DADO no roster, e "o aluno não tem
		 * marca" é a mesma ausência silenciosa que o time já sabe tratar.
		 *
		 * As chaves da marca são todas prefixadas (`marca`, `marca_nome`,
		 * `marca_tom`, `marca_publico`, `marca_nao_usar`), então nenhuma delas
		 * pode sombrear `produto`, `entrega`, `formato` ou `paleta`.
		 */
		const marca = escolherMarca(p.marca);
		const paleta = paletaEmTexto(p.paleta);
		const vars: Record<string, unknown> = {
			...parseVars(p.vars),
			...varsDaMarca(marca),
		};
		// A frase vence o slug: `{entrega}` é lido por um redator, não por um
		// filtro. Sem frase, o slug ainda é melhor que um buraco na pergunta.
		const entregaNoTexto = p.entrega_frase.trim() || p.entrega.trim();
		if (entregaNoTexto) vars.entrega = entregaNoTexto;
		if (p.formato.trim()) vars.formato = p.formato.trim();
		if (paleta) vars.paleta = paleta;

		const fotos = {
			produto: Buffer.isBuffer(p.foto_produto) ? p.foto_produto : null,
			referencias: [p.referencia, p.referencia2, p.referencia3].filter(
				(b): b is Buffer => Buffer.isBuffer(b) && b.length > 0,
			),
		};

		const budget = new Budget(LIMITES_ATELIE, Date.now());

		/**
		 * O TIME INTEIRO VAI PARA A TELA antes de qualquer trabalho.
		 *
		 * `sem_foto` não é enfeite: o Leitor do Produto sem foto e o Leitor das
		 * Referências sem referência nenhuma continuam trabalhando (com o texto
		 * que o aluno digitou), e o cartão precisa dizer isso — senão a mesa de
		 * criação anima uma lupa em cima de uma imagem que não existe.
		 */
		ctx.onProgress?.({
			kind: 'time_montado',
			total: time.length,
			agentes: time.map((a) => ({
				chave: a.chave,
				nome: a.nome,
				icone: a.icone,
				cor: a.cor,
				frase: a.fraseTrabalhando,
				fase: a.fase,
				entrada: a.entrada,
				sem_foto:
					a.entrada !== 'nenhuma' && imagensDoAgente(a, fotos).length === 0,
				estado: 'vai_rodar',
			})),
		});

		/* ── 3. TRÊS ONDAS: leitura → direção → síntese ────────────────────── */
		const colher = (rs: PromiseSettledResult<ResultadoAgente>[]) =>
			rs
				.map((r) => (r.status === 'fulfilled' ? r.value : null))
				.filter((r): r is ResultadoAgente => r !== null);

		const ondas = ORDEM_DAS_ONDAS.map((fase) => ({
			fase,
			agentes: paraRodar.filter((a) => a.fase === fase),
		}));
		const TETO_POR_ONDA: Record<string, number> = {
			descoberta: 0,
			aprofundamento: TETO_DIGEST_ONDA2,
			sintese: TETO_DIGEST_ONDA3,
		};

		const resultados: ResultadoAgente[] = [];
		for (const onda of ondas) {
			if (onda.agentes.length === 0) continue;
			const teto = TETO_POR_ONDA[onda.fase] ?? TETO_DIGEST_ONDA3;
			const material = teto
				? montarDigest(resultados.map(blocoDoResultado), teto)
				: undefined;

			/**
			 * A VIRADA DA ONDA: `de` são as chaves cujo material está DENTRO do
			 * digest que esta onda acabou de receber, `para` são as que vão lê-lo.
			 * O feixe que a animação desenha corresponde a uma dependência que
			 * existe no motor. Na onda 1, `de` é vazio: nada a alimenta.
			 */
			ctx.onProgress?.({
				kind: 'onda',
				fase: onda.fase,
				de: material ? resultados.filter((r) => r.ok).map((r) => r.chave) : [],
				para: onda.agentes.map((a) => a.chave),
			});

			resultados.push(
				...colher(
					await comLimite(
						onda.agentes.map(
							(a) => () =>
								rodarAgenteDeArte(a, vars, fotos, budget, ctx, {
									busca: p.busca,
									material,
								}),
						),
						p.concorrencia,
					),
				),
			);
		}

		const okCount = resultados.filter((r) => r.ok).length;
		const falhas = resultados.filter((r) => !r.ok);

		/* ── 4. o PROMPT, que é o produto deste bloco ──────────────────────── */
		const doAgente = (chave: string) =>
			resultados.find((r) => r.chave === chave && r.ok);

		const sintese = doAgente(CHAVE_PROMPT_FINAL);
		const promptDaArte = extrairPrompt(sintese?.json, sintese?.texto ?? '');
		const promptFinal = comporPrompt(promptDaArte);

		/**
		 * ┌─ SEM PROMPT NÃO HÁ ENTREGA — e isto é regra de CÓDIGO ──────────────┐
		 * │ O roster é dado: nada impede alguém desmarcar `essencial` do Prompt  │
		 * │ Final pela tela de coleção. Se isso acontecesse e a checagem fosse   │
		 * │ só o piso de sucesso, um run com cinco de seis entregando passaria — │
		 * │ e o nó seguinte receberia `prompt_final: ''`. `ai.image_studio`      │
		 * │ recusa prompt vazio com 400, mas depois de o time ter sido cobrado;  │
		 * │ e se a definition tiver um fallback de prompt, é pior: a arte SAI,   │
		 * │ genérica, sem nada da marca, e ninguém descobre o que aconteceu.     │
		 * │                                                                      │
		 * │ Então o bloco falha aqui, antes de devolver: 502 é estorno, e este   │
		 * │ run não vale nada sem a única frase que ele existe para escrever.    │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		if (!promptFinal.trim()) {
			budget.diagnosticar(
				`prompt vazio: ${sintese ? 'a síntese respondeu, mas sem prompt utilizável' : 'a síntese não entregou'}.`,
			);
			console.warn(
				`[atelie] US$ ${budget.gasto().usd.toFixed(4)} · ${budget.diagnosticos.join(' | ')}`,
			);
			throw new ToolEngineError(
				502,
				'O time não conseguiu fechar o pedido da sua arte desta vez. Não cobramos por isso.',
			);
		}

		/**
		 * PISO DE SUCESSO — e ele é DUAS perguntas, não uma.
		 *
		 * NOMINAL: quem é `essencial` entregou? A contagem sozinha já reprovou na
		 * Central — com 2 essenciais e 7 entregas, um run passava mesmo que os
		 * DOIS essenciais tivessem falhado, e o dossiê saía sem veredito nenhum.
		 * (O essencial que mais importa, a síntese, já foi conferido acima pelo
		 * PRODUTO dele: sem prompt não se chega aqui.)
		 *
		 * DE CONTAGEM: sobrou time o bastante? Um prompt sozinho não é a arte que
		 * o aluno comprou. Com dois essenciais entre seis a regra é quase inerte
		 * hoje (o piso dá 2, os essenciais já são 2) — ela existe para o roster
		 * que crescer: quatro de sete falhando com os dois essenciais de pé
		 * produziria uma mesa de criação com quatro cartões de "não consegui
		 * desta vez", cobrada por inteiro.
		 */
		const essenciaisFalhos = paraRodar
			.filter((a) => a.essencial)
			.filter((a) => !resultados.some((r) => r.chave === a.chave && r.ok));
		const piso = pisoDeSucesso(paraRodar);
		if (essenciaisFalhos.length > 0 || okCount < piso) {
			budget.diagnosticar(
				essenciaisFalhos.length > 0
					? `essenciais sem entrega: ${essenciaisFalhos.map((a) => a.chave).join(', ')}.`
					: `abaixo do piso: ${okCount} de ${piso} entregaram.`,
			);
			console.warn(
				`[atelie] US$ ${budget.gasto().usd.toFixed(4)} · ${budget.diagnosticos.join(' | ')}`,
			);
			const quem = essenciaisFalhos.map((a) => a.nome).join(', ');
			throw new ToolEngineError(
				502,
				quem
					? `${quem} não conseguiu concluir e sem isso a arte não sai como deveria. Não cobramos por esta.`
					: `O time não voltou com o mínimo para fazer esta arte (${okCount} de ${piso}). Não cobramos por isso.`,
			);
		}

		const copy = extrairCopy(doAgente(CHAVE_REDATOR)?.json);
		const gasto = budget.gasto();

		ctx.onProgress?.({
			kind: 'prompt_pronto',
			chars: promptFinal.length,
			tem_texto: Boolean(copy.titulo || copy.legenda),
		});

		/**
		 * O DIAGNÓSTICO SAI NO LOG, e é aqui que ele deixa de ser jogado fora.
		 * Retry, troca de modelo, freio de custo e relógio apertado explicam por
		 * que um run custou o que custou — informação que a gente precisa e que o
		 * aluno não comprou.
		 */
		if (budget.diagnosticos.length > 0) {
			console.warn(
				`[atelie] US$ ${gasto.usd.toFixed(4)} · ${budget.diagnosticos.join(' | ')}`,
			);
		}

		return {
			/**
			 * A MESA DE CRIAÇÃO. Contrato genérico: todo especialista que rodou
			 * está aqui, com o que ele produziu — inclusive um sétimo que o admin
			 * cadastre. `texto` só viaja para quem NÃO devolveu JSON: sem isso, quem
			 * responde em prosa apareceria como um cartão em branco na tela.
			 *
			 * O `modelo` NÃO SAI DAQUI, como na Central: nenhum componente lê o
			 * campo, e um "ver código-fonte" entregaria nome de modelo a quem
			 * comprou um time de profissionais.
			 */
			agentes: resultados.map((r) => ({
				chave: r.chave,
				nome: r.nome,
				icone: r.icone,
				cor: r.cor,
				fase: r.fase,
				ok: r.ok,
				ms: r.ms,
				json: r.json ?? null,
				texto: r.json === undefined ? (r.texto ?? '').slice(0, 2_000) : '',
				n_fontes: r.fontes.length,
				erro: r.erro ?? null,
			})),
			/** O material que o Prompt Final leu — a auditoria do "por que essa arte". */
			briefing: montarDigest(
				resultados.map(blocoDoResultado),
				TETO_DIGEST_ONDA3,
			),
			ficha_produto: doAgente(CHAVE_LEITOR_PRODUTO)?.json ?? null,
			regras_visuais: doAgente(CHAVE_LEITOR_MARCA)?.json ?? null,
			referencias_lidas: doAgente(CHAVE_LEITOR_REFERENCIAS)?.json ?? null,
			direcao_arte: doAgente(CHAVE_DIRETOR_ARTE)?.json ?? null,
			titulo: copy.titulo,
			chamada: copy.chamada,
			legenda: copy.legenda,
			hashtags: copy.hashtags,
			/**
			 * A frase que vai DENTRO da arte, separada da legenda: quem a consome é
			 * o prompt (entre aspas, verbatim) e a prévia da peça na tela. Vazio é
			 * resposta legítima — arte sem texto é melhor que arte com letra torta.
			 */
			texto_na_arte: copy.texto_na_arte,
			/** O PRODUTO DESTE BLOCO. Vai para o `prompt` do `ai.image_studio`. */
			prompt_final: promptFinal,
			/**
			 * A proibição, separada, para a tela poder mostrá-la como uma escolha
			 * do aluno ("sua marca pediu para não usar X"). Ela JÁ está dentro do
			 * `prompt_final` — o gerador lê uma string só.
			 */
			prompt_negativo: promptDaArte.negativo,
			/**
			 * POR QUE A ARTE VAI SER ASSIM — em duas ou três linhas, para o aluno.
			 *
			 * É o ponto de render do especialista de síntese enquanto a imagem é
			 * gerada: sem ele, o único trabalho visível dele seria um parágrafo de
			 * prompt em inglês de máquina, que é exatamente o que a tela do Ateliê
			 * existe para não mostrar.
			 */
			por_que_assim:
				typeof (sintese?.json as { por_que_assim?: unknown })?.por_que_assim ===
				'string'
					? String(
							(sintese?.json as { por_que_assim: string }).por_que_assim,
						).slice(0, 1_200)
					: '',
			/**
			 * O NOME da marca que temperou este run, ou `''`.
			 *
			 * É a única maneira de responder "a arte saiu com a identidade dele?"
			 * olhando a resposta, em vez de deduzindo pelo texto. Sem isto, uma
			 * marca que não foi lida (a tool dona em draft, o `collection.query`
			 * engolindo o erro por ser `optional`, o aluno sem cadastro) produz
			 * exatamente o mesmo resultado de antes — e a diferença entre "não tem
			 * marca" e "a marca não chegou" some.
			 */
			marca_usada:
				typeof marca?.nome === 'string' ? marca.nome.slice(0, 120) : '',
			/**
			 * A URL DO LOGO DA MESMA MARCA — o que o `image.kit_crops` carimba na
			 * arte depois. Ela sai DAQUI, e não de `marca.first.logo_url`, por dois
			 * motivos que já custaram rodada nesta ferramenta:
			 *
			 *  ① `resolveRefs` é PLANO. `marca.first.logo_url` não existe na bag (só
			 *     `marca.first`) e chegaria ao bloco como a STRING literal do
			 *     caminho — que o `resolverLogo` recusa em silêncio, e o logo
			 *     simplesmente nunca apareceria;
			 *  ② `first` é a marca MAIS RECENTE; quem manda é o `escolherMarca`
			 *     acima, que prefere a marcada como principal. As duas divergem no
			 *     instante em que o aluno tem mais de uma marca — a arte sairia com
			 *     a cor de uma e o logo de outra.
			 *
			 * NÃO É DADO SENSÍVEL: é o mesmo `logo_url` que a tela "Minha marca" já
			 * mostra para o dono, e este bloco só roda para o dono.
			 */
			marca_logo_url:
				typeof marca?.logo_url === 'string'
					? marca.logo_url.slice(0, 2_000)
					: '',
			ok_count: okCount,
			falhas: falhas.map((f) => ({
				chave: f.chave,
				nome: f.nome,
				erro: f.erro,
			})),
			/** As RESSALVAS dele — e só elas. O resto morre no log. */
			avisos: budget.avisos,
			custo_usd: Number(gasto.usd.toFixed(4)),
			ms: gasto.ms,
		};
	},
};
