import { supabase } from '../lib/supabase.js';
import type { Customer, CustomerUpdate } from '../types/customer.js';

class CustomerRepository {
	async getCustomerById(id: string) {
		return await supabase.from('Customers').select().eq('id', id).single();
	}

	async getAllCustomers() {
		return await supabase.from('Customers').select();
	}

	async createCustomer(customer: Customer) {
		return await supabase.from('Customers').insert(customer).select().single();
	}

	async updateCustomer(id: string, customer: CustomerUpdate) {
		return await supabase
			.from('Customers')
			.update(customer)
			.eq('id', id)
			.select()
			.single();
	}

	async deleteCustomer(id: string) {
		return await supabase.from('Customers').delete().eq('id', id);
	}

	async getCustomerPlan(email: string) {
		return await supabase
			.from('Customers')
			.select()
			.eq('email', email)
			.single();
	}

	async findPasswordEncryptedByEmail(email: string) {
		const { data, error } = await supabase
			.from('Customers')
			.select('password_encrypted')
			.eq('email', email)
			.single();
		if (error && error.code !== 'PGRST116') throw new Error(error.message);
		return data?.password_encrypted as string | null;
	}
}

export const customerRepository = new CustomerRepository();
