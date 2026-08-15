import type { BudgetLimits } from '../agent-team/budget.js';
import {
	bool,
	type FaseAgente,
	montarTimeBase,
	normalizarFase,
	num,
	str,
	type TimeMontado as TimeMontadoBase,
} from '../agent-team/core.js';
import { TOKENS_POR_IMAGEM } from '../agent-team/imagem.js';
import { parseDominios, type SearchEngine } from '../agent-team/llm.js';

/**
 * O TIME DO ATELIÊ, lido da coleção `agentes` de `estudio_imagens`.
 *
 * Seis profissionais em três ondas, e o que eles produzem é O PROMPT DA ARTE —
 * não a arte. Quem gera a imagem é o nó seguinte do pipeline
 * (`ai.image_studio`), com o modelo, o formato e o custo que a definition
 * mandar. Ver o cabeçalho do bloco `ai.art_team`.
 *
 * ┌─ O QUE ESTE ARQUIVO TEM QUE A CENTRAL NÃO TINHA ────────────────────────┐
 * │ `entrada`. Na Central todo especialista recebe as MESMAS variáveis de    │
 * │ texto; aqui um olha a foto do produto, outro olha os anúncios que o      │
 * │ aluno subiu e três não olham nada. Sem um campo declarando isso, "quem   │
 * │ olha a foto" viraria um `if` chumbado com o nome do agente dentro do     │
 * │ bloco — e o time deixaria de ser dado no exato ponto que mais custa      │
 * │ dinheiro (foto é ~1.500 tokens de entrada por chamada).                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ E O QUE ELE NÃO TEM, DE PROPÓSITO ─────────────────────────────────────┐
 * │ `escopo` e `modo` — a Central pergunta duas coisas diferentes (produto / │
 * │ mercado) em duas profundidades (5 / 22 profissionais). O Ateliê pergunta │
 * │ UMA coisa e o time é sempre o mesmo; o que muda é quantas PEÇAS saem, e  │
 * │ isso é multiplicador de cobrança, não tamanho de time.                   │
 * │                                                                          │
 * │ `compartilhavel` — não existe cache. O trabalho aqui é sobre a foto DESTE │
 * │ aluno e a marca DELE; não há nada que sirva ao run do vizinho, e um      │
 * │ campo de cache num time sem cache é convite a alguém ligá-lo.            │
 * │                                                                          │
 * │ `filtrar_por_tema` — é peneira de resultado de BUSCA, e a busca aqui     │
 * │ nasce desligada (ver `motorBusca`).                                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Módulo puro: só normalização, nenhum I/O.
 */

/**
 * O QUE ESTE ESPECIALISTA RECEBE ALÉM DE TEXTO.
 *
 * `nenhuma`      — só o briefing e o material das ondas anteriores. É o padrão,
 *                  e é o caso de quatro dos seis.
 * `foto_produto` — a foto que o aluno subiu do produto dele.
 * `referencias`  — os anúncios de referência que ele subiu ("um anúncio que
 *                  você gostou"). Podem ser vários na MESMA chamada: comparar
 *                  duas composições é o trabalho, e mandá-las em chamadas
 *                  separadas custaria o dobro para entregar menos.
 *
 * Valor desconhecido cai em `nenhuma` — o padrão mais barato e o único que
 * nunca falha por falta de arquivo.
 */
export type EntradaAgente = 'nenhuma' | 'foto_produto' | 'referencias';

export function normalizarEntrada(v: unknown): EntradaAgente {
	const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
	if (s === 'foto_produto') return 'foto_produto';
	if (s === 'referencias') return 'referencias';
	return 'nenhuma';
}

