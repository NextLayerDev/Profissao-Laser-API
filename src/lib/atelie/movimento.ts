/**
 * O PEDIDO DO VÍDEO — e por que ele NÃO é o pedido da arte.
 *
 * ┌─ A DECISÃO DESTA FRENTE, COM O QUE FOI MEDIDO ──────────────────────────┐
 * │ Três gerações no MESMO produto, mesma arte 9:16 do Ateliê como primeiro  │
 * │ quadro, mesma seed (7311), mesmo modelo, 8 s · 720p · com áudio. Só uma  │
 * │ coisa mudou: QUEM escreveu o texto. Custou US$ 1,20 e decidiu a frente.  │
 * │                                                                          │
 * │ C — o `prompt` da IMAGEM, verbatim ("e se ninguém escrever nada?")       │
 * │     O modelo REDESENHOU a tipografia que o prompt descrevia: a manchete  │
 * │     saiu DUPLICADA ("LEMBRANÇA / LEMBRANÇA / DE CASAMENTO") nos          │
 * │     primeiros segundos. A marca do rodapé mudou de cor. E, sem nenhuma   │
 * │     instrução de movimento, a câmera vagou: no último quadro a peça do   │
 * │     aluno está CORTADA no canto e quem ocupa o centro é um carretel de   │
 * │     juta. O aluno pagaria 12 voxxys por um vídeo do fundo da foto.       │
 * │                                                                          │
 * │ A — a fórmula do dono (uma frase de movimento + a trava anti-remodelagem)│
 * │     Peça intacta, gravação intacta, marca do rodapé intacta. Mas o       │
 * │     movimento é uma DERIVA: a peça termina menor e fora do centro, e o   │
 * │     que ela tem de melhor nunca vira assunto.                            │
 * │                                                                          │
 * │ B — o Diretor de Movimento (movimento ancorado no que valoriza a peça)   │
 * │     Aproximação contínua que termina com a gravação preenchendo o quadro:│
 * │     o sulco das letras, a espessura da madeira e a BORDA QUEIMADA DO     │
 * │     CORTE — exatamente os itens que a `ficha_produto` chama de "o que    │
 * │     valoriza" — aparecem grandes no fim. Produto, gravação e marca do    │
 * │     rodapé idênticos do primeiro ao último quadro.                       │
 * │                                                                          │
 * │ Ganhou B. E o que ele prova não é "prompt melhor": é que prompt de vídeo │
 * │ é OUTRO TEXTO. C não é uma versão pior de B — é um pedido de COMPOSIÇÃO  │
 * │ entregue a um modelo que já recebeu a composição pronta no primeiro      │
 * │ quadro, e o que ele faz com isso é redesenhar o que já estava certo.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE UM ESPECIALISTA NOVO, E NÃO UMA DERIVAÇÃO DO `direcao_arte` ────┐
 * │ ① O Diretor de Arte já escreve NO TETO. Medido no seed do roster:        │
 * │   2.210 / 2.047 / 3.000⁺ tokens de saída contra `MAX_TOKENS_TETO` de     │
 * │   4.000. Pendurar movimento na `saida` dele é empurrar para o truncamento│
 * │   a chamada que decide a ARTE — e quando ela trunca, quem perde é o run  │
 * │   de todo mundo, para servir um extra que poucos compram.                │
 * │                                                                          │
 * │ ② Ele escreve ANTES de a arte existir. O primeiro quadro do vídeo é a    │
 * │   arte que SAIU, não a que foi pedida. Movimento escrito às cegas        │
 * │   contradiz o quadro — "a câmera desliza para a direita" quando a peça   │
 * │   já nasceu encostada na direita é o vídeo saindo de cima do produto.    │
 * │                                                                          │
 * │ ③ `direcao_arte` NÃO É GUARDADA. `collections.galeria.fields` tem `url`, │
 * │   `prompt`, `modo`, `aspecto`, `video_url` — e nada do time. O vídeo é   │
 * │   COMPRA SEPARADA: o aluno volta amanhã, clica na arte, e a única coisa  │
 * │   que existe nessa hora é a IMAGEM. Uma derivação só funcionaria na      │
 * │   sessão em que a arte foi feita — ou seja, exatamente no caso que o     │
 * │   dono descartou ao dizer que o vídeo não vem incluso.                   │
 * │                                                                          │
 * │ ④ E custaria em todo run de arte um texto que quase ninguém compra.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ E POR QUE ELE NÃO ENTRA NA COLEÇÃO `agentes` DO ATELIÊ ────────────────┐
 * │ Duas razões duras, as duas verificadas no código:                        │
 * │                                                                          │
 * │  • `seed-agentes-arte.ts` DESLIGA quem não está no time dele ("saiu do   │
 * │    time"). O Diretor de Movimento moraria lá até a próxima rodada do     │
 * │    roster da arte — e então o vídeo pararia de funcionar sem uma linha   │
 * │    de erro em lugar nenhum.                                              │
 * │  • O campo `entrega` da coleção é `enum` com quatro opções               │
 * │    (`todas|post|anuncio|cena`), e `montarTimeDoAtelie` não tem valor que │
 * │    esconda alguém dos TRÊS caminhos. Ou ele roda em todo run de arte,    │
 * │    pago e visível na mesa de criação, ou o registro é recusado com 400.  │
 * │                                                                          │
 * │ Ele mora no roster da FERRAMENTA DE VÍDEO (`estudio_video`, coleção      │
 * │ `agentes`) — mesmo formato, mesma tela, mesma disciplina do Ateliê. É a  │
 * │ mesma mudança de endereço que a coleção `marca` já fez, e pelo mesmo     │
 * │ motivo: um cadastro não deve herdar o ciclo de vida de outra tool.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Módulo puro: normalização e composição de texto, nenhum I/O.
 */

