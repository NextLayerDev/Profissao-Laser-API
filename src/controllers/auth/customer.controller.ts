import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '@/services/auth.service';
import type { CustomerParams } from '@/types/Interfaces/ICustomerParams';

export const registerController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await authService.registerCustomer(
			request.body as CustomerParams,
		);
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
		const result = await authService.loginCustomer(
			request.body as CustomerParams,
			reply,
		);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(401).send({ message });
	}
};
