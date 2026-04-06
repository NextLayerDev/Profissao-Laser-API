import { withCapture } from '@/lib/sentry.js';
import { usersRepository } from '../repositories/user.js';
import type { UserUpdate } from '../types/user.js';

export const usersService = {
	async getAllUsers() {
		return withCapture(() => usersRepository.getAllUsers());
	},

	async getUserById(id: string) {
		return withCapture(() => usersRepository.getUser(id));
	},

	async updateUser(id: string, data: UserUpdate) {
		return withCapture(() => usersRepository.updateUser(id, data));
	},

	async deleteUser(id: string) {
		return withCapture(() => usersRepository.deleteUser(id));
	},

	async getUserPermissions(id: string) {
		return withCapture(() => usersRepository.getUserPermissions(id));
	},
};
