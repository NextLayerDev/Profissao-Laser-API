import sharp from 'sharp';
import { z } from 'zod';
import {
	acharFfmpeg,
	type ClipeEntregue,
	comVagaDeVideo,
	DURACAO_MAXIMA_S,
	DURACAO_MINIMA_S,
	DURACAO_PADRAO_S,
	faixaNecessaria,
	FORMATO_DE_VIDEO_KEYS,
	FORMATOS_DE_VIDEO,
	type FormatoDeVideo,
	montarClipe,
	planejarTela,
	type PlanoDeTexto,
	planejarTexto,
	temFontes,
} from '../lib/video.js';
import type { ToolBlock } from '../types.js';

/**
 * `video.ad_clip` — O ANÚNCIO EM MOVIMENTO, a partir da arte que o Ateliê já fez.
 *
 * ┌─ ELE NÃO GERA VÍDEO POR IA, E NÃO É ESCOLHA ────────────────────────────┐
 * │ O dono pediu vídeo de IA com uma condição literal: "precisa ter no       │
 * │ OpenRouter pra gente usar". Medido no catálogo: 399 modelos, saídas      │
 * │ `text` (399), `image` (11), `audio` (4) — VÍDEO: ZERO. Veo, Sora, Kling  │
 * │ e Runway não estão lá (os nomes que parecem, `minimax/*` e `inkling`,    │
 * │ são LLMs de texto).                                                      │
 * │                                                                          │
 * │ Então este bloco faz o que a condição permite e o que a maioria dos      │
 * │ anúncios de produto de fato é: MOVIMENTO SOBRE A ARTE JÁ PAGA. Igual ao  │
 * │ `image.kit_crops`, ele não chama fornecedor nenhum — custa CPU e nada    │
 * │ mais, e por isso não abre caminho de cobrança novo.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ SEM FFMPEG, O RUN CONTINUA — a regra dura ─────────────────────────────┐
 * │ O binário é OPCIONAL. A máquina de dev pode não ter, e um run que morre  │
 * │ 500 porque faltou um executável opcional é o pior desfecho possível: o   │
 * │ vídeo é um EXTRA, a arte é o produto — e a arte JÁ FOI PAGA quando este  │
 * │ bloco roda.                                                              │
 * │                                                                          │
 * │ Sem ffmpeg ele devolve `videos: []`, `ffmpeg_disponivel: false` e o       │
 * │ MOTIVO em português, do mesmo jeito que o kit recusa um formato dizendo  │
 * │ por quê. Vale igual para fonte ausente (Alpine limpo não tem nenhuma),   │
 * │ arte pequena demais e encode que estourou no meio.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ONDE ELE ENTRA NO PIPELINE ────────────────────────────────────────────┐
 * │  ai.art_team → ai.image_studio → image.kit_crops → video.ad_clip         │
 * │                                                                          │
 * │ DEPOIS do kit, e a ordem importa: a arte que chega aqui já está com o    │
 * │ logo carimbado pelo `image.brandmark`. Por isso este bloco NÃO aplica    │
 * │ logo nenhum — assistindo os testes, o clipe que assinava por conta saía  │
 * │ com DOIS logos na tela, o assado na arte e o meu.                        │
 * │                                                                          │
 * │ O texto ele recebe pronto do time (`titulo`/`chamada` do Redator) e o    │
 * │ `texto_na_arte` serve para NÃO repetir o que a imagem já mostra.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** Mesmo preprocess do kit: `z.coerce.boolean()` é armadilha (`Boolean('false') === true`). */
const flag = z.preprocess(
	(v) => v === true || v === 'true' || v === 1 || v === '1',
	z.boolean(),
);