/**
 * EM QUAL DOS CAMINHOS ELE ENTRA.
 *
 * São três na tela ("post para redes", "anúncio de marketplace", "foto do
 * produto em cena") e hoje TODO o time é `todas` — o gating existe para o dia
 * em que um caminho pedir um especialista que os outros não querem.
 *
 * ┌─ ERAM QUATRO ──────────────────────────────────────────────────────────┐
 * │ "Arte para gravar" saiu por decisão de produto, e este vocabulário saiu │
 * │ junto: um valor aqui que a definition não oferece é convite para um     │
 * │ especialista ser cadastrado num caminho que não existe e nunca rodar —  │
 * │ pago no orçamento, ausente na mesa. A lista tem que espelhar            │
 * │ `ENTREGAS` da definition (`api-upvox/scripts/seed-estudio-imagens.ts`). │
 * │ Converter a arte pronta em traço de corte continua existindo, como      │
 * │ AJUSTE sobre o resultado — e ajuste não passa por este gating.          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Valor desconhecido vira `todas`, e a escolha é deliberada: um erro de
 * digitação neste campo tem que deixar o especialista TRABALHANDO. O contrário
 * — sumir do time por causa de uma letra — é a falha muda que ninguém
 * diagnostica, porque a tela só mostra um profissional a menos. É também o que
 * torna a saída de um caminho segura: quem estivesse preso a `gravar` volta a
 * trabalhar em todos, em vez de desaparecer.
 */
export type EntregaAgente = 'todas' | 'post' | 'anuncio' | 'cena';

const ENTREGAS: readonly EntregaAgente[] = ['todas', 'post', 'anuncio', 'cena'];

export function normalizarEntrega(v: unknown): EntregaAgente {
	const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
	return (ENTREGAS.find((e) => e === s) ?? 'todas') as EntregaAgente;
}

export interface ArtAgentSpec {
	chave: string;
	nome: string;
	papel: string;
	pergunta: string;
	saida: string;
	modelo?: string;
	/** Ver `EntradaAgente`. É o campo que este time tem a mais. */
	entrada: EntradaAgente;
	/** Ver `EntregaAgente`. `todas` = entra em qualquer caminho. */
	entrega: EntregaAgente;
	/**
	 * A BUSCA WEB NASCE DESLIGADA, e o caminho fica pronto.
	 *
	 * O time trabalha com o que o aluno deu: a foto, os anúncios que ele
	 * escolheu e a marca que ele cadastrou. "Olhar o que o mercado está fazendo"
	 * é um BOTÃO que a tela vai oferecer (F3) — e enquanto o botão não existe, o
	 * bloco ignora este campo (ver o parâmetro `busca`). Deixar o campo lido e
	 * desligado é o que faz o botão custar uma linha em vez de uma rodada.
	 */
	motorBusca: SearchEngine | 'nenhum';
	maxBuscas: number;
	dominiosIncluir: string[];
	dominiosExcluir: string[];
	/** Se falhar, o run não é cobrado. */
	essencial: boolean;
	temperatura: number;
	maxTokens: number;
	/**
	 * QUANTO O MODELO PODE PENSAR ANTES DE ESCREVER — e é campo de sobrevivência,
	 * não de afinação.
	 *
	 * Modelo que raciocina cobra o raciocínio COMO SAÍDA e o gasta antes da
	 * primeira chave do JSON. Medido no `prompt_final` (Sonnet, teto 4.000): com
	 * raciocínio ele pedia 4.579–7.040 tokens e TRUNCAVA em 3 de 3 — o run morria
	 * e o aluno via "A arte não saiu desta vez". Desligado, 1.740–1.787 tokens,
	 * metade do custo, e o prompt entregue é equivalente (437 contra 495 palavras,
	 * mesma estrutura).
	 *
	 * Fica no ROSTER e não chumbado no bloco porque a resposta certa muda com o
	 * modelo: um Gemini Flash não tem esse problema, e o Sonnet de amanhã pode não
	 * ter. Ausente = `padrao` = ninguém manda nada, que é o comportamento de
	 * sempre para todo especialista que não declarou.
	 */
	raciocinio: 'padrao' | 'baixo' | 'desligado';
	timeoutS: number;
	icone: string;
	cor: string;
	fraseTrabalhando: string;
	ordem: number;
	/** Desligado pelo admin — some do time sem ser apagado. */
	ativo: boolean;
	/** Em que ONDA ele trabalha. Ver `FaseAgente` no núcleo. */
	fase: FaseAgente;
}

