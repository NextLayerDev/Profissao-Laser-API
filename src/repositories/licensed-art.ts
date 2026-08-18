import { gerarCodigoLicenca, hashCodigo } from '../lib/license-code.js';
import { supabase } from '../lib/supabase.js';

const TABELA = 'pl_licensed_art';

export interface LicensedArt {
	id: string;
	customer_id: string;
	feature_key: string;
	licensor_name: string | null;
	code: string;
	code_hash: string;
	tool_key: string;
	invocation_id: string | null;
	preview_url: string | null;
	prompt_title: string | null;
	revoked_at: string | null;
	revoke_reason: string | null;
	created_at: string;
}

export interface EmitirLicencaInput {
	customerId: string;
	featureKey: string;
	licensorName?: string | null;
	toolKey: string;
	/** `tool_invocations.id` — a chave de idempotência da rodada. */
	invocationId?: string | null;
	previewUrl?: string | null;
	promptTitle?: string | null;
}

/**
 * Emite o código de autenticidade de UMA arte gerada.
 *
 * Idempotente por `invocation_id`: uma retentativa de rede não pode fazer a
 * mesma arte nascer com dois códigos. A corrida é resolvida pelo BANCO — se o
 * insert bater no unique, buscamos e devolvemos o que já existe, em vez de
 * consultar antes (que teria janela entre a checagem e a escrita).
 */
export async function emitirLicenca(
	input: EmitirLicencaInput,
): Promise<{ art: LicensedArt; reused: boolean }> {
	if (input.invocationId) {
		const existente = await buscarPorInvocacao(input.invocationId);
		if (existente) return { art: existente, reused: true };
	}

	const code = gerarCodigoLicenca();
	const { data, error } = await supabase
		.from(TABELA)
		.insert({
			customer_id: input.customerId,
			feature_key: input.featureKey,
			licensor_name: input.licensorName ?? null,
			code,
			code_hash: hashCodigo(code),
			tool_key: input.toolKey,
			invocation_id: input.invocationId ?? null,
			preview_url: input.previewUrl ?? null,
			prompt_title: input.promptTitle ?? null,
		})
		.select('*')
		.single();

	if (error) {
		// 23505 = o unique de `invocation_id` barrou: outra requisição da MESMA
		// rodada ganhou a corrida. O código dela é o certo.
		if (error.code === '23505' && input.invocationId) {
			const existente = await buscarPorInvocacao(input.invocationId);
			if (existente) return { art: existente, reused: true };
		}
		throw new Error(`emitirLicenca: ${error.message}`);
	}

	return { art: data as LicensedArt, reused: false };
}

export async function buscarPorInvocacao(
	invocationId: string,
): Promise<LicensedArt | null> {
	const { data } = await supabase
		.from(TABELA)
		.select('*')
		.eq('invocation_id', invocationId)
		.maybeSingle();
	return (data as LicensedArt) ?? null;
}

/** A busca do QR público: bate no hash, nunca no código em claro. */
export async function buscarPorCodigo(
	codigo: string,
): Promise<LicensedArt | null> {
	const { data } = await supabase
		.from(TABELA)
		.select('*')
		.eq('code_hash', hashCodigo(codigo))
		.maybeSingle();
	return (data as LicensedArt) ?? null;
}

export async function listarDoCliente(
	customerId: string,
	limite = 50,
): Promise<LicensedArt[]> {
	const { data } = await supabase
		.from(TABELA)
		.select('*')
		.eq('customer_id', customerId)
		.order('created_at', { ascending: false })
		.limit(limite);
	return (data as LicensedArt[]) ?? [];
}

/** Revogação de staff. A peça continua existindo; o que muda é o veredito. */
export async function revogar(
	id: string,
	motivo: string,
): Promise<LicensedArt | null> {
	const { data } = await supabase
		.from(TABELA)
		.update({ revoked_at: new Date().toISOString(), revoke_reason: motivo })
		.eq('id', id)
		.is('revoked_at', null)
		.select('*')
		.maybeSingle();
	return (data as LicensedArt) ?? null;
}
