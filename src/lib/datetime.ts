// ─────────────────────────────────────────────────────────────────────
// Helpers de timezone para o horário de Brasília (UTC-3, sem DST).
// ─────────────────────────────────────────────────────────────────────

const BRT_TZ = 'America/Sao_Paulo';

/** Retorna o início do dia (00:00) no horário de Brasília como Date UTC. */
export function startOfTodayBRT(): Date {
	const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: BRT_TZ });
	const todayStr = fmt.format(new Date()); // "2026-05-08"
	return new Date(`${todayStr}T00:00:00-03:00`);
}

/** Retorna o início de amanhã (00:00) no horário de Brasília como Date UTC. */
export function startOfTomorrowBRT(): Date {
	return new Date(startOfTodayBRT().getTime() + 24 * 60 * 60 * 1000);
}
