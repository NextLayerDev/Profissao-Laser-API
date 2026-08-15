import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	type AgentSpec,
	interpolar,
	MAX_TOKENS_TETO,
	montarTime,
	normalizarFase,
	pisoDeSucesso,
	selecionarAgentes,
	TETO_POR_MODO,
	toAgentSpec,
} from '@/lib/research/agents.js';
import {
	Budget,
	comLimite,
	estimarCustoUsd,
	LIMITES_PADRAO,
	msMinimoUtil,
} from '@/lib/research/budget.js';
import {
	calcularMargem,
	chaveUrl,
	conjuntoDeUrls,
	custoComFonte,
	custosDeInsumos,
	extrairObservacao,
	falaDoMesmoInsumo,
	fundirCustos,
	MAX_PRODUTOS,
	normalizarProdutos,
	numeroBrlEstrito,
	ordenarProdutos,
	type ProdutoOportunidade,
} from '@/lib/research/oportunidade.js';
import {
	CONFIANCA_MINIMA,
	consolidarPrecos,
	extrairPrecos,
	faixaConfiavel,
	MIN_AMOSTRA,
	mediana,
} from '@/lib/research/price-stats.js';
import {
	extrairCitacoes,
	filtrarPorTema,
	montarPlugin,
	parseDominios,
	type SearchCallResult,
	SearchError,
	USD_POR_BUSCA,
} from '@/lib/research/search.js';
import {
	aiResearchTeamBlock,
	alvosDeFoto,
	escolherAlternativo,
	filaDePaginas,
	gastoDeFalha,
	repartirChars,
	rodarAgente,
	semFotoDoModelo,
	semLinkInventado,
	soReferenciasComPagina,
	soVendidosNaPagina,
	TETO_DIGEST_ONDA2,
	TETO_DIGEST_ONDA3,
	tetoDeFotos,
} from '@/tool-blocks/blocks/ai-research-team.js';
import type { BlockProgressEvent } from '@/tool-blocks/types.js';

/**
 * A chamada ao modelo é a ÚNICA coisa dublada aqui.
 *
 * `rodarAgente` roda de verdade — com o `Budget` de verdade, o catálogo de
 * modelos de verdade e os eventos de tela de verdade. É onde moram as
 * regressões caras deste bloco (retry sem consultar orçamento, chamada paga com
 * o relógio no fim, gasto de chamada que falhou sumindo da conta), e testá-las
 * por uma cópia da lógica seria testar a cópia.
 */
vi.mock('@/lib/research/search.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('@/lib/research/search.js')>();
	return { ...real, chamarComBusca: vi.fn() };
});
const { chamarComBusca } = await import('@/lib/research/search.js');
const chamadaFalsa = vi.mocked(chamarComBusca);

/**
 * A ÚNICA outra saída de rede: abrir a página do anúncio.
 *
 * Dublada para que o teste possa dizer o que cada página RESPONDEU — que é o
 * dado sobre o qual o bloco decide se um preço vira "anúncio". O resto do
 * arquivo (allowlist, leitura do `<head>`, `og:type`) roda de verdade em
 * `tests/og-image.test.ts`, com o `<head>` real das páginas dos runs.
 *
 * Padrão: mapa vazio — nenhuma página abriu. É o que já acontecia nos testes
 * antigos, onde a allowlist barrava tudo antes do DNS.
 */
/**
 * `conferirFotos` entra no mesmo dublê pelo mesmo motivo, e ele é a SEGUNDA
 * saída de rede desde que status 200 deixou de valer como prova de imagem: o
 * bloco baixa o começo de cada arquivo antes de deixá-lo virar ladrilho. O
 * padrão aqui é APROVAR TUDO — assim um teste que não fala de foto continua
 * medindo o que ele veio medir, e quem quer testar a recusa dubla o retorno.
 * A regra de bytes (md5 do placeholder, piso de tamanho e de lado) roda de
 * verdade em `tests/og-image.test.ts`.
 */
vi.mock('@/lib/research/og-image.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('@/lib/research/og-image.js')>();
	return {
		...real,
		inspecionarPaginas: vi.fn(async () => new Map()),
		conferirFotos: vi.fn(async (urls: string[]) => new Set(urls)),
	};
});
const { inspecionarPaginas, conferirFotos } = await import(
	'@/lib/research/og-image.js'
);
const paginasFalsas = vi.mocked(inspecionarPaginas);
const fotosFalsas = vi.mocked(conferirFotos);

/**
 * As BORDAS do bloco — banco e definition — para poder rodar `run` de verdade.
 *
 * O que se ganha com isso: a costura entre cache, time e "Comece por estes
 * produtos" é onde moram os bugs que a tela paga (lista servida do cache de
 * outra execução, seção que some, aviso que não sai). Testar isso por fora do
 * `run` seria testar uma cópia da costura.
 */
const repoList = vi.fn();
const repoUpdate = vi.fn(async (..._a: unknown[]) => ({}));
const repoCreate = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock('@/repositories/tool-collection.js', () => ({
	toolCollectionRepository: {
		list: (...a: unknown[]) => repoList(...a),
		update: (...a: unknown[]) => repoUpdate(...a),
		create: (...a: unknown[]) => repoCreate(...a),
	},
}));
vi.mock('@/lib/tool-collections.js', () => ({
	resolveCollection: () => ({ fields: [] }),
}));
vi.mock('@/lib/tool-definitions.js', () => ({
	loadPublishedToolDefinition: () => {
		throw new Error('o bloco recebe a definition pronta em ctx.toolDoc');
	},
}));

/* ══════════════════════ preço: a invariante nº 1 ══════════════════════ */

describe('preço de mercado sai de código, nunca do LLM', () => {
	it('só conta número com marcador de moeda', () => {
		// "2000" numa página é ano, CEP ou quantidade vendida — não é preço.
		expect(extrairPrecos('lançado em 2000, vendido 350 vezes')).toEqual([]);
		expect(extrairPrecos('R$ 89,90')).toEqual([8990]);
		expect(extrairPrecos('R$1.234,56')).toEqual([123456]);
		expect(extrairPrecos('custa 79 reais')).toEqual([7900]);
		expect(extrairPrecos('R$ 99')).toEqual([9900]);
	});

	it('OBSERVAÇÃO SEM FONTE É DESCARTADA — no código, não no prompt', () => {
		const { stats, usadas } = consolidarPrecos([
			{ brlCents: 5000, url: 'https://a.com/1' },
			{ brlCents: 6000, url: 'https://a.com/2' },
			{ brlCents: 7000, url: 'https://a.com/3' },
			// A que o modelo "lembrou" — sem link. É a que mata o produto.
			{ brlCents: 999_00, url: '' },
			{ brlCents: 888_00, url: 'nao-e-url' },
		]);
		expect(usadas).toHaveLength(3);
		expect(stats?.n).toBe(3);
		expect(stats?.descartados).toBe(2);
		expect(usadas.every((o) => o.url.startsWith('https://'))).toBe(true);
	});

	it('outlier absurdo cai fora, e a mediana é a âncora', () => {
		const { stats, usadas } = consolidarPrecos([
			{ brlCents: 8000, url: 'https://a/1' },
			{ brlCents: 9000, url: 'https://a/2' },
			{ brlCents: 10_000, url: 'https://a/3' },
			// Frete/parcela/"a partir de" de outro item na mesma página.
			{ brlCents: 90, url: 'https://a/4' },
			{ brlCents: 5_000_000, url: 'https://a/5' },
		]);
		expect(stats?.n).toBe(3);
		// `.sort()` sem comparador ordena como TEXTO ("10000" < "8000") — a
		// primeira versão deste teste caiu por isso, não por bug da lib.
		expect(usadas.map((o) => o.brlCents).sort((a, b) => a - b)).toEqual([
			8000, 9000, 10_000,
		]);
	});

	it('o `motivo` é FRASE, não log — ele é impresso ao aluno', () => {
		// "só 1 anúncio(s) com preço e fonte" saiu na tela num run real.
		const um = consolidarPrecos([{ brlCents: 4000, url: 'https://a/1' }]);
		expect(um.stats?.motivo).toBe(
			'só um anúncio com preço e fonte — não dá para cravar uma faixa',
		);
		const dois = consolidarPrecos([
			{ brlCents: 4000, url: 'https://a/1' },
			{ brlCents: 4200, url: 'https://a/2' },
		]);
		expect(dois.stats?.motivo).toMatch(/^só 2 anúncios /);
		for (const r of [um, dois]) expect(r.stats?.motivo).not.toMatch(/\(s\)/);
	});

	it('amostra pequena NÃO vira faixa — a tela tem que dizer que não achou', () => {
		const { stats } = consolidarPrecos([
			{ brlCents: 5000, url: 'https://a/1' },
			{ brlCents: 6000, url: 'https://a/2' },
		]);
		expect(stats?.n).toBe(2);
		expect(faixaConfiavel(stats)).toBe(false);
		expect(stats?.motivo).toMatch(/não dá para cravar/i);
	});

	it('nenhuma observação com fonte ⇒ sem estatística nenhuma', () => {
		const { stats } = consolidarPrecos([{ brlCents: 5000, url: '' }]);
		expect(stats).toBeNull();
		expect(faixaConfiavel(stats)).toBe(false);
	});

	it('preços que discordam muito derrubam a confiança', () => {
		const juntos = consolidarPrecos(
			[4500, 5000, 5200, 5500, 6000].map((c, i) => ({
				brlCents: c,
				url: `https://a/${i}`,
			})),
		);
		const espalhados = consolidarPrecos(
			[1000, 2000, 5000, 12_000, 24_000].map((c, i) => ({
				brlCents: c,
				url: `https://b/${i}`,
			})),
		);
		expect(juntos.stats?.confianca).toBeGreaterThan(
			espalhados.stats?.confianca ?? 1,
		);
		expect(espalhados.stats?.motivo).toMatch(/muito diferentes/);
	});

	it('percentis e mediana batem com a conta feita à mão', () => {
		const { stats } = consolidarPrecos(
			[1000, 2000, 3000, 4000, 5000].map((c, i) => ({
				brlCents: c,
				url: `https://a/${i}`,
			})),
		);
		expect(stats?.medianaCents).toBe(3000);
		expect(stats?.p25Cents).toBe(2000);
		expect(stats?.p75Cents).toBe(4000);
		expect(stats?.minCents).toBe(1000);
		expect(stats?.maxCents).toBe(5000);
		expect(mediana([3, 1, 2])).toBe(2);
	});

	it('MIN_AMOSTRA é 3 — mudar isso é decisão de produto, não de código', () => {
		expect(MIN_AMOSTRA).toBe(3);
	});
});

/* ══════════════════════ busca ══════════════════════ */

describe('plugin de busca', () => {
	it('include_domains SÓ com perplexity — medido, não opinião', () => {
		// Com `exa` (busca semântica), restringir domínio devolveu cooler de PC
		// numa busca por placa de PIX. O filtro é ignorado e o motivo registrado.
		const comExa = montarPlugin({
			engine: 'exa',
			maxResults: 6,
			includeDomains: ['mercadolivre.com.br'],
		});
		expect(comExa.plugin.include_domains).toBeUndefined();
		expect(comExa.aviso).toMatch(/degrada a relev/i);

		const comPplx = montarPlugin({
			engine: 'perplexity',
			maxResults: 6,
			includeDomains: ['mercadolivre.com.br'],
		});
		expect(comPplx.plugin.include_domains).toEqual(['mercadolivre.com.br']);
		expect(comPplx.aviso).toBeUndefined();
	});

	it('max_results fica dentro do que o provedor aceita', () => {
		expect(
			montarPlugin({ engine: 'exa', maxResults: 999 }).plugin.max_results,
		).toBe(10);
		expect(
			montarPlugin({ engine: 'exa', maxResults: 0 }).plugin.max_results,
		).toBe(1);
	});

	it('domínios do admin viram host limpo', () => {
		expect(
			parseDominios('https://mercadolivre.com.br/algo, shopee.com.br '),
		).toEqual(['mercadolivre.com.br', 'shopee.com.br']);
		expect(parseDominios('')).toEqual([]);
		expect(parseDominios(undefined)).toEqual([]);
	});

	it('lê as citações do formato annotations[].url_citation', () => {
		const cits = extrairCitacoes({
			annotations: [
				{
					type: 'url_citation',
					url_citation: { url: 'https://a', title: 'A' },
				},
				{ type: 'outra_coisa' },
				{ url_citation: { title: 'sem url' } },
			],
		});
		expect(cits).toEqual([
			{ url: 'https://a', title: 'A', content: undefined },
		]);
		expect(extrairCitacoes(null)).toEqual([]);
	});

	it('descarta resultado fora do tema antes de gastar token com ele', () => {
		const cits = [
			{ url: 'https://a/1', title: 'Placa Pix acrílico', content: 'R$ 80' },
			{ url: 'https://a/2', title: 'Cooler AMD Wraith', content: 'RGB' },
		];
		const r = filtrarPorTema(cits, ['pix', 'placa']);
		expect(r.mantidas).toHaveLength(1);
		expect(r.descartadas).toBe(1);
	});

	it('sem palavras-chave não filtra — melhor não filtrar que filtrar errado', () => {
		const cits = [{ url: 'https://a', title: 'x' }];
		expect(filtrarPorTema(cits, []).mantidas).toHaveLength(1);
		expect(filtrarPorTema(cits, ['ab']).mantidas).toHaveLength(1); // curta demais
	});
});

/* ══════════════════════ o time ══════════════════════ */

function spec(over: Partial<AgentSpec> = {}): AgentSpec {
	return {
		chave: 'a',
		nome: 'A',
		papel: 'p',
		pergunta: 'q',
		saida: '',
		motorBusca: 'nenhum',
		maxBuscas: 0,
		dominiosIncluir: [],
		dominiosExcluir: [],
		modo: 'ambos',
		escopo: 'ambos',
		filtrarPorTema: true,
		compartilhavel: false,
		essencial: false,
		temperatura: 0.2,
		maxTokens: 1200,
		timeoutS: 60,
		icone: 'search',
		cor: '#000',
		fraseTrabalhando: '…',
		ordem: 1,
		ativo: true,
		fase: 'descoberta',
		...over,
	};
}

describe('configuração do time vem da coleção', () => {
	it('registro incompleto some da lista em vez de rodar e devolver ruído', () => {
		expect(toAgentSpec({ title: 'X', data: {} })).toBeNull();
		expect(
			toAgentSpec({ title: 'X', data: { chave: 'k', papel: 'p' } }),
		).toBeNull();
		expect(
			toAgentSpec({
				title: 'X',
				data: { chave: 'k', papel: 'p', pergunta: 'q' },
			}),
		).not.toBeNull();
	});

	it('motor desconhecido vira `nenhum`, e sem motor não há busca', () => {
		const a = toAgentSpec({
			title: 'X',
			data: {
				chave: 'k',
				papel: 'p',
				pergunta: 'q',
				motor_busca: 'google',
				max_buscas: 5,
			},
		});
		expect(a?.motorBusca).toBe('nenhum');
		expect(a?.maxBuscas).toBe(0);
	});

	it('`ativo` ausente NÃO desliga o agente', () => {
		// Um campo que ninguém preencheu não pode apagar o time inteiro.
		const a = toAgentSpec({
			title: 'X',
			data: { chave: 'k', papel: 'p', pergunta: 'q' },
		});
		expect(a?.ativo).toBe(true);
		const b = toAgentSpec({
			title: 'X',
			data: { chave: 'k', papel: 'p', pergunta: 'q', ativo: false },
		});
		expect(b?.ativo).toBe(false);
	});

	it('valores fora de faixa são apertados, não recusados', () => {
		const a = toAgentSpec({
			title: 'X',
			data: {
				chave: 'k',
				papel: 'p',
				pergunta: 'q',
				temperatura: 99,
				max_tokens: 1,
				timeout_s: 9999,
			},
		});
		expect(a?.temperatura).toBe(2);
		expect(a?.maxTokens).toBe(200);
		expect(a?.timeoutS).toBe(120);
	});

	/**
	 * O TETO DE SAÍDA É DADO — e o motor apertava o dado em silêncio.
	 *
	 * `Math.min(4000, …)` derrubava um run inteiro por dia: com a onda 3 lendo o
	 * digest de DUAS ondas, a resposta do Estrategista fecha em 5.708 tokens
	 * (medido) e ele batia nos 4.000 com o JSON cortado. Como é `essencial`, o
	 * bloco devolvia 502, o controller estornava, e o admin que tentasse
	 * consertar pela Fábrica salvava 6.000 sem efeito nenhum: a tela mostrava
	 * 6.000 e o motor mandava 4.000. Teto de código não pode contradizer a
	 * regra de que o time é dado.
	 */
	it('O ADMIN CONSEGUE SUBIR O TETO DE SAÍDA — 4.000 era teto de código', () => {
		const teto = (max_tokens: number) =>
			toAgentSpec({
				title: 'X',
				data: { chave: 'k', papel: 'p', pergunta: 'q', max_tokens },
			})?.maxTokens;
		// O valor que o Estrategista precisa hoje passa inteiro.
		expect(teto(9_000)).toBe(9_000);
		expect(teto(6_000)).toBe(6_000);
		// E continua havendo teto.
		expect(teto(50_000)).toBe(MAX_TOKENS_TETO);
	});

	/**
	 * O TETO É UMA CONTA CONTRA O RELÓGIO REAL — e a conta estava com o número
	 * errado dos dois lados.
	 *
	 * O comentário de `MAX_TOKENS_TETO` justificava 8.000 com "o deadline do
	 * modo RÁPIDO é 95 s", e `LIMITES_PADRAO.rapido.deadlineMs` é 120_000 desde
	 * que esta mesma feature o subiu. Pior: usava os 8 ms/token de
	 * `msMinimoUtil`, que são o MELHOR caso e existem para responder "vale a
	 * tentativa?" — não "a chamada termina?". O ritmo REAL medido do Sonnet em
	 * 4 runs frios é 11,8 a 13,1 ms por token.
	 *
	 * Este teste amarra o teto ao deadline de verdade: no ritmo medido, a
	 * resposta inteira ainda cabe no modo mais curto. Ser cortado por
	 * `max_tokens` é retriável; ser cortado por TIMEOUT não é, e no essencial
	 * vira 502 + estorno.
	 */
	it('e o teto CABE no deadline do rápido ao ritmo medido (12,8 ms/token)', () => {
		const MS_MEDIDO_POR_TOKEN = 12.8;
		const abertura = 3_000;
		const cabe =
			MAX_TOKENS_TETO * MS_MEDIDO_POR_TOKEN + abertura <=
			LIMITES_PADRAO.rapido.deadlineMs;
		expect(cabe, `${MAX_TOKENS_TETO} tokens não cabem no rápido`).toBe(true);
		// E não é folga de sobra: o teto usa o relógio que tem. Sem esta metade,
		// baixar o deadline sem baixar o teto passaria despercebido.
		expect(
			(MAX_TOKENS_TETO * MS_MEDIDO_POR_TOKEN + abertura) /
				LIMITES_PADRAO.rapido.deadlineMs,
		).toBeGreaterThan(0.9);
	});

	it('CACHE QUENTE pula os compartilháveis — é o mecanismo do cache de 7 dias', () => {
		const time = [
			spec({ chave: 'preco', compartilhavel: true, ordem: 1 }),
			spec({ chave: 'canal', compartilhavel: true, ordem: 2 }),
			spec({ chave: 'custo', compartilhavel: false, ordem: 3 }),
		];
		const frio = selecionarAgentes(time, {
			modo: 'profundo',
			escopo: 'produto',
		});
		const quente = selecionarAgentes(time, {
			modo: 'profundo',
			escopo: 'produto',
			jaCobertos: new Set(['preco', 'canal']),
		});
		expect(frio.map((a) => a.chave)).toEqual(['preco', 'canal', 'custo']);
		expect(quente.map((a) => a.chave)).toEqual(['custo']);
	});

	it('modo do agente decide se ele entra no rápido', () => {
		const time = [
			spec({ chave: 'so_profundo', modo: 'profundo' }),
			spec({ chave: 'sempre', modo: 'ambos' }),
			spec({ chave: 'so_rapido', modo: 'rapido' }),
		];
		expect(
			selecionarAgentes(time, { modo: 'rapido', escopo: 'produto' }).map(
				(a) => a.chave,
			),
		).toEqual(['sempre', 'so_rapido']);
	});

	it('desligado não entra, e o teto corta o excesso', () => {
		const time = [spec({ chave: 'on' }), spec({ chave: 'off', ativo: false })];
		expect(
			selecionarAgentes(time, { modo: 'rapido', escopo: 'produto' }).map(
				(a) => a.chave,
			),
		).toEqual(['on']);
		const muitos = Array.from({ length: 20 }, (_, i) =>
			spec({ chave: `a${i}`, ordem: i }),
		);
		expect(
			selecionarAgentes(muitos, { modo: 'rapido', escopo: 'produto', teto: 3 }),
		).toHaveLength(3);
	});

	it('o piso de sucesso é o número de essenciais', () => {
		expect(
			pisoDeSucesso([
				spec({ essencial: true }),
				spec({ essencial: true }),
				spec(),
			]),
		).toBe(2);
		// Sem nenhum essencial, basta um entregar — senão o run falharia à toa.
		expect(pisoDeSucesso([spec(), spec()])).toBe(1);
		expect(pisoDeSucesso([])).toBe(0);
	});

	it('COM 22, "os 2 essenciais entregaram" deixa de ser piso — vira 1/3 do time', () => {
		// Com 5, os 2 essenciais do rápido são 40% do time e o piso tem sentido.
		// Com 22 eles são 9%: o piso passaria a autorizar 6 voxxys por uma tela
		// com nota, veredito e mais NADA — vinte cartões de "não consegui
		// pesquisar" na sala de guerra e cobrança em cima.
		const time22 = [
			...Array.from({ length: 20 }, (_, i) => spec({ chave: `p${i}` })),
			spec({ chave: 'radar', essencial: true }),
			spec({ chave: 'estrategista', essencial: true, fase: 'sintese' }),
		];
		expect(pisoDeSucesso(time22)).toBe(8);

		// E o RÁPIDO não muda: os 2 essenciais dele JÁ são ⌈5/3⌉ = 2.
		const time5 = [
			spec({ chave: 'a' }),
			spec({ chave: 'b' }),
			spec({ chave: 'c' }),
			spec({ chave: 'radar', essencial: true }),
			spec({ chave: 'estrategista', essencial: true, fase: 'sintese' }),
		];
		expect(pisoDeSucesso(time5)).toBe(2);

		// Roster com MAIS essenciais que a fração continua mandando: a regra nova
		// entra onde a antiga virou letra morta, não no lugar dela.
		expect(
			pisoDeSucesso(
				Array.from({ length: 6 }, (_, i) =>
					spec({ chave: `e${i}`, essencial: i < 5 }),
				),
			),
		).toBe(5);
		// E nunca pede mais entregas do que existem especialistas rodando.
		expect(pisoDeSucesso([spec()])).toBe(1);
	});

	it('5 no rápido e 22 no profundo — é promessa de tela, não número de engenharia', () => {
		expect(TETO_POR_MODO.rapido).toBe(5);
		expect(TETO_POR_MODO.profundo).toBe(22);
	});

	it('`fase: "pesquisa"` gravado no banco continua valendo, e vira `descoberta`', () => {
		// A coleção `agentes` é DADO: existem registros com o valor antigo e
		// ninguém migra linha de banco por causa de um rename. Se isto quebrar, um
		// roster antigo perde a onda 1 inteira e o time roda vazio.
		const base = { chave: 'x', papel: 'p', pergunta: 'q' };
		const fase = (v: unknown) =>
			toAgentSpec({ title: 'X', data: { ...base, fase: v } })?.fase;
		expect(fase('pesquisa')).toBe('descoberta');
		expect(fase('descoberta')).toBe('descoberta');
		expect(fase('aprofundamento')).toBe('aprofundamento');
		expect(fase('sintese')).toBe('sintese');
		// Ausente ou lixo cai na onda 1 — a única que não depende de material de
		// ninguém, ou seja, o único padrão que não pode quebrar.
		expect(fase(undefined)).toBe('descoberta');
		expect(fase('onda_nova_que_ninguem_implementou')).toBe('descoberta');
		expect(normalizarFase('  Aprofundamento ')).toBe('aprofundamento');
	});

	it('O TETO DO PROFUNDO ENTREGA 22 E NUNCA CORTA O ESTRATEGISTA', () => {
		// 40 especialistas fictícios (o roster é editável pela tela: nada impede
		// alguém de semear 40) contra a política de 22.
		const comuns = Array.from({ length: 39 }, (_, i) =>
			spec({ chave: `pesq${i}`, ordem: i + 1 }),
		);
		const estrategista = spec({
			chave: 'estrategista',
			ordem: 90,
			fase: 'sintese',
			essencial: true,
		});
		const time = [...comuns, estrategista];

		const profundo = selecionarAgentes(time, {
			modo: 'profundo',
			escopo: 'mercado',
			teto: 26,
		});
		expect(profundo).toHaveLength(22);
		expect(profundo.map((a) => a.chave)).toContain('estrategista');
		// O rápido continua em 5, com o mesmo roster absurdo.
		expect(
			selecionarAgentes(time, { modo: 'rapido', escopo: 'mercado', teto: 26 }),
		).toHaveLength(5);
	});

	it('o limite DURO sacrifica a onda 2 ANTES da onda 1', () => {
		// A onda 2 VIVE do digest da onda 1: cortar a 1 e deixar a 2 de pé faria
		// o sobrevivente pesquisar "os concorrentes que a onda 1 achou" com uma
		// onda 1 vazia — chamada paga, busca paga, resposta sem insumo.
		const time = [
			spec({ chave: 'd1', ordem: 10, fase: 'descoberta' }),
			spec({ chave: 'd2', ordem: 11, fase: 'descoberta' }),
			// `ordem` MENOR que a da descoberta de propósito: a regra é a onda, não
			// o número que alguém digitou na tela.
			spec({ chave: 'a1', ordem: 1, fase: 'aprofundamento' }),
			spec({ chave: 'estrategista', ordem: 90, fase: 'sintese' }),
		];
		expect(
			selecionarAgentes(time, {
				modo: 'profundo',
				escopo: 'mercado',
				teto: 3,
			}).map((a) => a.chave),
		).toEqual(['d1', 'd2', 'estrategista']);
	});

	it('o teto corta a PESQUISA e nunca o Estrategista', () => {
		// 20 pesquisadores comuns + quem escreve o veredito, que é o último em
		// ordem: um `slice` por ordem crescente derrubaria justamente ele, e o
		// aluno receberia dez pesquisas e nenhuma conclusão.
		const comuns = Array.from({ length: 20 }, (_, i) =>
			spec({ chave: `pesq${i}`, ordem: i + 1 }),
		);
		const estrategista = spec({
			chave: 'estrategista',
			ordem: 90,
			fase: 'sintese',
			essencial: true,
		});
		const time = [...comuns, estrategista];

		const rapido = selecionarAgentes(time, {
			modo: 'rapido',
			escopo: 'mercado',
		});
		expect(rapido).toHaveLength(5);
		expect(rapido.map((a) => a.chave)).toEqual([
			'pesq0',
			'pesq1',
			'pesq2',
			'pesq3',
			'estrategista',
		]);

		const profundo = selecionarAgentes(time, {
			modo: 'profundo',
			escopo: 'produto',
		});
		// 20 pesquisadores + o Estrategista: o profundo pede 22 e o roster deste
		// teste só tem 21, então entrega os 21 — o teto não INVENTA especialista.
		expect(profundo).toHaveLength(21);
		expect(profundo.map((a) => a.chave)).toContain('estrategista');
	});

	it('essencial não é cortado pelo teto, mesmo com ordem alta', () => {
		const comuns = Array.from({ length: 10 }, (_, i) =>
			spec({ chave: `c${i}`, ordem: i + 1 }),
		);
		const radar = spec({ chave: 'radar', ordem: 50, essencial: true });
		const r = selecionarAgentes([...comuns, radar], {
			modo: 'rapido',
			escopo: 'mercado',
		});
		expect(r).toHaveLength(5);
		expect(r.map((a) => a.chave)).toContain('radar');
	});

	it('o limite DURO sacrifica pesquisador antes de quem escreve o dossiê', () => {
		// Freio de emergência contra roster mal semeado — não é a política.
		const time = [
			...Array.from({ length: 8 }, (_, i) =>
				spec({ chave: `p${i}`, ordem: i + 1 }),
			),
			spec({
				chave: 'estrategista',
				ordem: 90,
				fase: 'sintese',
				essencial: true,
			}),
		];
		expect(
			selecionarAgentes(time, {
				modo: 'profundo',
				escopo: 'mercado',
				teto: 2,
			}).map((a) => a.chave),
		).toEqual(['p0', 'estrategista']);
	});

	it('CACHE QUENTE NÃO ENCOLHE O TIME — só muda quem trabalha', () => {
		// O bug que isto tranca: a tela anunciava "1/3 PROFISSIONAIS" logo depois
		// de o botão prometer cinco, porque o cacheado sumia da lista.
		const time = [
			spec({ chave: 'preco', compartilhavel: true, ordem: 10 }),
			spec({ chave: 'demanda', compartilhavel: true, ordem: 20 }),
			spec({ chave: 'canais', compartilhavel: true, ordem: 30 }),
			spec({ chave: 'producao', ordem: 60 }),
			spec({
				chave: 'estrategista',
				ordem: 90,
				fase: 'sintese',
				essencial: true,
			}),
		];
		const t = montarTime(time, {
			modo: 'rapido',
			escopo: 'mercado',
			jaCobertos: new Set(['preco', 'demanda']),
		});
		expect(t.time).toHaveLength(5);
		expect(t.aproveitados.map((a) => a.chave)).toEqual(['preco', 'demanda']);
		expect(t.paraRodar.map((a) => a.chave)).toEqual([
			'canais',
			'producao',
			'estrategista',
		]);
	});

	it('o piso conta só quem VAI RODAR — senão o cache derruba o run', () => {
		const time = [
			spec({
				chave: 'radar',
				ordem: 10,
				essencial: true,
				compartilhavel: true,
			}),
			spec({
				chave: 'estrategista',
				ordem: 90,
				fase: 'sintese',
				essencial: true,
			}),
		];
		const t = montarTime(time, {
			modo: 'profundo',
			escopo: 'mercado',
			jaCobertos: new Set(['radar']),
		});
		expect(t.time).toHaveLength(2);
		// O radar está no time (e na tela) mas não trabalha nesta execução:
		// exigir a entrega dele faria um run legítimo falhar por cache quente.
		expect(pisoDeSucesso(t.paraRodar)).toBe(1);
	});

	it('interpolação REMOVE o que não sabe substituir', () => {
		// Mudou de propósito: antes o token ficava literal ("em {uf}"), e num run
		// real de escopo `mercado` isso virou a consulta de busca "…fabricar
		// Brinde corporativo em {material}?" — chave de template crua dentro de
		// uma busca paga. Ver o cabeçalho de `interpolar`.
		expect(
			interpolar('preço de {produto} em {uf}', { produto: 'caneca' }),
		).toBe('preço de caneca');
		expect(interpolar('{a}', { a: { b: 1 } })).toBe('{"b":1}');
	});
});

