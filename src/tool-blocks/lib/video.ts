import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const pexec = promisify(execFile);

/**
 * VÍDEO — o motor do anúncio do Ateliê, separado do bloco.
 *
 * ┌─ O QUE ESTE ARQUIVO NÃO FAZ, E POR QUE NÃO DÁ PARA FAZER ───────────────┐
 * │ Ele NÃO gera vídeo por IA. O pedido do dono foi "vídeo de IA, mas        │
 * │ precisa ter no OpenRouter" — e o OpenRouter NÃO ENTREGA VÍDEO. Medido no │
 * │ catálogo: 399 modelos, saídas `text` (399), `image` (11), `audio` (4).   │
 * │ Vídeo: ZERO. Veo, Sora, Kling e Runway não estão lá.                     │
 * │                                                                          │
 * │ O que sobra — e é o que a maioria dos anúncios de produto realmente é —  │
 * │ é MOVIMENTO SOBRE A ARTE QUE O ATELIÊ JÁ GEROU: a câmera anda, o produto │
 * │ fica parado. Custa US$ 0,00 de fornecedor porque a imagem já foi paga.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A CÂMERA É DERIVA, NÃO ZOOM — e isso saiu de 14 vídeos assistidos ─────┐
 * │ Zoom sobre a arte do Ateliê DECAPITA A MANCHETE, sempre, e o defeito é   │
 * │ estrutural: manchete e logo moram nos CANTOS do 1:1. Zoom que fecha      │
 * │ termina cortado; zoom que abre COMEÇA cortado — e o primeiro quadro é a  │
 * │ capa no feed. É a mesma "manchete decapitada" que já custou uma rodada   │
 * │ no kit, voltando pela porta do vídeo.                                    │
 * │                                                                          │
 * │ A saída que sobrevive é a DERIVA: a arte inteira fica dentro da          │
 * │ INTERSEÇÃO de todos os quadros do percurso, e quem anda é a moldura      │
 * │ sobre um fundo desfocado. Manchete e logo ficam inteiros em TODOS os     │
 * │ quadros por CONSTRUÇÃO, não por sorte de enquadramento — ver a           │
 * │ invariante em `planejarTela`. Zoom fica travado em 1,0.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ARMADILHAS QUE JÁ CUSTARAM RODADA — todas com número ──────────────────┐
 * │ ① O sharp aplica `resize` ANTES de `extend`, não importa a ordem em que  │
 * │   você encadeia: `sharp(x).extend({top:398,bottom:398}).resize(1231,     │
 * │   2189)` devolve 1231×2985 — estica 20% na vertical e SÓ DEPOIS estende. │
 * │   A prova de conceito anterior saiu com o produto esbelto por causa      │
 * │   disso (erro médio 71,50 contra 2,99 na versão corrigida). O conserto é │
 * │   MATERIALIZAR o buffer entre as duas etapas — e vale para `composite`   │
 * │   também, que mordeu de novo pelo mesmo motivo.                          │
 * │                                                                          │
 * │ ② `-pix_fmt yuv420p` NÃO conserta sozinho quando há JPEG no meio: medido,│
 * │   continua saindo `yuvj420p` (faixa cheia, deprecado) e alguns players   │
 * │   desviam a cor. Aqui não há JPEG nenhum — o quadro vai CRU pelo stdin   │
 * │   do ffmpeg — e ainda assim a saída passa por `format=yuv420p` +         │
 * │   `setparams`, senão a stream sai "não-marcada" e cada player chuta o    │
 * │   espaço de cor.                                                         │
 * │                                                                          │
 * │ ③ Pan com folga zero é FOTO PARADA: se a tela tem exatamente o tamanho   │
 * │   do recorte, o clamp zera o deslocamento. Medido: 0,24 MB e 0,00% dos   │
 * │   bytes mudando entre o primeiro e o último quadro.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/* ───────────────────────── a receita medida ───────────────────────── */

/**
 * 30 quadros por segundo. Não é gosto: a especificação de publicação do
 * Instagram aceita 23–60 fps, e abaixo de 30 a qualidade medida despenca —
 * VMAF 94,2 a 30 fps contra 86,5 a 24 e 83,8 a 15.
 *
 * E interpolar quadro NÃO substitui gerar: `minterpolate mci` custou 13,8 s
 * (9× o render inteiro) para entregar VMAF 78,0, ABAIXO do 15 fps puro.
 */
export const FPS = 30;

/**
 * Duração. O piso é da plataforma (o Instagram recusa Reels com menos de 3 s) e
 * o teto também (60 s). O padrão de 5 s saiu de assistir: 3 s não dá tempo de
 * ler nada, e 8 s de câmera lenta sem texto enjoa.
 */
export const DURACAO_MINIMA_S = 3;
export const DURACAO_MAXIMA_S = 60;
export const DURACAO_PADRAO_S = 5;

/**
 * `crf 20` e não 23. Medido, 23 ainda presta (VMAF 92,8 contra 94,2 do 21) e
 * pesa metade — mas a PLATAFORMA RE-COMPRIME o que recebe, e 1 MB não é
 * dinheiro nenhum. A margem contra a perda de geração vale mais que o byte.
 * `ultrafast` está fora: 4,02 MB, 7× maior, pelo mesmo tempo de parede.
 */
export const CRF = 20;
export const PRESET = 'veryfast';

/**
 * Dois threads no ffmpeg. Custa +10% de tempo de parede (2,32 s contra 2,10 s)
 * e ECONOMIZA ~130 MB por vídeo (389 MB com 8 threads, 262 MB com 2). Como o
 * gargalo medido é o sharp e não o ffmpeg (75%/25% do tempo), os threads a mais
 * compram pouco e custam a RAM que derruba o contêiner.
 */
export const THREADS_FFMPEG = 2;

/**
 * Teto de vídeos SIMULTÂNEOS no processo.
 *
 * Não é para ganhar vazão — ela é PLANA: medido, 1 a 6 vídeos concorrentes
 * entregam os mesmos ~0,65 vídeo/s, e em 8 a vazão PIORA (thrashing). É para o
 * teto de RAM: cada vídeo em voo custa ~480 MB de pico, e num contêiner de 2 GB
 * quatro alunos ao mesmo tempo matam a API inteira por OOM — e não é o vídeo
 * que morre, é o processo.
 */
export const VIDEOS_EM_VOO = 2;

/**
 * Teto do encode. Um ffmpeg travado não pode segurar o run para sempre: o
 * aluno está esperando uma resposta HTTP. 90 s é ~30× o pior caso medido
 * (3,12 s para 8 s em 1080×1920), folga suficiente para uma máquina lenta sem
 * virar espera eterna.
 */
export const TIMEOUT_FFMPEG_MS = 90_000;

/** Teto da sondagem de versão. Se o binário não responde em 5 s, ele não serve. */
const TIMEOUT_VERSAO_MS = 5_000;

/**
 * Velocidade de leitura. O padrão de legenda é ~17 caracteres por segundo
 * (160–180 palavras por minuto). O contra-exemplo medido: um vídeo com o título
 * a 29 c/s e a chamada a 55 c/s — texto que aparece e some antes de dar para
 * ler, e o vídeo ainda fica 40% do tempo sem texto nenhum.
 */
export const CARACTERES_POR_SEGUNDO = 17;

/** Quando cada fala entra. "Entra até 1,4 s e NÃO SAI MAIS" — regra de assistir. */
const ENTRADA_S = [0.4, 1.4];
/** Tempo do fade de entrada de cada fala. */
const FADE_S = 0.6;

/**
 * Quanto a tela cresce ALÉM do formato, no eixo do movimento. 14% em 1920
 * dá 269 px de curso — deriva visível (84,6% dos bytes mudam entre o primeiro
 * e o último quadro) sem a câmera parecer que está fugindo da arte.
 */
const FOLGA_DA_DERIVA = 1.14;

/**
 * Lado mínimo da entrega. O guia de Reels do Facebook pede 540×960; abaixo
 * disso a peça sai borrada na tela do celular e não vale publicar.
 */
const LADO_MINIMO_VIDEO = 540;

/**
 * Quanto se aceita AMPLIAR a arte para chegar no tamanho nominal do formato.
 *
 * O kit tem regra dura de "nunca amplia" — aqui não dá para segui-la ao pé da
 * letra, porque vídeo tem tamanho nominal e a arte do Ateliê sai 1024², que é
 * 1,055× menor que os 1080 px de largura do Reels. Essa ampliação foi assistida
 * e não aparece. 3× apareceria: viraria papa. O teto separa os dois casos.
 */
const AMPLIACAO_MAXIMA = 1.5;

/* ───────────────────────── formatos ───────────────────────── */

