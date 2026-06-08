import { supabase } from '../lib/supabase.js';
import type {
	CreateMachineInput,
	CreateMachineOptionInput,
	Machine,
	MachineOption,
	UpdateMachineInput,
	UpdateMachineOptionInput,
} from '../types/machine.js';

class MachineRepository {
	// ── Machines ──────────────────────────────────────────────────────────

	async listMachines(includeInactive: boolean): Promise<Machine[]> {
		let query = supabase
			.from('pl_machine')
			.select('*')
			.order('order', { ascending: true });
		if (!includeInactive) query = query.eq('status', 'ativo');

		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return (data ?? []) as Machine[];
	}

	async findMachineById(id: string): Promise<Machine> {
		const { data, error } = await supabase
			.from('pl_machine')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Machine not found');
		return data as Machine;
	}

	async createMachine(
		data: CreateMachineInput & { id: string; createdBy: string | null },
	): Promise<Machine> {
		const { data: record, error } = await supabase
			.from('pl_machine')
			.insert(data)
			.select()
			.single();
		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create machine');
		}
		return record as Machine;
	}

	async updateMachine(id: string, data: UpdateMachineInput): Promise<Machine> {
		const { data: record, error } = await supabase
			.from('pl_machine')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error || !record) throw new Error('Machine not found');
		return record as Machine;
	}

	async deleteMachine(id: string): Promise<void> {
		const { data: existing, error: findError } = await supabase
			.from('pl_machine')
			.select('id')
			.eq('id', id)
			.maybeSingle();
		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Machine not found');

		const { error } = await supabase.from('pl_machine').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ── Options ───────────────────────────────────────────────────────────

	async listOptionsByMachine(
		machineId: string,
		includeInactive: boolean,
	): Promise<MachineOption[]> {
		let query = supabase
			.from('pl_machine_option')
			.select('*')
			.eq('machineId', machineId)
			.order('category', { ascending: true })
			.order('order', { ascending: true });
		if (!includeInactive) query = query.eq('status', 'ativo');

		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return (data ?? []) as MachineOption[];
	}

	/** Busca opções por uma lista de ids (usado pra validar associações). */
	async findOptionsByIds(ids: string[]): Promise<MachineOption[]> {
		if (ids.length === 0) return [];
		const { data, error } = await supabase
			.from('pl_machine_option')
			.select('*')
			.in('id', ids);
		if (error) throw new Error(error.message);
		return (data ?? []) as MachineOption[];
	}

	async createOption(
		machineId: string,
		data: CreateMachineOptionInput & { id: string },
	): Promise<MachineOption> {
		const { data: record, error } = await supabase
			.from('pl_machine_option')
			.insert({ ...data, machineId })
			.select()
			.single();
		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create machine option');
		}
		return record as MachineOption;
	}

	async updateOption(
		optionId: string,
		machineId: string,
		data: UpdateMachineOptionInput,
	): Promise<MachineOption> {
		const { data: record, error } = await supabase
			.from('pl_machine_option')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', optionId)
			.eq('machineId', machineId)
			.select()
			.single();
		if (error || !record) throw new Error('Machine option not found');
		return record as MachineOption;
	}

	async deleteOption(optionId: string, machineId: string): Promise<void> {
		const { data: existing, error: findError } = await supabase
			.from('pl_machine_option')
			.select('id')
			.eq('id', optionId)
			.eq('machineId', machineId)
			.maybeSingle();
		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Machine option not found');

		const { error } = await supabase
			.from('pl_machine_option')
			.delete()
			.eq('id', optionId)
			.eq('machineId', machineId);
		if (error) throw new Error(error.message);
	}
}

export const machineRepository = new MachineRepository();
