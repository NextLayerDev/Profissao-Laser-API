import axios, { type AxiosError } from 'axios';

const SUPABASE_MANAGEMENT_PAT = process.env.SUPABASE_MANAGEMENT_PAT;

if (!SUPABASE_MANAGEMENT_PAT) {
	throw new Error('SUPABASE_MANAGEMENT_PAT is not defined');
}

const api = axios.create({
	baseURL: 'https://api.supabase.com/v1',
	headers: {
		Authorization: `Bearer ${SUPABASE_MANAGEMENT_PAT}`,
		'Content-Type': 'application/json',
	},
});

export async function createOrganization(
	name: string,
): Promise<{ id: string }> {
	const { data } = await api.post('/organizations', { name });
	return { id: data.id };
}

export async function findProjectByName(
	orgId: string,
	name: string,
): Promise<{ id: string; ref: string } | null> {
	const { data: projects } = await api.get('/projects');
	const match = projects.find(
		(p: { name: string; organization_id: string; ref: string; id: string }) =>
			p.name === name && p.organization_id === orgId,
	);
	if (!match) return null;
	return { id: match.id, ref: match.ref ?? match.id };
}

export async function updateDatabasePassword(
	ref: string,
	password: string,
): Promise<void> {
	console.log(`[supabase] Updating database password for project ${ref}...`);
	await api.patch(`/projects/${ref}/database/password`, { password });
	console.log(`[supabase] Database password updated for project ${ref}.`);
}

export async function createProject(params: {
	name: string;
	orgId: string;
	region: string;
	dbPass: string;
}): Promise<{ id: string; ref: string }> {
	try {
		const { data } = await api.post('/projects', {
			name: params.name,
			organization_id: params.orgId,
			region: params.region,
			db_pass: params.dbPass,
			plan: 'pro',
		});
		return { id: data.id, ref: data.ref ?? data.id };
	} catch (err) {
		const axiosErr = err as AxiosError<{ message?: string }>;
		const msg = axiosErr.response?.data?.message ?? '';

		// Project already exists — find and return it
		if (axiosErr.response?.status === 400 && msg.includes('already exists')) {
			console.log(
				`[supabase] Project "${params.name}" already exists — looking it up...`,
			);
			const existing = await findProjectByName(params.orgId, params.name);
			if (existing) {
				console.log(`[supabase] Found existing project: ref=${existing.ref}`);
				// Sync the database password so DATABASE_URL matches
				await updateDatabasePassword(existing.ref, params.dbPass);
				return existing;
			}
		}

		throw err;
	}
}

export async function waitProjectReady(ref: string): Promise<void> {
	const MAX_ATTEMPTS = 60;
	const INTERVAL_MS = 5000;

	console.log(`[waitProjectReady] Starting to poll project ${ref}...`);

	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		const { data } = await api.get(`/projects/${ref}`);

		console.log(
			`[waitProjectReady] Attempt ${i + 1}/${MAX_ATTEMPTS} — project ${ref} status: ${data.status}`,
		);

		if (data.status === 'ACTIVE_HEALTHY') {
			console.log(
				`[waitProjectReady] Project ${ref} is ACTIVE_HEALTHY — waiting 60s for Supavisor pooler...`,
			);
			await new Promise((resolve) => setTimeout(resolve, 60000));
			console.log(
				`[waitProjectReady] Project ${ref} ready — pooler wait complete.`,
			);
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
	}

	throw new Error(
		`Supabase project ${ref} did not become ready within 5 minutes`,
	);
}

export async function getPoolerHost(ref: string): Promise<string> {
	const { data } = await api.get(`/projects/${ref}/config/database/pooler`);
	const primary = data.find(
		(p: { database_type: string }) => p.database_type === 'PRIMARY',
	);
	if (!primary?.db_host) {
		throw new Error(`Could not determine pooler host for project ${ref}`);
	}
	console.log(`[supabase] Pooler host for ${ref}: ${primary.db_host}`);
	return primary.db_host;
}

export async function getProjectApiKeys(
	ref: string,
): Promise<{ anonKey: string; serviceRoleKey: string }> {
	const { data } = await api.get(`/projects/${ref}/api-keys`);

	const anonKey = data.find(
		(k: { name: string; api_key: string }) => k.name === 'anon',
	)?.api_key;
	const serviceRoleKey = data.find(
		(k: { name: string; api_key: string }) => k.name === 'service_role',
	)?.api_key;

	if (!anonKey || !serviceRoleKey) {
		throw new Error(`Could not find API keys for project ${ref}`);
	}

	return { anonKey, serviceRoleKey };
}
