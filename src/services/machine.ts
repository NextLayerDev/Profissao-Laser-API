import crypto from 'node:crypto';
import { machineRepository } from '../repositories/machine.js';
import type {
	CreateMachineInput,
	CreateMachineOptionInput,
	Machine,
	MachineOption,
	MachineOptionCategory,
	MachineWithOptions,
	UpdateMachineInput,
	UpdateMachineOptionInput,
} from '../types/machine.js';

/** Config de máquina = optionId por categoria (cada um opcional). */
export type MachineConfig = Partial<
	Record<MachineOptionCategory, string | null | undefined>
>;

function groupOptions(options: MachineOption[]): MachineWithOptions['options'] {
	const grouped: MachineWithOptions['options'] = {
		power: [],
		lens: [],
		software: [],
		axis: [],
		operation: [],
	};
	for (const opt of options) {
		grouped[opt.category].push(opt);
	}
	return grouped;
}

class MachineService {
	async list(includeInactive: boolean): Promise<MachineWithOptions[]> {
		const machines = await machineRepository.listMachines(includeInactive);
		return Promise.all(
			machines.map(async (machine) => {
				const options = await machineRepository.listOptionsByMachine(
					machine.id,
					includeInactive,
				);
				return { ...machine, options: groupOptions(options) };
			}),
		);
	}

	async findById(
		id: string,
		includeInactive: boolean,
	): Promise<MachineWithOptions> {
		const machine = await machineRepository.findMachineById(id);
		const options = await machineRepository.listOptionsByMachine(
			id,
			includeInactive,
		);
		return { ...machine, options: groupOptions(options) };
	}

	async create(
		data: CreateMachineInput,
		createdBy: string | null,
	): Promise<Machine> {
		return machineRepository.createMachine({
			...data,
			id: crypto.randomUUID(),
			createdBy,
		});
	}

	async update(id: string, data: UpdateMachineInput): Promise<Machine> {
		return machineRepository.updateMachine(id, data);
	}

	async delete(id: string): Promise<void> {
		return machineRepository.deleteMachine(id);
	}

	// ── Options ───────────────────────────────────────────────────────────

	async createOption(
		machineId: string,
		data: CreateMachineOptionInput,
	): Promise<MachineOption> {
		// Garante que a máquina existe
		await machineRepository.findMachineById(machineId);
		return machineRepository.createOption(machineId, {
			...data,
			id: crypto.randomUUID(),
		});
	}

	async updateOption(
		machineId: string,
		optionId: string,
		data: UpdateMachineOptionInput,
	): Promise<MachineOption> {
		return machineRepository.updateOption(optionId, machineId, data);
	}

	async deleteOption(machineId: string, optionId: string): Promise<void> {
		return machineRepository.deleteOption(optionId, machineId);
	}

	/**
	 * Valida que a máquina existe e que cada optionId fornecido é uma opção
	 * daquela máquina e da categoria certa. Usado por customer-machine e
	 * product-parameter. Categorias sem optionId são ignoradas.
	 */
	async validateConfig(
		machineId: string,
		config: MachineConfig,
	): Promise<void> {
		await machineRepository.findMachineById(machineId);

		const entries = Object.entries(config).filter(
			([, value]) => !!value,
		) as Array<[MachineOptionCategory, string]>;
		if (entries.length === 0) return;

		const options = await machineRepository.findOptionsByIds(
			entries.map(([, id]) => id),
		);
		const byId = new Map(options.map((opt) => [opt.id, opt]));

		for (const [category, id] of entries) {
			const opt = byId.get(id);
			if (!opt || opt.machineId !== machineId || opt.category !== category) {
				throw new Error(`Opção inválida para a categoria '${category}'`);
			}
		}
	}
}

export const machineService = new MachineService();
