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

/** Retorna a data de hoje no formato YYYY-MM-DD no horário de Brasília. */
export function todayBRT(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: BRT_TZ }).format(
		new Date(),
	);
}

/** Retorna a data de ontem no formato YYYY-MM-DD no horário de Brasília. */
export function yesterdayBRT(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: BRT_TZ }).format(
		new Date(Date.now() - 24 * 60 * 60 * 1000),
	);
}

/**
 * Retorna o início da semana atual (segunda-feira 00:00 BRT) como Date UTC.
 * Considera segunda como primeiro dia da semana (padrão ISO 8601).
 */
export function startOfWeekBRT(): Date {
	const startOfDay = startOfTodayBRT();
	// Quantos dias até segunda? getUTCDay(): 0=domingo, 1=segunda, ..., 6=sábado.
	// Esta data já está fixada em 00:00 BRT, então pegamos o dia-da-semana no formato BRT.
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: BRT_TZ,
		weekday: 'short',
	});
	const weekday = fmt.format(startOfDay); // "Mon", "Tue", etc.
	const order: Record<string, number> = {
		Mon: 0,
		Tue: 1,
		Wed: 2,
		Thu: 3,
		Fri: 4,
		Sat: 5,
		Sun: 6,
	};
	const daysSinceMonday = order[weekday] ?? 0;
	return new Date(startOfDay.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

/** Retorna o início da próxima semana (próxima segunda 00:00 BRT) como Date UTC. */
export function startOfNextWeekBRT(): Date {
	return new Date(startOfWeekBRT().getTime() + 7 * 24 * 60 * 60 * 1000);
}
