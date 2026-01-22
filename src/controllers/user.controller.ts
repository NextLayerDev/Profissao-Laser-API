import type { User } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAllUsers, getUserById } from '@/repositories/user.repository';

export const getMeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const user = request.user as User | undefined;
		const id = user?.id;
		if (!id) throw new Error('User ID not found in request');

		const userProfile = await getUserById(id);
		if (!userProfile)
			return reply.status(404).send({ message: 'User not found' });

		return reply.send(userProfile);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getUserController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params as { id: string };
		const user = await getUserById(id);
		if (!user) return reply.status(404).send({ message: 'User not found' });
		return reply.send(user);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getUsersController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const users = await getAllUsers();
		return reply.send(users);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