const PADRAO = {
	temperatura: 0.3,
	maxTokens: 1200,
	timeoutS: 60,
	maxBuscas: 1,
	icone: 'sparkles',
	cor: '#8b5cf6',
} as const;

/**
 * TETO DE CÓDIGO DO `max_tokens` DESTE TIME — e ele é MENOR que o da Central.
 *
 * ┌─ A CONTA, E POR QUE ELA NÃO É A MESMA DA CENTRAL ───────────────────────┐
 * │ Lá o teto é 9.000, calibrado pelo Estrategista: ele lê o digest de 17    │
 * │ especialistas e escreve um dossiê inteiro em JSON, e o número saiu do    │
 * │ deadline de 120 s dividido pelo ritmo medido (12,8 ms por token).        │
 * │                                                                          │
 * │ Aqui o mais longo do time escreve UM PROMPT DE IMAGEM — um parágrafo     │
 * │ denso, e o próprio `ai.image_studio` recusa acima de 8.000 CARACTERES    │
 * │ (~2.000 tokens). Um teto de 9.000 tokens neste time não libera nada útil:│
 * │ autoriza o modelo a escrever quatro vezes o que o destino aceita, cobra  │
 * │ por isso e depois o texto é cortado — a pior forma de gastar, porque o   │
 * │ dinheiro sai e o produto não melhora.                                    │
 * │                                                                          │
 * │ 4.000 é 2× o que o destino aceita: sobra para o JSON em volta (o Redator │
 * │ devolve título, chamada, legenda e hashtags no mesmo objeto) e ainda     │
 * │ freia o roster que pedir demais. E cabe no relógio com folga: 4.000 ×    │
 * │ 12,8 ms = 51 s dentro dos 150 s de `LIMITES_ATELIE`.                     │
 * │                                                                          │
 * │ NÃO É UMA CÓPIA DESATUALIZADA do 9.000 da Central: são dois tetos com    │
 * │ duas contas, presos a dois deadlines e a dois destinos diferentes. Quem  │
 * │ mexer num não precisa mexer no outro.                                     │
 * │                                                                          │
 * │ MEXEU AQUI? O campo `max_tokens` da coleção `agentes` de `estudio_       │
 * │ imagens` (seed da upvox) tem o MESMO teto, e é ele que recusa o seed com │
 * │ HTTP 400. Os dois andam juntos.                                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export const MAX_TOKENS_TETO = 4_000;

/**
 * Quanto uma FOTO vale na projeção de custo, em caracteres de prompt.
 *
 * `estimarCustoUsd` conta a entrada em caracteres (~4 por token) porque foi
 * escrito para prompt de texto. Uma foto reduzida vale ~1.500 tokens (ver
 * `agent-team/imagem.ts`), então ela entra na conta como o equivalente em
 * caracteres. Sem isto, o freio de gasto olharia o pedido do Leitor do Produto
 * — 1.200 caracteres de pergunta — e não veria o item mais caro da chamada.
 */
export const CHARS_POR_IMAGEM = TOKENS_POR_IMAGEM * 4;

