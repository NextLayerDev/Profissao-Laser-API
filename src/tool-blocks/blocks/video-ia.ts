import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ToolEngineError } from '../../lib/tool-errors.js';
import { acharFfmpeg } from '../lib/video.js';
import {
	type AspectoDeVideo,
	type CorpoDoPedido,
	custoEstimadoUsd,
	dimensoesDoVideo,
	ErroDeVideo,
	encaixarAspecto,
	encaixarDuracao,
	encaixarResolucao,
	formatoDoAspecto,
	gerarVideoIA,
	MODELO_DE_VIDEO_KEYS,
	MODELO_DE_VIDEO_PADRAO,
	MODELOS_DE_VIDEO,
	PRAZO_PADRAO_MS,
	prepararQuadroInicial,
	type ResolucaoDeVideo,
	TETO_DE_CUSTO_USD,
} from '../lib/video-ia.js';
import type { ToolBlock } from '../types.js';

/**
 * `video.ai_clip` — O VÍDEO QUE O ALUNO COMPRA, feito da arte que é dele.
 *
 * ┌─ POR QUE ESTE ARQUIVO EXISTE (e por que a fase anterior não entregou) ───┐
 * │ `lib/video-ia.ts` foi escrito inteiro — a fila, o `Authorization` do     │
 * │ download, o `conferirMp4`, o teto de custo — e NUNCA foi ligado a nada:  │
 * │ zero importadores. A definition de `estudio_video` apontava o nó central │
 * │ para `video.ai_clip`, um bloco que o registry não conhecia, e o run      │
 * │ morria em `tool-engine.ts` com "bloco desconhecido" DEPOIS de já ter     │
 * │ rodado (e pago) o Diretor de Movimento. Este arquivo é a solda.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A DOUTRINA DO DINHEIRO SE INVERTE AQUI ────────────────────────────────┐
 * │ No `video.ad_clip` (Ken Burns, grátis) o vídeo é EXTRA sobre uma arte já │
 * │ paga: engolir o erro e entregar a arte com um recado é o certo.          │
 * │                                                                          │
 * │ Aqui o vídeo É o produto — 12 voxxys, cobrados ANTES. Toda falha LANÇA,  │
 * │ porque lançar é o único gesto que devolve o dinheiro: o controller       │
 * │ estorna no `catch`, e depois do `settle` (a penúltima linha do run) o    │
 * │ estorno deixa de existir. Devolver "vazio com um aviso" seria cobrar por │
 * │ nada.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE ESTE BLOCO VALIDA ANTES DE GASTAR UM CENTAVO ────────────────────┐
 * │ ① modelo desconhecido → 400 (a tabela é a cópia curada do catálogo);     │
 * │ ② combinação acima do TETO_DE_CUSTO_USD → 400 com o número na frase;    │
 * │ ③ arte ausente/vazia → 400 (sem primeiro quadro o modelo INVENTA outro   │
 * │    produto — texto-para-vídeo aqui é defeito, não simplificação);        │
 * │ ④ duração/resolução/proporção fora do conjunto → ENCAIXADAS com aviso,   │
 * │    nunca enviadas cruas: campo desconhecido o provedor ACEITA e          │
 * │    ENFILEIRA, e foi assim que seis gerações lixo custaram US$ 5,76.      │
 * │ Nenhuma destas recusas enfileira nada, e todas custam US$ 0,00.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** `z.coerce.boolean()` é armadilha conhecida: `Boolean('false') === true`. */
const flag = z.preprocess(
	(v) => v === true || v === 'true' || v === 1 || v === '1',
	z.boolean(),
);

