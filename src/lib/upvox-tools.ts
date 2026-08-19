const externalApiUrl = process.env.EXTERNAL_API_URL as string;

if (!externalApiUrl) {
	throw new Error('EXTERNAL_API_URL is not defined in .env');
}

/**
 * Server-to-server calls to upvox's tool-invocation lifecycle. The engine
 * (main API) validates a paid invocation before running, then settles it on
 * success or refunds it on failure — making billing authoritative and the
 * engine impossible to use for free.
 *
 * Autenticamos de DOIS jeitos ao mesmo tempo (robusto pro valor de
 * `EXTERNAL_API_URL`): mandamos o `x-user-id` (confiado quando a chamada vai
 * DIRETO ao upvox) E repassamos o Bearer original do cliente — que o gateway
 * exige (ele valida o JWT, injeta a identidade e SANITIZA/ignora `x-user-*` do
 * cliente). Apontando pro gateway, vale o Bearer; direto no upvox, vale o
 * `x-user-id`. É o mesmo Bearer que autenticou a requisição do motor, então é
 * válido. upvox ainda escopa toda chamada ao dono, então uma invocation só
 * pode ser tocada pelo próprio customer.
 *
 * Sem repassar o Bearer, com `EXTERNAL_API_URL` no gateway, o upvox respondia
 * 401 → `getInvocation` virava null → `resolveToolBilling` devolvia
 * `invalid_invocation` (403) e o motor nunca rodava nem liquidava.
 */
export interface ToolInvocation {
	id: string;
	customer_id: string;
	course_id: string;
	tool_key: string;
	status: 'pending' | 'succeeded' | 'failed' | 'refunded';
	quota_consumed: number;
	voxes_spent: number;
	/** Unidades de geração compradas. Nulo/ausente = invocação anterior à coluna. */
	units?: number | null;
	/** Peças licenciadas além da primeira. */
	license_units?: number | null;
}

/**
 * Headers da chamada server-to-server ao upvox. Manda `x-user-id` (confiado
 * quando a chamada vai DIRETO ao upvox) E repassa o Bearer original do request,
 * quando houver — necessário se `EXTERNAL_API_URL` for o gateway, que valida o
 * token, injeta a identidade e IGNORA/sanitiza `x-user-*` do cliente. Com os
 * dois headers, funciona apontando pro gateway OU direto pro upvox.
 */
function asCustomer(
	customerId: string,
	authHeader?: string,
): Record<string, string> {
	const headers: Record<string, string> = {
		'x-user-id': customerId,
		'x-user-role': 'customer',
	};
	if (authHeader) headers.authorization = authHeader;
	return headers;
}

/** GET /v1/tool/invocation/:id — returns the invocation or null on any failure. */
export async function getInvocation(
	customerId: string,
	id: string,
	authHeader?: string,
): Promise<ToolInvocation | null> {
	try {
		const res = await fetch(`${externalApiUrl}/v1/tool/invocation/${id}`, {
			headers: asCustomer(customerId, authHeader),
		});
		if (!res.ok) {
			// Não engole em silêncio: 401 aqui = EXTERNAL_API_URL no gateway sem Bearer.
			console.error(
				`[upvox-tools] getInvocation ${id} → HTTP ${res.status} (EXTERNAL_API_URL=${externalApiUrl})`,
			);
			return null;
		}
		return (await res.json()) as ToolInvocation;
	} catch (err) {
		console.error(`[upvox-tools] getInvocation ${id} falhou:`, err);
		return null;
	}
}

/** POST /v1/tool/invocation/:id/settle — mark a succeeded run (idempotent). */
export async function settleInvocation(
	customerId: string,
	id: string,
	authHeader?: string,
): Promise<void> {
	await fetch(`${externalApiUrl}/v1/tool/invocation/${id}/settle`, {
		method: 'POST',
		headers: asCustomer(customerId, authHeader),
	}).catch((err) => console.error(`[upvox-tools] settle ${id} falhou:`, err));
}

