import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
/**
 * O rótulo do formato sai da MESMA tabela que o bloco do vídeo usa, e não de uma
 * cópia aqui: "Story e Reels" escrito em dois lugares diverge no dia em que
 * alguém renomeia um formato, e a tela passa a chamar o arquivo de outra coisa.
 */
import { FORMATOS_DE_VIDEO } from '../lib/video.js';
import type { ToolBlock } from '../types.js';

/**
 * `output.save_gallery` — sobe o PNG e registra a imagem na GALERIA PESSOAL do
 * aluno.
 *
 * A galeria é uma COLEÇÃO da Fábrica (`pl_tool_bank_entry`), não uma tabela
 * nova: `visibility:'owner'` + `owner_id` = quem rodou já é "minha galeria", e
 * o repositório de coleções faz o resto (listar, paginar, filtrar, favoritar).
 * Zero DDL — ver `lib/tool-collections.ts`.
 *
 * Existe como bloco SEPARADO porque `ai.image_studio` precisa ficar puro: um
 * bloco de IA que grava no banco não pode ser reusado numa tool que só quer a
 * imagem, nem rodar em preview. Quem tem efeito colateral é a saída.
 */

/**
 * Booleano vindo do motor. `z.coerce.boolean()` seria uma armadilha: em JS,
 * `Boolean('false') === true`, então um literal `"false"` escrito na definition
 * viraria `true` em silêncio.
 */
const flag = z.preprocess(
	(v) => v === true || v === 'true' || v === 1 || v === '1',
	z.boolean(),
);

const saveGallerySchema = z.object({
	from: z.instanceof(Buffer),
	/** Tool dona da galeria (normalmente a própria: `estudio_imagens`). */
	tool: z.string().min(1).max(60),
	collection: z.string().min(1).max(40).default('galeria'),
	folder: z.string().default('estudio-imagens'),
	/**
	 * `nullish` e não `optional` em todo campo de texto: o bloco de IA devolve
	 * `null` (e não `undefined`) no que não se aplica ao modo — `ampliar` não tem
	 * prompt, `remover_fundo` não tem modelo. Com `optional`, o `null` que o
	 * motor resolve da bag reprovaria no schema e o run inteiro morreria em 400
	 * DEPOIS de a imagem já ter sido gerada e cobrada.
	 */
	title: z.string().max(200).nullish(),

	// ── campos de `collections.galeria` ────────────────────────────────────
	// Os nomes abaixo são o CONTRATO com o seed da tool
	// (`api-upvox/scripts/seed-estudio-imagens.ts`): renomear um campo lá sem
	// renomear aqui faz o registro nascer com uma chave que a tela não lê, sem
	// erro nenhum. Mudou um lado, muda o outro.
	modo: z.string().max(40).nullish(),
	prompt: z.string().max(8_000).nullish(),
	modelo: z.string().max(200).nullish(),
	aspecto: z.string().max(10).nullish(),
	largura: z.coerce.number().int().min(1).max(100_000).nullish(),
	altura: z.coerce.number().int().min(1).max(100_000).nullish(),
	/**
	 * Imagem de ORIGEM desta variação. É o campo que transforma uma lista de
	 * imagens numa ÁRVORE DE ITERAÇÕES — "esta saiu daquela" —, que é o que o
	 * Midjourney tem e os Prompts Mágicos não.
	 */
	parent_id: z.string().max(64).nullish(),
	vector_ready: flag.optional(),
	tileable: flag.optional(),
	/**
	 * A URL DO MP4 do anúncio em vídeo, quando a tool gera um.
	 *
	 * Campo PRÓPRIO e não `url`: aquele é `type:'image'` na coleção — é dele que
	 * sai a miniatura da grade e é ele que o `collection.image` BAIXA para
	 * reampliar no fluxo de ajuste. Um MP4 ali viraria um `<img>` quebrado na
	 * galeria e um buffer que o sharp não abre no ajuste seguinte.
	 *
	 * Sem ele o vídeo existiria só enquanto a aba estivesse aberta: o arquivo
	 * fica no CDN, mas o endereço se perde no fechar da página.
	 */
	video_url: z.string().max(600).nullish(),

	/** `owner` = só o dono vê (default). `public` exigiria moderação. */
	visibility: z.enum(['owner', 'public']).default('owner'),
});

/** Lado máximo da miniatura. Grade de galeria não precisa de 1536px. */
const THUMB_MAX_SIDE = 512;

export const outputSaveGalleryBlock: ToolBlock<
	z.infer<typeof saveGallerySchema>
