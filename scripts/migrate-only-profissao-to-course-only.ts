/**
 * Migra clientes only_profissao=true (gerenciamentoSistema=false) do tenant
 * Vercel/Supabase próprio para o deploy compartilhado course-only do
 * system_porteira (https://course.profissaolaser.com.br).
 *
 * Modos:
 *   --dry-run    apenas lista candidatos e valida (DEFAULT — seguro)
 *   --apply      executa de fato (delete Vercel + Supabase + atualiza pl_provisioning_customer)
 *   --only=email1@x.com,email2@y.com    processa apenas esses customers
 *   --skip-vercel        não deleta projeto Vercel (mantém URL antiga viva)
 *   --skip-supabase      não deleta projeto Supabase
 *   --skip-email         não envia email de notificação (TODO: integração mailer)
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/migrate-only-profissao-to-course-only.ts
 *   npx tsx --env-file=.env scripts/migrate-only-profissao-to-course-only.ts --apply --only=cliente@x.com
 */

import { supabase } from '../src/lib/supabase.js';

interface Args {
	dryRun: boolean;
	onlyEmails: string[] | null;
	skipVercel: boolean;
	skipSupabase: boolean;
	skipEmail: boolean;
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
		skipVercel: argv.includes('--skip-vercel'),
		skipSupabase: argv.includes('--skip-supabase'),
		skipEmail: argv.includes('--skip-email'),
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

async function deleteVercelProject(projectId: string): Promise<string> {
	for (const t of TEAMS) {
		const r = await fetch(
			`https://api.vercel.com/v9/projects/${projectId}?teamId=${t.id}`,
			{ method: 'DELETE', headers: { Authorization: `Bearer ${t.tk}` } },
		);
		if (r.status === 204) return `✓ deleted (${t.label})`;
		if (r.status !== 404)
			return `✗ ${t.label} ${r.status}: ${(await r.text()).slice(0, 120)}`;
	}
	return '⚠ not found in any team (already deleted?)';
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
	const { data: orders, error } = await supabase
		.from('pl_provisioning_order')
		.select(
			'id, customer_id, status, plan, stripe_subscription_id, metadata, created_at',
		)
		.eq('status', 'completed');
	if (error) throw new Error(error.message);

	const onlyProfOrders = (orders ?? []).filter(
		(o: any) => o?.metadata?.only_profissao === true,
	);
	const customerIds = [
		...new Set(onlyProfOrders.map((o: any) => o.customer_id)),
	];

	const { data: customers } = await supabase
		.from('pl_provisioning_customer')
		.select(
			'id, email, name, company_name, phone, migrated_to_course_only_at, migration_notes',
		)
		.in('id', customerIds);

	const { data: tenants } = await supabase
		.from('pl_tenant')
		.select(
			'id, customer_id, slug, status, current_plan, vercel_project_id, supabase_project_ref',
		)
		.in('customer_id', customerIds);

	const tenantsByCustomer = new Map<string, any[]>();
	for (const t of tenants ?? []) {
		if (!tenantsByCustomer.has(t.customer_id))
			tenantsByCustomer.set(t.customer_id, []);
		tenantsByCustomer.get(t.customer_id)!.push(t);
	}

	const candidates = (customers ?? [])
		.map((c: any) => ({
			customer: c,
			tenants: tenantsByCustomer.get(c.id) ?? [],
		}))
		// já migrados ficam fora do default
		.filter((c) => !c.customer.migrated_to_course_only_at);

	if (args.onlyEmails && args.onlyEmails.length > 0) {
		return candidates.filter((c) =>
			args.onlyEmails!.includes(c.customer.email),
		);
	}
	return candidates;
}

async function processOne(c: any, args: Args) {
	const { customer, tenants } = c;
	console.log(`\n→ ${customer.email} (${customer.name})`);
	console.log(`  tenants: ${tenants.length}`);

	const result: any = {
		email: customer.email,
		actions: [],
		errors: [],
	};

	if (args.dryRun) {
		for (const t of tenants) {
			console.log(
				`  [dry-run] would delete vercel ${t.vercel_project_id} + supabase ${t.supabase_project_ref}`,
			);
			result.actions.push(
				`vercel ${t.vercel_project_id}`,
				`supabase ${t.supabase_project_ref}`,
			);
		}
		console.log(
			`  [dry-run] would update pl_provisioning_customer.migrated_to_course_only_at`,
		);
		console.log(
			`  [dry-run] ${args.skipEmail ? 'would skip' : 'would send'} email to customer`,
		);
		return result;
	}

	// APPLY mode
	for (const t of tenants) {
		if (!args.skipVercel && t.vercel_project_id) {
			const r = await deleteVercelProject(t.vercel_project_id);
			console.log(`  vercel ${t.vercel_project_id}: ${r}`);
			result.actions.push(`vercel ${t.vercel_project_id} → ${r}`);
		}
		if (!args.skipSupabase && t.supabase_project_ref) {
			const r = await deleteSupabaseProject(t.supabase_project_ref);
			console.log(`  supabase ${t.supabase_project_ref}: ${r}`);
			result.actions.push(`supabase ${t.supabase_project_ref} → ${r}`);
		}

		// Cleanup central DB rows pra esse tenant
		const { count: auditCount } = await supabase
			.from('pl_provisioning_audit_log')
			.delete({ count: 'exact' })
			.eq(
				'job_id',
				tenants[0]?.provisioning_job_id ??
					'00000000-0000-0000-0000-000000000000',
			);
		const { count: phCount } = await supabase
			.from('pl_tenant_plan_history')
			.delete({ count: 'exact' })
			.eq('tenant_id', t.id);
		const { count: tnCount } = await supabase
			.from('pl_tenant')
			.delete({ count: 'exact' })
			.eq('id', t.id);
		console.log(
			`  central cleanup: audit=${auditCount} plan_history=${phCount} tenant=${tnCount}`,
		);
		result.actions.push(
			`central audit=${auditCount} plan_history=${phCount} tenant=${tnCount}`,
		);
	}

	const notes = `Migrated to course-only ${new Date().toISOString()}. Tenants removed: ${tenants
		.map((t: any) => t.slug)
		.join(', ')}`;
	const { error: upErr } = await supabase
		.from('pl_provisioning_customer')
		.update({
			migrated_to_course_only_at: new Date().toISOString(),
			migration_notes: notes,
		})
		.eq('id', customer.id);
	if (upErr) {
		console.error(`  ✗ failed to mark customer migrated: ${upErr.message}`);
		result.errors.push(upErr.message);
	} else {
		console.log(`  ✓ pl_provisioning_customer marked as migrated`);
		result.actions.push('customer marked');
	}

	if (!args.skipEmail) {
		// TODO: integrar com sendCourseOnlyMigrationEmail (lib/mailer.ts)
		console.log(
			`  ⚠ email NOT sent — TODO implementar sendCourseOnlyMigrationEmail() em src/lib/mailer.ts`,
		);
	}

	return result;
}

async function main() {
	const args = parseArgs();
	console.log('=== migrate-only-profissao-to-course-only ===');
	console.log(`mode: ${args.dryRun ? 'DRY-RUN (default)' : 'APPLY'}`);
	if (args.onlyEmails) console.log(`filter: ${args.onlyEmails.join(', ')}`);
	if (args.skipVercel) console.log('skip-vercel: true');
	if (args.skipSupabase) console.log('skip-supabase: true');
	if (args.skipEmail) console.log('skip-email: true');

	const candidates = await listCandidates(args);
	console.log(`\n${candidates.length} candidatos found.\n`);

	if (candidates.length === 0) {
		console.log('Nada a fazer.');
		return;
	}

	const results: any[] = [];
	for (const c of candidates) {
		try {
			results.push(await processOne(c, args));
		} catch (e: any) {
			console.error(`  ✗ FATAL on ${c.customer.email}: ${e.message}`);
			results.push({ email: c.customer.email, errors: [e.message] });
		}
	}

	console.log('\n=== SUMMARY ===');
	console.log(`processed: ${results.length}`);
	console.log(
		`with errors: ${results.filter((r) => r.errors?.length > 0).length}`,
	);
	if (args.dryRun) {
		console.log(
			'\n⚠ DRY-RUN — nenhuma alteração foi aplicada. Re-rode com --apply para executar.',
		);
	}
}

main().catch((e) => {
	console.error('FATAL:', e);
	process.exit(1);
});
