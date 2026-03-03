import { supabase } from '../lib/supabase.js';
import type { User, UserUpdate } from '../types/user.js';

class UsersRepository {
	async getAllUsers() {
		return await supabase.from('Users').select('*');
	}

	async getUser(userId: string) {
		return await supabase.from('Users').select('*').eq('id', userId).single();
	}

	async createUser(userData: User) {
		return await supabase.from('Users').insert(userData).single();
	}

	async updateUser(userId: string, userData: UserUpdate) {
		return await supabase
			.from('Users')
			.update(userData)
			.eq('id', userId)
			.single();
	}

	async deleteUser(userId: string) {
		return await supabase.from('Users').delete().eq('id', userId);
	}

	async getPermissionByRole(role: string) {
		return await supabase
			.from('Permissions')
			.select('id')
			.eq('role', role)
			.single();
	}

	async getUserPermissions(userId: string) {
		return await supabase
			.from('Users')
			.select('Permissions(canEdit, canView, canAdmin, canPrice)')
			.eq('id', userId)
			.single();
	}
}

export const usersRepository = new UsersRepository();
