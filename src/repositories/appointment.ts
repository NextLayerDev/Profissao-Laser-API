import { supabase } from '../lib/supabase.js';
import type {
	AppointmentCreate,
	AppointmentStatusUpdate,
} from '../types/appointment.js';

class AppointmentRepository {
	async listAll() {
		const { data, error } = await supabase
			.from('pl_appointment')
			.select('*')
			.order('createdAt', { ascending: false });

		if (error) throw new Error(error.message);
		return data;
	}

	async listByEmail(email: string) {
		const { data, error } = await supabase
			.from('pl_appointment')
			.select('*')
			.eq('customerEmail', email)
			.order('createdAt', { ascending: false });

		if (error) throw new Error(error.message);
		return data;
	}

	async listByDate(date: string, technicianId?: string) {
		let query = supabase
			.from('pl_appointment')
			.select('time')
			.eq('date', date)
			.neq('status', 'cancelado');

		if (technicianId) {
			query = query.eq('technicianId', technicianId);
		}

		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return data;
	}

	async create(data: AppointmentCreate) {
		const existing = await this.listByDate(data.date, data.technicianId);
		const conflict = existing.some((a) => a.time === data.time);
		if (conflict) throw new Error('Time slot already booked');

		const { data: appointment, error } = await supabase
			.from('pl_appointment')
			.insert({
				id: crypto.randomUUID(),
				...data,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return appointment;
	}

	async updateStatus(id: string, status: AppointmentStatusUpdate['status']) {
		const { data, error } = await supabase
			.from('pl_appointment')
			.update({ status })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		if (!data) throw new Error('Appointment not found');
		return data;
	}

	async listByCustomerId(customerId: string) {
		const { data: authUser, error: authError } =
			await supabase.auth.admin.getUserById(customerId);

		if (authError || !authUser?.user?.email)
			throw new Error('Customer not found');

		return this.listByEmail(authUser.user.email);
	}

	async listByTechnicianId(technicianId: string) {
		const { data, error } = await supabase
			.from('pl_appointment')
			.select('*')
			.eq('technicianId', technicianId)
			.order('createdAt', { ascending: false });

		if (error) throw new Error(error.message);
		return data;
	}

	async updateTechnician(id: string, technicianId: string, machine?: string) {
		const updates: Record<string, unknown> = { technicianId };
		if (machine !== undefined) updates.machine = machine;

		const { data, error } = await supabase
			.from('pl_appointment')
			.update(updates)
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		if (!data) throw new Error('Appointment not found');
		return data;
	}

	async delete(id: string) {
		const { data: existing, error: findError } = await supabase
			.from('pl_appointment')
			.select('id')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('Appointment not found');

		const { error } = await supabase
			.from('pl_appointment')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}
}

export const appointmentRepository = new AppointmentRepository();
