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

export async function getCustomerById(id: string) {
	const { data, error } = await supabase
		.from('Customers')
		.select('*')
		.eq('id', id)
		.single();

	if (error) {
		if (error.code === 'PGRST116') return null; // Not found
		throw new Error(error.message);
	}

	return data as CustomerParams;
}

export async function getAllCustomers() {
	const { data, error } = await supabase.from('Customers').select('*');

	if (error) {
		throw new Error(error.message);
	}

	return data as CustomerParams[];
}

export async function updateCustomer(
	id: string,
	data: Partial<CustomerParams>,
) {
	const { data: updatedCustomer, error } = await supabase

		.from('Customers')

		.update(data)

		.eq('id', id)

		.select()

		.single();

	if (error) {
		throw new Error(error.message);
	}

	return updatedCustomer as CustomerParams;
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
