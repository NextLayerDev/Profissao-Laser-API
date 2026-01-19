import { supabase } from '@/lib/supabase';
import { permissionsService } from '@/services/permissions.service';
import type {
	LoginParams,
	RegisterParams,
} from '@/types/Interfaces/IAuthParams';

export class AuthService {
	async register(userData: RegisterParams) {
		const permission = await permissionsService.getPermissionsByRole(
			userData.role,
		);

		if (!permission || !permission.id) {
			throw new Error('Permission not found for this role');
		}

		const { data, error } = await supabase.auth.signUp({
			email: userData.email,
			password: userData.password,
			options: {
				data: {
					name: userData.name,
					role: userData.role,
					permissionId: permission.id,
				},
			},
		});

		if (error) throw new Error(error.message);

		return { message: 'User created', user: data.user };
	}

	async login(userData: LoginParams) {
		const { data, error } = await supabase.auth.signInWithPassword({
			email: userData.email,
			password: userData.password,
		});

		if (error) throw new Error(error.message);
		if (!data.session) throw new Error('No session created');

		return { token: data.session.access_token };
	}
}

export const authService = new AuthService();