/* ══════════════════════ orçamento da execução ══════════════════════ */

/**
 * O ROSTER É DADO, mas o dado nasce deste arquivo.
 *
 * Ler o fonte do seed é feio e é de propósito: `scripts/seed-agentes.ts` chama
 * `main()` no topo (importá-lo dispararia rede e `process.exit`), e o que
 * precisa ser guardado aqui é justamente o TEXTO dos papéis — a única coisa
 * deste produto que não tem tipo, não tem teste de tipo e chega inteira à tela
 * do aluno.
 */
const fonteDoSeed = readFileSync(
	new URL('../scripts/seed-agentes.ts', import.meta.url),
	'utf8',
);

describe('a palavra "agente" é banida da tela do aluno', () => {
	it('a proibição está no PROMPT de quem escreve prosa — é lá que ela vazava', () => {
		// Reproduzido pelo verificador numa saída REAL: o dia 2 do `plano_7_dias`
		// do Estrategista dizia "Pedir a faixa de preço de mercado já calculada
		// pelo agente responsável", e essa frase é renderizada na etapa mais
		// acionável do dossiê. O código nunca escreve a palavra; o modelo escreve.
		// O front não pode sanitizar (reescrever prosa corromperia "agente
		// desmoldante"), então o único lugar onde isso se conserta é o papel.
		expect(fonteDoSeed).toMatch(/nunca escreva "agente"/i);
		// E a proibição não atropela o sentido químico, que é produto de bancada
		// e aparece legitimamente num dossiê de laser.
		expect(fonteDoSeed).toMatch(/agente desmoldante/);
	});

	it('e chega a TODOS os que recebem o material do time', () => {
		// QUEM RECEBE `material` MUDOU, e a proibição tem que ir junto: com duas
		// ondas, só a síntese lia o trabalho dos colegas; com três, a onda de
		// APROFUNDAMENTO também recebe o digest da descoberta. Um especialista da
		// onda 2 tem o mesmo motivo de citar quem apurou o quê — e a saída dele
		// vai para a tela do mesmo jeito ("Do que reclamam", "Quem são seus
		// concorrentes"). Deixá-lo de fora reabriria o vazamento exatamente onde
		// o time cresceu.
		//
		// A `fase` é lida do CAMPO, não de "a string aparece no bloco": o
		// comentário que introduz o próximo especialista cai dentro do pedaço
		// deste, e contar por substring dava um sintetizador a mais.
		const especialistas = fonteDoSeed.split(/\n\t\tchave: '/).slice(1);
		expect(especialistas.length).toBeGreaterThanOrEqual(22);
		const recebemMaterial = especialistas.filter((e) => {
			const fase = e.match(/\n\t\tfase: '(\w+)'/)?.[1] ?? 'descoberta';
			return fase === 'sintese' || fase === 'aprofundamento';
		});
		// Nas três ondas, quem lê o time é a 2 e a 3 — nunca menos que a síntese.
		expect(recebemMaterial.length).toBeGreaterThanOrEqual(4);
		for (const e of recebemMaterial) {
			expect(e.slice(0, e.indexOf('pergunta:'))).toContain(
				'COMO_CHAMAR_O_TIME',
			);
		}
	});
});

/**
 * ┌─ NINGUÉM PEDE A FOTO — nem o especialista cujo produto É a foto ─────────┐
 * │ Pedir `imagem_url` no prompt volta 0 de 8 (a medição que abre             │
 * │ `og-image.ts`): a busca entrega o TEXTO da página, e o endereço da        │
 * │ imagem não está no texto. O que vinha era invenção plausível — as quatro  │
 * │ URLs de Mercado Livre de um run apontavam para o mesmo GIF "imagem        │
 * │ indisponível" do próprio ML, as duas da Shopee davam 404.                 │
 * │                                                                          │
 * │ E era pior que inútil: campo preenchido era lido pelo motor como "este    │
 * │ já tem foto", a página não era aberta e a invenção VENCIA a `og:image`    │
 * │ real. Zero fotos de produto em 4 imagens, somados os três runs profundos  │
 * │ de mercado.                                                              │
 * │                                                                          │
 * │ O roster é DADO editável por tela e sem deploy: este teste é o que        │
 * │ impede o campo de voltar num "só pra ajudar o motor" de amanhã. O         │
 * │ mecanismo que não depende de ninguém lembrar é `semFotoDoModelo`.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
describe('a foto não se pede: ela é buscada na página', () => {
	it('NENHUM ESPECIALISTA DECLARA `imagem_url` na saída nem a pede na pergunta', () => {
		const especialistas = fonteDoSeed.split(/\n\t\tchave: '/).slice(1);
		expect(especialistas.length).toBeGreaterThanOrEqual(22);
		for (const bruto of especialistas) {
			const chave = bruto.slice(0, bruto.indexOf("'"));
			// O comentário que explica o campo fica FORA da conta: ele fala de
			// `imagem_url` de propósito, para dizer que quem preenche é o motor.
			const e = bruto.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
			const saida = e.match(/\n\t\tsaida: ([\s\S]*?)\n\t\tmodelo:/)?.[1] ?? '';
			const pergunta =
				e.match(/\n\t\tpergunta:\n?([\s\S]*?)\n\t\t(?:saida|modelo):/)?.[1] ??
				'';
			expect(saida, `saida de ${chave}`).not.toContain('imagem_url');
			expect(pergunta, `pergunta de ${chave}`).not.toMatch(
				/imagem_url|URL da (FOTO|imagem)|endereço da (foto|imagem)/i,
			);
		}
	});

	it('e o Curador de Imagens continua sendo pago para achar a PÁGINA', () => {
		// A regra acima não pode ter matado a galeria junto: ele é o único
		// especialista cujo produto é a imagem, e o que ele faz bem — achar
		// anúncio individual, com variedade — continua sendo o gargalo dela.
		const dele = fonteDoSeed
			.split(/\n\t\tchave: '/)
			.find((e) => e.startsWith('referencias_visuais'));
		expect(dele).toBeTruthy();
		expect(dele).toMatch(/ANÚNCIO INDIVIDUAL/);
		expect(dele).toMatch(/buscada na própria página/i);
		// E a página continua no contrato de saída, que é o que o motor abre.
		expect(dele).toContain('"url":""');
	});

	it('E A GALERIA CAÇA A LOJA, não os quatro canais que não entregam foto', () => {
		// MEDIDO abrindo as páginas: as 31 fotos de produto dos runs gravados
		// vieram de loja `.com.br` (`nakalubrindes`, `lojapersonaliza`, `amouh`,
		// `suaartepersonalizada`, `iniciativabrindes`, `personizi`,
		// `inovapersonalizados`). ZERO vieram dos quatro marketplaces, e não por
		// acaso: `produto.mercadolivre.com.br/MLB-…` devolve 302 para
		// `/gz/account-verification`, e a página da Shopee chega com 177 KB de
		// HTML e nenhuma metatag `og:`. Restringir o especialista da galeria aos
		// quatro é prendê-lo justamente onde nenhuma foto pode sair.
		const dele = fonteDoSeed
			.split(/\n\t\tchave: '/)
			.find((e) => e.startsWith('referencias_visuais')) as string;
		const semComentario = dele.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
		// VAZIO EXPLÍCITO, e não a chave ausente: o seed atualiza com PATCH, e
		// tirar a chave do objeto deixaria no banco a lista da rodada passada.
		expect(semComentario).toMatch(/dominios_incluir: ''/);
		expect(semComentario).not.toMatch(/dominios_incluir: MARKETPLACES/);
		// E a pergunta parou de nomear os quatro como o lugar onde procurar —
		// tirar a lista e manter a pergunta seria medir a lista contra ela mesma.
		const pergunta =
			semComentario.match(
				/\n\t\tpergunta:\n?([\s\S]*?)\n\t\t(?:saida|modelo):/,
			)?.[1] ?? '';
		expect(pergunta).toBeTruthy();
		expect(pergunta).not.toMatch(/Mercado Livre, Shopee, Amazon/i);
		expect(pergunta).toMatch(/loja/i);
	});

	it('E NINGUÉM ESCREVE ENDEREÇO QUE NÃO ABRIU — a regra vale para os 25', () => {
		// `ANTI_INVENCAO` falava só de NÚMERO, e o endereço é o campo mais fácil
		// de completar por padrão que existe: pedir "o link do anúncio" a quem só
		// alcançou a listagem produz `…-i.34567890.1234567890` e `MLB-1234567890`,
		// id em sequência, forma impecável, 404 garantido. Medido no último run
		// frio de mercado: 109 citações reais na mão, 6 páginas escritas, 1 real.
		expect(fonteDoSeed).toMatch(
			/NUNCA monte um endereço a partir de um código/,
		);
		expect(fonteDoSeed).toMatch(/DEIXAR O CAMPO VAZIO É A RESPOSTA CERTA/);
		// A regra vai por DENTRO do preâmbulo, e não especialista a especialista:
		// enumerar quem a recebe é combinar de esquecer o próximo.
		const preambulo = fonteDoSeed.match(
			/const ANTI_INVENCAO = \[([\s\S]*?)\]\.join/,
		)?.[1];
		expect(preambulo).toContain('LINK_SO_DE_PAGINA_ABERTA');
		// E ela chega a todo especialista que pesquisa.
		const especialistas = fonteDoSeed.split(/\n\t\tchave: '/).slice(1);
		const pesquisadores = especialistas.filter(
			(e) => !/motor_busca: 'nenhum'/.test(e),
		);
		expect(pesquisadores.length).toBeGreaterThanOrEqual(15);
		for (const e of pesquisadores) {
			const chave = e.slice(0, e.indexOf("'"));
			expect(e.slice(0, e.indexOf('pergunta:')), `papel de ${chave}`).toContain(
				'ANTI_INVENCAO',
			);
		}
	});
});

describe('o teto de saída de cada especialista', () => {
	/** Cada bloco de especialista do roster, do `chave:` até o próximo. */
	const especialistas = fonteDoSeed.split(/\n\t\tchave: '/).slice(1);
	const campo = (bloco: string, nome: string) =>
		bloco.match(new RegExp(`\\n\\t\\t${nome}: '?([\\w.]+)'?`))?.[1];

	/**
	 * QUEM LÊ O TIME ESCREVE MAIS, e herdar o padrão de 1.200 já derrubou dois.
	 *
	 * Medido: `producao` (onda 2) e `tendencias` falharam com "a resposta não
	 * veio em JSON válido" caindo no `PADRAO.maxTokens`, e `riscos` mudou para a
	 * síntese — onde passou a ler o digest de 17 especialistas — sem que ninguém
	 * revisse o teto dele. O padrão de 1.200 foi dimensionado para pesquisador de
	 * onda 1, que devolve uma lista curta do que achou.
	 *
	 * E tem um segundo efeito, que é o que faz disto uma regra e não um ajuste:
	 * herdando, qualquer mexida em `PADRAO.maxTokens` move esses especialistas em
	 * silêncio.
	 */
	it('NINGUÉM HERDA O TETO PADRÃO — os 25 declaram o próprio', () => {
		expect(especialistas.length).toBeGreaterThanOrEqual(25);
		const semTeto = especialistas
			.filter((e) => !/max_tokens: \d+/.test(e))
			.map((e) => e.slice(0, e.indexOf("'")));
		expect(semTeto).toEqual([]);
	});

	it('e o Pesquisador de Tendências também — ele falhava nas DUAS tentativas', () => {
		// Run frio de produto+profundo: única falha do run, "a resposta não veio
		// em JSON válido (2820 caracteres, teto 1200 tokens)", e o retry em outro
		// modelo não salvou. O box "O que está em alta" sumia do dossiê pago.
		const t = especialistas.find((e) => e.startsWith("tendencias'"));
		expect(t).toBeTruthy();
		expect(Number(t?.match(/max_tokens: (\d+)/)?.[1] ?? 0)).toBeGreaterThan(
			1_200,
		);
	});

	/**
	 * ┌─ DECLARAR O TETO NÃO É DIMENSIONAR O TETO ───────────────────────────┐
	 * │ A rodada passada fechou o teste de cima (os 25 declaram o próprio) e   │
	 * │ mesmo assim DOIS profissionais pagos morreram por JSON cortado em 2 de │
	 * │ 3 runs frios de `produto+profundo`:                                    │
	 * │                                                                        │
	 * │   `publico`  (teto 1.800): as DUAS tentativas devolveram "a resposta   │
	 * │               não veio em JSON válido (3.540 caracteres, teto 1.800    │
	 * │               tokens)" — "Para quem vender" saiu sem um perfil.        │
	 * │   `producao` (teto 1.400): a segunda chamada fechou com                │
	 * │               `finish_reason: "length"` e `completion_tokens: 1400`    │
	 * │               EXATOS, com 4.208 caracteres de JSON cortado — o bloco   │
	 * │               "Como fazer" não foi montado.                            │
	 * │                                                                        │
	 * │ O que faltava era o CRITÉRIO, e agora ele é dado (`PICOS_MEDIDOS`) com │
	 * │ um portão que quebra o seed (`conferirTetos`). Este teste é o mesmo    │
	 * │ portão rodando sem rede: um teto abaixo de 2 × o pico medido derruba a │
	 * │ suíte antes de derrubar um dossiê pago.                                │
	 * └────────────────────────────────────────────────────────────────────────┘
	 */
	it('TODO TETO É ≥ 2× O MAIOR VALOR MEDIDO daquele especialista', () => {
		const tabela = fonteDoSeed.slice(
			fonteDoSeed.indexOf('const PICOS_MEDIDOS'),
			fonteDoSeed.indexOf('const TIME: Especialista[]'),
		);
		const picos = new Map(
			[...tabela.matchAll(/\n\t(\w+): (\d+),/g)].map(([, k, v]) => [
				k as string,
				Number(v),
			]),
		);
		// A tabela não pode esvaziar em silêncio: sem picos, o teste passaria
		// provando nada — que é o defeito do `slice(start, -1)` documentado abaixo.
		expect(picos.size).toBeGreaterThanOrEqual(25);

		// O teto de código vem do MOTOR, não de uma cópia: se ele mudar, esta
		// conta muda junto — que é a metade da regra que a rodada passada perdeu.
		const teto = MAX_TOKENS_TETO;
		const curtos: string[] = [];
		for (const e of especialistas) {
			const chave = e.slice(0, e.indexOf("'"));
			const pico = picos.get(chave);
			if (!pico) continue;
			const declarado = Number(e.match(/max_tokens: (\d+)/)?.[1] ?? 0);
			const exigido = Math.min(teto, Math.ceil((2 * pico) / 200) * 200);
			if (declarado < exigido) {
				curtos.push(`${chave}: ${declarado} < ${exigido} (2 × ${pico})`);
			}
			expect(declarado, chave).toBeLessThanOrEqual(teto);
		}
		expect(curtos).toEqual([]);
	});

	/** Os dois que a medição pegou: o teto tem que ter subido de verdade. */
	it('`publico` e `producao` saíram dos tetos em que morreram', () => {
		const teto = (chave: string) =>
			Number(
				especialistas
					.find((e) => e.startsWith(`${chave}'`))
					?.match(/max_tokens: (\d+)/)?.[1] ?? 0,
			);
		expect(teto('publico')).toBeGreaterThan(1_800);
		expect(teto('producao')).toBeGreaterThan(1_400);
	});

	/**
	 * O ESTRATEGISTA PRECISA DE MAIS QUE 4.000 — e isso é medição, não gosto.
	 *
	 * Com o teto em 4.000 ele fechava a resposta em 4.000 tokens EXATOS, com o
	 * JSON cortado, em `mercado+profundo`: como é `essencial`, o run devolvia
	 * 502 e o controller estornava depois de os US$ 0,34 terem saído. Com o teto
	 * aberto ele escreveu 5.708.
	 */
	it('o Estrategista declara um teto acima dos 4.000 em que ele batia', () => {
		const e = especialistas.find((x) => x.startsWith("estrategista'"));
		const teto = Number(e?.match(/max_tokens: (\d+)/)?.[1] ?? 0);
		expect(teto).toBeGreaterThan(4_000);
		// O teto de cima é o do CÓDIGO (`MAX_TOKENS_TETO`), não um número solto:
		// acima dele `toAgentSpec` corta em silêncio e o registro do banco passa a
		// mentir sobre o que vai acontecer. Ele subiu para 9.000 quando o deadline
		// do Rápido virou 120 s — (120.000 − 3.000 de abertura) / 12,8 ms por
		// token medido = 9.140. Quem mexer num, mexe nos dois.
		expect(teto).toBeLessThanOrEqual(MAX_TOKENS_TETO);
	});

	/**
	 * A PERGUNTA É A CONSULTA — e sem `{produto}` ela é uma consulta sem assunto.
	 *
	 * Para quem pesquisa, o material do time vai no `system` e a mensagem de
	 * USUÁRIO é a pergunta sozinha; o plugin de busca do OpenRouter formula a
	 * consulta a partir dela. O `custo_dos_produtos` perguntava "Para CADA
	 * produto listado no MATERIAL DO TIME abaixo, quanto custa a peça em
	 * branco?" — sem ramo, sem produto, sem material — e voltava com página
	 * genérica: 1 url e ZERO custos conferidos em 2 de 2 runs, enquanto o
	 * Analista de Margem, com metade das buscas, fazia 2/2. Com `{produto}` na
	 * pergunta ele passou a trazer 10 fontes e 5 insumos com página conferida.
	 */
	it('TODO ESPECIALISTA QUE PESQUISA cita {produto} na pergunta', () => {
		const pesquisadores = especialistas.filter(
			(e) => campo(e, 'motor_busca') !== 'nenhum',
		);
		expect(pesquisadores.length).toBeGreaterThanOrEqual(16);
		for (const e of pesquisadores) {
			const pergunta = e.slice(e.indexOf('pergunta:'), e.indexOf('saida:'));
			expect(pergunta).toContain('{produto}');
		}
	});

	/**
	 * `come_pct` NÃO ENTRA NO CONTRATO — decisão registrada, não esquecimento.
	 *
	 * `lerFrete` (dossie.tsx) lê esse campo e a intro do box promete a
	 * porcentagem que o frete come; nenhum `saida` a produz, e nos runs frios
	 * nenhuma apareceu. Ela é uma DIVISÃO (frete ÷ preço de venda) e número
	 * dividido por modelo é o que a regra nº 3 proíbe — e em TypeScript o
	 * denominador teria que ser o preço DAQUELE produto com página, que o
	 * especialista de frete não traz. Este teste existe para que a "correção"
	 * óbvia (pedir o campo ao modelo) não seja feita por engano.
	 */
	it('e ninguém promete a porcentagem que o frete come', () => {
		// A busca é nos CONTRATOS (`saida`), não no arquivo: o comentário do
		// `frete_logistica` cita o campo de propósito, para explicar a decisão a
		// quem for mexer.
		const contratos = especialistas
			.map((e) => e.slice(e.indexOf('saida:'), e.indexOf('modelo:')))
			.join('\n');
		expect(contratos.length).toBeGreaterThan(1_000);
		expect(contratos).not.toContain('come_pct');
	});
});

