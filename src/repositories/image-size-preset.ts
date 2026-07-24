import { supabase } from '../lib/supabase.js';
import type {
	CreateImageSizePreset,
	ImageSizePreset,
	UpdateImageSizePreset,
} from '../types/image-size-preset.js';

const TABLE = 'pl_image_size_preset';

class ImageSizePresetRepository {
	async list(): Promise<ImageSizePreset[]> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.order('name', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as ImageSizePreset[];
	}

	async findById(id: string): Promise<ImageSizePreset | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as ImageSizePreset) ?? null;
	}

	async create(input: CreateImageSizePreset): Promise<ImageSizePreset> {
		const { data, error } = await supabase
			.from(TABLE)
			.insert(input)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as ImageSizePreset;
	}

	async update(
		id: string,
		input: UpdateImageSizePreset,
	): Promise<ImageSizePreset> {
		const { data, error } = await supabase
			.from(TABLE)
			.update({ ...input, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as ImageSizePreset;
	}

	async remove(id: string): Promise<void> {
		const { error } = await supabase.from(TABLE).delete().eq('id', id);
		if (error) throw new Error(error.message);
	}
}

export const imageSizePresetRepository = new ImageSizePresetRepository();
