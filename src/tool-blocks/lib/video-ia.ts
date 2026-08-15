import { setTimeout as esperar } from 'node:timers/promises';
import sharp from 'sharp';
import { ToolEngineError } from '../../lib/tool-errors.js';

/**
 * VÍDEO GENERATIVO — o cliente da fila de vídeo da OpenRouter, separado do bloco.
 *
 * ┌─ ESTE ARQUIVO NÃO SUBSTITUI `video.ts`, ELE É O DEGRAU DE CIMA ──────────┐
 * │ `lib/video.ts` (Ken Burns) monta o clipe LOCALMENTE: a câmera anda, o     │
 * │ produto fica, custo de fornecedor US$ 0,00 — e continua sendo o brinde    │
 * │ incluso em toda arte. Aqui o modelo GERA movimento novo: a caneca gira, a │
 * │ luz corre pela gravação. Custa dinheiro de verdade por clique, e por isso │
 * │ é COMPRA SEPARADA (tool própria, preço próprio).                          │
 * │                                                                          │
 * │ O comentário histórico do `video.ts` ("o OpenRouter não tem um único      │
 * │ modelo de vídeo") ficou VELHO e é por isso que ele merece registro: o     │
 * │ catálogo `GET /v1/models` de fato não lista vídeo até hoje — quem lista é │
 * │ `GET /v1/videos/models`, um endpoint separado, com 22 modelos. Procurar   │
 * │ vídeo no catálogo de texto e concluir que não existe custou uma fase.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS TRÊS ARMADILHAS QUE JÁ COBRARAM PELO ERRO ──────────────────────────┐
 * │ ① CAMPO DESCONHECIDO É IGNORADO EM SILÊNCIO — E O JOB ENFILEIRA MESMO    │
 * │   ASSIM. Sondar o endpoint com nome de parâmetro chutado custou US$ 5,76 │
 * │   em seis gerações lixo. Daí a regra deste arquivo: TUDO o que sai daqui │
 * │   é validado contra `MODELOS_DE_VIDEO` (cópia do `/videos/models`) ANTES │
 * │   do POST, e valor fora do conjunto é ENCAIXADO no vizinho suportado —   │
 * │   nunca enviado na esperança de que o provedor recuse.                   │
 * │                                                                          │
 * │ ② SEM `resolution` EXPLÍCITO, PAGA-SE 3,2× MAIS. O provedor entrega 720p │
 * │   e fatura pela SKU cheia (US$ 0,08/s) em vez da SKU 720p (US$ 0,05/s).  │
 * │   Medido: 4 s com `resolution:"720p"` = `usage.cost` 0,20 exato. Por     │
 * │   isso `resolution` NUNCA é omitido aqui, nem quando é o padrão.         │
 * │                                                                          │
 * │ ③ O DOWNLOAD EXIGE `Authorization`. Sem o header vem **200 com corpo     │
 * │   vazio** — não 401 —, o arquivo é gravado com 0 byte e só o player      │
 * │   reclama ("moov atom not found"), depois de o run ter liquidado a       │
 * │   cobrança. Daí `conferirMp4`: o que não começa com uma caixa `ftyp`     │
 * │   LANÇA, para o run cair no estorno em vez de arquivar lixo.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O DINHEIRO, EM UMA FRASE ──────────────────────────────────────────────┐
 * │ Aqui o vídeo É o produto (o aluno pagou por ele), ao contrário do clipe  │
 * │ do Ateliê, que é extra sobre uma arte já paga. A doutrina se INVERTE:    │
 * │ lá, engolir o erro e entregar sem vídeo é o certo; aqui, qualquer falha  │
 * │ TEM de lançar, porque lançar é o que aciona o `refundInvocation` do      │
 * │ controller e devolve os voxxys. Entregar "vazio com um aviso" seria      │
 * │ cobrar por nada.                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/* ───────────────────────── o catálogo, copiado ───────────────────────── */

/**
 * O QUE CADA MODELO ACEITA — cópia curada de `GET /v1/videos/models`.
 *
 * É cópia e não consulta ao vivo de propósito: uma chamada extra de rede antes
 * de cada geração acrescenta um ponto de falha (e latência) ao caminho que já é
 * o mais caro do sistema, para responder uma pergunta que muda de mês em mês,
 * não de minuto em minuto. O preço de a cópia envelhecer é conhecido e pequeno
 * — um valor recusado pelo provedor no submit, ANTES de enfileirar, custa
 * US$ 0,00 (ver `criarJob`: o 400 de entrada não cobra).
 *
 * Só a família Veo está aqui porque só ela foi assistida lado a lado. Os outros
 * 19 modelos do catálogo existem, mas entrar nesta tabela é decisão de produto
 * (alguém precisa ASSISTIR), não de código.
 */