const videoSchema = z.object({
	/**
	 * A arte pronta — a mesma que o kit recebe, já assinada. O motor injeta
	 * `null` num input de imagem não preenchido (`coerceInputs`), e a frase aqui
	 * é o que o aluno lê no lugar do "Expected Buffer" do Zod.
	 */
	image: z.instanceof(Buffer, {
		message: 'O vídeo precisa da arte pronta para animar.',
	}),

	/**
	 * Quais formatos montar. UM por padrão, e o padrão é Reels/Stories — não por
	 * timidez: cada clipe volta como data URL na resposta, e quatro formatos de
	 * 600 KB viram 3 MB de JSON no navegador do aluno. Quem quiser mais pede.
	 */
	formats: z
		.array(z.enum(FORMATO_DE_VIDEO_KEYS))
		.min(1)
		.max(FORMATO_DE_VIDEO_KEYS.length)
		.default(['story_9x16']),

	/**
	 * Duração de cada clipe. 5 s é o ponto medido: 3 s (o piso do Instagram) não
	 * dá tempo de ler nada, e 8 s de câmera lenta sem texto enjoa.
	 */
	duracao_s: z.coerce
		.number()
		.min(DURACAO_MINIMA_S)
		.max(DURACAO_MAXIMA_S)
		.default(DURACAO_PADRAO_S),

	/* ── o que o time escreveu ─────────────────────────────────────────── */
	/**
	 * `nullish` e não `optional` em todo campo de texto pelo mesmo motivo do
	 * `output.save_gallery`: o time devolve `null` (e não `undefined`) no que não
	 * se aplica, e com `optional` o `null` resolvido da bag reprovaria no schema,
	 * matando em 400 um run cuja ARTE JÁ FOI GERADA E COBRADA.
	 */
	titulo: z.string().max(400).nullish(),
	chamada: z.string().max(1_000).nullish(),
	/**
	 * O texto que já está ASSADO na arte. Não vai para a tela — serve para o
	 * portão de redundância: o vídeo não deve repetir o que a imagem mostra.
	 */
	texto_na_arte: z.string().max(1_000).nullish(),
	/** Desliga a sobreposição inteira, quando a definition quiser clipe limpo. */
	com_texto: flag.default(true),
});

export type VideoParams = z.infer<typeof videoSchema>;

interface RecusaDeVideo {
	formato: FormatoDeVideo;
	rotulo: string;
	motivo: string;
}

