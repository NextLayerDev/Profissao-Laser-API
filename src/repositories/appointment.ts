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

	async create(data: AppointmentCreate) {
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
