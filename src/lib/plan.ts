import type { ProvisioningPlan } from '../types/provisioning.js';
import { supabase } from './supabase.js';

export const PLAN_ORDER: Record<ProvisioningPlan, number> = {
	prata: 1,
	ouro: 2,
	platina: 3,
};

export async function resolvePlanFromProduct(
	productId: string,
): Promise<ProvisioningPlan> {
	const { data: scLinks } = await supabase
		.from('pl_system_class_product')
		.select('systemClassId, pl_system_class(name)')
		.eq('productId', productId)
		.limit(1);

	if (scLinks && scLinks.length > 0) {
		const scName = (scLinks[0].pl_system_class as unknown as { name: string })
			?.name;
		if (scName) {
			const lower = scName.toLowerCase();
			if (lower === 'platina') return 'platina';
			if (lower === 'ouro') return 'ouro';
		}
	}
	return 'prata';
}
