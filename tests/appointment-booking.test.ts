import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AGENDAMENTO x FOLGA — a defesa do servidor.
 *
 * O bug: `POST /appointment` só checava double-booking, então cliente conseguia
 * agendar em dia de folga (folga global, folga do técnico) mesmo com o slot
 * escondido no front. Aqui provamos que `resolveBookingTechnician` reusa
 * `getAvailableSlots` e REJEITA (SlotUnavailableError) o que estiver bloqueado,
 * e que o auto-assign nunca escolhe um técnico de folga.
 *
 * As bordas (os dois repositórios) entram por mock; a lógica de folga/slots é a
 * REAL do serviço.
 */

type DayOff = { technicianId: string | null; date: string };

const store = {
	global: {
		id: 'g1',
		workingDays: {
			mon: true,
			tue: true,
			wed: true,
			thu: true,
			fri: true,
			sat: true,
			sun: true,
		},
		workingHourStart: '09:00',
		workingHourEnd: '12:00',
		lunchStart: null as string | null,
		lunchEnd: null as string | null,
		slotDurationMinutes: 60,
		updatedAt: '2026-01-01',
		updatedBy: null as string | null,
	},
	daysOff: [] as DayOff[],
	technicianIds: [] as string[],
};

vi.mock('@/repositories/appointment-config.js', () => ({
	appointmentConfigRepository: {
		getGlobal: () => Promise.resolve(store.global),
		listHolidays: () => Promise.resolve([]),
		listRecurringBlocks: () => Promise.resolve([]),
		getTechSchedule: () => Promise.resolve(null),
		listDaysOff: (params: { technicianId?: string; from?: string }) => {
			const inRange = (d: DayOff) => !params.from || d.date === params.from;
			if (params.technicianId) {
				return Promise.resolve(
					store.daysOff.filter(
						(d) => d.technicianId === params.technicianId && inRange(d),
					),
				);
			}
			// sem técnico → todas as folgas da data (o serviço filtra as globais)
			return Promise.resolve(store.daysOff.filter(inRange));
		},
	},
}));

vi.mock('@/repositories/appointment.js', () => ({
	appointmentRepository: {
		listTechnicianIds: () => Promise.resolve(store.technicianIds),
		listByDate: () => Promise.resolve([]),
	},
}));

const { appointmentConfigService, SlotUnavailableError } = await import(
	'@/services/appointment-config.js'
);

const DATE = '2026-08-27';
const TIME = '10:00';
const TECH_A = '11111111-1111-1111-1111-111111111111';
const TECH_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
	store.daysOff = [];
	store.technicianIds = [];
});

describe('resolveBookingTechnician — folga bloqueia agendamento', () => {
	it('folga global rejeita mesmo com técnico informado', async () => {
		store.daysOff = [{ technicianId: null, date: DATE }];
		await expect(
			appointmentConfigService.resolveBookingTechnician(DATE, TIME, TECH_A),
		).rejects.toBeInstanceOf(SlotUnavailableError);
	});

	it('folga do técnico informado rejeita', async () => {
		store.daysOff = [{ technicianId: TECH_A, date: DATE }];
		await expect(
			appointmentConfigService.resolveBookingTechnician(DATE, TIME, TECH_A),
		).rejects.toBeInstanceOf(SlotUnavailableError);
	});

	it('auto-assign nunca cai num técnico de folga', async () => {
		store.technicianIds = [TECH_A, TECH_B];
		store.daysOff = [{ technicianId: TECH_A, date: DATE }];
		for (let i = 0; i < 20; i++) {
			const chosen = await appointmentConfigService.resolveBookingTechnician(
				DATE,
				TIME,
			);
			expect(chosen).toBe(TECH_B);
		}
	});

	it('auto-assign rejeita quando todos os técnicos estão de folga', async () => {
		store.technicianIds = [TECH_A, TECH_B];
		store.daysOff = [
			{ technicianId: TECH_A, date: DATE },
			{ technicianId: TECH_B, date: DATE },
		];
		await expect(
			appointmentConfigService.resolveBookingTechnician(DATE, TIME),
		).rejects.toBeInstanceOf(SlotUnavailableError);
	});

	it('dia/hora válidos resolvem o técnico informado', async () => {
		const chosen = await appointmentConfigService.resolveBookingTechnician(
			DATE,
			TIME,
			TECH_A,
		);
		expect(chosen).toBe(TECH_A);
	});

	it('rejeita horário fora do expediente (fora dos slots gerados)', async () => {
		await expect(
			appointmentConfigService.resolveBookingTechnician(DATE, '20:00', TECH_A),
		).rejects.toBeInstanceOf(SlotUnavailableError);
	});
});
