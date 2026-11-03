import { z } from 'zod';
import { baixarImagemRemota } from '../../lib/imagem-remota.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * `brand.asset` — devolve, como bytes, a arte oficial de uma MARCA licenciada.
 *
 * A marca é resolvida pela `feature_key` (`clube:corinthians`), não por um
 * upload preso ao prompt. É essa indireção que faz um clube com caneca,
 * capinha e chaveiro precisar de UM cadastro só — e que faz trocar a arte
 * oficial atualizar todos os prompts de uma vez.
 *
 * Marca inativa NÃO gera: contrato encerrado é motivo para parar de produzir
 * peça nova, mesmo que o QR das peças antigas continue válido.
 */

const schema = z.object({
	/** `clube:corinthians`. Vem do `data.feature_key` do prompt escolhido. */
	feature_key: z.string().nullish(),
	/** `crest` = escudo/logo (o principal). `mascot` = arte secundária. */
	campo: z.enum(['crest', 'mascot']).default('crest'),
	/**
	 * Quando `false`, arte ausente devolve `png: null` em vez de estourar — o
	 * mascote é opcional e não pode derrubar a geração inteira.
	 */
	obrigatorio: z.boolean().default(true),
});

export type BrandAssetParams = z.infer<typeof schema>;

export const brandAssetBlock: ToolBlock<BrandAssetParams> = {
	id: 'brand.asset',
	category: 'collection',
	description:
		'Devolve como bytes a arte oficial de uma marca licenciada, resolvida pela feature_key.',
	paramsSchema: schema,
	async run(ctx, p) {
		const chave = p.feature_key?.trim().toLowerCase();
		if (!chave) {
			throw new ToolEngineError(
				422,
				'Este prompt não tem marca licenciada definida. Preencha a chave da marca no Banco do Admin.',
			);
		}

		/**
		 * Import TARDIO, como nos outros blocos que tocam banco: o repositório
		 * puxa o client do Supabase, que valida env no topo do módulo, e todo
		 * bloco entra no registry na carga.
		 */
		const { licensedBrandRepository } = await import(
			'../../repositories/licensed-brand.js'
		);
		const marca = await licensedBrandRepository.findByFeatureKey(chave);

		// Mensagem que diz o que fazer: quem lê isto é o staff que cadastrou o
		// prompt, não um desenvolvedor.
		if (!marca) {
			throw new ToolEngineError(
				422,
				`A marca "${chave}" não está cadastrada. Cadastre-a em Marcas licenciadas antes de usar este prompt.`,
			);
		}
		if (!marca.active) {
			throw new ToolEngineError(
				422,
				`O licenciamento de "${marca.display_name}" não está ativo.`,
			);
		}

		const url = p.campo === 'crest' ? marca.crest_url : marca.mascot_url;
		if (!url) {
			if (!p.obrigatorio) {
				return {
					png: null,
					width: 0,
					height: 0,
					url: null,
					nome: marca.display_name,
				};
			}
			throw new ToolEngineError(
				422,
				`A marca "${marca.display_name}" está sem a arte oficial. Suba o arquivo em Marcas licenciadas.`,
			);
		}

		const img = await baixarImagemRemota(url, { signal: ctx.signal });
		return {
			png: img.png,
			width: img.width,
			height: img.height,
			url,
			nome: marca.display_name,
		};
	},
};
