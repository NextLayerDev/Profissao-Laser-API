import { TERMO_VERSAO } from '../lib/licensed-terms.js';
import { supabase } from '../lib/supabase.js';

const CANAIS = 'pl_licensed_seller_channel';
const ACEITES = 'pl_licensed_seller_term';

export interface CanalDeVenda {
	id: string;
	customer_id: string;
	url: string;
	label: string | null;
	created_at: string;
	removed_at: string | null;
}

export interface AceiteDoTermo {
	id: string;
	customer_id: string;
	terms_version: string;
	channels_snapshot: { url: string; label: string | null }[];
	accepted_at: string;
	accepted_ip_hash: string | null;
}

/**
 * Por que a declaração não está valendo. `ok` é o único estado que libera.
 *
 * São quatro e não dois porque a tela precisa dizer o que FALTA, e "faltou
 * alguma coisa" não é instrução. Cada um destes vira uma frase diferente.
 */
export type StatusDaDeclaracao =
	/** Nunca cadastrou canal nenhum. */
	| 'sem_canal'
	/** Tem canal, nunca aceitou o termo. */
	| 'termo_pendente'
	/** Aceitou, mas depois mexeu na lista — o que ele declarou não é mais o que é. */
	| 'lista_mudou'
	/** Aceitou uma redação anterior do termo. */
	| 'termo_mudou'
	| 'ok';

/**
 * A CHAVE DE COMPARAÇÃO de um canal.
 *
 * Compara-se a URL, não o id da linha: o que a declaração afirma é *onde* a
 * pessoa vende. Tirar uma loja e recadastrar o mesmo endereço muda o id e não
 * muda o fato — vencer a declaração ali seria pedir um clique por nada.
 *
 * Normalização deliberadamente rasa: minúsculas, sem espaço nas pontas e sem a
 * barra final. Não mexe em protocolo nem em `www`, porque `loja.com` e
 * `www.loja.com` podem de fato ser páginas diferentes e não cabe a esta função
 * decidir que não são.
 */
const chaveDoCanal = (url: string): string =>
	url.trim().toLowerCase().replace(/\/+$/, '');

const mesmoConjunto = (a: string[], b: string[]): boolean => {
	if (a.length !== b.length) return false;
	const setA = new Set(a);
	return b.every((x) => setA.has(x));
};

/** Os canais ativos do aluno, do mais antigo para o mais novo. */
export async function listarCanais(
	customerId: string,
): Promise<CanalDeVenda[]> {
	const { data, error } = await supabase
		.from(CANAIS)
		.select('*')
		.eq('customer_id', customerId)
		.is('removed_at', null)
		.order('created_at');
	if (error) throw new Error(`listarCanais: ${error.message}`);
	return (data as CanalDeVenda[]) ?? [];
}

export async function adicionarCanal(input: {
	customerId: string;
	url: string;
	label?: string | null;
}): Promise<CanalDeVenda> {
	const { data, error } = await supabase
		.from(CANAIS)
		.insert({
			customer_id: input.customerId,
			url: input.url.trim(),
			label: input.label?.trim() || null,
		})
		.select('*')
		.single();
	if (error) throw new Error(`adicionarCanal: ${error.message}`);
	return data as CanalDeVenda;
}

/**
 * Tira o canal da lista sem apagar a linha.
 *
 * O `customer_id` no filtro é a AUTORIZAÇÃO: um id adivinhado não pode mexer na
 * declaração de outra pessoa.
 */
export async function removerCanal(
	id: string,
	customerId: string,
): Promise<boolean> {
	const { data, error } = await supabase
		.from(CANAIS)
		.update({ removed_at: new Date().toISOString() })
		.eq('id', id)
		.eq('customer_id', customerId)
		.is('removed_at', null)
		.select('id');
	if (error) throw new Error(`removerCanal: ${error.message}`);
	return (data?.length ?? 0) > 0;
}

/** O aceite mais recente, ou nulo se nunca aceitou. */
export async function ultimoAceite(
	customerId: string,
): Promise<AceiteDoTermo | null> {
	const { data, error } = await supabase
		.from(ACEITES)
		.select('*')
		.eq('customer_id', customerId)
		.order('accepted_at', { ascending: false })
		.limit(1);
	if (error) throw new Error(`ultimoAceite: ${error.message}`);
	return ((data as AceiteDoTermo[])?.[0] as AceiteDoTermo) ?? null;
}

/**
 * Grava um aceite NOVO com o retrato da lista de agora.
 *
 * Nunca atualiza o anterior: a tabela é append-only de propósito. O histórico
 * de declarações é o documento; sobrescrever apagaria o que se quer provar.
 */
