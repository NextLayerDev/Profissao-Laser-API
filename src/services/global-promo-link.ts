import { randomBytes } from 'node:crypto';
import { isValidCpf, normalizeDigits } from '../lib/cpf.js';
import { stripe } from '../lib/stripe.js';
import { globalPromoLinkRepository } from '../repositories/global-promo-link.js';
import { productRepository } from '../repositories/product.js';
import type {
	CreateGlobalPromoLink,
	RedeemGlobalPromoLink,
	UpdateGlobalPromoLinkStatus,
} from '../types/global-promo-link.js';
import { authService } from './auth.js';

class GlobalPromoLinkService {
	async createLink(data: CreateGlobalPromoLink, createdByEmail: string) {
		const coupon = await stripe.coupons.create({
			percent_off: data.discountPercent,
			duration: 'repeating',
			duration_in_months: data.durationMonths,
			max_redemptions: data.maxRedemptions,
		});

		const token = randomBytes(32).toString('hex');

		const link = await globalPromoLinkRepository.create({
			token,
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
		const url = `${baseUrl}/global-promo-link/${token}`;

		return {
			id: link.id,
			token: link.token,
			url,
			discountPercent: link.discount_percent,
			durationMonths: link.duration_months,
			maxRedemptions: link.max_redemptions,
			status: link.status,
			expiresAt: link.expires_at,
			createdAt: link.created_at,
		};
	}

	async getLinkInfo(token: string) {
		const link = await globalPromoLinkRepository.findByToken(token);
		if (!link) throw new Error('Global promo link not found');

		if (link.expires_at && new Date(link.expires_at) < new Date()) {
			throw new Error('Global promo link has expired');
		}

		if (link.status !== 'active') {
			throw new Error(
				link.status === 'exhausted'
					? 'Global promo link has been exhausted'
					: 'Global promo link is not active',
			);
		}

		const allProducts = await productRepository.listAllProducts();

		const products = allProducts
			.filter(
				(p: { status: string; stripePriceId: string | null }) =>
					p.status === 'ativo' && p.stripePriceId,
			)
			.map(
				(p: {
					id: string;
					name: string;
					description: string | null;
					image: string | null;
					price: number;
				}) => ({
					id: p.id,
					name: p.name,
					description: p.description ?? null,
					image: p.image ?? null,
					originalPrice: p.price,
					discountedPrice: +(
						p.price *
						(1 - link.discount_percent / 100)
					).toFixed(2),
				}),
			);

		return {
			token: link.token,
			discountPercent: link.discount_percent,
			durationMonths: link.duration_months,
			maxRedemptions: link.max_redemptions,
			currentRedemptions: link.current_redemptions,
			remainingRedemptions: link.max_redemptions - link.current_redemptions,
			status: link.status,
			expiresAt: link.expires_at,
			products,
		};
	}

	async redeemLink(token: string, data: RedeemGlobalPromoLink) {
		const link = await globalPromoLinkRepository.findByToken(token);
		if (!link) throw new Error('Global promo link not found');

		if (link.status !== 'active') {
			throw new Error(
				link.status === 'exhausted'
					? 'Global promo link has been exhausted'
					: 'Global promo link is not active',
			);
		}

		if (link.expires_at && new Date(link.expires_at) < new Date()) {
			throw new Error('Global promo link has expired');
		}

		if (link.current_redemptions >= link.max_redemptions) {
			throw new Error('Global promo link has been exhausted');
		}

		if (!isValidCpf(data.customerCpf)) {
			throw new Error('Invalid CPF');
		}

		const normalizedCpf = normalizeDigits(data.customerCpf);
		const normalizedPhone = normalizeDigits(data.customerPhone);

		// Check if this CPF+phone already redeemed this global promo link
		const existingRedemption =
			await globalPromoLinkRepository.findRedemptionByCpfAndPhone(
				link.id,
				normalizedCpf,
				normalizedPhone,
			);

		if (existingRedemption) {
			throw new Error(
				'This CPF and phone have already redeemed this promo link',
			);
		}

		const product = await productRepository.findById(data.productId);
		if (!product.stripePriceId) {
			throw new Error('Product is not configured for payments');
		}

		// Register customer account (Supabase Auth + Customers table)
		try {
			await authService.registerCustomer({
				email: data.email,
				name: data.customerName.trim(),
				password: data.password,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : '';
			if (
				!msg.includes('already been registered') &&
				!msg.includes('already exists')
			) {
				throw new Error(`Account creation failed: ${msg}`);
			}
		}

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

		const session = await stripe.checkout.sessions.create({
			customer: stripeCustomer.id,
			line_items: [{ price: product.stripePriceId, quantity: 1 }],
			mode,
			discounts: [{ coupon: link.stripe_coupon_id }],
			success_url: `${process.env.SUCCESS_URL ?? 'http://localhost:3000/checkout/success'}?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: process.env.CANCEL_URL ?? 'http://localhost:3000/cancelado',
			metadata: {
				company_name: companyName,
				global_promo_link_token: token,
			},
		});

		// Record redemption
		await globalPromoLinkRepository.createRedemption({
			global_promo_link_id: link.id,
			product_id: data.productId,
			customer_name: data.customerName.trim(),
			customer_phone: normalizedPhone,
			customer_cpf: normalizedCpf,
			customer_email: data.email,
			company_name: companyName,
			stripe_session_id: session.id,
		});

		// Increment redemption count (optimistic concurrency)
		const updated = await globalPromoLinkRepository.incrementRedemptions(
			link.id,
			link.current_redemptions,
		);

		if (!updated) {
			// Concurrency conflict — refetch and retry once
			const refreshed = await globalPromoLinkRepository.findByToken(token);
			if (refreshed) {
				await globalPromoLinkRepository.incrementRedemptions(
					refreshed.id,
					refreshed.current_redemptions,
				);
			}
		}

		// Check if max redemptions reached → auto-exhaust
		const currentLink = await globalPromoLinkRepository.findByToken(token);
		if (
			currentLink &&
			currentLink.current_redemptions >= currentLink.max_redemptions
		) {
			await globalPromoLinkRepository.updateStatus(currentLink.id, 'exhausted');
		}

		return {
			checkoutUrl: session.url ?? '',
			sessionId: session.id,
		};
	}

	async updateStatus(id: string, data: UpdateGlobalPromoLinkStatus) {
		const link = await globalPromoLinkRepository.findById(id);
		if (!link) throw new Error('Global promo link not found');

		const updated = await globalPromoLinkRepository.updateStatus(
			id,
			data.status,
		);
		if (!updated) throw new Error('Failed to update global promo link status');

		return {
			id: updated.id,
			status: updated.status,
			updatedAt: updated.updated_at,
		};
	}

	async listLinks() {
		const rows = await globalPromoLinkRepository.findAll();

		return rows.map((row) => ({
			id: row.id,
			token: row.token,
			discountPercent: row.discount_percent,
			durationMonths: row.duration_months,
			maxRedemptions: row.max_redemptions,
			currentRedemptions: row.current_redemptions,
			status: row.status,
			expiresAt: row.expires_at,
			createdBy: row.created_by,
			createdAt: row.created_at,
		}));
	}
}

export const globalPromoLinkService = new GlobalPromoLinkService();
