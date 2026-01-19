import { supabase } from '@/lib/supabase';
import type {
	CustomerParams,
	UpdateCustomerParams,
} from '@/types/Interfaces/ICustomers';

class CustomerService {
	async getCustomers(): Promise<CustomerParams[]> {
		const { data, error } = await supabase.from('Customers').select('*');

		if (error) {
			throw new Error(error.message);
		}

		return data;
	}

	async updateCustomer(id: string, data: UpdateCustomerParams) {
		const { error } = await supabase
			.from('Customers')
			.update(data)
			.eq('id', id);

		if (error) {
			throw new Error(error.message);
		}

		return { message: 'Customer updated' };
	}
}

export const customerService = new CustomerService();
