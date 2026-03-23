import { supabase } from '../lib/supabase.js';

export interface GlobalPromoLinkRow {
	id: string;
	token: string;
	discount_percent: number;
	duration_months: number;
	max_redemptions: number;
	current_redemptions: number;
	stripe_coupon_id: string;
	status: 'active' | 'inactive' | 'exhausted' | 'expired';
	expires_at: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface GlobalPromoLinkRedemptionRow {
	id: string;
	global_promo_link_id: string;
	product_id: string;
	customer_name: string;
	customer_phone: string;
	customer_cpf: string;
	customer_email: string;
	company_name: string;
	stripe_session_id: string | null;
	redeemed_at: string;
}

class GlobalPromoLinkRepository {
	async create(data: {
		token: string;
		discount_percent: number;
		duration_months: number;
		max_redemptions: number;
		stripe_coupon_id: string;
		expires_at?: string | null;
		created_by?: string | null;
	}): Promise<GlobalPromoLinkRow> {
		const { data: result, error } = await supabase
			.from('pl_global_promo_link')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return result as GlobalPromoLinkRow;
	}

	async findByToken(token: string): Promise<GlobalPromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_global_promo_link')
			.select('*')
			.eq('token', token)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as GlobalPromoLinkRow | null;
	}

	async findById(id: string): Promise<GlobalPromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_global_promo_link')
			.select('*')
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as GlobalPromoLinkRow | null;
	}

	async findAll(): Promise<GlobalPromoLinkRow[]> {
		const { data, error } = await supabase
			.from('pl_global_promo_link')
			.select('*')
			.order('created_at', { ascending: false });

		if (error) throw new Error(error.message);
		return data as GlobalPromoLinkRow[];
	}

	async incrementRedemptions(
		id: string,
		expectedCount: number,
	): Promise<GlobalPromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_global_promo_link')
			.update({
				current_redemptions: expectedCount + 1,
				updated_at: new Date().toISOString(),
			})
			.eq('id', id)
			.eq('current_redemptions', expectedCount)
			.select()
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as GlobalPromoLinkRow | null;
	}

	async updateStatus(
		id: string,
		status: string,
	): Promise<GlobalPromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_global_promo_link')
			.update({
				status,
				updated_at: new Date().toISOString(),
			})
			.eq('id', id)
			.select()
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as GlobalPromoLinkRow | null;
	}

	async createRedemption(data: {
		global_promo_link_id: string;
		product_id: string;
		customer_name: string;
		customer_phone: string;
		customer_cpf: string;
		customer_email: string;
		company_name: string;
		stripe_session_id?: string | null;
	}): Promise<GlobalPromoLinkRedemptionRow> {
		const { data: result, error } = await supabase
			.from('pl_global_promo_link_redemption')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return result as GlobalPromoLinkRedemptionRow;
	}

	async findRedemptionByCpfAndPhone(
		globalPromoLinkId: string,
		cpf: string,
		phone: string,
	): Promise<GlobalPromoLinkRedemptionRow | null> {
		const { data, error } = await supabase
			.from('pl_global_promo_link_redemption')
			.select('*')
			.eq('global_promo_link_id', globalPromoLinkId)
			.eq('customer_cpf', cpf)
			.eq('customer_phone', phone)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as GlobalPromoLinkRedemptionRow | null;
	}
}

export const globalPromoLinkRepository = new GlobalPromoLinkRepository();
