import { supabase } from '../lib/supabase.js';
import type {
	CreateProvisioningCustomer,
	CreateProvisioningJob,
	CreateProvisioningOrder,
	ProvisioningJob,
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

	async findCustomerByEmail(email: string) {
		const { data, error } = await supabase
			.from('pl_provisioning_customer')
			.select('*')
			.eq('email', email)
			.single();
		if (error && error.code !== 'PGRST116') throw new Error(error.message);
		return data;
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
}

export const provisioningRepository = new ProvisioningRepository();
