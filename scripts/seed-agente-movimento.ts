/**
 * Semeia o DIRETOR DE MOVIMENTO — quem escreve o pedido do vídeo.
 *
 * Um registro na coleção `agentes` da tool `estudio_video` (declarada na upvox
 * por `scripts/colecao-agentes-video.ts`), com `visibility:'staff'` — o papel
 * escrito aqui é o produto, e não pode ser lido pelo aluno.
 *
 * ┌─ O QUE ESTE ARQUIVO É ───────────────────────────────────────────────────┐
 * │ O texto que ele grava é a diferença medida entre um vídeo do PRODUTO DO  │
 * │ ALUNO e um vídeo do fundo da foto. Três gerações no mesmo produto, mesma │
 * │ arte, mesma seed, US$ 1,20 — o quadro comparativo está em                │
 * │ `src/lib/atelie/movimento.ts`. Resumo do que decidiu:                    │
 * │                                                                          │
 * │  • mandar o prompt da IMAGEM ao gerador de vídeo faz ele REDESENHAR a    │
 * │    tipografia (manchete duplicada) e vagar até cortar a peça fora do     │
 * │    quadro;                                                               │
 * │  • uma frase de movimento genérica mantém a peça intacta mas não mostra  │
 * │    NADA do que ela tem de melhor;                                        │
 * │  • movimento escolhido a partir do que valoriza a peça termina com a     │
 * │    gravação, a espessura e a borda do corte grandes na tela — que é o    │
 * │    que o aluno tem para vender.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE ELE NÃO É UM CAMPO A MAIS NO `direcao_arte` ────────────────────┐
 * │ O Diretor de Arte já escreve NO TETO (medido: 2.210/2.047/3.000⁺ tokens  │
 * │ contra teto de 4.000) e escreve ANTES de a arte existir — e a `galeria`  │
 * │ não guarda o que ele produziu. Como o vídeo é COMPRA SEPARADA, o aluno   │
 * │ que volta amanhã tem só a imagem. Derivar dali seria construir a feature │
 * │ para o único caso que o dono descartou. A caixa completa está no módulo. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 *   SEED_STAFF_ID=<id> npx tsx scripts/seed-agente-movimento.ts
 *
 * Antes dele, na upvox:  npx tsx scripts/colecao-agentes-video.ts
 */
import 'dotenv/config';
import { estimarCustoUsd } from '../src/lib/agent-team/budget.js';
import { CHARS_POR_IMAGEM, MAX_TOKENS_TETO } from '../src/lib/atelie/agents.js';
import {
	CHAVE_DIRETOR_MOVIMENTO,
	LIMITES_DO_PEDIDO,
	TRAVA_DA_TELA,
	TRAVA_DO_PRODUTO,
} from '../src/lib/atelie/movimento.js';
import { findTextModel } from '../src/lib/text-models-catalog.js';

const TOOL = process.env.SEED_TOOL ?? 'estudio_video';
const COLECAO = process.env.SEED_COLECAO ?? 'agentes';
const BASE = process.env.SEED_API_URL ?? 'http://localhost:3333';
const STAFF_ID = process.env.SEED_STAFF_ID ?? '';
const BEARER = process.env.SEED_BEARER ?? '';

/* ══════════════════════════ o papel ══════════════════════════ */

