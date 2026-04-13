import { withCapture } from '@/lib/sentry.js';
import { encrypt } from '../lib/crypto.js';
import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { customerRepository } from '../repositories/customer.js';

type SubscriptionInfo = {
	status: string;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
};

async function fetchAllStripeSubscriptions(): Promise<{
	subscriptions: Map<string, SubscriptionInfo>;
	phones: Map<string, string>;
}> {
	const subscriptions = new Map<string, SubscriptionInfo>();
	const phones = new Map<string, string>();

	for (const status of ['active', 'trialing'] as const) {
		let hasMore = true;
		let startingAfter: string | undefined;

		while (hasMore) {
			const page = await stripe.subscriptions.list({
				status,
				limit: 100,
				expand: ['data.customer'],
				...(startingAfter && { starting_after: startingAfter }),
			});

			for (const sub of page.data) {
				const customer = sub.customer;
				const isFullCustomer =
					typeof customer === 'object' &&
					customer !== null &&
					!('deleted' in customer);

				if (!isFullCustomer) continue;

				const email = customer.email;
				if (!email) continue;

				if (customer.phone && !phones.has(email)) {
					phones.set(email, customer.phone);
				}

				if (!subscriptions.has(email)) {
					const periodEnd = sub.items.data[0]?.current_period_end;
					subscriptions.set(email, {
						status: sub.status,
						currentPeriodEnd: periodEnd
							? new Date(periodEnd * 1000).toISOString()
							: null,
						cancelAtPeriodEnd: sub.cancel_at_period_end,
					});
				}
			}

			hasMore = page.has_more;
			if (hasMore) startingAfter = page.data[page.data.length - 1].id;
		}
	}

	return { subscriptions, phones };
}

export const customerService = {
	async getCustomerById(id: string) {
		return withCapture(async () => {
			const { data: dbData, error } =
				await customerRepository.getCustomerById(id);
			if (error) throw new Error(error.message);

			const { data: authData } = await supabase.auth.admin.getUserById(id);
			const bannedUntil = authData?.user?.banned_until;
			const banned = !!bannedUntil && new Date(bannedUntil) > new Date();

			return { ...dbData, banned };
		});
	},

	async getAllCustomers() {
		return withCapture(async () => {
			const { data: dbData, error } =
				await customerRepository.getAllCustomers();
			if (error) throw new Error(error.message);

			const emails = (dbData ?? []).map((c) => c.email);

			const [authData, stripeData, phoneMap] = await Promise.all([
				supabase.auth.admin.listUsers({ perPage: 1000 }),
				fetchAllStripeSubscriptions(),
				customerRepository.findPhonesByEmails(emails),
			]);

			const banMap = new Map(
				(authData.data?.users ?? []).map((u) => {
					const banned =
						!!u.banned_until && new Date(u.banned_until) > new Date();
					return [u.id, banned];
				}),
			);

			return (dbData ?? []).map((c) => ({
				...c,
				phone:
					c.phone ||
					stripeData.phones.get(c.email) ||
					phoneMap[c.email] ||
					null,
				banned: banMap.get(c.id) ?? false,
				subscription: stripeData.subscriptions.get(c.email) ?? null,
			}));
		});
	},

	async deleteCustomer(id: string) {
		return withCapture(async () => {
			await customerRepository.deleteCustomer(id);
			const { error: authError } = await supabase.auth.admin.deleteUser(id);
			if (authError) throw new Error(authError.message);
		});
	},

	async blockCustomer(id: string, block: boolean) {
		return withCapture(async () => {
			const { error } = await supabase.auth.admin.updateUserById(id, {
				ban_duration: block ? '876000h' : 'none',
			});
			if (error) throw new Error(error.message);
			return { message: block ? 'Customer blocked' : 'Customer unblocked' };
		});
	},

	async changePassword(id: string, password: string) {
		return withCapture(async () => {
			const { error: authError } = await supabase.auth.admin.updateUserById(
				id,
				{ password },
			);
			if (authError) throw new Error(authError.message);

			return customerRepository.updateCustomer(id, {
				password_encrypted: encrypt(password),
			});
		});
	},
};
