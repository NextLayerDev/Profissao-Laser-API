import { z } from 'zod';

export const provisioningStatusSchema = z.enum([
	'created',
	'payment_confirmed',
	'supabase_org_created',
	'supabase_project_creating',
	'supabase_ready',
	'sql_bootstrapped',
	'admin_created',
	'vercel_project_created',
	'blob_created',
	'vercel_envs_configured',
	'vercel_deploying',
	'vercel_ready',
	'completed',
	'failed',
]);

export const provisioningPlanSchema = z.enum(['prata', 'ouro', 'platina']);

export const provisioningCustomerSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	name: z.string(),
	company_name: z.string(),
	phone: z.string().nullable(),
	stripe_customer_id: z.string().nullable(),
	created_at: z.string(),
});

export const provisioningOrderSchema = z.object({
	id: z.string().uuid(),
	customer_id: z.string().uuid(),
	stripe_session_id: z.string(),
	stripe_subscription_id: z.string().nullable(),
	status: z.string(),
	plan: provisioningPlanSchema,
	metadata: z.record(z.string(), z.unknown()).nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const provisioningJobSchema = z.object({
	id: z.string().uuid(),
	order_id: z.string().uuid(),
	idempotency_key: z.string(),
	status: provisioningStatusSchema,
	slug: z.string(),
	retry_count: z.number(),
	last_error: z.string().nullable(),
	supabase_org_id: z.string().nullable(),
	supabase_project_ref: z.string().nullable(),
	supabase_db_pass_encrypted: z.string().nullable(),
	supabase_url: z.string().nullable(),
	supabase_anon_key: z.string().nullable(),
	supabase_service_role_key_encrypted: z.string().nullable(),
	vercel_project_id: z.string().nullable(),
	vercel_deployment_id: z.string().nullable(),
	vercel_url: z.string().nullable(),
	blob_store_id: z.string().nullable(),
	blob_token_encrypted: z.string().nullable(),
	admin_email: z.string().nullable(),
	admin_password_encrypted: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const provisioningAuditLogSchema = z.object({
	id: z.string().uuid(),
	job_id: z.string().uuid(),
	from_status: z.string().nullable(),
	to_status: z.string(),
	message: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).nullable(),
	created_at: z.string(),
});

export const createProvisioningCustomerSchema = z.object({
	email: z.string().email(),
	name: z.string(),
	company_name: z.string(),
	phone: z.string().nullable().optional(),
	stripe_customer_id: z.string().nullable().optional(),
});

export const createProvisioningOrderSchema = z.object({
	customer_id: z.string().uuid(),
	stripe_session_id: z.string(),
	stripe_subscription_id: z.string().nullable().optional(),
	status: z.string().default('pending'),
	plan: provisioningPlanSchema,
	metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const createProvisioningJobSchema = z.object({
	order_id: z.string().uuid(),
	idempotency_key: z.string(),
	slug: z.string(),
});

export const provisioningStatusResponseSchema = z.object({
	jobId: z.string().uuid(),
	status: provisioningStatusSchema,
	slug: z.string(),
	plan: provisioningPlanSchema.optional(),
	tenantUrl: z.string().nullable().optional(),
	adminEmail: z.string().nullable().optional(),
	adminPassword: z.string().nullable().optional(),
	customerEmail: z.string().nullable().optional(),
	customerPassword: z.string().nullable().optional(),
	retryCount: z.number().optional(),
	lastError: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ProvisioningStatus = z.infer<typeof provisioningStatusSchema>;
export type ProvisioningPlan = z.infer<typeof provisioningPlanSchema>;
export type ProvisioningCustomer = z.infer<typeof provisioningCustomerSchema>;
export type ProvisioningOrder = z.infer<typeof provisioningOrderSchema>;
export type ProvisioningJob = z.infer<typeof provisioningJobSchema>;
export type ProvisioningAuditLog = z.infer<typeof provisioningAuditLogSchema>;
export type CreateProvisioningCustomer = z.infer<
	typeof createProvisioningCustomerSchema
>;
export type CreateProvisioningOrder = z.infer<
	typeof createProvisioningOrderSchema
>;
export type CreateProvisioningJob = z.infer<typeof createProvisioningJobSchema>;

export const PROVISIONING_STATUS_ORDER: ProvisioningStatus[] = [
	'created',
	'payment_confirmed',
	'supabase_org_created',
	'supabase_project_creating',
	'supabase_ready',
	'sql_bootstrapped',
	'admin_created',
	'vercel_project_created',
	'blob_created',
	'vercel_envs_configured',
	'vercel_deploying',
	'vercel_ready',
	'completed',
];