/**
 * ┌─ A REGRA QUE MAIS CUSTA SE FOR ESQUECIDA ────────────────────────────────┐
 * │ O quadro já está pronto e aprovado quando este especialista entra. Tudo  │
 * │ o que ele escrever sobre COMPOSIÇÃO (luz, fundo, enquadramento inicial,  │
 * │ tipografia) é um convite para o gerador redesenhar o que já estava       │
 * │ certo — e foi exatamente isso que duplicou a manchete no teste C.        │
 * │                                                                          │
 * │ O trabalho dele é UM VERBO: o que se move, para onde, em quanto tempo.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const O_QUADRO_JA_ESTA_PRONTO = [
	'A ARTE JÁ EXISTE e já foi aprovada: ela é o PRIMEIRO QUADRO do vídeo.',
	'Você NÃO recompõe nada. Não peça outro enquadramento inicial, outra luz, outro fundo, outra cor, outro objeto em cena nem outro estilo de foto.',
	'Descrever a cena de novo é o erro mais caro daqui: o gerador REDESENHA o que você descrever, e o que já estava certo sai errado.',
	'Escreva só o que MUDA ao longo dos segundos — e o que muda é a câmera, a luz andando e, no máximo, um detalhe que gira ou brilha.',
].join(' ');

/**
 * ┌─ UMA IDEIA DE MOVIMENTO, E SÓ UMA ───────────────────────────────────────┐
 * │ Oito segundos não comportam roteiro. Cada instrução a mais é uma coisa   │
 * │ que o modelo tenta caber no mesmo plano, e o jeito dele de fazer isso é  │
 * │ ACELERAR a câmera — que é como um vídeo de produto vira um vídeo de      │
 * │ videogame.                                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const UM_MOVIMENTO_SO = [
	'ESCOLHA UM ÚNICO MOVIMENTO e leve-o do começo ao fim, devagar e sem parar.',
	'As opções são poucas de propósito: aproximar-se da peça, afastar-se dela, deslizar de lado, descer até quase rasar a superfície, ou dar um quarto de volta curto ao redor dela.',
	'A luz pode acompanhar o movimento — um filete de sol que escorrega sobre a gravação e a acende é o efeito que mais mostra o trabalho de quem gravou.',
	'NUNCA some dois movimentos, nunca mude de velocidade no meio e nunca peça câmera lenta seguida de aceleração.',
].join(' ');

/**
 * ┌─ O MOVIMENTO TEM QUE EXIBIR O QUE VALORIZA — a regra de negócio ─────────┐
 * │ O time da arte já respondeu "o que valoriza esta peça" e "que ângulo a   │
 * │ valoriza" (`ficha_produto`). Um movimento que não termina em cima disso  │
 * │ é bonito e inútil: o aluno vende gravação profunda, borda limpa de corte │
 * │ e veio da madeira, e é isso que precisa aparecer GRANDE.                 │
 * │                                                                          │
 * │ Quando a ficha não vem junto (o aluno comprou o vídeo no dia seguinte),  │
 * │ ele decide o mesmo olhando a arte — que é o material que ele sempre tem. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const EXIBIR_O_QUE_VALORIZA = [
	'O MOVIMENTO EXISTE PARA EXIBIR O QUE VALORIZA A PEÇA — a profundidade da gravação, o veio da madeira, o brilho do inox, a transparência do acrílico, a espessura da chapa, a borda limpa do corte, o encaixe justo.',
	'Se o time mandou a ficha da peça, o que valoriza está escrito lá e o movimento tem que terminar em cima disso.',
	'Se não veio ficha nenhuma, olhe a arte e decida: qual detalhe desta peça prova para quem vai comprar que ela é bem-feita? É esse que a câmera vai buscar.',
	'O ÚLTIMO QUADRO É O QUE FICA CONGELADO NA TELA quando o vídeo acaba: a peça tem que estar INTEIRA e GRANDE nele, com o detalhe que vale à mostra. Nunca termine com a peça pequena, cortada na borda ou fora do centro.',
].join(' ');

/**
 * ┌─ O QUE NUNCA SE PEDE ────────────────────────────────────────────────────┐
 * │ Texto e logo são as duas armadilhas medidas: o gerador erra letra e      │
 * │ inventa símbolo torto, e no teste C ele desenhou a manchete DE NOVO por  │
 * │ cima da que já estava assada na arte. Mão e pessoa entrando em quadro    │
 * │ são a terceira: um anúncio em que aparece uma mão de seis dedos segurando│
 * │ a peça é pior que nenhum anúncio.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const O_QUE_NUNCA_SE_PEDE = [
	'NUNCA peça texto, letra, palavra, frase, manchete, legenda, tipografia ou fonte na tela — nem para aparecer, nem para se mover, nem para sumir. O texto do anúncio é escrito depois, fora do gerador.',
	'NUNCA peça logotipo, marca, assinatura, selo ou marca d’água: o gerador inventa um símbolo torto, e a marca já vem carimbada na arte.',
	'NUNCA coloque pessoa, mão, dedo, rosto ou animal em quadro.',
	'NUNCA acrescente objeto que não esteja na arte, e nunca peça que algo saia de cena.',
	'NUNCA peça corte, transição, mudança de cena, tela preta, vinheta de abertura ou de encerramento.',
	'E NUNCA mude a peça: nada de "mais brilhante", "mais escura", "com verniz", "em outra madeira" — o produto tem que sair do vídeo exatamente como entrou.',
].join(' ');

/** Como falar: quem lê é dono de máquina que quer vender, não um diretor. */
const TOM = [
	'Escreva em português do Brasil, em prosa corrida, como quem instrui um cinegrafista — não como quem escreve ficha técnica.',
	'Nada de jargão de agência ("cinematográfico", "épico", "storytelling"), nada de termo de software e nada de número de lente ou de milímetro.',
	'Um parágrafo, no máximo cinco frases. Pedido comprido não vira vídeo melhor: vira câmera apressada.',
].join(' ');