export async function registrarAceite(input: {
	customerId: string;
	ipHash?: string | null;
}): Promise<AceiteDoTermo> {
	const canais = await listarCanais(input.customerId);
	if (canais.length === 0) {
		throw new Error('registrarAceite: nenhum canal para declarar');
	}
	const { data, error } = await supabase
		.from(ACEITES)
		.insert({
			customer_id: input.customerId,
			terms_version: TERMO_VERSAO,
			channels_snapshot: canais.map((c) => ({ url: c.url, label: c.label })),
			accepted_ip_hash: input.ipHash ?? null,
		})
		.select('*')
		.single();
	if (error) throw new Error(`registrarAceite: ${error.message}`);
	return data as AceiteDoTermo;
}

export interface Declaracao {
	ok: boolean;
	status: StatusDaDeclaracao;
	canais: CanalDeVenda[];
	aceite: AceiteDoTermo | null;
}

/**
 * A DECLARAÇÃO ESTÁ EM DIA? É a pergunta que o portão faz.
 *
 * Em dia quer dizer três coisas ao mesmo tempo: existe canal, existe aceite da
 * redação ATUAL, e o que foi aceito é o que vale hoje. Basta uma falhar para o
 * portão fechar — e o `status` diz qual, porque a tela precisa instruir, não
 * só barrar.
 */
export async function declaracaoEmDia(customerId: string): Promise<Declaracao> {
	const [canais, aceite] = await Promise.all([
		listarCanais(customerId),
		ultimoAceite(customerId),
	]);

	if (canais.length === 0) {
		return { ok: false, status: 'sem_canal', canais, aceite };
	}
	if (!aceite) {
		return { ok: false, status: 'termo_pendente', canais, aceite };
	}
	if (aceite.terms_version !== TERMO_VERSAO) {
		return { ok: false, status: 'termo_mudou', canais, aceite };
	}
	const declarados = (aceite.channels_snapshot ?? []).map((c) =>
		chaveDoCanal(c.url),
	);
	const atuais = canais.map((c) => chaveDoCanal(c.url));
	if (!mesmoConjunto(declarados, atuais)) {
		return { ok: false, status: 'lista_mudou', canais, aceite };
	}
	return { ok: true, status: 'ok', canais, aceite };
}

/** Uma linha do relatório de staff: quem declarou o quê, e quando. */
export interface VendedorDeclarado {
	customerId: string;
	canais: { url: string; label: string | null }[];
	aceiteEm: string | null;
	versaoAceita: string | null;
	emDia: boolean;
}

/**
 * TODOS OS VENDEDORES, para o staff — e, filtrando por marca, só os que de fato
 * geraram peça daquela marca.
 *
 * O filtro por marca é o que torna o relatório entregável ao clube: ele não tem
 * nada a ver com quem nunca tocou no escudo dele.
 */
export async function listarVendedores(
	featureKey?: string,
): Promise<VendedorDeclarado[]> {
	let donos: string[] | null = null;
	if (featureKey) {
		const { data, error } = await supabase
			.from('pl_licensed_art')
			.select('customer_id')
			.eq('feature_key', featureKey);
		if (error) throw new Error(`listarVendedores: ${error.message}`);
		donos = [
			...new Set(
				((data as { customer_id: string }[]) ?? []).map((r) => r.customer_id),
			),
		];
		if (donos.length === 0) return [];
	}

	let q = supabase.from(CANAIS).select('*').is('removed_at', null);
	if (donos) q = q.in('customer_id', donos);
	const { data: canais, error } = await q.order('created_at');
	if (error) throw new Error(`listarVendedores: ${error.message}`);

	const porDono = new Map<string, CanalDeVenda[]>();
	for (const c of (canais as CanalDeVenda[]) ?? []) {
		const lista = porDono.get(c.customer_id) ?? [];
		lista.push(c);
		porDono.set(c.customer_id, lista);
	}

	// Um aceite por dono. São poucos donos por marca; a leitura em paralelo é
	// mais simples de ler do que uma janela em SQL, e a rota é de staff.
	const ids = [...porDono.keys()];
	const aceites = await Promise.all(ids.map((id) => declaracaoEmDia(id)));

	return ids.map((id, i) => {
		const d = aceites[i];
		return {
			customerId: id,
			canais: (porDono.get(id) ?? []).map((c) => ({
				url: c.url,
				label: c.label,
			})),
			aceiteEm: d.aceite?.accepted_at ?? null,
			versaoAceita: d.aceite?.terms_version ?? null,
			emDia: d.ok,
		};
	});
}
