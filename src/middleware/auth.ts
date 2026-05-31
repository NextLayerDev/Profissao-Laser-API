import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	fetchEntitlements,
	fetchExternalUser,
	isKnownAppRole,
	isStaffRole,
} from '../lib/external-auth.js';

export const authenticate = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	// Preferred path: identity already validated and injected by the gateway.
	const headerId = request.headers['x-user-id'];
	if (typeof headerId === 'string' && headerId.length > 0) {
		if (request.headers['x-user-blocked'] === 'true') {
			return reply.status(403).send({
				statusCode: 403,
				error: 'Forbidden',
				message: 'User is blocked',
			});
		}
		const role = String(request.headers['x-user-role'] ?? '');
		const hasToken = Boolean(request.headers.authorization);
		// O gateway nem sempre injeta um role de app válido: o JWT do Supabase
		// carrega `role:"authenticated"`, não o role real (que vive em
		// public.users.role). Se o header trouxer um role conhecido — ou se não
		// houver token p/ revalidar — confiamos nele; senão caímos no fallback
		// `/v1/me` abaixo, que resolve o role correto.
		if (isKnownAppRole(role) || !hasToken) {
			request.currentUser = {
				id: headerId,
				email: String(request.headers['x-user-email'] ?? ''),
				phone: (request.headers['x-user-phone'] as string) ?? null,
				name: (request.headers['x-user-name'] as string) ?? null,
				role,
				blocked: false,
			};
			request.currentRole = role;
			request.currentCustomer = null;
			return;
		}
	}

	// Transition fallback: validate the Bearer token against Supabase.
	const authHeader = request.headers.authorization;
	const token = authHeader?.replace('Bearer ', '');

	if (!token) {
		return reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Not authenticated',
		});
	}

	try {
		// O login é feito na nova API. GET /v1/me valida o token e devolve o
		// usuário com `role`/`blocked`, que usamos como fonte de autorização.
		const user = await fetchExternalUser(token);

		if (!user) {
			throw new Error('User not found');
		}

		if (user.blocked) {
			return reply.status(403).send({
				statusCode: 403,
				error: 'Forbidden',
				message: 'User is blocked',
			});
		}

		request.currentUser = user;
		request.currentRole = user.role;
		request.currentCustomer = null;
	} catch (error) {
		request.log.warn({ error }, 'Authentication error');
		return reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Invalid or expired token',
		});
	}
};

export const authenticateAdmin = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);
	if (reply.sent || !request.currentUser) return;

	// O acesso ao painel é definido pelo role do token (admin/staff).
	if (!isStaffRole(request.currentRole)) {
		return reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Admin access required',
		});
	}

	// O /v1/me não traz grants granulares, então admin/staff recebem acesso
	// total (super admin). Refinar quando a nova API expor permissões por cargo.
	request.effectivePermissions = [];
	request.isSuperAdminUser = true;
};

/**
 * Exige uma permissão específica (`"<module>.<action>"`). Compõe
 * authenticateAdmin (que já resolve as permissões efetivas) e bloqueia com
 * 403 quem não tiver a chave. Super admin passa sempre.
 */
export function requirePermission(key: string) {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		await authenticateAdmin(request, reply);
		if (reply.sent || !request.currentUser) return;
		if (request.isSuperAdminUser) return;
		if (!(request.effectivePermissions ?? []).includes(key)) {
			return reply.status(403).send({
				statusCode: 403,
				error: 'Forbidden',
				message: `Missing permission: ${key}`,
			});
		}
	};
}

/**
 * Exige permissão de um módulo derivando a ação do método HTTP:
 * GET/HEAD → `.view`, DELETE → `.delete`, demais → `.edit`. Super admin passa.
 * Substitui `authenticateAdmin` em rotas admin de um mesmo módulo.
 */
