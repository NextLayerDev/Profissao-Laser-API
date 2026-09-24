import { z } from 'zod';
import { Budget } from '../../lib/agent-team/budget.js';
import { montarDigest } from '../../lib/agent-team/core.js';
import { type ArtAgentSpec, toArtAgentSpec } from '../../lib/atelie/agents.js';
import {
	avisosDoPedido,
	CHAVE_DIRETOR_MOVIMENTO,
	comporPedidoDeVideo,
	extrairMovimento,
	LIMITES_DO_PEDIDO,
	MAX_PROMPT_VIDEO,
} from '../../lib/atelie/movimento.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';
import { rodarAgenteDeArte } from './ai-art-team.js';

/**
 * `ai.video_prompt` — QUEM ESCREVE O PEDIDO DO VÍDEO.
 *
 * Um especialista, uma chamada, um parágrafo de MOVIMENTO. O porquê da escolha
 * (especialista novo, e não derivação do `direcao_arte`) está inteiro em
 * `lib/atelie/movimento.ts`, com as três gerações que a decidiram.
 *
 * ┌─ POR QUE ELE NÃO É UM `ai.art_team` DE UM AGENTE SÓ ────────────────────┐
 * │ O time da arte FALHA DE PROPÓSITO sem `prompt_final` (`ai-art-team.ts`:  │
 * │ "SEM PROMPT NÃO HÁ ENTREGA — e isto é regra de CÓDIGO"). Rodar um roster │
 * │ de um único especialista por lá devolveria 502 sempre, e afrouxar aquela │
 * │ regra para caber o vídeo é mexer no que protege a ARTE de todo mundo.    │
 * │                                                                          │
 * │ E rodar o time INTEIRO no run de vídeo seria pior de outro jeito: seis   │
 * │ chamadas (~US$ 0,08 e ~60 s medidos) para reescrever uma leitura que já  │
 * │ foi feita e paga quando a arte nasceu. O vídeo é compra separada; ele    │
 * │ paga o que ele usa.                                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE ELE OLHA, E A ORDEM DE PREFERÊNCIA ──────────────────────────────┐
 * │ A ARTE PRONTA é o material obrigatório — ela é o primeiro quadro do      │
 * │ vídeo, e movimento escrito sem ver o quadro contradiz o quadro.          │
 * │                                                                          │
 * │ `ficha_produto` e `direcao_arte` entram QUANDO EXISTIREM: na mesma       │
 * │ sessão em que a arte foi feita, o time já disse o que valoriza a peça e  │
 * │ que ângulo a valoriza, e o movimento deveria exibir justamente isso. No  │
 * │ dia seguinte eles não existem (a galeria não os guarda) e o especialista │
 * │ trabalha do que vê — que é o caminho de primeira classe, não o degradado.│
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ELE FALHA ANTES DE O VÍDEO SER PEDIDO, E ISSO É DINHEIRO ──────────────┐
 * │ Este bloco custa ~US$ 0,014 (uma chamada Sonnet com uma imagem). O nó    │
 * │ seguinte custa US$ 0,40 de verdade. Um pedido vazio que passasse daqui   │
 * │ viraria um vídeo genérico COBRADO — 12 voxxys por um clipe que não é do  │
 * │ produto do aluno. Então aqui se lança 502: o motor estorna a invocação   │
 * │ inteira (`tool-run.ts` → `refundInvocation`) e ninguém pagou nada.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

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

/**
 * Quantos registros do roster o bloco lê.
 *
 * 40 e não 60 (o número do Ateliê) porque aqui o roster é de UM: o resto da
 * página é folga para os desativados e para o dia em que houver um segundo
 * jeito de filmar cadastrado ao lado deste.
 */
const PAGINA_DO_ROSTER = 40;

/** Quanto material o especialista recebe, em caracteres. */
const TETO_DO_MATERIAL = 6_000;

// O motor injeta `null` num input de imagem não preenchido (`coerceInputs`).
const imagemOpcional = z.union([z.instanceof(Buffer), z.null(), z.undefined()]);

