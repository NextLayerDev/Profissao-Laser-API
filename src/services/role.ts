import { withCapture } from '@/lib/sentry.js';
import {
	getEffectivePermissions,
	type RolePermissionRow,
	type UserOverrides,
} from '../lib/permissions.js';
import { roleRepository } from '../repositories/role.js';
import { usersRepository } from '../repositories/user.js';
import type { RoleCreate, RoleUpdate } from '../types/role.js';

/** Supabase pode devolver o join FK como objeto ou array — normaliza. */
function pickOne<T>(value: T | T[] | null | undefined): T | null {
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
}

export const roleService = {
	async list() {
		return withCapture(() => roleRepository.list());
	},

	async getById(id: number) {
		return withCapture(() => roleRepository.getById(id));
	},

	async create(data: RoleCreate) {
		return withCapture(() => roleRepository.create(data));
	},

	async update(id: number, data: RoleUpdate) {
		return withCapture(() => roleRepository.update(id, data));
	},

	async remove(id: number) {
		return withCapture(async () => {
			const role = (await roleRepository.getById(id)) as {
				isSuperAdmin?: boolean;
			} | null;
			if (!role) throw new Error('Cargo não encontrado.');
			if (role.isSuperAdmin) {
				throw new Error('Não é possível excluir um cargo Super Admin.');
			}
			const count = await roleRepository.countUsers(id);
			if (count > 0) {
				throw new Error(
					`Não é possível excluir: ${count} usuário(s) usam este cargo.`,
				);
			}
			await roleRepository.remove(id);
		});
	},

	/** Permissões efetivas do usuário staff autenticado. */
	async getEffectiveForAuth(authId: string, email?: string | null) {
		return withCapture(async () => {
			const row = await usersRepository.getEffectivePermissions(authId, email);
			const role = pickOne(
				(row as { Permissions?: RolePermissionRow | RolePermissionRow[] })
					?.Permissions,
			);
			const overrides = (row as { overrides?: UserOverrides | null })
				?.overrides;
			return {
				isSuperAdmin: role?.isSuperAdmin ?? false,
				permissions: getEffectivePermissions(role, overrides),
			};
		});
	},
};