/**
 * Os formatos de VÍDEO. As proporções são as mesmas do `KIT_FORMATOS` de
 * propósito — o vídeo nasce das mesmas peças que o kit deriva —, mas aqui elas
 * precisam virar PIXEL: vídeo tem tamanho nominal, imagem não tem.
 *
 * `zona_segura` é a área do quadro onde texto pode morar, em fração do lado.
 * No 9:16 ela NÃO é simétrica e não é estética: medido na captura do Reels, a
 * faixa de interface (legenda, áudio, botões) começa em y=1600 e o limite
 * recomendado é y=1500 — texto abaixo disso fica atrás da UI do Instagram. A
 * coluna de ~120 px à direita é dos botões de curtir/comentar/enviar.
 */
export const FORMATOS_DE_VIDEO = {
	story_9x16: {
		rotulo: 'Story e Reels',
		largura: 1080,
		altura: 1920,
		zona_segura: { topo: 0.081, base: 0.781, esq: 0.067, dir: 0.852 },
	},
	feed_1x1: {
		rotulo: 'Feed quadrado',
		largura: 1080,
		altura: 1080,
		zona_segura: { topo: 0.06, base: 0.94, esq: 0.06, dir: 0.94 },
	},
	retrato_4x5: {
		rotulo: 'Feed retrato',
		largura: 1080,
		altura: 1350,
		zona_segura: { topo: 0.06, base: 0.94, esq: 0.06, dir: 0.94 },
	},
	capa_16x9: {
		rotulo: 'Capa e YouTube',
		largura: 1920,
		altura: 1080,
		zona_segura: { topo: 0.06, base: 0.94, esq: 0.06, dir: 0.94 },
	},
} as const;

export type FormatoDeVideo = keyof typeof FORMATOS_DE_VIDEO;

export const FORMATO_DE_VIDEO_KEYS = Object.keys(FORMATOS_DE_VIDEO) as [
	FormatoDeVideo,
	...FormatoDeVideo[],
];

/* ───────────────────────── o binário opcional ───────────────────────── */

export interface FfmpegNaMaquina {
	ok: boolean;
	/** Caminho usado (respeita `FFMPEG_PATH`, para contêiner com layout próprio). */
	caminho: string;
	/** Primeira linha do `-version`, para o log e para o resumo. */
	versao?: string;
	/** Em português, porque isto CHEGA NA TELA quando o vídeo não sai. */
	motivo?: string;
}

let ffmpegDetectado: Promise<FfmpegNaMaquina> | null = null;

/**
 * O FFMPEG É OPCIONAL, E ESSA É A REGRA MAIS IMPORTANTE DESTE ARQUIVO.
 *
 * A máquina de dev pode não ter o binário, e um run que morre 500 porque faltou
 * um executável opcional é o pior desfecho possível: o vídeo é um EXTRA, a arte
 * é o produto — e a arte já foi paga quando este código roda. Sem ffmpeg o
 * bloco devolve sem vídeo e DIZ POR QUÊ, do mesmo jeito que o kit recusa um
 * formato dizendo por quê.
 *
 * O resultado é memoizado porque o binário não aparece nem some no meio da vida
 * do processo, e sondar a cada run seria um `spawn` a mais por vídeo.
 */
export function acharFfmpeg(): Promise<FfmpegNaMaquina> {
	ffmpegDetectado ??= (async () => {
		const caminho = process.env.FFMPEG_PATH || 'ffmpeg';
		try {
			const { stdout } = await pexec(caminho, ['-version'], {
				timeout: TIMEOUT_VERSAO_MS,
			});
			return { ok: true, caminho, versao: stdout.split('\n')[0]?.trim() };
		} catch (e) {
			const err = e as NodeJS.ErrnoException;
			return {
				ok: false,
				caminho,
				motivo:
					err.code === 'ENOENT'
						? 'O servidor está sem o ffmpeg instalado, então o vídeo não pôde ser montado. A arte e o kit saíram normalmente.'
						: `O ffmpeg deste servidor não respondeu (${err.code ?? err.message}). A arte e o kit saíram normalmente.`,
			};
		}
	})();
	return ffmpegDetectado;
}

/** Só para o teste: obriga a próxima chamada a sondar o binário de novo. */
export function esquecerFfmpeg(): void {
	ffmpegDetectado = null;
	fontesDetectadas = null;
}

/* ───────────────────────── as fontes (armadilha de Alpine) ───────────────────────── */

let fontesDetectadas: Promise<boolean> | null = null;

/**
 * TEM FONTE NESTA MÁQUINA?
 *
 * O texto do vídeo sai de SVG pelo sharp, e o sharp desenha glifo com as fontes
 * DO SISTEMA. No macOS do dev há 1.852 delas; num contêiner Alpine limpo há
 * ~zero — e sem fonte o `<text>` não vira erro, vira NADA: o vídeo sai com o
 * fundo escurecido e nenhuma letra. É exatamente a classe de quebra do
 * `ffmpeg-static` (instala sem erro, falha só em produção).
 *
 * O Dockerfile instala `ttf-dejavu`, então em produção isto passa. Esta sonda é
 * o cinto: desenha uma letra num quadro minúsculo e confere se saiu tinta. Se
 * não saiu, o vídeo sai SEM TEXTO e diz por quê, em vez de entregar um retângulo
 * preto vazio no rodapé do anúncio.
 */
export function temFontes(): Promise<boolean> {
	fontesDetectadas ??= (async () => {
		try {
			const svg = Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60">' +
					'<text x="4" y="46" font-family="Helvetica,Arial,sans-serif" font-size="44" fill="#000">Wg</text></svg>',
			);
			const s = await sharp(svg).ensureAlpha().stats();
			// canal 3 = alfa. Máximo 0 significa que nenhum pixel foi pintado.
			return (s.channels[3]?.max ?? 0) > 0;
		} catch {
			return false;
		}
	})();
	return fontesDetectadas;
}

/* ───────────────────────── a fila de vagas ───────────────────────── */

let emVoo = 0;
const esperando: (() => void)[] = [];

/**
 * Uma vaga para codificar.
 *
 * FILA, e não recusa: recusar devolveria erro ao aluno por um problema de
 * capacidade do servidor, e a espera medida é de ~2 s por vídeo à frente. O que
 * não pode acontecer é o quinto aluno entrar junto com os outros quatro e
 * levar o processo inteiro por OOM (~480 MB de pico cada).
 */
export async function comVagaDeVideo<T>(fn: () => Promise<T>): Promise<T> {
	if (emVoo >= VIDEOS_EM_VOO) {
		await new Promise<void>((r) => esperando.push(r));
	}
	emVoo++;
	try {
		return await fn();
	} finally {
		emVoo--;
		esperando.shift()?.();
	}
}

/* ───────────────────────── geometria da deriva ───────────────────────── */

export interface PlanoDaTela {
	/** Eixo em que a câmera anda. */
	eixo: 'y' | 'x';
	/** O quadro entregue (já par, exigência do yuv420p). */
	largura: number;
	altura: number;
	/** A tela inteira, de onde os quadros são recortados. */
	tela_largura: number;
	tela_altura: number;
	/** Curso disponível, em pixels da tela. Zero = foto parada (ver armadilha ③). */
	curso: number;
	/** A ARTE NÍTIDA dentro da tela — posição e tamanho. */
	arte_esq: number;
	arte_topo: number;
	arte_largura: number;
	arte_altura: number;
	/** Quanto de um quadro é fundo desfocado (0 = a arte cobre tudo). */
	fracao_de_fundo: number;
	/** Quanto a arte foi ampliada para chegar no quadro (1 = nada). */
	ampliacao: number;
	/**
	 * A FAIXA LIVRE DE TEXTO, em coordenadas do QUADRO. Altura zero = não há
	 * faixa e nenhuma letra pode ser escrita. Ver `reservarFaixa`.
	 */
	faixa_topo: number;
	faixa_altura: number;
}

const par = (n: number): number => (n % 2 === 0 ? n : n - 1);