> = {
	id: 'output.save_gallery',
	category: 'output',
	description:
		'Sobe o PNG e registra a imagem na galeria pessoal do aluno (coleção da Fábrica).',
	paramsSchema: saveGallerySchema,
	async run(ctx, p) {
		/**
		 * Import dinâmico: `repositories/tool-collection` puxa o cliente Supabase,
		 * que valida env no topo do módulo. Como todo bloco entra no registry, e o
		 * registry é importado por toda a suíte, um import estático exigiria
		 * credencial de banco para rodar um teste de pipeline.
		 */
		const [{ uploadToolOutput }, { toolCollectionRepository }] =
			await Promise.all([
				import('../../lib/storage.js'),
				import('../../repositories/tool-collection.js'),
			]);

		const id = crypto.randomUUID();
		let url: string | null = null;
		let thumbUrl: string | null = null;
		let entryId: string | null = null;
		let saveError: string | null = null;

		/**
		 * NADA AQUI DERRUBA O RUN. A imagem já foi gerada e já foi cobrada; se o
		 * Bunny ou o Postgres estiverem fora do ar, estornar uma geração que deu
		 * certo (e sumir com a imagem, que volta inline em `pngBase64`) é
		 * estritamente pior do que entregar a imagem e avisar que ela não foi
		 * arquivada. O `saved:false` sobe para a tela dizer isso.
		 */
		try {
			url = await uploadToolOutput(
				p.folder,
				p.from,
				`${ctx.customerId}/${id}.png`,
				'image/png',
			);
			const thumb = await sharp(p.from)
				.resize(THUMB_MAX_SIDE, THUMB_MAX_SIDE, {
					fit: 'inside',
					withoutEnlargement: true,
				})
				.webp({ quality: 82 })
				.toBuffer();
			thumbUrl = await uploadToolOutput(
				p.folder,
				thumb,
				`${ctx.customerId}/${id}-thumb.webp`,
				'image/webp',
			);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'falha no upload';
			console.error('[save_gallery] upload falhou', p.tool, saveError);
		}

		if (url) {
			try {
				const entry = await toolCollectionRepository.create({
					toolKey: p.tool,
					collection: p.collection,
					title: (p.title ?? p.prompt ?? `Imagem ${p.modo ?? ''}`)
						.trim()
						.slice(0, 120),
					data: {
						url,
						thumb_url: thumbUrl ?? url,
						modo: p.modo ?? null,
						prompt: p.prompt ?? null,
						modelo: p.modelo ?? null,
						aspecto: p.aspecto ?? null,
						largura: p.largura ?? null,
						altura: p.altura ?? null,
						favorito: false,
						parent_id: p.parent_id ?? null,
						vector_ready: p.vector_ready === true,
						tileable: p.tileable === true,
						/**
						 * `null` e não `''` quando não há vídeo: a galeria filtra e conta
						 * por presença de campo, e string vazia é um valor presente. Sem
						 * vídeo é AUSÊNCIA, não "vídeo em branco".
						 */
						video_url: p.video_url || null,
					},
					// Galeria pessoal não passa por moderação: ninguém além do dono a
					// enxerga. `approved` aqui significa "pronta para aparecer para
					// quem a criou", não "validada pela equipe".
					status: 'approved',
					ownerId: ctx.customerId,
					visibility: p.visibility,
					createdBy: ctx.customerId,
				});
				entryId = entry.id;
			} catch (err) {
				saveError = err instanceof Error ? err.message : 'falha ao registrar';
				console.error('[save_gallery] insert falhou', p.tool, saveError);
			}
		}

		return {
			url,
			thumb_url: thumbUrl,
			entry_id: entryId,
			saved: entryId !== null,
			save_error: saveError,
		};
	},
};

/* ══════════════════════ o vídeo do anúncio ══════════════════════ */

/**
 * `output.save_video` — sobe o MP4 do anúncio e devolve o ENDEREÇO dele.
 *
 * ┌─ POR QUE ELE EXISTE, EM VEZ DE A TELA LER O `video.ad_clip` DIRETO ──────┐
 * │ O `video.ad_clip` devolve o clipe como DATA URL, e para o que ele é (um   │
 * │ bloco puro, testável, sem efeito colateral) está certo. Mas data URL é    │
 * │ transporte ruim para vídeo, e por dois motivos independentes:             │
 * │                                                                          │
 * │  ① PESO. 1,3 MB de MP4 viram ~1,8 MB de base64, dentro do MESMO JSON que  │
 * │     já carrega quatro peças de kit em base64. O payload de um run passa   │
 * │     a ser dominado por um arquivo que ninguém vai assistir no primeiro    │
 * │     segundo;                                                             │
 * │  ② REPRODUÇÃO. `<video src="data:...">` não aceita requisição por faixa   │
 * │     (`Range`): o navegador só começa a tocar depois de ter o arquivo      │
 * │     inteiro, e arrastar a linha do tempo para o meio deixa de funcionar.  │
 * │     Com URL de CDN, o player pede o pedaço que precisa.                   │
 * │                                                                          │
 * │ E há um terceiro, que é o que faz o vídeo sobreviver ao fechar da aba: só │
 * │ com um endereço estável dá para gravá-lo na linha da galeria e reabri-lo  │
 * │ amanhã em "Minhas artes".                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `output.` no nome não é enfeite: é o prefixo que o `skipInPreview`
 * (controllers/tool-run.ts) usa para cortar do caminho NÃO COBRADO tudo o que
 * tem efeito colateral. Um preview grátis não pode deixar arquivo no CDN.
 *
 * NADA AQUI DERRUBA O RUN — mesma doutrina do `save_gallery` logo acima, e aqui
 * ela vale ainda mais: o vídeo é o EXTRA, a arte é o produto, e a arte já foi
 * paga quando este bloco roda. Sem MP4 (servidor sem ffmpeg, formato recusado),
 * ele devolve `ok:false` com o motivo e o pipeline segue.
 */
