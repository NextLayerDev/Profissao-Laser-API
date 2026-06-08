import { appointmentRepository } from '../repositories/appointment.js';
import { appointmentConfigRepository } from '../repositories/appointment-config.js';
import type {
	AvailableSlotsResponse,
	CreateDayOff,
	CreateHoliday,
	GlobalConfig,
	UpdateGlobalConfig,
	UpsertTechnicianSchedule,
	WorkingDays,
} from '../types/appointment-config.js';

// ─── Helpers ────────────────────────────────────────────────────────────

const DAY_KEYS: (keyof WorkingDays)[] = [
	'sun',
	'mon',
	'tue',
	'wed',
	'thu',
	'fri',
	'sat',
];

function timeToMinutes(time: string): number {
	const [h, m] = time.split(':').map((n) => Number.parseInt(n, 10));
	return h * 60 + m;
}

function minutesToTime(min: number): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isMonthDay(dateA: string, dateB: string): boolean {
	// dateA = "YYYY-MM-DD", dateB = "YYYY-MM-DD" — compara só mês+dia (pra
	// feriados recorrentes anuais)
	return dateA.slice(5) === dateB.slice(5);
}

/**
 * Config efetiva (merge) para um técnico — usa override do técnico onde existir,
 * senão usa o global.
 */
interface ResolvedSchedule {
	workingDays: WorkingDays;
	workingHourStart: string;
	workingHourEnd: string;
	lunchStart: string | null;
	lunchEnd: string | null;
	slotDurationMinutes: number;
}

async function resolveScheduleFor(
	global: GlobalConfig,
	technicianId: string | null,
): Promise<ResolvedSchedule> {
	if (!technicianId) {
		return {
			workingDays: global.workingDays,
			workingHourStart: global.workingHourStart,
			workingHourEnd: global.workingHourEnd,
			lunchStart: global.lunchStart,
			lunchEnd: global.lunchEnd,
			slotDurationMinutes: global.slotDurationMinutes,
		};
	}
	const override =
		await appointmentConfigRepository.getTechSchedule(technicianId);
	if (!override) {
		return {
			workingDays: global.workingDays,
			workingHourStart: global.workingHourStart,
			workingHourEnd: global.workingHourEnd,
			lunchStart: global.lunchStart,
			lunchEnd: global.lunchEnd,
			slotDurationMinutes: global.slotDurationMinutes,
		};
	}
	return {
		workingDays: override.workingDays ?? global.workingDays,
		workingHourStart: override.workingHourStart ?? global.workingHourStart,
		workingHourEnd: override.workingHourEnd ?? global.workingHourEnd,
		lunchStart:
			override.lunchStart !== null && override.lunchStart !== undefined
				? override.lunchStart
				: global.lunchStart,
		lunchEnd:
			override.lunchEnd !== null && override.lunchEnd !== undefined
				? override.lunchEnd
				: global.lunchEnd,
		slotDurationMinutes: global.slotDurationMinutes,
	};
}

function generateSlots(schedule: ResolvedSchedule): string[] {
	const start = timeToMinutes(schedule.workingHourStart);
	const end = timeToMinutes(schedule.workingHourEnd);
	const lunchStart =
		schedule.lunchStart !== null ? timeToMinutes(schedule.lunchStart) : null;
	const lunchEnd =
		schedule.lunchEnd !== null ? timeToMinutes(schedule.lunchEnd) : null;

	const slots: string[] = [];
	for (let m = start; m < end; m += schedule.slotDurationMinutes) {
		// Bloqueia almoço (slot que inicia dentro da janela do almoço)
		if (lunchStart !== null && lunchEnd !== null) {
			if (m >= lunchStart && m < lunchEnd) continue;
		}
		slots.push(minutesToTime(m));
	}
	return slots;
}

function dayOfWeek(date: string): keyof WorkingDays {
	// date YYYY-MM-DD → parse local (no timezone offset) e pega dia da semana.
	const d = new Date(`${date}T12:00:00`);
	return DAY_KEYS[d.getDay()];
}

// ─── Service ─────────────────────────────────────────────────────────────

class AppointmentConfigService {
	getGlobal() {
		return appointmentConfigRepository.getGlobal();
	}

	updateGlobal(patch: UpdateGlobalConfig, updatedBy: string) {
		return appointmentConfigRepository.updateGlobal(patch, updatedBy);
	}

