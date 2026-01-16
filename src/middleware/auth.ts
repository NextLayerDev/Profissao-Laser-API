import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '@/lib/supabase';

export const authenticate = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const authHeader = request.headers.authorization;
	const token = authHeader?.replace('Bearer ', '');

	if (!token) {
		return reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Not authenticated',
		});
	}

	try {
		const user = await supabase.auth.getUser(token);

		if (!user) {
			throw new Error('User not found');
		}

		return reply.status(200).send({ message: 'Authenticated successfully' });
	} catch (error) {
		request.log.warn({ error }, 'Authentication error');
		return reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Invalid or expired token',
		});
	}
};
