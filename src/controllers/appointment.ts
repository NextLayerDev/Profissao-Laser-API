import type { FastifyReply, FastifyRequest } from 'fastify';
import { formatCooldownMessage } from '../lib/appointment-cooldown.js';
import { isStaffRole } from '../lib/external-auth.js';
import { appointmentRepository } from '../repositories/appointment.js';
import {
	appointmentConfigService,
	SlotUnavailableError,
} from '../services/appointment-config.js';
import {
	createAppointmentSchema,
	updateAppointmentStatusSchema,
	updateAppointmentTechnicianSchema,
} from '../types/appointment.js';
import { clientCooldownQuerySchema } from '../types/appointment-config.js';

export const getAppointmentsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		if (isStaffRole(request.currentRole)) {
			const appointments = await appointmentRepository.listAll();
			return reply.send(appointments);
		}

		const email = request.currentUser.email;
		const appointments = await appointmentRepository.listByEmail(email);
		return reply.send(appointments);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getAppointmentsByCustomerController = async (
	request: FastifyRequest<{ Params: { id_customer: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const appointments = await appointmentRepository.listByCustomerId(
			request.params.id_customer,
		);
		return reply.send(appointments);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Customer not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const getAvailableSlotsController = async (
	request: FastifyRequest<{
		Querystring: { date: string; technicianId?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { date, technicianId } = request.query;

		// O intervalo mínimo é um fato DO CLIENTE, então só se aplica a quem
		// está marcando pra si. O painel vê a agenda inteira e recebe o aviso
		// (com opção de furar) na tela de criação.
		const email = request.currentUser?.email || null;
		const client = isStaffRole(request.currentRole)
			? undefined
			: { email, phone: request.currentUser?.phone ?? null };

		const result = await appointmentConfigService.getAvailableSlots(
			date,
			technicianId,
			client,
		);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createAppointmentController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		// `overrideCooldown` é flag de regra, NÃO coluna de `pl_appointment` — o
		// repositório faz `...data` direto no insert, então tem de sair aqui.
		const { overrideCooldown, ...data } = createAppointmentSchema.parse(
			request.body,
		);

		const staff = isStaffRole(request.currentRole);
		const accountEmail = request.currentUser?.email || null;

		// Cliente só marca em nome próprio. Sem isto o intervalo mínimo é furado
		// em um passo: basta mandar outro e-mail no body.
		if (!staff && accountEmail) data.customerEmail = accountEmail;

		// ── Intervalo mínimo entre atendimentos do mesmo cliente ──────────
		// Staff pode furar explicitamente (encaixe, retorno); customer, nunca.
		if (!(staff && overrideCooldown)) {
			const check = await appointmentConfigService.checkClientCooldown({
				email: data.customerEmail || null,
				phone: data.customerPhone ?? request.currentUser?.phone ?? null,
				date: data.date,
				time: data.time,
			});
			if (check.blocked && check.conflict) {
				return reply.status(409).send({
					code: 'client_cooldown',
					message: formatCooldownMessage(
						check.conflict,
						check.hours,
						staff ? 'staff' : 'customer',
					),
				});
			}
		}

		const technicianId =
			await appointmentConfigService.resolveBookingTechnician(
				data.date,
				data.time,
				data.technicianId,
			);

		const appointment = await appointmentRepository.create({
			...data,
			technicianId,
		});
		return reply.status(201).send(appointment);
	} catch (err) {
		if (err instanceof SlotUnavailableError)
			return reply.status(409).send({ message: err.message });
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message === 'Time slot already booked')
			return reply.status(409).send({ message });
		return reply.status(500).send({ message });
	}
};

export const getClientCooldownController = async (
	request: FastifyRequest<{
		Querystring: {
			email?: string;
			phone?: string;
			from?: string;
			days?: number;
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const q = clientCooldownQuerySchema.parse(request.query);

		// Customer só consulta a si mesmo: a resposta traz data e hora do último
		// atendimento, então deixar consultar e-mail alheio vazaria a agenda de
		// terceiro.
		const staff = isStaffRole(request.currentRole);
		const accountEmail = request.currentUser?.email || null;
		const email = staff ? (q.email ?? null) : accountEmail;
		const phone = staff
			? (q.phone ?? null)
			: (request.currentUser?.phone ?? null);

		const status = await appointmentConfigService.getClientCooldownStatus({
			email,
			phone,
			from: q.from,
			days: q.days,
		});
		return reply.send(status);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateAppointmentStatusController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const { status } = updateAppointmentStatusSchema.parse(request.body);
		const appointment = await appointmentRepository.updateStatus(
			request.params.id,
			status,
		);
		return reply.send(appointment);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Appointment not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const getMyAppointmentsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const appointments = await appointmentRepository.listByTechnicianEmail(
			request.currentUser.email,
		);
		return reply.send(appointments);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getAppointmentsByTechnicianController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const appointments = await appointmentRepository.listByTechnicianId(
			request.params.id,
		);
		return reply.send(appointments);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateAppointmentTechnicianController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const { technicianId, machine } = updateAppointmentTechnicianSchema.parse(
			request.body,
		);
		const appointment = await appointmentRepository.updateTechnician(
			request.params.id,
			technicianId,
			machine,
		);
		return reply.send(appointment);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Appointment not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const cancelMyAppointmentController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const email = request.currentUser.email;
		if (!email) {
			return reply.status(403).send({ message: 'Forbidden' });
		}
		const appointment = await appointmentRepository.cancelOwn(
			request.params.id,
			email,
		);
		return reply.send(appointment);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status =
			message === 'Appointment not found'
				? 404
				: message === 'Forbidden'
					? 403
					: 500;
		return reply.status(status).send({ message });
	}
};

export const deleteAppointmentController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		await appointmentRepository.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Appointment not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
