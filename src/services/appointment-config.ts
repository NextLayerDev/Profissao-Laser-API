import {
	addDays,
	type CooldownAppointment,
	type CooldownConflict,
	type CooldownIdentity,
	findCooldownConflict,
	formatCooldownMessage,
	isDayFullyBlocked,
	matchesClient,
} from '../lib/appointment-cooldown.js';
import { todayBRT } from '../lib/datetime.js';
import { appointmentRepository } from '../repositories/appointment.js';
import { appointmentConfigRepository } from '../repositories/appointment-config.js';
import type {
	AvailableSlotsResponse,
	CreateDayOff,
	CreateHoliday,
	CreateRecurringBlock,
	GlobalConfig,
	UpdateGlobalConfig,
	UpsertTechnicianSchedule,
	WorkingDays,
} from '../types/appointment-config.js';

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * O intervalo mínimo conta atendimentos JÁ PASSADOS?
 *
 * Hoje NÃO: a regra existe pra impedir RESERVA em série (o cliente que pega
 * seg+ter+qua+qui de uma vez), não pra afastar quem já foi atendido. Quem veio
 * ontem pode voltar hoje. Vira `true` numa linha se o estúdio quiser o
 * comportamento de "X horas desde a última visita".
 */
const COOLDOWN_COUNTS_PAST = false;

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

