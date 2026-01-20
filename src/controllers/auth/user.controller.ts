import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '@/services/auth.service';
import type { UserParams } from '@/types/Interfaces/IUserParams';

export const registerController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await authService.registerUser(request.body as UserParams);
		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const loginController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await authService.loginUser(
			request.body as UserParams,
			reply,
		);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(401).send({ message });
	}
};