/**
 * O texto que vai para a TELA (`o_que_exibe`) é lido por uma pessoa enquanto
 * ela espera minutos por um vídeo que custou 12 voxxys. Mesma regra do Ateliê:
 * nada de nome de campo, nada de "null", nada de falar do formato da resposta.
 */
const PROSA_PARA_GENTE = [
	'O campo `o_que_exibe` é lido por uma PESSOA na tela, não por um programa.',
	'Nele é proibido citar nome de campo, escrever "null", "JSON", "prompt" ou explicar o formato da sua resposta.',
	'Escreva uma frase curta dizendo o que este vídeo vai mostrar da peça — por exemplo: "a câmera desce até a gravação, para o cliente ver a profundidade do corte".',
].join(' ');

const PAPEL = [
	'Você é o Diretor de Movimento de um estúdio que faz vídeo curto de produto para quem fabrica peças com máquina a laser.',
	'Seu trabalho é UM SÓ: dizer o que a CÂMERA faz sobre uma arte que já está pronta, para o dono da peça publicar no Reels e nos Stories.',
	O_QUADRO_JA_ESTA_PRONTO,
	UM_MOVIMENTO_SO,
	EXIBIR_O_QUE_VALORIZA,
	O_QUE_NUNCA_SE_PEDE,
	// A trava também é aplicada em CÓDIGO depois (ver `comporPedidoDeVideo`).
	// Aqui ela é o que faz o modelo já escrever o pedido do jeito certo; lá é o
	// que garante que ela existe mesmo se alguém apagar esta linha pela tela.
	`Termine sempre o pedido com estas duas frases, exatamente: "${TRAVA_DO_PRODUTO}" e "${TRAVA_DA_TELA}"`,
	'No campo `som`, peça som de ambiente coerente com a cena e mais nada — NUNCA voz, narração, locução, música cantada ou efeito sonoro chamativo.',
	'Quando o material trouxer O QUE A PESSOA PEDIU, atenda no que der — mas as suas regras vencem o pedido dela: se ela pedir texto, logo, corte ou mudança na peça, ignore essa parte em silêncio e faça o resto.',
	TOM,
	PROSA_PARA_GENTE,
	'Só afirme o que você está VENDO na arte ou o que está no material do time. Não invente material, medida, acabamento nem uso.',
	'Responda só JSON.',
].join(' ');

