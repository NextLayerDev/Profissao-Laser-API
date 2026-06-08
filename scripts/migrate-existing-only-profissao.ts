/**
 * Migra tenants existentes only_profissao=true para o modo course-only:
 *   - MANTÉM o projeto Vercel (slug.vercel.app)
 *   - REMOVE envs DATABASE_URL/SUPABASE_* e ADICIONA NEXT_PUBLIC_TENANT_MODE=course_only
 *   - SETA Build Command override = "prisma generate && next build" (sem migrate deploy)
 *   - DELETA o projeto Supabase (irreversível — só após smoke test do redeploy)
 *   - MARCA pl_tenant.only_profissao = true e zera campos supabase_*
 *
 * Pré-requisitos:
 *   - SQL `add-tenant-only-profissao-flag.sql` já aplicado no Supabase central
 *   - PR PORTEIRA-1 e 2 mergeados (rota /curso + middleware course_only)
 *
 * Modos:
 *   --dry-run                lista candidatos e o que faria (DEFAULT — seguro)
 *   --apply                  executa de fato
 *   --only=email1,email2     processa apenas esses customers
 *   --skip-supabase-delete   não deleta Supabase (útil para testar redeploy isolado)
 *   --skip-redeploy          não dispara redeploy do Vercel (perigoso)
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/migrate-existing-only-profissao.ts
 *   npx tsx --env-file=.env scripts/migrate-existing-only-profissao.ts --apply --only=cliente@x.com
 */

import { supabase } from '../src/lib/supabase.js';

interface Args {
	dryRun: boolean;
	onlyEmails: string[] | null;
	skipSupabaseDelete: boolean;
	skipRedeploy: boolean;
}

