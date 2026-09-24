import { toolBankRepository } from '../repositories/tool-bank.js';
import { BANK_MODE_CARIMBO } from '../types/tool-bank.js';

/** A ferramenta cujo banco recebe o modelo. */
const TOOL_KEY = 'arte_licenciada';

export const TITULO_MODELO_CARIMBO = 'Só licenciar — arte pronta';
export const DESCRICAO_MODELO_CARIMBO =
	'Envie sua arte finalizada e receba o código de autenticidade gravado nela. Nada é gerado: a arte sai como entrou.';

/**
 * TODA MARCA NASCE COM O MODELO "SÓ LICENCIAR".
 *
 * O modo é um registro do banco (`data.mode = 'carimbo'`) e não um flag da
 * marca, porque é assim que a tela do aluno lista o que dá para fazer com
 * cada clube — e é assim que o run acha `feature_key`, `licensor_name` e a
 * cobrança. Mas pedir ao admin que cadastre esse registro à mão em cada marca
 * é pedir para esquecer: a marca sem ele parece completa e só permite gerar.
 *
 * Idempotente: procura antes de criar. Best-effort no chamador — falhar aqui
 * não pode derrubar a criação da marca, que já está no banco.
 */
export async function garantirModeloCarimbo(
	marca: { feature_key: string; display_name: string },
	createdBy: string | null,
): Promise<'criado' | 'existia'> {
	const existentes = await toolBankRepository.list(TOOL_KEY, {
		activeOnly: false,
	});
	const chave = marca.feature_key.trim().toLowerCase();
	const jaTem = existentes.some((e) => {
		const d = e.data as Record<string, unknown>;
		return (
			d.mode === BANK_MODE_CARIMBO &&
			typeof d.feature_key === 'string' &&
			d.feature_key.trim().toLowerCase() === chave
		);
	});
	if (jaTem) return 'existia';

	await toolBankRepository.create(
		TOOL_KEY,
		{
			title: TITULO_MODELO_CARIMBO,
			description: DESCRICAO_MODELO_CARIMBO,
			// Primeiro da lista: é o caminho mais simples, e o que mais gente quer.
			position: 0,
			active: true,
			data: {
				mode: BANK_MODE_CARIMBO,
				max_images: 1,
				feature_key: chave,
				licensor_name: marca.display_name,
			},
		},
		createdBy,
	);
	return 'criado';
}