/**
 * ┌─ A FAIXA DE TEXTO — o defeito que ela existe para matar ────────────────┐
 * │ Antes disto o texto era ancorado no RODAPÉ DA ZONA SEGURA (y=1500 no     │
 * │ Reels) e ficava PARADO, enquanto a arte DESCIA 268 px em 5 s. Medido numa │
 * │ arte 1:1 em 9:16: a arte ocupa y 286..1366 no primeiro quadro e           │
 * │ 554..1634 no último; o bloco de texto vive em ~1255..1500. Ou seja, o     │
 * │ texto ENTRA já 26% em cima do produto e TERMINA 100% em cima dele —       │
 * │ cobrindo justamente a gravação personalizada que o anúncio existe para    │
 * │ vender ("MARIA & JOÃO 2024", o "2026" do troféu).                         │
 * │                                                                          │
 * │ E o mesmo cálculo mostrava o segundo defeito: a base da arte terminava em │
 * │ y=1634, 134 px DENTRO da faixa de legenda/áudio do Instagram — e é na     │
 * │ base da arte que mora o LOGO DO ALUNO, carimbado pelo `image.brandmark`.  │
 * │                                                                          │
 * │ O conserto não é mover o texto: é RESERVAR. A arte sobe até o topo útil   │
 * │ do quadro e a faixa que sobra embaixo, dentro da zona segura, é onde o    │
 * │ texto mora — uma região por onde a arte NUNCA passa, em nenhum instante.  │
 * │ Se a reserva não couber, a arte encolhe até `ENCOLHIMENTO_MAXIMO`; se     │
 * │ ainda assim não couber, NÃO HÁ TEXTO — e o aviso diz isso ao aluno.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Quanto a câmera pode desacelerar para abrir a faixa. Piso, não alvo: abaixo
 * de ~8,5% do lado o movimento deixa de ser percebido e o clipe vira foto.
 */
const CURSO_MINIMO = 0.085;
/** Respiro entre o topo do quadro e a arte, no instante em que ela está mais alta. */
const MARGEM_DO_TOPO = 0.02;
/**
 * Quanto a arte pode encolher para o texto caber. 10% de lado é invisível ao
 * olho (a arte já flutua sobre fundo desfocado); 20% já lê como "moldurada",
 * que é exatamente a reclamação que a arte 9:16 recebeu ao ser assistida.
 */
const ENCOLHIMENTO_MAXIMO = 0.1;

/**
 * A conta inteira da deriva, sem tocar em pixel — separada para poder ser
 * conferida no teste sem ffmpeg, sem arte de verdade e sem esperar encode.
 *
 * ┌─ A INVARIANTE QUE ESTA FUNÇÃO GARANTE ──────────────────────────────────┐
 * │ A ARTE INTEIRA APARECE EM TODOS OS QUADROS. Não "quase", não "no miolo": │
 * │ a arte é dimensionada para caber na INTERSEÇÃO de todos os quadros que a │
 * │ deriva vai percorrer. Manchete e logo, que moram nos cantos do 1:1,      │
 * │ ficam inteiros do primeiro ao último quadro por CONSTRUÇÃO.              │
 * │                                                                          │
 * │ A conta: o quadro anda `curso` px dentro de uma tela de `H + curso`, logo │
 * │ a região visível em TODO instante tem `H − curso` px. É esse o teto da   │
 * │ arte no eixo do movimento.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function planejarTela(
	arteW: number,
	arteH: number,
	formato: FormatoDeVideo,
	/**
	 * Quanta faixa livre o texto PEDE, em pixels do quadro. Zero (o padrão) é
	 * "clipe sem texto": a arte fica centrada e a câmera anda o curso inteiro.
	 */
	faixaPedida = 0,
	folga = FOLGA_DA_DERIVA,
): { plano: PlanoDaTela } | { recusa: string } {
	const f = FORMATOS_DE_VIDEO[formato];
	if (arteW < 1 || arteH < 1) return { recusa: 'A arte chegou vazia.' };

	/**
	 * O EIXO DO MOVIMENTO é o eixo que sobra depois de a arte caber no formato.
	 * Empate (arte já na proporção do formato) vai para o eixo do lado maior:
	 * peça em pé deriva na vertical, peça deitada deriva na horizontal.
	 */
	const arAlvo = f.largura / f.altura;
	const arArte = arteW / arteH;
	const eixo: 'y' | 'x' =
		arArte > arAlvo || (arArte === arAlvo && f.altura >= f.largura) ? 'y' : 'x';

	/** Toda a geometria é LINEAR na escala — por isso um passe basta para corrigir. */
	const montar = (escala: number) => {
		const largura = par(Math.round(f.largura * escala));
		const altura = par(Math.round(f.altura * escala));
		const telaLargura =
			eixo === 'y' ? largura : par(Math.round(largura * folga));
		const telaAltura = eixo === 'y' ? par(Math.round(altura * folga)) : altura;
		const curso = eixo === 'y' ? telaAltura - altura : telaLargura - largura;

		/**
		 * O TETO DA ARTE: o que a interseção de todos os quadros comporta. Se a
		 * arte couber inteira abaixo dele (o caso do 1:1 num 9:16), ela entra no
		 * tamanho natural e o resto do quadro é fundo. Se não couber — arte que já
		 * é quase da proporção do formato —, ela ENCOLHE, e encolher é o preço de
		 * a manchete não ser cortada. Cortar seria o defeito; 14% de lado, não.
		 */
		const limite = eixo === 'y' ? altura - curso : largura - curso;

		/**
		 * ⚠ SÃO DOIS EIXOS COM PAPÉIS DIFERENTES, e trocá-los custou uma medição:
		 *
		 *  · o TRANSVERSAL (o que não anda) a arte preenche INTEIRO — é dele que
		 *    vem "nada é cortado nas laterais";
		 *  · o DO MOVIMENTO tem o teto `limite`, que é a interseção dos quadros.
		 *
		 * A primeira versão dimensionava a deriva horizontal pelo `limite` nos
		 * DOIS eixos e devolvia uma arte de 1652×1652 para uma tela de 2188×1080:
		 * o `composite` recusou com "Image to composite must have same dimensions
		 * or smaller" e o 16:9 saía como formato recusado, em todo run.
		 */
		let arteLargura: number;
		let arteAltura: number;
		/**
		 * O CURSO SAIU DO TAMANHO DA ARTE? É esta a bandeira, e ela decide o
		 * enquadramento logo abaixo — ver a caixa em `folgaApertada`.
		 */
		let apertado = false;
		if (eixo === 'y') {
			arteLargura = largura;
			arteAltura = Math.round(largura / arArte);
			if (arteAltura > limite) {
				arteAltura = limite;
				arteLargura = Math.round(limite * arArte);
				apertado = true;
			}
		} else {
			arteAltura = altura;
			arteLargura = Math.round(altura * arArte);
			if (arteLargura > limite) {
				arteLargura = limite;
				arteAltura = Math.round(limite / arArte);
				apertado = true;
			}
		}

		return {
			largura,
			altura,
			telaLargura,
			telaAltura,
			curso,
			arteLargura,
			arteAltura,
			apertado,
			ampliacao: arteLargura / arteW,
		};
	};

	/**
	 * ESCALA DA ENTREGA. O nominal do formato manda, EXCETO quando ele exigiria
	 * ampliar a arte além do teto — aí o vídeo inteiro encolhe junto, porque
	 * entregar 1080 px de papa não é entregar 1080 px.
	 */
	/**
	 * ┌─ QUANDO A DERIVA É PAGA PELA ARTE, ELA ANDA O MÍNIMO ───────────────────┐
	 * │ Há dois regimes, e o mesmo número servia mal aos dois:                   │
	 * │                                                                          │
	 * │  · ARTE COM EIXO SOBRANDO (1:1 num 9:16): o curso sai do espaço VAZIO    │
	 * │    que já ia virar fundo. A arte fica em 1080 de largura de qualquer     │
	 * │    jeito, então andar 14% é de graça — e é dele que veio o número.       │
	 * │  · ARTE NA PROPORÇÃO DO FORMATO (1:1 no feed 1:1, 9:16 no Reels): não há │
	 * │    espaço sobrando. Cada pixel de curso sai do TAMANHO DA ARTE, e o      │
	 * │    preço aparece como barra borrada dos dois lados.                      │
	 * │                                                                          │
	 * │ Medido, arte 1:1 no feed 1:1: com 14% a arte cai para 930×930 num quadro │
	 * │ de 1080 — 75 px de barra de cada lado, 13,9% da largura. Numa arte de    │
	 * │ fundo claro (as do Ateliê são) a barra é cinza-escura e lê-se como       │
	 * │ MOLDURA: a peça parece colada num retângulo, não um anúncio de tela      │
	 * │ cheia. Foi a reclamação que a arte 9:16 recebeu ao ser assistida (76 px  │
	 * │ medidos lá, o mesmo defeito pelo mesmo motivo).                          │
	 * │                                                                          │
	 * │ Neste regime, então, gasta-se o MÍNIMO PERCEPTÍVEL (`CURSO_MINIMO`, que  │
	 * │ existe justamente como piso do que o olho ainda nota) em vez do valor    │
	 * │ generoso: a barra cai de 13,9% para 8,5% e o fundo de 26% para 16%.      │
	 * │                                                                          │
	 * │ Não corta nada e não mexe em NENHUM outro caso: medido nos quatro        │
	 * │ formatos × três proporções de arte, todo caso de eixo sobrando devolve   │
	 * │ geometria idêntica à de antes. As barras largas do 16:9 continuam — ali  │
	 * │ elas são da diferença de proporção, não da câmera, e curso nenhum as     │
	 * │ resolve.                                                                 │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	const folgaApertada = 1 + CURSO_MINIMO;
	let g = montar(1);
	if (g.apertado && folga > folgaApertada) {
		folga = folgaApertada;
		g = montar(1);
	}
	if (g.ampliacao > AMPLIACAO_MAXIMA)
		g = montar(AMPLIACAO_MAXIMA / g.ampliacao);

	if (Math.min(g.largura, g.altura) < LADO_MINIMO_VIDEO) {
		return {
			recusa:
				'Esta arte é pequena demais para virar vídeo de publicação — ampliá-la até o tamanho do Reels deixaria a peça borrada.',
		};
	}
	if (g.curso < 8) {
		return {
			recusa:
				'Não sobrou espaço para a câmera andar neste formato — o vídeo sairia uma foto parada.',
		};
	}

	/**
	 * A RESERVA DA FAIXA — só na deriva vertical, e por um motivo de forma: o
	 * bloco de texto é uma pilha de linhas ancorada no rodapé. Numa deriva
	 * HORIZONTAL a folga que sobra é uma coluna estreita na lateral, e enfiar
	 * manchete numa coluna de 230 px é pior do que não escrever nada. Nos
	 * formatos deitados (`capa_16x9`) o clipe sai limpo, e o aviso diz por quê.
	 */
	let curso = g.curso;
	let arteAltura = g.arteAltura;
	let arteLargura = g.arteLargura;
	let faixaAltura = 0;

	if (faixaPedida > 0 && eixo === 'y') {
		const zFim = f.zona_segura.base * g.altura;
		const margem = MARGEM_DO_TOPO * g.altura;
		const cursoMinimo = Math.round(CURSO_MINIMO * g.altura);

		// ① a câmera desacelera até o piso, se isso abrir espaço
		curso = Math.min(
			g.curso,
			Math.max(cursoMinimo, Math.round(zFim - margem - arteAltura - faixaPedida)),
		);
		let sobra = zFim - margem - curso - arteAltura;

		// ② e só então a arte encolhe — no máximo `ENCOLHIMENTO_MAXIMO`
		if (sobra < faixaPedida) {
			const encolhe = Math.min(
				Math.round(arteAltura * ENCOLHIMENTO_MAXIMO),
				Math.ceil(faixaPedida - sobra),
			);
			if (encolhe > 0) {
				arteAltura -= encolhe;
				arteLargura = Math.round(arteAltura * arArte);
				sobra += encolhe;
			}
		}
		faixaAltura = Math.max(0, Math.min(faixaPedida, Math.floor(sobra)));

		/**
		 * ⚠ NÃO ENCOLHER A ARTE POR NADA. Se o que sobrou não dá nem para a
		 * primeira linha, a faixa não serve e o preço já foi pago — devolve-se a
		 * geometria cheia. Quem decide se ainda há texto é o chamador, que
		 * repete a conta com `faixaPedida = 0`.
		 */
		if (faixaAltura <= 0) {
			curso = g.curso;
			arteAltura = g.arteAltura;
			arteLargura = g.arteLargura;
		}
	}

	const telaLargura = eixo === 'y' ? g.largura : g.largura + curso;
	const telaAltura = eixo === 'y' ? g.altura + curso : g.altura;

	/**
	 * A ARTE SOBE PARA ABRIR A FAIXA. Sem faixa ela fica centrada, como sempre.
	 * O `clamp` é a invariante: `arte_topo` nunca desce abaixo de `curso` (senão
	 * o topo da arte sai pela borda no primeiro quadro) nem sobe acima de
	 * `altura − arte_altura` (senão o rodapé sai no último).
	 */
	const arteTopo =
		faixaAltura > 0
			? Math.min(
					Math.max(
						Math.round(f.zona_segura.base * g.altura - faixaAltura - arteAltura),
						curso,
					),
					g.altura - arteAltura,
				)
			: Math.round((telaAltura - arteAltura) / 2);

	const areaQuadro = g.largura * g.altura;
	return {
		plano: {
			eixo,
			largura: g.largura,
			altura: g.altura,
			tela_largura: telaLargura,
			tela_altura: telaAltura,
			curso,
			arte_esq: Math.round((telaLargura - arteLargura) / 2),
			arte_topo: eixo === 'y' ? arteTopo : Math.round((telaAltura - arteAltura) / 2),
			arte_largura: arteLargura,
			arte_altura: arteAltura,
			fracao_de_fundo: Math.max(0, 1 - (arteLargura * arteAltura) / areaQuadro),
			ampliacao: arteLargura / arteW,
			// em coordenadas do QUADRO: onde a arte, no seu instante mais baixo,
			// deixa de existir. Nada é desenhado acima disto.
			faixa_topo: faixaAltura > 0 ? arteTopo + arteAltura : 0,
			faixa_altura: faixaAltura,
		},
	};
}

