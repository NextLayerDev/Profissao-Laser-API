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
 * We authenticate to upvox the SAME way the gateway does: forwarding the
 * already-validated identity as `x-user-*` headers (upvox's requireAuth trusts
 * them). We use the gateway-injected customer id (`currentCustomer.id`), which
 * the main API reliably has — NOT the customer Bearer, which the gateway does
 * not reliably forward to the main API (the cause of `invalid_invocation`).
 * upvox still scopes every call to the owner, so an invocation can only be
 * touched by its own customer.
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

/** Authenticate a server-to-server call as the acting customer (gateway-style). */
function asCustomer(customerId: string): Record<string, string> {
	return { 'x-user-id': customerId, 'x-user-role': 'customer' };
}

/** GET /v1/tool/invocation/:id — returns the invocation or null on any failure. */
export async function getInvocation(
	customerId: string,
	id: string,
): Promise<ToolInvocation | null> {
	try {
		const res = await fetch(`${externalApiUrl}/v1/tool/invocation/${id}`, {
			headers: asCustomer(customerId),
		});
		if (!res.ok) return null;
		return (await res.json()) as ToolInvocation;
	} catch {
		return null;
	}
}

/** POST /v1/tool/invocation/:id/settle — mark a succeeded run (idempotent). */
export async function settleInvocation(
	customerId: string,
	id: string,
): Promise<void> {
	await fetch(`${externalApiUrl}/v1/tool/invocation/${id}/settle`, {
		method: 'POST',
		headers: asCustomer(customerId),
	}).catch(() => {});
}

/** POST /v1/tool/invocation/:id/refund — reverse the charge on engine failure. */
export async function refundInvocation(
	customerId: string,
	id: string,
): Promise<void> {
	await fetch(`${externalApiUrl}/v1/tool/invocation/${id}/refund`, {
		method: 'POST',
		headers: asCustomer(customerId),
	}).catch(() => {});
}