export interface ModeloDeVideo {
	id: string;
	rotulo: string;
	resolucoes: readonly ('720p' | '1080p')[];
	aspectos: readonly ('16:9' | '9:16')[];
	duracoes: readonly number[];
	/** Aceita quadro inicial? Sem isto o vídeo não é DO PRODUTO DELE. */
	quadroInicial: boolean;
	audio: boolean;
	/** US$ por segundo de saída, por combinação (resolução × áudio). */
	usdPorSegundo: {
		'720p': { com: number; sem: number };
		'1080p': { com: number; sem: number };
	};
}

export const MODELOS_DE_VIDEO: Record<string, ModeloDeVideo> = {
	/**
	 * O ESCOLHIDO. US$ 0,05/s em 720p com áudio ⇒ 8 s = US$ 0,40 ≈ R$ 2,20
	 * contra R$ 14,40 de receita (12 voxxys). Foi escolhido depois de assistir
	 * aos três candidatos, não pelo preço — mas o preço fecha.
	 */
	'google/veo-3.1-lite': {
		id: 'google/veo-3.1-lite',
		rotulo: 'Veo 3.1 Lite',
		resolucoes: ['720p', '1080p'],
		aspectos: ['16:9', '9:16'],
		duracoes: [4, 6, 8],
		quadroInicial: true,
		audio: true,
		usdPorSegundo: {
			'720p': { com: 0.05, sem: 0.03 },
			'1080p': { com: 0.08, sem: 0.05 },
		},
	},
	'google/veo-3.1-fast': {
		id: 'google/veo-3.1-fast',
		rotulo: 'Veo 3.1 Fast',
		resolucoes: ['720p', '1080p'],
		aspectos: ['16:9', '9:16'],
		duracoes: [4, 6, 8],
		quadroInicial: true,
		audio: true,
		usdPorSegundo: {
			'720p': { com: 0.1, sem: 0.08 },
			'1080p': { com: 0.12, sem: 0.1 },
		},
	},
	/**
	 * O caro (US$ 0,40/s ⇒ 8 s = US$ 3,20 = R$ 17,60, ACIMA da receita de 12
	 * voxxys). Fica na tabela para o teto de custo poder recusá-lo com nome e
	 * número em vez de o admin descobrir pela fatura.
	 */
	'google/veo-3.1': {
		id: 'google/veo-3.1',
		rotulo: 'Veo 3.1',
		resolucoes: ['720p', '1080p'],
		aspectos: ['16:9', '9:16'],
		duracoes: [4, 6, 8],
		quadroInicial: true,
		audio: true,
		usdPorSegundo: {
			'720p': { com: 0.4, sem: 0.2 },
			'1080p': { com: 0.4, sem: 0.2 },
		},
	},
};

export const MODELO_DE_VIDEO_PADRAO = 'google/veo-3.1-lite';

export const MODELO_DE_VIDEO_KEYS = Object.keys(MODELOS_DE_VIDEO) as [
	string,
	...string[],
];

export type AspectoDeVideo = '16:9' | '9:16';
export type ResolucaoDeVideo = '720p' | '1080p';

/**
 * O TETO DE CUSTO POR GERAÇÃO — o portão que separa "configuração ousada" de
 * "prejuízo por clique".
 *
 * O preço ao aluno (12 voxxys ≈ R$ 14,40 ≈ US$ 2,60) é decisão do dono e não se
 * mexe. O que ESTE arquivo pode fazer é impedir que uma combinação escrita na
 * Fábrica — `veo-3.1` em 1080p por 8 s, US$ 3,20 — saia mais cara do que a
 * venda. US$ 1,00 é o corte: deixa passar o Lite inteiro (US$ 0,40 no pior
 * caso) e o Fast em 720p, e barra o modelo caro com o número na mensagem.
 *
 * A recusa acontece ANTES do POST: nada é enfileirado, nada é cobrado do nosso
 * lado, e o aluno recebe o estorno pelo caminho normal do controller.
 */
export const TETO_DE_CUSTO_USD = 1.0;

/** O que a combinação vai custar, pela mesma tabela de SKU do provedor. */
export function custoEstimadoUsd(
	modelo: ModeloDeVideo,
	opts: {
		duracao_s: number;
		resolucao: ResolucaoDeVideo;
		com_audio: boolean;
	},
): number {
	const faixa = modelo.usdPorSegundo[opts.resolucao];
	const porSegundo = opts.com_audio ? faixa.com : faixa.sem;
	return Math.round(porSegundo * opts.duracao_s * 10_000) / 10_000;
}

