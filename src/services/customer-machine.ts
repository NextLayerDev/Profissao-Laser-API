import crypto from 'node:crypto';
import { customerMachineRepository } from '../repositories/customer-machine.js';
import type {
	CreateCustomerMachineInput,
	CustomerMachine,
	UpdateCustomerMachineInput,
} from '../types/customer-machine.js';
import { machineService } from './machine.js';

class CustomerMachineService {
	async list(customerId: string): Promise<CustomerMachine[]> {
		return customerMachineRepository.listByCustomer(customerId);
	}

	async findDefault(customerId: string): Promise<CustomerMachine | null> {
		return customerMachineRepository.findDefaultByCustomer(customerId);
	}

	async create(
		customerId: string,
		data: CreateCustomerMachineInput,
	): Promise<CustomerMachine> {
		// Valida máquina + opções
		await machineService.validateConfig(data.machineId, {
			power: data.powerOptionId,
			lens: data.lensOptionId,
			software: data.softwareOptionId,
			axis: data.axisOptionId,
			operation: data.operationOptionId,
		});

		// 1ª máquina do customer vira default automaticamente. Senão respeita o flag.
		const count = await customerMachineRepository.countByCustomer(customerId);
		const resolvedDefault = count === 0 ? true : data.isDefault === true;

		// Se vai virar default e já existem outras → desmarca a default atual.
		if (resolvedDefault && count > 0) {
			await customerMachineRepository.clearDefault(customerId);
		}

		return customerMachineRepository.create({
			...data,
			id: crypto.randomUUID(),
			customerId,
			isDefault: resolvedDefault,
		});
	}

	async update(
		customerId: string,
		id: string,
		data: UpdateCustomerMachineInput,
	): Promise<CustomerMachine> {
		// Ownership check + obter estado atual
		const current = await customerMachineRepository.findById(id, customerId);

		// Revalida config se algum option/machine mudou
		const machineId = data.machineId ?? current.machineId;
		await machineService.validateConfig(machineId, {
			power:
				data.powerOptionId !== undefined
					? data.powerOptionId
					: current.powerOptionId,
			lens:
				data.lensOptionId !== undefined
					? data.lensOptionId
					: current.lensOptionId,
			software:
				data.softwareOptionId !== undefined
					? data.softwareOptionId
					: current.softwareOptionId,
			axis:
				data.axisOptionId !== undefined
					? data.axisOptionId
					: current.axisOptionId,
			operation:
				data.operationOptionId !== undefined
					? data.operationOptionId
					: current.operationOptionId,
		});

		// Se vai virar default → desmarca a default atual (clear-then-set)
		if (data.isDefault === true && !current.isDefault) {
			await customerMachineRepository.clearDefault(customerId);
		}

		return customerMachineRepository.update(id, customerId, data);
	}

	async delete(customerId: string, id: string): Promise<void> {
		const current = await customerMachineRepository.findById(id, customerId);
		await customerMachineRepository.delete(id, customerId);
		// Se era a default, promove a mais antiga das restantes
		if (current.isDefault) {
			await customerMachineRepository.promoteOldestToDefault(customerId);
		}
	}

	// ── Aliases pros endpoints singulares deprecated ─────────────────────────

	async upsertDefault(
		customerId: string,
		data: CreateCustomerMachineInput,
	): Promise<CustomerMachine> {
		const existing =
			await customerMachineRepository.findDefaultByCustomer(customerId);
		if (existing) {
			return this.update(customerId, existing.id, { ...data, isDefault: true });
		}
		return this.create(customerId, { ...data, isDefault: true });
	}

	async deleteDefault(customerId: string): Promise<void> {
		const existing =
			await customerMachineRepository.findDefaultByCustomer(customerId);
		if (!existing) return; // idempotente (204)
		await this.delete(customerId, existing.id);
	}
}

export const customerMachineService = new CustomerMachineService();
