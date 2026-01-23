import { supabase } from '../lib/supabase';
import type { User, UserUpdate } from '../types/user';

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
}

export const usersRepository = new UsersRepository();