/**
 * Encaixa um pedido no conjunto que o modelo aceita, em vez de mandar o valor
 * cru e torcer. É a aplicação direta da armadilha ①: o endpoint aceita o que
 * não conhece e ENFILEIRA — logo, quem valida somos nós.
 *
 * Encaixar (e avisar) em vez de recusar é deliberado: um número que não existe
 * no conjunto é erro de CONFIGURAÇÃO (definition escrita na Fábrica), e derrubar
 * o run devolveria o dinheiro mas nunca entregaria vídeo nenhum enquanto
 * ninguém corrigisse o rascunho. Encaixado, entrega — e o aviso diz o que foi
 * trocado.
 */
export function encaixarDuracao(
	modelo: ModeloDeVideo,
	pedida: number,
): { duracao: number; aviso?: string } {
	if (modelo.duracoes.includes(pedida)) return { duracao: pedida };
	const perto = [...modelo.duracoes].sort(
		(a, b) => Math.abs(a - pedida) - Math.abs(b - pedida) || a - b,
	)[0] as number;
	return {
		duracao: perto,
		aviso: `${modelo.rotulo} não faz vídeo de ${pedida}s; o clipe saiu com ${perto}s.`,
	};
}

export function encaixarResolucao(
	modelo: ModeloDeVideo,
	pedida: ResolucaoDeVideo,
): { resolucao: ResolucaoDeVideo; aviso?: string } {
	if (modelo.resolucoes.includes(pedida)) return { resolucao: pedida };
	const perto = modelo.resolucoes[0] as ResolucaoDeVideo;
	return {
		resolucao: perto,
		aviso: `${modelo.rotulo} não entrega ${pedida}; o clipe saiu em ${perto}.`,
	};
}

export function encaixarAspecto(
	modelo: ModeloDeVideo,
	pedido: AspectoDeVideo,
): { aspecto: AspectoDeVideo; aviso?: string } {
	if (modelo.aspectos.includes(pedido)) return { aspecto: pedido };
	const perto = modelo.aspectos[0] as AspectoDeVideo;
	return {
		aspecto: perto,
		aviso: `${modelo.rotulo} não faz ${pedido}; o clipe saiu em ${perto}.`,
	};
}

/**
 * O tamanho em pixels que a combinação resolução×proporção produz. Vem daqui e
 * não de medir o MP4 porque `output.save_video` precisa dele para montar a CAPA
 * — e a capa é gerada a partir da ARTE, não do vídeo.
 */
export function dimensoesDoVideo(
	resolucao: ResolucaoDeVideo,
	aspecto: AspectoDeVideo,
): { largura: number; altura: number } {
	const lado = resolucao === '1080p' ? 1080 : 720;
	const longo = resolucao === '1080p' ? 1920 : 1280;
	return aspecto === '9:16'
		? { largura: lado, altura: longo }
		: { largura: longo, altura: lado };
}

/** `9:16` → a chave de formato que `FORMATOS_DE_VIDEO` (e a tela) já conhece. */
export function formatoDoAspecto(aspecto: AspectoDeVideo): string {
	return aspecto === '9:16' ? 'story_9x16' : 'capa_16x9';
}

/* ───────────────────────── o quadro inicial ───────────────────────── */

/**
 * ⚠ O QUADRO INICIAL É O QUE FAZ O VÍDEO SER DO PRODUTO DELE.
 *
 * Sem `frame_images` o modelo INVENTA outro produto — texto-para-vídeo aqui é
 * defeito, não simplificação. E o quadro precisa nascer NA PROPORÇÃO PEDIDA:
 * medido, mandar uma arte 1:1 com `aspect_ratio:"9:16"` fez o Veo encaixar o
 * quadrado no meio COM TARJA PRETA em cima e embaixo — e tarja preta em Stories
 * é entregar errado.
 *
 * Quando a arte já vem na proporção certa (o Estúdio sabe gerar `story_9x16`),
 * ela passa intacta. Quando não vem, esta função reenquadra com FUNDO DESFOCADO
 * da própria arte — a mesma saída que o clipe local já usa, e pelo mesmo motivo:
 *
 *  · `cover` recortaria, e é exatamente aí que a manchete e o logo (que moram
 *    nos cantos) seriam decapitados — o defeito que já custou uma rodada no kit;
 *  · `contain` sobre preto devolve a tarja que estamos tentando evitar;
 *  · borda replicada estria em movimento (medido nas quatro artes reais).
 *
 * O desfoque não tem estrutura para esticar, então não deixa rastro — e é o que
 * a própria plataforma faz com foto quadrada em Reels.
 */
