import type { FastifyReply, FastifyRequest } from 'fastify';
import { usersService } from '../services/user.js';
import type { UserUpdate } from '../types/user.js';

export class UsersController {
	async getAllUsers(_request: FastifyRequest, reply: FastifyReply) {
		const { data, error } = await usersService.getAllUsers();

		if (error) {
			const message =
				error instanceof Error ? error.message : 'Internal Server Error';
			return reply.status(500).send({ message });
		}

		return reply.status(200).send(data);
	}

	async getUserById(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { data, error } = await usersService.getUserById(id);

		if (error) {
			const message =
				error instanceof Error ? error.message : 'Internal Server Error';
			return reply.status(500).send({ message });
		}

		if (!data) {
			return reply.status(404).send({ message: 'User not found' });
		}

		return reply.status(200).send(data);
	}

	async updateUser(
		request: FastifyRequest<{ Params: { id: string }; Body: UserUpdate }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { data, error } = await usersService.updateUser(id, request.body);

		if (error) {
			const message =
				error instanceof Error ? error.message : 'Internal Server Error';
			return reply.status(500).send({ message });
		}

		return reply.status(200).send(data);
	}

	async deleteUser(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { error } = await usersService.deleteUser(id);

		if (error) {
			const message =
				error instanceof Error ? error.message : 'Internal Server Error';
			return reply.status(500).send({ message });
		}

		return reply.status(200).send({ message: 'User deleted' });
	}

	async getUserPermissions(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { data, error } = await usersService.getUserPermissions(id);

		if (error) {
			const message =
				error instanceof Error ? error.message : 'Internal Server Error';
			return reply.status(500).send({ message });
		}

		if (!data) {
			return reply.status(404).send({ message: 'User not found' });
		}

		return reply.status(200).send(data);
	}
}

export const usersController = new UsersController();
