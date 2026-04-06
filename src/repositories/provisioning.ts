import { supabase } from '../lib/supabase.js';
import type {
	CreateProvisioningCustomer,
	CreateProvisioningJob,
	CreateProvisioningOrder,
	CreateTenant,
	CreateTenantPlanHistory,
	ProvisioningCustomer,
	ProvisioningJob,
	Tenant,
} from '../types/provisioning.js';

class ProvisioningRepository {
	// ========== CUSTOMERS ==========

	async createCustomer(data: CreateProvisioningCustomer) {
		const { data: result, error } = await supabase
			.from('pl_provisioning_customer')
			.upsert(data, { onConflict: 'email' })
			.select()
			.single();
		if (error) throw new Error(error.message);
		return result;
	}

	async findNamesByEmails(emails: string[]): Promise<Record<string, string>> {
		if (emails.length === 0) return {};
		const { data, error } = await supabase
			.from('pl_provisioning_customer')
			.select('email, name')
			.in('email', emails);
		if (error) throw new Error(error.message);
		return Object.fromEntries((data ?? []).map((r) => [r.email, r.name]));
	}

	async findCustomerByEmail(email: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_customer')
			.select('*')
			.eq('email', email)
			.single();
		if (error && error.code !== 'PGRST116') throw new Error(error.message);
		return data as ProvisioningCustomer | null;
	}

	async findCustomerById(id: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_customer')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data as ProvisioningCustomer | null;
	}

	// ========== ORDERS ==========

	async createOrder(data: CreateProvisioningOrder) {
		const { data: result, error } = await supabase
			.from('pl_provisioning_order')
			.insert({
				...data,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return result;
	}

	async findOrderBySessionId(sessionId: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_order')
			.select('*')
			.eq('stripe_session_id', sessionId)
			.single();
		if (error && error.code !== 'PGRST116') throw new Error(error.message);
		return data;
	}

	async updateOrderStatus(
		id: string,
		status: string,
		extra?: Record<string, unknown>,
	) {
		const { error } = await supabase
			.from('pl_provisioning_order')
			.update({ status, ...extra, updated_at: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ========== JOBS ==========

	async createJob(data: CreateProvisioningJob) {
		const { data: result, error } = await supabase
			.from('pl_provisioning_job')
			.insert({
				...data,
				status: 'created',
				retry_count: 0,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return result as ProvisioningJob;
	}

	async findJobById(id: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_job')
			.select('*')
			.eq('id', id)
			.single();
		if (error) throw new Error(error.message);
		return data as ProvisioningJob;
	}

	async findJobByIdempotencyKey(key: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_job')
			.select('*')
			.eq('idempotency_key', key)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data as ProvisioningJob | null;
	}

	async findJobBySlug(slug: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_job')
			.select('*')
			.eq('slug', slug)
			.order('created_at', { ascending: false })
			.limit(1);
		if (error) throw new Error(error.message);
		return (data && data.length > 0 ? data[0] : null) as ProvisioningJob | null;
	}

	async findAllJobsBySlug(slug: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_job')
			.select('*')
			.eq('slug', slug);
		if (error) throw new Error(error.message);
		return (data ?? []) as ProvisioningJob[];
	}

	async deleteAllNonCompletedJobsBySlug(slug: string) {
		const jobs = await this.findAllJobsBySlug(slug);
		for (const job of jobs) {
			if (job.status !== 'completed') {
				await this.deleteJob(job.id);
			}
		}
		return jobs.filter((j) => j.status !== 'completed').length;
	}

	async deleteJob(id: string) {
		// Delete audit logs first (FK constraint)
		await supabase.from('pl_provisioning_audit_log').delete().eq('job_id', id);
		const { error } = await supabase
			.from('pl_provisioning_job')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	async updateJob(id: string, updates: Partial<ProvisioningJob>) {
		const { error } = await supabase
			.from('pl_provisioning_job')
			.update({ ...updates, updated_at: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ========== ORDERS WITH CUSTOMER ==========

	async findOrderWithCustomer(orderId: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_order')
			.select('plan, pl_provisioning_customer(email)')
			.eq('id', orderId)
			.single();
		if (error && error.code !== 'PGRST116') throw new Error(error.message);
		return data;
	}

	// ========== AUDIT LOGS ==========

	async createAuditLog(data: {
		job_id: string;
		from_status?: string;
		to_status: string;
		message?: string;
		metadata?: Record<string, unknown>;
	}) {
		const { error } = await supabase.from('pl_provisioning_audit_log').insert({
			...data,
			created_at: new Date().toISOString(),
		});
		if (error) throw new Error(error.message);
	}

	async findAuditLogsByJobId(jobId: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_audit_log')
			.select('id, from_status, to_status, message, created_at')
			.eq('job_id', jobId)
			.order('created_at', { ascending: true });
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async findLastSuccessfulStatus(jobId: string): Promise<string> {
		const { data, error } = await supabase
			.from('pl_provisioning_audit_log')
			.select('to_status')
			.eq('job_id', jobId)
			.neq('to_status', 'failed')
			.order('created_at', { ascending: false })
			.limit(1);
		if (error) throw new Error(error.message);
		return data && data.length > 0 ? data[0].to_status : 'created';
	}

	// ========== TENANTS ==========

	async createTenant(data: CreateTenant) {
		const { data: result, error } = await supabase
			.from('pl_tenant')
			.insert({
				...data,
				status: 'active',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return result as Tenant;
	}

	async findTenantBySlug(slug: string) {
		const { data, error } = await supabase
			.from('pl_tenant')
			.select('*')
			.eq('slug', slug)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data as Tenant | null;
	}

	async findAllTenants() {
		const { data, error } = await supabase
			.from('pl_tenant')
			.select('*, pl_provisioning_customer(name, email)')
			.order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async findActiveTenantByCustomerEmail(email: string) {
		const { data, error } = await supabase
			.from('pl_tenant')
			.select('*, pl_provisioning_customer!inner(email)')
			.eq('pl_provisioning_customer.email', email)
			.eq('status', 'active')
			.order('created_at', { ascending: false })
			.limit(1);
		if (error) throw new Error(error.message);
		if (!data || data.length === 0) return null;
		const { pl_provisioning_customer: _, ...tenant } = data[0];
		return tenant as Tenant;
	}

	async updateTenantPlan(id: string, plan: string) {
		const { error } = await supabase
			.from('pl_tenant')
			.update({
				current_plan: plan,
				plan_changed_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	async updateTenantStatus(id: string, status: string) {
		const { error } = await supabase
			.from('pl_tenant')
			.update({
				status,
				updated_at: new Date().toISOString(),
			})
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ========== PLAN HISTORY ==========

	async createPlanHistory(data: CreateTenantPlanHistory) {
		const { error } = await supabase.from('pl_tenant_plan_history').insert({
			...data,
			created_at: new Date().toISOString(),
		});
		if (error) throw new Error(error.message);
	}
}

export const provisioningRepository = new ProvisioningRepository();
