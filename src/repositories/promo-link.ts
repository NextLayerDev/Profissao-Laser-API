import { supabase } from '../lib/supabase.js';

export interface PromoLinkRow {
	id: string;
	token: string;
	product_id: string;
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

export interface PromoLinkRedemptionRow {
	id: string;
	promo_link_id: string;
	customer_name: string;
	customer_phone: string;
	customer_cpf: string;
	customer_email: string;
	company_name: string;
	stripe_session_id: string | null;
	redeemed_at: string;
}

class PromoLinkRepository {
	async create(data: {
		token: string;
		product_id: string;
		discount_percent: number;
		duration_months: number;
		max_redemptions: number;
		stripe_coupon_id: string;
		expires_at?: string | null;
		created_by?: string | null;
	}): Promise<PromoLinkRow> {
		const { data: result, error } = await supabase
			.from('pl_promo_link')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return result as PromoLinkRow;
	}

	async findByToken(token: string): Promise<PromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_promo_link')
			.select('*')
			.eq('token', token)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as PromoLinkRow | null;
	}

	async findById(id: string): Promise<PromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_promo_link')
			.select('*')
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as PromoLinkRow | null;
	}

	async findAll(): Promise<
		(PromoLinkRow & { pl_product: { name: string } })[]
	> {
		const { data, error } = await supabase
			.from('pl_promo_link')
			.select('*, pl_product(name)')
			.order('created_at', { ascending: false });

		if (error) throw new Error(error.message);
		return data as (PromoLinkRow & { pl_product: { name: string } })[];
	}

	async incrementRedemptions(
		id: string,
		expectedCount: number,
	): Promise<PromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_promo_link')
			.update({
				current_redemptions: expectedCount + 1,
				updated_at: new Date().toISOString(),
			})
			.eq('id', id)
			.eq('current_redemptions', expectedCount)
			.select()
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as PromoLinkRow | null;
	}

	async updateStatus(id: string, status: string): Promise<PromoLinkRow | null> {
		const { data, error } = await supabase
			.from('pl_promo_link')
			.update({
				status,
				updated_at: new Date().toISOString(),
			})
			.eq('id', id)
			.select()
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as PromoLinkRow | null;
	}

	async createRedemption(data: {
		promo_link_id: string;
		customer_name: string;
		customer_phone: string;
		customer_cpf: string;
		customer_email: string;
		company_name: string;
		stripe_session_id?: string | null;
	}): Promise<PromoLinkRedemptionRow> {
		const { data: result, error } = await supabase
			.from('pl_promo_link_redemption')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return result as PromoLinkRedemptionRow;
	}

	async findRedemptionByCpfAndPhone(
		promoLinkId: string,
		cpf: string,
		phone: string,
	): Promise<PromoLinkRedemptionRow | null> {
		const { data, error } = await supabase
			.from('pl_promo_link_redemption')
			.select('*')
			.eq('promo_link_id', promoLinkId)
			.eq('customer_cpf', cpf)
			.eq('customer_phone', phone)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as PromoLinkRedemptionRow | null;
	}
}

export const promoLinkRepository = new PromoLinkRepository();
