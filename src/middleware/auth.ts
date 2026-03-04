import type { FastifyReply, FastifyRequest } from 'fastify';
import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';

export const authenticate = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
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
		const {
			data: { user },
			error,
		} = await supabase.auth.getUser(token);

		if (error || !user) {
			throw new Error('User not found');
		}

		request.currentUser = user;
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

export const authenticateCustomer = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);

	if (!request.currentUser) return;

	const user = request.currentUser;

	const { data: customer, error: customerError } = await supabase
		.from('Customers')
		.select('id, name')
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
};

export const authenticateVectorizacao = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);

	if (!request.currentUser) return;

	const user = request.currentUser;

	// Platform users (staff) have unrestricted access
	const { data: platformUser } = await supabase
		.from('Users')
		.select('id')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (platformUser) return;

	const { data: customer, error: customerError } = await supabase
		.from('Customers')
		.select('id, name, email')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (customerError || !customer) {
		return reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Customer not found',
		});
	}

	const customerEmail =
		(customer as unknown as { email: string }).email ?? user.email;

	// Fetch active/trialing Stripe subscriptions for this customer
	const stripeCustomers = await stripe.customers.list({
		email: customerEmail,
		limit: 1,
	});
	let hasVectorizacaoAccess = false;

	if (stripeCustomers.data.length > 0) {
		const stripeCustomerId = stripeCustomers.data[0].id;

		const [activeSubs, trialingSubs] = await Promise.all([
			stripe.subscriptions.list({
				customer: stripeCustomerId,
				status: 'active',
			}),
			stripe.subscriptions.list({
				customer: stripeCustomerId,
				status: 'trialing',
			}),
		]);

		const stripeProductIds = [...activeSubs.data, ...trialingSubs.data]
			.flatMap((sub) =>
				sub.items.data.map((item) => {
					const productRef = item.price?.product;
					return typeof productRef === 'string'
						? productRef
						: ((productRef as { id: string } | null)?.id ?? null);
				}),
			)
			.filter(Boolean) as string[];

		if (stripeProductIds.length > 0) {
			const { data: classData } = await supabase
				.from('pl_product')
				.select(`
					pl_class_product!inner (
						pl_class!inner (
							vetorizacao
						)
					)
				`)
				.in('stripeProductId', stripeProductIds);

			hasVectorizacaoAccess = (classData ?? []).some((product) => {
				// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
				const classProducts = (product as any).pl_class_product;
				if (!Array.isArray(classProducts)) return false;
				// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
				return classProducts.some(
					(cp: any) => cp.pl_class?.vetorizacao === true,
				);
			});
		}
	}

	if (!hasVectorizacaoAccess) {
		return reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Vectorization access required',
		});
	}

	request.currentCustomer = {
		id: customer.id,
		name: customer.name,
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

	// Staff have unrestricted access (pass customerId via query/body)
	const { data: platformUser } = await supabase
		.from('Users')
		.select('id')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (platformUser) return;

	// Customer: set currentCustomer
	const { data: customer, error } = await supabase
		.from('Customers')
		.select('id, name')
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
};

export const authenticateCommunity = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	await authenticate(request, reply);

	if (!request.currentUser) return;

	const user = request.currentUser;

	// Users (staff) have unrestricted community access
	const { data: platformUser } = await supabase
		.from('Users')
		.select('id')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (platformUser) return;

	// Fetch customer from pl_customer
	const { data: customer, error: customerError } = await supabase
		.from('Customers')
		.select(`
			id,
			name,
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
