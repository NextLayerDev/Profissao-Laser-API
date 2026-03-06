import { supabase } from '../lib/supabase.js';

class VectorLibraryRepository {
	async listContents(parentId: string | null) {
		const folderQuery = supabase
			.from('pl_vector_library_folder')
			.select('*')
			.order('order', { ascending: true });

		if (parentId === null) {
			folderQuery.is('parentId', null);
		} else {
			folderQuery.eq('parentId', parentId);
		}

		const fileQuery = supabase
			.from('pl_vector_library_file')
			.select('*')
			.order('order', { ascending: true });

		if (parentId === null) {
			fileQuery.is('folderId', null);
		} else {
			fileQuery.eq('folderId', parentId);
		}

		const [foldersResult, filesResult] = await Promise.all([
			folderQuery,
			fileQuery,
		]);

		if (foldersResult.error) throw new Error(foldersResult.error.message);
		if (filesResult.error) throw new Error(filesResult.error.message);

		return {
			folders: foldersResult.data ?? [],
			files: filesResult.data ?? [],
		};
	}

	async getFolderPath(
		folderId: string,
	): Promise<Array<{ id: string; name: string }>> {
		const path: Array<{ id: string; name: string }> = [];
		let currentId: string | null = folderId;

		while (currentId !== null) {
			const { data, error } = await supabase
				.from('pl_vector_library_folder')
				.select('id, name, parentId')
				.eq('id', currentId)
				.maybeSingle();

			if (error || !data) break;

			path.unshift({ id: data.id, name: data.name });
			currentId = data.parentId ?? null;
		}

		return path;
	}

	async createFolder(data: {
		name: string;
		parentId: string | null;
		order: number;
	}) {
		const { data: folder, error } = await supabase
			.from('pl_vector_library_folder')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return folder;
	}

	async getFolder(id: string) {
		const { data, error } = await supabase
			.from('pl_vector_library_folder')
			.select('*')
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data;
	}

	async updateFolder(id: string, name: string) {
		const { data, error } = await supabase
			.from('pl_vector_library_folder')
			.update({ name })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return data;
	}

	async deleteFolder(id: string): Promise<void> {
		const { error } = await supabase
			.from('pl_vector_library_folder')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}

	async getAllFileUrlsInFolder(folderId: string): Promise<string[]> {
		const urls: string[] = [];

		// Direct files in this folder
		const { data: files, error: filesError } = await supabase
			.from('pl_vector_library_file')
			.select('fileUrl')
			.eq('folderId', folderId);

		if (filesError) throw new Error(filesError.message);
		for (const f of files ?? []) urls.push(f.fileUrl);

		// Subfolders
		const { data: subfolders, error: subfoldersError } = await supabase
			.from('pl_vector_library_folder')
			.select('id')
			.eq('parentId', folderId);

		if (subfoldersError) throw new Error(subfoldersError.message);

		for (const sub of subfolders ?? []) {
			const subUrls = await this.getAllFileUrlsInFolder(sub.id);
			urls.push(...subUrls);
		}

		return urls;
	}

	async createFile(data: {
		name: string;
		folderId: string | null;
		fileUrl: string;
		mimeType: string;
		size: number | null;
		order: number;
	}) {
		const { data: file, error } = await supabase
			.from('pl_vector_library_file')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return file;
	}

	async getFile(id: string) {
		const { data, error } = await supabase
			.from('pl_vector_library_file')
			.select('*')
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data;
	}

	async updateFile(id: string, name: string) {
		const { data, error } = await supabase
			.from('pl_vector_library_file')
			.update({ name })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return data;
	}

	async deleteFile(id: string): Promise<string> {
		const { data, error: findError } = await supabase
			.from('pl_vector_library_file')
			.select('fileUrl')
			.eq('id', id)
			.maybeSingle();

		if (findError) throw new Error(findError.message);
		if (!data) throw new Error('File not found');

		const { error } = await supabase
			.from('pl_vector_library_file')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
		return data.fileUrl;
	}
}

export const vectorLibraryRepository = new VectorLibraryRepository();
