import { supabase } from '../lib/supabase.js';
import type {
	LaserLineType,
	LaserLineTypeSoftware,
	UpdateLaserLineType,
} from '../types/laser-line-type.js';

interface CreateLineTypeRow {
	software: LaserLineTypeSoftware;
	name: string;
	imageUrl: string | null;
	order: number;
}

class LaserLineTypeRepository {
	async list(software?: LaserLineTypeSoftware): Promise<LaserLineType[]> {
		let query = supabase
			.from('pl_laser_line_type')
			.select('*')
			.order('order', { ascending: true });
		if (software) query = query.eq('software', software);

		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return (data ?? []) as LaserLineType[];
	}

	async findById(id: string): Promise<LaserLineType> {
		const { data, error } = await supabase
			.from('pl_laser_line_type')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('LineType not found');
		return data as LaserLineType;
	}

	async create(row: CreateLineTypeRow): Promise<LaserLineType> {
		const { data, error } = await supabase
			.from('pl_laser_line_type')
			.insert(row)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as LaserLineType;
	}

	async update(id: string, patch: UpdateLaserLineType): Promise<LaserLineType> {
		const { data, error } = await supabase
			.from('pl_laser_line_type')
			.update(patch)
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('LineType not found');
		return data as LaserLineType;
	}

	async delete(id: string): Promise<{ imageUrl: string | null }> {
		// Pega imageUrl antes de deletar pra remover do CDN depois
		const { data: existing } = await supabase
			.from('pl_laser_line_type')
			.select('imageUrl')
			.eq('id', id)
			.maybeSingle();

		const { error } = await supabase
			.from('pl_laser_line_type')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
		return {
			imageUrl:
				(existing as { imageUrl: string | null } | null)?.imageUrl ?? null,
		};
	}
}

export const laserLineTypeRepository = new LaserLineTypeRepository();