/**
 * Desfoque do fundo, em fração da largura da tela.
 *
 * 5,5% de 1080 = 59 px de sigma, e o número saiu de OLHAR: a 3% (32 px) a
 * manchete vermelha da própria arte ainda se LIA no fundo, ampliada pelo
 * `cover` — o vídeo aparecia com a chamada escrita duas vezes, uma nítida e
 * uma borrada. É a mesma redundância que o portão de texto existe para evitar,
 * entrando pela porta do fundo. A 5,5% resta cor e luz, não palavra.
 */
const DESFOQUE_DO_FUNDO = 0.055;
/** Quanto o fundo escurece, para a arte nítida saltar dele. */
const ESCURECIMENTO_DO_FUNDO = 0.5;

/**
 * A TELA EM PIXELS: fundo DESFOCADO cobrindo tudo, arte nítida por cima.
 *
 * ┌─ POR QUE FUNDO DESFOCADO E NÃO BORDA REPLICADA ─────────────────────────┐
 * │ O kit completa formato replicando a linha extrema da arte, e faz certo:  │
 * │ ali a peça é um ARQUIVO PARADO e a réplica passa despercebida quando a   │
 * │ borda é lisa. Aqui NÃO SERVE, e a medição é direta:                      │
 * │                                                                          │
 * │  · o portão do kit (`avaliarExtensao`) RECUSA 9:16 nas QUATRO artes reais │
 * │    do Ateliê — o teto de aspereza para uma faixa de 44% é 3,0 e as artes  │
 * │    medem 4,24 (copo), 4,19 (placa), 4,64 (tábua) e 8,55 (troféu). Isto é, │
 * │    o formato-carro-chefe do pedido do dono (Reels) NUNCA SAIRIA;          │
 * │  · e ele recusa CERTO: assistindo, a borda replicada do troféu (quina de  │
 * │    mesa) ESTRIA visivelmente, e em movimento a estria escorre pela tela.  │
 * │                                                                          │
 * │ Desfoque não tem esse problema por CONSTRUÇÃO: não há estrutura para      │
 * │ esticar, então não há rastro para aparecer — vale igual para borda lisa   │
 * │ e para borda agitada, e não precisa de portão nenhum. É também o que a    │
 * │ plataforma inteira faz com foto quadrada em Reels.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Os `toBuffer()` no meio NÃO são desperdício — são o conserto da armadilha
 * ①: o sharp aplica `resize` ANTES de `composite`/`extend`, não importa a ordem
 * do encadeamento, e sem materializar a arte volta esticada.
 */
async function montarTela(
	arte: Buffer,
	plano: PlanoDaTela,
): Promise<{ dados: Buffer; largura: number; altura: number }> {
	/**
	 * `fit: 'cover'` e não `fill`: o fundo é um recorte AMPLIADO da arte, e
	 * esticá-lo deformaria as manchas de cor que ainda se enxergam através do
	 * desfoque. `flatten` antes de tudo porque alfa vira PRETO no vídeo.
	 */
	const fundo = await sharp(arte)
		.flatten({ background: '#ffffff' })
		.resize(plano.tela_largura, plano.tela_altura, {
			fit: 'cover',
			position: 'centre',
		})
		.blur(Math.max(1, plano.tela_largura * DESFOQUE_DO_FUNDO))
		.modulate({ brightness: ESCURECIMENTO_DO_FUNDO })
		.removeAlpha()
		.png()
		.toBuffer();

	const nitida = await sharp(arte)
		.flatten({ background: '#ffffff' })
		.resize(plano.arte_largura, plano.arte_altura, { fit: 'fill' })
		.removeAlpha()
		.png()
		.toBuffer();

	const { data, info } = await sharp(fundo)
		.composite([{ input: nitida, left: plano.arte_esq, top: plano.arte_topo }])
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	return { dados: data, largura: info.width, altura: info.height };
}