export const videoAdClipBlock: ToolBlock<VideoParams> = {
	id: 'video.ad_clip',
	category: 'video',
	description:
		'Vídeo curto de anúncio (Reels/Stories/Feed) a partir de UMA arte já gerada: deriva de câmera por sharp + ffmpeg, texto com tempo de leitura e recusa com motivo quando o formato não sai. Não chama modelo nenhum.',
	paramsSchema: videoSchema,
	async run(ctx, p) {
		const t0 = Date.now();
		const avisos: string[] = [];

		/**
		 * O PORTÃO DO BINÁRIO VEM PRIMEIRO, ANTES DE QUALQUER PIXEL. Decodificar a
		 * arte e medir borda para depois descobrir que não há ffmpeg seria gastar
		 * meio segundo de CPU para não entregar nada.
		 */
		const ffmpeg = await acharFfmpeg();
		if (!ffmpeg.ok) {
			return semVideo(ffmpeg.motivo ?? 'O ffmpeg não está disponível.', {
				ffmpeg_disponivel: false,
				ms: Date.now() - t0,
			});
		}

		/**
		 * AS FONTES. No macOS do dev há 1.852; num Alpine limpo há ~zero — e sem
		 * fonte o `<text>` do SVG não vira erro, vira NADA: o clipe sai com o véu
		 * escuro no rodapé e nenhuma letra dentro. Melhor clipe limpo do que
		 * retângulo preto vazio, e melhor ainda dizendo por quê.
		 */
		const comTexto = p.com_texto && (await temFontes());
		if (p.com_texto && !comTexto) {
			avisos.push(
				'O vídeo saiu sem as frases: este servidor está sem fontes instaladas para desenhar texto na imagem.',
			);
		}

		const clipes: ClipeEntregue[] = [];
		const recusados: RecusaDeVideo[] = [];

		/**
		 * UM DE CADA VEZ, e com vaga.
		 *
		 * Concorrência aqui não compra NADA — medido, a vazão é plana de 1 a 6
		 * vídeos simultâneos (~0,65 vídeo/s) e PIORA em 8. O que ela compra é
		 * ~480 MB de pico por vídeo em voo, que num contêiner de 2 GB derruba a
		 * API inteira por OOM. Sequencial dentro do run, com teto de processo.
		 */
		for (const formato of p.formats) {
			const rotulo = FORMATOS_DE_VIDEO[formato].rotulo;

			/**
			 * O TEXTO É PLANEJADO POR FORMATO, e não uma vez só: a zona segura do
			 * Reels não é a do feed quadrado, e a mesma chamada que cabe num 9:16
			 * de 1920 px de altura pode não caber num 1:1 de 1080.
			 */
			const plano = comTexto
				? await planejarTextoNaFaixa(p, formato)
				: { falas: [], avisos: [] };
			for (const a of plano.avisos) if (!avisos.includes(a)) avisos.push(a);

			try {
				const r = await comVagaDeVideo(() =>
					montarClipe({
						arte: p.image,
						formato,
						duracao_s: p.duracao_s,
						falas: plano.falas,
						ffmpeg,
						signal: ctx.signal,
					}),
				);
				if ('recusa' in r)
					recusados.push({ formato, rotulo, motivo: r.recusa });
				else clipes.push(r.clipe);
			} catch (e) {
				/**
				 * ⚠ ENGOLIR O ERRO AQUI É A DECISÃO CENTRAL DESTE BLOCO. Um ffmpeg que
				 * estourou, um timeout, um codec que não existe nesta máquina — nada
				 * disso pode derrubar um run cuja ARTE já está pronta e já foi cobrada.
				 * O aluno recebe a arte e uma frase dizendo que o vídeo não saiu.
				 *
				 * O detalhe técnico vai para o log do servidor e NÃO para a tela: ele
				 * traz caminho de binário e linha de comando, que não são assunto de
				 * quem está tentando publicar um Reels.
				 */
				console.error('[video.ad_clip] falhou', formato, e);
				recusados.push({
					formato,
					rotulo,
					motivo:
						'Não foi possível montar o vídeo neste formato. A arte saiu normalmente.',
				});
			}
		}

		const ms = Date.now() - t0;
		const principal = clipes[0];

		/**
		 * ⚠ UMA base64 SÓ, REUSADA — e o motivo é RAM, num bloco cuja doutrina
		 * inteira é economia de RAM.
		 *
		 * A versão anterior montava a MESMA string duas vezes: uma em `mp4DataUrl`
		 * e outra em `videos[0].dataUrl`. Medido num clipe de 0,91 MB: 131.654
		 * caracteres cada, idênticas — ~5 MB de UTF-16 vivos na heap por vídeo,
		 * para um par de chaves que a definition do Ateliê NÃO LÊ (ela usa o
		 * Buffer `mp4` e deixa o `output.save_video` subir para o CDN).
		 *
		 * `videos[0]` é sempre o clipe principal, então `mp4DataUrl` pode apontar
		 * para a MESMA string: a segunda cópia deixa de existir sem que nenhuma
		 * definition perca uma chave.
		 *
		 * O que sobra — construir a base64 mesmo quando a allow-list vai
		 * descartá-la — não dá para consertar daqui: o bloco não sabe o que a
		 * definition declarou. Custa RAM, não dinheiro, e está MEDIDO no relatório.
		 */
		const videos = clipes.map(({ mp4, ...resto }) => ({
			...resto,
			dataUrl: `data:video/mp4;base64,${mp4.toString('base64')}`,
		}));

		return {
			/**
			 * OS BYTES DO CLIPE PRINCIPAL — fora do array, exatamente como o kit faz
			 * com o `png`. Um Buffer dentro de um array vira `{"type":"Buffer",
			 * "data":[…]}` no JSON da resposta: megabytes de números no navegador.
			 * Aqui ele existe para um `output.upload_*` poder subir o arquivo sem
			 * decodificar o base64 de volta.
			 */
			mp4: principal?.mp4 ?? null,
			// a MESMA string de `videos[0]`, não uma segunda cópia — ver a caixa acima
			mp4DataUrl: videos[0]?.dataUrl ?? null,
			formato: principal?.formato ?? null,
			largura: principal?.largura ?? null,
			altura: principal?.altura ?? null,
			duracao_s: principal?.duracao_s ?? null,

			// `mp4` some de cada clipe pelo mesmo motivo: para a tela, data URL basta.
			videos,
			recusados,
			total: clipes.length,
			ffmpeg_disponivel: true,
			avisos,
			/**
			 * O TEMPO DE PAREDE, medido e devolvido. Vídeo é a única coisa do Ateliê
			 * que custa segundos de máquina sem custar centavo de fornecedor — o
			 * número precisa aparecer para a decisão de preço ser tomada com ele à
			 * vista, e não com a impressão de que "vídeo é caro".
			 */
			ms,
			resumo: resumoDoVideo(clipes, recusados, avisos),
		};
	},
};