const schema = z.object({
	/** Tool dona do roster de vídeo (a coleção `agentes` de `estudio_video`). */
	tool: z.string().min(1).max(60),
	agentes_collection: z.string().min(1).max(40).default('agentes'),
	/** Qual especialista roda. Existe para o dia do segundo jeito de filmar. */
	chave: z.string().min(1).max(60).default(CHAVE_DIRETOR_MOVIMENTO),

	/**
	 * A ARTE PRONTA — o primeiro quadro do vídeo.
	 *
	 * `nullish` e não obrigatório: o motor injeta `null` num input de imagem
	 * vazio, e um 400 de Zod ("Expected Buffer") no meio de um run já cobrado é
	 * a pior frase que este bloco poderia entregar. Sem arte ele falha adiante,
	 * com a frase que uma pessoa entende.
	 */
	arte: imagemOpcional,

	/* ── o que o time da arte já levantou, QUANDO existir ──────────────────── */
	/**
	 * `unknown` porque vem verbatim do `ai.art_team` (`resolveRefs` é PLANO:
	 * `time.ficha_produto.o_que_valoriza` não resolve, e o objeto inteiro é o
	 * único jeito de a informação chegar). Ausente é caminho normal — é o que
	 * acontece quando o aluno compra o vídeo no dia seguinte.
	 */
	ficha_produto: z.unknown().optional(),
	direcao_arte: z.unknown().optional(),
	/** O prompt com que a arte foi gerada — a galeria guarda esse, e só esse. */
	prompt_da_arte: z.string().max(8_000).default(''),
	/** O nome da peça na galeria, quando houver. */
	titulo: z.string().max(400).nullish(),
	/** JSON com o que o aluno digitou (`{produto, publico, ...}`). */
	vars: z.string().default('{}'),
	/**
	 * O QUE O ALUNO PEDIU DE ESPECÍFICO — opcional, e é um LEME, não o volante.
	 *
	 * A tela do vídeo já tinha um campo onde ele escrevia o movimento inteiro à
	 * mão. Ele fica, mas muda de papel: quem escreve o pedido é o especialista,
	 * e o que o aluno digitou entra como um desejo a atender no que der ("mostra
	 * o verso da peça", "termina na gravação").
	 *
	 * ⚠ É TEXTO DE TERCEIRO e viaja como CONTEÚDO da pergunta, nunca como
	 * system: quem manda no especialista é o `papel` do roster. E o que sair
	 * dele ainda passa pelas travas de `comporPedidoDeVideo` — um "escreva MINHA
	 * MARCA na tela" digitado aqui não vira letra no vídeo.
	 */
	pedido_do_aluno: z.string().max(600).nullish(),

	/* ── o formato do clipe, que MUDA o movimento ─────────────────────────── */
	/**
	 * O enquadramento pedido. Não é enfeite: num 9:16 a peça sobe e desce no
	 * quadro, num 16:9 ela atravessa — e um movimento escrito para o formato
	 * errado sai da moldura.
	 */
	formato: z.string().max(20).default('9:16'),
	/**
	 * Quantos segundos o plano tem que durar. O Veo aceita 4, 6 e 8; aqui o
	 * número serve ao TEXTO ("plano único de 8 segundos"), e é o que impede o
	 * especialista de escrever um roteiro de trinta.
	 */
	duracao_s: z.coerce.number().int().min(4).max(8).default(8),
});

type Params = z.infer<typeof schema>;

/** Um bloco do material, no formato que `montarDigest` reparte. */
function bloco(
	nome: string,
	v: unknown,
): { nome: string; corpo: string } | null {
	if (v === null || v === undefined) return null;
	const corpo =
		typeof v === 'string'
			? v.trim()
			: JSON.stringify(v, null, 1).slice(0, 6_000);
	return corpo ? { nome, corpo } : null;
}

