import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Budget } from '@/lib/agent-team/budget.js';
import {
	interpolar as interpolarDoNucleo,
	montarTimeBase,
	pisoDeSucesso as pisoDoNucleo,
	repartirChars as repartirDoNucleo,
} from '@/lib/agent-team/core.js';
import { TOKENS_POR_IMAGEM } from '@/lib/agent-team/imagem.js';
import {
	type ArtAgentSpec,
	CHARS_POR_IMAGEM,
	LIMITES_ATELIE,
	MAX_TOKENS_TETO,
	montarTimeDoAtelie,
	normalizarEntrada,
	TETO_DE_AGENTES,
	toArtAgentSpec,
} from '@/lib/atelie/agents.js';
import {
	comporPrompt,
	extrairCopy,
	extrairPrompt,
	MAX_PROMPT,
} from '@/lib/atelie/saidas.js';
import {
	interpolar as interpolarDaCentral,
	pisoDeSucesso as pisoDaCentral,
} from '@/lib/research/agents.js';
import { repartirChars as repartirDaCentral } from '@/tool-blocks/blocks/ai-research-team.js';
import type { BlockProgressEvent } from '@/tool-blocks/types.js';

/**
 * A ÚNICA saída de rede do Ateliê é a chamada ao modelo. Ela é dublada; o resto
 * — `Budget` de verdade, catálogo de modelos de verdade, eventos de tela de
 * verdade — roda. É onde moram as regressões caras deste bloco: foto indo para
 * quem não pediu, projeção de custo cega à foto, busca ligada sem ninguém pedir.
 */
vi.mock('@/lib/agent-team/llm.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('@/lib/agent-team/llm.js')>();
	return { ...real, chamarModelo: vi.fn() };
});
const { chamarModelo, ChamadaError } = await import('@/lib/agent-team/llm.js');
const chamadaFalsa = vi.mocked(chamarModelo);

/** As BORDAS do bloco — banco e definition — para poder rodar `run` de verdade. */
const repoList = vi.fn();
vi.mock('@/repositories/tool-collection.js', () => ({
	toolCollectionRepository: { list: (...a: unknown[]) => repoList(...a) },
}));
vi.mock('@/lib/tool-collections.js', () => ({
	resolveCollection: () => ({ fields: [] }),
}));
vi.mock('@/lib/tool-definitions.js', () => ({
	loadPublishedToolDefinition: () => {
		throw new Error('o bloco recebe a definition pronta em ctx.toolDoc');
	},
}));

const {
	aiArtTeamBlock,
	imagensDoAgente,
	paletaEmTexto,
	rodarAgenteDeArte,
	SAIDAS,
} = await import('@/tool-blocks/blocks/ai-art-team.js');

/* ────────────────────────── utilidades ────────────────────────── */

function resposta(o: Partial<{ text: string; custoUsd: number }> = {}) {
	return {
		modelUsado: 'google/gemini-3.1-flash-lite',
		text: o.text ?? 'ok',
		citations: [],
		usage: { in: 100, out: 100 },
		buscas: 0,
		custoUsd: o.custoUsd ?? 0.001,
	};
}

function spec(over: Partial<ArtAgentSpec> = {}): ArtAgentSpec {
	return {
		chave: 'x',
		nome: 'X',
		papel: 'Você é X.',
		pergunta: 'Faça X.',
		saida: '',
		entrada: 'nenhuma',
		entrega: 'todas',
		// `padrao` = ninguém manda `reasoning` na chamada, que é o comportamento de
		// quem não declarou. Ver `raciocinio` em `lib/atelie/agents.ts`.
		raciocinio: 'padrao',
		motorBusca: 'nenhum',
		maxBuscas: 0,
		dominiosIncluir: [],
		dominiosExcluir: [],
		essencial: false,
		temperatura: 0.3,
		maxTokens: 800,
		timeoutS: 60,
		icone: 'sparkles',
		cor: '#8b5cf6',
		fraseTrabalhando: 'Trabalhando…',
		ordem: 10,
		ativo: true,
		fase: 'descoberta',
		...over,
	};
}

/** Um registro da coleção `agentes`, como o repositório devolve. */
function registro(data: Record<string, unknown>) {
	return { title: String(data.nome ?? data.chave), data };
}

const ROSTER = [
	registro({
		chave: 'leitor_produto',
		nome: 'Leitor do Produto',
		papel: 'Você olha a foto do produto.',
		pergunta: 'O que é este produto?',
		saida: '{"o_que_e":"","material":""}',
		entrada: 'foto_produto',
		fase: 'descoberta',
		ordem: 10,
	}),
	registro({
		chave: 'leitor_marca',
		nome: 'Leitor da Marca',
		papel: 'Você traduz a marca em regras visuais.',
		pergunta: 'Regras visuais {marca}',
		saida: '{"paleta":[]}',
		fase: 'descoberta',
		ordem: 20,
	}),
	registro({
		chave: 'leitor_referencias',
		nome: 'Leitor das Referências',
		papel: 'Você olha os anúncios de referência.',
		pergunta: 'O que funciona nestes anúncios?',
		saida: '{"composicao":""}',
		entrada: 'referencias',
		fase: 'descoberta',
		ordem: 30,
	}),
	registro({
		chave: 'diretor_arte',
		nome: 'Diretor de Arte',
		papel: 'Você dirige a arte.',
		pergunta: 'Como enquadrar?',
		saida: '{"enquadramento":""}',
		fase: 'aprofundamento',
		ordem: 40,
	}),
	registro({
		chave: 'redator',
		nome: 'Redator',
		papel: 'Você escreve o texto da peça.',
		pergunta: 'Escreva o texto {marca}',
		saida: '{"titulo":"","legenda":""}',
		fase: 'aprofundamento',
		ordem: 50,
	}),
	registro({
		chave: 'prompt_final',
		nome: 'Prompt Final',
		papel: 'Você escreve o pedido da imagem.',
		pergunta: 'Escreva o prompt.',
		saida: '{"prompt":"","negativo":""}',
		fase: 'sintese',
		essencial: true,
		ordem: 90,
	}),
];