/**
 * O TEXTO EM DUAS PASSADAS — e as duas são necessárias, não é zelo.
 *
 * Há uma circularidade real no desenho: a FAIXA LIVRE (a região por onde a arte
 * nunca passa, onde o texto pode morar) depende de QUANTO texto existe, porque é
 * ela que faz a câmera desacelerar e a arte encolher; mas quanto texto cabe
 * depende do tamanho da faixa. Uma passada só teria de escolher um dos dois
 * lados, e os dois lados erram:
 *
 *  · decidir o texto SEM a geometria escreve na área onde a arte vai passar —
 *    é o defeito assistido em que a chamada terminava impressa por cima da
 *    gravação do produto, justamente a personalização que o anúncio vende;
 *  · reservar faixa fixa para um texto que talvez nem entre encolhe a arte à toa.
 *
 * Então: ① planeja o texto sem geometria, só para saber QUANTA faixa pedir;
 * ② pede essa faixa à `planejarTela` e descobre quanta de fato coube;
 * ③ replaneja com o número real — e o que não couber cai aqui, com aviso.
 *
 * A alocação da faixa é MONÓTONA (`min(pedido, possível)`), então a terceira
 * passada não existe: o `montarClipe` repete a conta com as falas que sobraram,
 * pede uma faixa MENOR ou igual, e recebe de volta uma faixa que ainda as
 * comporta. Sem isso o plano do texto e o plano da tela dessincronizariam.
 */
async function planejarTextoNaFaixa(
	p: VideoParams,
	formato: FormatoDeVideo,
): Promise<PlanoDeTexto> {
	const f = FORMATOS_DE_VIDEO[formato];
	const base = {
		titulo: p.titulo,
		chamada: p.chamada,
		texto_na_arte: p.texto_na_arte,
		duracao_s: p.duracao_s,
		/**
		 * O NOMINAL DO FORMATO, e não o lado do plano — de propósito. É o mesmo
		 * número que o `montarClipe` usa em `faixaNecessaria`, e as duas contas
		 * PRECISAM usar a mesma régua: medir a faixa em 1080 aqui e em 972 lá
		 * devolveria um pedido que não corresponde ao que foi aprovado.
		 */
		largura: f.largura,
		altura: f.altura,
		formato,
	};

	// ① sem geometria: só para descobrir o tamanho do pedido
	const primeira = planejarTexto(base);
	if (primeira.falas.length === 0) return primeira;

	// ② quanta faixa a tela consegue abrir para esse pedido
	const meta = await sharp(p.image).metadata();
	const geo = planejarTela(
		meta.width ?? 0,
		meta.height ?? 0,
		formato,
		faixaNecessaria(primeira.falas, f.largura),
	);
	/**
	 * Tela recusada (arte minúscula, formato sem curso) não é assunto do texto: o
	 * `montarClipe` vai recusar o formato inteiro com o motivo certo daqui a
	 * pouco. Devolver a primeira passada aqui evita inventar um segundo motivo
	 * para a mesma recusa.
	 */
	if ('recusa' in geo) return primeira;

	// ③ o replanejamento com o número real
	return planejarTexto({ ...base, faixa: geo.plano.faixa_altura });
}

