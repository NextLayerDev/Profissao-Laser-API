import { supabase } from '../lib/supabase.js';
import type { CustomerWatermark } from '../types/watermark.js';

class CustomerWatermarkRepository {
	async findByCustomerId(
		customerId: string,
	): Promise<CustomerWatermark | null> {
		const { data, error } = await supabase
			.from('pl_customer_watermark')
			.select('*')
			.eq('customerId', customerId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as CustomerWatermark) ?? null;
	}

	/** UPSERT — cria ou atualiza a watermark do customer (singleton). */
	async upsert(
		customerId: string,
		imageUrl: string,
	): Promise<CustomerWatermark> {
		const { data, error } = await supabase
			.from('pl_customer_watermark')
			.upsert(
				{
					customerId,
					imageUrl,
					updatedAt: new Date().toISOString(),
				},
				{ onConflict: 'customerId' },
			)
			.select()
			.single();
		if (error || !data) {
			throw new Error(error?.message ?? 'Failed to upsert watermark');
		}
		return data as CustomerWatermark;
	}

	async delete(customerId: string): Promise<{ imageUrl: string } | null> {
		const existing = await this.findByCustomerId(customerId);
		if (!existing) return null;

		const { error } = await supabase
			.from('pl_customer_watermark')
			.delete()
			.eq('customerId', customerId);
		if (error) throw new Error(error.message);
		return { imageUrl: existing.imageUrl };
	}
}

export const customerWatermarkRepository = new CustomerWatermarkRepository();
