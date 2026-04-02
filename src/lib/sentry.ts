import * as Sentry from '@sentry/node';

export function initSentry() {
	if (!process.env.SENTRY_DSN) return;

	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.NODE_ENV ?? 'production',
	});
}

export function captureException(error: unknown) {
	Sentry.captureException(error);
}

export async function withCapture<T>(
	fn: () => Promise<T>,
): Promise<{ data: T | null; error: unknown }> {
	try {
		const data = await fn();
		return { data, error: null };
	} catch (error) {
		captureException(error);
		return { data: null, error };
	}
}