const DESFOQUE_DO_FUNDO = 0.055;
const ESCURECIMENTO_DO_FUNDO = 0.5;
/** Acima disto a proporção conta como "outra" e o reenquadramento acontece. */
const TOLERANCIA_DE_PROPORCAO = 0.06;
/**
 * Qualidade do JPEG do quadro. 92 porque o modelo reencoda tudo de qualquer
 * jeito e o que importa é o PESO: a data URL viaja dentro do corpo do POST, e
 * um PNG de 720×1280 (≈2 MB → 2,7 MB em base64) é caro para zero ganho visível.
 */
const QUALIDADE_DO_QUADRO = 92;

export interface QuadroPreparado {
	dataUrl: string;
	largura: number;
	altura: number;
	/** `true` quando a arte foi reenquadrada (proporção não batia). */
	reenquadrado: boolean;
	avisos: string[];
}

export async function prepararQuadroInicial(
	arte: Buffer,
	aspecto: AspectoDeVideo,
	resolucao: ResolucaoDeVideo,
): Promise<QuadroPreparado> {
	const meta = await sharp(arte).metadata();
	const w = meta.width ?? 0;
	const h = meta.height ?? 0;
	if (w < 1 || h < 1) {
		throw new ToolEngineError(
			400,
			'A arte que deveria virar vídeo chegou vazia.',
		);
	}

	const alvo = dimensoesDoVideo(resolucao, aspecto);
	const arArte = w / h;
	const arAlvo = alvo.largura / alvo.altura;
	const desvio = Math.abs(Math.log(arArte / arAlvo));

	if (desvio <= TOLERANCIA_DE_PROPORCAO) {
		/**
		 * Já está na proporção. Ainda assim passa pelo sharp: `flatten` porque
		 * transparência vira PRETO no vídeo, e o redimensionamento para o tamanho
		 * nominal poupa megabytes de base64 sem custar nitidez (o modelo não usa
		 * mais que isso).
		 */
		const png = await sharp(arte)
			.flatten({ background: '#ffffff' })
			.resize(alvo.largura, alvo.altura, { fit: 'fill' })
			.jpeg({ quality: QUALIDADE_DO_QUADRO })
			.toBuffer();
		return {
			dataUrl: `data:image/jpeg;base64,${png.toString('base64')}`,
			largura: alvo.largura,
			altura: alvo.altura,
			reenquadrado: false,
			avisos: [],
		};
	}

	/**
	 * ⚠ O `toBuffer()` do meio NÃO é desperdício: o sharp aplica `resize` ANTES
	 * de `composite`, não importa a ordem do encadeamento, e sem materializar a
	 * arte volta esticada. É a mesma armadilha ① do `lib/video.ts`, e ela morde
	 * de novo em todo arquivo que compõe imagem.
	 */
	const fundo = await sharp(arte)
		.flatten({ background: '#ffffff' })
		.resize(alvo.largura, alvo.altura, { fit: 'cover', position: 'centre' })
		.blur(Math.max(1, alvo.largura * DESFOQUE_DO_FUNDO))
		.modulate({ brightness: ESCURECIMENTO_DO_FUNDO })
		.removeAlpha()
		.png()
		.toBuffer();

	const escala = Math.min(alvo.largura / w, alvo.altura / h);
	const artW = Math.max(2, Math.round(w * escala));
	const artH = Math.max(2, Math.round(h * escala));
	const nitida = await sharp(arte)
		.flatten({ background: '#ffffff' })
		.resize(artW, artH, { fit: 'fill' })
		.removeAlpha()
		.png()
		.toBuffer();

	const composto = await sharp(fundo)
		.composite([
			{
				input: nitida,
				left: Math.round((alvo.largura - artW) / 2),
				top: Math.round((alvo.altura - artH) / 2),
			},
		])
		.removeAlpha()
		.jpeg({ quality: QUALIDADE_DO_QUADRO })
		.toBuffer();

	return {
		dataUrl: `data:image/jpeg;base64,${composto.toString('base64')}`,
		largura: alvo.largura,
		altura: alvo.altura,
		reenquadrado: true,
		avisos: [
			`A arte é ${w}×${h} e o vídeo é ${aspecto}: ela entrou inteira, com fundo desfocado nas sobras. Para tela cheia, gere a arte já em ${aspecto}.`,
		],
	};
}

/* ───────────────────────── a fila ───────────────────────── */

const BASE = 'https://openrouter.ai/api/v1';