describe('o mapa "quem alimenta o quê" do seed', () => {
	/**
	 * É COMENTÁRIO, e por isso mesmo: este bloco é o que o projeto manda ler
	 * antes de mexer em `modo`/`escopo`, e a rodada passada o deixou descrevendo
	 * um front que não existia mais (constante renomeada, especialista morto,
	 * duas seções dadas como "sem ponto de render" quando as duas tinham).
	 * Mapa errado é pior que mapa nenhum: quem segue a regra escrita nele
	 * "conserta" o que não está quebrado.
	 */
	/**
	 * O mapa vai do título até o FIM do comentário de cabeçalho.
	 *
	 * O marcador de fim era o título de uma seção específica ("AS DUAS DECISÕES
	 * DE REMANEJAMENTO"), e quando ela virou "OS QUATRO REMANEJAMENTOS" o
	 * `indexOf` devolveu −1: `slice(start, -1)` passou a pegar o ARQUIVO INTEIRO,
	 * e um `toContain(chave)` sobre o arquivo inteiro é sempre verdadeiro — o
	 * teste continuava verde provando nada. O fecho do comentário de cabeçalho
	 * não depende de ninguém manter um título.
	 */
	const cabecalho = fonteDoSeed.slice(
		fonteDoSeed.indexOf('QUEM ALIMENTA O QUÊ'),
		fonteDoSeed.indexOf('\n */'),
	);

	it('não manda ninguém procurar constante nem especialista que não existe', () => {
		expect(cabecalho.length).toBeGreaterThan(500);
		expect(cabecalho.length).toBeLessThan(fonteDoSeed.length / 2);
		// `BLOCOS_PROFUNDOS` virou `BLOCOS_DO_TIME` no front, e o gate dele
		// deixou de ser o modo.
		expect(fonteDoSeed).not.toContain('BLOCOS_PROFUNDOS');
		// As CHAVES mortas (viraram `marketplaces` e `radar_oportunidades`) não
		// podem voltar a aparecer como DONAS de seção. A palavra solta continua
		// livre na prosa: "Comparação dos canais" é uma frase legítima do cartão
		// do modo, e o componente do front chama-se `RamoECanais`.
		expect(cabecalho).not.toMatch(/\bcanais\s*→/);
		expect(cabecalho).not.toMatch(/\bnichos\s*→/);
		expect(fonteDoSeed).not.toMatch(/chave: '(canais|nichos)'/);
	});

	it('e todo especialista do roster tem uma linha nele', () => {
		// A falha das duas últimas rodadas foi sempre a mesma: um especialista
		// entrava numa combinação e ninguém sabia dizer onde ele aparecia.
		const chaves = [...fonteDoSeed.matchAll(/\n\t\tchave: '([a-z_]+)'/g)].map(
			(m) => m[1] ?? '',
		);
		// 22 é a promessa do Profundo, nos DOIS escopos: o roster inteiro é maior
		// que isso (tem exclusivos de cada escopo), nunca menor.
		expect(chaves.length).toBeGreaterThanOrEqual(22);
		for (const chave of chaves) expect(cabecalho).toContain(chave);
	});
});

describe('tetos de gasto', () => {
	it('o rápido é mais apertado que o profundo em tudo', () => {
		const r = LIMITES_PADRAO.rapido;
		const p = LIMITES_PADRAO.profundo;
		expect(r.maxBuscas).toBeLessThan(p.maxBuscas);
		expect(r.maxUsd).toBeLessThan(p.maxUsd);
		expect(r.deadlineMs).toBeLessThan(p.deadlineMs);
	});

	/**
	 * ┌─ O TETO É FREIO, E O PISO DE MARGEM É CONFERIDO NO CUSTO MEDIDO ───────┐
	 * │ Este teste afirmava `margem(maxUsd) ≥ 75%` e foi ELE que colocou o teto │
	 * │ abaixo do custo real: `maxUsd` do profundo ficou em 0,32 (o valor que   │
	 * │ dá exatamente 75% a 6 voxxys) enquanto o PICO DE COMPROMETIMENTO medido │
	 * │ do roster é US$ 0,335 — e o freio passou a fechar em toda execução      │
	 * │ normal, gravando um estouro que não existia.                            │
	 * │                                                                         │
	 * │ São duas grandezas diferentes: `podeGastar` compara o gasto real das    │
	 * │ ondas fechadas MAIS a projeção de PIOR CASO do que está em voo (todo    │
	 * │ mundo escrevendo até o último token do teto), e o custo do run é bem    │
	 * │ menor que isso. Amarrar o freio ao piso de margem é comparar a projeção │
	 * │ de pior caso com o preço, o que não fecha nunca.                        │
	 * │                                                                         │
	 * │ O piso de 75% continua valendo — no CUSTO MEDIDO, que é onde ele é      │
	 * │ verificável: 85,4% (produto+rápido), 81,3% (mercado+rápido), 80,2%      │
	 * │ (produto+profundo) e 78,8% (mercado+profundo) em runs frios com o       │
	 * │ roster de hoje. Ver o cabeçalho de budget.ts.                            │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 */
	it('o teto de gasto é FREIO, não previsão — e não pode virar teto de graça', () => {
		const margem = (usd: number, voxxys: number) =>
			1 - (usd * 5.5) / (voxxys * 1.2);
		/**
		 * O piso do FREIO: mesmo quando ele fecha — e ele só fecha na onda de
		 * síntese, onde todos são isentos —, o run continua sendo negócio. 60% é
		 * o limite abaixo do qual o teto deixaria de ser freio e viraria
		 * autorização para prejuízo.
		 */
		expect(margem(LIMITES_PADRAO.rapido.maxUsd, 2)).toBeGreaterThanOrEqual(0.6);
		expect(margem(LIMITES_PADRAO.profundo.maxUsd, 6)).toBeGreaterThanOrEqual(
			0.6,
		);
		/**
		 * E o TETO do freio: ele não pode ser afrouxado até parar de reclamar. O
		 * pico medido é 0,122 (rápido) e 0,335 (profundo); 1,3× disso é a folga
		 * máxima antes de o número virar "põe alto que resolve". Quem
		 * acrescentar especialista tem que medir de novo.
		 */
		expect(LIMITES_PADRAO.rapido.maxUsd).toBeLessThanOrEqual(0.122 * 1.3);
		expect(LIMITES_PADRAO.profundo.maxUsd).toBeLessThanOrEqual(0.335 * 1.3);
	});

	it('o relógio do rápido cabe o PIOR CASO MEDIDO, não o típico', () => {
		// 65 s não cabiam e o Estrategista era abortado: falha por timeout não é
		// retriável, ele é essencial, o run devolvia 502 e o controller estornava.
		// A conta é a mesma de sempre, com o número novo: onda de pesquisa até
		// 12 s + Estrategista até 99 s (8.000 tokens de teto ao ritmo medido de
		// 12,6 ms por token) = 111 s.
		expect(LIMITES_PADRAO.rapido.deadlineMs).toBeGreaterThanOrEqual(111_000);
		/**
		 * E CONTINUA SENDO O "~2min" QUE O ALUNO LÊ.
		 *
		 * O cartão do modo arredonda para cima por minuto
		 * (`Math.ceil(segundos/60)` em tool-intel-view.tsx), então qualquer
		 * deadline entre 61 e 120 s é o MESMO "~2min" na tela. Acima de 120 s a
		 * promessa vira "~3min" e o modo que o dono do produto aprovou passa a
		 * ser outro — este é o limite real, e não um número redondo.
		 */
		expect(LIMITES_PADRAO.rapido.deadlineMs).toBeLessThanOrEqual(120_000);
		expect(Math.ceil(LIMITES_PADRAO.rapido.deadlineMs / 1000 / 60)).toBe(2);
	});

	it('O RELÓGIO DO PROFUNDO CABE TRÊS ONDAS, e a soma é soma', () => {
		// As ondas são BARREIRAS: o tempo do run é a soma dos três máximos, nunca
		// o máximo dos três. onda 1 (25 s) + onda 2 (30 s) + síntese (60 s) +
		// fotos (36 s) = 151 s. O "pode demorar mais tempo, não tem importância"
		// do dono do produto é o que paga a folga — e a folga é o que impede a
		// isenção do protegido de precisar entrar em campo 22 vezes.
		expect(LIMITES_PADRAO.profundo.deadlineMs).toBeGreaterThanOrEqual(151_000);
		expect(LIMITES_PADRAO.profundo.deadlineMs).toBeLessThanOrEqual(300_000);
	});

	it('o teto de busca cabe as CHAMADAS do roster, com folga para o retry', () => {
		// A unidade é CHAMADA (o provedor cobra por requisição, não por resultado
		// pedido). O roster de hoje faz no máximo 4 chamadas com busca no rápido
		// (preço, demanda, concorrência, margem) e 17 no profundo (9 na descoberta
		// + 8 no aprofundamento). Um teto abaixo disso silencia especialista — foi
		// o que aconteceu com o Analista de Margem, em 100% dos runs de
		// mercado+rápido.
		expect(LIMITES_PADRAO.rapido.maxBuscas).toBeGreaterThan(4);
		expect(LIMITES_PADRAO.profundo.maxBuscas).toBeGreaterThanOrEqual(17 + 3);
	});

	it('a projeção de custo é a do PIOR CASO e sai do catálogo, não de chute', () => {
		// Sonnet 5: US$ 2/M na entrada, US$ 10/M na saída. 4.000 caracteres de
		// prompt = 1.000 tokens; teto de saída 4.000 tokens; sem busca.
		expect(
			estimarCustoUsd({
				precoIn: 2,
				precoOut: 10,
				charsPrompt: 4_000,
				maxTokensSaida: 4_000,
				comBusca: false,
			}),
		).toBeCloseTo(0.042, 6);
		// Com busca entram os ~7 mil tokens de resultado colados no contexto MAIS
		// os US$ 0,005 da chamada — é por isso que "rodar sem busca" economiza de
		// verdade, e não só os meio centavo.
		expect(
			estimarCustoUsd({
				precoIn: 2,
				precoOut: 10,
				charsPrompt: 4_000,
				maxTokensSaida: 4_000,
				comBusca: true,
			}),
		).toBeCloseTo(0.061, 6);
	});

	it('O FREIO DE CUSTO FECHA COM A ONDA INTEIRA NO MESMO TICK', () => {
		// O defeito: `podeGastar()` olhava só o gasto JÁ REGISTRADO, e como os seis
		// pesquisadores são despachados no mesmo tick, todos perguntavam com
		// `usd = 0` e todos passavam. Em NENHUM run possível o freio fechava.
		const b = new Budget(
			{ maxBuscas: 9, maxUsd: 0.05, deadlineMs: 60_000 },
			Date.now(),
		);
		const previsto = estimarCustoUsd({
			precoIn: 2,
			precoOut: 10,
			charsPrompt: 4_000,
			maxTokensSaida: 4_000,
			comBusca: false,
		});
		expect(b.podeGastar(previsto)).toBe(true);
		b.reservarUsd(previsto);
		// Segundo agente do MESMO tick: nada foi registrado ainda e mesmo assim
		// não cabe — é isso que faz o teto valer.
		expect(b.podeGastar(previsto)).toBe(false);
		// E sem projeção a pergunta continua sendo a antiga ("já estourou?").
		expect(b.podeGastar()).toBe(true);
		b.liberarUsd(previsto);
		expect(b.podeGastar(previsto)).toBe(true);
	});

	it('`cabeNoTempo` responde pelo relógio, não pelo otimismo', () => {
		const b = new Budget(
			{ maxBuscas: 9, maxUsd: 1, deadlineMs: 60_000 },
			Date.now(),
		);
		expect(b.cabeNoTempo(120, 4_000)).toBe(true);
		// Relógio estourado: nem o especialista mais rápido do time vale a chamada.
		const acabou = new Budget(
			{ maxBuscas: 9, maxUsd: 1, deadlineMs: 1_000 },
			Date.now() - 10_000,
		);
		expect(acabou.msRestantes()).toBe(0);
		expect(acabou.cabeNoTempo(120, 4_000)).toBe(false);
		expect(acabou.cabeNoTempo(10, 1_200)).toBe(false);
	});

	it('O PISO DE TEMPO É DE QUEM VAI RODAR, não do agente mais curto do time', () => {
		// O defeito: o piso era um número fixo de 15 s, calibrado pelo JSON mais
		// curto (Haiku, 1.800 tokens) e aplicado ao mais longo. Com 20 s de
		// relógio o Estrategista (Sonnet, 4.000 tokens, 34–55 s medidos) era
		// DESPACHADO, tinha o timeout cortado para 20 s, morria por timeout — que
		// não é retriável — e, sendo essencial, derrubava o run já pago.
		const b = new Budget(
			{ maxBuscas: 9, maxUsd: 1, deadlineMs: 20_000 },
			Date.now(),
		);
		// Estrategista: 3 s de abertura + 4.000 × 8 ms = 35 s. Não cabe em 20 s.
		expect(b.cabeNoTempo(120, 4_000)).toBe(false);
		// O Curador (Haiku, 2.000 tokens) precisa de 19 s e continua passando —
		// a régua nova reproduz o piso antigo onde ele estava certo.
		expect(b.cabeNoTempo(90, 2_000)).toBe(true);
		expect(msMinimoUtil(1_800)).toBeLessThanOrEqual(18_000);
		expect(msMinimoUtil(4_000)).toBeGreaterThan(30_000);
		// Quem tem timeout curto não passa a exigir mais relógio do que consegue
		// usar: 30 s de timeout, 30 s de piso, não 35.
		const c = new Budget(
			{ maxBuscas: 9, maxUsd: 1, deadlineMs: 32_000 },
			Date.now(),
		);
		expect(c.cabeNoTempo(30, 4_000)).toBe(true);
	});

	it('a vaga de busca é tomada na AUTORIZAÇÃO, não na cobrança', () => {
		// Com 6 agentes em paralelo, todos perguntam "cabe mais uma?" antes de
		// qualquer um registrar o gasto. Sem reserva, todos passavam e o teto
		// de 14 virava 19.
		const b = new Budget(
			{ maxBuscas: 2, maxUsd: 1, deadlineMs: 60_000 },
			Date.now(),
		);
		b.reservar(1);
		b.reservar(1);
		expect(b.podeBuscar()).toBe(false);
		// Agente que falhou antes de buscar devolve a vaga; senão o teto encolhe
		// sozinho e os últimos do time rodam sem busca por um gasto que não houve.
		b.liberar(1);
		expect(b.podeBuscar()).toBe(true);
		b.registrar(2, 0.01);
		b.liberar(1);
		expect(b.podeBuscar()).toBe(false);
	});

	it('para de autorizar busca ao bater o teto', () => {
		const b = new Budget(
			{ maxBuscas: 2, maxUsd: 1, deadlineMs: 60_000 },
			Date.now(),
		);
		expect(b.podeBuscar()).toBe(true);
		b.registrar(2, 0.01);
		expect(b.podeBuscar()).toBe(false);
		expect(b.podeGastar()).toBe(true);
	});

	it('para de autorizar gasto ao estourar o dólar', () => {
		const b = new Budget(
			{ maxBuscas: 99, maxUsd: 0.05, deadlineMs: 60_000 },
			Date.now(),
		);
		b.registrar(1, 0.06);
		expect(b.podeGastar()).toBe(false);
	});

	it('avisos não repetem — a tela mostra a lista inteira', () => {
		const b = new Budget(LIMITES_PADRAO.rapido, Date.now());
		b.avisar('x');
		b.avisar('x');
		b.avisar('y');
		expect(b.avisos).toEqual(['x', 'y']);
		expect(b.resumo()).toBe('x y');
	});

	it('sem aviso, sem resumo', () => {
		expect(new Budget(LIMITES_PADRAO.rapido, Date.now()).resumo()).toBeNull();
	});
});

describe('concorrência', () => {
	it('nunca passa do limite e preserva a ordem do resultado', async () => {
		let ativos = 0;
		let pico = 0;
		const tarefas = Array.from({ length: 10 }, (_, i) => async () => {
			ativos++;
			pico = Math.max(pico, ativos);
			await new Promise((r) => setTimeout(r, 5));
			ativos--;
			return i;
		});
		const r = await comLimite(tarefas, 3);
		expect(pico).toBeLessThanOrEqual(3);
		expect(r.map((x) => (x.status === 'fulfilled' ? x.value : -1))).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
		]);
	});

	it('UM AGENTE QUE FALHA NÃO DERRUBA O TIME', async () => {
		// É a diferença central em relação ao `Promise.all` do `ai.generate_image`:
		// lá, 4 variações da mesma imagem; aqui, 7 agentes heterogêneos, e o de
		// sazonalidade morrer não pode apagar o dossiê inteiro.
		const r = await comLimite(
			[
				async () => 'ok',
				async () => {
					throw new Error('caiu');
				},
				async () => 'ok2',
			],
			2,
		);
		expect(r.map((x) => x.status)).toEqual([
			'fulfilled',
			'rejected',
			'fulfilled',
		]);
	});

	it('lista vazia não trava', async () => {
		expect(await comLimite([], 4)).toEqual([]);
	});
});

/* ══════════════ "Comece por estes produtos" ══════════════ */

function prod(over: Partial<ProdutoOportunidade> = {}): ProdutoOportunidade {
	return {
		nome: 'P',
		por_que_agora: '',
		publico: '',
		preco_venda_brl: { min: null, max: null },
		custo_estimado_brl: null,
		custo_fonte_url: '',
		margem_pct: null,
		margem_faixa: 'nao_apurado',
		margem_declarada: 'nao_apurado',
		concorrencia: 'nao_apurado',
		por_que_pouca_concorrencia: '',
		esforco: 'nao_apurado',
		material: '',
		onde_vender: '',
		primeiro_passo: '',
		url_exemplo: '',
		imagem_url: '',
		...over,
	};
}

describe('a margem do produto sai de código — o modelo só dá classe', () => {
	it('usa o MENOR preço da faixa: a margem prometida é a do pior caso', () => {
		expect(calcularMargem(80, 120, 20)).toEqual({ pct: 75, faixa: 'alta' });
		// Sem o mínimo, vale o máximo — é o único preço que existe.
		expect(calcularMargem(null, 100, 50).pct).toBe(50);
	});

	it('sem preço ou sem custo a margem é null, nunca "estimada"', () => {
		expect(calcularMargem(null, null, 20).pct).toBeNull();
		expect(calcularMargem(80, null, null)).toEqual({
			pct: null,
			faixa: 'nao_apurado',
		});
		// Custo zero é campo em branco disfarçado de número: aceitá-lo devolveria
		// "margem de 100%" no lugar de "não apurado".
		expect(calcularMargem(80, 100, 0).pct).toBeNull();
	});

	it('margem negativa é informação, não erro', () => {
		expect(calcularMargem(50, null, 70)).toEqual({ pct: -40, faixa: 'baixa' });
	});

	it('as fronteiras das faixas', () => {
		expect(calcularMargem(100, null, 40).faixa).toBe('alta'); // 60%
		expect(calcularMargem(100, null, 41).faixa).toBe('media'); // 59%
		expect(calcularMargem(100, null, 65).faixa).toBe('media'); // 35%
		expect(calcularMargem(100, null, 66).faixa).toBe('baixa'); // 34%
	});
});

describe('a ordem da lista é decisão de código, não do modelo', () => {
	it('quem tem número BOM vem na frente de quem só tem adjetivo', () => {
		const lista = ordenarProdutos([
			prod({
				nome: 'So adjetivo',
				margem_declarada: 'alta',
				concorrencia: 'baixa',
			}),
			prod({
				nome: 'Com numero',
				margem_pct: 40,
				margem_faixa: 'media',
				concorrencia: 'media',
			}),
		]);
		expect(lista.map((p) => p.nome)).toEqual(['Com numero', 'So adjetivo']);
	});

	it('MARGEM APURADA RUIM NÃO GANHA A FILA SÓ POR TER PASSADO PELA DIVISÃO', () => {
		// Caso real do relatório, com os números do Curador: a lista abria com um
		// copo de 5,7% em mercado lotado e uma luminária de −80% (prejuízo!) na
		// frente de dois produtos classificados como margem alta e pouca briga —
		// embaixo do subtítulo "o primeiro é a melhor combinação dos dois".
		const lista = ordenarProdutos([
			prod({
				nome: 'Copo long drink',
				margem_pct: 5.7,
				margem_faixa: 'baixa',
				concorrencia: 'alta',
			}),
			prod({
				nome: 'Luminaria MDF',
				margem_pct: -80,
				margem_faixa: 'baixa',
				concorrencia: 'alta',
			}),
			prod({
				nome: 'Chaveiro acrilico',
				margem_declarada: 'alta',
				concorrencia: 'baixa',
			}),
			prod({
				nome: 'Trofeu personalizado',
				margem_declarada: 'alta',
				concorrencia: 'baixa',
				esforco: 'facil',
			}),
		]);
		expect(lista.map((p) => p.nome)).toEqual([
			'Trofeu personalizado',
			'Chaveiro acrilico',
			'Copo long drink',
			'Luminaria MDF',
		]);
	});

	it('margem gorda em mercado lotado perde para margem menor sem disputa', () => {
		// 70% × alta(0,4) = 28 contra 45% × baixa(1) = 45. Margem grande onde todo
		// mundo já vende não é oportunidade: é briga de preço.
		const lista = ordenarProdutos([
			prod({ nome: 'Lotado', margem_pct: 70, concorrencia: 'alta' }),
			prod({ nome: 'Livre', margem_pct: 45, concorrencia: 'baixa' }),
		]);
		expect(lista[0]?.nome).toBe('Livre');
	});

	it('empate desfeito pelo esforço, e depois pelo nome (ordem estável)', () => {
		const lista = ordenarProdutos([
			prod({
				nome: 'B',
				margem_pct: 50,
				concorrencia: 'baixa',
				esforco: 'facil',
			}),
			prod({
				nome: 'A',
				margem_pct: 50,
				concorrencia: 'baixa',
				esforco: 'dificil',
			}),
		]);
		expect(lista.map((p) => p.nome)).toEqual(['B', 'A']);
	});
});

