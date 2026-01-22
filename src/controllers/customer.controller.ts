import type { User } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	getAllCustomers,
	getCustomerById,
} from '@/repositories/customer.repository';

export const getMeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const user = request.user as User | undefined;
		const id = user?.id;
		if (!id) throw new Error('User ID not found in request');

		const customer = await getCustomerById(id);
		if (!customer)
			return reply.status(404).send({ message: 'Customer not found' });

		return reply.send(customer);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getCustomerController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params as { id: string };
		const customer = await getCustomerById(id);
		if (!customer)
			return reply.status(404).send({ message: 'Customer not found' });
		return reply.send(customer);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getCustomersController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customers = await getAllCustomers();
		return reply.send(customers);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
