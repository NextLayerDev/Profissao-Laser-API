import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerMachineService } from '../services/customer-machine.js';
import {
	createCustomerMachineSchema,
	updateCustomerMachineSchema,
	upsertCustomerMachineSchema,
} from '../types/customer-machine.js';

function statusFor(message: string): number {
	if (message === 'Machine not found') return 404;
	if (message === 'Customer machine not found') return 404;
	if (message.startsWith('Opção inválida')) return 400;
	return 500;
}

// ── Plural — multi-máquina ─────────────────────────────────────────────────

export const listCustomerMachinesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const items = await customerMachineService.list(customerId);
		return reply.send(items);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createCustomerMachineController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const data = createCustomerMachineSchema.parse(request.body);
		const machine = await customerMachineService.create(customerId, data);
		return reply.status(201).send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const updateCustomerMachineController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const data = updateCustomerMachineSchema.parse(request.body);
		const machine = await customerMachineService.update(
			customerId,
			request.params.id,
			data,
		);
		return reply.send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteCustomerMachineController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		await customerMachineService.delete(customerId, request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Singular (DEPRECATED — aponta pra default do customer) ─────────────────

export const getCustomerMachineController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const machine = await customerMachineService.findDefault(customerId);
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
		const machine = await customerMachineService.upsertDefault(
			customerId,
			data,
		);
		return reply.send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteCustomerMachineSingularController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		await customerMachineService.deleteDefault(customerId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
