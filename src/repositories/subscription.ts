import { supabase } from '../lib/supabase.js';

class SubscriptionRepository {
	async deleteByUserId(userId: string) {
		const { error } = await supabase
			.from('pl_subscription')
			.delete()
			.eq('userId', userId);
		if (error) throw new Error(error.message);
	}

	async upsertByStripeSubscriptionId(data: {
		userId: string;
		productId: string;
		status: string;
		stripeSubscriptionId: string;
		stripeCustomerId: string;
		stripePriceId: string;
		currentPeriodEnd: string;
		cancelAtPeriodEnd: boolean;
	}) {
		const { error } = await supabase
			.from('pl_subscription')
			.upsert(
				{ ...data, updatedAt: new Date().toISOString() },
				{ onConflict: 'stripeSubscriptionId' },
			);
		if (error) throw new Error(error.message);
	}
}

export const subscriptionRepository = new SubscriptionRepository();