/**
 * A saída quando NENHUM vídeo sai — mesmo formato da saída normal, para a tela
 * não precisar de dois caminhos de leitura. O `motivo` é a frase que aparece.
 */
function semVideo(
	motivo: string,
	extra: Record<string, unknown>,
): Record<string, unknown> {
	return {
		mp4: null,
		mp4DataUrl: null,
		formato: null,
		largura: null,
		altura: null,
		duracao_s: null,
		videos: [],
		recusados: [],
		total: 0,
		ffmpeg_disponivel: true,
		avisos: [motivo],
		ms: 0,
		resumo: motivo,
		...extra,
	};
}

/**
 * A frase da tela.
 *
 * Existe pelo mesmo motivo da do kit: um vídeo que não volta, sem explicação,
 * lê-se como defeito. Com a frase, lê-se como critério — e quando o clipe saiu
 * SEM as frases do time, dizer isso é melhor do que deixar o aluno descobrir
 * assistindo.
 */
function resumoDoVideo(
	clipes: ClipeEntregue[],
	recusados: RecusaDeVideo[],
	avisos: string[],
): string {
	if (clipes.length === 0) {
		return recusados[0]?.motivo ?? 'Nenhum vídeo saiu desta arte.';
	}
	const quantos =
		clipes.length === 1
			? `Vídeo de ${clipes[0]?.duracao_s}s pronto para ${clipes[0]?.rotulo}`
			: `${clipes.length} vídeos de ${clipes[0]?.duracao_s}s prontos`;
	const semTexto = clipes.every((c) => !c.texto_entrou) && avisos.length > 0;
	const fim = recusados.length
		? ` ${recusados.length} ${recusados.length === 1 ? 'formato ficou' : 'formatos ficaram'} de fora.`
		: '';
	/**
	 * ⚠ A RESSALVA VAI JUNTO — e ela já estava escrita, só era JOGADA FORA.
	 *
	 * O `avisos` é calculado, redigido em português e não atravessa a allow-list
	 * do `output`: a definition só lê `clipe.resumo`. Antes disto, o resumo só
	 * mencionava texto ausente quando NENHUMA fala entrou — e o caso comum é o
	 * outro: o título entra e a chamada fica de fora, porque chamada é sempre
	 * mais longa e o tempo de leitura é medido por caractere. O aluno recebia um
	 * vídeo sem a chamada e a tela não dizia uma palavra sobre isso.
	 *
	 * A ÚLTIMA ressalva, e não a primeira: elas são empilhadas na ordem em que os
	 * portões rodam (redundância → tempo de leitura → faixa livre), e a última é
	 * a que decidiu o estado final. Medido no feed 1:1 com a arte quadrada do
	 * Ateliê: a primeira falava da CHAMADA ("são 61 caracteres…") enquanto quem
	 * ficou de fora por último foi o TÍTULO, por falta de faixa — a frase certa é
	 * a de baixo. `resumo` é o que a tela mostra ao lado do player
	 * (`video.motivo`), então é por aqui que a explicação chega sem precisar de
	 * chave nova no `output`.
	 */
	const ressalva = avisos.length ? ` ${avisos[avisos.length - 1]}` : '';
	return `${quantos}, montado a partir da mesma arte — a câmera anda, o produto fica.${semTexto ? ' Saiu sem as frases escritas.' : ''}${ressalva}${fim}`;
}

export const videoBlocks: ToolBlock[] = [videoAdClipBlock];