/* ───────────────────────── o texto ───────────────────────── */

export interface Fala {
	texto: string;
	/** Manda no corpo da letra e no peso. */
	estilo: 'titulo' | 'chamada';
	/** Já quebrado em linhas. */
	linhas: string[];
}

export interface PlanoDeTexto {
	falas: Fala[];
	/** O que foi cortado e por quê — vai inteiro para a tela. */
	avisos: string[];
}

const semAcento = (s: string): string =>
	s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * FORA OS EMOJI — e não é gosto, é glifo que não existe.
 *
 * O Redator escreve legenda de Instagram, e emoji em legenda de Instagram é a
 * regra. Só que o texto do vídeo é desenhado pelo sharp com as fontes DO
 * SISTEMA, e nenhuma delas entrega emoji COLORIDO por aqui: medido no macOS do
 * dev, `Promoção 😀🔥 hoje` sai com as duas figuras como MANCHAS BRANCAS
 * SÓLIDAS, e `Frete ✅ grátis` vira um retângulo branco. No Alpine do contêiner,
 * que tem só o DejaVu, o desfecho é o outro: `.notdef`, a caixinha vazia.
 *
 * A sonda `temFontes()` NÃO protege disto — ela pergunta "existe alguma
 * fonte?", desenhando `Wg`, e o DejaVu responde que sim. Tirar o caractere é o
 * único conserto que vale nas duas máquinas. `Extended_Pictographic` cobre os
 * três casos medidos (😀 U+1F600, 🔥 U+1F525, ✅ U+2705, ➜ U+279C); os
 * seletores de variação e o ZWJ vão junto para não deixar sobra invisível.
 */
const semEmoji = (s: string): string =>
	s
		.replace(
			/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍︎️]/gu,
			'',
		)
		.replace(/\s+/g, ' ')
		.trim();

const escaparXml = (s: string): string =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

/** Quebra por contagem de caracteres — sem métrica de fonte, ver `POR_CARACTERE`. */
function quebrar(txt: string, max: number): string[] {
	const linhas: string[] = [];
	let atual = '';
	for (const palavra of txt.split(/\s+/).filter(Boolean)) {
		if (!atual) {
			atual = palavra;
		} else if (`${atual} ${palavra}`.length > max) {
			linhas.push(atual);
			atual = palavra;
		} else {
			atual = `${atual} ${palavra}`;
		}
	}
	if (atual) linhas.push(atual);
	return linhas;
}

/**
 * Largura média de um caractere, em fração do corpo da letra.
 *
 * É ESTIMATIVA, e de propósito: medir de verdade exigiria métrica de fonte
 * (opentype.js e amigos), dependência nova para resolver um problema que a
 * folga resolve. 0,56 é conservador — a Helvetica média fica em ~0,52 —, então
 * a linha erra para o lado de sobrar margem, nunca para o de vazar da zona
 * segura.
 */
const POR_CARACTERE = 0.56;

/**
 * O QUE ENTRA NA TELA — e o que NÃO entra, com o motivo.
 *
 * Três portões, todos vindos de assistir vídeo ruim:
 *
 *  ① REDUNDÂNCIA. A arte do Ateliê já tem texto ASSADO nela (`texto_na_arte`).
 *    Escrever "Copo inox preto para o amigo secreto" por cima de uma arte que
 *    já diz "AMIGO SECRETO" é o vídeo repetindo o que a imagem mostra.
 *
 *  ② TEMPO DE LEITURA. Uma fala precisa de `caracteres ÷ 17` segundos NA TELA.
 *    Quem não cabe no que resta do clipe não entra — melhor sem a chamada do
 *    que com a chamada piscando.
 *
 *  ③ A FAIXA LIVRE. O texto mora na faixa por onde a arte NUNCA passa — ver a
 *    caixa em `planejarTela`. Quem não couber nela fica de fora, porque o
 *    lugar seguinte seria em cima da gravação do produto.
 */
export function planejarTexto(opts: {
	titulo?: string | null;
	chamada?: string | null;
	texto_na_arte?: string | null;
	duracao_s: number;
	largura: number;
	altura: number;
	formato: FormatoDeVideo;
	/**
	 * Altura da faixa livre, em pixels do quadro (de `planejarTela`). Ausente =
	 * ainda não se sabe a geometria: vale o teto antigo, metade da zona segura.
	 * É essa a primeira das duas passadas que o bloco faz — a que descobre
	 * QUANTA faixa pedir.
	 */
	faixa?: number;
}): PlanoDeTexto {
	const avisos: string[] = [];
	const z = FORMATOS_DE_VIDEO[opts.formato].zona_segura;
	const larguraUtil = (z.dir - z.esq) * opts.largura;
	const corpoTitulo = opts.largura * 0.072;
	const corpoChamada = opts.largura * 0.037;

	const naArte = semAcento(opts.texto_na_arte ?? '');
	const candidatos: { texto: string; estilo: 'titulo' | 'chamada' }[] = [];
	for (const [texto, estilo] of [
		[opts.titulo, 'titulo'] as const,
		[opts.chamada, 'chamada'] as const,
	]) {
		const limpo = semEmoji((texto ?? '').replace(/\s+/g, ' ').trim());
		if (!limpo) continue;

		/**
		 * ① a arte já diz isso.
		 *
		 * O piso é 8 caracteres e não 4: com 4, `texto_na_arte = "2026"` derrubava
		 * o título INTEIRO de qualquer peça que mencionasse o ano — "Troféu
		 * Campeonato 2026" sumia por causa de uma substring de quatro letras, com
		 * o aviso genérico "a arte já mostra esse mesmo texto". Oito é curto o
		 * bastante para "AMIGO SECRETO" continuar barrando e longo o bastante
		 * para ano, número e sigla não barrarem nada.
		 */
		const n = semAcento(limpo);
		if (naArte.length >= 8 && (n.includes(naArte) || naArte.includes(n))) {
			avisos.push(
				'Uma das frases não entrou no vídeo porque a arte já mostra esse mesmo texto — repetir tiraria a atenção do produto.',
			);
			continue;
		}
		candidatos.push({ texto: limpo, estilo });
	}

	// ② tempo de leitura, na ordem em que as falas vão entrar
	const falas: Fala[] = [];
	for (const c of candidatos) {
		const entra = ENTRADA_S[falas.length] ?? ENTRADA_S[ENTRADA_S.length - 1];
		const naTela = opts.duracao_s - (entra ?? 0) - FADE_S;
		const precisa = c.texto.length / CARACTERES_POR_SEGUNDO;
		if (naTela < precisa) {
			avisos.push(
				`Uma das frases ficou de fora: são ${c.texto.length} caracteres e este vídeo de ${opts.duracao_s}s não dá tempo de ler (seriam necessários ${precisa.toFixed(1)}s na tela).`,
			);
			continue;
		}
		const corpo = c.estilo === 'titulo' ? corpoTitulo : corpoChamada;
		falas.push({
			...c,
			linhas: quebrar(
				c.texto,
				Math.max(8, Math.floor(larguraUtil / (corpo * POR_CARACTERE))),
			),
		});
	}

	// ③ a faixa livre: enquanto não couber, cai a ÚLTIMA fala (a menos importante)
	while (falas.length > 0 && !cabeNaFaixa(falas, opts)) {
		falas.pop();
		avisos.push(
			opts.faixa === undefined
				? 'Uma das frases ficou de fora porque não caberia na área do vídeo em que o Instagram não cobre o texto com os próprios botões.'
				: 'Uma das frases ficou de fora: só cabe texto na faixa livre embaixo da arte, e escrever ali por cima taparia a gravação do produto.',
		);
	}

	return { falas, avisos };
}

/** Altura total do bloco de texto, em pixels do quadro. */
function alturaDoBloco(falas: Fala[], largura: number): number {
	let h = 0;
	falas.forEach((f, i) => {
		const corpo = largura * (f.estilo === 'titulo' ? 0.072 : 0.037);
		const entre = corpo * (f.estilo === 'titulo' ? 1.12 : 1.3);
		if (i > 0) h += largura * 0.031;
		h += f.linhas.length * entre;
	});
	return h;
}

/**
 * Respiro entre o rodapé da arte e a primeira linha, em fração da largura.
 * Sem ele o texto encosta na peça e lê-se como legenda colada, não como faixa.
 */
const RESPIRO_DA_FAIXA = 0.022;

