import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decrypt } from '../lib/crypto.js';
import { supabase } from '../lib/supabase.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import {
	PROVISIONING_STATUS_ORDER,
	provisioningStatusResponseSchema,
} from '../types/provisioning.js';
import { runProvisionTenant } from '../workers/provision-tenant.js';

const paramsSchema = z.object({
	jobId: z.string().uuid(),
});

const sessionParamsSchema = z.object({
	sessionId: z.string(),
});

const jobBySessionResponseSchema = z.object({
	jobId: z.string().uuid(),
	status: z.string(),
});

const retryResponseSchema = z.object({
	message: z.string(),
	jobId: z.string().uuid(),
	status: z.string(),
});

const auditLogSchema = z.object({
	id: z.string().uuid(),
	from_status: z.string().nullable(),
	to_status: z.string(),
	message: z.string().nullable(),
	created_at: z.string(),
});

const logsResponseSchema = z.object({
	jobId: z.string().uuid(),
	logs: z.array(auditLogSchema),
});

export async function provisioningRoute(server: FastifyInstance) {
	// ===== GET /by-session/:sessionId =====
	server.get(
		'/internal/provisioning/by-session/:sessionId',
		{
			schema: {
				description: 'Find provisioning job by Stripe session ID',
				tags: ['Provisioning'],
				params: sessionParamsSchema,
				response: {
					200: jobBySessionResponseSchema,
					404: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { sessionId } = request.params as z.infer<
					typeof sessionParamsSchema
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
				params: paramsSchema,
				response: {
					200: provisioningStatusResponseSchema,
					404: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { jobId } = request.params as z.infer<typeof paramsSchema>;
				const job = await provisioningRepository.findJobById(jobId);

				if (!job) {
					return reply.status(404).send({ message: 'Job not found' });
				}

				// Get the order with customer info
				const { data: order } = await supabase
					.from('pl_provisioning_order')
					.select('plan, pl_provisioning_customer(email)')
					.eq('id', job.order_id)
					.single();

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

					// Fetch course password from LMS Customers table
					let coursePassword: string | null = null;
					if (customerEmail) {
						const { data: lmsCustomer } = await supabase
							.from('Customers')
							.select('password_encrypted')
							.eq('email', customerEmail)
							.single();
						if (lmsCustomer?.password_encrypted) {
							coursePassword = decrypt(
								lmsCustomer.password_encrypted as string,
							);
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
				params: paramsSchema,
				response: {
					200: retryResponseSchema,
					404: z.object({ message: z.string() }),
					409: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { jobId } = request.params as z.infer<typeof paramsSchema>;
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
					// Find the last successful status from audit logs
					const { data: logs } = await supabase
						.from('pl_provisioning_audit_log')
						.select('to_status')
						.eq('job_id', jobId)
						.neq('to_status', 'failed')
						.order('created_at', { ascending: false })
						.limit(1);

					const lastGoodStatus =
						logs && logs.length > 0 ? logs[0].to_status : 'created';

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
				params: paramsSchema,
				response: {
					200: logsResponseSchema,
					404: z.object({ message: z.string() }),
					500: z.object({ message: z.string() }),
				},
			},
		},
		async (request, reply) => {
			try {
				const { jobId } = request.params as z.infer<typeof paramsSchema>;

				const { data: logs, error } = await supabase
					.from('pl_provisioning_audit_log')
					.select('id, from_status, to_status, message, created_at')
					.eq('job_id', jobId)
					.order('created_at', { ascending: true });

				if (error) throw new Error(error.message);

				if (!logs || logs.length === 0) {
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
}