/** POST /v1/tool/invocation/:id/refund — reverse the charge on engine failure. */
export async function refundInvocation(
	customerId: string,
	id: string,
	authHeader?: string,
): Promise<void> {
	await fetch(`${externalApiUrl}/v1/tool/invocation/${id}/refund`, {
		method: 'POST',
		headers: asCustomer(customerId, authHeader),
	}).catch((err) => console.error(`[upvox-tools] refund ${id} falhou:`, err));
}

interface EntitlementsResponse {
	/**
	 * `vox_cost` vem da coluna da tabela `tools` do upvox — a MESMA que
	 * `authorizeAndCharge` usa para debitar. É por isso que o preço unitário é
	 * lido daqui e não de `definition.billing.vox_cost`: os dois divergem em 5
	 * das 6 tools publicadas hoje (o publish escreve o catálogo, mas o admin
	 * pode editar o preço na tela de Ferramentas sem republicar a definition).
	 * Reconciliar com o número errado transformaria run legítimo em recusa.
	 */
	tools?: Array<{ key: string; vox_cost?: number | string }>;
}

/** Customer entitlements via upvox (x-user-id auth). null on any failure. */
async function fetchEntitlementsAsCustomer(
	customerId: string,
	authHeader?: string,
): Promise<EntitlementsResponse | null> {
	try {
		const res = await fetch(`${externalApiUrl}/v1/me/entitlements`, {
			headers: asCustomer(customerId, authHeader),
		});
		if (!res.ok) return null;
		return (await res.json()) as EntitlementsResponse;
	} catch {
		return null;
	}
}

/**
 * `true` if `toolKey` is a billed tool for this customer (entitled in their plan).
 *
 * FALHA FECHANDO, de propósito: se a leitura de entitlements não completa
 * (upvox fora do ar, gateway 401, timeout), respondemos `true` — "trate como
 * cobrada". Antes respondia `false`, e `false` aqui vira `mode:'free'` no
 * portão: uma indisponibilidade do upvox liberava TODA tool paga para rodar de
 * graça, com o fornecedor pago do nosso bolso. E não custa nada fechar:
 * com o upvox fora, o `/invoke` também está, então nenhum run legítimo tinha
 * como acontecer nessa janela de qualquer jeito.
 */
export async function isToolBilled(
	customerId: string,
	toolKey: string,
	authHeader?: string,
): Promise<boolean> {
	const ent = await fetchEntitlementsAsCustomer(customerId, authHeader);
	if (!ent?.tools) {
		console.error(
			`[upvox-tools] entitlements indisponível para ${customerId} — tratando '${toolKey}' como COBRADA (fail-closed).`,
		);
		return true;
	}
	return ent.tools.some((t) => t.key === toolKey);
}

/**
 * Preço unitário da tool em voxxys, do catálogo do upvox (`tools.vox_cost`).
 *
 * `undefined` em qualquer falha — rede fora, tool não listada para este cliente,
 * número inválido. Quem chama TRATA `undefined` como "não sei" e deixa o run
 * passar: esta leitura existe para reconciliar cobrança, e uma indisponibilidade
 * do upvox não pode virar recusa de trabalho já pago.
 */
