import { supabase } from '../lib/supabase.ts';
import type { Customer, CustomerUpdate } from '../types/customer.ts';

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
}

export const customerRepository = new CustomerRepository();
