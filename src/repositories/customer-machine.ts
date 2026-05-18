import { supabase } from '../lib/supabase.js';
import type {
	CustomerMachine,
	UpsertCustomerMachineInput,
} from '../types/customer-machine.js';

class CustomerMachineRepository {
	async findByCustomerId(customerId: string): Promise<CustomerMachine | null> {
		const { data, error } = await supabase
			.from('pl_customer_machine')
			.select('*')
			.eq('customerId', customerId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as CustomerMachine) ?? null;
	}

	/** UPSERT — cria ou atualiza a máquina do customer (singleton). */
	async upsert(
		customerId: string,
		data: UpsertCustomerMachineInput,
	): Promise<CustomerMachine> {
		const { data: record, error } = await supabase
			.from('pl_customer_machine')
			.upsert(
				{
					customerId,
					machineId: data.machineId,
					powerOptionId: data.powerOptionId ?? null,
					lensOptionId: data.lensOptionId ?? null,
					softwareOptionId: data.softwareOptionId ?? null,
					axisOptionId: data.axisOptionId ?? null,
					operationOptionId: data.operationOptionId ?? null,
					updatedAt: new Date().toISOString(),
				},
				{ onConflict: 'customerId' },
			)
			.select()
			.single();
		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to upsert customer machine');
		}
		return record as CustomerMachine;
	}

	async delete(customerId: string): Promise<void> {
		const { error } = await supabase
			.from('pl_customer_machine')
			.delete()
			.eq('customerId', customerId);
		if (error) throw new Error(error.message);
	}
}

export const customerMachineRepository = new CustomerMachineRepository();