describe('o JSON do Curador chega torto e não pode derrubar a tela', () => {
	it('aceita os formatos ruins que o modelo manda de verdade', () => {
		const lista = normalizarProdutos(
			{
				produtos: [
					null,
					'nenhum produto relevante',
					{
						nome: 'Copo térmico personalizado',
						preco_venda_brl: { min: 'R$ 89,90', max: 'R$ 129,90' },
						custo_estimado_brl: 'R$ 32,00',
						margem_faixa: 'alta',
						concorrencia: 'MÉDIA',
						esforco: 'Fácil',
						onde_vender: ['Shopee', null, 'Mercado Livre'],
						url_exemplo: 'javascript:alert(1)',
						imagem_url: 'https://cdn.exemplo/x.jpg',
					},
					{ nome: '' },
					// Repetido: a mesma lista com o produto duas vezes é uma lista menor.
					{ nome: 'copo TÉRMICO personalizado', preco_venda_brl: 10 },
				],
			},
			// O custo que o Analista de Margem trouxe COM página: é ele que
			// autoriza os R$ 32,00 copiados pelo Curador a virarem margem. O
			// `item` é o insumo daquela página — o copo do próprio produto.
			{
				custoComFonte: {
					item: 'Copo térmico inox 500ml',
					brl: 32,
					url: 'https://loja.com/copo-termico',
				},
			},
		);
		expect(lista).toHaveLength(1);
		const p = lista[0] as ProdutoOportunidade;
		expect(p.preco_venda_brl).toEqual({ min: 89.9, max: 129.9 });
		expect(p.custo_estimado_brl).toBe(32);
		expect(p.custo_fonte_url).toBe('https://loja.com/copo-termico');
		expect(p.margem_pct).toBe(64.4);
		expect(p.concorrencia).toBe('media');
		expect(p.esforco).toBe('facil');
		expect(p.onde_vender).toBe('Shopee; Mercado Livre');
		// `javascript:` não vira link clicável na tela do aluno.
		expect(p.url_exemplo).toBe('');
		// A FOTO DO MODELO NUNCA VALE: o Curador roda sem busca, não abriu página
		// nenhuma, e a imagem inventada bloqueava a busca da og:image de verdade.
		expect(p.imagem_url).toBe('');
	});

	it('a conta ganha da classificação do modelo', () => {
		const [p] = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Placa de PIX',
						material: 'Acrílico 3mm',
						preco_venda_brl: { min: 25, max: 40 },
						custo_estimado_brl: 20,
						margem_faixa: 'alta',
					},
				],
			},
			{
				custoComFonte: {
					item: 'Acrílico cristal 3mm cortado 20×30',
					brl: 20,
					url: 'https://loja.com/acrilico',
				},
			},
		);
		expect(p?.margem_pct).toBe(20);
		expect(p?.margem_faixa).toBe('baixa');
		// A opinião do time não some — só para de se passar por apuração.
		expect(p?.margem_declarada).toBe('alta');
	});

	it('SEM CONTA, A FAIXA É `nao_apurado` — a classe do modelo não vira selo', () => {
		// O card mais chamativo da página dizia "margem alta · pouca briga" e, no
		// próprio corpo, "Você cobra: não apurado / Sobra para você: não apurado".
		// O realce vinha da classe do modelo; agora `margem_faixa` é a da CONTA.
		const [p] = normalizarProdutos({
			produtos: [{ nome: 'Chaveiro', margem_faixa: 'alta' }],
		});
		expect(p?.margem_pct).toBeNull();
		expect(p?.margem_faixa).toBe('nao_apurado');
		expect(p?.margem_declarada).toBe('alta');
	});

	it('CUSTO SEM FONTE NÃO VIRA MARGEM — nem o número aparece na tela', () => {
		// Reproduzido ao vivo pelo verificador: o Analista de Margem sem busca
		// inventou "Chapa de MDF Cru 3mm — R$ 79,90 — Leo Madeiras" em 2 de 2
		// tentativas. A conta em TypeScript estava certa; o insumo dela era texto
		// solto de LLM, e o card saía "Sobra para você 68%" em verde.
		const [p] = normalizarProdutos({
			produtos: [
				{
					nome: 'Tábua de churrasco',
					preco_venda_brl: { min: 250, max: 320 },
					custo_estimado_brl: 79.9,
					margem_faixa: 'alta',
				},
			],
		});
		expect(p?.custo_estimado_brl).toBeNull();
		expect(p?.margem_pct).toBeNull();
		expect(p?.margem_faixa).toBe('nao_apurado');
		expect(p?.custo_fonte_url).toBe('');
	});

	it('custo com URL DO PRÓPRIO PRODUTO vale, se a página foi citada', () => {
		const citadas = conjuntoDeUrls(['https://www.loja.com/chapa-mdf/']);
		const [ok] = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Porta-copos',
						preco_venda_brl: 40,
						custo_estimado_brl: 'R$ 8,00',
						// O modelo come o `www.` e a barra final ao copiar do digest.
						custo_fonte_url: 'https://loja.com/chapa-mdf',
					},
				],
			},
			{ urlsCitadas: citadas },
		);
		expect(ok?.custo_estimado_brl).toBe(8);
		expect(ok?.margem_pct).toBe(80);

		const [inventado] = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Porta-copos',
						preco_venda_brl: 40,
						custo_estimado_brl: 'R$ 8,00',
						custo_fonte_url: 'https://loja-que-ninguem-abriu.com/mdf',
					},
				],
			},
			{ urlsCitadas: citadas },
		);
		expect(inventado?.custo_estimado_brl).toBeNull();
		expect(inventado?.margem_pct).toBeNull();
	});

	it('o custo do Curador só passa se BATER com o do Analista de Margem', () => {
		const fonte = {
			item: 'Chapa de acrílico cristal 3mm',
			brl: 12.5,
			url: 'https://loja.com/acrilico',
		};
		const copiou = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'A',
						material: 'Acrílico 3mm',
						preco_venda_brl: 50,
						custo_estimado_brl: 12.5,
					},
				],
			},
			{ custoComFonte: fonte },
		);
		expect(copiou[0]?.custo_estimado_brl).toBe(12.5);
		// Número diferente do que tem página = conta que o modelo fez sozinho
		// (o papel dele PROÍBE dividir e multiplicar, justamente por isso).
		const inventou = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'A',
						material: 'Acrílico 3mm',
						preco_venda_brl: 50,
						custo_estimado_brl: 30,
					},
				],
			},
			{ custoComFonte: fonte },
		);
		expect(inventou[0]?.custo_estimado_brl).toBeNull();
	});

	it('O CUSTO DE UM INSUMO NÃO VIRA MARGEM DE OUTRO PRODUTO', () => {
		// Reproduzido pelo verificador com o código real: o Analista de Margem
		// devolve UM `custo_peca_brl` por execução e o papel do Curador manda
		// COPIÁ-LO em todos os produtos. Bastava o valor bater, e no escopo
		// `mercado` (onde o "produto" é o ramo inteiro) os três primeiros cards
		// saíam em verde — troféu de acrílico com 90,6%, tábua de MDF com 87,9% —
		// todos com a página de uma CANECA de R$ 8,50 como fonte.
		const daCaneca = {
			item: 'Caneca branca de porcelana 325ml para sublimação',
			brl: 8.5,
			url: 'https://loja.com/caneca-branca-avulsa',
		};
		const lista = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Troféu em acrílico 20cm',
						material: 'Acrílico 5mm',
						preco_venda_brl: { min: 90, max: 140 },
						custo_estimado_brl: 8.5,
					},
					{
						nome: 'Tábua de churrasco personalizada',
						material: 'MDF 15mm',
						preco_venda_brl: { min: 70, max: 120 },
						custo_estimado_brl: 8.5,
					},
					{
						nome: 'Caneca personalizada',
						material: 'Porcelana',
						preco_venda_brl: { min: 35, max: 55 },
						custo_estimado_brl: 8.5,
					},
				],
			},
			{ custoComFonte: daCaneca },
		);
		const porNome = (n: string) => lista.find((x) => x.nome.startsWith(n));
		// O produto feito DAQUELE insumo continua apurando margem…
		expect(porNome('Caneca')?.custo_estimado_brl).toBe(8.5);
		expect(porNome('Caneca')?.margem_pct).toBe(75.7);
		expect(porNome('Caneca')?.custo_fonte_url).toBe(daCaneca.url);
		// …e os outros dois voltam a ser o que sempre foram: não apurados.
		for (const n of ['Troféu', 'Tábua']) {
			expect(porNome(n)?.custo_estimado_brl).toBeNull();
			expect(porNome(n)?.margem_pct).toBeNull();
			expect(porNome(n)?.margem_faixa).toBe('nao_apurado');
			expect(porNome(n)?.custo_fonte_url).toBe('');
		}
	});

	it('"chapa" não casa com "chapa": o que amarra é o MATERIAL', () => {
		// A palavra que os dois insumos têm em comum é a FORMA de comprar, não o
		// material — casar por ela devolveria o preço do MDF para o acrílico.
		expect(
			falaDoMesmoInsumo('Acrílico 3mm', 'Chapa de MDF cru 3mm 2,75×1,85'),
		).toBe(false);
		expect(
			falaDoMesmoInsumo('Porta-copos em MDF', 'Chapa de MDF cru 3mm 2,75×1,85'),
		).toBe(true);
		// O Curador escreve curto; a loja escreve longo. É a palavra do material
		// que tem que sobreviver aos dois.
		expect(
			falaDoMesmoInsumo(
				'Troféu em acrílico 20cm',
				'Chapa de acrílico transparente 3mm',
			),
		).toBe(true);
		// Insumo sem nome não amarra nada — e sem amarração não há custo.
		expect(falaDoMesmoInsumo('Caneca de porcelana', '')).toBe(false);
	});

	it('PROSA NÃO É NÚMERO — "cerca de 15% do preço" não vira custo', () => {
		expect(numeroBrlEstrito('cerca de 15% do preço')).toBeNull();
		expect(numeroBrlEstrito('R$ 89,90 o pacote com 50 canecas')).toBeNull();
		expect(numeroBrlEstrito('R$ 89,90')).toBe(89.9);
		expect(numeroBrlEstrito('1.234,56 reais')).toBe(1234.56);
		expect(numeroBrlEstrito(0)).toBeNull();
		// E na porta de entrada: com fonte batendo no valor da prosa ou não, o
		// campo em prosa não vira margem.
		const [p] = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Caneca',
						material: 'Porcelana',
						preco_venda_brl: { min: 30, max: 60 },
						custo_estimado_brl: 'cerca de 15% do preço',
					},
				],
			},
			{
				custoComFonte: {
					item: 'Caneca de porcelana branca',
					brl: 15,
					url: 'https://loja.com/x',
				},
			},
		);
		expect(p?.margem_pct).toBeNull();
	});

	it('o link do exemplo só sobrevive se a página tiver sido CITADA', () => {
		const citadas = conjuntoDeUrls([
			'https://produto.mercadolivre.com.br/MLB-123-tabua',
		]);
		const lista = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Tábua',
						// O modelo copia o endereço do digest e o marketplace pendura um
						// `#position=1` — é a mesma página, e o link legítimo tem que valer.
						url_exemplo:
							'https://produto.mercadolivre.com.br/MLB-123-tabua#position=1',
					},
					{
						nome: 'Chaveiro',
						url_exemplo:
							'https://produto.mercadolivre.com.br/MLB-999-inventado',
					},
				],
			},
			{ urlsCitadas: citadas },
		);
		const porNome = (n: string) => lista.find((x) => x.nome === n);
		expect(porNome('Tábua')?.url_exemplo).toBe(
			'https://produto.mercadolivre.com.br/MLB-123-tabua#position=1',
		);
		// A única prova clicável do card não pode levar a um 404.
		expect(porNome('Chaveiro')?.url_exemplo).toBe('');
	});

	it('`esforco` ausente é `nao_apurado`, não "médio"', () => {
		// Era o único campo do card em que ausência virava afirmação: o produto
		// sobre o qual o modelo não disse nada saía "· dá algum trabalho".
		const [p] = normalizarProdutos({ produtos: [{ nome: 'X' }] });
		expect(p?.esforco).toBe('nao_apurado');
		const [q] = normalizarProdutos({
			produtos: [{ nome: 'Y', esforco: 'Difícil' }],
		});
		expect(q?.esforco).toBe('dificil');
	});

	it('o custo com fonte sai do Analista de Margem, conferido contra as citações', () => {
		const citada = conjuntoDeUrls(['https://loja.com/caneca']);
		const json = {
			insumos: [
				{
					item: 'Caneca branca de porcelana 325ml',
					preco_brl: 8.5,
					url: 'https://loja.com/caneca',
				},
			],
			// O papel do Analista manda: um custo por peça só entra aqui se a
			// PÁGINA vender a peça avulsa. Quem cumpre o papel, passa.
			custo_peca_brl: 8.5,
		};
		expect(custoComFonte(json, citada)).toEqual({
			item: 'Caneca branca de porcelana 325ml',
			brl: 8.5,
			url: 'https://loja.com/caneca',
		});
		// Rodou sem busca: link plausível, ZERO citações. Não vale.
		expect(custoComFonte(json, conjuntoDeUrls([]))).toBeNull();
		// Sem número por peça não há o que sustentar.
		expect(
			custoComFonte({ insumos: json.insumos, custo_peca_brl: null }, citada),
		).toBeNull();
		expect(chaveUrl('HTTPS://www.Loja.com/mdf/?utm=1')).toBe('loja.com/mdf');
	});

	it('A FONTE TEM QUE SER A PÁGINA DAQUELE NÚMERO, não de qualquer insumo', () => {
		// Reproduzido pelo verificador: `custo_peca_brl` de R$ 12,40 (chapa de
		// acrílico, página NÃO citada) saía carimbado com a URL de uma caixa de
		// papelão de R$ 1,20 — a primeira página citada da lista. O card exibia
		// "material ≈ R$ 12,40" com fonte clicável para outra coisa.
		const soAcaixaFoiCitada = conjuntoDeUrls([
			'https://embalagens.com/caixa-10x10',
		]);
		const json = {
			insumos: [
				{
					item: 'Chapa acrílico 3mm',
					preco_brl: 260,
					url: 'https://acrilicos-inventado.com/chapa',
				},
				{
					item: 'Caixa de papelão 10x10',
					preco_brl: 1.2,
					url: 'https://embalagens.com/caixa-10x10',
				},
			],
			custo_peca_brl: 12.4,
		};
		expect(custoComFonte(json, soAcaixaFoiCitada)).toBeNull();
		// E o número que É o preço da página citada passa, com o insumo junto —
		// é ele que depois amarra o custo ao produto certo.
		expect(
			custoComFonte({ ...json, custo_peca_brl: 1.2 }, soAcaixaFoiCitada),
		).toEqual({
			item: 'Caixa de papelão 10x10',
			brl: 1.2,
			url: 'https://embalagens.com/caixa-10x10',
		});
		// Divisão que o papel PROÍBE ("quem faz conta é o sistema"): R$ 79,90 a
		// chapa, "rende 20" → 4,00 por peça. Esse 4,00 não está em página
		// nenhuma, e por isso não vira margem.
		expect(
			custoComFonte(
				{
					insumos: [
						{
							item: 'Chapa MDF 3mm',
							preco_brl: 79.9,
							rende_pecas: 20,
							url: 'https://loja.com/mdf',
						},
					],
					custo_peca_brl: 4,
				},
				conjuntoDeUrls(['https://loja.com/mdf']),
			),
		).toBeNull();
	});

	it('PREÇO DE CHAPA NÃO É PREÇO DE PEÇA: `rende_pecas` derruba o custo', async () => {
		// Reproduzido pelo verificador: as três condições anteriores premiavam
		// quem VIOLA o papel. Quem obedece ("não divida") devolve `null` em
		// `custo_peca_brl` e não vira margem nenhuma; quem copia o preço da CHAPA
		// para lá passava na condição do "número igual ao da página" — porque o
		// número é mesmo o daquela página — e saía na tela como custo apurado.
		const citada = conjuntoDeUrls(['https://leomadeiras.com.br/mdf-cru-3mm']);
		const chapa = {
			insumos: [
				{
					item: 'Chapa de MDF Cru 3mm 2,75x1,85m',
					unidade_compra: 'chapa 2,75 × 1,85 m',
					preco_brl: 79.9,
					rende_pecas: 20,
					loja: 'Leo Madeiras',
					url: 'https://leomadeiras.com.br/mdf-cru-3mm',
				},
			],
			custo_peca_brl: 79.9,
		};
		expect(custoComFonte(chapa, citada)).toBeNull();

		// E o card que saía com PREJUÍZO de −128% apresentado como conta feita
		// ("Você cobra R$ 35 – R$ 60 · material ≈ R$ 79,90") volta a dizer a
		// verdade: não apurado.
		const lista = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Porta-retrato em MDF',
						material: 'MDF 3mm',
						preco_venda_brl: { min: 35, max: 60 },
						custo_estimado_brl: 79.9,
					},
				],
			},
			{ custoComFonte: custoComFonte(chapa, citada), urlsCitadas: citada },
		);
		expect(lista[0]?.custo_estimado_brl).toBeNull();
		expect(lista[0]?.margem_pct).toBeNull();
		expect(lista[0]?.margem_faixa).toBe('nao_apurado');

		// A peça em branco que a página vende AVULSA continua passando: é o caso
		// que o papel autoriza, com `rende_pecas` ausente ou igual a 1.
		const avulsa = {
			insumos: [
				{
					item: 'Caneca branca de cerâmica 325ml',
					preco_brl: 8.5,
					rende_pecas: 1,
					url: 'https://loja.com/caneca',
				},
			],
			custo_peca_brl: 8.5,
		};
		expect(
			custoComFonte(avulsa, conjuntoDeUrls(['https://loja.com/caneca'])),
		).not.toBeNull();
	});

	it('CANECA DE CERÂMICA NÃO É CANECA DE INOX: material diferente derruba o casamento', () => {
		// A palavra em comum era o FORMATO. Reproduzido pelo verificador: o custo
		// de uma caneca branca de cerâmica de R$ 8,50, com página citada, virava
		// 85,8% de margem numa caneca térmica de inox — margem MAIOR que a
		// legítima, logo primeira da lista e com o realce de "melhor combinação",
		// e com a página da cerâmica como fonte.
		expect(
			falaDoMesmoInsumo(
				'Inox Caneca térmica de inox 500ml',
				'Caneca branca de cerâmica 325ml',
			),
		).toBe(false);
		// Quando só um lado nomeia o material, nada foi contrariado e o
		// casamento por palavra continua valendo — é o caso legítimo.
		expect(
			falaDoMesmoInsumo('Caneca personalizada', 'Caneca branca de cerâmica'),
		).toBe(true);
		// Sinônimo da MESMA família não é contradição: porcelana é cerâmica,
		// MDF é madeira.
		expect(
			falaDoMesmoInsumo(
				'Porcelana Caneca de porcelana',
				'Caneca branca de cerâmica 325ml',
			),
		).toBe(true);

		const daCeramica = {
			item: 'Caneca branca de cerâmica 325ml',
			brl: 8.5,
			url: 'https://loja.com/caneca-ceramica',
		};
		const lista = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Caneca de cerâmica personalizada',
						material: 'Cerâmica',
						preco_venda_brl: { min: 35, max: 55 },
						custo_estimado_brl: 8.5,
					},
					{
						nome: 'Caneca térmica de inox 500ml',
						material: 'Inox',
						preco_venda_brl: { min: 60, max: 90 },
						custo_estimado_brl: 8.5,
					},
				],
			},
			{ custoComFonte: daCeramica },
		);
		const porNome = (n: string) => lista.find((x) => x.nome.startsWith(n));
		expect(porNome('Caneca de cerâmica')?.margem_pct).toBe(75.7);
		expect(porNome('Caneca térmica')?.custo_estimado_brl).toBeNull();
		expect(porNome('Caneca térmica')?.margem_faixa).toBe('nao_apurado');
		expect(porNome('Caneca térmica')?.custo_fonte_url).toBe('');
	});

	it('faixa invertida é consertada e preço em prosa é lido', () => {
		const [a] = normalizarProdutos({
			produtos: [{ nome: 'X', preco_venda_brl: 'de R$ 80 a R$ 50' }],
		});
		expect(a?.preco_venda_brl).toEqual({ min: 50, max: 80 });
		const [b] = normalizarProdutos({
			produtos: [{ nome: 'Y', preco_venda_brl: 'R$ 1.200,00' }],
		});
		// Preço único NÃO vira faixa: inventar o outro extremo seria criar
		// informação que ninguém pesquisou.
		expect(b?.preco_venda_brl).toEqual({ min: 1200, max: null });
	});

	it('lista faltando, em prosa ou dentro de string não derruba nada', () => {
		expect(normalizarProdutos(null)).toEqual([]);
		expect(normalizarProdutos({ produtos: 'não encontrei produtos' })).toEqual(
			[],
		);
		expect(
			normalizarProdutos('{"produtos":[{"nome":"Chaveiro"}]}'),
		).toHaveLength(1);
		expect(normalizarProdutos([{ nome: 'Direto no array' }])).toHaveLength(1);
		expect(normalizarProdutos('isto não é json')).toEqual([]);
	});

	it('a lista para em 12 — a partir dali é sugestão pior por construção', () => {
		const muitos = Array.from({ length: 20 }, (_, i) => ({
			nome: `Produto ${i}`,
			preco_venda_brl: { min: 100 },
			custo_estimado_brl: 10 + i,
		}));
		expect(normalizarProdutos({ produtos: muitos })).toHaveLength(MAX_PRODUTOS);
	});

	it('a ressalva do Curador sobrevive à normalização', () => {
		expect(extrairObservacao({ observacao: 'não achei custo de insumo' })).toBe(
			'não achei custo de insumo',
		);
		expect(extrairObservacao(null)).toBe('');
	});
});

describe('o piso de confiança — mentir bonito é o pior modo de falha', () => {
	it('amostra suficiente MAS espalhada NÃO vira preço de mercado', () => {
		// Caso real de um run de teste: 3 anúncios de R$ 19,99 a R$ 60,00.
		// Amostra passa no MIN_AMOSTRA, confiança fica em 0,22 — e apresentar
		// isso como "o preço de mercado" é o erro que mata o produto.
		const { stats } = consolidarPrecos([
			{ brlCents: 1999, url: 'https://a/1' },
			{ brlCents: 2200, url: 'https://a/2' },
			{ brlCents: 6000, url: 'https://a/3' },
		]);
		expect(stats?.n).toBeGreaterThanOrEqual(MIN_AMOSTRA);
		expect(stats?.confianca).toBeLessThan(CONFIANCA_MINIMA);
		expect(faixaConfiavel(stats)).toBe(false);
	});

	it('amostra boa e concordante vira preço de mercado', () => {
		const { stats } = consolidarPrecos(
			[4500, 4700, 4900, 5100, 5300, 5500].map((c, i) => ({
				brlCents: c,
				url: `https://a/${i}`,
			})),
		);
		expect(faixaConfiavel(stats)).toBe(true);
	});
});

/* ══════════ um especialista: relógio, dinheiro e segunda tentativa ══════════ */

function resposta(over: Partial<SearchCallResult> = {}): SearchCallResult {
	return {
		modelUsado: 'anthropic/claude-sonnet-5',
		text: '{"nota":8}',
		citations: [],
		usage: { in: 100, out: 100 },
		buscas: 0,
		custoUsd: 0.001,
		...over,
	};
}

function contexto() {
	const eventos: BlockProgressEvent[] = [];
	return {
		ctx: {
			customerId: 'aluno-1',
			onProgress: (e: BlockProgressEvent) => eventos.push(e),
		},
		eventos,
	};
}

const evento = (eventos: BlockProgressEvent[], kind: string) =>
	eventos.find((e) => e.kind === kind);

