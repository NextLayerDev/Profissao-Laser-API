import sharp from 'sharp';
import { z } from 'zod';
import { baixarImagemRemota } from '../../lib/imagem-remota.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * `collection.image` — A VOLTA: pega um registro de coleção que o aluno já tem
 * e devolve a IMAGEM dele como bytes, prontos para o próximo bloco.
 *
 * É a peça que estava faltando para os AJUSTES existirem. O `ai.image_studio`
 * sabe ampliar, remover fundo e vetorizar desde a F7, mas só aceita `image`
 * como Buffer — e a arte pronta não é um Buffer, é uma linha na galeria com uma
 * URL de CDN. Sem este bloco, "ajustar o resultado" seria "gerar tudo de novo".
 *
 * ┌─ POR QUE O SERVIDOR BUSCA, EM VEZ DE O NAVEGADOR REENVIAR ──────────────┐
 * │ As duas formas funcionariam. Esta é melhor por três motivos medidos:     │
 * │                                                                          │
 * │ 1. BANDA. Reenviar seria o aluno BAIXAR a arte da CDN e SUBIR os mesmos  │
 * │    bytes de novo, pelo link de casa dele, que é o pior trecho da rota    │
 * │    inteira (upload doméstico/4G). Buscar da CDN é servidor→CDN: rápido,  │
 * │    barato e no nosso lado.                                               │
 * │                                                                          │
 * │ 2. A ABA FECHADA. O que o navegador tem em memória some quando ele       │
 * │    fecha a aba, e aí a única coisa que resta da arte é a URL. Com o      │
 * │    reenvio, ajustar uma arte de ontem exigiria o navegador rebaixá-la    │
 * │    (com CORS no meio) só para reenviar. Com o `entry_id`, ajustar uma    │
 * │    arte de ontem é idêntico a ajustar a que acabou de sair.              │
 * │                                                                          │
 * │ 3. CONFIANÇA. `entry_id` é verificável: a linha diz de quem é. Bytes     │
 * │    reenviados são só bytes — o servidor não teria como saber se aquela   │
 * │    arte é mesmo a que ele gerou, e o `parent_id` da linhagem viraria um  │
 * │    palpite do cliente.                                                   │
 * │                                                                          │
 * │ O reenvio continua possível (parâmetro `imagem`), para o caso em que não │
 * │ existe registro — mas é o plano B, e ele NÃO produz linhagem.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * O bloco é genérico de propósito: `tool`/`collection`/`campo` fazem dele o
 * leitor de imagem de QUALQUER coleção da Fábrica (a galeria do Ateliê, o logo
 * da marca, a foto de um fornecedor), sem código novo.
 */

const optionalImage = z.union([z.instanceof(Buffer), z.null(), z.undefined()]);

const schema = z.object({
	/** Tool dona da coleção (pode ser outra: é assim que uma tool lê a galeria da outra). */
	tool: z.string().min(1).max(60),
	collection: z.string().min(1).max(40).default('galeria'),
	/**
	 * `nullish` e não `optional`: o motor resolve um `input.x` vazio como
	 * `null`, e com `optional` o run inteiro morreria em 400 de validação em vez
	 * de cair no plano B (`imagem`) ou na mensagem em português daqui.
	 */
	entry_id: z.string().max(64).nullish(),
	/** Campo de `data` que guarda a URL da imagem. `url` é o da galeria. */
	campo: z.string().min(1).max(40).default('url'),
	/** Plano B: bytes vindos do navegador quando não há registro. Sem linhagem. */
	imagem: optionalImage,
});

export type CollectionImageParams = z.infer<typeof schema>;

/** Lê um campo de texto de `data` sem estourar em valor de outro tipo. */
function texto(data: Record<string, unknown>, campo: string): string | null {
	const v = data[campo];
	return typeof v === 'string' && v.trim() ? v : null;
}

