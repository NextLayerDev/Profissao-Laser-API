import { supabase } from '../lib/supabase.js';

export interface PaymentLinkRow {
	id: string;
	token: string;
	product_id: string;
	customer_name: string;
	customer_phone: string;
	customer_cpf: string;
	company_name: string;
	stripe_coupon_id: string;
	status: 'active' | 'used' | 'expired';
	used_at: string | null;
	stripe_session_id: string | null;
	expires_at: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

class PaymentLinkRepository {
	async create(data: {
		token: string;
		product_id: string;
		customer_name: string;
		customer_phone: string;
		customer_cpf: string;
		company_name: string;
		stripe_coupon_id: string;
		expires_at?: string | null;
		created_by?: string | null;
	}): Promise<PaymentLinkRow> {
		const { data: result, error } = await supabase
			.from('pl_payment_link')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return result as PaymentLinkRow;
	}

	async findByToken(token: string): Promise<PaymentLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_payment_link')
			.select('*')
			.eq('token', token)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as PaymentLinkRow | null;
	}

	async markAsUsed(
		token: string,
		stripeSessionId: string,
	): Promise<PaymentLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_payment_link')
			.update({
				status: 'used' as const,
				used_at: new Date().toISOString(),
				stripe_session_id: stripeSessionId,
				updated_at: new Date().toISOString(),
			})
			.eq('token', token)
			.eq('status', 'active')
			.select()
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as PaymentLinkRow | null;
	}
}

export const paymentLinkRepository = new PaymentLinkRepository();
