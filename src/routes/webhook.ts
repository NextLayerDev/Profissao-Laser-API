import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { supabase } from '@/lib/supabase.js';
import { decrypt } from '../lib/crypto.js';
import { runSqlOnTenant } from '../lib/postgres-runner.js';
import { stripe } from '../lib/stripe.js';
import * as vercelApi from '../lib/vercel.js';
import { customerRepository } from '../repositories/customer.js';
import { productRepository } from '../repositories/product.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import { subscriptionRepository } from '../repositories/subscription.js';
import { creditService } from '../services/credit.js';
import type { ProvisioningPlan, Tenant } from '../types/provisioning.js';
import { normalizeCompanySlug } from '../utils/normalize.js';
import { PLAN_ORDER, resolvePlanFromProduct } from '../utils/plan.js';
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

		switch (event.type) {
			case 'checkout.session.completed':
				await handleCheckoutCompleted(
					event.data.object as Stripe.Checkout.Session,
					server,
				);
				break;

			case 'customer.subscription.updated':
				await handleSubscriptionUpdated(
					event.data.object as Stripe.Subscription,
					server,
				);
				break;

			case 'customer.subscription.deleted':
				await handleSubscriptionDeleted(
					event.data.object as Stripe.Subscription,
					server,
				);
				break;

			case 'invoice.payment_failed':
				await handlePaymentFailed(event.data.object as Stripe.Invoice, server);
				break;

			case 'invoice.payment_succeeded':
				await handlePaymentSucceeded(
					event.data.object as Stripe.Invoice,
					server,
				);
				break;
		}

		return reply.status(200).send({ received: true });
	});
}

// ========== HELPERS ==========

async function resolveCustomerEmailFromStripeCustomer(
	stripeCustomerId: string,
): Promise<string | null> {
	const customer = await stripe.customers.retrieve(stripeCustomerId);
	if (customer.deleted || !('email' in customer)) return null;
	return customer.email ?? null;
}

async function resolveUniqueSlug(
	baseName: string,
	buyerEmail: string,
): Promise<string> {
	const baseSlug = normalizeCompanySlug(baseName);

	// Check if a tenant already exists with this slug
	const existingTenant =
		await provisioningRepository.findTenantBySlug(baseSlug);

	if (!existingTenant) {
		// Also check for in-progress jobs with this slug
		const existingJob = await provisioningRepository.findJobBySlug(baseSlug);
		if (!existingJob) return baseSlug;

		// Job exists but no tenant — check if it belongs to the same customer
		const order = await provisioningRepository.findOrderWithCustomer(
			existingJob.order_id,
		);
		const ownerEmail = (
			order?.pl_provisioning_customer as unknown as { email: string }
		)?.email;
		if (ownerEmail === buyerEmail) return baseSlug;
	} else {
		// Tenant exists — check if it belongs to the same customer
		const ownerCustomer = await provisioningRepository.findCustomerById(
			existingTenant.customer_id,
		);
		if (ownerCustomer?.email === buyerEmail) return baseSlug;
	}

	// Different customer with same company name — generate unique slug
	let suffix = 2;
	let candidate = `${baseSlug}${suffix}`;
	while (
		(await provisioningRepository.findTenantBySlug(candidate)) ||
		(await provisioningRepository.findJobBySlug(candidate))
	) {
		suffix++;
		candidate = `${baseSlug}${suffix}`;
	}

	return candidate;
}

// ========== CHECKOUT COMPLETED ==========

async function handleCheckoutCompleted(
	session: Stripe.Checkout.Session,
	server: FastifyInstance,
) {
	if (session.metadata?.type === 'credit_purchase') {
		try {
			await creditService.fulfillPurchase({
				id: session.id,
				metadata: session.metadata as Record<string, string>,
			});
			server.log.info(
				{ sessionId: session.id, customerId: session.metadata.customer_id },
				'Credit purchase fulfilled',
			);
		} catch (err) {
			server.log.error(
				{ err, sessionId: session.id },
				'Failed to fulfill credit purchase',
			);
		}
		return;
	}

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

	server.log.info(
		{ sessionId: session.id, productId: product.id },
		'Starting system provisioning',
	);
	await handleSystemProvisioning(session, product, server);
}