/** Registro da coleção → spec normalizada. `null` se estiver inutilizável. */
export function toArtAgentSpec(entry: {
	title: string;
	data: Record<string, unknown>;
}): ArtAgentSpec | null {
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

	return {
		chave,
		nome: entry.title || chave,
		papel,
		pergunta,
		saida: str(d.saida),
		modelo: str(d.modelo) || undefined,
		entrada: normalizarEntrada(d.entrada),
		entrega: normalizarEntrega(d.entrega),
		motorBusca,
		maxBuscas:
			motorBusca === 'nenhum'
				? 0
				: Math.max(0, Math.min(6, num(d.max_buscas, PADRAO.maxBuscas))),
		dominiosIncluir: parseDominios(d.dominios_incluir),
		dominiosExcluir: parseDominios(d.dominios_excluir),
		essencial: bool(d.essencial),
		temperatura: Math.max(
			0,
			Math.min(2, num(d.temperatura, PADRAO.temperatura)),
		),
		maxTokens: Math.max(
			200,
			Math.min(MAX_TOKENS_TETO, num(d.max_tokens, PADRAO.maxTokens)),
		),
		// Valor estranho vira `padrao` (não manda nada) — a degradação segura é
		// deixar o modelo decidir, nunca desligar o raciocínio de quem precisa.
		raciocinio:
			d.raciocinio === 'desligado' || d.raciocinio === 'baixo'
				? d.raciocinio
				: 'padrao',
		timeoutS: Math.max(10, Math.min(120, num(d.timeout_s, PADRAO.timeoutS))),
		icone: str(d.icone, PADRAO.icone),
		cor: str(d.cor, PADRAO.cor),
		fraseTrabalhando: str(d.frase_trabalhando, 'Trabalhando…'),
		ordem: num(d.ordem, 999),
		// Ausente = ativo. Só `false` explícito desliga: um campo que ninguém
		// preencheu não pode apagar o time inteiro.
		ativo: d.ativo !== false,
		fase: normalizarFase(d.fase),
	};
}

/**
 * TETO DURO DE AGENTES — freio contra roster mal semeado, não política.
 *
 * ┌─ POR QUE AQUI NÃO EXISTE A POLÍTICA DE 5/22 DA CENTRAL ─────────────────┐
 * │ Lá o número de profissionais é o que o aluno COMPRA: o modo profundo     │
 * │ custa 6 voxxys e mostra 22, e um teto menor que o roster cortaria em     │
 * │ silêncio o que foi prometido no botão. Aqui o preço não muda com o       │
 * │ tamanho do time (o multiplicador é o número de PEÇAS), e a mesa de       │
 * │ criação é desenhada a partir do evento `time_montado` — ou seja: se o    │
 * │ admin cadastrar um sétimo especialista, ele aparece e trabalha.          │
 * │                                                                          │
 * │ Isso é deliberado e é o que faz "o time é dado" valer de verdade neste   │
 * │ produto. O que ainda precisa existir é o freio: `agentes` é coleção      │
 * │ editável por tela, e nada impede alguém semear quarenta registros. 10 é  │
 * │ o time de hoje (6) mais quatro de folga; acima disso o corte entra pela  │
 * │ ordem de sacrifício do núcleo, que sacrifica quem depende antes de quem  │
 * │ alimenta.                                                                │
 * │                                                                          │
 * │ Quem passar deste número tem que refazer a conta de custo — cada         │
 * │ especialista a mais é uma chamada a mais no mesmo preço de venda.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export const TETO_DE_AGENTES = 10;

/**
 * Quantos trabalham ao mesmo tempo.
 *
 * A maior onda do time de hoje tem TRÊS (a de leitura). 4 cabe a onda inteira
 * numa leva e ainda deixa margem para o sétimo especialista que o admin
 * cadastrar sem que a onda vire duas levas — que é o que custa relógio de
 * verdade, já que a onda seguinte é uma barreira.
 */
export const CONCORRENCIA_PADRAO = 4;

