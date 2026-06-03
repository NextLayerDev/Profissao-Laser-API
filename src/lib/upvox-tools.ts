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
	tools?: Array<{ key: string }>;
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

/** `true` if `toolKey` is a billed tool for this customer (entitled in their plan). */
export async function isToolBilled(
	customerId: string,
	toolKey: string,
	authHeader?: string,
): Promise<boolean> {
	const ent = await fetchEntitlementsAsCustomer(customerId, authHeader);
	return Boolean(ent?.tools?.some((t) => t.key === toolKey));
}

/** How an engine run should be billed (see `resolveToolBilling`). */
export type BillingGate =
	| { mode: 'paid'; invocationId: string }
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
		return { mode: 'paid', invocationId };
	}
	if (await isToolBilled(customerId, toolKey, authHeader)) {
		return { mode: 'reject', status: 402, message: 'billing_required' };
	}
	return { mode: 'free' };
}