/**
 * A PERGUNTA — e as variáveis dela.
 *
 * `{peca}` é o nome da arte na galeria, `{formato}` o enquadramento do clipe e
 * `{duracao}` os segundos que o pedido tem que caber. Variável vazia SOME da
 * frase junto com a preposição que a introduzia (`interpolar`), e é por isso que
 * `{peca}` aparece como "a arte pronta de {peca}" e nunca como "a peça é
 * {peca}": no primeiro caso a ausência apaga o "de" e a frase continua correta.
 */
const PERGUNTA = [
	'Olhe a arte pronta de {peca} e escreva o que a câmera faz num plano único de {duracao} segundos, no formato {formato}.',
	'Escolha o movimento que melhor exibe o que esta peça tem de melhor, e diga em que detalhe ele termina.',
	/**
	 * ┌─ O DESEJO DO ALUNO NÃO ENTRA NA PERGUNTA — e a razão é gramatical ─────┐
	 * │ `interpolar` apaga a variável vazia junto com a preposição que a       │
	 * │ introduzia (`de`, `com`, `para`…), e não com dois-pontos. Uma frase    │
	 * │ como "a pessoa pediu: {pedido}" sobra como "a pessoa pediu:." em todo  │
	 * │ run de quem não digitou nada — que é a maioria.                        │
	 * │                                                                        │
	 * │ Então ele viaja no MATERIAL, num bloco próprio que simplesmente não    │
	 * │ existe quando está vazio (ver `ai.video_prompt`). A regra de como      │
	 * │ tratá-lo está no papel: atender no que der, sem quebrar as travas.     │
	 * └────────────────────────────────────────────────────────────────────────┘
	 */
].join(' ');

const SAIDA = [
	'{"movimento":"",',
	'"o_que_exibe":"",',
	'"som":"",',
	'"detalhe_final":"",',
	'"confianca":0}',
].join('');

/* ══════════════════════════ o registro ══════════════════════════ */

/**
 * O MODELO: caro onde é JULGAR.
 *
 * Ele precisa ENXERGAR a arte (o quadro de onde o vídeo parte) e DECIDIR o que
 * nela merece ser exibido — é a mesma natureza de trabalho do Diretor de Arte,
 * e o roster do Ateliê já pagou para descobrir que julgamento em modelo barato
 * devolve genérico. Aqui o genérico tem preço conhecido: o clipe seguinte custa
 * US$ 0,40 de verdade, e um movimento sem graça é o aluno pagando 12 voxxys por
 * um vídeo que ele não vai publicar.
 */
const MODELO = 'anthropic/claude-sonnet-5';

/**
 * O teto de saída.
 *
 * 3.000, e o número tem a mesma origem dos do Ateliê: Sonnet RACIOCINA antes de
 * escrever, e o raciocínio é cobrado (e contado) como saída — o Redator da
 * Central fechou uma chamada com 3.000 tokens de saída e `content` VAZIO porque
 * o raciocínio comeu o teto antes da primeira chave do JSON. O pedido em si tem
 * ~900 caracteres (~360 tokens); o resto é a folga que compra a entrega.
 *
 * ⚠ Este número não pode passar de `MAX_TOKENS_TETO` (4.000): o motor apara e a
 * coleção recusa com 400. `conferirTeto()` confere antes da rede.
 */
const MAX_TOKENS = 3_000;

const ESPECIALISTA = {
	chave: CHAVE_DIRETOR_MOVIMENTO,
	nome: 'Diretor de Movimento',
	papel: PAPEL,
	pergunta: PERGUNTA,
	saida: SAIDA,
	/** A "foto do produto" deste especialista é A ARTE PRONTA. */
	entrada: 'foto_produto' as const,
	/** Inerte (não há ondas), e é o que o marca como PROTEGIDO do corte. */
	fase: 'sintese' as const,
	modelo: MODELO,
	/** Se ele falhar, o run não é cobrado — e é assim que tem que ser. */
	essencial: true,
	/**
	 * 0,4 e não 0,3 (o padrão do Ateliê): movimento de câmera tem menos respostas
	 * certas do que uma ficha de produto, e temperatura baixa demais devolve
	 * sempre a mesma aproximação frontal. Acima de 0,6 ele começa a somar dois
	 * movimentos no mesmo plano, que é o defeito que `UM_MOVIMENTO_SO` combate.
	 */
	temperatura: 0.4,
	max_tokens: MAX_TOKENS,
	timeout_s: 60,
	icone: 'clapperboard',
	cor: '#0ea5e9',
	frase_trabalhando: 'Decidindo o que a câmera faz…',
	ordem: 10,
};

