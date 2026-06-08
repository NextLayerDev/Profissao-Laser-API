import { supabase } from '../lib/supabase.js';
import type {
	CreateCustomerMachineInput,
	CustomerMachine,
	UpdateCustomerMachineInput,
} from '../types/customer-machine.js';

interface CreateRow extends CreateCustomerMachineInput {
	id: string;
	customerId: string;
}

class CustomerMachineRepository {
	async listByCustomer(customerId: string): Promise<CustomerMachine[]> {
		const { data, error } = await supabase
			.from('pl_customer_machine')
			.select('*')
			.eq('customerId', customerId)
			.order('isDefault', { ascending: false })
			.order('createdAt', { ascending: false });
		if (error) throw new Error(error.message);
		return (data ?? []) as CustomerMachine[];
	}

	async findById(id: string, customerId: string): Promise<CustomerMachine> {
		const { data, error } = await supabase
			.from('pl_customer_machine')
			.select('*')
			.eq('id', id)
			.eq('customerId', customerId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Customer machine not found');
		return data as CustomerMachine;
	}

	async findDefaultByCustomer(
		customerId: string,
	): Promise<CustomerMachine | null> {
		const { data, error } = await supabase
			.from('pl_customer_machine')
			.select('*')
			.eq('customerId', customerId)
			.eq('isDefault', true)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as CustomerMachine) ?? null;
	}

	/** @deprecated use `findDefaultByCustomer` — alias retido pra compat. */
	async findByCustomerId(customerId: string): Promise<CustomerMachine | null> {
		return this.findDefaultByCustomer(customerId);
	}

	async countByCustomer(customerId: string): Promise<number> {
		const { count, error } = await supabase
			.from('pl_customer_machine')
			.select('id', { count: 'exact', head: true })
			.eq('customerId', customerId);
		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	async create(data: CreateRow): Promise<CustomerMachine> {
		const { data: record, error } = await supabase
			.from('pl_customer_machine')
			.insert({
				id: data.id,
				customerId: data.customerId,
				name: data.name ?? null,
				machineId: data.machineId,
				powerOptionId: data.powerOptionId ?? null,
				lensOptionId: data.lensOptionId ?? null,
				softwareOptionId: data.softwareOptionId ?? null,
				axisOptionId: data.axisOptionId ?? null,
				operationOptionId: data.operationOptionId ?? null,
				isDefault: data.isDefault ?? false,
			})
			.select()
			.single();
		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create customer machine');
		}
		return record as CustomerMachine;
	}

	async update(
		id: string,
		customerId: string,
		data: UpdateCustomerMachineInput,
	): Promise<CustomerMachine> {
		const { data: record, error } = await supabase
			.from('pl_customer_machine')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.eq('customerId', customerId)
			.select()
			.single();
		if (error || !record) throw new Error('Customer machine not found');
		return record as CustomerMachine;
	}

	async delete(id: string, customerId: string): Promise<void> {
		const { data: existing, error: findError } = await supabase
			.from('pl_customer_machine')
			.select('id')
			.eq('id', id)
			.eq('customerId', customerId)
			.maybeSingle();
		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Customer machine not found');

		const { error } = await supabase
			.from('pl_customer_machine')
			.delete()
			.eq('id', id)
			.eq('customerId', customerId);
		if (error) throw new Error(error.message);
	}

	/** Desmarca a máquina default atual do customer (pra promover outra). */
	async clearDefault(customerId: string): Promise<void> {
		const { error } = await supabase
			.from('pl_customer_machine')
			.update({ isDefault: false, updatedAt: new Date().toISOString() })
			.eq('customerId', customerId)
			.eq('isDefault', true);
		if (error) throw new Error(error.message);
	}

	/** Promove a máquina mais antiga do customer pra default. No-op se nenhuma. */
	async promoteOldestToDefault(customerId: string): Promise<void> {
		const { data, error } = await supabase
			.from('pl_customer_machine')
			.select('id')
			.eq('customerId', customerId)
			.order('createdAt', { ascending: true })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) return;
		const { error: upErr } = await supabase
			.from('pl_customer_machine')
			.update({ isDefault: true, updatedAt: new Date().toISOString() })
			.eq('id', (data as { id: string }).id);
		if (upErr) throw new Error(upErr.message);
	}
}

export const customerMachineRepository = new CustomerMachineRepository();
