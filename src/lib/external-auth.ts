const externalApiUrl = process.env.EXTERNAL_API_URL as string;

if (!externalApiUrl) {
	throw new Error('EXTERNAL_API_URL is not defined in .env');
}

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
export async function fetchExternalUser(
	token: string,
): Promise<ExternalUser | null> {
	let res: Response;
	try {
		res = await fetch(`${externalApiUrl}/v1/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch {
		return null;
	}

	if (!res.ok) {
		return null;
	}

	return (await res.json()) as ExternalUser;
}

/**
 * Entitlements do cliente em GET {EXTERNAL_API_URL}/v1/me/entitlements.
 * Fonte-de-verdade da assinatura ativa pós-migração (a main API legada não
 * guarda mais a assinatura). Só tipamos o que a auth precisa.
 */
export interface ExternalEntitlements {
	is_test_unlimited: boolean;
	subscription: { status: string } | null;
}

/**
 * Busca os entitlements do cliente no upvox repassando o mesmo Bearer da
 * request (mesmo padrão de `fetchExternalUser`). `null` em qualquer falha.
 */
export async function fetchEntitlements(
	token: string,
): Promise<ExternalEntitlements | null> {
	try {
		const res = await fetch(`${externalApiUrl}/v1/me/entitlements`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return null;
		return (await res.json()) as ExternalEntitlements;
	} catch {
		return null;
	}
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