describe('um especialista, do ponto de vista do relógio e do dinheiro', () => {
	beforeEach(() => {
		chamadaFalsa.mockReset();
	});

	it('NÃO PAGA CHAMADA NENHUMA com o relógio da execução no fim', async () => {
		// O bloco enfiava um pesquisador na onda mesmo com 20 s de relógio,
		// cortava o timeout dele para esses 20 s e colhia uma falha por TIMEOUT.
		// Pagava-se a chamada para não receber nada. Quem é cortável continua
		// sendo pulado: sem ele o dossiê sai igual, então a chamada perdida é
		// prejuízo puro.
		const b = new Budget(
			{ maxBuscas: 6, maxUsd: 1, deadlineMs: 1_000 },
			Date.now() - 10_000,
		);
		const { ctx, eventos } = contexto();
		const r = await rodarAgente(
			spec({ nome: 'Analista de Demanda', timeoutS: 120, maxTokens: 4_000 }),
			{},
			[],
			b,
			ctx,
		);
		expect(chamadaFalsa).not.toHaveBeenCalled();
		expect(r.ok).toBe(false);
		expect(r.erro).toMatch(/não chegou a tempo/i);
		// A conta em segundos é diagnóstico nosso e vai para o log; a tela do
		// aluno recebe o que faltou para o TRABALHO. Ver `FALHA_PARA_TELA`.
		expect(r.erro).not.toMatch(/relógio|\ds\b|execução/i);
		expect(b.diagnosticos.join(' ')).toMatch(/relógio da execução/i);
		expect(evento(eventos, 'agente_falhou')).toBeTruthy();
	});

	it('O RELÓGIO NÃO ESTORNA O RUN: quem escreve o dossiê tenta mesmo apertado', async () => {
		// O defeito, reproduzido com o Budget e o roster reais: o freio de
		// DINHEIRO ganhou a isenção de `protegido` e o do RELÓGIO ficou sem
		// nenhuma. Em mercado+rápido, com a onda 1 fechando em 70 s dos 95 s do
		// deadline, sobram 25 s contra o piso de 35 s do Estrategista: ele era
		// PULADO, e como é `essencial` o piso de sucesso reprovava o run — 502,
		// estorno, e o aluno que esperou 70 segundos vendo o time inteiro
		// entregar recebia erro. Pular quem escreve o dossiê não salva run
		// nenhum; tentar apertado às vezes salva.
		chamadaFalsa.mockResolvedValue(resposta({ text: '{"nota":8}' }));
		const b = new Budget(
			{ maxBuscas: 6, maxUsd: 1, deadlineMs: 95_000 },
			Date.now() - 70_000,
		);
		// 25 s de relógio contra um piso de 35 s (3 s de abertura + 4.000 × 8 ms).
		expect(Math.round(b.msRestantes() / 1000)).toBe(25);
		expect(b.cabeNoTempo(120, 4_000)).toBe(false);
		const { ctx, eventos } = contexto();
		const r = await rodarAgente(
			spec({
				nome: 'Estrategista de Negócio',
				saida: '{"nota":0}',
				timeoutS: 120,
				maxTokens: 4_000,
				essencial: true,
				fase: 'sintese',
			}),
			{},
			[],
			b,
			ctx,
		);
		expect(chamadaFalsa).toHaveBeenCalledTimes(1);
		expect(r.ok).toBe(true);
		expect(evento(eventos, 'agente_falhou')).toBeUndefined();
		/**
		 * O aperto não fica escondido — mas fica no LOG, não no dossiê.
		 *
		 * Ele rodou e a seção dele está lá: para quem lê o dossiê não há nada a
		 * ressalvar. "O tempo desta execução estava no fim, mas ele rodou assim
		 * mesmo" é diagnóstico nosso, e ler isso numa página paga é o mesmo
		 * problema que o "orçamento estourou" (ver `diagnosticos` em budget.ts).
		 */
		expect(b.diagnosticos.join(' ')).toMatch(/relógio no fim/i);
		expect(b.avisos).toEqual([]);
		// E o relógio que sobrou continua sendo o teto da chamada — a isenção é
		// para TENTAR, não para furar o deadline da execução.
		expect(chamadaFalsa.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
	});

	it('mas APERTADO NÃO É ZERADO: com o deadline vencido nem o protegido paga chamada', async () => {
		// A isenção é para tentar, não para furar o deadline: o timeout da chamada
		// continua sendo o que sobrou do relógio. Com zero, ela nasceria abortada
		// — gasto sem nenhuma chance de resposta.
		const b = new Budget(
			{ maxBuscas: 6, maxUsd: 1, deadlineMs: 1_000 },
			Date.now() - 10_000,
		);
		expect(b.msRestantes()).toBe(0);
		const { ctx } = contexto();
		const r = await rodarAgente(
			spec({
				nome: 'Estrategista de Negócio',
				timeoutS: 120,
				maxTokens: 4_000,
				essencial: true,
				fase: 'sintese',
			}),
			{},
			[],
			b,
			ctx,
		);
		expect(chamadaFalsa).not.toHaveBeenCalled();
		expect(r.ok).toBe(false);
		expect(r.erro).toMatch(/não chegou a tempo/i);
	});

	it('e o RETRY do protegido também não morre no relógio', async () => {
		// O `signal` é criado ANTES da primeira chamada e não é renovado: o retry
		// do protegido corre dentro do prazo que já estava reservado para ele.
		// Barrá-lo era trocar a última tentativa de salvar o dossiê pelo estorno.
		chamadaFalsa
			.mockRejectedValueOnce(
				new SearchError('resposta vazia', 'vazio', {
					buscas: 0,
					custoUsd: 0.01,
				}),
			)
			.mockResolvedValueOnce(resposta({ text: '{"nota":8}' }));
		const b = new Budget(
			{ maxBuscas: 6, maxUsd: 1, deadlineMs: 95_000 },
			Date.now() - 70_000,
		);
		const { ctx } = contexto();
		const r = await rodarAgente(
			spec({
				nome: 'Estrategista de Negócio',
				saida: '{"nota":0}',
				timeoutS: 120,
				maxTokens: 4_000,
				essencial: true,
				fase: 'sintese',
			}),
			{},
			[],
			b,
			ctx,
		);
		expect(chamadaFalsa).toHaveBeenCalledTimes(2);
		expect(r.ok).toBe(true);
	});

	it('o CORTÁVEL não ganha a isenção do relógio nem no retry', async () => {
		// A isenção é do dossiê, não do agente: sem o Analista de Demanda o
		// dossiê sai igual, então uma segunda chamada com o relógio no fim é
		// dinheiro jogado fora. O relógio é adiantado DENTRO da primeira chamada
		// porque é isso que acontece de verdade — ela é a coisa lenta do run.
		let agora = Date.now();
		const relogio = vi.spyOn(Date, 'now').mockImplementation(() => agora);
		try {
			chamadaFalsa.mockImplementationOnce(async () => {
				agora += 30_000;
				throw new SearchError('resposta vazia', 'vazio', {
					buscas: 0,
					custoUsd: 0.01,
				});
			});
			const b = new Budget(
				{ maxBuscas: 6, maxUsd: 1, deadlineMs: 40_000 },
				agora,
			);
			const { ctx } = contexto();
			const r = await rodarAgente(
				spec({
					nome: 'Analista de Demanda',
					saida: '{"nota":0}',
					timeoutS: 120,
					maxTokens: 4_000,
				}),
				{},
				[],
				b,
				ctx,
			);
			// Passou no portão de entrada (40 s ≥ 35 s de piso) e a chamada comeu
			// 30 s: no retry sobram 10 s, e aí ele para.
			expect(chamadaFalsa).toHaveBeenCalledTimes(1);
			expect(r.ok).toBe(false);
			// "Não refiz em outro modelo" é conversa nossa: o que o aluno vê é o
			// especialista em `falhas`, e é lá que ele já aparece.
			expect(b.diagnosticos.join(' ')).toMatch(/sem retry/i);
			expect(b.avisos).toEqual([]);
		} finally {
			relogio.mockRestore();
		}
	});

	it('A VAGA DE BUSCA É UMA POR CHAMADA, não uma por resultado pedido', async () => {
		// O roster do Analista de Margem pede resultados, e o provedor cobra por
		// CHAMADA. Reservar `max_buscas` vagas silenciava especialista por uma
		// cobrança que nunca aconteceria — aqui o teto é de UMA busca e o
		// especialista que pede TRÊS resultados continua pesquisando.
		chamadaFalsa.mockResolvedValue(resposta({ buscas: 1, custoUsd: 0.01 }));
		const b = new Budget(
			{ maxBuscas: 1, maxUsd: 1, deadlineMs: 60_000 },
			Date.now(),
		);
		const { ctx, eventos } = contexto();
		const r = await rodarAgente(
			spec({ chave: 'radar', motorBusca: 'perplexity', maxBuscas: 3 }),
			{},
			[],
			b,
			ctx,
		);
		expect(r.ok).toBe(true);
		expect(chamadaFalsa.mock.calls[0]?.[0].engine).toBe('perplexity');
		expect(evento(eventos, 'agente_iniciou')?.sem_busca).toBe(false);
		expect(b.gasto().buscas).toBe(1);
	});

	it('QUEM PESQUISA RECEBE O MATERIAL NO SYSTEM — o user vira a consulta', async () => {
		// MEDIDO CONTRA O PROVEDOR, com a onda 2 inteira caindo num run real de
		// "brindes corporativos": o plugin de busca formula a consulta a partir da
		// última mensagem de USUÁRIO, e o motor `perplexity` devolve HTTP 500
		// quando ela passa de ~7 mil caracteres. Com o digest de 20 mil colado ali,
		// os DEZ especialistas da onda 2 falharam — cada um com um retry pago em
		// outro modelo, que falhou pelo mesmo motivo. `exa` aguenta 20k, e foi por
		// isso que a onda 1 (que usa `exa`) não denunciou nada.
		const b = new Budget(LIMITES_PADRAO.profundo, Date.now());
		const { ctx } = contexto();
		chamadaFalsa.mockResolvedValue(resposta({ text: '{"a":[]}' }));
		const material = `## Pesquisador de Oportunidades\n${'produto campeão. '.repeat(1_500)}`;

		await rodarAgente(
			spec({
				chave: 'custo_dos_produtos',
				fase: 'aprofundamento',
				motorBusca: 'perplexity',
				maxBuscas: 1,
				papel: 'Você levanta o custo da peça em branco.',
				pergunta: 'Quanto custa a peça em branco de {produto}?',
				saida: '{"insumos":[]}',
			}),
			{ produto: 'caneca' },
			[],
			b,
			ctx,
			material,
		);

		const args = chamadaFalsa.mock.calls[0]?.[0] as {
			system: string;
			user: string;
		};
		// O material está no system, inteiro.
		expect(args.system).toContain('MATERIAL DO TIME');
		expect(args.system).toContain('produto campeão');
		// E o user — que é o que vira consulta — continua sendo a PERGUNTA.
		expect(args.user).not.toContain('MATERIAL DO TIME');
		expect(args.user).not.toContain('produto campeão');
		expect(args.user).toContain('Quanto custa a peça em branco de caneca?');
		// O teto medido do `perplexity` é ~7 mil; o que vai na consulta fica
		// uma ordem de grandeza abaixo disso.
		expect(args.user.length).toBeLessThan(2_000);
	});

	it('quem NÃO pesquisa continua recebendo o material no user', async () => {
		// Para a síntese o material é a TAREFA, não o contexto — e o resultado
		// desses cinco já foi aprovado como está. A correção do `perplexity` não
		// pode mexer neles de carona.
		const b = new Budget(LIMITES_PADRAO.profundo, Date.now());
		const { ctx } = contexto();
		chamadaFalsa.mockResolvedValue(resposta({ text: '{"nota":8}' }));

		await rodarAgente(
			spec({
				chave: 'estrategista',
				fase: 'sintese',
				motorBusca: 'nenhum',
				papel: 'Você fecha o veredito.',
				pergunta: 'Vale a pena?',
				saida: '{"nota":0}',
			}),
			{},
			[],
			b,
			ctx,
			'## Radar\ncaneca vende bem',
		);

		const args = chamadaFalsa.mock.calls[0]?.[0] as {
			system: string;
			user: string;
		};
		expect(args.user).toContain('MATERIAL DO TIME');
		expect(args.user).toContain('caneca vende bem');
		expect(args.system).toBe('Você fecha o veredito.');
	});

	it('o cartão NASCE dizendo que não vai pesquisar quando o teto acabou', async () => {
		// A tela mantinha o cartão "consultando fornecedor" com varredura ativa
		// enquanto o especialista rodava com zero acesso à web — a mesma encenação
		// proibida para o cartão de cache.
		chamadaFalsa.mockResolvedValue(resposta());
		const b = new Budget(
			{ maxBuscas: 0, maxUsd: 1, deadlineMs: 60_000 },
			Date.now(),
		);
		const { ctx, eventos } = contexto();
		await rodarAgente(
			spec({ motorBusca: 'perplexity', maxBuscas: 1 }),
			{},
			[],
			b,
			ctx,
		);
		expect(evento(eventos, 'agente_iniciou')?.sem_busca).toBe(true);
		expect(evento(eventos, 'busca')).toBeUndefined();
		expect(chamadaFalsa.mock.calls[0]?.[0].engine).toBe('nenhum');
	});

	it('JSON QUEBRADO DISPARA A SEGUNDA TENTATIVA, em modelo equivalente', async () => {
		// O `throw` do JSON truncado vivia FORA do `try` do retry: para o modo de
		// falha mais comum do time a segunda tentativa nunca acontecia, e o aluno
		// esperava ~60 s para ler "não cobramos por esta análise".
		chamadaFalsa
			.mockResolvedValueOnce(resposta({ text: 'Claro! Aqui está: {"nota": 8' }))
			.mockResolvedValueOnce(resposta({ text: '{"nota":8}' }));
		const b = new Budget(LIMITES_PADRAO.profundo, Date.now());
		const { ctx, eventos } = contexto();
		const r = await rodarAgente(
			spec({
				nome: 'Estrategista de Negócio',
				saida: '{"nota":0}',
				maxTokens: 4_000,
				fase: 'sintese',
				essencial: true,
			}),
			{},
			[],
			b,
			ctx,
		);
		expect(chamadaFalsa).toHaveBeenCalledTimes(2);
		expect(r.ok).toBe(true);
		expect(evento(eventos, 'agente_retry')).toBeTruthy();
		// E não escala para o mais caro do catálogo: US$ 25/M na saída dentro de
		// um modo que cobra 2 voxxys derrubava a margem de 78,6% para 48%.
		expect(chamadaFalsa.mock.calls[1]?.[0].model.id).not.toBe(
			'anthropic/claude-opus-5',
		);
	});

	it('O RETRY CONSULTA O ORÇAMENTO de quem NÃO escreve o dossiê', async () => {
		// A falha carrega o que já custou (o modelo escreveu a resposta inteira, ou
		// a busca foi cobrada e o texto veio vazio).
		chamadaFalsa.mockRejectedValueOnce(
			new SearchError('resposta vazia', 'vazio', {
				buscas: 0,
				custoUsd: 0.055,
			}),
		);
		const b = new Budget(
			{ maxBuscas: 6, maxUsd: 0.06, deadlineMs: 60_000 },
			Date.now(),
		);
		const { ctx } = contexto();
		const r = await rodarAgente(
			spec({
				nome: 'Analista de Demanda',
				saida: '{"nota":0}',
				maxTokens: 4_000,
			}),
			{},
			[],
			b,
			ctx,
		);
		expect(chamadaFalsa).toHaveBeenCalledTimes(1);
		expect(r.ok).toBe(false);
		// O `custo_usd` do dossiê escondia exatamente os runs caros: o `registrar`
		// só rodava no caminho de sucesso.
		expect(b.gasto().usd).toBeCloseTo(0.055, 6);
		// O motivo da recusa é NOSSO: vai para o log, não para a página que ele
		// pagou. Na tela ele já aparece em `falhas`.
		expect(b.diagnosticos.join(' ')).toMatch(/sem retry/i);
		expect(b.avisos).toEqual([]);
	});

	it('O FREIO DE ORÇAMENTO NÃO ESTORNA O RUN: quem escreve o dossiê refaz assim mesmo', async () => {
		// O defeito, reproduzido com o Budget e o catálogo reais: o filtro de
		// orçamento do retry chegou SEM a exceção de `protegido`. O Estrategista
		// devolve JSON cortado (1 em 7 runs), o que por definição significa que
		// ele queimou o teto de 4.000 tokens; com o gasto perto do `maxUsd`
		// nenhum modelo do catálogo cabia, `escolherAlternativo` devolvia null, o
		// essencial falhava e o controller ESTORNAVA — gastando US$ 0,10, fazendo
		// o aluno esperar 90 s e faturando R$ 0,00. Trocar "caro" por "estornado"
		// é o oposto do que o freio existe para fazer.
		chamadaFalsa
			.mockRejectedValueOnce(
				new SearchError('resposta vazia', 'vazio', {
					buscas: 0,
					custoUsd: 0.055,
				}),
			)
			.mockResolvedValueOnce(resposta({ text: '{"nota":8}' }));
		const b = new Budget(
			{ maxBuscas: 6, maxUsd: 0.06, deadlineMs: 60_000 },
			Date.now(),
		);
		const { ctx, eventos } = contexto();
		const r = await rodarAgente(
			spec({
				nome: 'Estrategista de Negócio',
				saida: '{"nota":0}',
				maxTokens: 4_000,
				fase: 'sintese',
				essencial: true,
			}),
			{},
			[],
			b,
			ctx,
		);
		expect(chamadaFalsa).toHaveBeenCalledTimes(2);
		expect(r.ok).toBe(true);
		expect(evento(eventos, 'agente_retry')).toBeTruthy();
		/**
		 * O estouro não fica escondido — vira DIAGNÓSTICO, e nunca ressalva.
		 *
		 * Medido em três runs frios: a frase "O orçamento desta execução estourou,
		 * mas refiz 'Estrategista de Negócio' assim mesmo" chegava ao dossiê que o
		 * aluno pagou, junto com o NOME DO MODELO por trás do cargo. Ele comprou
		 * um time de profissionais e recebeu, na seção de ressalvas, a notícia de
		 * que a empresa ficou sem verba no meio do pedido dele — para uma seção
		 * que foi entregue inteira.
		 */
		expect(b.diagnosticos.join(' ')).toMatch(/teto de gasto do modo/i);
		expect(b.avisos).toEqual([]);
		// E continua sendo um modelo de qualidade equivalente, não o mais barato
		// do catálogo — rebaixar quem escreve o veredito era a outra saída ruim.
		expect(chamadaFalsa.mock.calls[1]?.[0].model.quality).toBe('top');
	});

	it('o freio de custo NÃO corta quem escreve o dossiê, mas corta o resto', async () => {
		chamadaFalsa.mockResolvedValue(resposta());
		// Orçamento já estourado: qualquer projeção não cabe.
		const magro = () =>
			new Budget(
				{ maxBuscas: 6, maxUsd: 0.001, deadlineMs: 60_000 },
				Date.now(),
			);

		const bPesquisador = magro();
		const rPesquisador = await rodarAgente(
			spec({ nome: 'Caçador de Brechas' }),
			{},
			[],
			bPesquisador,
			contexto().ctx,
		);
		expect(rPesquisador.ok).toBe(false);
		expect(rPesquisador.erro).toMatch(/não chegou a entrar/i);
		// "Orçamento" é palavra de máquina e a regra a proíbe na tela do aluno.
		// O número continua no diagnóstico, que é onde ele serve.
		expect(rPesquisador.erro).not.toMatch(/orçamento|custo|US\$/i);
		expect(bPesquisador.diagnosticos.join(' ')).toMatch(/freio de custo/i);
		expect(chamadaFalsa).not.toHaveBeenCalled();

		const bEssencial = magro();
		const rEssencial = await rodarAgente(
			spec({ nome: 'Estrategista', essencial: true, fase: 'sintese' }),
			{},
			[],
			bEssencial,
			contexto().ctx,
		);
		// Sem ele o dossiê não vale: roda assim mesmo, e o motivo vai para o log.
		expect(rEssencial.ok).toBe(true);
		expect(bEssencial.diagnosticos.join(' ')).toMatch(/teto de gasto/i);
		expect(bEssencial.avisos).toEqual([]);
	});

	/**
	 * A REGRA, EM UM TESTE SÓ: o dossiê não fala a nossa língua.
	 *
	 * Os cinco testes acima conferem cada mensagem no lugar certo; este confere
	 * a fronteira inteira de uma vez, sobre os quatro caminhos que geram texto
	 * (busca cortada, especialista pulado, retry, estouro de teto). Ele existe
	 * porque a regressão é fácil e muda: basta alguém escrever `budget.avisar`
	 * numa frase nova de controle de custo, e ela chega verbatim à seção "O que
	 * este dossiê NÃO garante".
	 *
	 * O aluno comprou um time de PROFISSIONAIS: nome de modelo, orçamento, teto,
	 * retry e token são vocabulário de máquina e não existem para ele.
	 */
	it('NENHUMA RESSALVA DO DOSSIÊ FALA DE MODELO, ORÇAMENTO, TETO OU RETRY', async () => {
		const MAQUINA =
			/modelo|orçament|retry|refiz|token|sonnet|haiku|gemini|claude|anthropic|google\/|max_tokens|us\$|agente/i;

		// (1) sem vaga de busca  (2) pulado por dinheiro  (3) retry com estouro
		const casos: Budget[] = [];

		const b1 = new Budget(
			{ maxBuscas: 0, maxUsd: 1, deadlineMs: 60_000 },
			Date.now(),
		);
		chamadaFalsa.mockResolvedValue(resposta());
		await rodarAgente(
			spec({ nome: 'Analista de Margem', motorBusca: 'perplexity' }),
			{},
			[],
			b1,
			contexto().ctx,
		);
		casos.push(b1);

		const b2 = new Budget(
			{ maxBuscas: 6, maxUsd: 0.001, deadlineMs: 60_000 },
			Date.now(),
		);
		await rodarAgente(
			spec({ nome: 'Caçador de Brechas' }),
			{},
			[],
			b2,
			contexto().ctx,
		);
		casos.push(b2);

		chamadaFalsa
			.mockReset()
			.mockRejectedValueOnce(
				new SearchError('resposta vazia', 'vazio', {
					buscas: 0,
					custoUsd: 0.055,
				}),
			)
			.mockResolvedValueOnce(resposta({ text: '{"nota":8}' }));
		const b3 = new Budget(
			{ maxBuscas: 6, maxUsd: 0.06, deadlineMs: 60_000 },
			Date.now(),
		);
		await rodarAgente(
			spec({
				nome: 'Estrategista de Negócio',
				saida: '{"nota":0}',
				maxTokens: 4_000,
				fase: 'sintese',
				essencial: true,
			}),
			{},
			[],
			b3,
			contexto().ctx,
		);
		casos.push(b3);

		// Cada caso produziu alguma coisa — senão o teste passaria por vazio.
		expect(
			casos.every((b) => b.avisos.length + b.diagnosticos.length > 0),
		).toBe(true);
		for (const b of casos) {
			for (const aviso of b.avisos) expect(aviso).not.toMatch(MAQUINA);
		}
		// E o que saiu da tela não sumiu: continua existindo, do nosso lado.
		expect(casos.some((b) => b.diagnosticos.length > 0)).toBe(true);
	});

	/**
	 * A MESMA REGRA NA OUTRA PORTA — a que estava aberta.
	 *
	 * O teste acima cobre `budget.avisos`. Só que o cartão do especialista na
	 * sala de guerra não lê aviso: ele lê `agente_falhou.erro`, que era o
	 * `err.message` INTEIRO. Chegavam à tela "falha na chamada (500)", "erro do
	 * provedor", "a resposta bateu no limite de tokens e veio cortada (18240
	 * caracteres, teto 3400 tokens)" e — o pior — "o modelo
	 * 'google/gemini-3.1-flash-lite' devolveu resposta vazia (mas cobrou 3
	 * resultado(s) de busca)": nome de modelo E cobrança, para quem comprou um
	 * time de profissionais.
	 */
	it('NEM A MENSAGEM DE QUEM FALHOU: o cartão do especialista fala de trabalho', async () => {
		const MAQUINA =
			/modelo|orçament|retry|token|caracteres|json|http|\(\d{3}\)|provedor|sonnet|haiku|gemini|claude|anthropic|google\/|us\$/i;

		const falhas: [string, unknown][] = [
			['500 do provedor', new SearchError('falha na chamada (500)', 'falha')],
			['erro no corpo', new SearchError('erro do provedor', 'falha')],
			[
				'resposta vazia com busca cobrada',
				new SearchError(
					"o modelo 'google/gemini-3.1-flash-lite' devolveu resposta vazia (mas cobrou 3 resultado(s) de busca)",
					'vazio',
					{ buscas: 3, custoUsd: 0.015 },
				),
			],
			['tempo esgotado', new SearchError('tempo esgotado', 'timeout')],
			['limite de uso', new SearchError('limite de uso', 'rate')],
			['erro qualquer', new Error('ECONNRESET')],
		];

		for (const [nome, erro] of falhas) {
			// Duas vezes: a primeira falha dispara o retry, a segunda encerra.
			chamadaFalsa.mockReset().mockRejectedValue(erro);
			const b = new Budget(
				{ maxBuscas: 6, maxUsd: 1, deadlineMs: 60_000 },
				Date.now(),
			);
			const { ctx, eventos } = contexto();
			const r = await rodarAgente(spec({}), {}, [], b, ctx);
			expect(r.ok, nome).toBe(false);
			expect(r.erro, nome).toBeTruthy();
			expect(r.erro, nome).not.toMatch(MAQUINA);
			const naTela = evento(eventos, 'agente_falhou') as { erro?: string };
			expect(naTela?.erro, nome).not.toMatch(MAQUINA);
			// E o técnico não se perdeu: ele é o que explica o run no log.
			expect(b.diagnosticos.join(' '), nome).toContain(
				erro instanceof Error ? erro.message : '',
			);
		}
	});

	/**
	 * A OUTRA FRASE QUE VIAJAVA CRUA: o JSON que não fecha.
	 *
	 * É o modo de falha mais comum do time (quem escreve mais bate no teto), e
	 * a mensagem trazia contagem de caractere e teto de token para a tela.
	 */
	it('JSON cortado: a tela diz que ele não fechou o relatório, e não quanto media', async () => {
		chamadaFalsa
			.mockReset()
			.mockResolvedValue(resposta({ text: '{"nota": 8, "vered' }));
		const b = new Budget(
			{ maxBuscas: 6, maxUsd: 1, deadlineMs: 60_000 },
			Date.now(),
		);
		const { ctx } = contexto();
		const r = await rodarAgente(
			spec({ saida: '{"nota":0}', maxTokens: 3_400 }),
			{},
			[],
			b,
			ctx,
		);
		expect(r.ok).toBe(false);
		expect(r.erro).toMatch(/não conseguiu fechar o relatório/i);
		expect(r.erro).not.toMatch(/token|caractere|json|teto/i);
		// O diagnóstico guarda o que serve para consertar: tamanho, teto e o
		// começo da resposta.
		expect(b.diagnosticos.join(' ')).toMatch(/teto 3400 tokens/);
	});

	it('escolhe alternativo de qualidade EQUIVALENTE, e nenhum se não couber', () => {
		const alt = escolherAlternativo('anthropic/claude-sonnet-5', false);
		expect(alt?.id).not.toBe('anthropic/claude-opus-5');
		expect(alt?.quality).toBe('top');
		expect(
			escolherAlternativo('anthropic/claude-sonnet-5', false, () => false),
		).toBeNull();
	});

	it('A FOTO QUE O MODELO ESCREVEU MORRE NA ENTRADA', () => {
		// A causa medida de 0 fotos de produto em 4 imagens somando os três runs
		// profundos de mercado: `imagem_url` inventada era lida como "este já tem
		// foto", a página nunca era aberta e a URL falsa (404, ou o GIF "imagem
		// indisponível" do ML) ia inteira para a grade da tela.
		const doModelo = {
			referencias: [
				{
					produto: 'Chaveiro',
					url: 'https://produto.mercadolivre.com.br/MLB-345-chaveiro-_JM',
					imagem_url:
						'https://http2.mlstatic.com/D_NQ_NP_854652-MLB75432109876_042024-O.webp',
				},
			],
			concorrentes: [
				{
					nome: 'Loja X',
					campeoes: [
						{
							url: 'https://x.com.br/produto/1',
							imagem_url: 'https://f/1.jpg',
						},
					],
				},
			],
			observacao: 'texto qualquer',
		};
		const limpo = semFotoDoModelo(structuredClone(doModelo)) as typeof doModelo;
		// Some em QUALQUER profundidade, inclusive dentro de lista de lista.
		expect(limpo.referencias[0]).not.toHaveProperty('imagem_url');
		expect(limpo.concorrentes[0]?.campeoes[0]).not.toHaveProperty('imagem_url');
		// E só ela: a página e o resto do trabalho ficam intactos.
		expect(limpo.referencias[0]?.url).toBe(
			'https://produto.mercadolivre.com.br/MLB-345-chaveiro-_JM',
		);
		expect(limpo.observacao).toBe('texto qualquer');
		// Nada além de objeto derruba a limpeza (JSON de LLM tem null em lista).
		expect(semFotoDoModelo(null)).toBeNull();
		expect(semFotoDoModelo(undefined)).toBeUndefined();
		expect(semFotoDoModelo([null, { imagem_url: 'x' }])).toEqual([null, {}]);
	});

	it('O ENDEREÇO INVENTADO MORRE JUNTO — a foto era metade do cartão', () => {
		// A seção se chama, na tela, "Anúncios reais que já estão no ar. Clique no
		// card para abrir". Medido no último run frio de mercado: o Curador de
		// Imagens recebeu 109 citações e escreveu SEIS páginas, das quais UMA
		// existia — as outras cinco eram id montado em sequência. Elas passam por
		// `ehPaginaDeAnuncio` e pela allowlist, e abrem em 404.
		const citadas = conjuntoDeUrls([
			'https://shopee.com.br/Kit-Presente-i.1590129750.23694413693',
		]);
		const json = {
			referencias: [
				{
					produto: 'Kit Presente',
					url: 'https://shopee.com.br/Kit-Presente-i.1590129750.23694413693',
				},
				{
					produto: 'Caneca',
					o_que_e: 'A imagem mostra a caneca em ângulo lateral',
					url: 'https://shopee.com.br/Caneca-i.34567890.1234567890',
				},
			],
			campeoes: [
				{
					produto: 'Caneta',
					vendidos: 5_000,
					url: 'https://produto.mercadolivre.com.br/MLB-1234567890-caneta-_JM',
				},
			],
			observacao: 'A Shopee trabalha com faixa mais acessível',
		};
		const limpo = semLinkInventado(
			structuredClone(json),
			citadas,
		) as typeof json;
		// O que o run citou de verdade sobrevive inteiro…
		expect(limpo.referencias[0]?.url).toBe(
			'https://shopee.com.br/Kit-Presente-i.1590129750.23694413693',
		);
		// …e o que ele digitou vira vazio, em QUALQUER lista e a qualquer campo.
		expect(limpo.referencias[1]?.url).toBe('');
		expect(limpo.campeoes[0]?.url).toBe('');
		// Prosa e número não são tocados: o portão é de endereço.
		expect(limpo.observacao).toBe('A Shopee trabalha com faixa mais acessível');
		expect(limpo.campeoes[0]?.vendidos).toBe(5_000);
		expect(limpo.referencias[1]?.o_que_e).toBe(
			'A imagem mostra a caneca em ângulo lateral',
		);
		// Nada além de objeto derruba a limpeza (JSON de LLM tem null em lista).
		expect(semLinkInventado(null, citadas)).toBeNull();
		expect(
			semLinkInventado([null, { url: 'https://inventada/1' }], citadas),
		).toEqual([null, { url: '' }]);
	});

	it('e o cartão da GALERIA sem página some — descrever foto que ninguém viu é o pior', () => {
		// Nas outras seções o item sem link continua valendo (o Radar tem ordem de
		// deixar o endereço vazio quando só alcançou a listagem). Aqui o item é,
		// inteiro, uma afirmação sobre uma página: `o_que_e` descreve a foto
		// daquele anúncio. Sem página, sobra a descrição de uma imagem inventada.
		const json = {
			referencias: [
				{ produto: 'Kit', url: 'https://shopee.com.br/Kit-i.159.236' },
				{
					produto: 'Caneca',
					o_que_e: 'ângulo lateral, alça ergonômica',
					url: '',
				},
				{ produto: 'Caneta', o_que_e: 'close da gravação' },
			],
			observacao: 'não achei anúncio individual de três deles',
		};
		const podado = soReferenciasComPagina(structuredClone(json)) as typeof json;
		expect(podado.referencias.map((r) => r.produto)).toEqual(['Kit']);
		// O especialista continua com lugar na tela: a ressalva dele fica.
		expect(podado.observacao).toBe(
			'não achei anúncio individual de três deles',
		);
		// A seção encolhe até sumir, e sumir é o estado honesto.
		expect(
			(
				soReferenciasComPagina({ referencias: [{ produto: 'x' }] }) as {
					referencias: unknown[];
				}
			).referencias,
		).toEqual([]);
		expect(soReferenciasComPagina(null)).toBeNull();
	});

	it('e com o campo limpo, o alvo volta a ser elegível a buscar a foto real', () => {
		// O par do teste acima: `alvosDeFoto` é quem monta o alvo, e o filtro de
		// `abrirPaginas` só busca foto de quem NÃO tem. Antes, um `imagem_url`
		// inventado tirava o item da fila — a foto falsa VENCIA a real.
		const json = {
			produtos: [
				{
					url: 'https://x.com.br/produto/1',
					imagem_url: 'https://falsa/1.jpg',
				},
			],
		};
		expect(alvosDeFoto(json)[0]?.imagem_url).toBe('https://falsa/1.jpg');
		expect(alvosDeFoto(semFotoDoModelo(json))[0]?.imagem_url).toBeUndefined();
	});

	it('a fila de fotos prioriza a seção nova SEM matar o ranking de anúncios', () => {
		const curados = Array.from({ length: 12 }, (_, i) => `https://a/c${i}`);
		const anuncios = Array.from({ length: 30 }, (_, i) => `https://a/r${i}`);
		// Sem galeria (é o Rápido: o especialista de referências é da onda 2).
		const fila = filaDePaginas([], curados, [], anuncios, 18);
		expect(fila).toHaveLength(18);
		expect(fila.filter((u) => u.includes('/c'))).toHaveLength(5);
		expect(fila.filter((u) => u.includes('/r'))).toHaveLength(13);
		// URL repetida nas listas é UMA página aberta, não duas.
		expect(filaDePaginas([], ['https://a/1'], [], ['https://a/1'], 18)).toEqual(
			['https://a/1'],
		);
	});

	it('A GALERIA TEM COTA PRÓPRIA — e ela não come o ranking', () => {
		// O defeito que isto tranca: sem cota, as páginas da galeria entram atrás
		// do ranking inteiro e a seção onde "mais imagens" foi pedido nasce vazia
		// num run em que o ranking veio cheio. Com cota SEM teto seria o oposto.
		const curados = Array.from({ length: 12 }, (_, i) => `https://a/c${i}`);
		const galeria = Array.from({ length: 30 }, (_, i) => `https://a/g${i}`);
		const anuncios = Array.from({ length: 30 }, (_, i) => `https://a/r${i}`);
		const fila = filaDePaginas([], curados, galeria, anuncios, 36);
		expect(fila).toHaveLength(36);
		expect(fila.filter((u) => u.includes('/c'))).toHaveLength(5);
		// Um terço do teto para a galeria; o resto continua sendo do ranking.
		expect(fila.filter((u) => u.includes('/g'))).toHaveLength(12);
		expect(fila.filter((u) => u.includes('/r'))).toHaveLength(19);
	});

	it('O PREÇO ABRE PRIMEIRO — página não aberta apaga um número, não um ladrilho', () => {
		// Nas outras três faixas a página que não abre custa um ladrilho sem
		// foto. Nesta, ela tira a observação da amostra: "é anúncio" passou a ser
		// PROVADO abrindo a página. Deixá-la no fim seria pôr a faixa de preço do
		// dossiê para depender de quantas fotos de enfeite couberam no relógio.
		const precos = Array.from({ length: 30 }, (_, i) => `https://a/p${i}`);
		const curados = Array.from({ length: 12 }, (_, i) => `https://a/c${i}`);
		const galeria = Array.from({ length: 30 }, (_, i) => `https://a/g${i}`);
		const anuncios = Array.from({ length: 30 }, (_, i) => `https://a/r${i}`);

		const fila = filaDePaginas(precos, curados, galeria, anuncios, 36);
		expect(fila).toHaveLength(36);
		// As primeiras da fila são as do preço, e são metade do teto.
		expect(fila.slice(0, 18).every((u) => u.includes('/p'))).toBe(true);
		expect(fila.filter((u) => u.includes('/p'))).toHaveLength(18);
		// Prioridade COM cota: a galeria e a seção da frente continuam de pé.
		expect(fila.filter((u) => u.includes('/c'))).toHaveLength(5);
		expect(fila.filter((u) => u.includes('/g'))).toHaveLength(12);

		// No Rápido (teto 18) a cota é 9 — e a confiança satura em 8 anúncios
		// (`AMOSTRA_BOA`), então a faixa já sai tão sólida quanto sabe ser.
		const rapida = filaDePaginas(precos, curados, [], anuncios, 18);
		expect(rapida.filter((u) => u.includes('/p'))).toHaveLength(9);
		expect(rapida.filter((u) => u.includes('/c'))).toHaveLength(5);

		// A mesma página no preço e no ranking é UMA página aberta, não duas.
		expect(filaDePaginas(['https://a/1'], [], [], ['https://a/1'], 18)).toEqual(
			['https://a/1'],
		);
	});

	it('O TETO DE FOTOS SAI DO RELÓGIO — senão a galeria do Profundo apaga a foto do Rápido', () => {
		// Era um número chumbado (18), calibrado com o relógio do Rápido. Subi-lo
		// para 36 por causa da galeria levaria junto uma reserva de 40 s, e o
		// Rápido — 95 s de deadline, ~70 s já gastos — passaria a pular as fotos
		// em TODO run. Derivado do relógio, os dois ficam certos.
		//
		// O TETO CONTA AS DUAS SAÍDAS DE REDE, e não só as páginas: cada foto é
		// aberta (leva de 6, 6 s) e depois CONFERIDA por bytes (leva de 12, 4 s).
		// Reservar o pior caso da conferência como constante — os 12 s que 36
		// fotos custam — derrubaria o Rápido de 18 para 6, cobrando dele o custo
		// de uma conferência que ele nunca faz. Como as duas contas dependem do
		// mesmo N, o teto é o maior N que cabe: com 25 s de sobra, 12 fotos
		// (2 levas de página + 1 de conferência = 16 s), não 18 (26 s).
		expect(tetoDeFotos(25_000)).toBe(12);
		expect(tetoDeFotos(26_000 + 6_000)).toBe(18);
		expect(tetoDeFotos(120_000)).toBe(36);
		// Não fica sem folga para gravar o cache e devolver o dossiê.
		expect(tetoDeFotos(6_000)).toBe(0);
		// Nem para conferir o arquivo do que abriu: seis páginas custam 6 s de
		// leitura MAIS 4 s de conferência, e é isso que 16 s comportam.
		expect(tetoDeFotos(15_000)).toBe(0);
		expect(tetoDeFotos(16_000)).toBe(6);
		expect(tetoDeFotos(0)).toBe(0);
		expect(tetoDeFotos(-1_000)).toBe(0);
		// E nunca passa do teto absoluto, por mais relógio que sobre.
		expect(tetoDeFotos(10 * 60_000)).toBe(36);
	});

	it('a foto é procurada em QUALQUER lista do JSON, não só em `anuncios`/`produtos`', () => {
		// Com 22 especialistas e `saida` editável pela tela, enumerar nome de
		// campo é combinar de esquecer: o portfólio do concorrente, a queixa com
		// link e a referência visual nasceriam sem foto, sem erro nenhum.
		const json = {
			referencias: [
				{ titulo: 'a', pagina_url: 'https://loja.com.br/p/1' },
				// Já tem foto: continua elegível como alvo, mas `preencherFotos`
				// pula quem já tem — quem filtra é ele, não esta função.
				{
					titulo: 'b',
					url: 'https://loja.com.br/p/2',
					imagem_url: 'https://i/2.jpg',
				},
			],
			concorrentes: [
				{
					nome: 'loja',
					produtos: [{ url_anuncio: 'https://loja.com.br/p/3' }],
				},
			],
			observacao: 'nada aqui',
		};
		const alvos = alvosDeFoto(json);
		expect(alvos.map((a) => a.url)).toEqual([
			'https://loja.com.br/p/1',
			'https://loja.com.br/p/2',
			'https://loja.com.br/p/3',
		]);
		// E ESCREVE em `imagem_url`, que é o único campo que a tela lê — não no
		// campo de onde a página veio.
		const alvo = alvos[0] as { imagem_url?: unknown };
		alvo.imagem_url = 'https://i/1.jpg';
		expect(json.referencias[0]).toMatchObject({
			pagina_url: 'https://loja.com.br/p/1',
			imagem_url: 'https://i/1.jpg',
		});
	});

	it('gastoDeFalha: o dinheiro que saiu conta; o que não saiu, não', () => {
		expect(
			gastoDeFalha(
				new SearchError('x', 'vazio', { buscas: 1, custoUsd: 0.05 }),
				true,
			),
		).toEqual({ buscas: 1, custoUsd: 0.05 });
		// Timeout: a resposta não voltou, mas a busca chegou a ser cobrada.
		expect(gastoDeFalha(new SearchError('x', 'timeout'), true)).toEqual({
			buscas: 1,
			custoUsd: USD_POR_BUSCA,
		});
		expect(gastoDeFalha(new SearchError('x', 'timeout'), false)).toBeNull();
		// 429 é recusa do provedor: nada rodou, nada foi cobrado.
		expect(gastoDeFalha(new SearchError('x', 'rate'), true)).toBeNull();
		expect(gastoDeFalha(new Error('outro'), true)).toBeNull();
	});
});

/* ═══════ o time de 22 contra o orçamento de verdade: ninguém roda cego ═══════ */

/** Mais barato do catálogo que funciona com busca — é o que o roster usa. */
const M_BUSCA = 'google/gemini-3.1-flash-lite';
const M_ESCRITA = 'anthropic/claude-sonnet-5';
const M_REVISOR = 'anthropic/claude-haiku-4.5';
const M_INTERNO = 'google/gemini-3-flash-preview';

/**
 * O ROSTER DE `mercado+profundo`, LIDO DO BANCO E CONGELADO AQUI: 7 + 10 + 5.
 *
 * É o mais caro das duas combinações (uma síntese a mais, o Curador em Haiku),
 * e é essa que o orçamento precisa comportar. Os `maxTokens`, os modelos e o
 * tamanho de prompt são os do roster real — não são chutes: um teto de saída
 * subestimado aqui faria esta simulação aprovar um `maxUsd` que estoura em
 * produção, que é o oposto do que ela existe para fazer.
 *
 * Se o roster real mudar de FORMA (mais um pesquisador na onda 2, um
 * sintetizador trocado por Sonnet), esta cópia para de descrever o roster e os
 * números têm que ser refeitos junto com `LIMITES_PADRAO`. A conferência ao
 * vivo é `montarTime` sobre a coleção `agentes`.
 */
function rosterProfundo(): AgentSpec[] {
	const pesquisador = (
		chave: string,
		fase: 'descoberta' | 'aprofundamento',
		maxTokens: number,
		chars: number,
	) =>
		spec({
			chave,
			nome: chave,
			fase,
			modelo: M_BUSCA,
			motorBusca: 'perplexity',
			maxBuscas: 1,
			maxTokens,
			timeoutS: 75,
			papel: 'x'.repeat(chars - 8),
			pergunta: 'y'.repeat(0),
			saida: '{"a":[]}',
		});
	const consultor = (
		chave: string,
		fase: 'aprofundamento' | 'sintese',
		modelo: string,
		maxTokens: number,
		chars: number,
		essencial = false,
	) =>
		spec({
			chave,
			nome: chave,
			fase,
			modelo,
			motorBusca: 'nenhum',
			maxBuscas: 0,
			maxTokens,
			timeoutS: 120,
			essencial,
			papel: 'x'.repeat(chars - 8),
			pergunta: 'y'.repeat(0),
			saida: '{"a":[]}',
		});

	return [
		// onda 1 — descoberta (7, todos com busca)
		pesquisador('radar_oportunidades', 'descoberta', 2400, 1651),
		pesquisador('brechas', 'descoberta', 1800, 1828),
		pesquisador('margem', 'descoberta', 1800, 1989),
		pesquisador('marketplaces', 'descoberta', 2400, 1349),
		pesquisador('tendencias', 'descoberta', 1800, 802),
		pesquisador('publico', 'descoberta', 1200, 1228),
		pesquisador('sazonalidade', 'descoberta', 1200, 1340),
		// onda 2 — aprofundamento (10: 9 com busca + o Consultor de Produção)
		pesquisador('concorrente_perfil', 'aprofundamento', 1800, 1972),
		pesquisador('concorrente_portfolio', 'aprofundamento', 2400, 1731),
		pesquisador('referencias_visuais', 'aprofundamento', 1800, 1831),
		pesquisador('reclamacoes', 'aprofundamento', 1400, 1666),
		pesquisador('palavras_chave', 'aprofundamento', 1400, 1706),
		pesquisador('custo_dos_produtos', 'aprofundamento', 1800, 2039),
		pesquisador('fornecedores', 'aprofundamento', 1600, 1688),
		pesquisador('frete_logistica', 'aprofundamento', 1400, 1703),
		pesquisador('venda_direta', 'aprofundamento', 1400, 1726),
		consultor('producao', 'aprofundamento', M_INTERNO, 1400, 1324),
		// onda 3 — síntese (5)
		consultor('riscos', 'sintese', M_INTERNO, 1600, 1434),
		consultor('curadoria', 'sintese', M_REVISOR, 3000, 2659),
		consultor('redator', 'sintese', M_ESCRITA, 5000, 1671),
		consultor('estrategista', 'sintese', M_ESCRITA, 8000, 1920, true),
		consultor('auditor', 'sintese', M_REVISOR, 2500, 894),
	];
}

describe('o orçamento do Profundo comporta os 22 — ninguém roda cego', () => {
	beforeEach(() => {
		chamadaFalsa.mockReset();
	});

	/**
	 * ESTE É O TESTE QUE O DEFEITO "roda sem busca em silêncio" PEDIU DUAS VEZES.
	 *
	 * Ele não confere fórmula nenhuma: roda `rodarAgente` DE VERDADE, com o
	 * `Budget` de verdade, o catálogo de preços de verdade e as três ondas
	 * despachadas como o bloco despacha (barreira entre elas, `comLimite` com a
	 * concorrência do bloco). O que ele afirma é o que o aluno percebe: os 22
	 * entregam, os 17 que pesquisam pesquisaram, e o orçamento não cortou
	 * ninguém pelo caminho.
	 *
	 * O modo de falha que ele tranca é MUDO por natureza — o especialista roda,
	 * responde, e só não abriu página nenhuma. Sem esta simulação, a primeira
	 * pessoa a descobrir é o aluno lendo "não apurado" numa célula paga.
	 */
	it('as três ondas cabem em maxBuscas, maxUsd e no relógio, com o roster de 22', async () => {
		// O provedor cobra a busca quando a busca acontece — e quem decide se ela
		// acontece é `rodarAgente` (ele desliga o motor quando o teto acaba). Um
		// dublê que cobra sempre esconderia justamente o especialista cego.
		chamadaFalsa.mockImplementation(async (args) => {
			const comBusca = args.engine !== 'nenhum';
			return resposta({
				modelUsado: args.model.id,
				text: '{"a":[]}',
				// Gasto REAL de uma chamada (a saída fica em ~40% do teto): é ele que
				// o `Budget` registra e que aperta a onda seguinte.
				buscas: comBusca ? 1 : 0,
				custoUsd: comBusca ? 0.008 : 0.02,
			});
		});

		const time = rosterProfundo();
		const budget = new Budget(LIMITES_PADRAO.profundo, Date.now());
		const { ctx, eventos } = contexto();
		const feitos: Awaited<ReturnType<typeof rodarAgente>>[] = [];

		for (const [i, fase] of (
			['descoberta', 'aprofundamento', 'sintese'] as const
		).entries()) {
			const onda = time.filter((a) => a.fase === fase);
			// O material tem o TAMANHO REAL do que a onda recebe — é ele que entra
			// como token de ENTRADA na projeção de custo, e é a parcela que cresceu
			// com o time. Passar `undefined` aqui esconderia justamente o gasto novo.
			const material =
				i === 0
					? undefined
					: 'm'.repeat(i === 1 ? TETO_DIGEST_ONDA2 : TETO_DIGEST_ONDA3);
			feitos.push(
				...(
					await comLimite(
						onda.map(
							(a) => () => rodarAgente(a, {}, [], budget, ctx, material),
						),
						10,
					)
				).map((r) => (r.status === 'fulfilled' ? r.value : null) as never),
			);
		}

		// 1. TODO MUNDO ENTREGOU.
		expect(feitos).toHaveLength(22);
		expect(feitos.filter((r) => r.ok)).toHaveLength(22);

		// 2. NINGUÉM RODOU CEGO. `sem_busca` é estreito de propósito: só é `true`
		//    quando o papel do especialista PEDIA busca e o run tirou a busca dele.
		const cegos = eventos.filter(
			(e) => e.kind === 'agente_iniciou' && e.sem_busca === true,
		);
		expect(cegos).toEqual([]);
		// 16 dos 22 pesquisam (7 na descoberta + 9 no aprofundamento): o Consultor
		// de Produção e os quatro sintetizadores respondem do próprio
		// conhecimento, por desenho.
		expect(budget.gasto().buscas).toBe(16);

		// 3. E o orçamento não reclamou de nada: nenhum aviso de teto estourado,
		//    de busca cortada nem de tempo no fim.
		expect(budget.avisos).toEqual([]);

		// 4. O gasto real fica dentro do teto — e o gasto real MEDIDO (US$ 0,26 a
		//    0,31 nos runs frios) deixa a margem em 78,8% a 80,2% a 6 voxxys,
		//    acima do piso de 75%. O piso se confere no custo, não no freio: ver
		//    "o teto de gasto é FREIO, não previsão".
		expect(budget.gasto().usd).toBeLessThanOrEqual(
			LIMITES_PADRAO.profundo.maxUsd,
		);
		expect(1 - (budget.gasto().usd * 5.5) / (6 * 1.2)).toBeGreaterThanOrEqual(
			0.75,
		);
	});

	it('O PICO DE COMPROMETIMENTO é o número que `maxUsd` precisa cobrir', () => {
		/**
		 * O freio compara "gasto real das ondas fechadas + projeção de PIOR CASO
		 * do que está em voo". Como as ondas são barreiras, nunca há mais de uma
		 * em voo — e é por isso que `maxUsd` pode ficar abaixo do pior caso
		 * somado das três sem cortar ninguém.
		 *
		 * ESTE TESTE PASSAVA COM O TETO ERRADO, e é por isso que ele ganhou um
		 * segundo número. Ele afirmava só `pico ≤ maxUsd` usando o material da
		 * onda no TETO do digest e os tetos de saída de então; o pico REAL,
		 * medido chamada a chamada num run frio de `mercado+profundo`, deu
		 * US$ 0,335 contra um `maxUsd` de 0,32 — o freio fechava em execução
		 * normal e gravava um estouro que não existia. A simulação continua sendo
		 * a guarda de regressão (ela roda em todo commit); o número medido está
		 * no cabeçalho de budget.ts.
		 */
		const preco: Record<string, { in: number; out: number }> = {
			[M_BUSCA]: { in: 0.25, out: 1.5 },
			[M_ESCRITA]: { in: 2, out: 10 },
			[M_REVISOR]: { in: 1, out: 5 },
			[M_INTERNO]: { in: 0.5, out: 3 },
		};
		const material = (a: AgentSpec) =>
			a.fase === 'descoberta'
				? 0
				: a.fase === 'aprofundamento'
					? TETO_DIGEST_ONDA2
					: TETO_DIGEST_ONDA3;
		const custo = (a: AgentSpec, fracaoDaSaida: number) =>
			estimarCustoUsd({
				precoIn: preco[a.modelo ?? '']?.in ?? 0,
				precoOut: preco[a.modelo ?? '']?.out ?? 0,
				charsPrompt: a.papel.length + a.pergunta.length + material(a),
				maxTokensSaida: Math.round(a.maxTokens * fracaoDaSaida),
				comBusca: a.motorBusca !== 'nenhum',
			});

		const time = rosterProfundo();
		const soma = (fase: AgentSpec['fase'], f: number) =>
			time.filter((a) => a.fase === fase).reduce((t, a) => t + custo(a, f), 0);

		// "Real" = saída em ~40% do teto (medido); "em voo" = pior caso.
		const picos = [
			soma('descoberta', 1),
			soma('descoberta', 0.4) + soma('aprofundamento', 1),
			soma('descoberta', 0.4) +
				soma('aprofundamento', 0.4) +
				soma('sintese', 1),
		];
		expect(Math.max(...picos)).toBeLessThanOrEqual(
			LIMITES_PADRAO.profundo.maxUsd,
		);
		/**
		 * E O PICO SIMULADO NÃO PODE FICAR MUITO ABAIXO DO MEDIDO.
		 *
		 * A simulação usa `charsPrompt / 4` como régua de tokens de entrada, e o
		 * provedor cobrou 2,26 caracteres por token no digest real — ou seja, ela
		 * subestima a entrada da onda 3. Enquanto o pico simulado ficar perto do
		 * medido (US$ 0,335), a guarda vale; se ele despencar, é porque alguém
		 * mexeu na régua e o teste parou de descrever o run.
		 */
		expect(Math.max(...picos)).toBeGreaterThan(0.24);
	});
});

/* ═══════════ o bloco inteiro: cache, time e a lista de produtos ═══════════ */

/**
 * Uma página de verdade citada pelo pesquisador. Sem preço no trecho, de
 * propósito: com preço, o bloco montaria observação e iria atrás da og:image —
 * rede num teste de mesa.
 */
const CITACAO = {
	url: 'https://loja.com/caneca-branca',
	title: 'Caneca branca para sublimação',
	content: 'caneca de porcelana para sublimação, venda por unidade',
};

/** Um registro da coleção `agentes`, como o repositório o devolve. */
function entrada(data: Record<string, unknown>) {
	return { id: String(data.chave), title: String(data.nome), data };
}

/** A linha de cache de mercado, com a idade que ela teria hoje. */
function linhaDeCache(payload: unknown, diasAtras = 1) {
	return {
		id: 'cache-1',
		title: 'brindes',
		data: {
			cache_key: 'mercado|brindes|BR|v1',
			gerado_em: new Date(Date.now() - diasAtras * 86_400_000).toISOString(),
			payload: JSON.stringify(payload),
		},
	};
}

describe('o bloco inteiro, com cache quente', () => {
	beforeEach(() => {
		chamadaFalsa.mockReset();
		repoList.mockReset();
		repoUpdate.mockReset();
		repoCreate.mockReset();
		repoUpdate.mockResolvedValue({});
		repoCreate.mockResolvedValue({});
		paginasFalsas.mockReset();
		paginasFalsas.mockImplementation(async () => new Map());
		fotosFalsas.mockReset();
		fotosFalsas.mockImplementation(async (urls: string[]) => new Set(urls));
	});

	const ROSTER = [
		entrada({
			chave: 'radar_oportunidades',
			nome: 'Radar de Oportunidades',
			papel: 'p',
			pergunta: 'o que vende em {produto}?',
			motor_busca: 'perplexity',
			max_buscas: 1,
			escopo: 'mercado',
			modo: 'ambos',
			compartilhavel: true,
			ordem: 10,
		}),
		entrada({
			chave: 'curadoria',
			nome: 'Curador de Oportunidades',
			papel: 'p',
			pergunta: 'por onde começar em {produto}?',
			saida: '{"produtos":[]}',
			motor_busca: 'nenhum',
			escopo: 'mercado',
			modo: 'ambos',
			// FORA do cache de propósito: a lista dele é função do material
			// DAQUELA execução, não retrato do mercado (ver o roster real).
			compartilhavel: false,
			fase: 'sintese',
			ordem: 80,
		}),
	];

	const params = () =>
		aiResearchTeamBlock.paramsSchema.parse({
			tool: 'central_inteligencia',
			escopo: 'mercado',
			modo: 'rapido',
			vars: JSON.stringify({ produto: 'brindes', categoria_slug: 'brindes' }),
		});

	const ctxDeTeste = () => ({
		customerId: 'aluno-1',
		toolDoc: {} as Record<string, unknown>,
		onProgress: () => {},
	});

	/**
	 * ┌─ "12 ANÚNCIOS COM PREÇO E LINK" ONDE NÃO HAVIA UM ANÚNCIO SEQUER ──────┐
	 * │ Sistemático nos três runs profundos de mercado. Reabrindo as 111        │
	 * │ observações dos 9 runs gravados, ZERO das 40 do escopo `mercado` vinha  │
	 * │ de um anúncio: `yav.com.br/comissoes-marketplace/` cedeu R$ 79 (o       │
	 * │ DEGRAU da comissão da Shopee), um artigo fiscal cedeu R$ 100 ("quando   │
	 * │ você vende por R$ 100 e a plataforma retém R$ 16") e um vídeo do        │
	 * │ YouTube cedeu R$ 20 (frete para o Centro-Oeste). A tela cravava mediana │
	 * │ R$ 36,50 com `preco_confiavel: true` — e o aluno fecha trabalho em      │
	 * │ cima disso.                                                             │
	 * │                                                                         │
	 * │ São DOIS portões, e este teste passa pelos dois: o endereço que se       │
	 * │ denuncia (a peneira barata, sem rede) e a página que não assina que      │
	 * │ vende (o mecanismo, abrindo o `<head>`).                                │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 */
	it('SÓ VIRA "ANÚNCIO" O PREÇO DE PÁGINA QUE PROVOU SER ANÚNCIO', async () => {
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return { items: [], total: 0 };
		});
		const CITACOES = [
			// (1) Anúncio de verdade — passa nos dois portões.
			{
				url: 'https://loja.com.br/produto/caneca-porcelana-325ml',
				title: 'Caneca de porcelana 325 ml',
				content: 'Caneca personalizada por R$ 40,00 à vista',
			},
			// (2) Tabela de comissão: endereço inocente, página é `article`.
			{
				url: 'https://yav.com.br/comissoes-marketplace/',
				title: 'Comissões dos marketplaces',
				content: 'Shopee: 20% até R$ 79,99 · 14% acima',
			},
			// (3) Blog: cai na peneira barata, nem chega a ser aberto.
			{
				url: 'https://whitebrindes.com.br/blog/quanto-custa-personalizar/',
				title: 'Quanto custa personalizar',
				content: 'brindes a partir de R$ 25,00',
			},
			// (4) Vídeo: o R$ 20 dele é FRETE, e o host nem é vitrine.
			{
				url: 'https://www.youtube.com/watch?v=s8J3_xI3s1M',
				title: 'Como vender brindes',
				content: 'pro Centro-Oeste R$ 20, Nordeste R$ 22',
			},
		];
		chamadaFalsa
			.mockImplementationOnce(async () =>
				resposta({ text: 'radar ok', citations: CITACOES }),
			)
			.mockImplementationOnce(async () =>
				resposta({ text: '{"produtos":[]}' }),
			);
		// O que cada página RESPONDEU quando foi aberta. Note que a (2) abriu e
		// disse que não é anúncio; a (3) e a (4) nem entraram na fila.
		paginasFalsas.mockImplementationOnce(async (urls: string[]) => {
			expect(urls).toEqual([
				'https://loja.com.br/produto/caneca-porcelana-325ml',
				'https://yav.com.br/comissoes-marketplace/',
			]);
			return new Map([
				[
					'https://loja.com.br/produto/caneca-porcelana-325ml',
					{ anuncio: true, foto: 'https://cdn.loja.com.br/1.jpg' },
				],
				[
					'https://yav.com.br/comissoes-marketplace/',
					{ anuncio: false, foto: null },
				],
			]);
		});

		const out = (await aiResearchTeamBlock.run(
			ctxDeTeste(),
			params(),
		)) as Record<string, unknown>;

		const obs = out.observacoes as { url: string; imagem_url?: string }[];
		expect(obs.map((o) => o.url)).toEqual([
			'https://loja.com.br/produto/caneca-porcelana-325ml',
		]);
		// Um anúncio só não crava faixa: a tela diz que não achou o suficiente.
		expect(out.preco_confiavel).toBe(false);
		// E a foto da observação que sobrou veio da PÁGINA, não do modelo.
		expect(obs[0]?.imagem_url).toBe('https://cdn.loja.com.br/1.jpg');
		// O aluno lê por que a faixa não saiu, em português e sem falar de
		// máquina — a conta é "de quantas, quantas caíram".
		const aviso = (out.avisos as string[]).join(' ');
		// Concordância feita à mão: "1 não abriram" é erro de português numa
		// seção que o aluno lê como texto de gente, e o caso de UMA acontece.
		expect(aviso).toMatch(
			/Das 2 páginas com preço que achei, uma não abriu ou não era um anúncio de verdade/i,
		);
		expect(aviso).not.toMatch(
			/modelo|orçament|token|json|http|og:|null|nao_apurado/i,
		);
	});

	it('e com anúncios de verdade a faixa continua saindo, com o selo', async () => {
		// A outra ponta: o portão não pode matar o caminho que funcionava. Nos
		// runs de `produto` sobrevivem 7 de 25, 12 de 27, 5 de 10 e 5 de 9 —
		// todos acima do `MIN_AMOSTRA`, e é essa faixa que continua de pé.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return { items: [], total: 0 };
		});
		const anuncios = [38, 40, 42, 45].map((v, i) => ({
			url: `https://loja${i}.com.br/produto/caneca`,
			title: `Caneca ${i}`,
			content: `por R$ ${v},00`,
		}));
		chamadaFalsa
			.mockImplementationOnce(async () =>
				resposta({ text: 'radar ok', citations: anuncios }),
			)
			.mockImplementationOnce(async () =>
				resposta({ text: '{"produtos":[]}' }),
			);
		paginasFalsas.mockImplementationOnce(
			async (urls: string[]) =>
				new Map(urls.map((u) => [u, { anuncio: true, foto: null }])),
		);

		const out = (await aiResearchTeamBlock.run(
			ctxDeTeste(),
			params(),
		)) as Record<string, unknown>;

		expect((out.observacoes as unknown[]).length).toBe(4);
		expect((out.price_stats as { n: number; medianaCents: number }).n).toBe(4);
		expect((out.price_stats as { medianaCents: number }).medianaCents).toBe(
			4100,
		);
		expect(out.preco_confiavel).toBe(true);
		// E com a faixa DE PÉ a ressalva cala: "descartei N páginas" não
		// ressalva nada quando o aluno está vendo quatro anúncios de verdade —
		// é contabilidade nossa, e `avisos` é a seção do que o dossiê NÃO
		// garante, não o log do run.
		expect((out.avisos as string[]).join(' ')).not.toMatch(/não abri/i);
	});

	/**
	 * ┌─ O MODELO INVENTA O ENDEREÇO DA PÁGINA, NÃO SÓ O DA FOTO ──────────────┐
	 * │ Medido no primeiro run frio depois de tirar `imagem_url` do contrato do │
	 * │ roster: o Curador de Imagens voltou com 10 citações REAIS e escreveu    │
	 * │ seis páginas que não eram nenhuma delas —                               │
	 * │ `shopee.com.br/…-i.34567890.1234567890` e três `MLB-` em sequência      │
	 * │ (`4567890123`, `5678901234`, `6789012345`). Elas passam por             │
	 * │ `ehPaginaDeAnuncio` e pela allowlist — a FORMA está certa — e abrem em   │
	 * │ 404. A galeria continuava zerada, agora por endereço inventado.         │
	 * │                                                                         │
	 * │ Das 31 páginas que entregaram foto de produto nos runs gravados, 31     │
	 * │ estavam entre as citações. Nenhuma inventada estava.                    │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 */
	it('PÁGINA NÃO CITADA NÃO É ABERTA — nem para foto, nem para preço', async () => {
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return { items: [], total: 0 };
		});
		const CITADA =
			'https://produto.mercadolivre.com.br/MLB-3543666155-chaveiro-_JM';
		chamadaFalsa
			.mockImplementationOnce(async () =>
				resposta({
					// O JSON nomeia DUAS páginas: uma que ele citou e uma que ele
					// inventou com id sequencial.
					text: JSON.stringify({
						produtos: [
							{ nome: 'Chaveiro', url: CITADA },
							{
								nome: 'Caneta',
								url: 'https://shopee.com.br/Caneta-Metal-i.34567890.1234567890',
							},
						],
					}),
					citations: [
						{ url: CITADA, title: 'Chaveiro acrílico', content: 'R$ 12,00' },
					],
				}),
			)
			.mockImplementationOnce(async () =>
				resposta({ text: '{"produtos":[]}' }),
			);
		paginasFalsas.mockImplementationOnce(
			async (urls: string[]) =>
				new Map(urls.map((u) => [u, { anuncio: true, foto: `${u}/og.jpg` }])),
		);

		await aiResearchTeamBlock.run(ctxDeTeste(), params());

		// A inventada nem chega a ser aberta: uma requisição a menos, e um
		// ladrilho a menos com link morto na grade.
		expect(paginasFalsas).toHaveBeenCalledTimes(1);
		expect(paginasFalsas.mock.calls[0]?.[0]).toEqual([CITADA]);
	});

	it('E NÃO CHEGA À TELA: o endereço inventado sai do json que o dossiê lê', async () => {
		// Não abrir a página era metade. A outra metade é que o endereço seguia
		// inteiro em `output.agentes`, e é de lá que a tela monta o cartão da
		// seção "Anúncios reais que já estão no ar. Clique no card para abrir".
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return { items: [], total: 0 };
		});
		const CITADA =
			'https://produto.mercadolivre.com.br/MLB-3543666155-chaveiro-_JM';
		chamadaFalsa
			.mockImplementationOnce(async () =>
				resposta({
					text: JSON.stringify({
						produtos: [
							{ nome: 'Chaveiro', url: CITADA },
							{
								nome: 'Caneta',
								url: 'https://shopee.com.br/Caneta-Metal-i.34567890.1234567890',
							},
						],
					}),
					citations: [
						{ url: CITADA, title: 'Chaveiro acrílico', content: 'R$ 12,00' },
					],
				}),
			)
			.mockImplementationOnce(async () =>
				resposta({ text: '{"produtos":[]}' }),
			);
		paginasFalsas.mockImplementationOnce(
			async (urls: string[]) =>
				new Map(urls.map((u) => [u, { anuncio: true, foto: `${u}/og.jpg` }])),
		);

		const out = (await aiResearchTeamBlock.run(
			ctxDeTeste(),
			params(),
		)) as Record<string, unknown>;

		const radar = (out.agentes as { chave: string; json: unknown }[]).find(
			(a) => a.chave === 'radar_oportunidades',
		)?.json as { produtos: { nome: string; url: string }[] };
		// O produto CONTINUA na lista — nomear o que está vendendo é resposta, e
		// o papel do Radar manda trazê-lo sem endereço quando não alcançou o
		// anúncio. O que some é o link fabricado.
		expect(radar.produtos.map((p) => p.nome)).toEqual(['Chaveiro', 'Caneta']);
		expect(radar.produtos[0]?.url).toBe(CITADA);
		expect(radar.produtos[1]?.url).toBe('');
	});

	it('FOTO REPROVADA NOS BYTES NÃO VIRA LADRILHO — 200 não é prova', async () => {
		// O CDN do Mercado Livre responde 200 com `image/gif` e o GIF cinza de
		// "imagem indisponível" para endereço de foto que não existe: quatro
		// ladrilhos da galeria dos runs gravados eram esse mesmo arquivo. Aqui a
		// PÁGINA abre e declara a `og:image` — e a conferência de bytes reprova.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return { items: [], total: 0 };
		});
		const CITADA = 'https://loja.com.br/produto/caneca-porcelana-325ml';
		chamadaFalsa
			.mockImplementationOnce(async () =>
				resposta({
					text: JSON.stringify({ produtos: [{ nome: 'Caneca', url: CITADA }] }),
					citations: [
						{ url: CITADA, title: 'Caneca', content: 'R$ 40,00 à vista' },
					],
				}),
			)
			.mockImplementationOnce(async () =>
				resposta({ text: '{"produtos":[]}' }),
			);
		paginasFalsas.mockImplementation(
			async () =>
				new Map([
					[
						CITADA,
						{ anuncio: true, foto: 'https://http2.mlstatic.com/x-O.gif' },
					],
				]),
		);
		// A conferência reprova o arquivo — é o único degrau entre a tag e a tela.
		fotosFalsas.mockImplementation(async () => new Set<string>());

		const out = (await aiResearchTeamBlock.run(
			ctxDeTeste(),
			params(),
		)) as Record<string, unknown>;

		expect(fotosFalsas.mock.calls[0]?.[0]).toEqual([
			'https://http2.mlstatic.com/x-O.gif',
		]);
		const radar = (out.agentes as { chave: string; json: unknown }[]).find(
			(a) => a.chave === 'radar_oportunidades',
		)?.json as { produtos: { imagem_url?: string }[] };
		expect(radar.produtos[0]?.imagem_url).toBeUndefined();
		const obs = out.observacoes as { imagem_url?: string }[];
		expect(obs[0]?.imagem_url).toBeUndefined();
	});

	it('A LISTA DO CURADOR NUNCA VEM DO CACHE, nem quando ele falha', async () => {
		// Havia um `?? doCacheJson('curadoria')` justificado por escrito com "o
		// Curador é `compartilhavel`" — e o roster diz `false` desde que se mediu
		// o estrago: a lista de um `mercado+rápido` de 2 voxxys seria servida a
		// todo `mercado+profundo` de 6 voxxys da mesma categoria por 7 dias.
		// Aqui o Curador FALHA e o cache TEM uma lista antiga: a seção tem que
		// sumir, não ressuscitar com cara de nova.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return {
				items: [
					linhaDeCache({
						agentes: [
							{
								chave: 'curadoria',
								texto: 'lista de outra execução',
								json: {
									produtos: [
										{ nome: 'Caneca do run barato', preco_venda_brl: 40 },
									],
								},
							},
						],
					}),
				],
				total: 1,
			};
		});
		chamadaFalsa.mockImplementation(async (o: { system: string }) => {
			void o;
			// O Curador é o único com `saida`: JSON cortado = falha explícita.
			throw new SearchError('resposta vazia', 'vazio');
		});
		// O radar entrega, o Curador não: o piso de sucesso (1, sem essenciais)
		// continua atendido e o dossiê sai — sem a seção.
		chamadaFalsa.mockImplementationOnce(async () => resposta({ text: 'ok' }));

		const out = (await aiResearchTeamBlock.run(
			ctxDeTeste(),
			params(),
		)) as Record<string, unknown>;

		expect(out.produtos_para_comecar).toEqual([]);
		expect(out.produtos_observacao).toBe('');
		// E o que veio do cache não some do dossiê: a invariante de saída igual
		// com cache quente ou frio continua valendo para quem É compartilhável.
		expect(out.cache_quente).toBe(true);
	});

	it('O CURADOR NÃO ENTRA NO CACHE — nem quando entrega bem', async () => {
		// A outra ponta da mesma regra: se a lista fosse gravada, a próxima
		// execução da categoria a acharia em `cobertos` e o Curador nasceria
		// "aproveitado" — um sintetizador que não roda e cuja lista veio de um
		// time diferente do que o aluno viu na tela.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return { items: [], total: 0 };
		});
		chamadaFalsa
			.mockImplementationOnce(async () =>
				resposta({ text: 'radar ok', citations: [CITACAO] }),
			)
			.mockImplementationOnce(async () =>
				resposta({
					text: '{"produtos":[{"nome":"Caneca personalizada","material":"Porcelana","preco_venda_brl":{"min":35,"max":55}}],"observacao":"não achei custo de insumo"}',
				}),
			);

		const out = (await aiResearchTeamBlock.run(
			ctxDeTeste(),
			params(),
		)) as Record<string, unknown>;

		expect((out.produtos_para_comecar as ProdutoOportunidade[])[0]?.nome).toBe(
			'Caneca personalizada',
		);
		expect(out.produtos_observacao).toBe('não achei custo de insumo');
		// Sem custo com fonte, a sobra fica não apurada — e o dossiê DIZ por quê.
		expect(
			(out.produtos_para_comecar as ProdutoOportunidade[])[0]?.margem_pct,
		).toBeNull();
		expect((out.avisos as string[]).join(' ')).toMatch(
			/custo do material com fonte/i,
		);
		// O que foi gravado no cache: o radar sim, o Curador não.
		expect(repoCreate).toHaveBeenCalledTimes(1);
		const gravado = repoCreate.mock.calls[0]?.[0] as {
			data: { payload: string };
		};
		const chaves = (
			JSON.parse(gravado.data.payload) as { agentes: { chave: string }[] }
		).agentes.map((a) => a.chave);
		expect(chaves).toContain('radar_oportunidades');
		expect(chaves).not.toContain('curadoria');
		// E a contagem de fontes vai junto: é ela que permite responder depois
		// "este bloco do cache tinha página por trás?".
		const gravados = (
			JSON.parse(gravado.data.payload) as {
				agentes: { chave: string; n_fontes?: number }[];
			}
		).agentes;
		expect(
			gravados.find((a) => a.chave === 'radar_oportunidades')?.n_fontes,
		).toBe(1);
	});

	it('PESQUISADOR SEM CITAÇÃO NÃO ENVELHECE NO CACHE', async () => {
		// O cache lavava número sem fonte em fato: um pesquisador que volta com
		// ZERO citações escreveu de memória (medido no Analista de Margem: "Chapa
		// de MDF Cru 3mm — R$ 79,90 — Leo Madeiras" com URL fabricada, 2 de 2).
		// Gravado, isso voltava por 7 dias com o selo de pesquisa reaproveitada —
		// o run que inventou mostrava âmbar, o seguinte mostrava número e link.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return { items: [], total: 0 };
		});
		chamadaFalsa
			.mockImplementationOnce(async () =>
				resposta({ text: 'inventei sem abrir página', citations: [] }),
			)
			.mockImplementationOnce(async () =>
				resposta({ text: '{"produtos":[]}' }),
			);

		await aiResearchTeamBlock.run(ctxDeTeste(), params());

		expect(repoCreate).not.toHaveBeenCalled();
		expect(repoUpdate).not.toHaveBeenCalled();
	});

	it('o bloco do cache leva a CONTAGEM DE FONTES de quando rodou', async () => {
		// A volta do cache dizia `n_fontes: 0` para todo mundo, e a tela precisou
		// tratar "veio do cache" como prova de apuração para não pintar de âmbar
		// um dossiê inteiro. Agora a contagem é a que foi gravada.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes') return { items: ROSTER, total: ROSTER.length };
			return {
				items: [
					linhaDeCache({
						agentes: [
							{
								chave: 'radar_oportunidades',
								texto: 'o que vende no ramo',
								json: { produtos: [] },
								n_fontes: 3,
							},
						],
					}),
				],
				total: 1,
			};
		});
		chamadaFalsa.mockImplementation(async () =>
			resposta({ text: '{"produtos":[]}' }),
		);

		const out = (await aiResearchTeamBlock.run(ctxDeTeste(), params())) as {
			agentes: { chave: string; n_fontes: number; do_cache: boolean }[];
		};

		const radar = out.agentes.find((a) => a.chave === 'radar_oportunidades');
		expect(radar?.do_cache).toBe(true);
		expect(radar?.n_fontes).toBe(3);
		// O radar é `compartilhavel`: com o cache cobrindo-o, ele nem roda —
		// quem foi chamado foi só o Curador.
		expect(chamadaFalsa).toHaveBeenCalledTimes(1);
	});
});