/** A chave do especialista no roster da ferramenta de vídeo. */
export const CHAVE_DIRETOR_MOVIMENTO = 'diretor_movimento';

/**
 * ┌─ OS TETOS DE UM PEDIDO DE VÍDEO ────────────────────────────────────────┐
 * │ Uma chamada só, com uma imagem. Medido no catálogo de modelos: Sonnet 5  │
 * │ custa US$ 2/M na entrada e US$ 10/M na saída; com a arte (~1.500 tokens),│
 * │ o papel do roster e ~800 tokens de resposta, a conta fecha em ~US$ 0,014 │
 * │ — R$ 0,08 contra os R$ 2,20 do clipe que vem depois.                     │
 * │                                                                          │
 * │ `maxUsd` 0,05 é ~3,5× o medido, e a folga é deliberada: o admin troca o  │
 * │ modelo pela tela, e um teto justo faria essa troca aparecer como um      │
 * │ especialista PULADO — ou seja, como um vídeo que não sai, sem ninguém    │
 * │ entender por quê. O teto ainda segura o caso que importa (um roster que  │
 * │ pedisse Opus com 4.000 tokens de teto projeta US$ 0,10 e é recusado no   │
 * │ seed, antes de qualquer aluno pagar).                                    │
 * │                                                                          │
 * │ `deadlineMs` 90 s = o `timeout_s` do roster (60 s) mais folga para o     │
 * │ retry em outro modelo. Quem espera aqui já vai esperar MINUTOS pelo      │
 * │ vídeo; os segundos deste bloco não são o que dói.                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export const LIMITES_DO_PEDIDO = {
	maxBuscas: 0,
	maxUsd: 0.05,
	deadlineMs: 90_000,
};

/**
 * Teto do pedido que sai daqui, em caracteres.
 *
 * 1.800 e o número tem origem: o que funcionou (B) tem ~900 caracteres e o que
 * falhou (C) tem ~1.500 — e falhou POR SER descritivo demais, não por ser
 * comprido. Oito segundos não comportam roteiro: cada frase a mais é uma
 * instrução que o modelo vai tentar caber no mesmo plano, e o jeito dele de
 * fazer isso é ACELERAR a câmera. O dobro do que funciona é folga honesta; o
 * triplo seria autorizar o defeito.
 */
export const MAX_PROMPT_VIDEO = 1_800;

/**
 * ┌─ AS TRÊS TRAVAS — e elas são CÓDIGO, não recomendação de prompt ────────┐
 * │ O roster é dado: o `papel` do Diretor de Movimento é editável pela tela, │
 * │ e a primeira edição de quem quiser "um vídeo mais criativo" vai ser      │
 * │ apagar justamente a frase que segura o modelo. Então a frase entra aqui, │
 * │ depois de o especialista responder, uma vez só — mesma disciplina do     │
 * │ `comporPrompt` da arte, que cola a proibição da marca no prompt final    │
 * │ porque "deixar isso por conta do especialista é apostar que ele nunca    │
 * │ esquece; ele esquece".                                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/**
 * A trava que o dono escreveu, e ela não é enfeite: sem uma frase assim o
 * modelo REMODELA a peça, e o aluno recebe o vídeo de um produto que ele não
 * fabrica. Foi medida nas três gerações — nas três em que ela estava presente,
 * a peça e a gravação chegaram idênticas ao último quadro.
 */
export const TRAVA_DO_PRODUTO =
	'O produto não muda de forma, cor, material nem acabamento, e a gravação continua exatamente a mesma.';

