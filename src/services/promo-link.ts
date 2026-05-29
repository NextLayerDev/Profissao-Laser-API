import { randomBytes } from 'node:crypto';
import { withCapture } from '@/lib/sentry.js';
import { registerExternalCustomer } from '../lib/external-auth.js';
import { stripe } from '../lib/stripe.js';
import { productRepository } from '../repositories/product.js';
import { promoLinkRepository } from '../repositories/promo-link.js';
import type {
	CreatePromoLink,
	RedeemPromoLink,
	UpdatePromoLinkStatus,
} from '../types/promo-link.js';
import { isValidCpf, normalizeDigits } from '../utils/cpf.js';
import { resolveSuccessUrl } from '../utils/success-url.js';

export const promoLinkService = {
	async createLink(data: CreatePromoLink, createdByEmail: string) {
		return withCapture(async () => {
			const product = await productRepository.findById(data.productId);
			if (!product.stripeProductId || !product.stripePriceId) {
				throw new Error('Product is not configured for payments');
			}

			const coupon = await stripe.coupons.create({
				percent_off: data.discountPercent,
				duration: 'repeating',
				duration_in_months: data.durationMonths,
				max_redemptions: data.maxRedemptions,
				applies_to: { products: [product.stripeProductId] },
			});

			const token = randomBytes(32).toString('hex');

			const link = await promoLinkRepository.create({
				token,
				product_id: data.productId,
				discount_percent: data.discountPercent,
				duration_months: data.durationMonths,
				max_redemptions: data.maxRedemptions,
				stripe_coupon_id: coupon.id,
				expires_at: data.expiresAt || null,
				created_by: createdByEmail,
			});

			const baseUrl =
				process.env.PAYMENT_LINK_BASE_URL ||
				process.env.SUCCESS_URL?.replace('/checkout/success', '') ||
				'http://localhost:3000';
			const url = `${baseUrl}/promo-link/${token}`;

			return {
				id: link.id,
				token: link.token,
				url,
				productName: product.name,
				discountPercent: link.discount_percent,
				durationMonths: link.duration_months,
				maxRedemptions: link.max_redemptions,
				status: link.status,
				expiresAt: link.expires_at,
				createdAt: link.created_at,
			};
		});
	},

	async getLinkInfo(token: string) {
		return withCapture(async () => {
			const link = await promoLinkRepository.findByToken(token);
			if (!link) throw new Error('Promo link not found');

			if (link.expires_at && new Date(link.expires_at) < new Date()) {
				throw new Error('Promo link has expired');
			}

			if (link.status !== 'active') {
				throw new Error(
					link.status === 'exhausted'
						? 'Promo link has been exhausted'
						: 'Promo link is not active',
				);
			}

			const product = await productRepository.findById(link.product_id);

			const originalPrice = product.price;
			const discountedPrice = +(
				originalPrice *
				(1 - link.discount_percent / 100)
			).toFixed(2);

			return {
				token: link.token,
				productName: product.name,
				productDescription: product.description ?? null,
				originalPrice,
				discountedPrice,
				discountPercent: link.discount_percent,
				durationMonths: link.duration_months,
				maxRedemptions: link.max_redemptions,
				currentRedemptions: link.current_redemptions,
				remainingRedemptions: link.max_redemptions - link.current_redemptions,
				status: link.status,
				expiresAt: link.expires_at,
			};
		});
	},

	async redeemLink(token: string, data: RedeemPromoLink) {
		return withCapture(async () => {
			const link = await promoLinkRepository.findByToken(token);
			if (!link) throw new Error('Promo link not found');

			if (link.status !== 'active') {
				throw new Error(
					link.status === 'exhausted'
						? 'Promo link has been exhausted'
						: 'Promo link is not active',
				);
			}

			if (link.expires_at && new Date(link.expires_at) < new Date()) {
				throw new Error('Promo link has expired');
			}

			if (link.current_redemptions >= link.max_redemptions) {
				throw new Error('Promo link has been exhausted');
			}

			if (!isValidCpf(data.customerCpf)) {
				throw new Error('Invalid CPF');
			}

			const normalizedCpf = normalizeDigits(data.customerCpf);
			const normalizedPhone = normalizeDigits(data.customerPhone);

			// Check if this CPF+phone already redeemed this promo link
			const existingRedemption =
				await promoLinkRepository.findRedemptionByCpfAndPhone(
					link.id,
					normalizedCpf,
					normalizedPhone,
				);

			if (existingRedemption) {
				throw new Error(
					'This CPF and phone have already redeemed this promo link',
				);
			}

			const product = await productRepository.findById(link.product_id);
			if (!product.stripePriceId) {
				throw new Error('Product is not configured for payments');
			}

			// Register customer account via upvox-api
			await registerExternalCustomer({
				email: data.email,
				name: data.customerName.trim(),
				password: data.password,
				phone: normalizedPhone,
			});

			// Get or create Stripe customer
			const existing = await stripe.customers.list({
				email: data.email,
				limit: 1,
			});
			const stripeCustomer =
				existing.data.length > 0
					? existing.data[0]
					: await stripe.customers.create({
							email: data.email,
							name: data.customerName.trim(),
							phone: normalizedPhone,
						});

			const stripePrice = await stripe.prices.retrieve(product.stripePriceId);
			const mode = stripePrice.recurring ? 'subscription' : 'payment';

			const companyName = data.companyName.trim();

			const successUrl = await resolveSuccessUrl(link.product_id);

			const session = await stripe.checkout.sessions.create({
				customer: stripeCustomer.id,
				line_items: [{ price: product.stripePriceId, quantity: 1 }],
				mode,
				discounts: [{ coupon: link.stripe_coupon_id }],
				success_url: successUrl,
				cancel_url: process.env.CANCEL_URL ?? 'http://localhost:3000/cancelado',
				metadata: {
					company_name: companyName,
					promo_link_token: token,
				},
			});

			// Record redemption
			await promoLinkRepository.createRedemption({
				promo_link_id: link.id,
				customer_name: data.customerName.trim(),
				customer_phone: normalizedPhone,
				customer_cpf: normalizedCpf,
				customer_email: data.email,
				company_name: companyName,
				stripe_session_id: session.id,
			});

			// Increment redemption count (optimistic concurrency)
			const updated = await promoLinkRepository.incrementRedemptions(
				link.id,
				link.current_redemptions,
			);

			if (!updated) {
				// Concurrency conflict — refetch and retry once
				const refreshed = await promoLinkRepository.findByToken(token);
				if (refreshed) {
					await promoLinkRepository.incrementRedemptions(
						refreshed.id,
						refreshed.current_redemptions,
					);
				}
			}

			// Check if max redemptions reached → auto-exhaust
			const currentLink = await promoLinkRepository.findByToken(token);
			if (
				currentLink &&
				currentLink.current_redemptions >= currentLink.max_redemptions
			) {
				await promoLinkRepository.updateStatus(currentLink.id, 'exhausted');
			}

			return {
				checkoutUrl: session.url ?? '',
				sessionId: session.id,
			};
		});
	},

	async updateStatus(id: string, data: UpdatePromoLinkStatus) {
		return withCapture(async () => {
			const link = await promoLinkRepository.findById(id);
			if (!link) throw new Error('Promo link not found');

			const updated = await promoLinkRepository.updateStatus(id, data.status);
			if (!updated) throw new Error('Failed to update promo link status');

			return {
				id: updated.id,
				status: updated.status,
				updatedAt: updated.updated_at,
			};
		});
	},

	async listLinks() {
		return withCapture(async () => {
			const rows = await promoLinkRepository.findAll();

			const allRedemptions = await promoLinkRepository.findRedemptionsByLinkIds(
				rows.map((r) => r.id),
			);

			const redemptionsByLink = new Map<string, typeof allRedemptions>();
			for (const r of allRedemptions) {
				const list = redemptionsByLink.get(r.promo_link_id) ?? [];
				list.push(r);
				redemptionsByLink.set(r.promo_link_id, list);
			}

			return rows.map((row) => ({
				id: row.id,
				token: row.token,
				productName:
					(row.pl_product as unknown as { name: string })?.name ?? '',
				discountPercent: row.discount_percent,
				durationMonths: row.duration_months,
				maxRedemptions: row.max_redemptions,
				currentRedemptions: row.current_redemptions,
				status: row.status,
				expiresAt: row.expires_at,
				createdBy: row.created_by,
				createdAt: row.created_at,
				redemptions: (redemptionsByLink.get(row.id) ?? []).map((r) => ({
					customerName: r.customer_name,
					customerPhone: r.customer_phone,
					customerEmail: r.customer_email,
					customerCpf: r.customer_cpf,
					companyName: r.company_name,
					redeemedAt: r.redeemed_at,
					stripeSessionId: r.stripe_session_id,
				})),
			}));
		});
	},
};