/** Um GET de status é barato; 30 s é folga de sobra para ele. */
const TIMEOUT_CONSULTA_MS = 30_000;
/**
 * O POST demora ~4 s porque o provedor BAIXA a imagem de entrada de forma
 * síncrona antes de enfileirar (é o que faz a URL quebrada custar US$ 0,00).
 * 120 s é folga para uma arte grande num dia ruim de rede.
 */
const TIMEOUT_SUBMISSAO_MS = 120_000;
/** O MP4 tem megabytes; baixar não é consultar. */
const TIMEOUT_DOWNLOAD_MS = 180_000;

/**
 * O INTERVALO ENTRE CONSULTAS É TAMBÉM O BATIMENTO CARDÍACO DO SSE.
 *
 * 5 s não é sobre descobrir o resultado mais cedo — a geração medida levou 42 s,
 * e 5 s ou 15 s dariam quase o mesmo tempo de entrega. É sobre o CANAL: entre o
 * aluno e este processo há o proxy do gateway, e um stream mudo por minutos é a
 * forma mais cara de descobrir qual é o timeout padrão do undici. A cada
 * consulta sai um `onProgress`, e o socket segue vivo.
 */
export const INTERVALO_DE_CONSULTA_MS = 5_000;

/**
 * O PRAZO. Um job travado no provedor NÃO pode segurar o recibo para sempre:
 * enquanto este run está de pé, o `invocation_id` está reservado e o aluno não
 * consegue nem repetir a geração que já pagou. Estourado o prazo, o bloco LANÇA
 * — e lançar é o que devolve os voxxys.
 *
 * 6 minutos = ~8,5× a geração medida (42 s). Curto o bastante para não prender
 * ninguém, largo o bastante para um dia ruim do provedor não virar estorno.
 */
export const PRAZO_PADRAO_MS = 360_000;
export const PRAZO_MAXIMO_MS = 900_000;

/**
 * Falha de REDE seguida. Uma consulta que não volta é ruído (o job continua lá);
 * quatro seguidas são o provedor fora do ar, e insistir só empurra o estorno
 * para mais longe.
 */
const MAX_ERROS_SEGUIDOS = 4;

export type MotivoDeFalhaDeVideo =
	| 'sem_chave'
	| 'entrada_invalida'
	| 'politica'
	| 'provedor'
	| 'prazo'
	| 'download';

/**
 * O erro do vídeo, com o motivo separado da frase. A frase é a que o aluno lê;
 * o motivo é o que o teste (e o log) conferem — sem ele, distinguir "URL
 * quebrada" de "provedor fora do ar" viraria comparação de string em português.
 */
export class ErroDeVideo extends ToolEngineError {
	constructor(
		public readonly motivo: MotivoDeFalhaDeVideo,
		status: number,
		message: string,
		/** O texto cru do provedor — vai para o log, nunca para a tela. */
		public readonly detalhe?: string,
	) {
		super(status, message);
		this.name = 'ErroDeVideo';
	}
}

interface RespostaDeErro {
	error?: { message?: string; code?: number };
}

interface JobCriado {
	id: string;
	status?: string;
	polling_url?: string;
}

export interface EstadoDoJob {
	id: string;
	status: string;
	usage?: { cost?: number };
	error?: { message?: string };
}

const TERMINAIS_RUINS = new Set(['failed', 'cancelled', 'expired']);

function cabecalhos(): Record<string, string> {
	const chave = process.env.OPENROUTER_API_KEY?.trim();
	if (!chave) {
		throw new ErroDeVideo(
			'sem_chave',
			503,
			'A geração de vídeo não está configurada neste servidor.',
		);
	}
	return {
		Authorization: `Bearer ${chave}`,
		'Content-Type': 'application/json',
		'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
		'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Vídeo`,
	};
}

/**
 * Lê o corpo como TEXTO e só então faz o parse.
 *
 * O 202 do submit vem com PADDING DE ESPAÇOS antes do JSON (keep-alive do
 * provedor enquanto ele baixa a imagem). `res.json()` aguentaria, mas ler texto
 * primeiro dá uma segunda coisa de graça: quando o corpo NÃO é JSON (um HTML de
 * gateway 502, por exemplo), o detalhe vai inteiro para o log em vez de virar
 * "Unexpected token < in JSON".
 */
async function lerJson<T>(res: Response): Promise<{ dado?: T; cru: string }> {
	const cru = await res.text();
	try {
		return { dado: JSON.parse(cru.trim()) as T, cru };
	} catch {
		return { cru };
	}
}

function juntarSinais(
	proprio: AbortSignal,
	externo?: AbortSignal,
): AbortSignal {
	return externo ? AbortSignal.any([externo, proprio]) : proprio;
}