export async function getToolVoxCost(
	customerId: string,
	toolKey: string,
	authHeader?: string,
): Promise<number | undefined> {
	const ent = await fetchEntitlementsAsCustomer(customerId, authHeader);
	const raw = ent?.tools?.find((t) => t.key === toolKey)?.vox_cost;
	if (raw === undefined || raw === null) return undefined;
	// numeric do Postgres chega como string em alguns caminhos do supabase-js.
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * ┌─ UM RECIBO, UM RUN — a outra metade do furo de cobrança ────────────────┐
 * │ `resolveToolBilling` LÊ `status === 'pending'` e devolve. Não reserva,   │
 * │ não marca, não trava. A invocação só sai de `pending` no `settle`, que   │
 * │ acontece no FIM do run — e o fim, no Ateliê, é 99 s depois (medido).     │
 * │ Nessa janela o MESMO `invocation_id` passa no portão quantas vezes for   │
 * │ disparado em paralelo: 3 runs simultâneos = 3× o fornecedor por 1        │
 * │ cobrança. Fechar a contagem (pagou 1, pediu 4) não fechava isto: o       │
 * │ atacante só precisa mandar N runs de 1 variação com o mesmo recibo.      │
 * │                                                                          │
 * │ Isto aqui é a trava: enquanto um run está em voo com um recibo, nenhum   │
 * │ outro entra com o mesmo recibo.                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ALCANCE, DITO SEM MAQUIAGEM: a trava é DESTE PROCESSO. Com mais de uma
 * réplica da API, dois runs em réplicas diferentes ainda passam. A trava
 * durável é do upvox — uma transição guardada `pending → running` no próprio
 * `markInvocationStatusIf`, que já existe lá e já é atômica. Ela não entrou
 * agora porque exige um valor novo na coluna `status`, e isso é DDL/migração,
 * que está fora do escopo desta rodada. O que está aqui reduz a exploração de
 * "ilimitada" para "limitada ao número de réplicas", e não tem contrapartida.
 */
const recibosEmVoo = new Set<string>();

/**
 * Tenta tomar posse de um `invocation_id` para ESTE run. `false` = já tem run
 * em voo com o mesmo recibo (quem chama recusa sem estornar: estornar mataria
 * o run legítimo que está lá dentro trabalhando).
 */
export function reservarInvocacao(id: string): boolean {
	if (recibosEmVoo.has(id)) return false;
	recibosEmVoo.add(id);
	return true;
}

/** Devolve o recibo. Tem de rodar em `finally` — inclusive quando o run explode. */
export function liberarInvocacao(id: string): void {
	recibosEmVoo.delete(id);
}

/** Só para teste: nenhum recibo em voo entre casos. */
export function limparReservas(): void {
	recibosEmVoo.clear();
}

/**
 * How an engine run should be billed (see `resolveToolBilling`).
 *
 * `voxesSpent`/`quotaConsumed` são o QUE FOI PAGO, vindos da própria invocação.
 * Antes o gate buscava a invocação, lia esses dois campos e os jogava fora —
 * e sem eles o motor não tinha como saber que o cliente pagou por 1 variação e
 * pediu 4 no run. Ver `variacoesPagas` (`lib/tool-creations.ts`).
 */
export type BillingGate =
	| {
			mode: 'paid';
			invocationId: string;
			voxesSpent: number;
			quotaConsumed: number;
			/**
			 * Quantas unidades a invocação COMPROU, dito pelo upvox. `null` numa
			 * invocação anterior à coluna — aí o motor volta a inferir pelo valor
			 * pago.
			 */
			units: number | null;
			/** Peças licenciadas além da primeira que a invocação comprou. */
			licenseUnits: number;
	  }
	| { mode: 'free' }
	| { mode: 'reject'; status: number; message: string };

/**
 * Decide how to bill an engine tool run (optional billing):
 * - `invocationId` present → validate the paid invocation (pending/tool_key/owner);
 *   the caller settles on success or refunds on failure.
 * - `invocationId` absent → run FREE only if the tool isn't billed for this
 *   customer; otherwise reject 402 (so billing can't be bypassed by omitting the id).
 */
export async function resolveToolBilling(
	customerId: string,
	toolKey: string,
	invocationId: string | null,
	authHeader?: string,
): Promise<BillingGate> {
	if (invocationId) {
		const inv = await getInvocation(customerId, invocationId, authHeader);
		if (
			!inv ||
			inv.status !== 'pending' ||
			inv.tool_key !== toolKey ||
			inv.customer_id !== customerId
		) {
			return { mode: 'reject', status: 403, message: 'invalid_invocation' };
		}
		return {
			mode: 'paid',
			invocationId,
			// Números podem chegar como string (numeric do Postgres). Normaliza aqui,
			// no ponto de entrada, para o resto do motor só ver number.
			voxesSpent: Number(inv.voxes_spent) || 0,
			quotaConsumed: Number(inv.quota_consumed) || 0,
			units:
				inv.units === null || inv.units === undefined
					? null
					: Number(inv.units) || null,
			licenseUnits: Number(inv.license_units ?? 0) || 0,
		};
	}
	if (await isToolBilled(customerId, toolKey, authHeader)) {
		return { mode: 'reject', status: 402, message: 'billing_required' };
	}
	return { mode: 'free' };
}