const FOTO = Buffer.from('foto-do-produto');
const REF1 = Buffer.from('referencia-1');
const REF2 = Buffer.from('referencia-2');

function ctxDeTeste(onProgress?: (e: BlockProgressEvent) => void) {
	return {
		customerId: 'c1',
		toolDoc: {},
		...(onProgress ? { onProgress } : {}),
	};
}

/**
 * Os params PASSAM PELO SCHEMA — não são um objeto montado à mão.
 *
 * É de propósito: o motor sempre entrega params validados, e metade das
 * armadilhas deste bloco mora justamente na coerção (`busca: "false"`, a foto
 * que chega `null`, os defaults). Um teste que monta o objeto pronto testa o
 * bloco com uma entrada que a produção nunca produz.
 */
function params(over: Record<string, unknown> = {}) {
	return aiArtTeamBlock.paramsSchema.parse({
		tool: 'estudio_imagens',
		foto_produto: FOTO,
		referencia: REF1,
		referencia2: REF2,
		...over,
	});
}

/** Respostas boas para os seis, na ordem em que as ondas os despacham. */
function timeInteiroResponde() {
	chamadaFalsa.mockImplementation(async (o) => {
		const alvo = `${o.system} ${o.user}`;
		if (alvo.includes('pedido da imagem')) {
			return resposta({
				text: '{"prompt":"Caneca branca sobre fundo azul, luz lateral","negativo":"pessoas"}',
			});
		}
		if (alvo.includes('texto da peça')) {
			return resposta({
				text: '{"titulo":"Sua caneca","legenda":"Peça a sua","hashtags":["laser"]}',
			});
		}
		return resposta({ text: '{"ok":true}' });
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	repoList.mockImplementation(async (_tool: string, colecao: string) =>
		colecao === 'agentes'
			? { items: ROSTER, total: ROSTER.length }
			: { items: [], total: 0 },
	);
});

/* ═════════ o reuso é REUSO, não uma segunda cópia ═════════ */

describe('a Central e o Ateliê compartilham o núcleo — e é o MESMO código', () => {
	/**
	 * ┌─ POR QUE ISTO É TESTE, E NÃO UM COMENTÁRIO ─────────────────────────────┐
	 * │ A alternativa a extrair o núcleo era copiar `research/agents.ts` e mudar │
	 * │ os campos. O risco de copiar não é o dia da cópia: é o dia em que        │
	 * │ alguém conserta a ordem de sacrifício num arquivo e não no outro, e o    │
	 * │ segundo time passa meses com o defeito que o primeiro já pagou.          │
	 * │                                                                          │
	 * │ Identidade de referência é a única asserção que a cópia não passa: dois  │
	 * │ arquivos com o mesmo código dão duas funções DIFERENTES, e `toBe` reprova│
	 * │ na hora.                                                                 │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 */
	it('a Central não tem uma cópia própria de `interpolar` nem do piso', () => {
		expect(interpolarDaCentral).toBe(interpolarDoNucleo);
		expect(pisoDaCentral).toBe(pisoDoNucleo);
	});

	it('nem do enchimento por nível do digest', () => {
		expect(repartirDaCentral).toBe(repartirDoNucleo);
	});

	it('e o núcleo continua repartindo sem apagar ninguém', () => {
		// Um bloco curto, dois longos: o curto leva o que precisa e devolve a
		// sobra. Ninguém sai com zero — que é o defeito que o `slice` no fim tinha.
		expect(repartirDoNucleo([10, 500, 500], 300)).toEqual([10, 145, 145]);
	});

	it('e a montagem do time sacrifica quem DEPENDE antes de quem alimenta', () => {
		const time = [
			{ chave: 'a', fase: 'descoberta' as const, essencial: false },
			{ chave: 'b', fase: 'aprofundamento' as const, essencial: false },
			{ chave: 'c', fase: 'sintese' as const, essencial: false },
		];
		const { time: fica } = montarTimeBase(time, {
			politica: 9,
			limiteDuro: 2,
		});
		// Sai o aprofundamento: ele VIVE do digest da descoberta, e cortar a
		// descoberta o deixaria rodando (e cobrando) sem insumo nenhum.
		expect(fica.map((a) => a.chave)).toEqual(['a', 'c']);
	});
});

/* ═════════ o roster é DADO, e o campo novo é `entrada` ═════════ */

describe('o time do Ateliê vem da coleção', () => {
	it('`entrada` desconhecida cai em `nenhuma` — o padrão que nunca falha', () => {
		expect(normalizarEntrada('foto_produto')).toBe('foto_produto');
		expect(normalizarEntrada('REFERENCIAS')).toBe('referencias');
		expect(normalizarEntrada('logo')).toBe('nenhuma');
		expect(normalizarEntrada(undefined)).toBe('nenhuma');
	});

	it('registro incompleto some da lista em vez de rodar e devolver ruído', () => {
		expect(toArtAgentSpec(registro({ chave: 'x' }))).toBeNull();
		expect(
			toArtAgentSpec(registro({ chave: 'x', papel: 'p', pergunta: 'q' })),
		).not.toBeNull();
	});

	it('`ativo` ausente NÃO desliga o especialista', () => {
		expect(
			toArtAgentSpec(registro({ chave: 'x', papel: 'p', pergunta: 'q' }))
				?.ativo,
		).toBe(true);
		expect(
			toArtAgentSpec(
				registro({ chave: 'x', papel: 'p', pergunta: 'q', ativo: false }),
			)?.ativo,
		).toBe(false);
	});

	/**
	 * O CAMPO QUE CONSERTOU "A ARTE NÃO SAIU DESTA VEZ".
	 *
	 * O `prompt_final` (Sonnet, teto 4.000) truncava em 3 de 3 chamadas medidas
	 * com o digest cheio: o raciocínio consumia o teto antes da primeira chave do
	 * JSON. Ele é `essencial`, então truncar ali derrubava o run inteiro.
	 * Estes testes prendem as duas metades do conserto — o valor chegar do dado, e
	 * o valor estranho degradar para o lado SEGURO.
	 */
	it('`raciocinio` atravessa o dado, e valor estranho vira `padrao`', () => {
		const base = { chave: 'x', papel: 'p', pergunta: 'q' };
		expect(toArtAgentSpec(registro(base))?.raciocinio).toBe('padrao');
		expect(
			toArtAgentSpec(registro({ ...base, raciocinio: 'desligado' }))
				?.raciocinio,
		).toBe('desligado');
		expect(
			toArtAgentSpec(registro({ ...base, raciocinio: 'baixo' }))?.raciocinio,
		).toBe('baixo');
		/**
		 * A degradação segura é DEIXAR O MODELO PENSAR, nunca desligar o raciocínio
		 * de quem precisa dele: um erro de digitação aqui tem que devolver a
		 * qualidade de sempre, não uma resposta rasa em silêncio.
		 */
		for (const errado of ['nenhum', 'off', '', 'DESLIGADO', 0, null, true]) {
			expect(
				toArtAgentSpec(registro({ ...base, raciocinio: errado }))?.raciocinio,
			).toBe('padrao');
		}
	});

	it('O TETO DE SAÍDA DESTE TIME É 4.000, e o roster não passa dele', () => {
		/**
		 * O destino do que ele escreve é o `prompt` do `ai.image_studio`, que
		 * recusa acima de 8.000 CARACTERES (~2.000 tokens). Um teto maior autoriza
		 * o modelo a escrever o que o destino não aceita — e cobra por isso.
		 */
		expect(MAX_TOKENS_TETO).toBe(4_000);
		const a = toArtAgentSpec(
			registro({ chave: 'x', papel: 'p', pergunta: 'q', max_tokens: 30_000 }),
		);
		expect(a?.maxTokens).toBe(4_000);
	});

	it('motor de busca desconhecido vira `nenhum`, e sem motor não há vaga', () => {
		const a = toArtAgentSpec(
			registro({
				chave: 'x',
				papel: 'p',
				pergunta: 'q',
				motor_busca: 'google',
				max_buscas: 5,
			}),
		);
		expect(a?.motorBusca).toBe('nenhum');
		expect(a?.maxBuscas).toBe(0);
	});

	it('o time é o roster inteiro — aqui não existe corte por política', () => {
		/**
		 * Na Central o número de profissionais é o que o aluno COMPRA (5 ou 22) e
		 * o teto corta o excesso. Aqui o preço não muda com o tamanho do time: se
		 * o admin cadastrar um sétimo especialista, ele trabalha e aparece.
		 */
		const sete = [
			...ROSTER,
			registro({ chave: 's7', papel: 'p', pergunta: 'q' }),
		]
			.map(toArtAgentSpec)
			.filter((a): a is ArtAgentSpec => a !== null);
		expect(montarTimeDoAtelie(sete).time).toHaveLength(7);
		// E o freio contra roster absurdo continua existindo.
		expect(montarTimeDoAtelie(sete, { teto: 3 }).time).toHaveLength(3);
		expect(TETO_DE_AGENTES).toBeGreaterThanOrEqual(6);
	});
});

describe('o caminho escolhido filtra o roster', () => {
	const time = () =>
		[
			registro({
				chave: 'geral',
				papel: 'p',
				pergunta: 'q',
				entrega: 'todas',
				ordem: 1,
			}),
			registro({
				chave: 'so_cena',
				papel: 'p',
				pergunta: 'q',
				entrega: 'cena',
				ordem: 2,
			}),
		]
			.map(toArtAgentSpec)
			.filter((a): a is ArtAgentSpec => a !== null);

	it('quem é exclusivo de um caminho não entra nos outros', () => {
		expect(
			montarTimeDoAtelie(time(), { entrega: 'post' }).time.map((a) => a.chave),
		).toEqual(['geral']);
		expect(
			montarTimeDoAtelie(time(), { entrega: 'cena' }).time.map((a) => a.chave),
		).toEqual(['geral', 'so_cena']);
	});

	/**
	 * A SAÍDA DE UM CAMINHO NÃO PODE SUMIR COM ESPECIALISTA.
	 *
	 * "Arte para gravar" foi um caminho de verdade, e alguém pode ter cadastrado
	 * um especialista preso a ele. Com o valor fora do vocabulário, `normalizar`
	 * devolve `todas` — o especialista volta a trabalhar em tudo, em vez de
	 * desaparecer do time e do orçamento sem ninguém notar.
	 */
	it('especialista preso a um caminho APAGADO volta a trabalhar em todos', () => {
		const orfao = [
			registro({
				chave: 'orfao',
				papel: 'p',
				pergunta: 'q',
				entrega: 'gravar',
				ordem: 1,
			}),
		]
			.map(toArtAgentSpec)
			.filter((a): a is ArtAgentSpec => a !== null);
		for (const caminho of ['post', 'anuncio', 'cena'] as const) {
			expect(
				montarTimeDoAtelie(orfao, { entrega: caminho }).time.map(
					(a) => a.chave,
				),
			).toEqual(['orfao']);
		}
	});

	it('SEM caminho escolhido ninguém é filtrado — e é isso que salva o preview', () => {
		expect(montarTimeDoAtelie(time()).time).toHaveLength(2);
	});

	it('e um erro de digitação no campo deixa o especialista TRABALHANDO', () => {
		/**
		 * O contrário — sumir do time por causa de uma letra — é a falha muda que
		 * ninguém diagnostica: a tela mostra um profissional a menos e nada mais.
		 */
		const [a] = [
			registro({ chave: 'x', papel: 'p', pergunta: 'q', entrega: 'Gravaar' }),
		]
			.map(toArtAgentSpec)
			.filter((x): x is ArtAgentSpec => x !== null);
		expect(a?.entrega).toBe('todas');
	});
});

/* ═════════ C3: cada um recebe o que DECLAROU ═════════ */

describe('a foto vai só para quem pediu', () => {
	const fotos = { produto: FOTO, referencias: [REF1, REF2] };

	it('quem declarou `foto_produto` recebe a foto; quem não declarou, nada', () => {
		expect(imagensDoAgente(spec({ entrada: 'foto_produto' }), fotos)).toEqual([
			FOTO,
		]);
		expect(imagensDoAgente(spec({ entrada: 'nenhuma' }), fotos)).toEqual([]);
	});

	it('quem declarou `referencias` recebe TODAS na mesma chamada', () => {
		/**
		 * Comparar duas composições é o trabalho dele. Mandar uma por chamada
		 * custaria o dobro para entregar menos: nenhuma das duas respostas
		 * conseguiria dizer "a de cima resolve o texto melhor que a de baixo".
		 */
		expect(imagensDoAgente(spec({ entrada: 'referencias' }), fotos)).toEqual([
			REF1,
			REF2,
		]);
	});

	it('sem foto nenhuma, quem lê imagem continua trabalhando com o texto', () => {
		const vazio = { produto: null, referencias: [] };
		expect(imagensDoAgente(spec({ entrada: 'foto_produto' }), vazio)).toEqual(
			[],
		);
	});

	it('A CHAMADA LEVA A FOTO CERTA — e é aqui que o campo vira dinheiro', async () => {
		chamadaFalsa.mockResolvedValue(resposta());
		const budget = new Budget(LIMITES_ATELIE, Date.now());

		await rodarAgenteDeArte(
			spec({ chave: 'olha', entrada: 'foto_produto' }),
			{},
			fotos,
			budget,
			ctxDeTeste(),
			{ busca: false },
		);
		expect(chamadaFalsa.mock.calls[0]?.[0].imagens).toEqual([FOTO]);

		await rodarAgenteDeArte(
			spec({ chave: 'cego', entrada: 'nenhuma' }),
			{},
			fotos,
			budget,
			ctxDeTeste(),
			{ busca: false },
		);
		expect(chamadaFalsa.mock.calls[1]?.[0].imagens).toEqual([]);
	});

	it('e a tela sabe QUEM está olhando o quê', async () => {
		chamadaFalsa.mockResolvedValue(resposta());
		const eventos: BlockProgressEvent[] = [];
		await rodarAgenteDeArte(
			spec({ entrada: 'referencias' }),
			{},
			fotos,
			new Budget(LIMITES_ATELIE, Date.now()),
			ctxDeTeste((e) => eventos.push(e)),
			{ busca: false },
		);
		const iniciou = eventos.find((e) => e.kind === 'agente_iniciou');
		expect(iniciou?.olhando).toBe('referencias');
		expect(iniciou?.n_imagens).toBe(2);
	});
});

/* ═════════ a foto é o item mais caro do prompt ═════════ */

describe('a projeção de custo enxerga a foto', () => {
	it('uma foto vale ~1.500 tokens, e a conta usa o mesmo número da redução', () => {
		expect(CHARS_POR_IMAGEM).toBe(TOKENS_POR_IMAGEM * 4);
	});

	it('O FREIO DE CUSTO CORTA QUEM LEVA FOTO E DEIXA PASSAR QUEM NÃO LEVA', async () => {
		/**
		 * ┌─ o defeito que este teste tranca ──────────────────────────────────┐
		 * │ `estimarCustoUsd` conta a entrada em CARACTERES, porque nasceu num  │
		 * │ time onde ninguém manda foto. Sem somar a imagem, a projeção do     │
		 * │ Leitor do Produto é a da pergunta dele — mil e poucos caracteres —  │
		 * │ e o freio autoriza a chamada mais cara do run achando que ela é a   │
		 * │ mais barata. O teto abaixo é apertado de propósito: com a foto na   │
		 * │ conta ele fecha, sem a foto ele passa.                              │
		 * └─────────────────────────────────────────────────────────────────────┘
		 */
		chamadaFalsa.mockResolvedValue(resposta());
		/**
		 * O teto sai da conta, não do gosto: com Flash Lite (US$ 0,25/M na
		 * entrada, US$ 1,50/M na saída) e teto de 1.200 tokens, a projeção sem
		 * foto é US$ 0,001801 e com UMA foto é US$ 0,002176 — a diferença são os
		 * 1.500 tokens da imagem. US$ 0,002 fica exatamente entre as duas.
		 */
		const apertado = { ...LIMITES_ATELIE, maxUsd: 0.002 };
		const barato = 'google/gemini-3.1-flash-lite';

		const comFoto = new Budget(apertado, Date.now());
		const r1 = await rodarAgenteDeArte(
			spec({
				chave: 'olha',
				entrada: 'foto_produto',
				maxTokens: 1_200,
				modelo: barato,
			}),
			{},
			{ produto: FOTO, referencias: [] },
			comFoto,
			ctxDeTeste(),
			{ busca: false },
		);
		expect(r1.ok).toBe(false);
		expect(chamadaFalsa).not.toHaveBeenCalled();

		const semFoto = new Budget(apertado, Date.now());
		const r2 = await rodarAgenteDeArte(
			spec({
				chave: 'cego',
				entrada: 'nenhuma',
				maxTokens: 1_200,
				modelo: barato,
			}),
			{},
			{ produto: FOTO, referencias: [] },
			semFoto,
			ctxDeTeste(),
			{ busca: false },
		);
		expect(r2.ok).toBe(true);
	});

	it('o gasto de uma chamada que FALHOU entra na conta do run', async () => {
		/**
		 * É a chamada que mais some da contabilidade: o modelo escreveu a resposta
		 * inteira e ela não fechou como JSON. Sem registrar, o `custo_usd` do run
		 * esconde justamente os runs caros.
		 */
		// Um erro NOVO por chamada: o mesmo objeto passando duas vezes é contado
		// uma só (é o que impede a contagem dobrada quando o retry é recusado).
		chamadaFalsa.mockImplementation(async () => {
			throw new ChamadaError('vazia', 'vazio', { buscas: 0, custoUsd: 0.007 });
		});
		const budget = new Budget(LIMITES_ATELIE, Date.now());
		await rodarAgenteDeArte(
			spec({ chave: 'x' }),
			{},
			{ produto: null, referencias: [] },
			budget,
			ctxDeTeste(),
			{ busca: false },
		);
		// Duas chamadas (a primeira e o retry em outro modelo), as duas cobradas.
		expect(budget.gasto().usd).toBeCloseTo(0.014, 5);
	});
});

describe('o teto de gasto do run cobre o run que dá certo', () => {
	/**
	 * ┌─ ESTE TESTE EXISTE PORQUE O DEFEITO ACONTECEU ──────────────────────────┐
	 * │ `maxUsd` nasceu em US$ 0,05, calibrado por ESTIMATIVA. No primeiro run   │
	 * │ frio contra o OpenRouter real o freio de custo cortou o DIRETOR DE ARTE  │
	 * │ pela 2ª marcha (gasto 0,0289 de 0,05) e deixou o Prompt Final furar o    │
	 * │ teto por ser protegido: o aluno pagaria a arte inteira e receberia uma   │
	 * │ arte sem direção — sem erro, sem log na tela e sem como desconfiar. É a  │
	 * │ mesma classe de defeito que a Central já tinha pago.                     │
	 * │                                                                          │
	 * │ O teto agora é 0,11, contra runs medidos de US$ 0,082 a 0,085 e um pico  │
	 * │ de comprometimento de US$ 0,0898. A asserção é essa relação, não o        │
	 * │ número: quem baixar o teto para "economizar" reprova aqui.               │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 */
	const CUSTO_MEDIDO_USD = 0.085;
	const PICO_MEDIDO_USD = 0.0898;

	it('o teto fica ACIMA do pico de comprometimento medido', () => {
		expect(LIMITES_ATELIE.maxUsd).toBeGreaterThan(PICO_MEDIDO_USD);
	});

	it('e o run que dá certo cabe nele com folga', () => {
		expect(CUSTO_MEDIDO_USD / LIMITES_ATELIE.maxUsd).toBeLessThan(0.85);
	});

	it('o relógio cobra o dobro do run medido — a folga é a isenção do protegido', () => {
		// Medido: 66,0 s e 64,6 s de ponta a ponta em dois runs frios.
		expect(LIMITES_ATELIE.deadlineMs).toBeGreaterThanOrEqual(2 * 66_000);
	});
});

/* ═════════ C5: a busca nasce desligada ═════════ */

describe('ninguém pesquisa a web sem alguém pedir', () => {
	it('o `motor_busca` do roster é IGNORADO enquanto o botão não existe', async () => {
		chamadaFalsa.mockResolvedValue(resposta());
		const budget = new Budget(LIMITES_ATELIE, Date.now());
		await rodarAgenteDeArte(
			spec({ motorBusca: 'perplexity', maxBuscas: 3 }),
			{},
			{ produto: null, referencias: [] },
			budget,
			ctxDeTeste(),
			{ busca: false },
		);
		expect(chamadaFalsa.mock.calls[0]?.[0].engine).toBe('nenhum');
		expect(budget.gasto().buscas).toBe(0);
	});

	it('e o caminho está PRONTO: ligado, o motor do roster vale', async () => {
		chamadaFalsa.mockResolvedValue({ ...resposta(), buscas: 1 });
		const budget = new Budget(LIMITES_ATELIE, Date.now());
		await rodarAgenteDeArte(
			spec({ motorBusca: 'perplexity', maxBuscas: 3 }),
			{},
			{ produto: null, referencias: [] },
			budget,
			ctxDeTeste(),
			{ busca: true },
		);
		expect(chamadaFalsa.mock.calls[0]?.[0].engine).toBe('perplexity');
		expect(budget.gasto().buscas).toBe(1);
	});

	it('o parâmetro do bloco não cai na armadilha do `z.coerce.boolean()`', async () => {
		/**
		 * `Boolean('false')` é `true`. Uma definition que escreva `busca: "false"`
		 * — que é como um campo de formulário chega — ligaria a busca em TODO run
		 * e cobraria US$ 0,005 por especialista, calado.
		 */
		timeInteiroResponde();
		await aiArtTeamBlock.run(ctxDeTeste(), params({ busca: 'false' }));
		for (const [o] of chamadaFalsa.mock.calls) expect(o.engine).toBe('nenhum');
	});
});

/* ═════════ o bloco inteiro ═════════ */

describe('as três ondas do Ateliê', () => {
	it('a onda 2 recebe o material da 1, e a 3 recebe o das duas', async () => {
		chamadaFalsa.mockImplementation(async (o) => {
			const alvo = `${o.system} ${o.user}`;
			if (alvo.includes('pedido da imagem')) {
				return resposta({ text: '{"prompt":"uma caneca"}' });
			}
			return resposta({ text: `{"quem":"${o.user.slice(0, 12)}"}` });
		});

		const eventos: BlockProgressEvent[] = [];
		await aiArtTeamBlock.run(
			ctxDeTeste((e) => eventos.push(e)),
			params(),
		);

		const ondas = eventos.filter((e) => e.kind === 'onda');
		expect(ondas.map((o) => o.fase)).toEqual([
			'descoberta',
			'aprofundamento',
			'sintese',
		]);
		// A onda 1 não recebe nada: é ela que descobre.
		expect(ondas[0]?.de).toEqual([]);
		expect(ondas[1]?.de).toEqual([
			'leitor_produto',
			'leitor_marca',
			'leitor_referencias',
		]);
		expect(ondas[2]?.de).toHaveLength(5);

		// E a BARREIRA é real: quem lê o material foi chamado DEPOIS de os três
		// leitores terem respondido — o pedido do Diretor cita o que eles disseram.
		const doDiretor = chamadaFalsa.mock.calls.find(([o]) =>
			o.user.includes('Como enquadrar?'),
		);
		expect(doDiretor?.[0].user).toContain('Leitor do Produto');
	});

	it('cada um dos seis tem o SEU ponto de render na saída', async () => {
		/**
		 * "Todo especialista pago precisa de ponto de render na tela" reprovou
		 * quatro rodadas da Central. Aqui isso é asserção: seis cartões na mesa de
		 * criação MAIS um campo dedicado para cada um.
		 */
		timeInteiroResponde();
		const out = (await aiArtTeamBlock.run(ctxDeTeste(), params())) as Record<
			string,
			unknown
		>;

		const agentes = out.agentes as { chave: string; ok: boolean }[];
		expect(agentes.map((a) => a.chave)).toEqual([
			'leitor_produto',
			'leitor_marca',
			'leitor_referencias',
			'diretor_arte',
			'redator',
			'prompt_final',
		]);
		expect(agentes.every((a) => a.ok)).toBe(true);

		expect(out.ficha_produto).not.toBeNull();
		expect(out.regras_visuais).not.toBeNull();
		expect(out.referencias_lidas).not.toBeNull();
		expect(out.direcao_arte).not.toBeNull();
		expect(out.titulo).toBe('Sua caneca');
		expect(out.legenda).toBe('Peça a sua');
		expect(out.prompt_final).toContain('Caneca branca');
		expect(out.ok_count).toBe(6);
	});

	it('O BLOCO EMITE O PROMPT, NÃO A IMAGEM', async () => {
		/**
		 * Quem gera é o `ai.image_studio` do nó seguinte, com o modelo e o formato
		 * da definition. Se um dia alguém enfiar a geração aqui dentro, este teste
		 * é o que avisa: a saída ganharia `png`/`url` e o time passaria a carregar
		 * um segundo catálogo de modelos.
		 */
		timeInteiroResponde();
		const out = (await aiArtTeamBlock.run(ctxDeTeste(), params())) as Record<
			string,
			unknown
		>;
		expect(typeof out.prompt_final).toBe('string');
		expect(out.png).toBeUndefined();
		expect(out.url).toBeUndefined();
		expect(out.imagem).toBeUndefined();
	});

	it('SEM PROMPT NÃO SE COBRA — nem com cinco de seis entregando', async () => {
		/**
		 * O roster é dado: nada impede alguém desmarcar `essencial` do Prompt
		 * Final pela tela. Se a checagem fosse só o piso de sucesso, um run assim
		 * passaria e o nó seguinte receberia prompt vazio — que ou dá 400 depois
		 * de o time ter sido cobrado, ou (pior) cai num prompt de fallback e
		 * entrega uma arte genérica sem nada da marca.
		 */
		repoList.mockImplementation(async () => ({
			items: ROSTER.map((r) =>
				r.data.chave === 'prompt_final'
					? registro({ ...r.data, essencial: false })
					: r,
			),
			total: ROSTER.length,
		}));
		chamadaFalsa.mockImplementation(async (o) =>
			o.user.includes('Escreva o prompt')
				? resposta({ text: '{"prompt":""}' })
				: resposta({ text: '{"ok":true}' }),
		);

		await expect(
			aiArtTeamBlock.run(ctxDeTeste(), params()),
		).rejects.toMatchObject({ status: 502 });
	});

	it('O QUE O BLOCO EMITE É EXATAMENTE O QUE A DEFINITION TEM QUE LISTAR', async () => {
		/**
		 * ┌─ `output` É ALLOW-LIST, e isso já custou uma rodada na Central ─────┐
		 * │ Chave emitida aqui e não listada na definition é calculada, PAGA e  │
		 * │ jogada fora sem erro nenhum. `SAIDAS` é o mapa que quem escreve a   │
		 * │ definition copia — e um mapa que não bate com o código é pior que   │
		 * │ mapa nenhum, porque ele é consultado em vez do arquivo.             │
		 * └─────────────────────────────────────────────────────────────────────┘
		 */
		timeInteiroResponde();
		const out = (await aiArtTeamBlock.run(ctxDeTeste(), params())) as Record<
			string,
			unknown
		>;
		expect(Object.keys(out).sort()).toEqual([...SAIDAS].sort());
	});

	it('abaixo do piso de entrega o run não é cobrado, nem com o prompt de pé', async () => {
		/**
		 * Um prompt sozinho não é a arte que o aluno comprou: sem a leitura da
		 * peça e sem a direção, o que ele recebe é uma mesa de criação com
		 * cartões de "não consegui desta vez" — e a cobrança inteira.
		 */
		repoList.mockImplementation(async () => ({
			// Só o essencial da síntese: os outros cinco não são essenciais, e é
			// justamente esse o buraco que a contagem fecha.
			items: ROSTER.map((r) =>
				r.data.chave === 'prompt_final'
					? r
					: registro({ ...r.data, essencial: false }),
			),
			total: ROSTER.length,
		}));
		chamadaFalsa.mockImplementation(async (o) =>
			o.user.includes('Escreva o prompt')
				? resposta({ text: '{"prompt":"uma caneca"}' })
				: Promise.reject(new ChamadaError('vazia', 'vazio')),
		);
		await expect(
			aiArtTeamBlock.run(ctxDeTeste(), params()),
		).rejects.toMatchObject({ status: 502 });
	});

	it('roster vazio é erro de configuração, não um run cobrado em branco', async () => {
		repoList.mockImplementation(async () => ({ items: [], total: 0 }));
		await expect(
			aiArtTeamBlock.run(ctxDeTeste(), params()),
		).rejects.toMatchObject({ status: 400 });
	});

	it('o roster é lido como STAFF — é o que protege os prompts', async () => {
		/**
		 * A coleção é `visibility:'staff'` porque os prompts SÃO o produto, e o
		 * repositório esconde `staff` de quem não é. Lida como aluno, ela volta
		 * vazia e o bloco morre com "nenhum especialista configurado" — em
		 * produção, para todo mundo.
		 */
		timeInteiroResponde();
		await aiArtTeamBlock.run(ctxDeTeste(), params());
		expect(repoList.mock.calls[0]?.[3]?.viewer).toEqual({
			customerId: 'c1',
			isStaff: true,
		});
	});

	it('A MARCA CHEGA AOS ESPECIALISTAS QUE A PEDIRAM, e só a eles', async () => {
		timeInteiroResponde();
		const out = (await aiArtTeamBlock.run(
			ctxDeTeste(),
			params({
				marca: [
					{
						nome: 'Laser da Ana',
						tom_de_voz: 'divertido',
						cor_primaria: '#ff0055',
						nao_usar: 'fundo preto',
						principal: true,
					},
				],
			}),
		)) as Record<string, unknown>;

		const pedidoDoRedator = chamadaFalsa.mock.calls.find(([o]) =>
			o.user.includes('Escreva o texto'),
		)?.[0].user;
		expect(pedidoDoRedator).toContain('Laser da Ana');
		expect(pedidoDoRedator).toContain('NUNCA use: fundo preto');

		// O Diretor não escreveu `{marca}` na pergunta dele: não recebe.
		const pedidoDoDiretor = chamadaFalsa.mock.calls.find(([o]) =>
			o.user.includes('Como enquadrar?'),
		)?.[0].user;
		expect(pedidoDoDiretor).not.toContain('Laser da Ana');

		// E a resposta diz QUE marca temperou o run: é a única forma de separar
		// "não tem marca" de "a marca não chegou".
		expect(out.marca_usada).toBe('Laser da Ana');
	});

	it('sem marca nenhuma o `{marca}` some, e não vira `{marca}` literal', async () => {
		timeInteiroResponde();
		await aiArtTeamBlock.run(ctxDeTeste(), params({ marca: undefined }));
		for (const [o] of chamadaFalsa.mock.calls) {
			expect(o.user).not.toContain('{marca}');
		}
	});

	it('um sétimo especialista cadastrado pela tela trabalha e aparece', async () => {
		repoList.mockImplementation(async () => ({
			items: [
				...ROSTER,
				registro({
					chave: 'consultor_gravacao',
					nome: 'Consultor de Gravação',
					papel: 'Você avisa o que não grava bem.',
					pergunta: 'O que evitar para gravar?',
					fase: 'aprofundamento',
					ordem: 60,
				}),
			],
			total: 7,
		}));
		timeInteiroResponde();
		// Ele não declarou `saida`: o produto dele é prosa, não ficha.
		chamadaFalsa.mockImplementationOnce(async () => resposta({ text: '{}' }));
		const anterior = chamadaFalsa.getMockImplementation();
		chamadaFalsa.mockImplementation(async (o) =>
			o.user.includes('O que evitar para gravar?')
				? resposta({ text: 'Fuja de degradê: vira sujeira no corte.' })
				: ((await anterior?.(o)) ?? resposta()),
		);
		const out = (await aiArtTeamBlock.run(ctxDeTeste(), params())) as Record<
			string,
			unknown
		>;
		const agentes = out.agentes as { chave: string; texto: string }[];
		expect(agentes.map((a) => a.chave)).toContain('consultor_gravacao');
		// Ele não devolveu JSON, então o que ele escreveu viaja como TEXTO — sem
		// isso o cartão dele nasceria em branco na mesa de criação.
		expect(
			agentes.find((a) => a.chave === 'consultor_gravacao')?.texto,
		).toBeTruthy();
	});

	it('o `entrega`, o `formato` e a paleta entram no briefing como variáveis', async () => {
		repoList.mockImplementation(async () => ({
			items: [
				registro({
					chave: 'prompt_final',
					nome: 'Prompt Final',
					papel: 'Você escreve o pedido da imagem.',
					pergunta: 'Peça {entrega} em {formato} com as cores {paleta}.',
					fase: 'sintese',
					essencial: true,
				}),
			],
			total: 1,
		}));
		chamadaFalsa.mockResolvedValue(resposta({ text: 'um post bonito' }));
		await aiArtTeamBlock.run(
			ctxDeTeste(),
			params({
				entrega: 'post para redes',
				formato: '9:16',
				paleta: { colors: ['#ff0055', '#111111'] },
			}),
		);
		expect(chamadaFalsa.mock.calls[0]?.[0].user).toBe(
			'Peça post para redes em 9:16 com as cores #ff0055, #111111.',
		);
	});
});

describe('a paleta vem do que EXISTE na imagem', () => {
	it('aceita as duas formas em que `image.palette` chega', () => {
		expect(paletaEmTexto(['#ff0055', '#111'])).toBe('#ff0055, #111');
		expect(paletaEmTexto({ colors: ['#ff0055'] })).toBe('#ff0055');
		expect(paletaEmTexto([{ hex: '#abcdef' }])).toBe('#abcdef');
		expect(paletaEmTexto('#ff0055, #111111')).toBe('#ff0055, #111111');
	});

	it('e o que não é cor não entra no prompt', () => {
		expect(paletaEmTexto(['vermelho', '#ff0055'])).toBe('#ff0055');
		expect(paletaEmTexto(undefined)).toBe('');
	});
});

/* ═════════ o que cada um entrega, normalizado ═════════ */

describe('a saída dos especialistas é normalizada em TypeScript', () => {
	it('o Redator pode dizer `headline` ou `titulo` — a tela vê a mesma coisa', () => {
		expect(extrairCopy({ headline: 'Oi', cta: 'Compre' })).toMatchObject({
			titulo: 'Oi',
			chamada: 'Compre',
		});
		expect(extrairCopy({ titulo: 'Oi', chamada: 'Compre' })).toMatchObject({
			titulo: 'Oi',
			chamada: 'Compre',
		});
	});

	it('a cerquilha da hashtag é do FORMATO, não do sorteio do modelo', () => {
		expect(extrairCopy({ hashtags: ['laser', '#corte'] }).hashtags).toEqual([
			'#laser',
			'#corte',
		]);
		expect(extrairCopy({ hashtags: 'laser corte' }).hashtags).toEqual([
			'#laser',
			'#corte',
		]);
	});

	it('o prompt sai do JSON ou do texto cru — os dois rosters são legítimos', () => {
		expect(extrairPrompt({ prompt: 'uma caneca' }).prompt).toBe('uma caneca');
		expect(extrairPrompt(undefined, 'uma caneca').prompt).toBe('uma caneca');
	});

	it('JSON QUEBRADO NÃO VIRA PROMPT — ele viraria chave e aspas desenhadas', () => {
		expect(extrairPrompt(undefined, '{"prompt":"uma cane').prompt).toBe('');
	});

	it('o `o_que_nao_pode_aparecer` do roster É o prompt negativo', () => {
		/**
		 * É o nome que o seed do time usa. Sem este apelido, a proibição da marca
		 * — o campo que mais segura o modelo — sairia da síntese e morreria no
		 * caminho, sem erro nenhum.
		 */
		expect(
			extrairPrompt({
				prompt: 'uma caneca',
				o_que_nao_pode_aparecer: 'pessoas, marca d\u2019água',
			}).negativo,
		).toBe('pessoas, marca d\u2019água');
	});

	it('a frase que vai DENTRO da arte tem campo próprio', () => {
		/**
		 * Ela não é o título: são no máximo cinco palavras, vão entre aspas dentro
		 * do prompt e vazio é resposta legítima (arte sem texto é melhor que arte
		 * com letra torta).
		 */
		expect(
			extrairCopy({ titulo: 'Caneca nova', texto_na_arte: 'Feito à mão' })
				.texto_na_arte,
		).toBe('Feito à mão');
	});

	it('a proibição NÃO é escrita duas vezes quando a síntese já escreveu a dela', () => {
		/**
		 * O roster manda o especialista terminar o pedido com uma frase começando
		 * em "NÃO:". Quando ele obedece, acrescentar a nossa produz duas listas de
		 * proibição no mesmo prompt — com o risco de a segunda contradizer a
		 * primeira.
		 */
		const p = comporPrompt({
			prompt: 'Caneca branca. NÃO: pessoas, moldura, marca d\u2019água.',
			negativo: 'fundo preto',
		});
		expect(p).toBe('Caneca branca. NÃO: pessoas, moldura, marca d\u2019água.');
	});

	it('a proibição entra no prompt UMA vez, porque o gerador lê uma string só', () => {
		const p = comporPrompt({ prompt: 'Caneca branca', negativo: 'pessoas' });
		expect(p).toBe('Caneca branca\n\nNÃO INCLUA: pessoas.');
		// Se o especialista já escreveu, não repete.
		expect(
			comporPrompt({ prompt: 'Caneca sem pessoas', negativo: 'pessoas' }),
		).toBe('Caneca sem pessoas');
	});

	it('e o prompt cabe no que o gerador aceita — senão o run já foi pago', () => {
		/**
		 * `ai.image_studio` recusa `prompt` acima de 8.000 caracteres. Quem paga
		 * esse 400 é um run em que o time inteiro JÁ trabalhou.
		 */
		expect(MAX_PROMPT).toBeLessThan(8_000);
		const gigante = comporPrompt({ prompt: 'x'.repeat(50_000), negativo: 'y' });
		expect(gigante.length).toBeLessThanOrEqual(MAX_PROMPT);
	});
});
