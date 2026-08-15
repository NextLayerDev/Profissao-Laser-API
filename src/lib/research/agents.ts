import {
	bool,
	type FaseAgente,
	montarTimeBase,
	normalizarFase,
	num,
	str,
	type TimeMontado as TimeMontadoBase,
} from '../agent-team/core.js';
import { parseDominios, type SearchEngine } from './search.js';

/**
 * O TIME, lido da coleção `agentes`.
 *
 * Cada agente é um REGISTRO — `data` é jsonb plano e não tem lista de objetos,
 * então não caberia o time inteiro num registro só. O ganho de ler isso como
 * dado é grande: trocar o modelo de um agente, afrouxar o número de buscas ou
 * desligar um agente que está trazendo lixo é edição de tela, sem deploy. É a
 * diferença entre um time de agentes configurável e um time chumbado no código.
 *
 * ARMADILHA JÁ CONFIRMADA: `collection.query` NÃO consegue ler esta coleção.
 * O bloco lê deliberadamente como `isStaff:false` e o repositório aplica
 * `.neq('visibility','staff')` para não-staff — que é justamente o que protege
 * os system prompts. Quem lê o time tem que ir pelo repositório, como
 * `quote.price` já faz com os perfis de preço.
 *
 * Módulo puro: só normalização, nenhum I/O.
 */

export type ModoRun = 'rapido' | 'profundo';

/**
 * O QUE está sendo pesquisado.
 *
 * `produto` — "tenho esta peça, vale a pena?" → preço, custo, concorrência dela.
 * `mercado` — "quero vender neste ramo, o que faço?" → o que está vendendo,
 *             em qual marketplace, e quais ideias valem a pena começar.
 *
 * São perguntas diferentes e exigem especialistas diferentes: quem caça o preço
 * de UMA peça não é quem descobre O QUE vender num ramo inteiro.
 */
export type EscopoRun = 'produto' | 'mercado';

/**
 * AS ONDAS, O PISO E O TEMPLATE MORAM NO NÚCLEO COMPARTILHADO.
 *
 * `lib/agent-team/core.ts` é o recorte do que vale para qualquer time de
 * agentes — a Central foi o primeiro, o Ateliê é o segundo. O código saiu
 * daqui VERBATIM; o que ficou neste arquivo é a POLÍTICA da Central (quais
 * campos o roster de pesquisa tem, quantos profissionais o aluno vê, o que o
 * cache de 7 dias cobre).
 *
 * Continuam sendo reexportados por aqui porque é daqui que o bloco, o seed e os
 * testes sempre os importaram — e um rename de caminho não é motivo para mexer
 * em três arquivos que estão certos.
 */
export {
	type FaseAgente,
	interpolar,
	normalizarFase,
	ORDEM_DAS_ONDAS,
	pisoDeSucesso,
} from '../agent-team/core.js';

export interface AgentSpec {
	chave: string;
	nome: string;
	papel: string;
	pergunta: string;
	saida: string;
	modelo?: string;
	motorBusca: SearchEngine | 'nenhum';
	maxBuscas: number;
	dominiosIncluir: string[];
	dominiosExcluir: string[];
	/**
	 * O filtro de tema vale para este especialista?
	 *
	 * O filtro descarta resultado de busca que não contenha nenhuma palavra-chave
	 * da categoria — foi ele que barrou "cooler de PC" numa busca por placa de
	 * PIX. Mas alguns especialistas procuram DE PROPÓSITO algo que não é o
	 * produto: comissão de marketplace, regra de canal, tendência de mercado.
	 * Filtrar esses pelas palavras do produto joga fora exatamente o que eles
	 * acharam — o Especialista em Marketplaces vinha com 0 fontes por causa disso.
	 *
	 * Ausente = filtra (o padrão seguro, que é o que a maioria precisa).
	 */
	filtrarPorTema: boolean;
	modo: ModoRun | 'ambos';
	/** Em que tipo de pergunta este especialista entra. */
	escopo: EscopoRun | 'ambos';
	/** Entra no cache de 7 dias (é retrato do mercado, não do aluno). */
	compartilhavel: boolean;
	/** Se falhar, o run não é cobrado. */
	essencial: boolean;
	temperatura: number;
	maxTokens: number;
	timeoutS: number;
	icone: string;
	cor: string;
	fraseTrabalhando: string;
	ordem: number;
	/** Desligado pelo admin — some do time sem ser apagado. */
	ativo: boolean;
	/**
	 * Em que ONDA o agente roda. Ver `FaseAgente`.
	 *
	 * Existe porque a forma do time é `identificar → paralelo → REDUZIR`, e não
	 * um fan-out plano. Sem as ondas, o Estrategista roda ao mesmo tempo que os
	 * pesquisadores e responde "não foi fornecido material" — foi exatamente o
	 * que aconteceu no primeiro run completo de teste.
	 */
	fase: FaseAgente;
}