function parseArgs(): Args {
	const argv = process.argv.slice(2);
	const apply = argv.includes('--apply');
	const onlyArg = argv.find((a) => a.startsWith('--only='));
	const onlyEmails = onlyArg
		? onlyArg
				.replace('--only=', '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: null;
	return {
		dryRun: !apply,
		onlyEmails,
		skipSupabaseDelete: argv.includes('--skip-supabase-delete'),
		skipRedeploy: argv.includes('--skip-redeploy'),
	};
}

const TEAMS = [
	{
		label: 'team1',
		id: process.env.VERCEL_TEAM_ID,
		tk: process.env.VERCEL_ACCESS_TOKEN,
	},
	{
		label: 'team2',
		id: process.env.VERCEL_TEAM_ID_2,
		tk: process.env.VERCEL_ACCESS_TOKEN_2,
	},
].filter((t) => t.id && t.tk) as Array<{
	label: string;
	id: string;
	tk: string;
}>;

// Envs a REMOVER do projeto Vercel
const ENVS_TO_REMOVE = [
	'DATABASE_URL',
	'DIRECT_URL',
	'NEXT_PUBLIC_SUPABASE_URL',
	'NEXT_PUBLIC_SUPABASE_ANON_KEY',
	'SUPABASE_SERVICE_ROLE_KEY',
];

// Envs a ADICIONAR/ATUALIZAR no projeto Vercel.
// NEXT_PUBLIC_PL_API_URL ja existe em todos os tenants apontando pra API
// central — e a env principal lida pelo porteira em /api/curso/login e
// /lib/curso-session, nao precisa setar nada novo de URL aqui.
function envsToSet(): { key: string; value: string }[] {
	return [
		{ key: 'NEXT_PUBLIC_TENANT_MODE', value: 'course_only' },
		{ key: 'TENANT_MODE', value: 'course_only' },
	];
}

async function findVercelTeam(
	projectId: string,
): Promise<{ teamId: string; token: string } | null> {
	for (const t of TEAMS) {
		const r = await fetch(
			`https://api.vercel.com/v10/projects/${projectId}?teamId=${t.id}`,
			{ headers: { Authorization: `Bearer ${t.tk}` } },
		);
		if (r.ok) return { teamId: t.id, token: t.tk };
	}
	return null;
}

async function listEnvs(token: string, teamId: string, projectId: string) {
	const r = await fetch(
		`https://api.vercel.com/v10/projects/${projectId}/env?teamId=${teamId}`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);
	if (!r.ok) throw new Error(`listEnvs ${r.status}`);
	const data = await r.json();
	return data.envs as Array<{ id: string; key: string; type: string }>;
}

async function deleteEnv(
	token: string,
	teamId: string,
	projectId: string,
	envId: string,
) {
	const r = await fetch(
		`https://api.vercel.com/v10/projects/${projectId}/env/${envId}?teamId=${teamId}`,
		{ method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
	);
	return r.status;
}

async function upsertEnv(
	token: string,
	teamId: string,
	projectId: string,
	env: { key: string; value: string },
) {
	const r = await fetch(
		`https://api.vercel.com/v10/projects/${projectId}/env?upsert=true&teamId=${teamId}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				key: env.key,
				value: env.value,
				type: 'encrypted',
				target: ['production', 'preview', 'development'],
			}),
		},
	);
	return r.status;
}

// Build Command pra modo course_only — sem `prisma migrate deploy`
// (não tem DB local pra migrar). Aplicado via PATCH no projeto Vercel.
const COURSE_ONLY_BUILD_COMMAND = 'prisma generate && next build';

async function setBuildCommandOverride(
	token: string,
	teamId: string,
	projectId: string,
	command: string | null,
): Promise<number> {
	const r = await fetch(
		`https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`,
		{
			method: 'PATCH',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ buildCommand: command }),
		},
	);
	return r.status;
}

async function triggerRedeploy(
	token: string,
	teamId: string,
	projectId: string,
	slug: string,
) {
	const list = await fetch(
		`https://api.vercel.com/v6/deployments?projectId=${projectId}&target=production&limit=10&teamId=${teamId}`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);
	if (!list.ok) return null;
	const data = (await list.json()) as {
		deployments: { uid: string; state: string }[];
	};
	const dep =
		data.deployments.find((d) => d.state === 'READY') || data.deployments?.[0];
	if (!dep) return null;
	const r = await fetch(
		`https://api.vercel.com/v13/deployments?forceNew=1&teamId=${teamId}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: slug,
				deploymentId: dep.uid,
				target: 'production',
			}),
		},
	);
	if (!r.ok) return null;
	const j = await r.json();
	return j.id ?? j.uid ?? null;
}

async function deleteSupabaseProject(ref: string): Promise<string> {
	const PAT = process.env.SUPABASE_MANAGEMENT_PAT;
	if (!PAT) return '✗ SUPABASE_MANAGEMENT_PAT missing';
	const r = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${PAT}` },
	});
	if (r.status === 200) return '✓ deleted';
	if (r.status === 404) return '⚠ not found (already deleted?)';
	return `✗ ${r.status}: ${(await r.text()).slice(0, 120)}`;
}

async function listCandidates(args: Args) {
	const { data: tenants, error } = await supabase
		.from('pl_tenant')
		.select(
			'id, customer_id, slug, status, current_plan, only_profissao, vercel_project_id, supabase_project_ref',
		)
		.eq('only_profissao', true)
		.eq('status', 'active');
	if (error) throw new Error(error.message);

	type Tenant = {
		id: string;
		customer_id: string;
		slug: string;
		status: string;
		current_plan: string;
		only_profissao: boolean;
		vercel_project_id: string;
		supabase_project_ref: string;
	};
	type Customer = {
		id: string;
		email: string;
		name: string;
		company_name: string;
	};

	const customerIds = [
		...new Set((tenants ?? []).map((t) => (t as Tenant).customer_id)),
	];
	const { data: customers } = await supabase
		.from('pl_provisioning_customer')
		.select('id, email, name, company_name')
		.in('id', customerIds);
	const custMap = new Map(
		(customers ?? []).map((c) => [(c as Customer).id, c as Customer]),
	);

	let result = (tenants ?? [])
		.map((t) => ({
			tenant: t as Tenant,
			customer: custMap.get((t as Tenant).customer_id) as Customer | undefined,
		}))
		// só os que ainda têm Supabase a deletar (ou seja, ainda não migrados)
		.filter((c) => !!c.tenant.supabase_project_ref);

	if (args.onlyEmails && args.onlyEmails.length > 0) {
		result = result.filter(
			(c) => c.customer && args.onlyEmails?.includes(c.customer.email),
		);
	}
	return result;
}

type Candidate = Awaited<ReturnType<typeof listCandidates>>[number];
type ProcessResult = {
	email: string | undefined;
	actions: string[];
	errors: string[];
};

async function processOne(c: Candidate, args: Args): Promise<ProcessResult> {
	const { tenant, customer } = c;
	console.log(
		`\n→ ${customer?.email ?? '?'} (${customer?.name ?? ''}) — slug=${tenant.slug}`,
	);
	console.log(`  vercel_project_id: ${tenant.vercel_project_id}`);
	console.log(`  supabase_project_ref: ${tenant.supabase_project_ref}`);

	const result: ProcessResult = {
		email: customer?.email,
		actions: [],
		errors: [],
	};

	if (args.dryRun) {
		console.log('  [dry-run] would update Vercel envs:');
		console.log(`    REMOVE: ${ENVS_TO_REMOVE.join(', ')}`);
		console.log(
			`    SET: ${envsToSet()
				.map((e) => e.key)
				.join(', ')}`,
		);
		console.log(
			`  [dry-run] would set Build Command override: "${COURSE_ONLY_BUILD_COMMAND}"`,
		);
		console.log('  [dry-run] would trigger redeploy');
		console.log(
			`  [dry-run] would delete Supabase ${tenant.supabase_project_ref}`,
		);
		console.log(
			'  [dry-run] would NULL pl_tenant supabase_* fields (already only_profissao=true)',
		);
		return result;
	}

	// 1. Find Vercel team
	const team = await findVercelTeam(tenant.vercel_project_id);
	if (!team) {
		console.error(`  ✗ project not found in any Vercel team`);
		result.errors.push('vercel_project_not_found');
		return result;
	}

	// 2. Update envs
	const existing = await listEnvs(
		team.token,
		team.teamId,
		tenant.vercel_project_id,
	);
	for (const env of existing) {
		if (ENVS_TO_REMOVE.includes(env.key)) {
			const status = await deleteEnv(
				team.token,
				team.teamId,
				tenant.vercel_project_id,
				env.id,
			);
			console.log(`  - removed ${env.key}: ${status}`);
			result.actions.push(`remove env ${env.key}`);
		}
	}
	for (const env of envsToSet()) {
		const status = await upsertEnv(
			team.token,
			team.teamId,
			tenant.vercel_project_id,
			env,
		);
		console.log(`  + set ${env.key}: ${status}`);
		result.actions.push(`set env ${env.key}`);
	}

	// 2.5. Build Command override — sem `prisma migrate deploy` em course_only
	const bcStatus = await setBuildCommandOverride(
		team.token,
		team.teamId,
		tenant.vercel_project_id,
		COURSE_ONLY_BUILD_COMMAND,
	);
	console.log(
		`  ⚙ buildCommand override → "${COURSE_ONLY_BUILD_COMMAND}": ${bcStatus}`,
	);
	result.actions.push(`buildCommand override (${bcStatus})`);

	// 3. Redeploy
	if (!args.skipRedeploy) {
		const newDep = await triggerRedeploy(
			team.token,
			team.teamId,
			tenant.vercel_project_id,
			tenant.slug,
		);
		if (newDep) {
			console.log(`  🚀 redeploy: ${newDep}`);
			result.actions.push(`redeploy ${newDep}`);
		} else {
			console.error('  ✗ redeploy failed');
			result.errors.push('redeploy_failed');
			return result; // não deleta Supabase se redeploy falhou
		}
	}

	// 4. Delete Supabase
	if (!args.skipSupabaseDelete) {
		const r = await deleteSupabaseProject(tenant.supabase_project_ref);
		console.log(`  supabase ${tenant.supabase_project_ref}: ${r}`);
		result.actions.push(`supabase ${r}`);
	}

	// 5. Update central pl_tenant — zera campos Supabase
	const { error: upErr } = await supabase
		.from('pl_tenant')
		.update({
			supabase_project_ref: null,
			supabase_anon_key: null,
			supabase_service_role_key_encrypted: null,
			supabase_db_pass_encrypted: null,
			supabase_url: null,
			updated_at: new Date().toISOString(),
		})
		.eq('id', tenant.id);
	if (upErr) {
		console.error(`  ✗ failed to update pl_tenant: ${upErr.message}`);
		result.errors.push(upErr.message);
	} else {
		console.log(`  ✓ pl_tenant supabase_* fields zeroed`);
		result.actions.push('pl_tenant updated');
	}

	return result;
}

async function main() {
	const args = parseArgs();
	console.log('=== migrate-existing-only-profissao ===');
	console.log(`mode: ${args.dryRun ? 'DRY-RUN (default)' : 'APPLY'}`);
	if (args.onlyEmails) console.log(`filter: ${args.onlyEmails.join(', ')}`);
	if (args.skipSupabaseDelete) console.log('skip-supabase-delete: true');
	if (args.skipRedeploy) console.log('skip-redeploy: true');

	const candidates = await listCandidates(args);
	console.log(`\n${candidates.length} candidatos found.\n`);
	if (candidates.length === 0) {
		console.log('Nada a fazer.');
		return;
	}

	const results: ProcessResult[] = [];
	for (const c of candidates) {
		try {
			results.push(await processOne(c, args));
		} catch (e) {
			const err = e as { message?: string };
			console.error(`  ✗ FATAL: ${err.message}`);
			results.push({
				email: c.customer?.email,
				actions: [],
				errors: [err.message ?? 'unknown'],
			});
		}
	}

	const ok = results.filter((r) => (r.errors?.length ?? 0) === 0).length;
	const fail = results.length - ok;
	console.log(`\n=== SUMMARY ===`);
	console.log(`processed: ${results.length}  ok: ${ok}  failed: ${fail}`);
	if (args.dryRun) {
		console.log(
			'\n⚠ DRY-RUN — nenhuma alteração aplicada. Re-rode com --apply para executar.',
		);
	}
}

main().catch((e) => {
	console.error('FATAL:', e);
	process.exit(1);
});
