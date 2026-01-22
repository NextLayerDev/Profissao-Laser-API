import { usersRepository } from '@/repositories/user';

export class UsersService {
	async getAllUsers() {
		return await usersRepository.getAllUsers();
	}

	async getUserById(id: string) {
		return await usersRepository.getUser(id);
	}
}

export const usersService = new UsersService();