/** true se o horário HH:MM cai em alguma das faixas [start, end). */
function inAnyRange(
	time: string,
	ranges: { start: string; end: string }[],
): boolean {
	const t = timeToMinutes(time);
	return ranges.some(
		(r) => t >= timeToMinutes(r.start) && t < timeToMinutes(r.end),
	);
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

	listRecurringBlocks(params: { technicianId?: string; weekday?: string }) {
		return appointmentConfigRepository.listRecurringBlocks(params);
	}

	addRecurringBlock(data: CreateRecurringBlock, createdBy: string) {
		return appointmentConfigRepository.addRecurringBlock(data, createdBy);
	}

	deleteRecurringBlock(id: string) {
		return appointmentConfigRepository.deleteRecurringBlock(id);
	}

	getTechSchedule(technicianId: string) {
		return appointmentConfigRepository.getTechSchedule(technicianId);
	}

	upsertTechSchedule(technicianId: string, patch: UpsertTechnicianSchedule) {
		return appointmentConfigRepository.upsertTechSchedule(technicianId, patch);
	}

	// ─── Intervalo mínimo entre atendimentos do mesmo cliente ───────────

	/** Config do intervalo com defaults — tolera linha antiga sem as colunas. */
	private cooldownSettings(global: GlobalConfig) {
		return {
			enabled: global.clientCooldownEnabled ?? false,
			hours: global.clientCooldownHours ?? 48,
			matchPhone: global.clientCooldownMatchPhone ?? true,
		};
	}

	/** Atendimentos ativos DO CLIENTE na janela [from, to]. */
	private async clientAppointmentsBetween(
		who: CooldownIdentity,
		from: string,
		to: string,
		matchPhone: boolean,
	): Promise<CooldownAppointment[]> {
		const rows = (await appointmentRepository.listActiveBetween(
			from,
			to,
		)) as CooldownAppointment[];
		const today = todayBRT();
		return rows.filter(
			(r) =>
				(COOLDOWN_COUNTS_PAST || r.date >= today) &&
				matchesClient(r, who, matchPhone),
		);
	}

	/**
	 * O cliente pode marcar em `date` às `time`? Fonte de verdade do POST.
	 * Desligado (ou sem cliente identificável) → nunca bloqueia.
	 */
	async checkClientCooldown(input: {
		email: string | null;
		phone: string | null;
		date: string;
		time: string;
	}): Promise<{
		blocked: boolean;
		hours: number;
		conflict: CooldownConflict | null;
	}> {
		const global = await this.getGlobal();
		const { enabled, hours, matchPhone } = this.cooldownSettings(global);
		if (!enabled) return { blocked: false, hours, conflict: null };

		const span = Math.ceil(hours / 24);
		const mine = await this.clientAppointmentsBetween(
			input,
			addDays(input.date, -span),
			addDays(input.date, span),
			matchPhone,
		);
		const conflict = findCooldownConflict(input, mine, hours);
		return { blocked: conflict !== null, hours, conflict };
	}

	/**
	 * Situação do intervalo pro cliente numa faixa de dias — só pra UI (banner
	 * e trava do input de data). A regra continua sendo aplicada no POST.
	 */
	async getClientCooldownStatus(input: {
		email: string | null;
		phone: string | null;
		from?: string;
		days?: number;
	}) {
		const global = await this.getGlobal();
		const { enabled, hours, matchPhone } = this.cooldownSettings(global);
		const from = input.from ?? todayBRT();
		const days = input.days ?? 60;

		if (!enabled) {
			return {
				enabled,
				hours,
				matchPhone,
				blocked: false,
				nextAllowedDate: null,
				blockedDates: [],
				lastAppointment: null,
			};
		}

		// Busca um pouco além da faixa: um atendimento logo depois do fim ainda
		// bloqueia dias DENTRO dela.
		const span = Math.ceil(hours / 24);
		const mine = await this.clientAppointmentsBetween(
			input,
			addDays(from, -span),
			addDays(from, days + span),
			matchPhone,
		);

		const blockedDates: string[] = [];
		let nextAllowedDate: string | null = null;
		for (let i = 0; i <= days; i++) {
			const d = addDays(from, i);
			if (isDayFullyBlocked(d, mine, hours)) blockedDates.push(d);
			else if (nextAllowedDate === null) nextAllowedDate = d;
		}

		const last = mine.length > 0 ? mine[mine.length - 1] : null;
		return {
			enabled,
			hours,
			matchPhone,
			blocked: blockedDates.includes(from),
			nextAllowedDate,
			blockedDates,
			lastAppointment: last
				? {
						id: last.id,
						date: last.date,
						time: last.time,
						service: last.service ?? null,
					}
				: null,
		};
	}

	/**
	 * Gera os slots disponíveis para uma data, opcionalmente filtrando por técnico.
	 * Aplica feriados, folgas, working days, working hours e almoço.
	 *
	 * Sem technicianId: union dos slots livres em pelo menos 1 técnico.
	 * Com technicianId: slots livres para esse técnico específico.
	 *
	 * Com `client`, também aplica o intervalo mínimo entre atendimentos daquele
	 * cliente. O painel NÃO passa cliente (vê a agenda inteira e recebe o aviso
	 * na tela de criação, com opção de furar).
	 */
	async getAvailableSlots(
		date: string,
		technicianId?: string,
		client?: CooldownIdentity,
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

		// 2b. Bloqueio recorrente (toda <weekday>): global de dia inteiro fecha tudo;
		//     faixas globais são removidas dos slots de todos os técnicos abaixo.
		const dow = dayOfWeek(date);
		const recurringBlocks =
			await appointmentConfigRepository.listRecurringBlocks({ weekday: dow });
		const globalRecurring = recurringBlocks.filter(
			(b) => b.technicianId === null,
		);
		const globalWholeDay = globalRecurring.find(
			(b) => !b.startTime || !b.endTime,
		);
		if (globalWholeDay) {
			return {
				slots: [],
				blocked: true,
				reason: globalWholeDay.reason ?? 'Fechado neste dia da semana',
			};
		}
		const globalRanges = globalRecurring
			.filter((b) => b.startTime && b.endTime)
			.map((b) => ({ start: b.startTime as string, end: b.endTime as string }));

		// 3. Determina técnicos elegíveis
		const techIds = technicianId
			? [technicianId]
			: await appointmentRepository.listTechnicianIds();

		// Se não há técnicos cadastrados, usa config global "anônima".
		const effectiveTechIds =
			techIds.length === 0 ? [null] : (techIds as Array<string | null>);

		// 4. Pra cada técnico, gera slots respeitando folga + working day + horário
		//    + bloqueios recorrentes (faixa global e/ou do próprio técnico).
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
					// bloqueio recorrente do técnico de DIA INTEIRO
					const techWholeDay = recurringBlocks.some(
						(b) => b.technicianId === tId && (!b.startTime || !b.endTime),
					);
					if (techWholeDay) return [];
				}

				const schedule = await resolveScheduleFor(global, tId);

				// Working day desligado pro técnico → sem slots
				if (!schedule.workingDays[dow]) {
					return [];
				}

				// Faixas recorrentes do próprio técnico (globais já estão em globalRanges).
				const techRanges = tId
					? recurringBlocks
							.filter((b) => b.technicianId === tId && b.startTime && b.endTime)
							.map((b) => ({
								start: b.startTime as string,
								end: b.endTime as string,
							}))
					: [];

				let allSlots = generateSlots(schedule).filter(
					(s) => !inAnyRange(s, globalRanges) && !inAnyRange(s, techRanges),
				);

				// Remove slots já bookados pra esse técnico
				if (tId) {
					const booked = await appointmentRepository.listByDate(date, tId);
					const bookedTimes = new Set(booked.map((a) => a.time));
					allSlots = allSlots.filter((s) => !bookedTimes.has(s));
				}
				return allSlots;
			}),
		);

		// 5. Union: slot disponível se PELO MENOS 1 técnico está livre nele
		const availableSet = new Set<string>();
		for (const arr of slotsByTech) {
			for (const s of arr) availableSet.add(s);
		}
		let slots = Array.from(availableSet).sort();

		// 6. Intervalo mínimo entre atendimentos do mesmo cliente. Roda por
		//    último de propósito: feriado / folga / expediente são fatos DO DIA
		//    e devem vencer na explicação; o intervalo é um fato DO CLIENTE.
		if (client) {
			const { enabled, hours, matchPhone } = this.cooldownSettings(global);
			if (enabled) {
				const span = Math.ceil(hours / 24);
				const mine = await this.clientAppointmentsBetween(
					client,
					addDays(date, -span),
					addDays(date, span),
					matchPhone,
				);
				const conflicts: CooldownConflict[] = [];
				const allowed = slots.filter((time) => {
					const hit = findCooldownConflict({ date, time }, mine, hours);
					if (hit) conflicts.push(hit);
					return !hit;
				});

				if (allowed.length === 0 && conflicts.length > 0) {
					// Cita o atendimento que empurra mais longe — é a informação
					// que o cliente precisa pra escolher outra data de primeira.
					const worst = conflicts.reduce((a, b) =>
						`${b.nextAllowedDate}${b.nextAllowedTime}` >
						`${a.nextAllowedDate}${a.nextAllowedTime}`
							? b
							: a,
					);
					return {
						slots: [],
						blocked: true,
						reason: formatCooldownMessage(worst, hours, 'customer'),
					};
				}
				slots = allowed;
			}
		}

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
