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
		const {
			data: { user },
			error,
		} = await supabase.auth.getUser(token);

		if (error || !user) {
			throw new Error('User not found');
		}

		request.user = user;
	} catch (error) {
		request.log.warn({ error }, 'Authentication error');
		return reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Invalid or expired token',
		});
	}
};
