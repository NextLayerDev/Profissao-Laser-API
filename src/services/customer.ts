import { encrypt } from '../lib/crypto.js';
import { supabase } from '../lib/supabase.js';
import { customerRepository } from '../repositories/customer.js';

class CustomerService {
	async deleteCustomer(id: string) {
		const { error: authError } = await supabase.auth.admin.deleteUser(id);
		if (authError) throw new Error(authError.message);
		return await customerRepository.deleteCustomer(id);
	}

	async blockCustomer(id: string, block: boolean) {
		const { error } = await supabase.auth.admin.updateUserById(id, {
			ban_duration: block ? '876000h' : 'none',
		});
		if (error) throw new Error(error.message);
		return { message: block ? 'Customer blocked' : 'Customer unblocked' };
	}

	async changePassword(id: string, password: string) {
		const { error: authError } = await supabase.auth.admin.updateUserById(id, {
			password,
		});
		if (authError) throw new Error(authError.message);

		// biome-ignore lint/suspicious/noExplicitAny: password_encrypted not in CustomerUpdate type
		return await customerRepository.updateCustomer(id, {
			password_encrypted: encrypt(password),
		} as any);
	}
}

export const customerService = new CustomerService();