/**
 * ┌─ OS TETOS DE UM RUN DO ATELIÊ, MEDIDOS EM RUN FRIO ─────────────────────┐
 * │ Voxxy = R$ 1,20. A arte custa de 1 a 3 voxxys (o multiplicador é o       │
 * │ número de PEÇAS, não o tamanho do time). Câmbio de trabalho: R$ 5,50/US$.│
 * │                                                                          │
 * │ MEDIDO contra o OpenRouter real, com foto de produto e anúncio de        │
 * │ referência de verdade (`scripts/_medir-art-team.ts`, roster equivalente  │
 * │ ao semeado: Gemini 3.1 Pro no olho, Haiku nos dois leitores de texto,    │
 * │ Sonnet no Diretor e no Prompt Final, Gemini Flash no Redator):           │
 * │   time inteiro (6/6) ..... US$ 0,0821 · 66,0 s                           │
 * │   time inteiro (6/6) ..... US$ 0,0845 · 64,6 s (com um retry: o leitor   │
 * │                            da foto falhou em Gemini 3.1 Pro e foi        │
 * │                            refeito em Sonnet — e ainda entregou)         │
 * │   pico de comprometimento  US$ 0,0898 (projeção de pior caso da síntese  │
 * │                            somada ao real das duas primeiras ondas)      │
 * │                                                                          │
 * │ O QUE CUSTA: as DUAS chamadas Sonnet (Diretor e Prompt Final) são ~70%   │
 * │ da conta, e a segunda sozinha passa de US$ 0,03 — ela lê o material das  │
 * │ duas ondas e raciocina antes de escrever, e raciocínio é cobrado como    │
 * │ saída. A foto do produto, que parece o item caro, é US$ 0,003.           │
 * │                                                                          │
 * │ `maxUsd` 0,11 = pico medido (0,0898) + ~20%. E o número JÁ FOI CORRIGIDO │
 * │ UMA VEZ POR MEDIÇÃO: estava 0,05, calibrado por estimativa antes do      │
 * │ primeiro run frio — e no run o freio de custo CORTOU O DIRETOR DE ARTE   │
 * │ pela 2ª marcha (gasto 0,0289 de 0,05) e ainda deixou o Prompt Final      │
 * │ furar o teto por ser protegido. Ou seja: o aluno pagaria a arte inteira  │
 * │ e receberia uma arte sem direção, por um teto que era menor que o custo  │
 * │ normal de um run que dá certo. É exatamente o defeito que a Central já   │
 * │ tinha pago (ver `maxUsd` em `lib/research/budget.ts`) e que este         │
 * │ comentário existe para não deixar acontecer de novo.                     │
 * │                                                                          │
 * ├─ ⚠ E HOJE ELE ESTÁ FURADO EM 6 DE 6. MEDIDO, NÃO MEXIDO ────────────────┤
 * │ Peças de ponta a ponta com o roster de agora (o do papel reescrito, com  │
 * │ o Leitor do Produto em 4.000 tokens):                                    │
 * │   US$ 0,1385 · 0,1572 · 0,1950 · 0,1978 · 0,2063 · 0,2141                │
 * │ Ou seja: o run REAL custa de 26% a 95% acima de `maxUsd`, sempre. Como o │
 * │ Prompt Final é protegido, ele roda assim mesmo e o teto não segura nada  │
 * │ — só imprime "teto de gasto do run estourado, rodou por ser protegido".  │
 * │                                                                          │
 * │ POR QUE A PROJEÇÃO DO SEED NÃO VÊ ISSO: `conferirOrcamento()` fecha em   │
 * │ US$ 0,0961 (87% do teto) porque `estimarCustoUsd` conta 4 CARACTERES POR │
 * │ TOKEN na entrada. Medido na chamada da síntese: system 10.761 + digest   │
 * │ 11.614 = 22.375 chars viraram 9.831 tokens de entrada — 2,28 chars por   │
 * │ token, não 4. Português com acento dentro de JSON tokeniza quase o dobro │
 * │ do que a fórmula supõe, e a projeção sai ~43% baixa antes de qualquer    │
 * │ retry. Somando o retry da síntese (medido em 4 de 6 runs), chega-se aos  │
 * │ 0,20 medidos.                                                            │
 * │                                                                          │
 * │ O QUE ISSO CUSTA ENQUANTO FICAR ASSIM: nada de arte pior — o freio não   │
 * │ corta mais ninguém (Redator OK em 6 de 6, `falhas` vazio em 6 de 6) —,   │
 * │ mas o `prompt_final` não cabe no teto de tokens que este orçamento       │
 * │ permite, trunca, refaz, e o run MORRE em 502 quando o retry também       │
 * │ trunca: 2 de 6. Ver `SAIDA_ESTIMADA.prompt_final` no seed do roster.     │
 * │ A saída passa por SUBIR `maxUsd` junto com `MAX_TOKENS_TETO`, e isso é   │
 * │ DECISÃO DE MARGEM DO DONO. Aqui não se mexe: mede-se e reporta-se.       │
 * │                                                                          │
 * │ A MARGEM continua sendo conferida no CUSTO MEDIDO, que é onde ela é      │
 * │ verificável — US$ 0,082 a 0,085, ou R$ 0,45 a R$ 0,47:                   │
 * │   1 voxxy  (R$ 1,20) ..... 61,3% a 62,4% ⚠ o time sozinho não fecha 75%  │
 * │   2 voxxys (R$ 2,40) ..... 80,6% a 81,2%                                 │
 * │   3 voxxys (R$ 3,60) ..... 87,1% a 87,5% (e ainda cabe a imagem)         │
 * │ Ou seja: a promessa de "≤ 3 voxxys com margem ≥ 75%" fecha a partir de   │
 * │ DOIS voxxys. A peça única a 1 voxxy só fecha 75% se o time ficar em      │
 * │ US$ 0,05 — o que se consegue trocando o Diretor de Arte de Sonnet para   │
 * │ Gemini Flash, que é UMA edição de tela no roster. É decisão de produto,  │
 * │ não de runtime, e está registrada aqui para ser tomada com o número na   │
 * │ mão.                                                                     │
 * │                                                                          │
 * │ `deadlineMs` 150 s: as ondas são BARREIRA e o tempo é a SOMA dos três    │
 * │ máximos, nunca o máximo dos três. MEDIDO em dois runs: onda 1 = 16,7 e   │
 * │ 26,3 s (o leitor da foto é sempre o mais lento), onda 2 = 26,4 e 17,0 s, │
 * │ onda 3 = 22,9 e 21,3 s ⇒ 66,0 s e 64,6 s de ponta a ponta. O             │
 * │ dobro disso é a folga que compra a ISENÇÃO do protegido nunca precisar   │
 * │ entrar em campo: o Prompt Final é `essencial`, e ele pulado por relógio  │
 * │ é 502 + estorno com as duas primeiras ondas já pagas.                    │
 * │                                                                          │
 * │ E ELE NÃO PODE CRESCER MUITO: quem espera é o aluno, olhando a mesa de   │
 * │ criação. Depois deste bloco ainda vem a GERAÇÃO DA IMAGEM (~15 a 25 s    │
 * │ por peça), que é o que ele veio buscar.                                  │
 * │                                                                          │
 * │ `maxBuscas` 6: hoje é letra morta (o bloco desliga a busca de todo mundo │
 * │ quando o parâmetro `busca` é falso, e ele nasce falso). O número existe  │
 * │ para o dia do botão, e 6 é um teto por run que cabe em US$ 0,03.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export const LIMITES_ATELIE: BudgetLimits = {
	maxBuscas: 6,
	maxUsd: 0.11,
	deadlineMs: 150_000,
};

/** O time desta execução. Aqui ninguém vem do cache — não existe cache. */
export type TimeDoAtelie = TimeMontadoBase<ArtAgentSpec>;

/**
 * Monta o time do Ateliê: todo mundo que está ligado, na ordem do roster.
 *
 * `politica` recebe o MESMO valor do limite duro de propósito — é assim que se
 * diz "aqui não há corte por política" reusando o núcleo em vez de reescrever a
 * seleção. Ver `TETO_DE_AGENTES`.
 */
export function montarTimeDoAtelie(
	todos: ArtAgentSpec[],
	opts: { entrega?: string; teto?: number } = {},
): TimeDoAtelie {
	const limite = Math.max(1, opts.teto ?? TETO_DE_AGENTES);
	/**
	 * SEM CAMINHO ESCOLHIDO, NINGUÉM É FILTRADO.
	 *
	 * O filtro existe para o especialista exclusivo de um caminho; um run que
	 * não diz qual caminho é (preview, teste, definition antiga) não pode perder
	 * o time inteiro por causa de um campo em branco.
	 */
	const caminho = normalizarEntrega(opts.entrega);
	const elegiveis = todos
		.filter((a) => a.ativo)
		.filter(
			(a) =>
				caminho === 'todas' || a.entrega === 'todas' || a.entrega === caminho,
		)
		.sort((a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave));
	return montarTimeBase(elegiveis, { politica: limite, limiteDuro: limite });
}
