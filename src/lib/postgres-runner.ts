import type { AxiosError } from 'axios';
import axios from 'axios';

const MGMT_API = 'https://api.supabase.com';
const MAX_RETRIES = 8;
const RETRY_DELAY_MS = 10_000;

/**
 * Runs SQL on a tenant Supabase database via the Management API.
 * Uses POST /v1/projects/{ref}/database/query — no direct pg connection needed.
 * This avoids DNS propagation and Supavisor "Tenant or user not found" issues.
 */
export async function runSqlOnTenant(params: {
	ref: string;
	dbPass: string;
	sql: string;
}): Promise<void> {
	const token = process.env.SUPABASE_MANAGEMENT_PAT;
	if (!token) throw new Error('SUPABASE_MANAGEMENT_PAT is not defined');

	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			console.log(
				`[postgres-runner] Attempt ${attempt}/${MAX_RETRIES} via Management API (project ${params.ref})...`,
			);

			await axios.post(
				`${MGMT_API}/v1/projects/${params.ref}/database/query`,
				{ query: params.sql },
				{
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
					timeout: 120_000, // 120s timeout for large SQL (bootstrap.sql ~561 lines)
				},
			);

			console.log(
				`[postgres-runner] ✓ SQL executed via Management API (attempt ${attempt})`,
			);
			return;
		} catch (err) {
			lastError = err;

			const axiosErr = err as AxiosError;
			const status = axiosErr.response?.status;
			const respData = axiosErr.response?.data;
			const msg = err instanceof Error ? err.message : String(err);

			console.error(
				`[postgres-runner] ✗ Attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`,
				{ status, data: respData },
			);

			// Don't retry on SQL syntax/validation errors — they won't magically fix themselves
			if (status === 400 || status === 422) {
				const errorDetail =
					typeof respData === 'string' ? respData : JSON.stringify(respData);
				throw new Error(`SQL execution error (${status}): ${errorDetail}`);
			}

			// Don't retry on auth errors
			if (status === 401 || status === 403) {
				throw new Error(
					`Management API auth error (${status}): check SUPABASE_MANAGEMENT_PAT`,
				);
			}

			if (attempt < MAX_RETRIES) {
				console.log(
					`[postgres-runner] Retrying in ${RETRY_DELAY_MS / 1000}s...`,
				);
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			}
		}
	}

	throw (
		lastError ??
		new Error(
			`SQL execution failed after ${MAX_RETRIES} attempts via Management API`,
		)
	);
}
