import type { FastifyReply, FastifyRequest } from 'fastify';
import { usersService } from '../services/user';

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
}

export const usersController = new UsersController();
