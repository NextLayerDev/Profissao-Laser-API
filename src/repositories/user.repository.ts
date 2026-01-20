import { supabase } from '@/lib/supabase';
import type { UserParams } from '@/types/Interfaces/IUserParams';

export async function getUserByEmail(email: string) {
	const { data, error } = await supabase
		.from('Users')
		.select('*')
		.eq('email', email)
		.single();

	if (error) {
		if (error.code === 'PGRST116') return null; // Not found
		throw new Error(error.message);
	}

	return data as UserParams;
}

export async function createUser(user: UserParams) {
	const { data, error } = await supabase
		.from('Users')
		.insert(user)
		.select()
		.single();

	if (error) {
		throw new Error(error.message);
	}

	return data as UserParams;
}
