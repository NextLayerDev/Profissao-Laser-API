import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { normalizeCompanySlug } from '../lib/normalize.js';
import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { customerRepository } from '../repositories/customer.js';
import { productRepository } from '../repositories/product.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import { subscriptionRepository } from '../repositories/subscription.js';
import { runProvisionTenant } from '../workers/provision-tenant.js';

export async function webhookRoute(server: FastifyInstance) {
	server.addContentTypeParser(
		'application/json',
		{ parseAs: 'buffer' },
		(_req, body, done) => {
			done(null, body);
		},
	);

	server.post('/webhook/stripe', async (request, reply) => {
		const sig = request.headers['stripe-signature'] as string;
		const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

		let event: Stripe.Event;
		try {
			event = stripe.webhooks.constructEvent(
				request.body as Buffer,
				sig,
				secret,
			);
		} catch {
			return reply.status(400).send({ message: 'Invalid webhook signature' });
		}

		if (event.type === 'checkout.session.completed') {
			await handleCheckoutCompleted(
				event.data.object as Stripe.Checkout.Session,
				server,
			);
		}

		return reply.status(200).send({ received: true });
	});
}

async function handleCheckoutCompleted(
	session: Stripe.Checkout.Session,
	server: FastifyInstance,
) {
	const email = session.customer_details?.email;
	if (!email) return;

	server.log.info(
		{ sessionId: session.id, email, mode: session.mode },
		'Processing checkout.session.completed',
	);

	let priceId: string | undefined;
	let product: { id: string };

	if (session.mode === 'subscription') {
		const subscription = await stripe.subscriptions.retrieve(
			session.subscription as string,
		);
		const item = subscription.items.data[0];
		priceId = item?.price.id;
		if (!priceId) return;

		product = await productRepository.findByStripePriceId(priceId);

		// Subscription upsert — OPTIONAL, only if customer exists in LMS
		try {
			const { data: customer } =
				await customerRepository.getCustomerPlan(email);
			if (customer) {
				await subscriptionRepository.upsertByStripeSubscriptionId({
					userId: customer.id,
					productId: product.id,
					status: 'active',
					stripeSubscriptionId: subscription.id,
					stripeCustomerId: session.customer as string,
					stripePriceId: priceId,
					currentPeriodEnd: new Date(
						item.current_period_end * 1000,
					).toISOString(),
					cancelAtPeriodEnd: subscription.cancel_at_period_end,
				});
			}
		} catch (err) {
			server.log.warn(
				{ err, email },
				'Subscription upsert skipped — customer not found in LMS',
			);
		}
	} else {
		// One-time payment flow — resolve product from line items
		const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
			expand: ['line_items.data.price'],
		});
		const lineItem = fullSession.line_items?.data[0];
		priceId = lineItem?.price?.id;
		if (!priceId) return;

		product = await productRepository.findByStripePriceId(priceId);
	}

	// ALWAYS provision — never skip this
	server.log.info(
		{ sessionId: session.id, productId: product.id },
		'Starting system provisioning',
	);
	await handleSystemProvisioning(session, product, server);
}

async function handleSystemProvisioning(
	session: Stripe.Checkout.Session,
	product: { id: string },
	server: FastifyInstance,
) {
	try {
		// Determine plan from the product's class tier
		let plan: 'prata' | 'ouro' | 'platina' = 'prata';

		const { data: classLinks } = await supabase
			.from('pl_class_product')
			.select('classId, pl_class(tier)')
			.eq('productId', product.id)
			.limit(1);

		if (classLinks && classLinks.length > 0) {
			const tier = (classLinks[0].pl_class as unknown as { tier: string })
				?.tier;
			if (tier === 'platina') plan = 'platina';
			else if (tier === 'ouro') plan = 'ouro';
			else plan = 'prata';
		}

		// Get company_name from checkout metadata
		const companyName =
			session.metadata?.company_name ||
			session.customer_details?.name ||
			'Empresa';

		const buyerEmail = session.customer_details?.email || '';
		const buyerPhone = session.customer_details?.phone || '';
		const buyerName = session.customer_details?.name || companyName;

		// Check idempotency — don't create duplicate jobs
		const existingJob = await provisioningRepository.findJobByIdempotencyKey(
			session.id,
		);
		if (existingJob) {
			server.log.info(
				{ jobId: existingJob.id, status: existingJob.status },
				'Job already exists for this session — skipping',
			);
			return;
		}

		// Create provisioning customer
		const provCustomer = await provisioningRepository.createCustomer({
			email: buyerEmail,
			name: buyerName,
			company_name: companyName,
			phone: buyerPhone || null,
			stripe_customer_id: (session.customer as string) || null,
		});

		// Create provisioning order
		const provOrder = await provisioningRepository.createOrder({
			customer_id: provCustomer.id,
			stripe_session_id: session.id,
			stripe_subscription_id: (session.subscription as string) || null,
			status: 'paid',
			plan,
			metadata: session.metadata as Record<string, unknown> | null,
		});

		// Generate slug — handle conflicts with previous jobs
		const slug = normalizeCompanySlug(companyName);

		// If a previous job with the same slug exists, clean up so we can re-provision
		const existingSlugJobs =
			await provisioningRepository.findAllJobsBySlug(slug);

		if (existingSlugJobs.length > 0) {
			server.log.info(
				{
					slug,
					count: existingSlugJobs.length,
					statuses: existingSlugJobs.map((j) => j.status),
				},
				'Found previous jobs with same slug — cleaning up for re-provision',
			);
			// Delete ALL old jobs (including completed) to allow fresh provisioning
			// Must use repository method to delete audit_logs first (FK constraint)
			for (const oldJob of existingSlugJobs) {
				await provisioningRepository.deleteJob(oldJob.id);
			}
			server.log.info({ slug }, 'Deleted old jobs');
		}

		// Create provisioning job
		const job = await provisioningRepository.createJob({
			order_id: provOrder.id,
			idempotency_key: session.id,
			slug,
		});

		server.log.info(
			{ jobId: job.id, slug, plan },
			'Provisioning job created — starting worker',
		);

		// Fire and forget — respond 200 to Stripe immediately
		setImmediate(() => {
			runProvisionTenant(job.id).catch((err) => {
				server.log.error({ err, jobId: job.id }, 'Provisioning worker failed');
			});
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		const errStack = err instanceof Error ? err.stack : undefined;
		server.log.error(
			{ err: errMsg, stack: errStack, sessionId: session.id },
			'Failed to initiate system provisioning',
		);
	}
}