// ========== SYSTEM PROVISIONING (with upgrade/downgrade detection) ==========

async function handleSystemProvisioning(
	session: Stripe.Checkout.Session,
	product: { id: string },
	server: FastifyInstance,
) {
	try {
		// Determine plan tier (for billing/env-var decisions) and company plan (for tenant Company table)
		let plan: 'prata' | 'ouro' | 'platina' = 'prata';
		let systemClassName: string | null = null;
		let onlyProfissao = true;
		let gerenciamentoSistema = false;

		const { data: scLinks } = await supabase
			.from('pl_system_class_product')
			.select('systemClassId, pl_system_class(name, gerenciamentoSistema)')
			.eq('productId', product.id)
			.limit(1);

		if (scLinks && scLinks.length > 0) {
			const sc = scLinks[0].pl_system_class as unknown as {
				name: string;
				gerenciamentoSistema: boolean;
			} | null;
			const scName = sc?.name;
			gerenciamentoSistema = sc?.gerenciamentoSistema ?? false;
			if (scName) {
				systemClassName = scName;
				onlyProfissao = false;
				const lower = scName.toLowerCase();
				if (lower === 'platina') plan = 'platina';
				else if (lower === 'ouro') plan = 'ouro';
			}
		}

		// Produto sem class-system OU class-system com gerenciamentoSistema:false
		// → não cria tenant; o upsert de pl_subscription (em handleCheckoutCompleted)
		// já garante o acesso para subscription, e o frontend redireciona para /course.
		if (!gerenciamentoSistema) {
			server.log.info(
				{
					sessionId: session.id,
					productId: product.id,
					systemClassName,
					mode: session.mode,
				},
				'Skipping tenant provisioning — product is not sistema-gerenciado',
			);
			return;
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

		// Check if this CUSTOMER already has an active tenant (upgrade/downgrade)
		const existingTenant =
			await provisioningRepository.findActiveTenantByCustomerEmail(buyerEmail);

		if (existingTenant) {
			server.log.info(
				{
					slug: existingTenant.slug,
					currentPlan: existingTenant.current_plan,
					newPlan: plan,
					email: buyerEmail,
				},
				'Customer already has active tenant — handling plan change',
			);
			await handlePlanChange(existingTenant, plan, session, server);
			return;
		}

		// New tenant — generate unique slug (handles collision with different customers)
		const slug = await resolveUniqueSlug(companyName, buyerEmail);

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
			metadata: {
				...((session.metadata as Record<string, unknown> | null) ?? {}),
				system_class_name: systemClassName,
				only_profissao: onlyProfissao,
			},
		});

		// Clean up non-completed jobs with the same slug (failed/in-progress retries)
		await provisioningRepository.deleteAllNonCompletedJobsBySlug(slug);

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

// ========== PLAN CHANGE (upgrade/downgrade/renewal) ==========

async function handlePlanChange(
	tenant: Tenant,
	newPlan: ProvisioningPlan,
	session: Stripe.Checkout.Session,
	server: FastifyInstance,
) {
	const oldPlan = tenant.current_plan as ProvisioningPlan;

	// Determine change type
	let changeType: 'upgrade' | 'downgrade' | 'renewal';
	if (PLAN_ORDER[newPlan] > PLAN_ORDER[oldPlan]) changeType = 'upgrade';
	else if (PLAN_ORDER[newPlan] < PLAN_ORDER[oldPlan]) changeType = 'downgrade';
	else changeType = 'renewal';

	server.log.info(
		{ slug: tenant.slug, changeType, from: oldPlan, to: newPlan },
		'Processing plan change',
	);

	// Update Company table in tenant database
	const dbPass = decrypt(tenant.supabase_db_pass_encrypted);
	const ref = tenant.supabase_project_ref;

	const updateSql = `
		UPDATE "Company"
		SET "plan" = '${newPlan.toUpperCase()}'::"PlanType",
			"payment_status" = 'paid',
			"start_plan" = NOW(),
			"updatedAt" = NOW()
		WHERE "profissao_laser" = true;
	`;

	await runSqlOnTenant({ ref, dbPass, sql: updateSql });
	server.log.info(
		{ slug: tenant.slug, newPlan },
		'Company plan updated on tenant DB',
	);

	// Update Vercel env vars if plan change involves platina
	const needsRedeploy = await handlePlatinaEnvVars(
		tenant,
		oldPlan,
		newPlan,
		server,
	);

	if (needsRedeploy) {
		const deployment = await vercelApi.triggerDeployment(
			tenant.vercel_project_id,
		);
		await vercelApi.waitDeploymentReady(deployment.id);
		server.log.info(
			{ slug: tenant.slug },
			'Vercel redeployed after env var changes',
		);
	}

	// Update pl_tenant
	await provisioningRepository.updateTenantPlan(tenant.id, newPlan);

	// Record plan history
	await provisioningRepository.createPlanHistory({
		tenant_id: tenant.id,
		from_plan: oldPlan,
		to_plan: newPlan,
		change_type: changeType,
		stripe_session_id: session.id,
		stripe_subscription_id: (session.subscription as string) || null,
	});

	// Record order for tracking
	const provCustomer = await provisioningRepository.findCustomerByEmail(
		session.customer_details?.email || '',
	);
	if (provCustomer) {
		await provisioningRepository.createOrder({
			customer_id: provCustomer.id,
			stripe_session_id: session.id,
			stripe_subscription_id: (session.subscription as string) || null,
			status: 'completed',
			plan: newPlan,
			metadata: {
				...(session.metadata as Record<string, unknown>),
				change_type: changeType,
				previous_plan: oldPlan,
			},
		});
	}

	server.log.info(
		{ slug: tenant.slug, changeType, from: oldPlan, to: newPlan },
		'Plan change completed successfully',
	);
}

async function handlePlatinaEnvVars(
	tenant: Tenant,
	oldPlan: ProvisioningPlan,
	newPlan: ProvisioningPlan,
	server: FastifyInstance,
): Promise<boolean> {
	if (newPlan === 'platina' && oldPlan !== 'platina') {
		// Upgrade TO platina — add N8N env vars
		await vercelApi.setEnvVars(tenant.vercel_project_id, {
			N8N_API_KEY: process.env.TENANT_N8N_API_KEY ?? '',
			N8N_BASE_URL: process.env.TENANT_N8N_BASE_URL ?? '',
		});
		server.log.info(
			{ slug: tenant.slug },
			'Added N8N env vars (upgrade to platina)',
		);
		return true;
	}

	if (newPlan !== 'platina' && oldPlan === 'platina') {
		// Downgrade FROM platina — remove N8N env vars
		await vercelApi.removeEnvVars(tenant.vercel_project_id, [
			'N8N_API_KEY',
			'N8N_BASE_URL',
		]);
		server.log.info(
			{ slug: tenant.slug },
			'Removed N8N env vars (downgrade from platina)',
		);
		return true;
	}

	return false;
}

// ========== SUBSCRIPTION UPDATED ==========

async function handleSubscriptionUpdated(
	subscription: Stripe.Subscription,
	server: FastifyInstance,
) {
	try {
		const item = subscription.items.data[0];
		const priceId = item?.price.id;
		if (!priceId) return;

		const product = await productRepository.findByStripePriceId(priceId);
		const newPlan = await resolvePlanFromProduct(product.id);

		// Resolve customer email from Stripe customer ID
		const email = await resolveCustomerEmailFromStripeCustomer(
			subscription.customer as string,
		);
		if (!email) return;

		const tenant =
			await provisioningRepository.findActiveTenantByCustomerEmail(email);
		if (!tenant) {
			server.log.info(
				{ email },
				'Subscription updated but no active tenant found — skipping',
			);
			return;
		}

		if (tenant.current_plan === newPlan) {
			server.log.info(
				{ slug: tenant.slug, plan: newPlan },
				'Subscription updated but plan unchanged — skipping',
			);
			return;
		}

		server.log.info(
			{
				slug: tenant.slug,
				currentPlan: tenant.current_plan,
				newPlan,
			},
			'Subscription updated — processing plan change',
		);

		// Build a minimal session-like object for handlePlanChange
		const oldPlan = tenant.current_plan as ProvisioningPlan;
		let changeType: 'upgrade' | 'downgrade' | 'renewal';
		if (PLAN_ORDER[newPlan] > PLAN_ORDER[oldPlan]) changeType = 'upgrade';
		else if (PLAN_ORDER[newPlan] < PLAN_ORDER[oldPlan])
			changeType = 'downgrade';
		else changeType = 'renewal';

		// Update Company in tenant DB
		const dbPass = decrypt(tenant.supabase_db_pass_encrypted);
		const updateSql = `
			UPDATE "Company"
			SET "plan" = '${newPlan.toUpperCase()}'::"PlanType",
				"payment_status" = 'paid',
				"start_plan" = NOW(),
				"updatedAt" = NOW()
			WHERE "profissao_laser" = true;
		`;
		await runSqlOnTenant({
			ref: tenant.supabase_project_ref,
			dbPass,
			sql: updateSql,
		});

		// Handle platina env vars
		const needsRedeploy = await handlePlatinaEnvVars(
			tenant,
			oldPlan,
			newPlan,
			server,
		);
		if (needsRedeploy) {
			const deployment = await vercelApi.triggerDeployment(
				tenant.vercel_project_id,
			);
			await vercelApi.waitDeploymentReady(deployment.id);
		}

		// Update tenant record
		await provisioningRepository.updateTenantPlan(tenant.id, newPlan);

		// Record history
		await provisioningRepository.createPlanHistory({
			tenant_id: tenant.id,
			from_plan: oldPlan,
			to_plan: newPlan,
			change_type: changeType,
			stripe_subscription_id: subscription.id,
		});

		server.log.info(
			{ slug: tenant.slug, changeType, from: oldPlan, to: newPlan },
			'Subscription plan change completed',
		);
	} catch (err) {
		server.log.error(
			{ err, subscriptionId: subscription.id },
			'Failed to handle subscription update',
		);
	}
}

// ========== SUBSCRIPTION DELETED ==========

async function handleSubscriptionDeleted(
	subscription: Stripe.Subscription,
	server: FastifyInstance,
) {
	try {
		const email = await resolveCustomerEmailFromStripeCustomer(
			subscription.customer as string,
		);
		if (!email) return;

		const tenant =
			await provisioningRepository.findActiveTenantByCustomerEmail(email);
		if (!tenant) {
			server.log.info(
				{ email },
				'Subscription deleted but no active tenant found — skipping',
			);
			return;
		}

		server.log.info(
			{ slug: tenant.slug, email },
			'Subscription deleted — marking tenant as cancelled',
		);

		// Update Company in tenant DB
		const dbPass = decrypt(tenant.supabase_db_pass_encrypted);
		const updateSql = `
			UPDATE "Company"
			SET "status" = 'inactive',
				"payment_status" = 'cancelled',
				"updatedAt" = NOW()
			WHERE "profissao_laser" = true;
		`;
		await runSqlOnTenant({
			ref: tenant.supabase_project_ref,
			dbPass,
			sql: updateSql,
		});

		// Update tenant status
		await provisioningRepository.updateTenantStatus(tenant.id, 'cancelled');

		// Record history
		await provisioningRepository.createPlanHistory({
			tenant_id: tenant.id,
			from_plan: tenant.current_plan,
			to_plan: tenant.current_plan,
			change_type: 'renewal',
			stripe_subscription_id: subscription.id,
			metadata: { reason: 'subscription_deleted' },
		});

		server.log.info(
			{ slug: tenant.slug },
			'Tenant marked as cancelled after subscription deletion',
		);
	} catch (err) {
		server.log.error(
			{ err, subscriptionId: subscription.id },
			'Failed to handle subscription deletion',
		);
	}
}

// ========== PAYMENT FAILED ==========

async function handlePaymentFailed(
	invoice: Stripe.Invoice,
	server: FastifyInstance,
) {
	try {
		const stripeCustomerId = invoice.customer as string;
		if (!stripeCustomerId) return;

		const email =
			await resolveCustomerEmailFromStripeCustomer(stripeCustomerId);
		if (!email) return;

		const tenant =
			await provisioningRepository.findActiveTenantByCustomerEmail(email);
		if (!tenant) {
			server.log.info(
				{ email },
				'Payment failed but no active tenant found — skipping',
			);
			return;
		}

		server.log.info(
			{ slug: tenant.slug, email, invoiceId: invoice.id },
			'Payment failed — updating tenant payment status',
		);

		// Update Company in tenant DB
		const dbPass = decrypt(tenant.supabase_db_pass_encrypted);
		const updateSql = `
			UPDATE "Company"
			SET "payment_status" = 'failed',
				"updatedAt" = NOW()
			WHERE "profissao_laser" = true;
		`;
		await runSqlOnTenant({
			ref: tenant.supabase_project_ref,
			dbPass,
			sql: updateSql,
		});

		server.log.info(
			{ slug: tenant.slug },
			'Tenant payment status updated to failed',
		);
	} catch (err) {
		server.log.error(
			{ err, invoiceId: invoice.id },
			'Failed to handle payment failure',
		);
	}
}

// ========== PAYMENT SUCCEEDED ==========

async function handlePaymentSucceeded(
	invoice: Stripe.Invoice,
	server: FastifyInstance,
) {
	try {
		const stripeCustomerId = invoice.customer as string;
		if (!stripeCustomerId) return;

		const email =
			await resolveCustomerEmailFromStripeCustomer(stripeCustomerId);
		if (!email) return;

		const tenant =
			await provisioningRepository.findActiveTenantByCustomerEmail(email);
		if (!tenant) {
			server.log.info(
				{ email },
				'Payment succeeded but no active tenant found — skipping',
			);
			return;
		}

		server.log.info(
			{ slug: tenant.slug, email, invoiceId: invoice.id },
			'Payment succeeded — updating tenant payment status',
		);

		// Extract billing period from invoice line item
		const lineItem = invoice.lines?.data[0];
		const periodStart = lineItem?.period?.start;
		const periodEnd = lineItem?.period?.end;

		// Extract payment method type (card, boleto, pix, etc.)
		let methodPayment: string | null = null;
		if (invoice.payment_intent) {
			const pi = await stripe.paymentIntents.retrieve(
				invoice.payment_intent as string,
			);
			if (pi.payment_method) {
				const pm = await stripe.paymentMethods.retrieve(
					pi.payment_method as string,
				);
				methodPayment = pm.type;
			}
		}

		// Build dynamic SQL to update only available fields
		const setClauses = ['"payment_status" = \'paid\''];

		if (periodStart) {
			setClauses.push(`"start_plan" = to_timestamp(${periodStart})`);
		}
		if (periodEnd) {
			setClauses.push(`"end_plan" = to_timestamp(${periodEnd})`);
		}
		if (methodPayment) {
			setClauses.push(`"method_payment" = '${methodPayment}'`);
		}

		setClauses.push('"updatedAt" = NOW()');

		const updateSql = `
			UPDATE "Company"
			SET ${setClauses.join(', ')}
			WHERE "profissao_laser" = true;
		`;

		const dbPass = decrypt(tenant.supabase_db_pass_encrypted);
		await runSqlOnTenant({
			ref: tenant.supabase_project_ref,
			dbPass,
			sql: updateSql,
		});

		server.log.info(
			{ slug: tenant.slug, invoiceId: invoice.id, methodPayment },
			'Tenant payment status updated to paid',
		);
	} catch (err) {
		server.log.error(
			{ err, invoiceId: invoice.id },
			'Failed to handle payment success',
		);
	}
}
