import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth.js';
import type { Login, UserRegister } from '../types/auth.js';
import type { Customer } from '../types/customer.js';

class AuthController {
	async registerUser(request: FastifyRequest, reply: FastifyReply) {
		const { data: result, error } = await authService.registerUser(
			request.body as UserRegister,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.status(201).send(result);
	}

	async loginUser(request: FastifyRequest, reply: FastifyReply) {
		const { data: result, error } = await authService.loginUser(
			request.body as Login,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(401).send({ message });
		}
		return reply.send(result);
	}

	async registerCustomer(request: FastifyRequest, reply: FastifyReply) {
		const { data: result, error } = await authService.registerCustomer(
			request.body as Customer,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.status(201).send(result);
	}

	async loginCustomer(request: FastifyRequest, reply: FastifyReply) {
		const { data: result, error } = await authService.loginCustomer(
			request.body as Login,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(401).send({ message });
		}
		return reply.send(result);
	}

	async forgotPassword(request: FastifyRequest, reply: FastifyReply) {
		const { email } = request.body as { email: string };
		const { data: result, error } = await authService.forgotPassword(email);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.send(result);
	}
}

export const authController = new AuthController();
