import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decrypt, encrypt } from '../lib/crypto.js';
import { sendProvisioningCompleteEmail } from '../lib/mailer.js';
import { runSqlOnTenant } from '../lib/postgres-runner.js';
import * as supabaseMgmt from '../lib/supabase-management.js';
import * as vercelApi from '../lib/vercel.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import {
	PROVISIONING_STATUS_ORDER,
	type ProvisioningPlan,
	type ProvisioningStatus,
} from '../types/provisioning.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function loadSql(filename: string): string {
	return readFileSync(resolve(__dirname, 'sql', filename), 'utf-8');
}

function requireField<T>(value: T | null | undefined, name: string): T {
	if (value == null) {
		throw new Error(`Required field "${name}" is missing from job`);
	}
	return value;
}

function isPastStatus(
	current: ProvisioningStatus,
	target: ProvisioningStatus,
): boolean {
	const currentIdx = PROVISIONING_STATUS_ORDER.indexOf(current);
	const targetIdx = PROVISIONING_STATUS_ORDER.indexOf(target);
	if (currentIdx === -1) return false;
	return currentIdx >= targetIdx;
}

async function transitionStep(
	jobId: string,
	fromStatus: ProvisioningStatus,
	toStatus: ProvisioningStatus,
	action: () => Promise<Partial<Record<string, unknown>> | undefined>,
): Promise<void> {
	const job = await provisioningRepository.findJobById(jobId);

	if (job.status === 'failed') {
		console.log(
			`[provision] Job ${jobId} is failed — skipping ${fromStatus} → ${toStatus}`,
		);
		return;
	}
	if (isPastStatus(job.status, toStatus)) {
		console.log(
			`[provision] Job ${jobId} already past ${toStatus} (current: ${job.status}) — skipping`,
		);
		return;
	}
	if (job.status !== fromStatus) {
		console.log(
			`[provision] Job ${jobId} status is ${job.status}, not ${fromStatus} — skipping`,
		);
		return;
	}

	console.log(`[provision] Job ${jobId}: ${fromStatus} → ${toStatus}...`);

	try {
		const updates = (await action()) ?? {};
		await provisioningRepository.updateJob(jobId, {
			status: toStatus,
			...updates,
		} as Record<string, unknown>);
		await provisioningRepository.createAuditLog({
			job_id: jobId,
			from_status: fromStatus,
			to_status: toStatus,
			message: `Transitioned from ${fromStatus} to ${toStatus}`,
		});
		console.log(`[provision] Job ${jobId}: ✓ ${toStatus}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error(
			`[provision] Job ${jobId}: ✗ FAILED at ${fromStatus} → ${toStatus}: ${message}`,
		);
		await provisioningRepository.updateJob(jobId, {
			status: 'failed',
			last_error: message,
			retry_count: (job.retry_count ?? 0) + 1,
		} as Record<string, unknown>);
		await provisioningRepository.createAuditLog({
			job_id: jobId,
			from_status: fromStatus,
			to_status: 'failed',
			message,
			metadata: { attempted_transition: toStatus },
		});
		throw err;
	}
}

function generatePassword(): string {
	return randomBytes(12).toString('base64url');
}

function getPlanForEnvVars(plan: ProvisioningPlan): Record<string, string> {
	if (plan === 'platina') {
		return {
			N8N_API_KEY:
				'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMDQ2ODNhYy0yOGYyLTRiNzEtYWJiMi1iZTAwOWU3ZDExOTQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzYxNzkwMzUwfQ.OZKT-rnxUzcqmrFRz5Yk2DFxLIbdlR0J769MrOMf0Q8',
			N8N_BASE_URL: 'https://n8n_metalaser-n8n-editor.1nwz76.easypanel.host/',
		};
	}
	return {};
}

export async function runProvisionTenant(jobId: string): Promise<void> {
	const job = await provisioningRepository.findJobById(jobId);
	if (!job) throw new Error(`Job ${jobId} not found`);
	if (job.status === 'completed') return;

	// Load the order to get customer and plan info
	const { supabase } = await import('../lib/supabase.js');
	const { data: order } = await supabase
		.from('pl_provisioning_order')
		.select('*, pl_provisioning_customer(*)')
		.eq('id', job.order_id)
		.single();

	if (!order) throw new Error(`Order ${job.order_id} not found`);

	const customer = order.pl_provisioning_customer;
	const plan = order.plan as ProvisioningPlan;
	const slug = job.slug;

	// Step 1: created -> payment_confirmed
	await transitionStep(
		jobId,
		'created',
		'payment_confirmed',
		async () => undefined,
	);

	// Step 2: payment_confirmed -> supabase_org_created
	// Uses existing Pro org from env var (no new org creation needed)
	await transitionStep(
		jobId,
		'payment_confirmed',
		'supabase_org_created',
		async () => {
			const orgId = process.env.SUPABASE_ORG_ID;
			if (!orgId) {
				throw new Error(
					'SUPABASE_ORG_ID is not defined — set it to your Pro organization ID',
				);
			}
			return { supabase_org_id: orgId };
		},
	);

	// Step 3: supabase_org_created -> supabase_project_creating
	await transitionStep(
		jobId,
		'supabase_org_created',
		'supabase_project_creating',
		async () => {
			const dbPass = randomBytes(20).toString('hex');

			// Save encrypted password IMMEDIATELY before creating project
			await provisioningRepository.updateJob(jobId, {
				supabase_db_pass_encrypted: encrypt(dbPass),
			} as Record<string, unknown>);

			const currentJob = await provisioningRepository.findJobById(jobId);
			const orgId = requireField(currentJob.supabase_org_id, 'supabase_org_id');

			const project = await supabaseMgmt.createProject({
				name: slug,
				orgId,
				region: 'sa-east-1',
				dbPass,
			});

			return {
				supabase_project_ref: project.ref,
				supabase_url: `https://${project.ref}.supabase.co`,
			};
		},
	);

	// Step 4: supabase_project_creating -> supabase_ready
	await transitionStep(
		jobId,
		'supabase_project_creating',
		'supabase_ready',
		async () => {
			const currentJob = await provisioningRepository.findJobById(jobId);
			const ref = requireField(
				currentJob.supabase_project_ref,
				'supabase_project_ref',
			);
			await supabaseMgmt.waitProjectReady(ref);
			return undefined;
		},
	);

	// Step 5: supabase_ready -> sql_bootstrapped
	await transitionStep(
		jobId,
		'supabase_ready',
		'sql_bootstrapped',
		async () => {
			const currentJob = await provisioningRepository.findJobById(jobId);
			const dbPass = decrypt(
				requireField(
					currentJob.supabase_db_pass_encrypted,
					'supabase_db_pass_encrypted',
				),
			);
			const ref = requireField(
				currentJob.supabase_project_ref,
				'supabase_project_ref',
			);
			const bootstrapSql = loadSql('bootstrap.sql');

			await runSqlOnTenant({ ref, dbPass, sql: bootstrapSql });
			return undefined;
		},
	);

	// Step 6: sql_bootstrapped -> admin_created
	await transitionStep(jobId, 'sql_bootstrapped', 'admin_created', async () => {
		const currentJob = await provisioningRepository.findJobById(jobId);
		const dbPass = decrypt(
			requireField(
				currentJob.supabase_db_pass_encrypted,
				'supabase_db_pass_encrypted',
			),
		);
		const ref = requireField(
			currentJob.supabase_project_ref,
			'supabase_project_ref',
		);

		const adminEmail = `admin@${slug}.com`;

		// Use the same password as the customer's course account
		let adminPassword: string;
		const { supabase: sb } = await import('../lib/supabase.js');
		const { data: lmsCustomer } = await sb
			.from('Customers')
			.select('password_encrypted')
			.eq('email', customer.email)
			.single();

		if (lmsCustomer?.password_encrypted) {
			adminPassword = decrypt(lmsCustomer.password_encrypted as string);
		} else {
			adminPassword = generatePassword();
		}

		// Load and replace placeholders in cria-admin.sql
		let adminSql = loadSql('cria-admin.sql');
		adminSql = adminSql.replaceAll('{{ADMIN_EMAIL}}', adminEmail);
		adminSql = adminSql.replaceAll('{{ADMIN_PASSWORD}}', adminPassword);
		adminSql = adminSql.replaceAll('{{COMPANY_NAME}}', customer.company_name);
		adminSql = adminSql.replaceAll('{{PLAN}}', plan.toUpperCase());

		await runSqlOnTenant({ ref, dbPass, sql: adminSql });

		// Get API keys
		const keys = await supabaseMgmt.getProjectApiKeys(ref);

		return {
			admin_email: adminEmail,
			admin_password_encrypted: encrypt(adminPassword),
			supabase_anon_key: keys.anonKey,
			supabase_service_role_key_encrypted: encrypt(keys.serviceRoleKey),
		};
	});

	// Step 7: admin_created -> vercel_project_created
	await transitionStep(
		jobId,
		'admin_created',
		'vercel_project_created',
		async () => {
			const project = await vercelApi.createProject(slug);
			return { vercel_project_id: project.id };
		},
	);

	// Step 8: vercel_project_created -> blob_created (optional — may fail with 403)
	await transitionStep(
		jobId,
		'vercel_project_created',
		'blob_created',
		async () => {
			const currentJob = await provisioningRepository.findJobById(jobId);
			const vercelProjectId = requireField(
				currentJob.vercel_project_id,
				'vercel_project_id',
			);
			try {
				const blob = await vercelApi.createBlobStore(slug, vercelProjectId);
				return {
					blob_store_id: blob.storeId,
					// Token is managed by Vercel via store connection — not stored here
					blob_token_encrypted: null,
				};
			} catch (err) {
				console.warn(
					`[provision] Job ${jobId}: Blob store creation failed (non-fatal), continuing without it:`,
					err instanceof Error ? err.message : String(err),
				);
				return {
					blob_store_id: null,
					blob_token_encrypted: null,
				};
			}
		},
	);

	// Step 9: blob_created -> vercel_envs_configured
	await transitionStep(
		jobId,
		'blob_created',
		'vercel_envs_configured',
		async () => {
			const currentJob = await provisioningRepository.findJobById(jobId);
			const dbPass = decrypt(
				requireField(
					currentJob.supabase_db_pass_encrypted,
					'supabase_db_pass_encrypted',
				),
			);
			const serviceRoleKey = decrypt(
				requireField(
					currentJob.supabase_service_role_key_encrypted,
					'supabase_service_role_key_encrypted',
				),
			);
			// Note: BLOB_READ_WRITE_TOKEN is managed by Vercel automatically
			// via the blob store connection made in the blob_created step.
			// Do NOT set it here — setEnvVars would delete and overwrite Vercel's token.
			const ref = requireField(
				currentJob.supabase_project_ref,
				'supabase_project_ref',
			);
			const anonKey = requireField(
				currentJob.supabase_anon_key,
				'supabase_anon_key',
			);
			const vercelProjectId = requireField(
				currentJob.vercel_project_id,
				'vercel_project_id',
			);

			// Get the correct pooler host dynamically from Supabase Management API
			const poolerHost = await supabaseMgmt.getPoolerHost(ref);

			const envVars: Record<string, string> = {
				// Tenant identity
				NEXT_PUBLIC_COMPANY_SYSTEM: customer.company_name,

				// Fixed secrets
				SESSION_SECRET: 'nextlayercorplaserOnetop123profissao',
				API_SECRET_TOKEN: 'nextlayerkey28230105@services321123-01',
				JWT_SECRET: 'nextLayerNetComPorteiraTOP123333',
				VECTORIZER_AI_API_KEY_ID: 'vk93cqz9wmfv5dg',
				VECTORIZER_AI_API_SECRET_KEY:
					'cm7c00lcnupav1g3r49huf7560blbmimgfobmrnhjp5lpvfocjsi',
				SPARTICUZ_CHROMIUM_VERSION: '119',
				OPENROUTER_API_KEY:
					'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',
				CRON_SECRET_KEY: 'NextLayerTop1Devs',
				ZAPI_CLIENT_TOKEN: 'F323220fc93044ee2aac8152882afe23fS',
				ZAPI_INSTANCE_ID: '',
				ZAPI_INSTANCE_TOKEN: '',
				NEXT_PUBLIC_SOCKET_URL: 'https://ws.nextlayer.dev',
				SMTP_HOST: 'smtp.gmail.com',
				SMTP_PORT: '587',
				SMTP_SECURE: 'false',
				SMTP_USER: 'nextlayerdev@gmail.com',
				SMTP_PASS: 'hpwh vyzn jgye pliq',
				NEXT_PUBLIC_API_URL:
					'https://profissao-laser-profissao-laser-back.1nwz76.easypanel.host',
				NEXT_PUBLIC_PROVISIONING_SECRET:
					'nextlayerkey28230105@services321123-01',

				// Dynamic — from provisioning (pooler host fetched from Supabase API)
				DATABASE_URL: `postgresql://postgres.${ref}:${dbPass}@${poolerHost}:6543/postgres?pgbouncer=true`,
				DIRECT_URL: `postgresql://postgres.${ref}:${dbPass}@${poolerHost}:5432/postgres`,
				NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
				NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
				SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
				// BLOB_READ_WRITE_TOKEN is auto-added by Vercel via blob store connection
				STRIPE_SECRET_KEY: '1',

				// Conditional — platina only
				...getPlanForEnvVars(plan),
			};

			await vercelApi.setEnvVars(vercelProjectId, envVars);
			return undefined;
		},
	);

	// Step 10: vercel_envs_configured -> vercel_deploying
	await transitionStep(
		jobId,
		'vercel_envs_configured',
		'vercel_deploying',
		async () => {
			const currentJob = await provisioningRepository.findJobById(jobId);
			const vercelProjectId = requireField(
				currentJob.vercel_project_id,
				'vercel_project_id',
			);
			const deployment = await vercelApi.triggerDeployment(vercelProjectId);
			return { vercel_deployment_id: deployment.id };
		},
	);

	// Step 11: vercel_deploying -> vercel_ready
	await transitionStep(jobId, 'vercel_deploying', 'vercel_ready', async () => {
		const currentJob = await provisioningRepository.findJobById(jobId);
		const deploymentId = requireField(
			currentJob.vercel_deployment_id,
			'vercel_deployment_id',
		);
		const vercelProjectId = requireField(
			currentJob.vercel_project_id,
			'vercel_project_id',
		);
		await vercelApi.waitDeploymentReady(deploymentId);
		// Fetch the real production domain assigned by Vercel (handles name conflicts)
		const domain = await vercelApi.getProjectDomain(vercelProjectId);
		// Strip https:// so the stored URL doesn't conflict with the frontend adding its own scheme
		const cleanDomain = domain.replace(/^https?:\/\//, '');
		return { vercel_url: `${cleanDomain}/login` };
	});

	// Step 12: vercel_ready -> completed
	await transitionStep(jobId, 'vercel_ready', 'completed', async () => {
		await provisioningRepository.updateOrderStatus(job.order_id, 'completed');

		// Send welcome email — non-fatal if it fails
		try {
			const currentJob = await provisioningRepository.findJobById(jobId);
			if (
				currentJob.admin_password_encrypted &&
				currentJob.vercel_url &&
				currentJob.admin_email
			) {
				const adminPassword = decrypt(currentJob.admin_password_encrypted);
				await sendProvisioningCompleteEmail({
					to: customer.email,
					companyName: customer.company_name ?? customer.name ?? 'Cliente',
					tenantUrl: currentJob.vercel_url,
					adminEmail: currentJob.admin_email,
					adminPassword,
					plan,
				});
				console.log(`[provision] ✓ Welcome email sent to ${customer.email}`);
			}
		} catch (emailErr) {
			console.error('[provision] ✗ Failed to send welcome email:', emailErr);
			// Don't throw — email failure must not break provisioning
		}

		return undefined;
	});
}