/* ══════════════════════════ os portões ══════════════════════════ */

/** Nada chega ao banco com forma errada. */
function conferirForma(): void {
	const faltando = (['chave', 'papel', 'pergunta', 'saida'] as const).filter(
		(k) => !String(ESPECIALISTA[k] ?? '').trim(),
	);
	if (faltando.length) {
		throw new Error(`campos obrigatórios vazios: ${faltando.join(', ')}`);
	}
	try {
		JSON.parse(SAIDA);
	} catch {
		throw new Error(
			'`saida` não é um JSON válido — a tela lê a resposta por ela.',
		);
	}
	/**
	 * `interpolar` só troca chave que ESTÁ ESCRITA na pergunta. Uma variável que
	 * o bloco preenche e a pergunta não cita é dado coletado, transportado e
	 * jogado fora em silêncio — foi assim que `{publico}` sumiu do Ateliê por
	 * dois épicos.
	 */
	for (const v of ['{peca}', '{formato}', '{duracao}']) {
		if (!PERGUNTA.includes(v)) {
			throw new Error(
				`a pergunta não usa ${v} — o bloco preenche essa variável e ela seria descartada em silêncio.`,
			);
		}
	}
	/**
	 * O `papel` vai VERBATIM como system prompt: uma chave de template escrita
	 * lá chega literal ao modelo, que passa a falar de "{produto}" com o aluno.
	 */
	if (/\{[a-z_]+\}/.test(PAPEL)) {
		throw new Error(
			'o `papel` tem chave de template — ele vai verbatim ao modelo.',
		);
	}
}

/** O teto do registro tem que caber no teto do motor. */
function conferirTeto(): void {
	if (MAX_TOKENS > MAX_TOKENS_TETO) {
		throw new Error(
			`max_tokens ${MAX_TOKENS} passa do teto do motor (${MAX_TOKENS_TETO}): a coleção recusa com 400 e o motor aparava em silêncio.`,
		);
	}
}

/**
 * A conta de dinheiro, com a fórmula do próprio bloco.
 *
 * O freio de gasto PROJETA o pior caso (o `max_tokens` inteiro ao preço de saída
 * do modelo) e PULA quem não couber. Um especialista pulado aqui não é "mais
 * barato": é o run inteiro estornado, porque sem pedido não existe vídeo.
 */
function conferirOrcamento(): void {
	const m = findTextModel(MODELO);
	if (!m) throw new Error(`modelo fora do catálogo: ${MODELO}`);
	if (!m.vision) {
		throw new Error(
			`${MODELO} não enxerga imagem — o Diretor de Movimento precisa VER a arte.`,
		);
	}
	const usd = estimarCustoUsd({
		precoIn: m.pricing.in,
		precoOut: m.pricing.out,
		// papel + pergunta + o material do time + a arte, que é o item mais caro.
		charsPrompt: PAPEL.length + PERGUNTA.length + 6_000 + CHARS_POR_IMAGEM,
		maxTokensSaida: MAX_TOKENS,
		comBusca: false,
	});
	const teto = LIMITES_DO_PEDIDO.maxUsd;
	console.log(
		`  projeção de pior caso: US$ ${usd.toFixed(4)} de US$ ${teto.toFixed(2)} (${Math.round((usd / teto) * 100)}%)`,
	);
	if (usd > teto) {
		throw new Error(
			`a projeção (US$ ${usd.toFixed(4)}) passa do teto do bloco (US$ ${teto.toFixed(2)}).\n` +
				'  Em produção isso não fica caro: fica SEM VÍDEO — o freio pula o especialista\n' +
				'  e o run é estornado. Baixe `max_tokens`, troque o modelo, ou suba\n' +
				'  `LIMITES_DO_PEDIDO.maxUsd` sabendo o que isso custa por run.',
		);
	}
}

