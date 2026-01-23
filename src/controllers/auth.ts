import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth.js';
import type { Login, UserRegister } from '../types/auth.js';
import type { Customer } from '../types/customer.js';

class AuthController {
	async registerUser(request: FastifyRequest, reply: FastifyReply) {
		try {
			const result = await authService.registerUser(
				request.body as UserRegister,
			);
			return reply.status(201).send(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
	}

	async loginUser(request: FastifyRequest, reply: FastifyReply) {
		try {
			const result = await authService.loginUser(request.body as Login);
			return reply.send(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply.status(401).send({ message });
		}
	}

	async registerCustomer(request: FastifyRequest, reply: FastifyReply) {
		try {
			const result = await authService.registerCustomer(
				request.body as Customer,
			);
			return reply.status(201).send(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
	}

	async loginCustomer(request: FastifyRequest, reply: FastifyReply) {
		try {
			const result = await authService.loginCustomer(request.body as Login);
			return reply.send(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply.status(401).send({ message });
		}
	}
}

export const authController = new AuthController();
