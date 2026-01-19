import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '@/services/auth.service';
import type {
	LoginParams,
	RegisterParams,
} from '@/types/Interfaces/IAuthParams';

export const registerController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await authService.register(request.body as RegisterParams);
		return reply.status(201).send(result);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return reply.status(400).send({ message });
	}
};

export const loginController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await authService.login(request.body as LoginParams);
		return reply.send(result);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return reply.status(401).send({ message });
	}
};