const PADRAO = {
	temperatura: 0.2,
	maxTokens: 1200,
	timeoutS: 60,
	maxBuscas: 1,
	icone: 'search',
	cor: '#f59e0b',
} as const;

/**
 * TETO DE CÓDIGO DO `max_tokens` — o que o admin pode pedir pela Fábrica.
 *
 * ┌─ POR QUE 4.000 NÃO SERVIA MAIS, E POR QUE ISTO É TETO DE CÓDIGO ─────────┐
 * │ MEDIDO em runs frios de `mercado+profundo`: a chamada do Estrategista     │
 * │ fechava com saída = 4.000 tokens EXATOS — ou seja, no teto — e o JSON     │
 * │ vinha cortado no meio. Ele é `essencial`: JSON quebrado derruba o run     │
 * │ inteiro (502 + estorno) depois de os US$ 0,34 já terem saído. A causa é   │
 * │ conhecida e é desta rodada: a onda 3 passou a receber o digest de DUAS    │
 * │ ondas (17 especialistas, ~28 mil caracteres), e quem lê mais tem mais o   │
 * │ que dizer — o teto de saída ficou onde estava quando ele lia 6.           │
 * │                                                                          │
 * │ O 4.000 era teto DE CÓDIGO: nenhuma edição na tela de coleção conseguia   │
 * │ passar dele, e o time é DADO. Um valor de roster que o motor apertava em  │
 * │ silêncio é a pior forma dessa regra ser violada — o admin salva 6.000,    │
 * │ a tela mostra 6.000 e o motor manda 4.000.                                │
 * │                                                                          │
 * │ A CONTA DO 9.000 é o relógio, não o gosto — e é a segunda versão dela,    │
 * │ porque a primeira estava ancorada num deadline que não existe mais.       │
 * │                                                                          │
 * │   ERRADO (o que estava escrito aqui): 8.000 × 8 ms + 3 s = 67 s contra    │
 * │   "95 s de deadline do rápido". `LIMITES_PADRAO.rapido.deadlineMs` é      │
 * │   120_000 (budget.ts) — subiu nesta mesma feature, e este comentário      │
 * │   ficou justificando o teto com o número velho.                           │
 * │                                                                          │
 * │   CERTO: 8 ms/token é o MELHOR caso, e ele existe para responder "vale a  │
 * │   tentativa?" em `cabeNoTempo` — não "a chamada termina?". Quem responde  │
 * │   a segunda é o ritmo REAL: o Estrategista (Sonnet, o único que chega     │
 * │   perto do teto) mediu 11,8 · 12,4 · 12,8 · 13,1 ms por token de saída em │
 * │   4 runs frios. Com a mediana de 12,8: (120.000 − 3.000 de abertura) /    │
 * │   12,8 = 9.140 tokens ⇒ 9.000.                                            │
 * │                                                                          │
 * │ Ou seja: refazer a conta com o deadline certo NÃO liberou os ~14.600 que  │
 * │ os 8 ms sugeririam. Liberou 1.000 tokens, e por medição. Acima de 9.000 o │
 * │ teto autorizaria uma resposta que não cabe no relógio do modo mais curto  │
 * │ — e ser cortado por TIMEOUT é pior que ser cortado por `max_tokens`:      │
 * │ timeout não é retriável e, no essencial, vira 502 + estorno.              │
 * │                                                                          │
 * │ O dinheiro continua sendo freado por quem freia dinheiro: `estimarCusto-  │
 * │ Usd` projeta o PIOR CASO com este mesmo número, então subir o teto de um  │
 * │ especialista aparece no `podeGastar` antes de a chamada sair.             │
 * │                                                                          │
 * │ MEXEU AQUI? O campo `max_tokens` da coleção `agentes` (definition da      │
 * │ upvox, scripts/seed-central-inteligencia.ts) tem o MESMO teto, e é ele    │
 * │ que recusa o seed com HTTP 400. Os dois andam juntos.                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export const MAX_TOKENS_TETO = 9_000;

/** Registro da coleção → spec normalizada. Devolve `null` se estiver inutilizável. */
export function toAgentSpec(entry: {
	title: string;
	data: Record<string, unknown>;
}): AgentSpec | null {
	const d = entry.data ?? {};
	const chave = str(d.chave);
	const papel = str(d.papel);
	const pergunta = str(d.pergunta);
	// Sem chave, papel ou pergunta o agente não tem o que fazer — melhor sumir
	// da lista do que rodar e devolver ruído.
	if (!chave || !papel || !pergunta) return null;

	const motorRaw = str(d.motor_busca, 'nenhum');
	const motorBusca: SearchEngine | 'nenhum' =
		motorRaw === 'exa' || motorRaw === 'perplexity' ? motorRaw : 'nenhum';

	const modoRaw = str(d.modo, 'ambos');
	const modo: ModoRun | 'ambos' =
		modoRaw === 'rapido' || modoRaw === 'profundo' ? modoRaw : 'ambos';

	return {
		chave,
		nome: entry.title || chave,
		papel,
		pergunta,
		saida: str(d.saida),
		modelo: str(d.modelo) || undefined,
		motorBusca,
		maxBuscas:
			motorBusca === 'nenhum'
				? 0
				: Math.max(0, Math.min(6, num(d.max_buscas, PADRAO.maxBuscas))),
		dominiosIncluir: parseDominios(d.dominios_incluir),
		dominiosExcluir: parseDominios(d.dominios_excluir),
		modo,
		filtrarPorTema: d.filtrar_por_tema !== false,
		escopo:
			str(d.escopo) === 'produto'
				? 'produto'
				: str(d.escopo) === 'mercado'
					? 'mercado'
					: 'ambos',
		compartilhavel: bool(d.compartilhavel),
		essencial: bool(d.essencial),
		temperatura: Math.max(
			0,
			Math.min(2, num(d.temperatura, PADRAO.temperatura)),
		),
		maxTokens: Math.max(
			200,
			Math.min(MAX_TOKENS_TETO, num(d.max_tokens, PADRAO.maxTokens)),
		),
		timeoutS: Math.max(10, Math.min(120, num(d.timeout_s, PADRAO.timeoutS))),
		icone: str(d.icone, PADRAO.icone),
		cor: str(d.cor, PADRAO.cor),
		fraseTrabalhando: str(d.frase_trabalhando, 'Pesquisando…'),
		ordem: num(d.ordem, 999),
		// Ausente = ativo. Só `false` explícito desliga: um campo que ninguém
		// preencheu não pode apagar o time inteiro.
		ativo: d.ativo !== false,
		fase: normalizarFase(d.fase),
	};
}

