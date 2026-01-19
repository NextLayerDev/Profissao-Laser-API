import type { FastifyReply, FastifyRequest } from 'fastify';
import { userService } from '@/services/user.service';
import type { UpdateUserParams } from '@/types/Interfaces/IUserParams';

export const getUsersController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const users = await userService.getUsers();
		return reply.status(200).send(users);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return reply.status(500).send({ message });
	}
};

export const updateUserController = async (
	request: FastifyRequest<{ Params: { id: string }; Body: UpdateUserParams }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const data = request.body;
		await userService.updateUser(id, data);
		return reply.status(200).send({ message: 'User updated successfully' });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return reply.status(500).send({ message });
	}
};
