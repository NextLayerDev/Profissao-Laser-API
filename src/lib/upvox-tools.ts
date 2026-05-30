const externalApiUrl = process.env.EXTERNAL_API_URL as string;

if (!externalApiUrl) {
	throw new Error('EXTERNAL_API_URL is not defined in .env');
}

/**
 * Server-to-server calls to upvox's tool-invocation lifecycle. The engine
 * (main API) validates a paid invocation before running, then settles it on
 * success or refunds it on failure — making billing authoritative and the
 * engine impossible to use for free. We forward the SAME customer Bearer token
 * the request carried (mirrors `external-auth.ts`), so upvox authorizes each
 * call as the acting customer and an invocation can only be touched by its
 * owner.
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

/** GET /v1/tool/invocation/:id — returns the invocation or null on any failure. */
export async function getInvocation(
	token: string,
	id: string,
): Promise<ToolInvocation | null> {
	try {
		const res = await fetch(`${externalApiUrl}/v1/tool/invocation/${id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return null;
		return (await res.json()) as ToolInvocation;
	} catch {
		return null;
	}
}

/** POST /v1/tool/invocation/:id/settle — mark a succeeded run (idempotent). */
export async function settleInvocation(
	token: string,
	id: string,
): Promise<void> {
	await fetch(`${externalApiUrl}/v1/tool/invocation/${id}/settle`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
	}).catch(() => {});
}

/** POST /v1/tool/invocation/:id/refund — reverse the charge on engine failure. */
export async function refundInvocation(
	token: string,
	id: string,
): Promise<void> {
	await fetch(`${externalApiUrl}/v1/tool/invocation/${id}/refund`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
	}).catch(() => {});
}
