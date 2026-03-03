import type { FastifyReply, FastifyRequest } from 'fastify';
import { usersService } from '../services/user.js';
import type { UserUpdate } from '../types/user.js';

export class UsersController {
	async getAllUsers(_request: FastifyRequest, reply: FastifyReply) {
		const { data, error } = await usersService.getAllUsers();

		if (error) {
			reply.status(500).send({ error });
		} else {
			reply.status(200).send(data);
		}
	}

	async getUserById(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { data, error } = await usersService.getUserById(id);

		if (error) {
			reply.status(500).send({ error });
		} else {
			reply.status(200).send(data);
		}
	}

	async updateUser(
		request: FastifyRequest<{ Params: { id: string }; Body: UserUpdate }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { data, error } = await usersService.updateUser(id, request.body);

		if (error) {
			reply.status(500).send({ error });
		} else {
			reply.status(200).send(data);
		}
	}

	async deleteUser(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { error } = await usersService.deleteUser(id);

		if (error) {
			reply.status(500).send({ error });
		} else {
			reply.status(200).send({ message: 'User deleted' });
		}
	}

	async getUserPermissions(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { data, error } = await usersService.getUserPermissions(id);

		if (error) {
			reply.status(500).send({ error });
		} else if (!data) {
			reply.status(404).send({ error: 'User not found' });
		} else {
			reply.status(200).send(data);
		}
	}
}

export const usersController = new UsersController();