const schema = z.object({
	/**
	 * A ARTE PRONTA — e a frase é a que o aluno lê. `coerceInputs` injeta `null`
	 * num input de imagem não preenchido, e "Expected Buffer" não é assunto de
	 * quem está tentando publicar um Reels.
	 */
	image: z.instanceof(Buffer, {
		message:
			'O vídeo precisa da arte pronta: é ela que vira o primeiro quadro.',
	}),

	/**
	 * O PEDIDO DE MOVIMENTO. Vem do Diretor de Movimento (`ai.video_prompt`) ou,
	 * na falta dele, do que o aluno escreveu. O bloco NÃO reescreve o texto: as
	 * três travas (produto não muda / nada de texto e logo / plano único) são
	 * responsabilidade de `lib/atelie/movimento.ts`, que já as recompõe em código
	 * quando faltam. Duplicar a regra aqui criaria duas verdades.
	 */
	movimento: z.string().trim().min(1).max(4_000),

	modelo: z.enum(MODELO_DE_VIDEO_KEYS).default(MODELO_DE_VIDEO_PADRAO),

	/**
	 * `9:16` por padrão porque a venda é Reels/Stories — e entregar deitado onde
	 * se pede vertical é entregar errado.
	 */
	aspecto: z.enum(['16:9', '9:16']).default('9:16'),

	/**
	 * ⚠ NUNCA OMITIR. Sem `resolution` explícito o provedor entrega 720p e
	 * fatura pela SKU cheia (US$ 0,08/s em vez de US$ 0,05/s): 3,2× mais caro
	 * pelo MESMO arquivo. Medido — 4 s com `resolution:"720p"` deu `usage.cost`
	 * 0,20 exato.
	 */
	resolucao: z.enum(['720p', '1080p']).default('720p'),

	/** O preço é POR SEGUNDO: 4 s custa metade de 8 s. */
	duracao_s: z.coerce.number().min(1).max(60).default(8),

	com_audio: flag.default(true),

	/**
	 * O prazo do bloco. Existe porque um job travado no provedor segura o recibo
	 * (`reservarInvocacao`) e o aluno não consegue nem repetir a geração que já
	 * pagou. Estourado, o bloco lança — e lançar devolve os voxxys.
	 */
	prazo_s: z.coerce
		.number()
		.int()
		.min(30)
		.max(900)
		.default(Math.round(PRAZO_PADRAO_MS / 1000)),
});

type Params = z.infer<typeof schema>;

const pexec = promisify(execFile);

/**
 * A CAPA SAI DO PRÓPRIO MP4 — e isto conserta uma mentira, não um pixel.
 *
 * A capa vinha da ARTE de origem. Duas consequências medidas, ambas na tela do
 * aluno: (a) o cartão de "Meus vídeos" e o `<video poster>` anunciavam a
 * manchete em força total, e a manchete DESBOTA no vídeo — o modelo apaga texto
 * chapado nos primeiros segundos, em 4 de 4 gerações; (b) a arte 1:1 num vídeo
 * 9:16 virava capa com TARJA PRETA (`fit:'contain'` sobre preto), enquanto o
 * vídeo usa fundo desfocado — mesma peça, dois tratamentos.
 *
 * O quadro zero do arquivo entregue não tem como mentir: é literalmente o que
 * aparece quando alguém aperta play. Sem ffmpeg (máquina de dev), devolve `null`
 * e o pipeline cai na capa antiga — feio, não quebrado, e nunca derruba um run
 * que já entregou vídeo.
 */
/**
 * ⚠ ABAIXO DISTO A TRILHA É INAUDÍVEL — e "existe uma faixa AAC no arquivo" não
 * é a mesma coisa que "tem som".
 *
 * Medido nos quatro vídeos reais: três voltaram entre −2,4 e −0,7 dBFS de pico
 * (som normal, colado no teto) e UM voltou com pico de **−46,2 dBFS** e RMS
 * −67,3 — faixa presente, silêncio na prática. −40 dBFS separa os dois grupos
 * com folga de 6 dB para o lado seguro.
 */
const PICO_AUDIVEL_DBFS = -40;