export function requireModule(module: string) {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		await authenticateAdmin(request, reply);
		if (reply.sent || !request.currentUser) return;
		if (request.isSuperAdminUser) return;
		const method = request.method.toUpperCase();
		const action =
			method === 'GET' || method === 'HEAD'
				? 'view'
				: method === 'DELETE'
					? 'delete'
					: 'edit';
		const key = `${module}.${action}`;
		if (!(request.effectivePermissions ?? []).includes(key)) {
			return reply.status(403).send({
				statusCode: 403,
				error: 'Forbidden',
				message: `Missing permission: ${key}`,
			});
		}
	};
}

export const authenticateCustomer = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);
	if (reply.sent || !request.currentUser) return;

	// Staff: acesso irrestrito (controllers tratam staff via currentUser/query).
	if (isStaffRole(request.currentRole)) return;

	// Identidade apenas: o id do upvox == `Customers.id` (a migração preservou) e
	// funciona p/ signups nativos do upvox — sem lookup legado em `Customers` (que
	// dava 403 em clientes migrados). Onde precisa de assinatura ativa, o gate é no
	// front (SubscriptionGate). NÃO sub-gatear aqui: `purchase`/conta usam isto.
	request.currentCustomer = {
		id: request.currentUser.id,
		name: request.currentUser.name ?? null,
		image: null,
	};
};

/**
 * Resolve the acting customer for billed laser tooling (vetorização, ai_canvas).
 *
 * Entitlement is enforced UPSTREAM: the front `SubscriptionGate` gates page entry
 * (active plan required) and upvox's tool invoke gates usage (free quota / voxxys
 * / upgrade). Here we only resolve the customer identity — the upvox auth id,
 * which equals the legacy `Customers.id` for migrated customers (the migration
 * preserved ids) and works for upvox-native signups too (no legacy-row lookup).
 * The engine uses this id to match the invocation owner and to scope storage.
 */
export const authenticateToolCustomer = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);
	if (reply.sent || !request.currentUser) return;

	request.currentCustomer = {
		id: request.currentUser.id,
		name: request.currentUser.name ?? null,
		image: null,
	};
};

/** @deprecated nome histórico — use `authenticateToolCustomer`. */
export const authenticateVectorizacao = authenticateToolCustomer;

export const authenticateProgress = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);
	if (reply.sent || !request.currentUser) return;

	// Staff passa customerId via query/body — não fixa currentCustomer.
	if (isStaffRole(request.currentRole)) return;

	// Customer: identidade pelo id do upvox (sem lookup legado em `Customers`).
	request.currentCustomer = {
		id: request.currentUser.id,
		name: request.currentUser.name ?? null,
		image: null,
	};
};

export const authenticateCommunity = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);
	if (reply.sent || !request.currentUser) return;

	const user = request.currentUser;
	const grant = (unlimited: boolean) => {
		request.currentCustomer = {
			id: user.id,
			name: user.name ?? null,
			image: null,
		};
		request.isUnlimitedCustomer = unlimited;
	};

	// Staff: acesso irrestrito à comunidade.
	if (isStaffRole(request.currentRole)) {
		grant(false);
		return;
	}

	// Comunidade exige ASSINATURA ATIVA — validada no upvox (fonte de verdade
	// pós-migração; a checagem antiga por `pl_subscription`/classe `comunidade`
	// não vale mais p/ clientes migrados). Conta de teste ilimitada também passa.
	const token = (request.headers.authorization ?? '').replace(
		/^Bearer\s+/i,
		'',
	);
	// Best-effort: só dá pra validar no upvox se o gateway repassar o Bearer. Se
	// conseguimos os entitlements e NÃO há assinatura ativa → barra. Se não
	// conseguimos (token não repassado / upvox indisponível) → libera e confia no
	// SubscriptionGate do front (não barra cliente legítimo).
	const ent = token ? await fetchEntitlements(token) : null;
	if (ent) {
		const status = ent.subscription?.status;
		const allowed =
			ent.is_test_unlimited === true ||
			status === 'active' ||
			status === 'trialing';
		if (!allowed) {
			return reply.status(403).send({
				statusCode: 403,
				error: 'Forbidden',
				message: 'subscription_required',
			});
		}
	}

	grant(ent?.is_test_unlimited === true);
};
