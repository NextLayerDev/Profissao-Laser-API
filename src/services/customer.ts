import { withCapture } from '@/lib/sentry.js';
import { encrypt } from '../lib/crypto.js';
import { supabase } from '../lib/supabase.js';
import { customerRepository } from '../repositories/customer.js';

export const customerService = {
	async getCustomerById(id: string) {
		return withCapture(async () => {
			const { data: dbData, error } =
				await customerRepository.getCustomerById(id);
			if (error) throw new Error(error.message);

			const { data: authData } = await supabase.auth.admin.getUserById(id);
			const bannedUntil = authData?.user?.banned_until;
			const banned = !!bannedUntil && new Date(bannedUntil) > new Date();

			return { ...dbData, banned };
		});
	},

	async getAllCustomers() {
		return withCapture(async () => {
			const { data: dbData, error } =
				await customerRepository.getAllCustomers();
			if (error) throw new Error(error.message);

			const { data: authData } = await supabase.auth.admin.listUsers({
				perPage: 1000,
			});
			const banMap = new Map(
				(authData?.users ?? []).map((u) => {
					const banned =
						!!u.banned_until && new Date(u.banned_until) > new Date();
					return [u.id, banned];
				}),
			);

			return (dbData ?? []).map((c) => ({
				...c,
				banned: banMap.get(c.id) ?? false,
			}));
		});
	},

	async deleteCustomer(id: string) {
		return withCapture(async () => {
			await customerRepository.deleteCustomer(id);
			const { error: authError } = await supabase.auth.admin.deleteUser(id);
			if (authError) throw new Error(authError.message);
		});
	},

	async blockCustomer(id: string, block: boolean) {
		return withCapture(async () => {
			const { error } = await supabase.auth.admin.updateUserById(id, {
				ban_duration: block ? '876000h' : 'none',
			});
			if (error) throw new Error(error.message);
			return { message: block ? 'Customer blocked' : 'Customer unblocked' };
		});
	},

	async changePassword(id: string, password: string) {
		return withCapture(async () => {
			const { error: authError } = await supabase.auth.admin.updateUserById(
				id,
				{ password },
			);
			if (authError) throw new Error(authError.message);

			return customerRepository.updateCustomer(id, {
				password_encrypted: encrypt(password),
			});
		});
	},
};