/** Quanto de faixa o texto PEDE — o número que vai para `planejarTela`. */
export function faixaNecessaria(falas: Fala[], largura: number): number {
	if (falas.length === 0) return 0;
	return Math.ceil(alturaDoBloco(falas, largura) + largura * RESPIRO_DA_FAIXA);
}

function cabeNaFaixa(
	falas: Fala[],
	opts: {
		largura: number;
		altura: number;
		formato: FormatoDeVideo;
		faixa?: number;
	},
): boolean {
	if (opts.faixa === undefined) {
		// Primeira passada: ainda não há geometria. O teto antigo (metade da zona
		// segura) serve só para não pedir uma faixa absurda por causa de um
		// título de 900 caracteres.
		const z = FORMATOS_DE_VIDEO[opts.formato].zona_segura;
		return (
			alturaDoBloco(falas, opts.largura) <=
			(z.base - z.topo) * opts.altura * 0.5
		);
	}
	return faixaNecessaria(falas, opts.largura) <= opts.faixa;
}

/** Estado animado de uma fala num instante. */
interface EstadoDaFala {
	opacidade: number;
	deslocamento: number;
}

/** Quanto a fala sobe ao entrar, em fração da largura do quadro. */
const SUBIDA_DA_ENTRADA = 0.043;

function estadoEm(
	indice: number,
	segundo: number,
	largura: number,
): EstadoDaFala {
	const entra = ENTRADA_S[indice] ?? ENTRADA_S[ENTRADA_S.length - 1] ?? 0;
	const f = Math.min(1, Math.max(0, (segundo - entra) / FADE_S));
	// Entra E NÃO SAI MAIS: não existe janela de saída, de propósito.
	return { opacidade: f, deslocamento: (1 - f) * largura * SUBIDA_DA_ENTRADA };
}

/**
 * A camada de texto como SVG.
 *
 * O véu (scrim) em degradê não é enfeite: sem ele o texto branco some quando a
 * deriva leva uma parte clara da arte para baixo do rodapé. Ele só existe
 * enquanto houver texto — `opacidade` é o máximo das falas.
 */
function svgDoTexto(
	falas: Fala[],
	estados: EstadoDaFala[],
	largura: number,
	altura: number,
	formato: FormatoDeVideo,
	faixaTopo: number,
): { topo: number; svg: Buffer } {
	const z = FORMATOS_DE_VIDEO[formato].zona_segura;
	const esq = Math.round(z.esq * largura);
	const base = z.base * altura;
	const bloco = alturaDoBloco(falas, largura);

	/**
	 * ⚠ O VÉU COMEÇA ONDE A ARTE ACABA, e a mudança é o conserto de um defeito
	 * assistido: antes ele subia um quarto da altura acima do texto e ESCURECIA A
	 * PEÇA. Medido num clipe real, o logo azul do aluno tinha 1.252 px de brilho
	 * médio 201 no primeiro quadro e sobrava 1 px de brilho 46 no último — o
	 * degradê apagava a assinatura da marca junto com o fundo.
	 *
	 * Ancorando o véu em `faixaTopo` (o rodapé da arte no instante mais baixo
	 * dela) o degradê nasce com opacidade ZERO exatamente onde a peça termina:
	 * escurece o fundo desfocado e nunca a arte.
	 */
	const topo = Math.round(Math.max(0, Math.min(faixaTopo, base - bloco)));

	/**
	 * ⚠ A CAMADA COBRE SÓ A FAIXA DE BAIXO, e não o quadro inteiro. É otimização
	 * MEDIDA, não elegância: desenhar texto dobrava o custo por quadro (5 s em
	 * 9:16 passou de 1,6 s para 3,4 s), e a maior parte desse custo é o
	 * `composite` varrer 1080×1920 pixels dos quais ~64% são transparentes.
	 * Compondo só a faixa a partir de `topo`, a área varrida cai para o que de
	 * fato tem tinta.
	 */
	const alto = altura - topo;

	// ancorado PELO RODAPÉ da zona segura e crescendo para cima
	let y = base - bloco;
	const partes: string[] = [];
	falas.forEach((f, i) => {
		const corpo = largura * (f.estilo === 'titulo' ? 0.072 : 0.037);
		const entre = corpo * (f.estilo === 'titulo' ? 1.12 : 1.3);
		const est = estados[i] ?? { opacidade: 0, deslocamento: 0 };
		if (i > 0) y += largura * 0.031;
		for (const linha of f.linhas) {
			y += entre;
			// `- topo`: as coordenadas passam a ser as da FAIXA, não as do quadro
			partes.push(
				`<text x="${esq}" y="${(y + est.deslocamento - topo).toFixed(1)}" font-family="Helvetica,Arial,DejaVu Sans,sans-serif" font-size="${corpo.toFixed(1)}" font-weight="${f.estilo === 'titulo' ? 700 : 400}" fill="${f.estilo === 'titulo' ? '#ffffff' : '#f2f2f2'}" opacity="${est.opacidade.toFixed(2)}">${escaparXml(linha)}</text>`,
			);
		}
	});

	const veu = Math.max(0, ...estados.map((e) => e.opacidade));
	/**
	 * O degradê tem de estar ESCURO onde a primeira linha começa — senão o texto
	 * branco some quando a deriva traz uma parte clara da mesa para o rodapé
	 * (medido na primeira versão: opacidade 0,31 embaixo do título). Como o véu
	 * agora nasce colado no rodapé da arte, a subida é calculada em cima da
	 * posição real do texto, e não numa fração fixa da altura.
	 */
	const ondeOTextoComeca = Math.min(
		0.6,
		Math.max(0.12, (base - bloco - topo) / alto),
	);
	return {
		topo,
		svg: Buffer.from(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${alto}">` +
				'<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1">' +
				'<stop offset="0" stop-color="#000" stop-opacity="0"/>' +
				`<stop offset="${ondeOTextoComeca.toFixed(3)}" stop-color="#000" stop-opacity="0.72"/>` +
				'<stop offset="1" stop-color="#000" stop-opacity="0.9"/></linearGradient></defs>' +
				`<rect x="0" y="0" width="${largura}" height="${alto}" fill="url(#v)" opacity="${veu.toFixed(2)}"/>` +
				partes.join('') +
				'</svg>',
		),
	};
}

/* ───────────────────────── o clipe ───────────────────────── */

export interface ClipeEntregue {
	formato: FormatoDeVideo;
	rotulo: string;
	largura: number;
	altura: number;
	duracao_s: number;
	quadros: number;
	eixo: 'y' | 'x';
	mp4: Buffer;
	bytes: number;
	texto_entrou: boolean;
	ms: number;
}

export interface PedidoDeClipe {
	arte: Buffer;
	formato: FormatoDeVideo;
	duracao_s: number;
	falas: Fala[];
	ffmpeg: FfmpegNaMaquina;
	signal?: AbortSignal;
}

/** Aceleração suave. Deriva linear tem cara de robô; esta entra e sai sem solavanco. */
const suave = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * t);

/**
 * Monta UM clipe. Devolve os bytes do MP4 ou uma recusa com motivo — nunca
 * lança por falta de ffmpeg, por arte pequena ou por borda ruim.
 */
