import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerService } from '@/services/customer.service';
import type { UpdateCustomerParams } from '@/types/Interfaces/ICustomers';

export const getCustomersController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customers = await customerService.getCustomers();
		return reply.status(200).send(customers);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return reply.status(500).send({ message });
	}
};

export const updateCustomerController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: UpdateCustomerParams;
	}>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const data = request.body;
		await customerService.updateCustomer(id, data);
		return reply.status(200).send({ message: 'Customer updated successfully' });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return reply.status(500).send({ message });
	}
};