const saveVideoSchema = z.object({
	/**
	 * Os BYTES do clipe — `<nó do vídeo>.mp4`, e não o `mp4DataUrl`: decodificar
	 * base64 de volta só para subir seria o dobro de memória por nada.
	 *
	 * `nullish` porque `null` é o estado NORMAL: é o que o `video.ad_clip`
	 * devolve quando não há ffmpeg. Com `z.instanceof(Buffer)` puro, o run
	 * morreria em 400 na máquina de desenvolvimento — exatamente o desfecho que
	 * o bloco do vídeo se deu ao trabalho de evitar.
	 */
	mp4: z.instanceof(Buffer).nullish(),
	/**
	 * A ARTE, para o quadro de capa (`<video poster>`). Sem ele o player é um
	 * retângulo PRETO até alguém clicar — e retângulo preto no meio da página
	 * lê-se como coisa quebrada, não como vídeo pronto.
	 */
	arte: z.instanceof(Buffer).nullish(),

	tool: z.string().min(1).max(60),
	folder: z.string().default('estudio-imagens'),

	/** A ficha do clipe, que viaja junto para a tela não ter de adivinhar. */
	formato: z.string().max(40).nullish(),
	largura: z.coerce.number().int().min(1).max(10_000).nullish(),
	altura: z.coerce.number().int().min(1).max(10_000).nullish(),
	duracao_s: z.coerce.number().min(0).max(600).nullish(),
	/**
	 * A frase em português do bloco do vídeo (`resumo`). Ela serve aos DOIS
	 * casos: "saiu, mas sem as frases porque o servidor não tem fonte" e "não
	 * saiu porque não há ffmpeg". Sem ela, um vídeo ausente e um vídeo com
	 * ressalva produzem a mesma tela muda.
	 */
	motivo: z.string().max(600).nullish(),

	/**
	 * ⚠ O VÍDEO É O PRODUTO, E NÃO O EXTRA — o interruptor que inverte a doutrina.
	 *
	 * Desligado (o padrão, e o do Ateliê) este bloco NUNCA derruba um run: a arte
	 * já foi gerada e já foi cobrada, e sumir com ela porque o Bunny caiu seria
	 * estritamente pior do que entregar a arte com um recado.
	 *
	 * Ligado, a conta se inverte. Numa tool em que o aluno pagou 12 voxxys PELO
	 * VÍDEO, um upload que falha em silêncio grava uma linha sem arquivo, o run
	 * chega ao fim, o `settle` liquida a cobrança — e o aluno pagou por um
	 * endereço vazio. Depois do settle não há estorno: `refundInvocation` só
	 * transiciona a partir de `pending`, e o settle é a penúltima linha do run.
	 * Ou seja, a ÚNICA janela para devolver o dinheiro é lançar aqui.
	 *
	 * `false` por padrão de propósito: o Ateliê não passa este parâmetro e o
	 * comportamento dele fica idêntico ao que sempre foi.
	 */
	obrigatorio: z
		.preprocess(
			(v) => v === true || v === 'true' || v === 1 || v === '1',
			z.boolean(),
		)
		.default(false),
});

/** `story_9x16` → `Story e Reels`. Desconhecido devolve o próprio id, nunca vazio. */
function rotuloDoFormato(formato: string | null | undefined): string {
	if (!formato) return '';
	const f = FORMATOS_DE_VIDEO[formato as keyof typeof FORMATOS_DE_VIDEO];
	return f ? f.rotulo : formato;
}