export interface FichaDoMp4 {
	/** Quadro zero do arquivo entregue; `null` sem ffmpeg. */
	poster: Buffer | null;
	/**
	 * `true` só quando existe faixa E ela é audível. `null` quando não deu para
	 * medir (sem ffmpeg) — e `null` NÃO é "mudo": é "não sei", e quem não sabe
	 * não desmente o pedido.
	 */
	temAudio: boolean | null;
}

/**
 * ABRE O ARQUIVO ENTREGUE E OLHA O QUE ELE REALMENTE TEM.
 *
 * ┌─ A CAPA: conserta uma MENTIRA, não um pixel ────────────────────────────┐
 * │ Ela vinha da ARTE de origem. Duas consequências medidas, ambas na tela   │
 * │ do aluno: (a) o cartão de "Meus vídeos" e o `<video poster>` anunciavam  │
 * │ a manchete em força total, e a manchete DESBOTA no vídeo — o modelo      │
 * │ apaga texto chapado nos primeiros segundos, em 4 de 4 gerações; (b) arte │
 * │ 1:1 num vídeo 9:16 virava capa com TARJA PRETA (`fit:'contain'` sobre    │
 * │ preto), enquanto o vídeo usa fundo desfocado — mesma peça, dois          │
 * │ tratamentos. O quadro zero do arquivo entregue não tem como mentir.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O ÁUDIO: `com_audio` era o PEDIDO, e a tela lia como ENTREGA ──────────┐
 * │ O bloco gravava na coleção o que tinha SIDO PEDIDO ao provedor, e a tela │
 * │ imprimia "com áudio" ao lado do player a partir disso. Não havia UMA     │
 * │ leitura da trilha entregue em lugar nenhum do repositório. Resultado     │
 * │ medido: 1 em 4 voltou praticamente mudo e teria sido entregue com a      │
 * │ etiqueta "com áudio" — numa venda de 12 voxxys em que o som é item da    │
 * │ ficha do produto.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Nada aqui derruba o run: um vídeo que chegou inteiro não pode morrer porque a
 * máquina não tem ffmpeg. Sem o binário, capa `null` (o chamador cai no plano B)
 * e áudio `null` (não sei ≠ mudo).
 */
