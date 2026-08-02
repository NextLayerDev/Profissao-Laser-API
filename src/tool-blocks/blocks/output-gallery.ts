import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
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

export const outputGalleryBlocks: ToolBlock[] = [outputSaveGalleryBlock];
