import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { appointmentConfigService } from '../services/appointment-config.js';
import {
	createDayOffSchema,
	createHolidaySchema,
	updateGlobalConfigSchema,
	upsertTechnicianScheduleSchema,
} from '../types/appointment-config.js';

// ─── Global config ───────────────────────────────────────────────────────

export const getGlobalConfigController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const config = await appointmentConfigService.getGlobal();
		return reply.send(config);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateGlobalConfigController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}
		const patch = updateGlobalConfigSchema.parse(request.body);
		const config = await appointmentConfigService.updateGlobal(
			patch,
			request.currentUser.id,
		);
		return reply.send(config);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ─── Holidays ────────────────────────────────────────────────────────────

export const listHolidaysController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const holidays = await appointmentConfigService.listHolidays();
		return reply.send(holidays);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const addHolidayController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}
		const data = createHolidaySchema.parse(request.body);
		const holiday = await appointmentConfigService.addHoliday(
			data,
			request.currentUser.id,
		);
		return reply.status(201).send(holiday);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteHolidayController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}
		await appointmentConfigService.deleteHoliday(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ─── Days off ────────────────────────────────────────────────────────────

export const listDaysOffController = async (
	request: FastifyRequest<{
		Querystring: { technicianId?: string; from?: string; to?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const list = await appointmentConfigService.listDaysOff(request.query);
		return reply.send(list);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const addDayOffController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id;
		if (!userId) return reply.status(403).send({ message: 'Forbidden' });

		const data = createDayOffSchema.parse(request.body);

		// Folga GLOBAL (technicianId null) → só staff
		// Folga PRA OUTRO técnico → só staff
		// Folga PRA SI MESMO → técnico autorizado
		const staff = isStaffRole(request.currentRole);
		const targetTech = data.technicianId ?? null;
		if (!staff && targetTech !== userId) {
			return reply.status(403).send({
				message: 'Apenas staff pode criar folga para outro técnico ou global',
			});
		}

		const dayOff = await appointmentConfigService.addDayOff(data, userId);
		return reply.status(201).send(dayOff);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteDayOffController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}
		await appointmentConfigService.deleteDayOff(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ─── Tech schedule ───────────────────────────────────────────────────────

export const getTechScheduleController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const sched = await appointmentConfigService.getTechSchedule(
			request.params.id,
		);
		return reply.send(sched);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const upsertTechScheduleController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id;
		if (!userId) return reply.status(403).send({ message: 'Forbidden' });

		// Staff pode editar qualquer técnico; técnico só pode editar si mesmo.
		const staff = isStaffRole(request.currentRole);
		if (!staff && request.params.id !== userId) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const patch = upsertTechnicianScheduleSchema.parse(request.body);
		const sched = await appointmentConfigService.upsertTechSchedule(
			request.params.id,
			patch,
		);
		return reply.send(sched);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
