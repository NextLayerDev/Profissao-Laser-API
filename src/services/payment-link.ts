import { randomBytes } from 'node:crypto';
import { withCapture } from '@/lib/sentry.js';
import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { paymentLinkRepository } from '../repositories/payment-link.js';
import { productRepository } from '../repositories/product.js';
import type {
	CreatePaymentLink,
	RedeemPaymentLink,
} from '../types/payment-link.js';
import { isValidCpf, normalizeDigits } from '../utils/cpf.js';
import { authService } from './auth.js';

const DISCOUNT_PERCENT = 99;

export const paymentLinkService = {
	async createLink(data: CreatePaymentLink, createdByEmail: string) {
		return withCapture(async () => {
			if (!isValidCpf(data.customerCpf)) {
				throw new Error('Invalid CPF');
			}

			const normalizedPhone = normalizeDigits(data.customerPhone);
			if (normalizedPhone.length < 10) {
				throw new Error('Invalid phone number');
			}

			const product = await productRepository.findById(data.productId);
			if (!product.stripeProductId || !product.stripePriceId) {
				throw new Error('Product is not configured for payments');
			}

			const { data: scLinks } = await supabase
				.from('pl_system_class_product')
				.select('systemClassId')
				.eq('productId', data.productId)
				.limit(1);

			if (scLinks && scLinks.length > 0) {
				throw new Error(
					'Payment links can only be created for products without system class associations',
				);
			}

			const coupon = await stripe.coupons.create({
				percent_off: DISCOUNT_PERCENT,
				duration: 'repeating',
				duration_in_months: 3,
				max_redemptions: 1,
				applies_to: { products: [product.stripeProductId] },
			});

			const token = randomBytes(32).toString('hex');

			const link = await paymentLinkRepository.create({
				token,
				product_id: data.productId,
				customer_name: data.customerName.trim(),
				customer_phone: normalizedPhone,
				customer_cpf: normalizeDigits(data.customerCpf),
				company_name: data.companyName.trim(),
				stripe_coupon_id: coupon.id,
				expires_at: data.expiresAt || null,
				created_by: createdByEmail,
			});

			const baseUrl =
				process.env.PAYMENT_LINK_BASE_URL ||
				process.env.SUCCESS_URL?.replace('/checkout/success', '') ||
				'http://localhost:3000';
			const url = `${baseUrl}/payment-link/${token}`;

			return {
				id: link.id,
				token: link.token,
				url,
				productName: product.name,
				customerName: link.customer_name,
				status: link.status,
				expiresAt: link.expires_at,
				createdAt: link.created_at,
			};
		});
	},

	async listLinks() {
		return withCapture(async () => {
			const rows = await paymentLinkRepository.findAll();

			return rows.map((row) => ({
				id: row.id,
				token: row.token,
				productName:
					(row.pl_product as unknown as { name: string })?.name ?? '',
				customerName: row.customer_name,
				customerPhone: row.customer_phone,
				customerCpf: row.customer_cpf,
				companyName: row.company_name,
				status: row.status,
				expiresAt: row.expires_at,
				usedAt: row.used_at,
				createdBy: row.created_by,
				createdAt: row.created_at,
			}));
		});
	},

	async getLinkInfo(token: string) {
		return withCapture(async () => {
			const link = await paymentLinkRepository.findByToken(token);
			if (!link) throw new Error('Payment link not found');

			if (link.expires_at && new Date(link.expires_at) < new Date()) {
				throw new Error('Payment link has expired');
			}

			if (link.status !== 'active') {
				throw new Error('Payment link has already been used');
			}

			const product = await productRepository.findById(link.product_id);

			const originalPrice = product.price;
			const discountedPrice = +(
				originalPrice *
				(1 - DISCOUNT_PERCENT / 100)
			).toFixed(2);

			return {
				token: link.token,
				productName: product.name,
				productDescription: product.description ?? null,
				originalPrice,
				discountedPrice,
				discountPercent: DISCOUNT_PERCENT,
				customerName: link.customer_name,
				companyName: link.company_name,
				status: link.status,
				expiresAt: link.expires_at,
			};
		});
	},

	async redeemLink(token: string, data: RedeemPaymentLink) {
		return withCapture(async () => {
			const link = await paymentLinkRepository.findByToken(token);
			if (!link) throw new Error('Payment link not found');

			if (link.status !== 'active') {
				throw new Error('Payment link has already been used');
			}

			if (link.expires_at && new Date(link.expires_at) < new Date()) {
				throw new Error('Payment link has expired');
			}

			const normalizedCpf = normalizeDigits(data.customerCpf);
			const normalizedPhone = normalizeDigits(data.customerPhone);
			const normalizedName = data.customerName.trim().toLowerCase();
			const storedName = link.customer_name.trim().toLowerCase();

			if (normalizedCpf !== link.customer_cpf) {
				throw new Error('Customer data does not match');
			}
			if (normalizedPhone !== link.customer_phone) {
				throw new Error('Customer data does not match');
			}
			if (normalizedName !== storedName) {
				throw new Error('Customer data does not match');
			}

			const product = await productRepository.findById(link.product_id);
			if (!product.stripePriceId) {
				throw new Error('Product is not configured for payments');
			}

			// Register customer account (Supabase Auth + Customers table)
			try {
				const result = await authService.registerCustomer({
					email: data.email,
					name: data.customerName.trim(),
					password: data.password,
					phone: normalizedPhone,
				});
				if (result.error) {
					const msg = result.error instanceof Error ? result.error.message : '';
					if (
						!msg.includes('already been registered') &&
						!msg.includes('already exists')
					) {
						throw new Error(`Account creation failed: ${msg}`);
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : '';
				// If user already exists, continue (they may be re-attempting)
				if (
					!msg.includes('already been registered') &&
					!msg.includes('already exists')
				) {
					throw err;
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

			// Use company name from client (they confirm/edit on checkout)
			const companyName = data.companyName.trim();

			const session = await stripe.checkout.sessions.create({
				customer: stripeCustomer.id,
				line_items: [{ price: product.stripePriceId, quantity: 1 }],
				mode,
				payment_method_types: ['card', 'boleto'],
				discounts: [{ coupon: link.stripe_coupon_id }],
				success_url: `${process.env.COURSES_URL ?? 'https://profissaolaser.com.br/cursos'}?session_id={CHECKOUT_SESSION_ID}`,
				cancel_url: process.env.CANCEL_URL ?? 'http://localhost:3000/cancelado',
				metadata: {
					company_name: companyName,
					payment_link_token: token,
				},
			});

			const updated = await paymentLinkRepository.markAsUsed(token, session.id);
			if (!updated) {
				await stripe.checkout.sessions.expire(session.id);
				throw new Error('Payment link has already been used');
			}

			return {
				checkoutUrl: session.url ?? '',
				sessionId: session.id,
			};
		});
	},
};
