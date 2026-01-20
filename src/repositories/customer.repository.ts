import { supabase } from '@/lib/supabase';
import type { CustomerParams } from '@/types/Interfaces/ICustomerParams';

export async function getCustomerByEmail(email: string) {
	const { data, error } = await supabase
		.from('Customers')
		.select('*')
		.eq('email', email)
		.single();

	if (error) {
		if (error.code === 'PGRST116') return null; // Not found
		throw new Error(error.message);
	}

	return data as CustomerParams;
}

export async function createCustomer(customer: CustomerParams) {
	const { data, error } = await supabase
		.from('Customers')
		.insert(customer)
		.select()
		.single();

	if (error) {
		throw new Error(error.message);
	}

	return data as CustomerParams;
}