/* ═════════════ as TRÊS ondas, com a barreira e o digest de verdade ═════════════ */

describe('três ondas: a do meio pesquisa SABENDO o que a primeira achou', () => {
	beforeEach(() => {
		chamadaFalsa.mockReset();
		repoList.mockReset();
		repoUpdate.mockReset();
		repoCreate.mockReset();
		repoUpdate.mockResolvedValue({});
		repoCreate.mockResolvedValue({});
	});

	const ROSTER_3 = [
		entrada({
			chave: 'radar_oportunidades',
			nome: 'Pesquisador de Oportunidades',
			papel: 'p',
			pergunta: 'o que vende em {produto}?',
			motor_busca: 'perplexity',
			max_buscas: 1,
			escopo: 'mercado',
			modo: 'ambos',
			// O valor ANTIGO gravado no banco: tem que continuar sendo a onda 1.
			fase: 'pesquisa',
			ordem: 10,
		}),
		entrada({
			chave: 'custo_dos_produtos',
			nome: 'Analista de Custo dos Produtos',
			papel: 'p',
			pergunta: 'quanto custa a peça em branco?',
			saida: '{"insumos":[]}',
			motor_busca: 'perplexity',
			max_buscas: 1,
			escopo: 'ambos',
			modo: 'ambos',
			fase: 'aprofundamento',
			ordem: 45,
		}),
		entrada({
			chave: 'curadoria',
			nome: 'Curador de Oportunidades',
			papel: 'p',
			pergunta: 'por onde começar?',
			saida: '{"produtos":[]}',
			motor_busca: 'nenhum',
			escopo: 'mercado',
			modo: 'ambos',
			fase: 'sintese',
			ordem: 80,
		}),
	];

	const params = () =>
		aiResearchTeamBlock.paramsSchema.parse({
			tool: 'central_inteligencia',
			escopo: 'mercado',
			modo: 'profundo',
			vars: JSON.stringify({ produto: 'brindes', categoria_slug: 'brindes' }),
		});

	it('a onda 2 recebe o material da 1, e a 3 recebe o das duas', async () => {
		// A REGRESSÃO QUE ISTO TRANCA é a razão de a onda do meio existir: com
		// duas ondas, quem levantava o custo do insumo corria AO MESMO TEMPO que
		// o Radar. Medido: ele procurava insumo de copo térmico enquanto o Radar
		// achava acrílico e MDF, e todo card saía "não apurado" — com o custo
		// apurado, citado e inútil, porque era de outra coisa.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes')
				return { items: ROSTER_3, total: ROSTER_3.length };
			return { items: [], total: 0 };
		});
		// O material chega no SYSTEM para quem pesquisa e no USER para quem
		// sintetiza (ver a bissecção do `perplexity`): o que importa aqui é a onda
		// TER recebido, não em qual turno.
		const materiais: (string | undefined)[] = [];
		chamadaFalsa.mockImplementation(async (args) => {
			const tudo = `${args.system}\n${args.user}`;
			materiais.push(tudo.includes('MATERIAL DO TIME') ? tudo : undefined);
			return resposta({ text: '{"produtos":[{"nome":"Caneca de cerâmica"}]}' });
		});

		const eventos: BlockProgressEvent[] = [];
		await aiResearchTeamBlock.run(
			{
				customerId: 'aluno-1',
				toolDoc: {},
				onProgress: (e: BlockProgressEvent) => eventos.push(e),
			},
			params(),
		);

		/**
		 * QUATRO chamadas, não três: as três ondas mais a caça-foto.
		 *
		 * A caça-foto não é uma onda — é uma busca NOSSA, depois da síntese, com
		 * os nomes que o Curador escolheu, para a seção "Comece por estes
		 * produtos" ter imagem. Ela não recebe o material do time (não precisa: o
		 * trabalho dela é apontar para a página de venda daqueles nomes), e é por
		 * isso que ela não aparece em `materiais`.
		 */
		expect(chamadaFalsa).toHaveBeenCalledTimes(4);
		// Onda 1 sem material; ondas 2 e 3 com.
		expect(materiais[0]).toBeUndefined();
		expect(materiais[1]).toContain('Pesquisador de Oportunidades');
		// A onda 3 vê as DUAS anteriores — é o que faltava para o veredito falar
		// de concorrente, custo e reclamação.
		expect(materiais[2]).toContain('Pesquisador de Oportunidades');
		expect(materiais[2]).toContain('Analista de Custo dos Produtos');

		// O evento `onda` sai TRÊS vezes: o arranque e as DUAS viradas. É ele que
		// a sala de guerra usa para desenhar o cruzamento de dados, e o feixe só
		// pode ser desenhado onde existe dependência de verdade.
		const ondas = eventos.filter((e) => e.kind === 'onda');
		expect(ondas.map((o) => o.fase)).toEqual([
			'descoberta',
			'aprofundamento',
			'sintese',
		]);
		expect(ondas[0]?.de).toEqual([]);
		expect(ondas[1]?.de).toEqual(['radar_oportunidades']);
		expect(ondas[2]?.de).toEqual(['radar_oportunidades', 'custo_dos_produtos']);
		expect(ondas[1]?.para).toEqual(['custo_dos_produtos']);
	});

	it('O MATERIAL DO CACHE DISPUTA A MESMA COTA — não é concatenado no fim', async () => {
		// O defeito: o texto do cache era colado DEPOIS do digest e o conjunto
		// cortado no teto. Como o digest sozinho já usa o teto inteiro, o corte
		// caía 100% em cima do cache — num run com cache quente, o material
		// reaproveitado (a única coisa que o aluno paga menos para ter) não
		// chegava a ninguém. Aqui o Radar vem do cache e a onda 2 tem que vê-lo.
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes')
				return { items: ROSTER_3, total: ROSTER_3.length };
			return {
				items: [
					linhaDeCache({
						agentes: [
							{
								chave: 'radar_oportunidades',
								texto: 'campeões do ramo: caneca, tábua, chaveiro',
								json: { produtos: [] },
								n_fontes: 4,
							},
						],
					}),
				],
				total: 1,
			};
		});
		const materiais: string[] = [];
		chamadaFalsa.mockImplementation(async (args) => {
			const tudo = `${args.system}\n${args.user}`;
			if (tudo.includes('MATERIAL DO TIME')) materiais.push(tudo);
			return resposta({ text: '{"produtos":[]}' });
		});

		await aiResearchTeamBlock.run(
			{ customerId: 'aluno-1', toolDoc: {}, onProgress: () => {} },
			params(),
		);

		// O Radar é `compartilhavel` e o cache o cobre: ele nem roda, mas o que
		// ele achou tem que estar no material das ondas 2 e 3.
		expect(materiais).toHaveLength(2);
		for (const m of materiais) {
			expect(m).toContain('campeões do ramo');
			// Com o NOME do profissional, não com a chave crua: é o mesmo
			// cabeçalho de quem rodou agora, e a síntese cita pelo cargo.
			expect(m).toContain('Pesquisador de Oportunidades');
		}
	});

	it('O CUSTO DA ONDA 2 VIRA MARGEM — é o ganho principal da onda nova', async () => {
		// `custo_dos_produtos` procura o insumo DOS PRODUTOS QUE A ONDA 1 ACHOU.
		// Antes, a única fonte de custo era o `margem` da onda 1, que varria o
		// ramo em abstrato: o número existia, tinha página, e não casava com
		// produto nenhum (`falaDoMesmoInsumo`) — margem `nao_apurado` na célula
		// que decide a compra do material.
		const PAGINA = 'https://www.lojacaneca.com.br/caneca-ceramica-325ml';
		repoList.mockImplementation(async (_tool: string, colecao: string) => {
			if (colecao === 'agentes')
				return { items: ROSTER_3, total: ROSTER_3.length };
			return { items: [], total: 0 };
		});
		chamadaFalsa.mockImplementation(async (args) => {
			if (args.user.includes('quanto custa a peça em branco')) {
				return resposta({
					text: JSON.stringify({
						insumos: [
							{
								item: 'Caneca branca de cerâmica 325ml',
								unidade_compra: 'unidade',
								preco_brl: 8.5,
								url: PAGINA,
							},
						],
						custo_peca_brl: null,
					}),
					citations: [{ url: PAGINA, title: 'Caneca branca' }],
				});
			}
			if (args.user.includes('por onde começar')) {
				return resposta({
					text: JSON.stringify({
						produtos: [
							{
								nome: 'Caneca de cerâmica personalizada',
								material: 'Cerâmica',
								preco_venda_brl: { min: 35, max: 50 },
							},
						],
					}),
				});
			}
			return resposta({ text: '{"produtos":[]}' });
		});

		const out = (await aiResearchTeamBlock.run(
			{ customerId: 'aluno-1', toolDoc: {}, onProgress: () => {} },
			params(),
		)) as { produtos_para_comecar: ProdutoOportunidade[] };

		const caneca = out.produtos_para_comecar[0];
		expect(caneca?.custo_estimado_brl).toBe(8.5);
		expect(caneca?.custo_fonte_url).toBe(PAGINA);
		// (35 − 8,50) / 35 = 75,7%, calculado em TypeScript sobre o MENOR preço.
		expect(caneca?.margem_pct).toBeCloseTo(75.7, 1);
	});
});

