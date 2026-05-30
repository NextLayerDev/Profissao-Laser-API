import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	fetchExternalUser,
	isKnownAppRole,
	isStaffRole,
} from '../lib/external-auth.js';
import { supabase } from '../lib/supabase.js';

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

	if (!request.currentUser) return;

	const user = request.currentUser;

	// Staff (role admin/staff) têm acesso irrestrito.
	if (isStaffRole(request.currentRole)) return;

	const { data: customer, error: customerError } = await supabase
		.from('Customers')
		.select('id, name, isTestUnlimited')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (customerError || !customer) {
		return reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Customer not found',
		});
	}

	request.currentCustomer = {
		id: customer.id,
		name: customer.name,
		image: null,
	};
	request.isUnlimitedCustomer =
		(customer as { isTestUnlimited?: boolean }).isTestUnlimited === true;
};

/**
 * Resolve the acting customer for the laser tooling (vetorização etc.).
 *
 * Entitlement is now enforced UPSTREAM: the front `SubscriptionGate` gates page
 * entry (active plan required) and upvox's tool invoke gates usage (free quota /
 * voxxys / upgrade). So here we only resolve the customer identity (the upvox
 * auth id) for ownership/storage — no Stripe/`pl_class` gating, and no dependency
 * on a legacy `Customers` row (works for upvox-native signups too).
 */
export const authenticateVectorizacao = async (
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

export const authenticateProgress = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);
	if (!request.currentUser) return;

	const user = request.currentUser;

	// Staff (role admin/staff) têm acesso irrestrito (passam customerId via query/body).
	if (isStaffRole(request.currentRole)) return;

	// Customer: set currentCustomer
	const { data: customer, error } = await supabase
		.from('Customers')
		.select('id, name, isTestUnlimited')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (error || !customer) {
		return reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Customer not found',
		});
	}

	request.currentCustomer = {
		id: customer.id,
		name: customer.name,
		image: null,
	};
	request.isUnlimitedCustomer =
		(customer as { isTestUnlimited?: boolean }).isTestUnlimited === true;
};

export const authenticateCommunity = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);

	if (!request.currentUser) return;

	const user = request.currentUser;

	// Staff (role admin/staff) têm acesso irrestrito à comunidade.
	if (isStaffRole(request.currentRole)) return;

	// Fetch customer from pl_customer
	const { data: customer, error: customerError } = await supabase
		.from('Customers')
		.select(`
			id,
			name,
			isTestUnlimited,
			pl_community_profile (
				image
			)
		`)
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (customerError || !customer) {
		return reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Customer not found',
		});
	}

	// Conta de teste ilimitada: libera sem checar assinatura.
	if ((customer as { isTestUnlimited?: boolean }).isTestUnlimited === true) {
		request.currentCustomer = {
			id: customer.id,
			name: customer.name,
			image: null,
		};
		request.isUnlimitedCustomer = true;
		return;
	}

	// Verify active subscription in a class with comunidade: true
	const { data: subscriptions } = await supabase
		.from('pl_subscription')
		.select(`
			status,
			pl_product!inner (
				pl_class_product!inner (
					pl_class!inner (
						comunidade
					)
				)
			)
		`)
		.eq('userId', customer.id)
		.eq('status', 'active');

	const hasCommunityAccess = (subscriptions ?? []).some((subscription) => {
		// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
		const productRaw = (subscription as any).pl_product;
		if (!productRaw) return false;

		// Supabase may return pl_product as object or array depending on FK naming
		// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
		const products: any[] = Array.isArray(productRaw)
			? productRaw
			: [productRaw];

		return products.some((product) => {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
			const classProducts = (product as any).pl_class_product;
			if (!Array.isArray(classProducts)) return false;
			return classProducts.some(
				// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
				(cp: any) => cp.pl_class?.comunidade === true,
			);
		});
	});

	if (!hasCommunityAccess) {
		return reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Community access required',
		});
	}

	const profileList = (
		customer as unknown as {
			pl_community_profile: { image: string | null }[];
		}
	).pl_community_profile;
	const profile = profileList?.[0] ?? null;

	request.currentCustomer = {
		id: customer.id,
		name: customer.name,
		image: profile?.image ?? null,
	};
};
