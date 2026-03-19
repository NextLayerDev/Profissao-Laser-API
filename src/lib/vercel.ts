import axios, { type AxiosError } from 'axios';

const VERCEL_ACCESS_TOKEN = process.env.VERCEL_ACCESS_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;
// Normalize repo: accept both "https://github.com/owner/repo" and "owner/repo"
const rawRepo = process.env.VERCEL_GITHUB_REPO ?? '';
const VERCEL_GITHUB_REPO = rawRepo
	.replace(/^https?:\/\/github\.com\//, '')
	.replace(/\.git$/, '')
	.replace(/\/$/, '');

if (!VERCEL_ACCESS_TOKEN) {
	throw new Error('VERCEL_ACCESS_TOKEN is not defined');
}
if (!VERCEL_TEAM_ID) {
	throw new Error('VERCEL_TEAM_ID is not defined');
}
if (!VERCEL_GITHUB_REPO || !VERCEL_GITHUB_REPO.includes('/')) {
	throw new Error(
		`VERCEL_GITHUB_REPO must be in "owner/repo" format, got: "${VERCEL_GITHUB_REPO}"`,
	);
}

const api = axios.create({
	baseURL: 'https://api.vercel.com',
	headers: {
		Authorization: `Bearer ${VERCEL_ACCESS_TOKEN}`,
		'Content-Type': 'application/json',
	},
	params: {
		teamId: VERCEL_TEAM_ID,
	},
});

export async function createProject(
	slug: string,
): Promise<{ id: string; name: string }> {
	try {
		console.log(
			`[vercel] Creating project "${slug}" with repo "${VERCEL_GITHUB_REPO}"...`,
		);
		const { data } = await api.post('/v10/projects', {
			name: slug,
			framework: 'nextjs',
			gitRepository: {
				type: 'github',
				repo: VERCEL_GITHUB_REPO,
			},
		});
		return { id: data.id, name: data.name };
	} catch (err) {
		const axiosErr = err as AxiosError<{ error?: { code?: string } }>;

		// Project already exists — look it up
		if (
			axiosErr.response?.status === 409 ||
			axiosErr.response?.data?.error?.code === 'project_already_exists'
		) {
			console.log(
				`[vercel] Project "${slug}" already exists — looking it up...`,
			);
			const { data } = await api.get(`/v9/projects/${slug}`);
			return { id: data.id, name: data.name };
		}

		throw err;
	}
}

export async function setEnvVars(
	projectId: string,
	vars: Record<string, string>,
): Promise<void> {
	const keys = Object.keys(vars);
	console.log(
		`[vercel] Setting ${keys.length} env vars on project ${projectId}...`,
	);

	// 1. Fetch existing env vars to find conflicting keys
	const { data: existingData } = await api.get(
		`/v10/projects/${projectId}/env`,
	);
	const existingVars: Array<{ key: string; id: string }> =
		existingData.envs ?? existingData ?? [];

	// 2. Delete existing env vars that match our keys (sequentially to avoid rate limits)
	const toDelete = existingVars.filter((ev) => keys.includes(ev.key));
	if (toDelete.length > 0) {
		console.log(
			`[vercel] Removing ${toDelete.length} existing env vars before re-creating...`,
		);
		for (const ev of toDelete) {
			await api.delete(`/v9/projects/${projectId}/env/${ev.id}`);
		}
		console.log(`[vercel] ✓ Removed ${toDelete.length} old env vars.`);
	}

	// 3. Batch create all env vars at once
	const envVars = Object.entries(vars).map(([key, value]) => ({
		key,
		value,
		target: ['production', 'preview'],
		type: 'encrypted',
	}));

	console.log(`[vercel] Creating ${envVars.length} env vars...`);
	await api.post(`/v10/projects/${projectId}/env`, envVars);

	console.log(`[vercel] ✓ All ${envVars.length} env vars set successfully.`);
}

export async function triggerDeployment(
	projectId: string,
): Promise<{ id: string; url: string }> {
	// Fetch project to get the numeric GitHub repoId
	const { data: project } = await api.get(`/v9/projects/${projectId}`);
	const repoId = project.link?.repoId;

	if (!repoId) {
		throw new Error(
			`Vercel project ${projectId} has no linked GitHub repo (missing link.repoId)`,
		);
	}

	console.log(
		`[vercel] Triggering deployment for project ${projectId} with repoId ${repoId}...`,
	);

	const { data } = await api.post('/v13/deployments', {
		name: projectId,
		target: 'production',
		gitSource: {
			type: 'github',
			repoId,
			ref: 'main',
		},
	});
	return { id: data.id, url: data.url };
}

export async function waitDeploymentReady(
	deploymentId: string,
): Promise<{ url: string }> {
	const MAX_ATTEMPTS = 60;
	const INTERVAL_MS = 10000;

	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		const { data } = await api.get(`/v13/deployments/${deploymentId}`);

		if (data.readyState === 'READY') {
			return { url: `https://${data.url}` };
		}

		if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
			throw new Error(
				`Vercel deployment ${deploymentId} failed with state: ${data.readyState}`,
			);
		}

		await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
	}

	throw new Error(
		`Vercel deployment ${deploymentId} did not become ready within 10 minutes`,
	);
}