function parseVars(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export const aiVideoPromptBlock: ToolBlock<Params> = {
	id: 'ai.video_prompt',
	category: 'ai',
	description:
		'Diretor de Movimento: olha a arte pronta e escreve o PEDIDO do vídeo (o que se move, para onde, em quanto tempo). Não gera vídeo — quem gera é o nó seguinte.',
	paramsSchema: schema,
	async run(ctx, p) {
		const t0 = Date.now();

		/**
		 * SEM ARTE NÃO HÁ PEDIDO — e a checagem vem antes de TUDO, inclusive do
		 * `loadDeps()`.
		 *
		 * Texto-para-vídeo aqui é DEFEITO, não simplificação: sem o primeiro
		 * quadro o modelo inventa outro produto, e o aluno recebe o vídeo de uma
		 * peça que não é dele. Ler o roster e pagar uma chamada de modelo para
		 * descobrir isso depois seria gastar para chegar no mesmo lugar.
		 *
		 * A ORDEM É PARTE DA REGRA: `loadDeps` importa o repositório, que valida
		 * credencial de banco no topo do módulo. Checar depois dele faz "faltou a
		 * arte" virar erro de conexão em qualquer lugar sem banco — e foi assim
		 * que este teste não existia.
		 */
		if (!Buffer.isBuffer(p.arte) || p.arte.length === 0) {
			throw new ToolEngineError(
				400,
				'O vídeo precisa da arte pronta: é ela que vira o primeiro quadro.',
			);
		}

		const {
			loadPublishedToolDefinition,
			resolveCollection,
			toolCollectionRepository: repo,
		} = await loadDeps();

		/* ── 1. o especialista, lido do roster ─────────────────────────────── */
		/**
		 * `ctx.toolDoc` é a definition da tool QUE ESTÁ RODANDO. Ela só serve aqui
		 * se for a mesma que guarda o roster — e a checagem é a própria coleção
		 * existir dentro dela. Sem isso, um pipeline que apontasse `tool` para
		 * outra ferramenta leria a coleção de uma e pediria os registros da outra.
		 */
		const docDoRun = ctx.toolDoc as Record<string, unknown> | undefined;
		const doDoc =
			docDoRun && temColecao(docDoRun, p.agentes_collection)
				? docDoRun
				: ((
						await loadPublishedToolDefinition(
							p.tool,
							ctx.customerId,
							ctx.authHeader,
						)
					).definition as Record<string, unknown>);

		const cfg = resolveCollection(doDoc, p.agentes_collection);
		const lista = await repo.list(p.tool, p.agentes_collection, cfg, {
			// `isStaff:true` é OBRIGATÓRIO: a coleção é `visibility:'staff'`, porque
			// o papel escrito ali é o produto. Mesma razão do time da arte.
			viewer: { customerId: ctx.customerId, isStaff: true },
			pageSize: PAGINA_DO_ROSTER,
			page: 1,
			sort: 'position',
		});

		const todos = lista.items
			.map((e) => toArtAgentSpec(e))
			.filter((a): a is ArtAgentSpec => a !== null);
		const spec = todos.find((a) => a.chave === p.chave);

		/**
		 * As duas ausências são MENSAGENS DIFERENTES de propósito: "não está
		 * cadastrado" manda cadastrar, "está desligado" manda ligar. Um 400 único
		 * dizendo "não encontrei" faria alguém recadastrar por cima de um registro
		 * que só precisava do interruptor.
		 */
		if (!spec) {
			throw new ToolEngineError(
				400,
				`O Diretor de Movimento não está cadastrado no roster de ${p.tool} (coleção \`${p.agentes_collection}\`, chave \`${p.chave}\`).`,
			);
		}
		if (!spec.ativo) {
			throw new ToolEngineError(
				400,
				'O Diretor de Movimento está desligado no roster — sem ele não há como escrever o pedido do vídeo.',
			);
		}

		/* ── 2. o material: o que vê, o que o time disse, o que ele digitou ── */
		const vars: Record<string, unknown> = {
			...parseVars(p.vars),
			formato: p.formato.trim() || '9:16',
			duracao: String(p.duracao_s),
		};
		if (p.titulo?.trim()) vars.peca = p.titulo.trim();
		if (p.pedido_do_aluno?.trim()) vars.pedido = p.pedido_do_aluno.trim();

		/**
		 * O desejo do aluno entra COMO BLOCO DE MATERIAL, e não na pergunta: um
		 * bloco vazio simplesmente não existe, enquanto uma variável vazia na
		 * pergunta deixaria "a pessoa pediu:." em todo run de quem não digitou
		 * nada — que é a maioria. Ver a caixa na `PERGUNTA` do seed.
		 */
		const material = montarDigest(
			[
				bloco('A ficha da peça', p.ficha_produto),
				bloco('A direção de arte', p.direcao_arte),
				bloco('O pedido com que a arte foi gerada', p.prompt_da_arte),
				bloco('O que a pessoa pediu para este vídeo', p.pedido_do_aluno),
			].filter((b): b is { nome: string; corpo: string } => b !== null),
			TETO_DO_MATERIAL,
		);

		const budget = new Budget(LIMITES_DO_PEDIDO, Date.now());

		ctx.onProgress?.({
			kind: 'time_montado',
			total: 1,
			agentes: [
				{
					chave: spec.chave,
					nome: spec.nome,
					icone: spec.icone,
					cor: spec.cor,
					frase: spec.fraseTrabalhando,
					fase: spec.fase,
					entrada: spec.entrada,
					sem_foto: false,
					estado: 'vai_rodar',
				},
			],
		});

		/* ── 3. a chamada ──────────────────────────────────────────────────── */
		/**
		 * A ARTE ENTRA COMO `produto` — e é assim que o roster manda.
		 *
		 * `imagensDoAgente` reparte as fotos pelo campo `entrada` do registro, e
		 * `foto_produto` é o valor que existe. Aqui "a foto do produto" É A ARTE
		 * PRONTA: o que este especialista precisa enxergar não é a peça na
		 * bancada, é o QUADRO de onde o vídeo vai partir.
		 */
		const r = await rodarAgenteDeArte(
			spec,
			vars,
			{ produto: p.arte, referencias: [] },
			budget,
			ctx,
			{ busca: false, material: material || undefined },
		);

		/* ── 4. o pedido, que é o produto deste bloco ──────────────────────── */
		const pedido = extrairMovimento(r.json, r.texto ?? '');
		const promptVideo = comporPedidoDeVideo(pedido);

		if (!promptVideo.trim()) {
			budget.diagnosticar(
				r.ok
					? 'o Diretor de Movimento respondeu, mas sem pedido utilizável.'
					: `o Diretor de Movimento não entregou: ${r.erro}`,
			);
			console.warn(
				`[video-prompt] US$ ${budget.gasto().usd.toFixed(4)} · ${budget.diagnosticos.join(' | ')}`,
			);
			/**
			 * 502 e não 200-com-aviso: o nó seguinte custa US$ 0,40 REAIS por
			 * geração. Seguir sem pedido é comprar um vídeo aleatório com o dinheiro
			 * do aluno; falhar aqui é o motor estornar os 12 voxxys inteiros.
			 */
			throw new ToolEngineError(
				502,
				'Não conseguimos escrever o pedido do seu vídeo desta vez. Não cobramos por isso.',
			);
		}

		const avisos = [...budget.avisos, ...avisosDoPedido(promptVideo)];
		if (budget.diagnosticos.length > 0) {
			console.warn(
				`[video-prompt] US$ ${budget.gasto().usd.toFixed(4)} · ${budget.diagnosticos.join(' | ')}`,
			);
		}

		ctx.onProgress?.({
			kind: 'pedido_pronto',
			chars: promptVideo.length,
			chave: spec.chave,
		});

		const gasto = budget.gasto();
		return {
			/** O PRODUTO DESTE BLOCO. Vai para o `prompt` do gerador de vídeo. */
			prompt_video: promptVideo,
			/**
			 * O CARTÃO DO ESPECIALISTA — o ponto de render dele.
			 *
			 * A regra que reprovou quatro rodadas da Central vale aqui com um
			 * agravante: ele é o único profissional que trabalha neste run. Sem
			 * cartão, o aluno espera minutos por um vídeo olhando uma tela que não
			 * mostra ninguém trabalhando.
			 */
			movimento: r.json ?? null,
			/** Em português de gente: o que este movimento existe para mostrar. */
			o_que_exibe: pedido.exibe,
			/**
			 * A duração ECOADA, e não recalculada. Quem manda no clipe é o nó
			 * seguinte; o número volta aqui só para a definition poder amarrar os
			 * dois sem repetir o valor em dois lugares (e divergir num deles).
			 */
			duracao_s: p.duracao_s,
			formato: p.formato.trim() || '9:16',
			avisos,
			custo_usd: Number(gasto.usd.toFixed(4)),
			ms: Date.now() - t0,
			/** Quantos caracteres o pedido tem — o teto é `MAX_PROMPT_VIDEO`. */
			chars: promptVideo.length,
			limite_chars: MAX_PROMPT_VIDEO,
		};
	},
};

/** A definition carregada declara esta coleção? Ver o uso em `run`. */
function temColecao(doc: Record<string, unknown>, nome: string): boolean {
	const cols = doc.collections;
	return Boolean(
		cols &&
			typeof cols === 'object' &&
			nome in (cols as Record<string, unknown>),
	);
}

export const videoPromptBlocks: ToolBlock[] = [aiVideoPromptBlock];
