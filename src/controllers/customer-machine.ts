import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerMachineService } from '../services/customer-machine.js';
import { upsertCustomerMachineSchema } from '../types/customer-machine.js';

function statusFor(message: string): number {
	if (message === 'Machine not found') return 404;
	if (message.startsWith('Opção inválida')) return 400;
	return 500;
}

export const getCustomerMachineController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const machine = await customerMachineService.findByCustomer(customerId);
		if (!machine) {
			return reply.status(404).send({ message: 'Máquina não cadastrada' });
		}
		return reply.send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const putCustomerMachineController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const data = upsertCustomerMachineSchema.parse(request.body);
		const machine = await customerMachineService.upsert(customerId, data);
		return reply.send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteCustomerMachineController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		await customerMachineService.delete(customerId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
