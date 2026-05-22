import { supabase } from '../lib/supabase.js';
import type {
	CreateDayOff,
	CreateHoliday,
	DayOff,
	GlobalConfig,
	Holiday,
	TechnicianSchedule,
	UpdateGlobalConfig,
	UpsertTechnicianSchedule,
} from '../types/appointment-config.js';

class AppointmentConfigRepository {
	// ── Global config (singleton) ─────────────────────────────────────

	async getGlobal(): Promise<GlobalConfig> {
		const { data, error } = await supabase
			.from('pl_appointment_settings_global')
			.select('*')
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Global config not seeded');
		return data as GlobalConfig;
	}

	async updateGlobal(
		patch: UpdateGlobalConfig,
		updatedBy: string,
	): Promise<GlobalConfig> {
		const existing = await this.getGlobal();
		const { data, error } = await supabase
			.from('pl_appointment_settings_global')
			.update({
				...patch,
				updatedAt: new Date().toISOString(),
				updatedBy,
			})
			.eq('id', existing.id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as GlobalConfig;
	}

	// ── Holidays ──────────────────────────────────────────────────────

	async listHolidays(): Promise<Holiday[]> {
		const { data, error } = await supabase
			.from('pl_appointment_holiday')
			.select('*')
			.order('date', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as Holiday[];
	}

	async addHoliday(data: CreateHoliday, createdBy: string): Promise<Holiday> {
		const { data: row, error } = await supabase
			.from('pl_appointment_holiday')
			.insert({
				date: data.date,
				label: data.label,
				recurringYearly: data.recurringYearly ?? false,
				createdBy,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row as Holiday;
	}

	async deleteHoliday(id: string): Promise<void> {
		const { error } = await supabase
			.from('pl_appointment_holiday')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ── Days off ──────────────────────────────────────────────────────

	async listDaysOff(params: {
		technicianId?: string;
		from?: string;
		to?: string;
	}): Promise<DayOff[]> {
		let query = supabase
			.from('pl_appointment_day_off')
			.select('*')
			.order('date', { ascending: true });
		if (params.technicianId) {
			query = query.eq('technicianId', params.technicianId);
		}
		if (params.from) query = query.gte('date', params.from);
		if (params.to) query = query.lte('date', params.to);
		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return (data ?? []) as DayOff[];
	}

	async addDayOff(data: CreateDayOff, createdBy: string): Promise<DayOff> {
		const { data: row, error } = await supabase
			.from('pl_appointment_day_off')
			.insert({
				technicianId: data.technicianId ?? null,
				date: data.date,
				reason: data.reason ?? null,
				createdBy,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row as DayOff;
	}

	async deleteDayOff(id: string): Promise<void> {
		const { error } = await supabase
			.from('pl_appointment_day_off')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ── Technician schedule overrides ─────────────────────────────────

	async getTechSchedule(
		technicianId: string,
	): Promise<TechnicianSchedule | null> {
		const { data, error } = await supabase
			.from('pl_appointment_technician_schedule')
			.select('*')
			.eq('technicianId', technicianId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as TechnicianSchedule | null) ?? null;
	}

	async upsertTechSchedule(
		technicianId: string,
		patch: UpsertTechnicianSchedule,
	): Promise<TechnicianSchedule> {
		const { data, error } = await supabase
			.from('pl_appointment_technician_schedule')
			.upsert(
				{
					technicianId,
					...patch,
					updatedAt: new Date().toISOString(),
				},
				{ onConflict: 'technicianId' },
			)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as TechnicianSchedule;
	}

	async listAllTechSchedules(): Promise<TechnicianSchedule[]> {
		const { data, error } = await supabase
			.from('pl_appointment_technician_schedule')
			.select('*');
		if (error) throw new Error(error.message);
		return (data ?? []) as TechnicianSchedule[];
	}
}

export const appointmentConfigRepository = new AppointmentConfigRepository();