export interface SelecaoOpts {
	modo: ModoRun;
	escopo: EscopoRun;
	/**
	 * Chaves que o cache JÁ cobre. Só estas são puladas.
	 *
	 * É `Set` e não booleano por um motivo medido: uma execução RÁPIDA cobre
	 * dois agentes compartilháveis, e um booleano faria a PROFUNDA seguinte
	 * pular também concorrência, canais e nichos — que nunca rodaram.
	 */
	jaCobertos?: Set<string>;
	/** Cache-miss parcial: só os compartilháveis, para regravar a pesquisa. */
	somenteCompartilhaveis?: boolean;
	/**
	 * Limite DURO de segurança do bloco — não é a política.
	 *
	 * A política de quantos profissionais o aluno vê é `TETO_POR_MODO`. Este
	 * teto existe só para o caso de alguém semear 40 registros na coleção:
	 * `agentes` é dado editável por tela, e nada impede um roster absurdo.
	 */
	teto?: number;
}

/**
 * QUANTOS PROFISSIONAIS O ALUNO VÊ TRABALHANDO.
 *
 * Não é número de engenharia: é promessa de tela. Rápido mostra cinco, Profundo
 * mostra VINTE E DOIS, nos DOIS escopos — e o contador do topo conta sobre esse
 * total. Mudar aqui muda o que o aluno viu ser prometido, então mude junto com
 * a tela.
 *
 * O 22 do profundo é pedido do dono do produto, com estas palavras: "queria que
 * o modo completo lançasse mais agentes… cobre mais boxes… pode demorar mais
 * tempo, não tem importância". O 5 do rápido NÃO mudou de propósito: o
 * resultado dele foi aprovado como está, e mexer ali seria trocar uma coisa que
 * funciona por uma que ninguém pediu.
 */