export async function getProjectDomain(projectId: string): Promise<string> {
	const { data } = await api.get(`/v9/projects/${projectId}`);

	// Primary: production deployment aliases (stable, populated after first deploy)
	// e.g. "nextlayer-psi.vercel.app" when "nextlayer.vercel.app" was already taken
	// data.name = requested project name (NOT the actual assigned domain)
	const productionAliases: string[] = data.targets?.production?.alias ?? [];
	const stableAlias = productionAliases.find((a: string) =>
		a.endsWith('.vercel.app'),
	);
	if (stableAlias) {
		console.log(`[vercel] Production domain for ${projectId}: ${stableAlias}`);
		return `https://${stableAlias}`;
	}

	// Fallback: project-level aliases (before first deploy or older projects)
	const projectAliases: string[] = data.alias ?? [];
	const projectAlias = projectAliases.find((a: string) =>
		a.endsWith('.vercel.app'),
	);
	if (projectAlias) {
		console.log(
			`[vercel] Project alias domain for ${projectId}: ${projectAlias}`,
		);
		return `https://${projectAlias}`;
	}

	// Last resort: derive from project name (may be wrong if there was a conflict)
	console.warn(
		`[vercel] No .vercel.app alias found for ${projectId}, falling back to name: ${data.name}.vercel.app`,
	);
	return `https://${data.name}.vercel.app`;
}

export async function createBlobStore(
	slug: string,
	projectId: string,
): Promise<{ storeId: string }> {
	let storeId: string;

	try {
		// 1. Create the blob store (correct Vercel REST API endpoint)
		const { data } = await api.post('/v1/storage/stores/blob', {
			name: `${slug}-store`,
			region: 'iad1',
			access: 'public',
		});
		storeId = data.store.id;
		console.log(`[vercel] Blob store created: ${storeId}`);
	} catch (err) {
		const axiosErr = err as AxiosError<{ error?: { code?: string } }>;

		// Store already exists — list stores and find by name
		if (axiosErr.response?.status === 409) {
			console.log(
				`[vercel] Blob store for "${slug}" already exists — looking it up...`,
			);
			const { data: listData } = await api.get('/v1/storage/stores', {
				params: { type: 'blob' },
			});
			const stores: Array<{ id: string; name: string }> =
				listData.stores ?? listData ?? [];
			const existing = stores.find((s) => s.name === `${slug}-store`);
			if (!existing) {
				throw new Error(`Blob store "${slug}-store" not found after 409`);
			}
			storeId = existing.id;
			console.log(`[vercel] Found existing blob store: ${storeId}`);
		} else {
			throw err;
		}
	}

	// 2. Connect store to project — Vercel automatically adds BLOB_READ_WRITE_TOKEN
	//    to the project's env vars (production + preview + development)
	try {
		await api.post(`/v1/storage/stores/${storeId}/connections`, {
			projectId,
			envVarEnvironments: ['production', 'preview', 'development'],
			type: 'integration',
		});
		console.log(
			`[vercel] Blob store ${storeId} connected to project ${projectId}`,
		);
	} catch (connErr) {
		const axiosErr = connErr as AxiosError;
		// 409 = already connected — token already exists in project envs
		if (axiosErr.response?.status !== 409) throw connErr;
		console.log(`[vercel] Blob store already connected to project — skipping`);
	}

	return { storeId };
}

export async function removeEnvVars(
	projectId: string,
	keys: string[],
): Promise<void> {
	const { data: existingData } = await api.get(
		`/v10/projects/${projectId}/env`,
	);
	const existing: Array<{ key: string; id: string }> =
		existingData.envs ?? existingData ?? [];
	const toDelete = existing.filter((ev) => keys.includes(ev.key));

	for (const ev of toDelete) {
		await api.delete(`/v9/projects/${projectId}/env/${ev.id}`);
	}
	console.log(
		`[vercel] Removed ${toDelete.length} env vars: ${keys.join(', ')}`,
	);
}
