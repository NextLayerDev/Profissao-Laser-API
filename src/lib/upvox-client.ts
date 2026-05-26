// ─────────────────────────────────────────────────────────────────────
// Cliente HTTP da upvox-api — fonte única do sistema de voxes.
//
//   • GET  /v1/me/voxes              → { balance, ledger[] }
//   • POST /v1/tool/:toolKey/invoke  → entitlement+capacity+charge atomicamente
//
// Autenticação: bearer JWT (mesmo token do Supabase Auth que chega aqui no
// header Authorization). Repassamos o token do customer; nada de service key.
//
// Timeouts: 10s. invokeTool NÃO faz retry (não é idempotente — duplica cobrança).
// getBalance pode ter retry simples em 5xx/network.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL =
	'https://profissao-laser-upvox-api.1nwz76.easypanel.host';
const TIMEOUT_MS = 10_000;

function baseUrl(): string {
	return (process.env.UPVOX_API_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

export interface UpvoxLedgerEntry {
	id: string;
	customer_id: string;
	delta: number;
	reason: 'purchase' | 'spend' | 'refund' | 'adjustment';
	ref_type: string | null;
	ref_id: string | null;
	created_at: string;
}

export interface UpvoxBalanceResponse {
	balance: number;
	ledger: UpvoxLedgerEntry[];
}

export interface UpvoxInvokeResponse {
	invocation_id: string;
	quota_consumed: number;
	voxes_spent: number;
	balance: number;
}

/**
 * Erro estruturado de chamadas à upvox-api. Preserva `status` HTTP e `code`
 * para o controller mapear na resposta (compre voxes vs assine plano etc.).
 */
export class UpvoxApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly body?: unknown,
	) {
		super(message);
		this.name = 'UpvoxApiError';
	}
}

function bearer(jwt: string): string {
	return jwt.startsWith('Bearer ') ? jwt : `Bearer ${jwt}`;
}

async function parseError(res: Response): Promise<UpvoxApiError> {
	let body: unknown = null;
	let code = 'upstream_error';
	let message = `upvox-api ${res.status}`;
	try {
		body = await res.json();
		if (body && typeof body === 'object') {
			const b = body as Record<string, unknown>;
			if (typeof b.code === 'string') code = b.code;
			if (typeof b.message === 'string') message = b.message;
			else if (typeof b.error === 'string') message = b.error;
		}
	} catch {
		// resposta não-JSON
	}
	return new UpvoxApiError(res.status, code, message, body);
}

export async function getBalance(jwt: string): Promise<UpvoxBalanceResponse> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await fetch(`${baseUrl()}/v1/me/voxes`, {
				method: 'GET',
				headers: {
					Authorization: bearer(jwt),
					Accept: 'application/json',
				},
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!res.ok) {
				// Retry só em 5xx
				if (res.status >= 500 && attempt === 0) {
					lastErr = await parseError(res);
					continue;
				}
				throw await parseError(res);
			}
			return (await res.json()) as UpvoxBalanceResponse;
		} catch (err) {
			lastErr = err;
			if (err instanceof UpvoxApiError) throw err;
			// Network/timeout: tenta de novo uma vez
			if (attempt === 0) continue;
			throw err;
		}
	}
	throw lastErr ?? new Error('upvox-api unreachable');
}

export async function invokeTool(
	jwt: string,
	toolKey: string,
	courseSlug: string,
): Promise<UpvoxInvokeResponse> {
	const res = await fetch(
		`${baseUrl()}/v1/tool/${encodeURIComponent(toolKey)}/invoke`,
		{
			method: 'POST',
			headers: {
				Authorization: bearer(jwt),
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify({ course_slug: courseSlug }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	);
	if (!res.ok) {
		throw await parseError(res);
	}
	return (await res.json()) as UpvoxInvokeResponse;
}