export const TETO_POR_MODO: Record<ModoRun, number> = {
	rapido: 5,
	profundo: 22,
};

/**
 * Fallback do limite duro quando o chamador não passa nenhum.
 *
 * 26 = os 22 do profundo mais quatro protegidos de folga. Ver `MAX_AGENTES` no
 * bloco: é freio contra roster mal semeado, não política.
 */
const LIMITE_DURO_PADRAO = 26;

/**
 * O time desta execução, já com a política de 5/22 aplicada.
 *
 * A forma é do núcleo (`TimeMontado<A>`); aqui ela é fixada em `AgentSpec` para
 * quem já importava o nome.
 */
export type TimeMontado = TimeMontadoBase<AgentSpec>;

/**
 * Monta o time e diz quem trabalha agora e quem já veio do cache.
 *
 * A ORDEM IMPORTA e é diferente da versão anterior: o teto é aplicado ao time
 * INTEIRO (ignorando cache) e só DEPOIS o cache separa quem roda. Antes o cache
 * era filtrado primeiro e liberava vaga para outros — o time mudava de tamanho
 * conforme a idade do cache, e era isso que fazia a tela encolher.
 *
 * `compartilhavel` é o campo que sustenta o cache de 7 dias na coleção: sem ele,
 * o cache exigiria hardcodar nomes de agente dentro do bloco — o oposto de
 * "agente é dado".
 */
export function montarTime(todos: AgentSpec[], opts: SelecaoOpts): TimeMontado {
	const elegiveis = todos
		.filter((a) => a.ativo)
		.filter((a) => a.modo === 'ambos' || a.modo === opts.modo)
		.filter((a) => a.escopo === 'ambos' || a.escopo === opts.escopo)
		.filter((a) => !(opts.somenteCompartilhaveis && !a.compartilhavel))
		.sort((a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave));

	/**
	 * A política corta as ONDAS DE PESQUISA (descoberta e aprofundamento), por
	 * ordem crescente, e nunca toca em quem é `protegido`. Consequência
	 * assumida: um roster com mais protegidos que o teto entrega um time MAIOR
	 * que 5/22. É melhor que a alternativa — um dossiê sem veredito, ou um run
	 * que falha no piso por ter cortado justamente quem não podia faltar.
	 *
	 * Quem aplica a política, o limite duro e a ordem de sacrifício é o núcleo
	 * (`montarTimeBase`): é regra de time, não de pesquisa. O que sobra aqui —
	 * e é o que a Central tem de próprio — são os filtros de modo/escopo e o
	 * cache de 7 dias.
	 */
	// O `??` cobre chamador em JavaScript puro passando um modo fora do enum:
	// sem ele a aritmética abaixo vira NaN e o time sai VAZIO — falha muda, que
	// é a pior espécie neste arquivo.
	const politica = TETO_POR_MODO[opts.modo] ?? TETO_POR_MODO.profundo;

	return montarTimeBase(elegiveis, {
		politica,
		limiteDuro: opts.teto ?? LIMITE_DURO_PADRAO,
		// `compartilhavel` é o campo que sustenta o cache: só ele pode ser
		// aproveitado, e só se o cache de fato cobriu AQUELA chave.
		aproveitar: (a) =>
			a.compartilhavel && Boolean(opts.jaCobertos?.has(a.chave)),
	});
}

/**
 * Quem roda nesta execução (o time menos o que o cache já cobre).
 *
 * Atalho para `montarTime().paraRodar` — quem precisa mostrar o time inteiro na
 * tela tem que chamar `montarTime`, senão o cache volta a encolher a tela.
 */
export function selecionarAgentes(
	todos: AgentSpec[],
	opts: SelecaoOpts,
): AgentSpec[] {
	return montarTime(todos, opts).paraRodar;
}
