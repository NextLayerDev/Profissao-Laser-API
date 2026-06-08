import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { machineService } from '../services/machine.js';
import {
	createMachineOptionSchema,
	createMachineSchema,
	updateMachineOptionSchema,
	updateMachineSchema,
} from '../types/machine.js';

function statusFor(message: string): number {
	if (message === 'Machine not found') return 404;
	if (message === 'Machine option not found') return 404;
	return 500;
}

// ── Machines ────────────────────────────────────────────────────────────────

export const listMachinesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const staff = isStaffRole(request.currentRole);
		const machines = await machineService.list(staff);
		return reply.send(machines);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getMachineController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const staff = isStaffRole(request.currentRole);
		const machine = await machineService.findById(request.params.id, staff);
		if (machine.status !== 'ativo' && !staff) {
			return reply.status(404).send({ message: 'Machine not found' });
		}
		return reply.send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const createMachineController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createMachineSchema.parse(request.body);
		const machine = await machineService.create(
			data,
			request.currentUser?.id ?? null,
		);
		return reply.status(201).send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateMachineController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateMachineSchema.parse(request.body);
		const machine = await machineService.update(request.params.id, data);
		return reply.send(machine);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteMachineController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await machineService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Options ─────────────────────────────────────────────────────────────────

export const createMachineOptionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = createMachineOptionSchema.parse(request.body);
		const option = await machineService.createOption(request.params.id, data);
		return reply.status(201).send(option);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const updateMachineOptionController = async (
	request: FastifyRequest<{ Params: { id: string; optionId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateMachineOptionSchema.parse(request.body);
		const option = await machineService.updateOption(
			request.params.id,
			request.params.optionId,
			data,
		);
		return reply.send(option);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteMachineOptionController = async (
	request: FastifyRequest<{ Params: { id: string; optionId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await machineService.deleteOption(
			request.params.id,
			request.params.optionId,
		);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};