export async function montarClipe(
	p: PedidoDeClipe,
): Promise<{ clipe: ClipeEntregue } | { recusa: string }> {
	const t0 = Date.now();
	const meta = await sharp(p.arte).metadata();
	const arteW = meta.width ?? 0;
	const arteH = meta.height ?? 0;

	/**
	 * A FAIXA SAI DAS FALAS, e não de um parâmetro — assim o plano entregue é
	 * sempre o mesmo que o chamador calculou, sem um número a mais para
	 * dessincronizar. A alocação é monótona (`min(pedido, máximo possível)`),
	 * então pedir exatamente o que as falas já aprovadas precisam devolve
	 * exatamente essa faixa.
	 */
	const geo = planejarTela(
		arteW,
		arteH,
		p.formato,
		faixaNecessaria(p.falas, FORMATOS_DE_VIDEO[p.formato].largura),
	);
	if ('recusa' in geo) return geo;
	const plano = geo.plano;

	/**
	 * NÃO HÁ PORTÃO DE BORDA AQUI, e a ausência é decisão medida — ver a caixa
	 * em `montarTela`. O portão do kit (`avaliarExtensao`) existe para julgar
	 * FAIXA REPLICADA; este bloco não replica nada, ele desfoca. Sem estrutura
	 * esticada não há rastro a recusar, e reusar o portão do kit aqui recusaria
	 * o Reels nas quatro artes reais do Ateliê por um defeito que este desenho
	 * não produz.
	 */
	const tela = await montarTela(p.arte, plano);
	const quadros = Math.round(p.duracao_s * FPS);

	/**
	 * As camadas de texto são MEMOIZADAS por passo de animação.
	 *
	 * Medido: desenhar texto DOBRA o custo por quadro (41 ms → 93 ms). Mas a
	 * animação só acontece nos ~2 s iniciais e depois o texto fica IDÊNTICO até
	 * o fim — quantizando a opacidade em passos de 0,1, um clipe de 5 s usa ~12
	 * camadas em vez de 150, e a maior parte dos quadros reusa a mesma.
	 */
	const cache = new Map<string, { topo: number; svg: Buffer }>();
	const camadaEm = (segundo: number): { topo: number; svg: Buffer } | null => {
		if (p.falas.length === 0) return null;
		const estados = p.falas.map((_, i) => estadoEm(i, segundo, plano.largura));
		if (estados.every((e) => e.opacidade <= 0)) return null;
		const chave = estados.map((e) => Math.round(e.opacidade * 10)).join('-');
		let camada = cache.get(chave);
		if (!camada) {
			const quantizados = estados.map((e) => {
				const o = Math.round(e.opacidade * 10) / 10;
				return {
					opacidade: o,
					deslocamento: (1 - o) * plano.largura * SUBIDA_DA_ENTRADA,
				};
			});
			camada = svgDoTexto(
				p.falas,
				quantizados,
				plano.largura,
				plano.altura,
				p.formato,
				plano.faixa_topo,
			);
			cache.set(chave, camada);
		}
		return camada;
	};

	/**
	 * O TEMPORÁRIO MORRE SEMPRE — inclusive quando o run explode no meio. O
	 * `finally` cobre exceção e `AbortError`; o que ele NÃO cobre é SIGKILL, e
	 * por isso o arquivo que fica lá dentro é o MP4 e nada mais: 0,6 MB órfão no
	 * `/tmp` do contêiner, não os 49 MB de quadros que a versão em arquivos
	 * deixaria.
	 */
	const dir = await mkdtemp(path.join(os.tmpdir(), 'atelie-video-'));
	const saida = path.join(dir, 'clipe.mp4');
	try {
		await encodar({
			ffmpeg: p.ffmpeg,
			saida,
			largura: plano.largura,
			altura: plano.altura,
			quadros,
			signal: p.signal,
			gerarQuadro: async (i) => {
				const t = quadros <= 1 ? 0 : suave(i / (quadros - 1));
				const desloca = Math.round(plano.curso * (1 - t));
				const janela =
					plano.eixo === 'y'
						? {
								left: 0,
								top: desloca,
								width: plano.largura,
								height: plano.altura,
							}
						: {
								left: desloca,
								top: 0,
								width: plano.largura,
								height: plano.altura,
							};

				let q = sharp(tela.dados, {
					raw: { width: tela.largura, height: tela.altura, channels: 3 },
				}).extract(janela);

				const camada = camadaEm(i / FPS);
				if (camada) {
					q = q.composite([{ input: camada.svg, top: camada.topo, left: 0 }]);
				}

				/**
				 * ⚠ `removeAlpha()` É OBRIGATÓRIO, NÃO É ZELO — e custou uma rodada.
				 *
				 * Compor um PNG COM ALFA sobre um quadro de 3 canais faz o sharp
				 * promover o pipeline para RGBA, e `.raw()` passa a emitir 4 bytes por
				 * pixel. O ffmpeg, que está lendo `rgb24` de um cano sem cabeçalho,
				 * não tem como perceber: ele reparte o fluxo a cada W×H×3 bytes e sai
				 * um vídeo com 4/3 dos quadros pedidos, embaralhado.
				 *
				 * Medido antes do conserto: 195 quadros em vez de 150, 6,50 s em vez
				 * de 5,00 s e 49,97 MB em vez de 0,34 MB — e o arquivo TOCA, o que
				 * torna o defeito fácil de entregar sem ver.
				 */
				return q.removeAlpha().raw().toBuffer();
			},
		});

		/**
		 * OS BYTES SÓ SÃO LIDOS DEPOIS DO CÓDIGO 0. Não precisa de "grava em .tmp e
		 * renomeia": ninguém recebe um CAMINHO daqui, e um ffmpeg interrompido no
		 * meio (medido: ele finaliza um MP4 tocável de 2,03 s em vez de 5 s, um
		 * vídeo pela metade com cara de vídeo pronto) faz o `encodar` LANÇAR — e aí
		 * este `readFile` nem acontece.
		 */
		const mp4 = await readFile(saida);
		return {
			clipe: {
				formato: p.formato,
				rotulo: FORMATOS_DE_VIDEO[p.formato].rotulo,
				largura: plano.largura,
				altura: plano.altura,
				duracao_s: p.duracao_s,
				quadros,
				eixo: plano.eixo,
				mp4,
				bytes: mp4.length,
				texto_entrou: p.falas.length > 0,
				ms: Date.now() - t0,
			},
		};
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * O ENCODE. Quadro CRU pelo stdin do ffmpeg — sem um único arquivo intermediário.
 *
 * ┌─ POR QUE PIPE E NÃO QUADROS EM DISCO ───────────────────────────────────┐
 * │ Medido nos dois: pipe é 2–3,4× mais rápido (2,10 s contra 4,96 s no 5 s  │
 * │ vertical) e usa ZERO disco — os 49 MB de temporário simplesmente deixam  │
 * │ de existir. E ele é imune a processo órfão de graça: quando o node morre,│
 * │ o descritor fecha, o ffmpeg vê EOF e sai sozinho.                        │
 * │                                                                          │
 * │ De quebra, conserta o defeito de cor: quadro JPEG no meio fazia a saída  │
 * │ sair `yuvj420p` (faixa cheia, deprecado) MESMO com `-pix_fmt yuv420p`.   │
 * │ RGB cru vira `yuv420p` naturalmente.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function encodar(o: {
	ffmpeg: FfmpegNaMaquina;
	saida: string;
	largura: number;
	altura: number;
	quadros: number;
	signal?: AbortSignal;
	gerarQuadro: (i: number) => Promise<Buffer>;
}): Promise<void> {
	/**
	 * O RELÓGIO DO ENCODE. `AbortSignal.any` junta o deadline do run (quando
	 * existe) com o teto local — um ffmpeg travado não pode segurar a resposta
	 * do aluno para sempre, e um run cancelado não pode deixar processo vivo.
	 */
	const relogio = AbortSignal.timeout(TIMEOUT_FFMPEG_MS);
	const sinal = o.signal ? AbortSignal.any([o.signal, relogio]) : relogio;

	const ff = spawn(
		o.ffmpeg.caminho,
		[
			'-hide_banner',
			'-loglevel',
			'error',
			// entrada: RGB cru, sem container e sem decodificação
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgb24',
			'-s',
			`${o.largura}x${o.altura}`,
			'-r',
			String(FPS),
			'-i',
			'pipe:0',
			// SEM ÁUDIO. Não temos trilha e não vamos inventar uma: o guia de
			// anúncios da Meta trata som como "opcional, porém recomendado", e o
			// mudo foi conferido tocando no Chrome (readyState 4, currentTime
			// avançando, sem erro). Se um dia um destino exigir faixa, enxertar AAC
			// silenciosa custa 5,6 KB e 0,19 s de remux — não recodifica nada.
			'-an',
			'-threads',
			String(THREADS_FFMPEG),
			'-c:v',
			'libx264',
			'-preset',
			PRESET,
			'-crf',
			String(CRF),
			/**
			 * ⚠ O `scale` NA FRENTE NÃO REDIMENSIONA NADA — ELE É QUEM CONVERTE A COR.
			 *
			 * A versão anterior era `format=yuv420p,setparams=...bt709` e entregava
			 * TODO vídeo com a cor errada, de um jeito especialmente traiçoeiro:
			 *
			 *  · `format=yuv420p` faz a conversão RGB→YUV com a matriz **BT.601** —
			 *    é o padrão do swscale quando o quadro de entrada não traz matriz, e
			 *    RGB cru nunca traz;
			 *  · `setparams` NÃO CONVERTE COISA NENHUMA, só reescreve o rótulo.
			 *
			 * Ou seja: os bytes saíam em 601 e o arquivo saía ETIQUETADO como 709.
			 * O player conformante obedece a etiqueta e erra — e é o único caso em
			 * que ele não tem escapatória. Trocou-se "não marcado" (cada player
			 * chuta) por "marcado errado" (todo player erra igual).
			 *
			 * Medido, cor que entra × cor que o player lê, pior erro por canal:
			 *   200,40,40  → 212,55,36  (erro 15)      com o conserto: 200,40,41 (1)
			 *   120,180,90 → 115,168,86 (erro 12)      com o conserto: 119,180,91 (1)
			 * Numa ferramenta chamada "Minha marca", o vermelho da marca do aluno
			 * saindo 12 pontos deslocado no anúncio não é preciosismo.
			 *
			 * `out_color_matrix`/`out_range` são opções do `vf_scale` de muito antes
			 * do 6.1.2 do Alpine. O `format=yuv420p` depois dele vira confirmação: a
			 * negociação de formato do libavfilter propaga a exigência para trás, e
			 * é o próprio `scale` quem faz a conversão, agora com a matriz certa.
			 */
			'-vf',
			'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
			'-pix_fmt',
			'yuv420p',
			'-color_range',
			'tv',
			'-profile:v',
			'high',
			'-level',
			'4.0',
			// `+faststart` põe o `moov` ANTES do `mdat`. A especificação de
			// publicação do Instagram exige exatamente isso ("moov no início").
			'-movflags',
			'+faststart',
			'-y',
			o.saida,
		],
		{ signal: sinal, stdio: ['pipe', 'ignore', 'pipe'] },
	);

	let erro = '';
	ff.stderr?.on('data', (d) => {
		erro += d;
	});

	/**
	 * ⚠ ESTE `on('error')` NÃO É ZELO — SEM ELE O PROCESSO INTEIRO CAI.
	 *
	 * Quando o ffmpeg morre antes da hora (flag que não existe no 6.1.2 do
	 * Alpine, disco cheio, OOM), a escrita seguinte no cano dispara um `EPIPE`
	 * ASSÍNCRONO no stream. `stdin.write()` não lança — quem lança é o evento
	 * `error`, e stream sem ouvinte de `error` em Node vira **exceção não
	 * capturada**: derruba a API inteira, não o vídeo.
	 *
	 * Medido no teste do "ffmpeg quebrado": sem esta linha, `Uncaught Exception:
	 * write EPIPE`. A causa real do fracasso é lida do código de saída logo
	 * abaixo; aqui basta não deixar o evento órfão.
	 */
	ff.stdin?.on('error', () => {});

	/**
	 * ⚠ A TRAVA ETERNA — o pior defeito que este arquivo já teve, e ele não
	 * derrubava o vídeo, derrubava O PRODUTO INTEIRO.
	 *
	 * `once('close')` NÃO PEGA UM `close` QUE JÁ ACONTECEU. E a ordem em que os
	 * eventos chegam quando o `spawn` FALHA (binário sumiu, perdeu o `+x`,
	 * `EAGAIN` por falta de memória — tudo isso DEPOIS da sonda memoizada ter
	 * dito que estava tudo bem) é exatamente a que arma a armadilha:
	 *
	 *   +0 ms   o laço confere `ff.exitCode` — ainda é `null`, o erro não chegou
	 *   +3 ms   `error` e `close` disparam e vão embora
	 *   +40 ms  o quadro do sharp fica pronto; `write` devolve `false`
	 *   +40 ms  espera-se `drain`/`close`/`error` — OS TRÊS JÁ PASSARAM
	 *   ∞       a promessa nunca resolve E nunca rejeita
	 *
	 * O resultado medido: 20 s, 150 s, para sempre. E como ninguém settla, o
	 * `finally` de `comVagaDeVideo` não roda — bastam DUAS ocorrências para a
	 * vaga acabar e TODO aluno seguinte ficar preso na fila até o restart. A
	 * requisição HTTP fica pendurada (o Fastify não tem `requestTimeout`), a
	 * arte JÁ FOI GERADA E COBRADA, e o controller nunca chega no
	 * `settleInvocation`/`refundInvocation`: voxxy reservado, aluno sem nada.
	 *
	 * O conserto é LATCH, não evento: o estado de "o ffmpeg morreu" fica gravado
	 * numa variável, e quem for esperar consulta a variável ANTES de pendurar
	 * ouvinte. Nunca mais depende de chegar a tempo para a festa.
	 */
	let morreu: Error | null = null;
	const fim = new Promise<void>((resolver, rejeitar) => {
		const matar = (e: Error) => {
			morreu ??= e;
			rejeitar(e);
		};
		ff.on('error', matar);
		ff.on('close', (codigo, sinalDeMorte) => {
			if (codigo === 0) return resolver();
			matar(
				new Error(
					`ffmpeg saiu com ${codigo ?? sinalDeMorte}: ${erro.trim().slice(0, 400)}`,
				),
			);
		});
	});
	/**
	 * E o mesmo problema pelo outro lado: se o laço abaixo estourar (quadro do
	 * tamanho errado, `AbortError`), ninguém chega no `await fim` e a rejeição
	 * dele fica ÓRFÃ — `unhandledRejection`, que também derruba o processo. Este
	 * `catch` vazio não esconde nada: o erro do laço é o que sobe, e o do ffmpeg
	 * já foi para o `stderr` acumulado.
	 */
	fim.catch(() => {});

	try {
		for (let i = 0; i < o.quadros; i++) {
			// O ffmpeg pode ter morrido (timeout, cancelamento, erro de flag): parar
			// de alimentar aqui evita EPIPE ruidoso e deixa o `fim` contar a história.
			// `morreu` primeiro: num `spawn` que falha, `exitCode` continua `null` e
			// só o latch sabe da verdade.
			if (morreu || ff.exitCode !== null || ff.killed || !ff.stdin?.writable)
				break;
			const quadro = await o.gerarQuadro(i);

			/**
			 * O CANO NÃO TEM CABEÇALHO, então um quadro do tamanho errado não dá
			 * erro: o ffmpeg reparte o fluxo a cada W×H×3 bytes e entrega um vídeo
			 * embaralhado que TOCA. Já aconteceu (canal alfa a mais, 4/3 do tamanho).
			 * Conferir aqui troca "vídeo estranho entregue ao aluno" por uma falha
			 * ruidosa que o bloco converte em recusa com motivo.
			 */
			const esperado = o.largura * o.altura * 3;
			if (quadro.length !== esperado) {
				throw new Error(
					`quadro ${i} saiu com ${quadro.length} bytes, esperado ${esperado} (${o.largura}×${o.altura}×3)`,
				);
			}
			if (!ff.stdin.write(quadro)) {
				/**
				 * ⚠ ESPERAR SÓ POR `drain` TRAVA O RUN ATÉ O TIMEOUT.
				 *
				 * O cano encheu, então esperamos escoar — mas se o ffmpeg MORRER
				 * agora, `drain` nunca vem: não há quem leia o outro lado. Medido: o
				 * teste do ffmpeg quebrado ficava pendurado até estourar. A corrida
				 * com `close`/`error` é o que transforma "trava" em "falha na hora".
				 */
				await new Promise<void>((r) => {
					// ⚠ O LATCH ANTES DO OUVINTE. Se o ffmpeg já morreu, `close` e
					// `error` são passado — pendurar `once` neles é esperar para sempre.
					if (morreu || sinal.aborted) return r();
					/**
					 * Os ouvintes são REMOVIDOS assim que um deles ganha. Sem isso são
					 * três por quadro pendurados no mesmo processo, e o Node avisa
					 * (`MaxListenersExceededWarning`) já no 11º — num clipe de 150
					 * quadros seriam centenas de closures vivas até o fim do encode.
					 */
					const pronto = () => {
						ff.stdin?.off('drain', pronto);
						ff.off('close', pronto);
						ff.off('error', pronto);
						sinal.removeEventListener('abort', pronto);
						r();
					};
					ff.stdin?.once('drain', pronto);
					ff.once('close', pronto);
					ff.once('error', pronto);
					// O último cinto: o relógio de 90 s. `AbortSignal` passado ao
					// `spawn` chama `kill()` num filho já morto, que não emite NADA —
					// então ele precisa destravar a espera por conta própria.
					sinal.addEventListener('abort', pronto, { once: true });
				});
			}
		}
		ff.stdin?.end();
		/**
		 * E a mesma desconfiança na última espera: `fim` só settla se o filho
		 * emitir `close`/`error`. Um ffmpeg que ignora o `SIGTERM` do
		 * `AbortSignal` não emite nada — o `SIGKILL` do `catch` abaixo é quem
		 * resolve, e ele só roda se alguém LANÇAR. Este `race` é quem lança.
		 */
		await Promise.race([
			fim,
			new Promise<never>((_, rejeitar) => {
				if (sinal.aborted) return rejeitar(sinal.reason);
				sinal.addEventListener('abort', () => rejeitar(sinal.reason), {
					once: true,
				});
			}),
		]);
	} catch (e) {
		// Um ffmpeg vivo depois de um erro nosso seria processo órfão comendo CPU.
		if (ff.exitCode === null) ff.kill('SIGKILL');
		throw e;
	}
}