export const outputSaveVideoBlock: ToolBlock<z.infer<typeof saveVideoSchema>> =
	{
		id: 'output.save_video',
		category: 'output',
		description:
			'Sobe o MP4 do anúncio (e um quadro de capa) e devolve a URL — em vez de mandar megabytes de base64 no JSON do run.',
		paramsSchema: saveVideoSchema,
		async run(ctx, p) {
			const t0 = Date.now();

			/**
			 * SEM CLIPE, SEM UPLOAD — e sem erro. É o caminho da máquina de dev sem
			 * ffmpeg, e o `motivo` que vem do bloco do vídeo é o que a tela mostra.
			 */
			if (!p.mp4 || p.mp4.length === 0) {
				/**
				 * Numa tool paga, "não veio clipe" não é um recado — é o run inteiro
				 * fracassando depois de o aluno ter pago. Lançar aqui é o que aciona o
				 * estorno; o `motivo` que sobe é o do bloco do vídeo, que já está em
				 * português e já explica o caso.
				 */
				if (p.obrigatorio) {
					const { ToolEngineError } = await import('../../lib/tool-errors.js');
					throw new ToolEngineError(
						502,
						p.motivo ??
							'O vídeo não foi gerado desta vez. Tente de novo — nada foi cobrado.',
					);
				}
				return {
					url: null,
					poster_url: null,
					formato: p.formato ?? null,
					rotulo: rotuloDoFormato(p.formato),
					largura: null,
					altura: null,
					duracao_s: null,
					bytes: 0,
					ok: false,
					motivo: p.motivo ?? 'O vídeo não foi montado nesta execução.',
					ms: Date.now() - t0,
				};
			}

			const { uploadToolOutput } = await import('../../lib/storage.js');
			const id = crypto.randomUUID();

			let url: string | null = null;
			let posterUrl: string | null = null;
			let erro: string | null = null;

			try {
				url = await uploadToolOutput(
					p.folder,
					p.mp4,
					`${ctx.customerId}/${id}.mp4`,
					'video/mp4',
				);
			} catch (err) {
				erro = err instanceof Error ? err.message : 'falha no upload do vídeo';
				console.error('[save_video] upload falhou', p.tool, erro);
				/**
				 * Mesma regra do caso "sem clipe", e é a que fecha o furo de verdade: o
				 * arquivo EXISTE (foi gerado e pago em dólar), mas não tem endereço. Sem
				 * este `throw`, o `collection.save` seguinte gravaria uma linha de vídeo
				 * sem `url` e o aluno abriria "Meus vídeos" para encontrar um cartão que
				 * não toca. A frase é em português porque quem lê está tentando publicar
				 * um Reels, não depurar um CDN.
				 */
				if (p.obrigatorio) {
					const { ToolEngineError } = await import('../../lib/tool-errors.js');
					throw new ToolEngineError(
						502,
						'O vídeo foi gerado mas não conseguimos guardá-lo. Tente de novo — nada foi cobrado.',
					);
				}
			}

			/**
			 * A CAPA É A ARTE INTEIRA SOBRE FUNDO PRETO (`contain`), nunca `cover`.
			 *
			 * `cover` recortaria a arte para caber no 9:16 — e é exatamente aí que a
			 * manchete e o logo, que moram nos cantos, seriam decapitados. A capa é o
			 * primeiro (e às vezes o único) quadro que alguém vê; entregar nela o
			 * defeito que o vídeo se deu ao trabalho de evitar seria absurdo.
			 *
			 * Falhar aqui NÃO cancela o vídeo: sem capa o player abre preto, o que é
			 * feio, não quebrado.
			 */
			if (url && p.arte && p.largura && p.altura) {
				try {
					const capa = await sharp(p.arte)
						.resize(p.largura, p.altura, {
							fit: 'contain',
							background: { r: 0, g: 0, b: 0, alpha: 1 },
						})
						.jpeg({ quality: 80 })
						.toBuffer();
					posterUrl = await uploadToolOutput(
						p.folder,
						capa,
						`${ctx.customerId}/${id}-capa.jpg`,
						'image/jpeg',
					);
				} catch (err) {
					console.error('[save_video] capa falhou', p.tool, err);
				}
			}

			return {
				url,
				poster_url: posterUrl,
				formato: p.formato ?? null,
				rotulo: rotuloDoFormato(p.formato),
				largura: p.largura ?? null,
				altura: p.altura ?? null,
				duracao_s: p.duracao_s ?? null,
				bytes: p.mp4.length,
				ok: url !== null,
				/**
				 * O motivo do bloco do vídeo vem primeiro (ele explica o clipe); o erro
				 * de upload só aparece quando é ele que impediu a entrega — e em
				 * português, porque quem lê está tentando publicar um Reels.
				 */
				motivo:
					url === null && erro
						? 'O vídeo foi montado mas não conseguimos guardá-lo. Tente criar a arte de novo.'
						: (p.motivo ?? null),
				ms: Date.now() - t0,
			};
		},
	};

export const outputGalleryBlocks: ToolBlock[] = [
	outputSaveGalleryBlock,
	outputSaveVideoBlock,
];