/**
 * Classifica o 400 do submit. Os três casos foram testados de graça — nenhum
 * enfileirou, nenhum cobrou — e cada um vira uma frase diferente porque a AÇÃO
 * do aluno é diferente em cada um: imagem quebrada é "tente de novo", política é
 * "mude o pedido", modelo inexistente é "avise o suporte".
 */
function frasePara400(mensagem: string): {
	motivo: MotivoDeFalhaDeVideo;
	frase: string;
} {
	const m = mensagem.toLowerCase();
	if (m.includes('fetching image') || m.includes('status code when fetching')) {
		return {
			motivo: 'entrada_invalida',
			frase:
				'Não conseguimos entregar a sua arte ao gerador de vídeo. Tente criar o vídeo de novo em alguns instantes.',
		};
	}
	if (
		m.includes('policy') ||
		m.includes('safety') ||
		m.includes('blocked') ||
		m.includes('violat') ||
		m.includes('prohibited')
	) {
		return {
			motivo: 'politica',
			frase:
				'O gerador de vídeo recusou este pedido por política de conteúdo. Ajuste a descrição do movimento e tente de novo.',
		};
	}
	if (m.includes('does not exist') || m.includes('requires a prompt')) {
		return {
			motivo: 'entrada_invalida',
			frase:
				'A configuração do vídeo desta ferramenta está inválida. Avise o suporte — nada foi cobrado.',
		};
	}
	return {
		motivo: 'entrada_invalida',
		frase:
			'O gerador de vídeo recusou este pedido. Ajuste a descrição do movimento e tente de novo.',
	};
}

export interface CorpoDoPedido {
	model: string;
	prompt: string;
	duration: number;
	resolution: ResolucaoDeVideo;
	aspect_ratio: AspectoDeVideo;
	generate_audio: boolean;
	frame_images?: {
		type: 'image_url';
		image_url: { url: string };
		frame_type: 'first_frame';
	}[];
	seed?: number;
	provider?: Record<string, unknown>;
}

/**
 * ENFILEIRA. Devolve o id assim que o provedor aceita — a espera é problema do
 * `aguardarJob`, e separar as duas coisas é o que torna cada uma testável sem a
 * outra.
 */
export async function criarJob(
	corpo: CorpoDoPedido,
	signal?: AbortSignal,
): Promise<JobCriado> {
	const cab = cabecalhos();
	let res: Response;
	try {
		res = await fetch(`${BASE}/videos`, {
			method: 'POST',
			headers: cab,
			body: JSON.stringify(corpo),
			signal: juntarSinais(AbortSignal.timeout(TIMEOUT_SUBMISSAO_MS), signal),
		});
	} catch (err) {
		const e = err as { name?: string; message?: string };
		throw new ErroDeVideo(
			'provedor',
			502,
			'O gerador de vídeo não respondeu. Tente de novo em alguns instantes.',
			`${e?.name ?? 'erro'}: ${e?.message ?? 'falha de rede'}`,
		);
	}

	const { dado, cru } = await lerJson<JobCriado & RespostaDeErro>(res);
	if (!res.ok) {
		const msg = dado?.error?.message ?? cru.slice(0, 400);
		if (res.status === 400 || res.status === 422) {
			const { motivo, frase } = frasePara400(msg);
			throw new ErroDeVideo(motivo, 400, frase, msg);
		}
		if (res.status === 429) {
			throw new ErroDeVideo(
				'provedor',
				429,
				'O gerador de vídeo está sobrecarregado agora. Tente de novo em alguns minutos.',
				msg,
			);
		}
		if (res.status === 401 || res.status === 403) {
			throw new ErroDeVideo(
				'sem_chave',
				503,
				'A geração de vídeo não está configurada neste servidor.',
				msg,
			);
		}
		throw new ErroDeVideo(
			'provedor',
			502,
			'O gerador de vídeo falhou ao aceitar o pedido. Tente de novo em alguns instantes.',
			`HTTP ${res.status}: ${msg}`,
		);
	}
	if (!dado?.id) {
		throw new ErroDeVideo(
			'provedor',
			502,
			'O gerador de vídeo não devolveu um identificador de trabalho.',
			cru.slice(0, 400),
		);
	}
	return dado;
}

export async function consultarJob(
	id: string,
	signal?: AbortSignal,
): Promise<EstadoDoJob> {
	const res = await fetch(`${BASE}/videos/${encodeURIComponent(id)}`, {
		method: 'GET',
		headers: cabecalhos(),
		signal: juntarSinais(AbortSignal.timeout(TIMEOUT_CONSULTA_MS), signal),
	});
	const { dado, cru } = await lerJson<EstadoDoJob & RespostaDeErro>(res);
	if (!res.ok || !dado?.status) {
		throw new ErroDeVideo(
			'provedor',
			502,
			'Perdemos o contato com o gerador de vídeo.',
			`HTTP ${res.status}: ${dado?.error?.message ?? cru.slice(0, 200)}`,
		);
	}
	return dado;
}