export const collectionImageBlock: ToolBlock<CollectionImageParams> = {
	id: 'collection.image',
	category: 'collection',
	description:
		'Devolve a imagem de um registro de coleção (por `entry_id`) como bytes, junto com os metadados dele.',
	paramsSchema: schema,
	async run(ctx, p) {
		const id = p.entry_id?.trim();

		if (!id) {
			// Plano B: o navegador mandou os bytes. Vale para uma arte que não
			// chegou a ser arquivada (`save_gallery` com `saved:false`) — e é
			// justamente por isso que ela não tem de onde herdar linhagem.
			if (Buffer.isBuffer(p.imagem)) {
				const meta = await sharp(p.imagem).metadata();
				const png = await sharp(p.imagem).png().toBuffer();
				return {
					png,
					width: meta.width ?? 0,
					height: meta.height ?? 0,
					entry_id: null,
					url: null,
					titulo: null,
					prompt: null,
					modo: null,
					aspecto: null,
					parent_id: null,
					vector_ready: false,
					origem: 'upload',
				};
			}
			throw new ToolEngineError(
				400,
				'Escolha uma arte da sua galeria para ajustar.',
			);
		}

		/**
		 * Import dinâmico pelo mesmo motivo de `collection.ts` e
		 * `output-gallery.ts`: o repositório puxa o cliente Supabase, que valida
		 * env no topo do módulo, e todo bloco entra no registry — com import
		 * estático, rodar um teste de pipeline exigiria credencial de banco.
		 */
		const { toolCollectionRepository } = await import(
			'../../repositories/tool-collection.js'
		);
		const entry = await toolCollectionRepository.findById(
			id,
			p.tool,
			p.collection,
		);

		/**
		 * DONO, E SÓ O DONO. Não é excesso de zelo: `entry_id` vem do cliente, e
		 * sem esta linha qualquer aluno ajustaria (e baixaria em resolução cheia)
		 * a arte de qualquer outro trocando um UUID na requisição.
		 *
		 * Mesma mensagem para "não existe" e "não é sua", de propósito: distinguir
		 * os dois casos confirmaria a existência do registro alheio. É a regra que
		 * `podeVer` já aplica nos endpoints de leitura.
		 *
		 * Staff não é exceção aqui. Nos endpoints de coleção staff enxerga tudo
		 * (é quem modera); ajustar a arte de um aluno, não — o resultado seria
		 * gravado na galeria de quem rodou, com o `parent_id` apontando para a
		 * peça de outra pessoa.
		 */
		if (!entry || entry.owner_id !== ctx.customerId) {
			throw new ToolEngineError(404, 'Não encontrei essa arte na sua galeria.');
		}

		const url = texto(entry.data ?? {}, p.campo);
		if (!url) {
			throw new ToolEngineError(
				422,
				'Essa arte não tem arquivo de imagem guardado.',
			);
		}

		// `signal` repassado: um ajuste que estourou o prazo do run não deve
		// continuar puxando megabytes da CDN depois de o motor ter desistido.
		const img = await baixarImagemRemota(url, { signal: ctx.signal });

		return {
			png: img.png,
			width: img.width,
			height: img.height,
			/**
			 * O id VOLTA na saída porque é ele que o `output.save_gallery` do
			 * próximo nó grava como `parent_id`. É a linha inteira da ÁRVORE DE
			 * ITERAÇÕES: sem devolver o id aqui, o filho nasce órfão e a galeria
			 * continua sendo uma lista cronológica.
			 */
			entry_id: entry.id,
			url,
			titulo: entry.title,
			prompt: texto(entry.data ?? {}, 'prompt'),
			modo: texto(entry.data ?? {}, 'modo'),
			aspecto: texto(entry.data ?? {}, 'aspecto'),
			/** O pai DESTA arte — para a tela mostrar a corrente, não só um elo. */
			parent_id: texto(entry.data ?? {}, 'parent_id'),
			vector_ready: entry.data?.vector_ready === true,
			origem: 'galeria',
		};
	},
};

export const collectionImageBlocks: ToolBlock[] = [collectionImageBlock];
