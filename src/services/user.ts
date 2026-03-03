import { usersRepository } from '../repositories/user.js';
import type { UserUpdate } from '../types/user.js';

export class UsersService {
	async getAllUsers() {
		return await usersRepository.getAllUsers();
	}

	async getUserById(id: string) {
		return await usersRepository.getUser(id);
	}

	async updateUser(id: string, data: UserUpdate) {
		return await usersRepository.updateUser(id, data);
	}

	async deleteUser(id: string) {
		return await usersRepository.deleteUser(id);
	}

	async getUserPermissions(id: string) {
		return await usersRepository.getUserPermissions(id);
	}
}

export const usersService = new UsersService();
