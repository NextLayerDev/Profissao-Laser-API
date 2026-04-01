import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decrypt } from '../lib/crypto.js';
import { customerRepository } from '../repositories/customer.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import {
	PROVISIONING_STATUS_ORDER,
	provisioningJobBySessionResponseSchema,
	provisioningLogsResponseSchema,
	provisioningParamsSchema,
	provisioningRetryResponseSchema,
	provisioningSessionParamsSchema,
	provisioningStatusResponseSchema,
	tenantDirectUrlsResponseSchema,
} from '../types/provisioning.js';
import { runProvisionTenant } from '../workers/provision-tenant.js';

export async function provisioningRoute(server: FastifyInstance) {
	// ===== GET /by-session/:sessionId =====
	server.get(
		'/internal/provisioning/by-session/:sessionId',
		{
			schema: {
				description: 'Find provisioning job by Stripe session ID',
				tags: ['Provisioning'],
				params: provisioningSessionParamsSchema,
				response: {
					200: provisioningJobBySessionResponseSchema,
					404: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { sessionId } = request.params as z.infer<
					typeof provisioningSessionParamsSchema
				>;
				const job =
					await provisioningRepository.findJobByIdempotencyKey(sessionId);

				if (!job) {
					return reply.status(404).send({ message: 'Job not found' });
				}

				return reply.status(200).send({
					jobId: job.id,
					status: job.status,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				return reply.status(500).send({ message });
			}
		},
	);

	// ===== GET /:jobId/status =====
	server.get(
		'/internal/provisioning/:jobId/status',
		{
			schema: {
				description: 'Get provisioning job status',
				tags: ['Provisioning'],
				params: provisioningParamsSchema,
				response: {
					200: provisioningStatusResponseSchema,
					404: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { jobId } = request.params as z.infer<
					typeof provisioningParamsSchema
				>;
				const job = await provisioningRepository.findJobById(jobId);

				if (!job) {
					return reply.status(404).send({ message: 'Job not found' });
				}

				// Get the order with customer info via repository
				const order = await provisioningRepository.findOrderWithCustomer(
					job.order_id,
				);

				const base = {
					jobId: job.id,
					status: job.status,
					slug: job.slug,
					plan: order?.plan,
					createdAt: job.created_at,
					updatedAt: job.updated_at,
				};

				if (job.status === 'completed') {
					// Get customer email from provisioning customer
					const customerEmail =
						(
							order?.pl_provisioning_customer as unknown as {
								email: string;
							}
						)?.email ?? null;

					// Fetch course password from LMS Customers table via repository
					let coursePassword: string | null = null;
					if (customerEmail) {
						const passwordEncrypted =
							await customerRepository.findPasswordEncryptedByEmail(
								customerEmail,
							);
						if (passwordEncrypted) {
							coursePassword = decrypt(passwordEncrypted);
						}
					}

					return reply.status(200).send({
						...base,
						tenantUrl: job.vercel_url,
						adminEmail: job.admin_email,
						adminPassword: job.admin_password_encrypted
							? decrypt(job.admin_password_encrypted)
							: null,
						customerEmail,
						customerPassword: coursePassword,
					});
				}

				return reply.status(200).send({
					...base,
					retryCount: job.retry_count,
					lastError: job.last_error,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				return reply.status(500).send({ message });
			}
		},
	);

	// ===== POST /:jobId/retry =====
	server.post(
		'/internal/provisioning/:jobId/retry',
		{
			schema: {
				description:
					'Retry a failed/stalled provisioning job from where it left off',
				tags: ['Provisioning'],
				params: provisioningParamsSchema,
				response: {
					200: provisioningRetryResponseSchema,
					404: z.object({ message: z.string() }),
					409: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { jobId } = request.params as z.infer<
					typeof provisioningParamsSchema
				>;
				const job = await provisioningRepository.findJobById(jobId);

				if (!job) {
					return reply.status(404).send({ message: 'Job not found' });
				}

				if (job.status === 'completed') {
					return reply
						.status(409)
						.send({ message: 'Job is already completed' });
				}

				// If failed, revert to the last successful step so transitionStep can resume
				if (job.status === 'failed') {
					const lastGoodStatus =
						await provisioningRepository.findLastSuccessfulStatus(jobId);

					// Validate it's a known status
					const validStatus = PROVISIONING_STATUS_ORDER.includes(
						lastGoodStatus as (typeof PROVISIONING_STATUS_ORDER)[number],
					)
						? lastGoodStatus
						: 'created';

					await provisioningRepository.updateJob(jobId, {
						status: validStatus,
						last_error: null,
					} as Record<string, unknown>);

					server.log.info(
						{ jobId, from: 'failed', to: validStatus },
						'Reverted job status for retry',
					);
				}

				// Re-fetch to get updated status
				const updatedJob = await provisioningRepository.findJobById(jobId);

				// Fire and forget — run worker in background
				setImmediate(() => {
					runProvisionTenant(jobId).catch((err) => {
						server.log.error(
							{ err, jobId },
							'Provisioning worker failed (retry)',
						);
					});
				});

				return reply.status(200).send({
					message: 'Retry started',
					jobId: updatedJob.id,
					status: updatedJob.status,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				return reply.status(500).send({ message });
			}
		},
	);

	// ===== GET /:jobId/logs =====
	server.get(
		'/internal/provisioning/:jobId/logs',
		{
			schema: {
				description: 'Get audit logs for a provisioning job',
				tags: ['Provisioning'],
				params: provisioningParamsSchema,
				response: {
					200: provisioningLogsResponseSchema,
					404: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { jobId } = request.params as z.infer<
					typeof provisioningParamsSchema
				>;

				const logs = await provisioningRepository.findAuditLogsByJobId(jobId);

				if (logs.length === 0) {
					return reply
						.status(404)
						.send({ message: 'No logs found for this job' });
				}

				return reply.status(200).send({ jobId, logs });
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				return reply.status(500).send({ message });
			}
		},
	);

	// ===== GET /internal/tenants/direct-urls =====
	server.get(
		'/internal/tenants/direct-urls',
		{
			schema: {
				description:
					'List all tenants with decrypted DIRECT_URLs and service role keys',
				tags: ['Provisioning'],
				response: {
					200: tenantDirectUrlsResponseSchema,
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (_request, reply) => {
			try {
				const rows = await provisioningRepository.findAllTenants();

				const tenants = rows.map((row) => {
					const customer = row.pl_provisioning_customer as {
						name: string;
						email: string;
					} | null;

					let directUrl = '';
					try {
						const decryptedPass = decrypt(row.supabase_db_pass_encrypted);
						directUrl = `postgresql://postgres.${row.supabase_project_ref}:${encodeURIComponent(decryptedPass)}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
					} catch {
						directUrl = 'DECRYPTION_FAILED';
					}

					let serviceRoleKey = '';
					try {
						serviceRoleKey = decrypt(row.supabase_service_role_key_encrypted);
					} catch {
						serviceRoleKey = 'DECRYPTION_FAILED';
					}

					return {
						id: row.id,
						slug: row.slug,
						status: row.status,
						current_plan: row.current_plan,
						supabase_project_ref: row.supabase_project_ref,
						supabase_url: row.supabase_url,
						vercel_url: row.vercel_url,
						direct_url: directUrl,
						database_url: directUrl,
						supabase_anon_key: row.supabase_anon_key,
						supabase_service_role_key: serviceRoleKey,
						customer_name: customer?.name ?? null,
						customer_email: customer?.email ?? null,
						created_at: row.created_at,
						updated_at: row.updated_at,
					};
				});

				return reply.status(200).send({ tenants, count: tenants.length });
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				return reply.status(500).send({ message });
			}
		},
	);
}