/** As travas do código têm que estar escritas no papel, palavra por palavra. */
function conferirTravas(): void {
	for (const t of [TRAVA_DO_PRODUTO, TRAVA_DA_TELA]) {
		if (!PAPEL.includes(t)) {
			throw new Error(
				`o papel não pede a trava: "${t.slice(0, 40)}…". O código a acrescenta de qualquer jeito, mas um modelo que já escreve com ela produz um pedido melhor.`,
			);
		}
	}
}

function headers(): Record<string, string> {
	const h: Record<string, string> = { 'content-type': 'application/json' };
	if (BEARER) h.authorization = `Bearer ${BEARER}`;
	if (STAFF_ID) {
		h['x-user-id'] = STAFF_ID;
		h['x-user-role'] = 'admin';
	}
	return h;
}

/**
 * Idempotente por `chave`: atualiza quem já existe e cria quem falta.
 *
 * ⚠ E NÃO DESLIGA NINGUÉM, ao contrário do seed do Ateliê. Lá o script é dono
 * do time inteiro e desativar quem saiu é a forma de o roster refletir a lista;
 * aqui ele semeia UM registro numa coleção que pode ganhar um segundo jeito de
 * filmar cadastrado pela tela. Desligar estranhos seria este arquivo apagando
 * trabalho que ele não conhece.
 */
async function main() {
	conferirForma();
	conferirTeto();
	conferirTravas();
	conferirOrcamento();

	if (!STAFF_ID && !BEARER) {
		console.error('Defina SEED_STAFF_ID ou SEED_BEARER.');
		process.exit(1);
	}

	const url = `${BASE}/api/tools/${TOOL}/c/${COLECAO}`;
	const atual = await fetch(`${url}?page_size=40`, { headers: headers() });
	if (!atual.ok) {
		throw new Error(
			`não consegui ler a coleção (${atual.status}): ${(await atual.text()).slice(0, 300)}\n` +
				`  A coleção \`${COLECAO}\` existe na definition de \`${TOOL}\`? Rode antes, na upvox:\n` +
				'  npx tsx scripts/colecao-agentes-video.ts',
		);
	}
	const { items } = (await atual.json()) as {
		items: { id: string; data: { chave?: string } }[];
	};
	const existente = items.find((e) => e.data?.chave === ESPECIALISTA.chave)?.id;

	const { chave, nome, ...resto } = ESPECIALISTA;
	const data = { chave, ativo: true, ...resto };

	const res = existente
		? await fetch(`${url}/${existente}`, {
				method: 'PATCH',
				headers: headers(),
				body: JSON.stringify({ title: nome, data }),
			})
		: await fetch(url, {
				method: 'POST',
				headers: headers(),
				// `staff`: o papel é o produto. A coleção também declara
				// `visibility:'staff'` — redundância deliberada, não confiança num
				// lado só.
				body: JSON.stringify({ title: nome, visibility: 'staff', data }),
			});

	if (!res.ok) {
		throw new Error(
			`falhou em '${chave}' (${res.status}): ${(await res.text()).slice(0, 400)}`,
		);
	}

	console.log(
		`\n  ${existente ? '~' : '+'} ${nome}  ${ESPECIALISTA.modelo}  ${MAX_TOKENS} tok  ESSENCIAL`,
	);
	console.log(`  papel: ${PAPEL.length} caracteres`);
	console.log(
		'\nO Diretor de Movimento é editável pela tela de coleção, sem deploy.',
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
