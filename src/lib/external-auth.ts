const externalApiUrl = process.env.EXTERNAL_API_URL as string;

if (!externalApiUrl) {
	throw new Error('EXTERNAL_API_URL is not defined in .env');
}

/**
 * Cache curto + dedup de chamadas in-flight por token. A auth (e a da comunidade)
 * chama o upvox em TODA request — e cada página dispara várias em paralelo. Sem
 * isto, cada uma fazia um round-trip ao upvox (a causa da "demora no 1º load").
 * Só cacheia sucesso (não-nulo); erro não fica preso. TTL curto mantém correto.
 */
function tokenCache<T>(ttlMs: number) {
	const store = new Map<string, { at: number; data: T }>();
	const inflight = new Map<string, Promise<T>>();
	return (token: string, loader: () => Promise<T>): Promise<T> => {
		const hit = store.get(token);
		if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.data);
		const pending = inflight.get(token);
		if (pending) return pending;
		const p = (async () => {
			try {
				const data = await loader();
				if (data != null) {
					if (store.size > 2000) store.clear();
					store.set(token, { at: Date.now(), data });
				}
				return data;
			} finally {
				inflight.delete(token);
			}
		})();
		inflight.set(token, p);
		return p;
	};
}

// 5 min: a identidade/assinatura do cliente quase não muda no meio da sessão.
// Depois da 1ª request, toda página da sessão reaproveita (sem round-trip ao
// upvox em authenticate/authenticateCommunity).
const AUTH_CACHE_TTL = 5 * 60_000;

/**
 * Usuário retornado por GET {EXTERNAL_API_URL}/v1/me na nova API.
 * O endpoint valida o Bearer token e devolve o usuário com `role`/`blocked`.
 */
export interface ExternalUser {
	id: string;
	email: string;
	phone: string | null;
	name: string | null;
	role: string; // 'admin' | 'staff' | 'customer' | ...
	blocked: boolean;
	created_at?: string;
	updated_at?: string;
}

/** Roles com acesso ao painel administrativo. */
const STAFF_ROLES = new Set(['admin', 'staff']);

/** Roles de app reconhecidos (vindos de `public.users.role` na upvox). */
const APP_ROLES = new Set(['customer', 'staff', 'admin']);

export const isStaffRole = (role: string | null | undefined): boolean =>
	role != null && STAFF_ROLES.has(role);

export const isAdminRole = (role: string | null | undefined): boolean =>
	role === 'admin';

/**
 * `true` se `role` é um role de app conhecido. Usado para decidir se o
 * `x-user-role` injetado pelo gateway é confiável: o JWT do Supabase carrega
 * `role:"authenticated"` (role do Postgres), que NÃO é um role de app — nesse
 * caso revalidamos o token via `/v1/me` para obter o role real.
 */
export const isKnownAppRole = (role: string | null | undefined): boolean =>
	role != null && APP_ROLES.has(role);

/**
 * Cria um novo customer na upvox-api (POST /v1/auth/signup).
 * Ignora conflito silenciosamente (email já registado).
 */
export async function registerExternalCustomer(data: {
	email: string;
	password: string;
	name: string;
	phone?: string | null;
}): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`${externalApiUrl}/v1/auth/signup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
	} catch (err) {
		throw new Error(`Failed to reach upvox-api: ${err}`);
	}
	if (res.status === 409) return; // already registered — ok
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Account creation failed (${res.status}): ${body}`);
	}
}

/**
 * Valida o token contra a nova API e retorna o usuário (com role/blocked),
 * ou `null` se o token for inválido/expirado.
 */
const externalUserCache = tokenCache<ExternalUser | null>(AUTH_CACHE_TTL);

export async function fetchExternalUser(
	token: string,
): Promise<ExternalUser | null> {
	return externalUserCache(token, async () => {
		let res: Response;
		try {
			res = await fetch(`${externalApiUrl}/v1/me`, {
				headers: { Authorization: `Bearer ${token}` },
			});
		} catch {
			return null;
		}
		if (!res.ok) return null;
		return (await res.json()) as ExternalUser;
	});
}

/**
 * Entitlements do cliente em GET {EXTERNAL_API_URL}/v1/me/entitlements.
 * Fonte-de-verdade da assinatura ativa pós-migração (a main API legada não
 * guarda mais a assinatura). Só tipamos o que a auth precisa.
 */
export interface ExternalEntitlements {
	is_test_unlimited: boolean;
	subscription: {
		status: string;
		// O JSON do upvox já traz o plano ativo; tipamos o que a auth precisa.
		plan?: { key: string; name: string } | null;
	} | null;
}

/**
 * Busca os entitlements do cliente no upvox repassando o mesmo Bearer da
 * request (mesmo padrão de `fetchExternalUser`). `null` em qualquer falha.
 */
const entitlementsCache = tokenCache<ExternalEntitlements | null>(
	AUTH_CACHE_TTL,
);

export async function fetchEntitlements(
	token: string,
): Promise<ExternalEntitlements | null> {
	return entitlementsCache(token, async () => {
		try {
			const res = await fetch(`${externalApiUrl}/v1/me/entitlements`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) return null;
			return (await res.json()) as ExternalEntitlements;
		} catch {
			return null;
		}
	});
}

/**
 * Atualiza o usuário no upvox (PATCH /v1/me) repassando o Bearer do cliente.
 * O nome é a fonte de verdade no upvox pós-migração. Lança em falha.
 */
export async function updateExternalUser(
	token: string,
	input: { name?: string },
): Promise<ExternalUser | null> {
	let res: Response;
	try {
		res = await fetch(`${externalApiUrl}/v1/me`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(input),
		});
	} catch (err) {
		throw new Error(`Failed to reach upvox-api: ${err}`);
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Profile update failed (${res.status}): ${body}`);
	}
	return (await res.json()) as ExternalUser;
}
