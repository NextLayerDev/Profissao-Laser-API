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

export const isStaffRole = (role: string | null | undefined): boolean =>
	role != null && STAFF_ROLES.has(role);

export const isAdminRole = (role: string | null | undefined): boolean =>
	role === 'admin';

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
