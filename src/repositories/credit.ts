import { supabase } from '../lib/supabase.js';
import type { CreditFeature } from '../types/credit.js';

interface PackageRow {
	id: string;
	name: string;
	description: string | null;
	credits: number;
	price: number;
	status: 'ativo' | 'inativo';
	stripeProductId: string | null;
	stripePriceId: string | null;
}

interface CreatePackageRow {
	name: string;
	description?: string;
	credits: number;
	price: number;
	stripeProductId: string;
	stripePriceId: string;
}

class CreditRepository {
	async getBalance(customerId: string): Promise<number> {
		const { data, error } = await supabase
			.from('pl_credit_wallet')
			.select('balance')
			.eq('customerId', customerId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data?.balance ?? 0;
	}

	async getFeatureCost(feature: CreditFeature): Promise<number> {
		const { data, error } = await supabase
			.from('pl_credit_feature_cost')
			.select('cost')
			.eq('feature', feature)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error(`Feature cost not configured: ${feature}`);
		return data.cost;
	}

	async listFeatureCosts() {
		const { data, error } = await supabase
			.from('pl_credit_feature_cost')
			.select('feature, cost, label')
			.order('feature');
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async setFeatureCost(feature: string, cost: number) {
		const { error } = await supabase
			.from('pl_credit_feature_cost')
			.update({ cost, updatedAt: new Date().toISOString() })
			.eq('feature', feature);
		if (error) throw new Error(error.message);
	}

	async consume(params: {
		customerId: string;
		feature: CreditFeature;
		cost: number;
		idempotencyKey: string;
		metadata?: Record<string, unknown>;
	}): Promise<number> {
		const { data, error } = await supabase.rpc('pl_consume_credits', {
			p_customer_id: params.customerId,
			p_feature: params.feature,
			p_cost: params.cost,
			p_idempotency_key: params.idempotencyKey,
			p_metadata: params.metadata ?? {},
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async refund(params: {
		customerId: string;
		amount: number;
		feature: CreditFeature;
		idempotencyKey: string;
	}): Promise<number> {
		const { data, error } = await supabase.rpc('pl_refund_credits', {
			p_customer_id: params.customerId,
			p_amount: params.amount,
			p_feature: params.feature,
			p_idempotency_key: params.idempotencyKey,
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async addCredits(params: {
		customerId: string;
		amount: number;
		packageId: string;
		stripeSessionId: string;
	}): Promise<number> {
		const { data, error } = await supabase.rpc('pl_add_credits', {
			p_customer_id: params.customerId,
			p_amount: params.amount,
			p_package_id: params.packageId,
			p_stripe_session_id: params.stripeSessionId,
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async adjust(customerId: string, amount: number, reason: string) {
		const { data, error } = await supabase.rpc('pl_adjust_credits', {
			p_customer_id: customerId,
			p_amount: amount,
			p_reason: reason,
		});
		if (error) throw new Error(error.message);
		return data as number;
	}

	async findPackageById(id: string): Promise<PackageRow> {
		const { data, error } = await supabase
			.from('pl_credit_package')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Credit package not found');
		return data as PackageRow;
	}

	async listPackages(onlyActive: boolean): Promise<PackageRow[]> {
		let q = supabase.from('pl_credit_package').select('*').order('credits');
		if (onlyActive) q = q.eq('status', 'ativo');
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return (data ?? []) as PackageRow[];
	}

	async createPackage(row: CreatePackageRow): Promise<PackageRow> {
		const { data, error } = await supabase
			.from('pl_credit_package')
			.insert(row)
			.select()
			.single();
		if (error || !data) throw new Error(error?.message ?? 'Insert failed');
		return data as PackageRow;
	}

	async updatePackage(
		id: string,
		patch: Record<string, unknown>,
	): Promise<PackageRow> {
		const { data, error } = await supabase
			.from('pl_credit_package')
			.update({ ...patch, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error || !data) throw new Error(error?.message ?? 'Update failed');
		return data as PackageRow;
	}

	async listTransactions(customerId: string, page: number, limit: number) {
		const from = (page - 1) * limit;
		const to = from + limit - 1;
		const { data, error, count } = await supabase
			.from('pl_credit_transaction')
			.select('id, type, amount, balanceAfter, feature, createdAt', {
				count: 'exact',
			})
			.eq('customerId', customerId)
			.order('createdAt', { ascending: false })
			.range(from, to);
		if (error) throw new Error(error.message);
		return { data: data ?? [], total: count ?? 0 };
	}
}

export const creditRepository = new CreditRepository();
