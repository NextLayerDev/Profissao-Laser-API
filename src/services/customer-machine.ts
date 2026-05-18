import { customerMachineRepository } from '../repositories/customer-machine.js';
import type {
	CustomerMachine,
	UpsertCustomerMachineInput,
} from '../types/customer-machine.js';
import { machineService } from './machine.js';

class CustomerMachineService {
	async findByCustomer(customerId: string): Promise<CustomerMachine | null> {
		return customerMachineRepository.findByCustomerId(customerId);
	}

	async upsert(
		customerId: string,
		data: UpsertCustomerMachineInput,
	): Promise<CustomerMachine> {
		// Valida máquina + opções (categoria/máquina corretas)
		await machineService.validateConfig(data.machineId, {
			power: data.powerOptionId,
			lens: data.lensOptionId,
			software: data.softwareOptionId,
			axis: data.axisOptionId,
			operation: data.operationOptionId,
		});
		return customerMachineRepository.upsert(customerId, data);
	}

	async delete(customerId: string): Promise<void> {
		return customerMachineRepository.delete(customerId);
	}
}

export const customerMachineService = new CustomerMachineService();
