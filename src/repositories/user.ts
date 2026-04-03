import { supabase } from '../lib/supabase.js';
import type { User, UserUpdate } from '../types/user.js';

class UsersRepository {
	async getAllUsers() {
		const { data, error } = await supabase.from('Users').select('*');
		if (error) throw error;
		return data;
	}

	async getUser(userId: string) {
		const { data, error } = await supabase
			.from('Users')
			.select('*')
			.eq('id', userId)
			.single();
		if (error) throw error;
		return data;
	}

	async createUser(userData: User) {
		const { data, error } = await supabase
			.from('Users')
			.insert(userData)
			.single();
		if (error) throw error;
		return data;
	}

	async updateUser(userId: string, userData: UserUpdate) {
		const { data, error } = await supabase
			.from('Users')
			.update(userData)
			.eq('id', userId)
			.single();
		if (error) throw error;
		return data;
	}

	async deleteUser(userId: string) {
		const { error } = await supabase.from('Users').delete().eq('id', userId);
		if (error) throw error;
	}

	async getPermissionByRole(role: string) {
		const { data, error } = await supabase
			.from('Permissions')
			.select('id')
			.eq('role', role)
			.single();
		if (error) throw error;
		return data;
	}

	async getUserPermissions(userId: string) {
		const { data, error } = await supabase
			.from('Users')
			.select('Permissions(canEdit, canView, canAdmin, canPrice)')
			.eq('id', userId)
			.single();
		if (error) throw error;
		return data;
	}
}

export const usersRepository = new UsersRepository();