/* ──────────── o material que uma onda entrega à seguinte ──────────── */

describe('o digest REPARTE o teto — cortar no fim apagava a onda 2 inteira', () => {
	it('17 especialistas longos cabem TODOS, em vez de os 4 primeiros', () => {
		// A REGRESSÃO: com 6 pesquisadores o corte no fim nunca mordia. Com 17, o
		// digest passa de 100 mil caracteres e um `slice(0, 28_000)` deixa os
		// quatro primeiros inteiros e apaga TREZE — inclusive a onda 2 inteira,
		// que é justamente quem investigou concorrente, portfólio, reclamação e
		// custo. O Estrategista escreveria o veredito sem ter visto nada disso, e
		// nada quebraria: o dossiê sairia bonito e vazio.
		const cotas = repartirChars(new Array(17).fill(6_000), 28_000);
		expect(cotas).toHaveLength(17);
		expect(cotas.every((c) => c > 1_000)).toBe(true);
		expect(cotas.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(28_000);
	});

	it('quem escreveu pouco DEVOLVE a sobra em vez de reservá-la', () => {
		// Enchimento por nível: o de 100 leva 100 e os 900 que sobraram da parte
		// dele engordam os outros dois. Uma divisão igual daria 500/100/500 e
		// jogaria 400 caracteres fora.
		expect(repartirChars([100, 5_000, 5_000], 1_500)).toEqual([100, 700, 700]);
		// Ninguém recebe mais do que escreveu.
		expect(repartirChars([10, 20], 1_000)).toEqual([10, 20]);
		expect(repartirChars([], 100)).toEqual([]);
		expect(repartirChars([500], 0)).toEqual([0]);
	});
});

/* ──────────── duas fontes de custo, uma lista sem duplicata ──────────── */

describe('fundirCustos — somar as duas listas seria uma regressão', () => {
	const daOnda2 = {
		item: 'Caneca branca de cerâmica 325ml',
		brl: 8.5,
		url: 'https://a.com.br/caneca-onda2',
	};
	const daOnda1 = {
		item: 'Caneca de cerâmica lisa',
		brl: 9.2,
		url: 'https://b.com.br/caneca-onda1',
	};
	const outro = {
		item: 'Chapa de acrílico 3mm',
		brl: 62,
		url: 'https://c.com.br/acrilico',
	};

	it('o mesmo insumo em duas fontes vira UM candidato — o da onda 2', () => {
		// Sem fundir, os dois casariam com "Caneca de cerâmica personalizada" e
		// `custoDoProduto` recusaria o AMBÍGUO: acrescentar uma fonte de custo
		// apagaria a margem exatamente dos produtos que agora têm custo apurado
		// duas vezes. Duplicata não é ambiguidade.
		const fundido = fundirCustos([[daOnda2], [daOnda1, outro]]);
		expect(fundido.map((c) => c.url)).toEqual([daOnda2.url, outro.url]);
	});

	it('insumo DIFERENTE continua entrando — e a ambiguidade real continua sendo recusada', () => {
		const inox = {
			item: 'Caneca térmica de inox 500ml',
			brl: 28,
			url: 'https://d.com.br/inox',
		};
		// Cerâmica e inox são famílias que se excluem: não são a mesma coisa.
		expect(fundirCustos([[daOnda2], [inox]])).toHaveLength(2);
		// Dentro da MESMA lista nada é fundido: ali a repetição é do próprio
		// especialista e a regra do ambíguo continua valendo.
		expect(fundirCustos([[daOnda2, daOnda1]])).toHaveLength(2);
		// URL igual é a mesma página, mesmo com o item escrito de outro jeito.
		expect(
			fundirCustos([[daOnda2], [{ ...daOnda2, item: 'Caneca 325 ml' }]]),
		).toHaveLength(1);
	});
});

/* ──────────── custo por peça vindo de lote com contagem na página ──────────── */

describe('custosDeInsumos — a divisão é nossa, e só quando a página conta', () => {
	const CITADA = 'https://www.mecolor.com.br/caneca-branca-caixa-36';
	const urls = conjuntoDeUrls([CITADA]);

	it('CAIXA COM 36 UNIDADES: divide, porque o 36 está escrito na página', () => {
		// O caso REAL que fez a seção "Comece por estes produtos" sair vazia:
		// o Analista obedeceu ao papel (não dividiu) e devolveu só o preço do lote.
		const c = custosDeInsumos(
			{
				custo_peca_brl: null,
				insumos: [
					{
						item: 'Caneca de Cerâmica Branca 325ml',
						unidade_compra: 'Caixa com 36 unidades',
						preco_brl: 287.64,
						rende_pecas: 36,
						url: CITADA,
					},
				],
			},
			urls,
		);
		expect(c).toHaveLength(1);
		expect(c[0]?.brl).toBeCloseTo(7.99, 2);
		expect(c[0]?.url).toBe(CITADA);
	});

	it('CHAPA QUE RENDE ~20 PEÇAS: recusa, porque o 20 é estimativa do modelo', () => {
		const c = custosDeInsumos(
			{
				insumos: [
					{
						item: 'Chapa de MDF Cru 3mm 2,75x1,85m',
						unidade_compra: 'Chapa 2,75 x 1,85 m',
						preco_brl: 79.9,
						rende_pecas: 20,
						url: CITADA,
					},
				],
			},
			urls,
		);
		expect(c).toEqual([]);
	});

	it('página NÃO citada não vira custo, mesmo com a contagem declarada', () => {
		const c = custosDeInsumos(
			{
				insumos: [
					{
						item: 'Caneca',
						unidade_compra: 'Caixa com 12 unidades',
						preco_brl: 120,
						rende_pecas: 12,
						url: 'https://inventado.example/caneca',
					},
				],
			},
			urls,
		);
		expect(c).toEqual([]);
	});

	it('peça avulsa continua entrando pelo caminho direto', () => {
		const c = custosDeInsumos(
			{
				insumos: [
					{
						item: 'Caixa de papelão 10x10',
						unidade_compra: 'Unidade',
						preco_brl: 1.2,
						url: CITADA,
					},
				],
			},
			urls,
		);
		expect(c[0]?.brl).toBe(1.2);
	});
});

describe('normalizarProdutos — custo derivado do lote chega ao produto certo', () => {
	const CITADA = 'https://www.mecolor.com.br/caneca-branca-caixa-36';
	const candidatos = [
		{ item: 'Caneca de Cerâmica Branca 325ml', brl: 7.99, url: CITADA },
	];

	it('produto de caneca ganha margem calculada; troféu de acrílico não', () => {
		const out = normalizarProdutos(
			{
				produtos: [
					{
						nome: 'Caneca personalizada gravada a laser',
						material: 'cerâmica',
						preco_venda_brl: { min: 35, max: 55 },
						margem_faixa: 'alta',
						concorrencia: 'media',
					},
					{
						nome: 'Troféu em acrílico',
						material: 'acrílico',
						preco_venda_brl: { min: 60, max: 90 },
						margem_faixa: 'alta',
						concorrencia: 'baixa',
					},
				],
			},
			{ custosDeInsumos: candidatos, urlsCitadas: conjuntoDeUrls([CITADA]) },
		);
		const caneca = out.find((p) => p.nome.includes('Caneca'));
		const trofeu = out.find((p) => p.nome.includes('Troféu'));
		expect(caneca?.margem_pct).not.toBeNull();
		expect(caneca?.custo_fonte_url).toBe(CITADA);
		// O custo da caneca NÃO pode virar a margem do troféu — é o defeito que
		// `falaDoMesmoInsumo` existe para barrar.
		expect(trofeu?.margem_pct).toBeNull();
		expect(trofeu?.margem_faixa).toBe('nao_apurado');
	});
});

describe('interpolar — variável vazia não vira chave literal na busca', () => {
	it('some com a preposição junto', () => {
		expect(
			interpolar('Quanto custa a matéria-prima para {produto} em {material}?', {
				produto: 'Brinde corporativo',
			}),
		).toBe('Quanto custa a matéria-prima para Brinde corporativo?');
	});

	it('com valor, interpola normalmente', () => {
		expect(
			interpolar('Preço de {produto} em {material}', {
				produto: 'placa PIX',
				material: 'MDF',
			}),
		).toBe('Preço de placa PIX em MDF');
	});
});

describe('soVendidosNaPagina — o número tem que estar no que o time leu', () => {
	const fontes = [
		{
			url: 'https://loja.com.br/produto/caneca',
			content: 'Caneca personalizada · +5.000 vendidos · 1.248 avaliações',
		},
		{ url: 'https://loja.com.br/produto/tabua', content: 'Tábua de churrasco' },
	];

	it('MANTÉM o número que aparece no trecho da página', () => {
		const j = {
			produtos: [
				{
					nome: 'Caneca',
					url: 'https://loja.com.br/produto/caneca',
					vendidos: 5000,
					avaliacoes: 1248,
				},
			],
		};
		expect(soVendidosNaPagina(j, fontes)).toBe(0);
		expect(j.produtos[0]?.vendidos).toBe(5000);
		expect(j.produtos[0]?.avaliacoes).toBe(1248);
	});

	it('APAGA o número que a página não tem — mesmo com a página citada', () => {
		// O caso real: a página é de verdade, o número é do modelo. Ter o link
		// certo faz o palpite parecer apurado, que é o pior modo de errar.
		const j = {
			produtos: [
				{
					nome: 'Tábua',
					url: 'https://loja.com.br/produto/tabua',
					vendidos: 3400,
				},
			],
		};
		expect(soVendidosNaPagina(j, fontes)).toBe(1);
		expect(j.produtos[0]?.vendidos).toBeNull();
	});

	it('APAGA quando não há página nenhuma', () => {
		const j = { produtos: [{ nome: 'X', url: '', vendidos: 900 }] };
		soVendidosNaPagina(j, fontes);
		expect(j.produtos[0]?.vendidos).toBeNull();
	});

	it('o ITEM sobrevive — some o número, não o produto', () => {
		const j = { produtos: [{ nome: 'Tábua', url: '', vendidos: 12 }] };
		soVendidosNaPagina(j, fontes);
		expect(j.produtos[0]?.nome).toBe('Tábua');
	});

	it('"+5.000" na página casa com 5000 no json (só os dígitos)', () => {
		const j = {
			itens: [
				{
					url: 'https://loja.com.br/produto/caneca',
					unidades_vendidas: '5000',
				},
			],
		};
		expect(soVendidosNaPagina(j, fontes)).toBe(0);
	});
});

describe('a pesquisa aproveitada mostra AS FONTES, não só a contagem', () => {
	it('o cache guarda as páginas de cada especialista, não um número solto', () => {
		// O pedido do dono do produto: "uma pesquisa que já tinha sido feita e
		// aproveitada, temos que apontar as fontes que temos ali da mesma
		// maneira". Contagem sozinha é "confie"; a lista é conferível.
		const payload = {
			agentes: [
				{
					chave: 'radar_oportunidades',
					n_fontes: 2,
					fontes: [
						{ url: 'https://loja.com.br/a', title: 'A' },
						{ url: 'https://loja.com.br/b', title: 'B' },
					],
				},
			],
		};
		const c = payload.agentes[0];
		expect(c?.fontes).toHaveLength(c?.n_fontes ?? 0);
		for (const f of c?.fontes ?? []) expect(f.url).toMatch(/^https?:\/\//);
	});

	it('linha ANTIGA (só contagem) não vira zero na tela', () => {
		// Cache gravado antes do campo `fontes` existir: o cartão mostra o número
		// que ele tem e o feed não ganha entrada. Some sozinho em 7 dias.
		const antiga = { chave: 'demanda', n_fontes: 5 } as {
			chave: string;
			n_fontes: number;
			fontes?: { url: string }[];
		};
		const lista = Array.isArray(antiga.fontes) ? antiga.fontes : [];
		const paraOCartao =
			lista.length === 0 && antiga.n_fontes > 0
				? antiga.n_fontes
				: lista.length;
		expect(paraOCartao).toBe(5);
	});
});