/**
 * A trava da TELA: nada de texto e nada de logo.
 *
 * Medida em C: descrever a tipografia fez o modelo DESENHAR a manchete de novo,
 * por cima da que já estava na arte — duas linhas "LEMBRANÇA" empilhadas nos
 * primeiros segundos, e a marca do rodapé trocando de cor. O gerador erra
 * letra e inventa símbolo; o texto é do Ken Burns e da legenda, o logo já vem
 * carimbado na arte pelo `image.brandmark`.
 *
 * ⚠ Ela impede a INVENÇÃO, não a PERDA: em todas as três gerações a manchete
 * que estava assada na arte se apagou ao longo do plano — mais cedo quanto mais
 * a câmera anda. Quem escolhe qual arte vai para o gerador precisa saber disso
 * (o caminho é mandar a arte limpa e cravar a manchete depois, no ffmpeg).
 */
export const TRAVA_DA_TELA =
	'Nenhum texto, letreiro, legenda, logotipo ou marca nova aparece, se transforma ou se move na tela.';

/**
 * A trava do PLANO ÚNICO. Oito segundos com corte no meio viram dois clipes de
 * quatro, e quatro segundos não bastam para um movimento ser lido como
 * intenção — é o que o dono já tinha escrito como "movimento curto e suave,
 * sem cortes", e é o que separa um vídeo de produto de um teaser picotado.
 */
export const TRAVA_DO_CORTE =
	'Plano único e contínuo, sem cortes, sem transições e sem mudança de cena.';

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

/** Primeiro apelido presente, já limpo e cortado. Espelha `saidas.ts`. */
function texto(
	o: Record<string, unknown> | null,
	nomes: string[],
	max: number,
): string {
	if (!o) return '';
	for (const n of nomes) {
		const v = o[n];
		if (typeof v === 'string' && v.trim()) {
			const limpo = v.replace(/\s+/g, ' ').trim();
			return limpo.length > max
				? `${limpo.slice(0, max - 1).trimEnd()}…`
				: limpo;
		}
	}
	return '';
}

export interface PedidoDeMovimento {
	/** O parágrafo de movimento. Vazio = o run não vale nada. */
	movimento: string;
	/** O QUE o movimento exibe — vai para a tela, em português de gente. */
	exibe: string;
	/** O som pedido, quando o especialista opinar. Entra no fim do pedido. */
	som: string;
}

/**
 * O que o especialista entregou, normalizado.
 *
 * Aceita JSON e também TEXTO CRU, pelo mesmo motivo de `extrairPrompt`: o
 * produto deste especialista é um parágrafo, e exigir JSON de quem só tem uma
 * string a dizer cria um modo de falha (JSON cortado no teto) sem ganhar nada.
 * Os apelidos são os que a mesma ideia usa quando alguém reescreve a `saida`
 * pela tela — `movimento`, `prompt`, `prompt_video`, `movimento_da_camera`.
 */
export function extrairMovimento(
	json: unknown,
	textoCru = '',
): PedidoDeMovimento {
	const o = obj(json);
	const movimentoJson = texto(
		o,
		[
			'movimento',
			'prompt_video',
			'prompt',
			'movimento_da_camera',
			'pedido',
			'video_prompt',
		],
		MAX_PROMPT_VIDEO,
	);
	const exibe = texto(
		o,
		[
			'o_que_exibe',
			'o_que_o_movimento_mostra',
			'o_que_mostra',
			'por_que_assim',
			'observacao',
		],
		400,
	);
	const som = texto(o, ['som', 'audio', 'som_ambiente'], 200);

	if (movimentoJson) return { movimento: movimentoJson, exibe, som };

	/**
	 * Sem JSON utilizável vale o texto — mas não uma resposta que COMEÇA em `{`,
	 * que é JSON quebrado. Mandar JSON quebrado para o gerador de vídeo é pagar
	 * US$ 0,40 para o modelo tentar filmar uma chave de abertura.
	 */
	const cru = textoCru.trim();
	if (!cru || cru.startsWith('{') || cru.startsWith('[')) {
		return { movimento: '', exibe, som };
	}
	return { movimento: cru.slice(0, MAX_PROMPT_VIDEO), exibe, som };
}

/** Já existe uma frase equivalente no texto? Aceita o jeito do especialista. */
function jaTem(base: string, marcas: RegExp[]): boolean {
	return marcas.some((r) => r.test(base));
}

