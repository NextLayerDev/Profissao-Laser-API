import { supabase } from '@/lib/supabase';
import type { PermissionParams } from '@/types/Interfaces/IPermissions';

class PermissionsService {
	async getPermissionsByRole(role: string): Promise<PermissionParams | null> {
		const { data, error } = await supabase
			.from('Permissions')
			.select('*')
			.eq('role', role)
			.limit(1);

		if (error) {
			throw new Error(error.message);
		}

		return data[0];
	}

	async getAllPermissions() {
		const { data, error } = await supabase.from('Permissions').select('*');

		console.log(data);

		if (error) {
			throw new Error(error.message);
		}

		return data;
	}
}

export const permissionsService = new PermissionsService();
