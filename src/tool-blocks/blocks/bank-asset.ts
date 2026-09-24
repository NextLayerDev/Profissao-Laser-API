import { z } from 'zod';
import { baixarImagemRemota } from '../../lib/imagem-remota.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * `bank.asset` — devolve, como bytes, uma imagem que o STAFF cadastrou no Banco
 * do Admin da ferramenta.
 *
 * ┌─ POR QUE NÃO DÁ PARA USAR `collection.image` ───────────────────────────┐
 * │ Aquele bloco existe para o aluno reabrir A PRÓPRIA arte da galeria, e   │
 * │ por isso exige `entry.owner_id === customerId` — sem essa linha um      │
 * │ aluno baixaria a arte de outro trocando um UUID. A trava está certa.    │
 * │                                                                         │
 * │ Só que material de marca (brasão, logo, mascote) é cadastrado pelo      │
 * │ STAFF e não pertence a aluno nenhum: `owner_id` é nulo. Passar por lá   │
 * │ dava 404 em toda geração licenciada.                                    │
 * │                                                                         │
 * │ A resposta não é afrouxar aquela checagem — é este bloco, que troca a   │
 * │ regra de dono por uma regra de ORIGEM: só lê registro do banco de       │
 * │ admin da própria tool (`collection = 'default'`), nunca de galeria      │
 * │ pessoal. Um `entry_id` de arte de outro aluno não passa, porque arte de │
 * │ aluno vive em outra coleção.                                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

const schema = z.object({
	/** Tool dona do banco. Normalmente a própria. */
	tool: z.string().min(1).max(60),
	/**
	 * `nullish` e não `optional`: o motor resolve input vazio como `null`, e com
	 * `optional` o run morreria em 400 de validação antes de chegar na mensagem
	 * em português daqui.
	 */
	entry_id: z.string().max(64).nullish(),
	/** Campo de `data` que guarda a URL. Ex.: `brasao`, `mascote`. */
	campo: z.string().min(1).max(40),
	/**
	 * Quando `false`, campo vazio devolve `png: null` em vez de estourar — para
	 * material opcional (o mascote) não derrubar a geração inteira.
	 */
	obrigatorio: z.boolean().default(true),
});

export type BankAssetParams = z.infer<typeof schema>;

function texto(data: Record<string, unknown>, campo: string): string | null {
	const v = data[campo];
	return typeof v === 'string' && v.trim() ? v : null;
}

export const bankAssetBlock: ToolBlock<BankAssetParams> = {
	id: 'bank.asset',
	category: 'collection',
	description:
		'Devolve como bytes uma imagem cadastrada pelo staff no Banco do Admin da tool (ex.: brasão oficial).',
	paramsSchema: schema,
	async run(ctx, p) {
		const id = p.entry_id?.trim();
		if (!id) {
			throw new ToolEngineError(400, 'Escolha um item do banco.');
		}

		/**
		 * Import TARDIO, pelo mesmo motivo do `collection.image`: o repositório
		 * puxa o client do Supabase, que valida env NO TOPO DO MÓDULO. Todo bloco
		 * entra no registry na carga — com import estático, qualquer teste que
		 * apenas importe o registry morreria por falta de env.
		 */
		const { toolBankRepository } = await import(
			'../../repositories/tool-bank.js'
		);
		const entry = await toolBankRepository.findById(id, p.tool, {
			activeOnly: true,
		});

		// A regra é de ORIGEM, não de dono: só material do banco de admin.
		// `collection` fora de `default` é galeria de aluno e não entra aqui.
		if (!entry || (entry.collection ?? 'default') !== 'default') {
			throw new ToolEngineError(404, 'Item do banco não encontrado.');
		}

		const url = texto((entry.data ?? {}) as Record<string, unknown>, p.campo);
		if (!url) {
			if (!p.obrigatorio) {
				return { png: null, width: 0, height: 0, url: null };
			}
			throw new ToolEngineError(
				422,
				`O item "${entry.title}" está sem a imagem obrigatória (${p.campo}). Cadastre-a no Banco do Admin.`,
			);
		}

		// `baixarImagemRemota` já devolve PNG normalizado com as dimensões —
		// reprocessar com sharp aqui seria trabalho repetido.
		const img = await baixarImagemRemota(url, { signal: ctx.signal });

		return { png: img.png, width: img.width, height: img.height, url };
	},
};