/** Um MP4 válido começa com a caixa `ftyp` (4 bytes de tamanho + o rótulo). */
const TAMANHO_MINIMO_MP4 = 1_024;

export function conferirMp4(buf: Buffer): void {
	if (buf.byteLength < TAMANHO_MINIMO_MP4) {
		throw new ErroDeVideo(
			'download',
			502,
			'O vídeo foi gerado mas chegou vazio até nós. Tente de novo — nada foi cobrado.',
			`${buf.byteLength} bytes`,
		);
	}
	/**
	 * ⚠ ESTE É O TESTE QUE PAGA POR SI. Sem `Authorization` no download, o
	 * provedor devolve **200 com corpo vazio** — não 401 —, e o arquivo era
	 * gravado, arquivado e liquidado antes de alguém tentar assistir e ver
	 * "moov atom not found". Conferir a assinatura aqui transforma esse desfecho
	 * silencioso num erro que aciona o estorno.
	 */
	const rotulo = buf.subarray(4, 8).toString('latin1');
	if (rotulo !== 'ftyp') {
		throw new ErroDeVideo(
			'download',
			502,
			'O vídeo chegou corrompido até nós. Tente de novo — nada foi cobrado.',
			`assinatura '${rotulo}' em vez de 'ftyp'`,
		);
	}
}

/** Teto de tamanho do arquivo: 8 s de 1080p não passam disso nem de longe. */
const MAX_BYTES_MP4 = 120 * 1024 * 1024;

export async function baixarMp4(
	id: string,
	indice = 0,
	signal?: AbortSignal,
): Promise<Buffer> {
	const res = await fetch(
		`${BASE}/videos/${encodeURIComponent(id)}/content?index=${indice}`,
		{
			method: 'GET',
			/**
			 * ⚠ `cabecalhos()` e não um objeto vazio: o `Authorization` AQUI é o que
			 * separa um MP4 de um arquivo de 0 byte com HTTP 200.
			 */
			headers: cabecalhos(),
			signal: juntarSinais(AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS), signal),
		},
	);
	if (!res.ok) {
		throw new ErroDeVideo(
			'download',
			502,
			'O vídeo foi gerado mas não conseguimos baixá-lo. Tente de novo — nada foi cobrado.',
			`HTTP ${res.status}`,
		);
	}
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > MAX_BYTES_MP4) {
		throw new ErroDeVideo(
			'download',
			502,
			'O vídeo veio grande demais para ser publicado.',
			`${buf.byteLength} bytes`,
		);
	}
	conferirMp4(buf);
	return buf;
}

export interface ProgressoDoVideo {
	kind: 'video_ia';
	fase: 'enfileirado' | 'aguardando' | 'baixando';
	job_id?: string;
	status?: string;
	decorrido_s: number;
	prazo_s: number;
	consultas: number;
}

export interface VideoIAEntregue {
	mp4: Buffer;
	jobId: string;
	/** `usage.cost` do provedor — o custo REAL, não a estimativa da tabela. */
	custoUsd: number | null;
	consultas: number;
	ms: number;
}

/**
 * ESPERA O JOB E BAIXA. É aqui que mora a fila: o run do aluno não fica
 * pendurado no POST, ele fica num laço que RELATA a cada 5 s.
 *
 * Três desfechos, e todos LANÇAM quando não há vídeo (ver a doutrina do
 * dinheiro no topo): terminal ruim, prazo estourado e provedor fora do ar.
 */
