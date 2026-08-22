// ─────────────────────────────────────────────────────────────────────────
// Intervalo mínimo entre atendimentos do MESMO cliente ("cooldown").
//
// Módulo puro: sem Supabase e sem relógio. Só aritmética de calendário, pra
// poder ser testado direto (mesmo padrão de `src/lib/license-code.ts`).
// ─────────────────────────────────────────────────────────────────────────

export interface CooldownAppointment {
	id: string;
	customerEmail: string | null;
	customerPhone: string | null;
	date: string; // YYYY-MM-DD
	time: string; // HH:MM
	service?: string | null;
}

export interface CooldownIdentity {
	email: string | null;
	phone: string | null;
}

/**
 * "YYYY-MM-DD" + "HH:MM" → minutos absolutos de CALENDÁRIO.
 *
 * `Date.UTC` aqui é calculadora de calendário, não fuso: é pura, não lê o TZ do
 * processo. Como os dois lados da subtração passam pela mesma função, a
 * diferença é o intervalo de HORAS DE PAREDE — igual no container UTC e na
 * máquina do dev, e imune a horário de verão.
 *
 * PREMISSA: `date`/`time` de `pl_appointment` são hora local do estúdio. O
 * Brasil não tem DST desde 2019; se voltar, 48h de parede podem valer 47h ou
 * 49h reais — irrelevante pra uma regra de espaçamento.
 */
export function toCalendarMinutes(date: string, time: string): number {
	const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
	const [hh, mm] = time.split(':').map((n) => Number.parseInt(n, 10));
	return Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 60_000);
}

export function fromCalendarMinutes(min: number): {
	date: string;
	time: string;
} {
	const iso = new Date(min * 60_000).toISOString();
	return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Soma dias a uma data YYYY-MM-DD sem tocar em fuso. */
export function addDays(date: string, days: number): string {
	return fromCalendarMinutes(toCalendarMinutes(date, '00:00') + days * 1440)
		.date;
}

export function normalizeEmail(email: string | null | undefined): string {
	return (email ?? '').trim().toLowerCase();
}

/**
 * Telefone → só dígitos, últimos 11 (descarta DDI: "+55 11 98765-4321" e
 * "11987654321" batem). Devolve '' com menos de 10 dígitos: telefone vazio,
 * curto ou lixo NUNCA pode casar com o de outro cliente.
 */
export function normalizePhone(phone: string | null | undefined): string {
	const digits = (phone ?? '').replace(/\D/g, '');
	return digits.length < 10 ? '' : digits.slice(-11);
}

/** Mesmo cliente? E-mail (case-insensitive) sempre; telefone só se `matchPhone`. */
export function matchesClient(
	apt: CooldownAppointment,
	who: CooldownIdentity,
	matchPhone: boolean,
): boolean {
	const email = normalizeEmail(who.email);
	if (email !== '' && normalizeEmail(apt.customerEmail) === email) return true;
	if (!matchPhone) return false;
	const phone = normalizePhone(who.phone);
	return phone !== '' && normalizePhone(apt.customerPhone) === phone;
}

export interface CooldownConflict {
	appointment: CooldownAppointment;
	/** Primeiro instante livre depois do atendimento que mais empurra. */
	nextAllowedDate: string;
	nextAllowedTime: string;
}

/**
 * A data/hora candidata cai na janela de algum atendimento do cliente?
 *
 * Janela ABERTA (A − H, A + H): exatamente H horas de intervalo é PERMITIDO.
 *
 * ISENÇÃO DO MESMO DIA: atendimentos na MESMA data nunca conflitam entre si. A
 * regra é sobre VISITAS SEPARADAS (o cliente que reserva seg+ter+qua+qui); dois
 * horários no mesmo dia são UMA sessão — e é assim que o painel marca 3 horas
 * seguidas pro mesmo cliente. Colisão de slot idêntico já é barrada em
 * `appointmentRepository.create` ('Time slot already booked').
 */
export function findCooldownConflict(
	candidate: { date: string; time: string },
	existing: CooldownAppointment[],
	hours: number,
): CooldownConflict | null {
	const limit = hours * 60;
	const at = toCalendarMinutes(candidate.date, candidate.time);
	let worst: CooldownAppointment | null = null;
	let worstEnd = Number.NEGATIVE_INFINITY;

	for (const apt of existing) {
		if (apt.date === candidate.date) continue; // isenção do mesmo dia
		const other = toCalendarMinutes(apt.date, apt.time);
		if (Math.abs(at - other) >= limit) continue;
		// Primeiro instante liberado depois DESTE atendimento.
		const end = other + limit;
		if (end > worstEnd) {
			worstEnd = end;
			worst = apt;
		}
	}

	if (!worst) return null;
	const next = fromCalendarMinutes(worstEnd);
	return {
		appointment: worst,
		nextAllowedDate: next.date,
		nextAllowedTime: next.time,
	};
}

/**
 * O dia INTEIRO está bloqueado? (pro banner e pro `min` do input de data)
 *
 * Só devolve true quando 00:00 E 23:59 caem na janela do MESMO atendimento —
 * com hours >= 24 a janela tem 2H >= 48h, então cabe um dia inteiro. Com
 * hours < 24 o dia é PARCIAL e devolvemos false de propósito: aí quem decide é
 * o seletor de horários (que já recebe a lista filtrada) e o POST.
 */
export function isDayFullyBlocked(
	date: string,
	existing: CooldownAppointment[],
	hours: number,
): boolean {
	const limit = hours * 60;
	const start = toCalendarMinutes(date, '00:00');
	const end = toCalendarMinutes(date, '23:59');
	return existing.some((apt) => {
		if (apt.date === date) return false;
		const other = toCalendarMinutes(apt.date, apt.time);
		return Math.abs(start - other) < limit && Math.abs(end - other) < limit;
	});
}

/** "2026-08-24" → "24/08". Puro, sem Intl (que arrastaria fuso pra cá). */
export function toBrDate(date: string): string {
	return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function formatCooldownMessage(
	conflict: CooldownConflict,
	hours: number,
	voice: 'customer' | 'staff',
): string {
	const who = voice === 'staff' ? 'Este cliente já tem' : 'Você já tem';
	return (
		`${who} um atendimento em ${toBrDate(conflict.appointment.date)} às ` +
		`${conflict.appointment.time}. Só é possível marcar outro a partir de ` +
		`${toBrDate(conflict.nextAllowedDate)} às ${conflict.nextAllowedTime} ` +
		`(intervalo mínimo de ${hours}h entre atendimentos).`
	);
}
