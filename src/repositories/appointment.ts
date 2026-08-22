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

	/**
	 * Atendimentos ATIVOS (não cancelados) numa janela de datas.
	 *
	 * O recorte por cliente NÃO vai no SQL de propósito: e-mail é
	 * case-insensitive e telefone precisa de normalização de dígitos — nada
	 * disso usaria índice. A janela é de poucos dias, então filtrar em memória
	 * (com `matchesClient`) sai mais barato e mais correto.
	 */
	async listActiveBetween(from: string, to: string) {
		const { data, error } = await supabase
			.from('pl_appointment')
			.select('id, customerEmail, customerPhone, date, time, service')
			.gte('date', from)
			.lte('date', to)
			.neq('status', 'cancelado')
			.order('date', { ascending: true })
			.order('time', { ascending: true });

		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async create(data: Omit<AppointmentCreate, 'overrideCooldown'>) {
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

	async cancelOwn(id: string, email: string) {
		const { data: existing, error: findError } = await supabase
			.from('pl_appointment')
			.select('id, customerEmail')
			.eq('id', id)
			.maybeSingle();

		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Appointment not found');
		if (existing.customerEmail !== email) throw new Error('Forbidden');

		const { data, error } = await supabase
			.from('pl_appointment')
			.update({ status: 'cancelado' })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
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

	/**
	 * Busca agendamentos do técnico autenticado via email.
	 * Necessário porque pl_appointment.technicianId armazena o Users.id legado,
	 * mas request.currentUser.id após a migração upvox é o id do upvox (diferente).
	 * A ponte é o email, que é igual nos dois sistemas.
	 */
	async listByTechnicianEmail(email: string) {
		const { data: user } = await supabase
			.from('Users')
			.select('id')
			.eq('email', email)
			.maybeSingle();

		if (!user) return [];
		return this.listByTechnicianId(user.id);
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

	async listTechnicianIds(): Promise<string[]> {
		const { data, error } = await supabase
			.from('Users')
			.select('id')
			.in('role', ['tecnico', 'colaborador']);
		if (error) throw new Error(error.message);
		return (data ?? []).map((u) => u.id);
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
