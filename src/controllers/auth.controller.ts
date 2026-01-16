import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from '@/services/auth.service';
import type {
	LoginParams,
	RegisterParams,
} from '@/types/Interfaces/IAuthParams';

const authService = new AuthService();

export const registerController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await authService.register(request.body as RegisterParams);
		return reply.status(201).send(result);
	} catch (err: any) {
		return reply.status(400).send({ message: err.message || err });
	}
};

export const loginController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await authService.login(request.body as LoginParams);
		return reply.send(result);
	} catch (err: any) {
		return reply.status(401).send({ message: err.message || err });
	}
};
