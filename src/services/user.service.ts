import { supabase } from '@/lib/supabase';
import type {
	UpdateUserParams,
	UserParams,
} from '@/types/Interfaces/IUserParams';

class UserService {
	async getUsers(): Promise<UserParams[]> {
		const { data, error } = await supabase.from('Users').select('*');

		if (error) {
			throw new Error(error.message);
		}

		return data;
	}

	async updateUser(id: string, data: UpdateUserParams) {
		const { error } = await supabase.from('Users').update(data).eq('id', id);

		if (error) {
			throw new Error(error.message);
		}

		return { message: 'User updated' };
	}
}

export const userService = new UserService();