async function inspecionarMp4(mp4: Buffer): Promise<FichaDoMp4> {
	const ffmpeg = await acharFfmpeg();
	if (!ffmpeg.ok) return { poster: null, temAudio: null };

	let dir: string | null = null;
	let poster: Buffer | null = null;
	let temAudio: boolean | null = null;
	try {
		dir = await mkdtemp(path.join(os.tmpdir(), 'video-ia-'));
		const entrada = path.join(dir, 'in.mp4');
		const capa = path.join(dir, 'capa.jpg');
		await writeFile(entrada, mp4);

		try {
			await pexec(
				ffmpeg.caminho,
				['-y', '-i', entrada, '-frames:v', '1', '-q:v', '4', capa],
				{ timeout: 30_000 },
			);
			poster = await readFile(capa);
		} catch (err) {
			console.error('[video.ai_clip] não consegui extrair a capa do MP4', err);
		}

		try {
			/**
			 * `astats` escreve no STDERR (é log de filtro, não saída de dados), e
			 * `execFile` só rejeita por código de saída — um MP4 sem faixa de áudio
			 * faz o `-map 0:a` falhar, e é justamente por isso que ele está aqui: a
			 * exceção significa "não tem faixa", que é uma resposta, não um erro.
			 */
			const { stderr } = await pexec(
				ffmpeg.caminho,
				[
					'-hide_banner',
					'-i',
					entrada,
					'-map',
					'0:a:0',
					'-af',
					'astats=measure_perchannel=none',
					'-f',
					'null',
					'-',
				],
				{ timeout: 30_000 },
			);
			const m = /Peak level dB:\s*(-?\d+(?:\.\d+)?|-?inf)/i.exec(stderr ?? '');
			const pico = m ? Number.parseFloat(m[1] as string) : Number.NaN;
			temAudio = Number.isFinite(pico) ? pico > PICO_AUDIVEL_DBFS : false;
		} catch {
			// Sem faixa de áudio no arquivo. Resposta, não falha.
			temAudio = false;
		}

		return { poster, temAudio };
	} catch (err) {
		console.error('[video.ai_clip] não consegui inspecionar o MP4', err);
		return { poster, temAudio };
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

export const videoAiClipBlock: ToolBlock<Params> = {
	id: 'video.ai_clip',
	category: 'video',
	description:
		'Vídeo gerado por IA a partir da arte pronta: ela vira o PRIMEIRO QUADRO e o modelo gera o movimento (Veo, via fila da OpenRouter). Custa dinheiro de fornecedor por clique — toda falha lança, para o run estornar.',
	paramsSchema: schema,
	async run(ctx, p) {
		const t0 = Date.now();
		const avisos: string[] = [];

		/* ── ① o modelo, contra a cópia curada do catálogo ─────────────────── */
		const modelo = MODELOS_DE_VIDEO[p.modelo];
		if (!modelo) {
			throw new ToolEngineError(
				400,
				'A configuração do vídeo desta ferramenta aponta para um modelo que não existe. Avise o suporte — nada foi cobrado.',
			);
		}

		/* ── ② encaixe: nunca mandar valor cru e torcer ────────────────────── */
		const d = encaixarDuracao(modelo, p.duracao_s);
		const r = encaixarResolucao(modelo, p.resolucao as ResolucaoDeVideo);
		const a = encaixarAspecto(modelo, p.aspecto as AspectoDeVideo);
		for (const av of [d.aviso, r.aviso, a.aviso]) if (av) avisos.push(av);

		/**
		 * Áudio pedido num modelo que não faz áudio vira aviso, não silêncio: a
		 * tela promete "com áudio" ao lado do player, e prometer som que não vem é
		 * pior do que dizer que não vem.
		 */
		const comAudio = p.com_audio && modelo.audio;
		if (p.com_audio && !modelo.audio) {
			avisos.push(`${modelo.rotulo} não gera áudio; o clipe saiu mudo.`);
		}

		/* ── ③ o teto: recusa ANTES do POST, custo US$ 0,00 ────────────────── */
		const estimado = custoEstimadoUsd(modelo, {
			duracao_s: d.duracao,
			resolucao: r.resolucao,
			com_audio: comAudio,
		});
		if (estimado > TETO_DE_CUSTO_USD) {
			throw new ToolEngineError(
				400,
				`A configuração de vídeo desta ferramenta custaria US$ ${estimado.toFixed(2)} por clique, acima do teto de US$ ${TETO_DE_CUSTO_USD.toFixed(2)}. Avise o suporte — nada foi cobrado.`,
			);
		}

		/* ── ④ o primeiro quadro, na proporção pedida ──────────────────────── */
		const quadro = await prepararQuadroInicial(p.image, a.aspecto, r.resolucao);
		for (const av of quadro.avisos) avisos.push(av);

		/**
		 * ⚠ A IMAGEM VAI COMO DATA URL, não como link.
		 *
		 * O provedor BAIXA a entrada de forma síncrona antes de enfileirar — com
		 * URL, um CDN fora do ar viraria 400 no submit (US$ 0,00, ótimo) mas
		 * também mandaria a arte do aluno para fora como endereço público. Com
		 * data URL não há link nenhum a vazar, e o `criarJob` já trata o corpo
		 * grande com timeout próprio de 120 s.
		 */
		const corpo: CorpoDoPedido = {
			model: modelo.id,
			prompt: p.movimento,
			duration: d.duracao,
			resolution: r.resolucao,
			aspect_ratio: a.aspecto,
			generate_audio: comAudio,
			frame_images: [
				{
					type: 'image_url',
					image_url: { url: quadro.dataUrl },
					frame_type: 'first_frame',
				},
			],
		};

		/* ── ⑤ a fila. Cada consulta é progresso E batimento do SSE ────────── */
		const entregue = await gerarVideoIA(corpo, {
			prazoMs: p.prazo_s * 1_000,
			signal: ctx.signal,
			/**
			 * O espalhamento não é enfeite: `ProgressoDoVideo` é uma INTERFACE, e
			 * interface não ganha índice implícito — passá-la direto onde se espera
			 * `BlockProgressEvent` (`{ kind: string; [k: string]: unknown }`) não
			 * compila. O literal espalhado ganha.
			 */
			aoProgredir: (ev) => ctx.onProgress?.({ ...ev }),
		});

		const dim = dimensoesDoVideo(r.resolucao, a.aspecto);

		/* ── ⑥ o que o arquivo ENTREGUE realmente tem ──────────────────────── */
		const ficha = await inspecionarMp4(entregue.mp4);

		/**
		 * A capa NUNCA é `null`: sem ffmpeg cai no quadro que nós mesmos montamos
		 * e mandamos ao modelo. Ele já está na proporção do vídeo e já tem o fundo
		 * desfocado — ou seja, mesmo o plano B é honesto e sem tarja preta. Capa
		 * nula abriria o player em preto, e um cartão preto na grade de "Meus
		 * vídeos" parece defeito.
		 */
		const poster =
			ficha.poster ??
			Buffer.from(
				quadro.dataUrl.slice(quadro.dataUrl.indexOf(',') + 1),
				'base64',
			);

		/**
		 * ⚠ `com_audio` PASSA A SER A ENTREGA, e não mais o pedido.
		 *
		 * `ficha.temAudio === false` só acontece quando o arquivo foi MEDIDO e
		 * voltou sem faixa ou inaudível — e aí a tela precisa parar de escrever
		 * "com áudio" ao lado do player. `null` (sem ffmpeg para medir) mantém o
		 * pedido: não sei ≠ mudo, e desmentir por ignorância seria trocar um erro
		 * por outro.
		 *
		 * O vídeo NÃO é recusado por isso. Ele saiu, o produto é o do aluno, e a
		 * imagem é o que ele comprou; estornar 12 voxxys e jogar fora US$ 0,40 de
		 * fornecedor por causa da trilha seria pior para os dois lados. O que não
		 * dá é entregar mudo dizendo que tem som.
		 */
		const audioEntregue = ficha.temAudio === null ? comAudio : ficha.temAudio;
		if (comAudio && ficha.temAudio === false) {
			avisos.push(
				'Este vídeo veio sem som — o gerador não produziu trilha desta vez. A imagem saiu normalmente; publique com uma música da própria rede social.',
			);
		}

		/**
		 * O custo REAL do provedor (`usage.cost`), e não a estimativa da tabela.
		 * Ele sobe como saída porque sem ele ninguém reconcilia a margem de uma
		 * venda de 12 voxxys — o número existiria por 200 ms e morreria aqui.
		 * (A allow-list de `output` da definition decide se ele chega à tela; o
		 * bloco não pode decidir isso, mas pode não esconder.)
		 */
		const custoUsd = entregue.custoUsd ?? estimado;

		return {
			mp4: entregue.mp4,
			/** A capa tirada do próprio arquivo (plano B: o quadro que montamos). */
			poster,
			formato: formatoDoAspecto(a.aspecto),
			largura: dim.largura,
			altura: dim.altura,
			duracao_s: d.duracao,
			/** ⚠ A ENTREGA, medida no arquivo — não o que foi pedido. */
			com_audio: audioEntregue,
			modelo: modelo.id,
			job_id: entregue.jobId,
			custo_usd: custoUsd,
			custo_real: entregue.custoUsd !== null,
			reenquadrado: quadro.reenquadrado,
			avisos: avisos.join(' '),
			resumo: `Vídeo de ${d.duracao}s em ${dim.largura}×${dim.altura}${audioEntregue ? ', com áudio' : ', sem áudio'}.`,
			ms: Date.now() - t0,
		};
	},
};

export { ErroDeVideo };

export const videoIaBlocks: ToolBlock[] = [videoAiClipBlock as ToolBlock];