/**
 * ┌─ O PEDIDO DE VERDADE — o especialista escreve, o código fecha ──────────┐
 * │ A ordem importa e é a mesma de um set de filmagem: primeiro o que a      │
 * │ câmera faz, depois o que não pode mudar. Modelo de vídeo lê o começo do  │
 * │ pedido como a AÇÃO e o fim como a RESTRIÇÃO — foi assim nas três         │
 * │ gerações, e é como a fórmula do dono já estava escrita.                  │
 * │                                                                          │
 * │ Cada trava entra SÓ SE FALTAR. Repetir a proibição não a reforça: produz │
 * │ duas frases sobre o mesmo assunto disputando o mesmo plano de 8 s, que é │
 * │ o que faz a câmera acelerar para "caber tudo".                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function comporPedidoDeVideo(p: PedidoDeMovimento): string {
	const base = p.movimento.trim();
	if (!base) return '';

	const partes = [base];

	if (
		!jaTem(base, [
			/plano\s+(único|unico|contínuo|continuo)/i,
			/sem\s+cortes?/i,
			/single\s+shot/i,
		])
	) {
		partes.push(TRAVA_DO_CORTE);
	}
	if (
		!jaTem(base, [
			/não\s+muda\s+de\s+(forma|cor)/i,
			/nao\s+muda\s+de\s+(forma|cor)/i,
			/mesma\s+forma,\s*cor/i,
		])
	) {
		partes.push(TRAVA_DO_PRODUTO);
	}
	if (
		!jaTem(base, [
			/nenhum\s+texto/i,
			/sem\s+texto\s+novo/i,
			/nenhuma\s+letra/i,
			/sem\s+letreiro/i,
		])
	) {
		partes.push(TRAVA_DA_TELA);
	}
	if (p.som.trim()) partes.push(p.som.trim());

	/**
	 * PONTUAR E EMENDAR, e isto não é frescura de estilo.
	 *
	 * O `som` volta do modelo como um pedaço de frase em minúscula ("som
	 * ambiente suave de um espaço interno") — medido na primeira chamada real.
	 * Emendado cru, o pedido termina em "…sem mudança de cena. som ambiente
	 * suave", e o que o gerador de vídeo lê ali é uma frase quebrada no ponto
	 * exato em que a gente está pedindo o áudio. Custa duas linhas fechar cada
	 * pedaço e subir a primeira letra.
	 */
	return partes
		.map((t) => {
			const limpo = t.trim().replace(/\s+/g, ' ');
			const comPonto = /[.!?]$/.test(limpo) ? limpo : `${limpo}.`;
			return comPonto.charAt(0).toUpperCase() + comPonto.slice(1);
		})
		.join(' ')
		.slice(0, MAX_PROMPT_VIDEO);
}

/**
 * ┌─ O PORTÃO QUE OLHA O QUE O ESPECIALISTA PEDIU ──────────────────────────┐
 * │ Ele não corta e não reescreve: prosa reescrita por regex é adivinhação,  │
 * │ e um pedido de movimento mutilado no meio produz um vídeo pior do que o  │
 * │ pedido inteiro. Ele AVISA — o aviso vai para o log e para `avisos`, e é  │
 * │ o que transforma "o vídeo saiu estranho" em "o pedido descrevia          │
 * │ tipografia, e foi por isso".                                             │
 * │                                                                          │
 * │ O vocabulário desta lista é o de C, o candidato que falhou: ele falava   │
 * │ de fonte, de cor de letra e de frase escrita, e o modelo desenhou a      │
 * │ manchete de novo por cima da que já existia.                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function avisosDoPedido(prompt: string): string[] {
	const avisos: string[] = [];
	/**
	 * ⚠ AS TRAVAS SAEM DA VARREDURA — senão o portão delata a si mesmo.
	 *
	 * `TRAVA_DA_TELA` contém as palavras "texto", "letreiro" e "logotipo" por
	 * dever de ofício: é ela que PROÍBE as três. Varrer o pedido já composto
	 * fazia o aviso disparar em 100% dos runs ("o pedido fala de logotipo"),
	 * e um aviso que aparece sempre é um aviso que ninguém lê. Medido na
	 * primeira chamada real do especialista.
	 */
	const base = [TRAVA_DA_TELA, TRAVA_DO_PRODUTO, TRAVA_DO_CORTE]
		.reduce((txt, trava) => txt.split(trava).join(' '), prompt)
		.toLowerCase();

	const pedeTipografia =
		/\b(tipografia|fonte|font|manchete|headline|lettering|caligrafia)\b/.test(
			base,
		) ||
		/\b(texto|frase|palavra|letras?)\b[^.]{0,40}\b(aparec|surg|escrit|entra|pousa|desenh)/.test(
			base,
		);
	if (pedeTipografia) {
		avisos.push(
			'O pedido do vídeo fala de texto na tela. O gerador redesenha letra e costuma duplicar a manchete — o texto do vídeo é responsabilidade da legenda, não do gerador.',
		);
	}

	if (/\b(logo|logotipo|marca d'água|marca dagua|selo)\b/.test(base)) {
		avisos.push(
			'O pedido do vídeo fala de logotipo. O gerador inventa um símbolo torto — o logo já vem carimbado na arte.',
		);
	}

	return avisos;
}