	listHolidays() {
		return appointmentConfigRepository.listHolidays();
	}

	addHoliday(data: CreateHoliday, createdBy: string) {
		return appointmentConfigRepository.addHoliday(data, createdBy);
	}

	deleteHoliday(id: string) {
		return appointmentConfigRepository.deleteHoliday(id);
	}

	listDaysOff(params: { technicianId?: string; from?: string; to?: string }) {
		return appointmentConfigRepository.listDaysOff(params);
	}

	addDayOff(data: CreateDayOff, createdBy: string) {
		return appointmentConfigRepository.addDayOff(data, createdBy);
	}

	deleteDayOff(id: string) {
		return appointmentConfigRepository.deleteDayOff(id);
	}

	getTechSchedule(technicianId: string) {
		return appointmentConfigRepository.getTechSchedule(technicianId);
	}

	upsertTechSchedule(technicianId: string, patch: UpsertTechnicianSchedule) {
		return appointmentConfigRepository.upsertTechSchedule(technicianId, patch);
	}

	/**
	 * Gera os slots disponíveis para uma data, opcionalmente filtrando por técnico.
	 * Aplica feriados, folgas, working days, working hours e almoço.
	 *
	 * Sem technicianId: union dos slots livres em pelo menos 1 técnico.
	 * Com technicianId: slots livres para esse técnico específico.
	 */
	async getAvailableSlots(
		date: string,
		technicianId?: string,
	): Promise<AvailableSlotsResponse> {
		const global = await this.getGlobal();

		// 1. Feriado bloqueia tudo
		const holidays = await this.listHolidays();
		const holiday = holidays.find(
			(h) => h.date === date || (h.recurringYearly && isMonthDay(h.date, date)),
		);
		if (holiday) {
			return { slots: [], blocked: true, reason: `Feriado: ${holiday.label}` };
		}

		// 2. Folga global bloqueia tudo
		const globalDaysOff = await appointmentConfigRepository.listDaysOff({
			from: date,
			to: date,
		});
		const globalOff = globalDaysOff.find(
			(d) => d.date === date && d.technicianId === null,
		);
		if (globalOff) {
			return {
				slots: [],
				blocked: true,
				reason: globalOff.reason ?? 'Studio fechado',
			};
		}

		// 3. Determina técnicos elegíveis
		const techIds = technicianId
			? [technicianId]
			: await appointmentRepository.listTechnicianIds();

		// Se não há técnicos cadastrados, usa config global "anônima".
		const effectiveTechIds =
			techIds.length === 0 ? [null] : (techIds as Array<string | null>);

		// 4. Pra cada técnico, gera slots respeitando folga + working day + horário
		const dow = dayOfWeek(date);
		const slotsByTech = await Promise.all(
			effectiveTechIds.map(async (tId) => {
				// folga do técnico bloqueia tudo
				if (tId) {
					const techOff = await appointmentConfigRepository.listDaysOff({
						technicianId: tId,
						from: date,
						to: date,
					});
					if (techOff.some((d) => d.date === date)) {
						return [];
					}
				}

				const schedule = await resolveScheduleFor(global, tId);

				// Working day desligado pro técnico → sem slots
				if (!schedule.workingDays[dow]) {
					return [];
				}

				const allSlots = generateSlots(schedule);

				// Remove slots já bookados pra esse técnico
				if (tId) {
					const booked = await appointmentRepository.listByDate(date, tId);
					const bookedTimes = new Set(booked.map((a) => a.time));
					return allSlots.filter((s) => !bookedTimes.has(s));
				}
				return allSlots;
			}),
		);

		// 5. Union: slot disponível se PELO MENOS 1 técnico está livre nele
		const availableSet = new Set<string>();
		for (const arr of slotsByTech) {
			for (const s of arr) availableSet.add(s);
		}
		const slots = Array.from(availableSet).sort();

		if (slots.length === 0) {
			// Tudo bloqueado por configuração (working day off / horário fora /
			// todos os técnicos de folga)
			return {
				slots: [],
				blocked: true,
				reason: technicianId
					? 'Técnico não disponível neste dia'
					: 'Sem horários disponíveis neste dia',
			};
		}

		return { slots, blocked: false, reason: null };
	}
}

export const appointmentConfigService = new AppointmentConfigService();
