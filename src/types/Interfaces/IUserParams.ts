import type { PermissionsParams } from './IPermissionParams';

export interface UserParams {
	id: string;
	email: string;
	name: string;
	role: string;
	password?: string;
	Permissions?: number | PermissionsParams;
}
