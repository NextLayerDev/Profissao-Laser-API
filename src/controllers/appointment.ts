import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { appointmentRepository } from '../repositories/appointment.js';
import {
	createAppointmentSchema,
	updateAppointmentStatusSchema,
	updateAppointmentTechnicianSchema,
} from '../types/appointment.js';

export const getAppointmentsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { data: staffUser } = await supabase
			.from('Users')
			.select('id')
			.eq('id', request.currentUser.id)
			.maybeSingle();

		if (staffUser) {
			const appointments = await appointmentRepository.listAll();
			return reply.send(appointments);
		}

		const email = request.currentUser.email;
		const appointments = await appointmentRepository.listByEmail(email!);
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
		const { data: staffUser } = await supabase
			.from('Users')
			.select('id')
			.eq('id', request.currentUser.id)
			.maybeSingle();

		if (!staffUser) {
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

export const createAppointmentController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createAppointmentSchema.parse(request.body);
		const appointment = await appointmentRepository.create(data);
		return reply.status(201).send(appointment);
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
		const { data: staffUser } = await supabase
			.from('Users')
			.select('id')
			.eq('id', request.currentUser.id)
			.maybeSingle();

		if (!staffUser) {
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
		const { data: staffUser } = await supabase
			.from('Users')
			.select('id')
			.eq('id', request.currentUser.id)
			.maybeSingle();

		if (!staffUser) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const appointments = await appointmentRepository.listByTechnicianId(
			request.currentUser.id,
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
		const { data: staffUser } = await supabase
			.from('Users')
			.select('id')
			.eq('id', request.currentUser.id)
			.maybeSingle();

		if (!staffUser) {
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
		const { data: staffUser } = await supabase
			.from('Users')
			.select('id')
			.eq('id', request.currentUser.id)
			.maybeSingle();

		if (!staffUser) {
			return reply.status(403).send({ message: 'Forbidden' });
		}

		const { technicianId } = updateAppointmentTechnicianSchema.parse(
			request.body,
		);
		const appointment = await appointmentRepository.updateTechnician(
			request.params.id,
			technicianId,
		);
		return reply.send(appointment);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Appointment not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteAppointmentController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { data: staffUser } = await supabase
			.from('Users')
			.select('id')
			.eq('id', request.currentUser.id)
			.maybeSingle();

		if (!staffUser) {
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
