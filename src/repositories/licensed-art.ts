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
	/** Quando o aluno tirou a peça da biblioteca dele. Nulo = visível. */
	archived_at: string | null;
	/** O lote a que a peça pertence. Nulo nas peças anteriores à tiragem. */
	batch_id: string | null;
	/** Posição no lote, de 1 a `batch_size`. */
	piece_index: number;
	/** Quantas peças o lote tem. */
	batch_size: number;
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

/**
 * Emite as N peças de UM lote, com um código por peça.
 *
 * ┌─ A IDEMPOTÊNCIA MUDOU DE GRÃO ───────────────────────────────────────────┐
 * │ Era por RODADA (`invocation_id` unique): reenvio devolvia o mesmo código. │
 * │ Agora é por PEÇA da rodada (`invocation_id, piece_index`), porque uma     │
 * │ rodada legitimamente emite N.                                             │
 * │                                                                           │
 * │ Uma retentativa relê o que já existe e insere SÓ os índices que faltam —  │
 * │ nunca regera código de peça que já nasceu. Se o arquivo da peça 7 já foi  │
 * │ entregue ao aluno, um retry que trocasse o código dela transformaria      │
 * │ aquele QR gravado num código órfão.                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Sem `.upsert({ onConflict })` de propósito: o índice é PARCIAL (`where
 * invocation_id is not null`) e o PostgREST não expõe a cláusula de predicado
 * que o `ON CONFLICT` do Postgres exige para usar índice parcial como árbitro.
 */
export async function emitirLote(
	input: EmitirLicencaInput & { batchId: string; tamanho: number },
): Promise<LicensedArt[]> {
	const existentes = input.invocationId
		? await listarPorInvocacao(input.invocationId)
		: [];
	const jaTem = new Set(existentes.map((a) => a.piece_index));

	const novas: Record<string, unknown>[] = [];
	for (let i = 1; i <= input.tamanho; i++) {
		if (jaTem.has(i)) continue;
		const code = gerarCodigoLicenca();
		novas.push({
			customer_id: input.customerId,
			feature_key: input.featureKey,
			licensor_name: input.licensorName ?? null,
			code,
			code_hash: hashCodigo(code),
			tool_key: input.toolKey,
			invocation_id: input.invocationId ?? null,
			preview_url: null,
			prompt_title: input.promptTitle ?? null,
			batch_id: input.batchId,
			piece_index: i,
			batch_size: input.tamanho,
		});
	}

	if (novas.length > 0) {
		const { error } = await supabase.from(TABELA).insert(novas);
		// 23505: outra requisição da MESMA rodada ganhou a corrida. O lote dela é
		// o certo — releremos tudo abaixo.
		if (error && error.code !== '23505') {
			throw new Error(`emitirLote: ${error.message}`);
		}
	}

	const todas = input.invocationId
		? await listarPorInvocacao(input.invocationId)
		: [];
	if (todas.length >= input.tamanho) return todas.slice(0, input.tamanho);
	throw new Error(
		`emitirLote: esperava ${input.tamanho} peças, encontrei ${todas.length}`,
	);
}

/** As peças de uma rodada, em ordem de gravação. */
export async function listarPorInvocacao(
	invocationId: string,
): Promise<LicensedArt[]> {
	const { data, error } = await supabase
		.from(TABELA)
		.select('*')
		.eq('invocation_id', invocationId)
		.order('piece_index');
	if (error) throw new Error(`listarPorInvocacao: ${error.message}`);
	return (data as LicensedArt[]) ?? [];
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

/**
 * A busca do QR público: bate no hash, nunca no código em claro.
 *
 * NÃO filtra `archived_at` — e não pode. Arquivar é arrumação da estante do
 * aluno; o QR gravado na peça física continua tendo de resolver.
 */
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

/**
 * A biblioteca do aluno — as ativas por padrão, as arquivadas sob pedido.
 *
 * O corte de arquivadas é feito em MEMÓRIA, e não no `where`, para a coluna
 * poder nascer sem deploy coordenado: enquanto `archived_at` não existir, o
 * `select('*')` simplesmente não a traz, o campo fica indefinido e toda peça
 * conta como ativa — em vez de a listagem inteira morrer com "column does not
 * exist". A conta é barata: a lista já é do dono e tem teto.
 */
export async function listarDoCliente(
	customerId: string,
	opts: { arquivadas?: boolean } = {},
	limite = 50,
): Promise<LicensedArt[]> {
	const { data } = await supabase
		.from(TABELA)
		.select('*')
		.eq('customer_id', customerId)
		.order('created_at', { ascending: false })
		// Folga sobre o teto: sem ela, arquivar peças recentes ia comendo lugar
		// da página e a biblioteca encolhia a cada arrumação.
		.limit(limite * 4);
	const linhas = (data as LicensedArt[]) ?? [];
	return linhas
		.filter((a) => (opts.arquivadas ? !!a.archived_at : !a.archived_at))
		.slice(0, limite);
}

/**
 * Anexa a arte à licença DEPOIS que o arquivo existe.
 *
 * A ordem importa: o código é emitido antes de o arquivo ser carimbado (é ele
 * que vai gravado na peça), então a linha nasce sem `preview_url`. Uma falha no
 * carimbo estorna o run e deixa a linha sem arte — e a retentativa, idempotente
 * pelo `invocation_id`, reusa o MESMO código e preenche aqui.
 */
export async function anexarArte(
	id: string,
	previewUrl: string,
): Promise<void> {
	const { error } = await supabase
		.from(TABELA)
		.update({ preview_url: previewUrl })
		.eq('id', id);
	if (error) throw new Error(`anexarArte: ${error.message}`);
}

/** O mesmo, para as N peças de um lote — uma ida ao banco por peça. */
export async function anexarArtes(
	pares: { id: string; previewUrl: string }[],
): Promise<void> {
	await Promise.all(pares.map((p) => anexarArte(p.id, p.previewUrl)));
}

/**
 * Arquivar tira a peça da biblioteca — e NÃO apaga a licença.
 *
 * O QR dela pode já estar gravado num chaveiro que saiu daqui. Apagar a linha
 * transformaria esse QR num 404, e a página pública lê código inexistente como
 * sinal de falsificação: o aluno arrumando a própria estante acabaria acusando
 * a própria peça. Por isso é reversível, e por isso `buscarPorCodigo` não olha
 * `archived_at`.
 *
 * O `customer_id` no filtro é a AUTORIZAÇÃO: sem ele, o id de uma peça alheia
 * bastaria para sumir com a peça de outra pessoa.
 */
export async function arquivarDoCliente(
	id: string,
	customerId: string,
	arquivar: boolean,
): Promise<LicensedArt | null> {
	const { data, error } = await supabase
		.from(TABELA)
		.update({ archived_at: arquivar ? new Date().toISOString() : null })
		.eq('id', id)
		.eq('customer_id', customerId)
		.select('*')
		.maybeSingle();
	// Sem `.is('archived_at', null)` de propósito: repetir a operação devolve a
	// mesma peça em vez de um 404 inventado. Arquivar duas vezes é arquivado.
	if (error) throw new Error(`arquivarDoCliente: ${error.message}`);
	return (data as LicensedArt) ?? null;
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