export async function aguardarJob(
	id: string,
	opts: {
		prazoMs: number;
		iniciadoEm: number;
		signal?: AbortSignal;
		aoProgredir?: (ev: ProgressoDoVideo) => void;
		intervaloMs?: number;
	},
): Promise<{ estado: EstadoDoJob; consultas: number }> {
	const intervalo = opts.intervaloMs ?? INTERVALO_DE_CONSULTA_MS;
	let consultas = 0;
	let errosSeguidos = 0;

	while (true) {
		const decorrido = Date.now() - opts.iniciadoEm;
		if (decorrido > opts.prazoMs) {
			throw new ErroDeVideo(
				'prazo',
				504,
				`O gerador de vídeo passou de ${Math.round(opts.prazoMs / 1000)}s sem entregar. Tente de novo — nada foi cobrado.`,
				`job ${id} após ${consultas} consultas`,
			);
		}

		/**
		 * A ESPERA VEM ANTES DA CONSULTA. Consultar no instante zero devolveria
		 * `pending` garantido (a geração medida levou 42 s) e só gastaria uma
		 * chamada — e, pior, o primeiro `onProgress` sairia idêntico ao evento de
		 * enfileiramento que já saiu.
		 */
		try {
			await esperar(intervalo, undefined, { signal: opts.signal });
		} catch {
			throw new ErroDeVideo(
				'prazo',
				504,
				'A geração do vídeo foi interrompida. Tente de novo — nada foi cobrado.',
				`abortado no job ${id}`,
			);
		}

		let estado: EstadoDoJob;
		try {
			estado = await consultarJob(id, opts.signal);
			errosSeguidos = 0;
		} catch (err) {
			errosSeguidos += 1;
			if (errosSeguidos >= MAX_ERROS_SEGUIDOS) {
				throw err instanceof ErroDeVideo
					? err
					: new ErroDeVideo(
							'provedor',
							502,
							'Perdemos o contato com o gerador de vídeo. Tente de novo — nada foi cobrado.',
						);
			}
			consultas += 1;
			opts.aoProgredir?.({
				kind: 'video_ia',
				fase: 'aguardando',
				job_id: id,
				status: 'sem_resposta',
				decorrido_s: Math.round((Date.now() - opts.iniciadoEm) / 1000),
				prazo_s: Math.round(opts.prazoMs / 1000),
				consultas,
			});
			continue;
		}

		consultas += 1;
		opts.aoProgredir?.({
			kind: 'video_ia',
			fase: 'aguardando',
			job_id: id,
			status: estado.status,
			decorrido_s: Math.round((Date.now() - opts.iniciadoEm) / 1000),
			prazo_s: Math.round(opts.prazoMs / 1000),
			consultas,
		});

		if (estado.status === 'completed') return { estado, consultas };
		if (TERMINAIS_RUINS.has(estado.status)) {
			const detalhe = estado.error?.message ?? estado.status;
			const politica = /policy|safety|blocked|violat|prohibited/i.test(detalhe);
			throw new ErroDeVideo(
				politica ? 'politica' : 'provedor',
				politica ? 400 : 502,
				politica
					? 'O gerador de vídeo recusou este pedido por política de conteúdo. Ajuste a descrição do movimento e tente de novo.'
					: 'O gerador de vídeo não conseguiu terminar este vídeo. Tente de novo — nada foi cobrado.',
				`job ${id}: ${detalhe}`,
			);
		}
		/**
		 * `pending` e `in_progress` continuam o laço — e NÃO confie no
		 * `in_progress` como sinal de progresso: na corrida medida ele nunca
		 * apareceu, o job saltou de `pending` direto para `completed`.
		 */
	}
}

/** O caminho inteiro: enfileirar → esperar → baixar → conferir os bytes. */
export async function gerarVideoIA(
	corpo: CorpoDoPedido,
	opts: {
		prazoMs?: number;
		signal?: AbortSignal;
		aoProgredir?: (ev: ProgressoDoVideo) => void;
		intervaloMs?: number;
	} = {},
): Promise<VideoIAEntregue> {
	const iniciadoEm = Date.now();
	const prazoMs = Math.min(opts.prazoMs ?? PRAZO_PADRAO_MS, PRAZO_MAXIMO_MS);

	const job = await criarJob(corpo, opts.signal);
	opts.aoProgredir?.({
		kind: 'video_ia',
		fase: 'enfileirado',
		job_id: job.id,
		status: job.status ?? 'pending',
		decorrido_s: Math.round((Date.now() - iniciadoEm) / 1000),
		prazo_s: Math.round(prazoMs / 1000),
		consultas: 0,
	});

	const { estado, consultas } = await aguardarJob(job.id, {
		prazoMs,
		iniciadoEm,
		signal: opts.signal,
		aoProgredir: opts.aoProgredir,
		intervaloMs: opts.intervaloMs,
	});

	opts.aoProgredir?.({
		kind: 'video_ia',
		fase: 'baixando',
		job_id: job.id,
		status: estado.status,
		decorrido_s: Math.round((Date.now() - iniciadoEm) / 1000),
		prazo_s: Math.round(prazoMs / 1000),
		consultas,
	});

	const mp4 = await baixarMp4(job.id, 0, opts.signal);
	return {
		mp4,
		jobId: job.id,
		custoUsd: typeof estado.usage?.cost === 'number' ? estado.usage.cost : null,
		consultas,
		ms: Date.now() - iniciadoEm,
	};
}
