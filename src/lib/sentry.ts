import * as Sentry from '@sentry/node';

export function initSentry() {
	if (!process.env.SENTRY_DSN) {
		console.warn('[Sentry] SENTRY_DSN not set, skipping init');
		return;
	}

	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.NODE_ENV ?? 'production',
	});
	console.log('[Sentry] Initialized');
}

export async function captureException(error: unknown) {
	Sentry.captureException(error);
	await Sentry.flush(2000);
}

export async function withCapture<T>(
	fn: () => Promise<T>,
): Promise<{ data: T | null; error: unknown }> {
	try {
		const data = await fn();
		return { data, error: null };
	} catch (error) {
		await captureException(error);
		return { data: null, error };
	}
}
