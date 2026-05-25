import { supabase } from '../lib/supabase.js';

interface ListContentsFilters {
	parentId?: string | null;
	search?: string;
	category?: string;
	format?: string;
	sort?: 'recent' | 'popular' | 'name';
	page?: number;
	limit?: number;
}

class VectorLibraryRepository {
	async listContentsFiltered(
		filters: ListContentsFilters,
		customerId: string | null,
	) {
		const {
			parentId = null,
			search,
			category,
			format,
			sort = 'name',
			page = 1,
			limit = 50,
		} = filters;
		const offset = (page - 1) * limit;

		const folderQuery = supabase
			.from('pl_vector_library_folder')
			.select('*')
			.order('order', { ascending: true });

		if (parentId === null) folderQuery.is('parentId', null);
		else folderQuery.eq('parentId', parentId);

		let fileQuery = supabase
			.from('pl_vector_library_file')
			.select('*', { count: 'exact' });

		// Com categoria: busca em TODAS as pastas (ignora folderId) e não lista
		// pastas. Sem categoria: navega por pasta (folderId = parentId).
		if (!category) {
			if (parentId === null) fileQuery = fileQuery.is('folderId', null);
			else fileQuery = fileQuery.eq('folderId', parentId);
		}

		if (search) fileQuery = fileQuery.ilike('name', `%${search}%`);
		if (category) fileQuery = fileQuery.eq('category', category);
		if (format) fileQuery = fileQuery.contains('formats', [format]);

		if (sort === 'recent') {
			fileQuery = fileQuery.order('createdAt', { ascending: false });
		} else if (sort === 'popular') {
			fileQuery = fileQuery.order('downloadCount', { ascending: false });
		} else {
			fileQuery = fileQuery.order('order', { ascending: true });
		}

		fileQuery = fileQuery.range(offset, offset + limit - 1);

		const filesResult = await fileQuery;
		const foldersResult = category
			? { data: [] as Record<string, unknown>[], error: null }
			: await folderQuery;

		if (foldersResult.error) throw new Error(foldersResult.error.message);
		if (filesResult.error) throw new Error(filesResult.error.message);

		const files = filesResult.data ?? [];

		// favorites
		let favoritedSet = new Set<string>();
		if (customerId && files.length > 0) {
			const { data: favs } = await supabase
				.from('pl_vector_library_favorite')
				.select('fileId')
				.eq('customerId', customerId)
				.in(
					'fileId',
					files.map((f: { id: string }) => f.id),
				);
			favoritedSet = new Set(
				(favs ?? []).map((f: { fileId: string }) => f.fileId),
			);
		}

		return {
			folders: foldersResult.data ?? [],
			files: files.map((f: { id: string } & Record<string, unknown>) => ({
				...f,
				isFavorited: favoritedSet.has(f.id),
			})),
			total: filesResult.count ?? 0,
		};
	}

	async stats(customerId: string | null) {
		const [files, folders, favorites, downloads] = await Promise.all([
			supabase
				.from('pl_vector_library_file')
				.select('id', { count: 'exact', head: true }),
			supabase
				.from('pl_vector_library_folder')
				.select('id', { count: 'exact', head: true }),
			customerId
				? supabase
						.from('pl_vector_library_favorite')
						.select('fileId', { count: 'exact', head: true })
						.eq('customerId', customerId)
				: Promise.resolve({ count: 0 }),
			supabase.from('pl_vector_library_file').select('downloadCount'),
		]);

		const totalDownloads = (
			(downloads as { data: { downloadCount: number }[] | null }).data ?? []
		).reduce((acc, r) => acc + (r.downloadCount ?? 0), 0);

		return {
			totalFiles: files.count ?? 0,
			totalCollections: folders.count ?? 0,
			totalFavorites: favorites.count ?? 0,
			totalDownloads,
		};
	}

	async listCategories() {
		const { data, error } = await supabase
			.from('pl_vector_library_file')
			.select('category');
		if (error) throw new Error(error.message);

		const counts = new Map<string, number>();
		for (const row of (data ?? []) as Array<{ category: string | null }>) {
			if (!row.category) continue;
			counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
		}
		return [...counts.entries()].map(([name, count]) => ({
			name,
			icon: null,
			count,
		}));
	}

	async listFormats() {
		const { data, error } = await supabase
			.from('pl_vector_library_file')
			.select('formats');
		if (error) throw new Error(error.message);

		const counts = new Map<string, number>();
		for (const row of (data ?? []) as Array<{ formats: string[] | null }>) {
			for (const fmt of row.formats ?? []) {
				if (!fmt) continue;
				counts.set(fmt, (counts.get(fmt) ?? 0) + 1);
			}
		}
		return [...counts.entries()]
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async addFavorite(fileId: string, customerId: string) {
		const { error } = await supabase
			.from('pl_vector_library_favorite')
			.upsert({ fileId, customerId });
		if (error) throw new Error(error.message);
	}

	async removeFavorite(fileId: string, customerId: string) {
		const { error } = await supabase
			.from('pl_vector_library_favorite')
			.delete()
			.eq('fileId', fileId)
			.eq('customerId', customerId);
		if (error) throw new Error(error.message);
	}

	async listFavorites(customerId: string) {
		const { data, error } = await supabase
			.from('pl_vector_library_favorite')
			.select('fileId, pl_vector_library_file!inner(*)')
			.eq('customerId', customerId);
		if (error) throw new Error(error.message);
		return (data ?? []).map(
			(row: { pl_vector_library_file: Record<string, unknown> }) => ({
				...row.pl_vector_library_file,
				isFavorited: true,
			}),
		);
	}

	async listFeatured() {
		const { data, error } = await supabase
			.from('pl_vector_library_file')
			.select('*')
			.eq('featured', true)
			.order('downloadCount', { ascending: false })
			.limit(20);
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async incrementDownload(fileId: string) {
		const { data: file } = await supabase
			.from('pl_vector_library_file')
			.select('downloadCount')
			.eq('id', fileId)
			.maybeSingle();
		const current =
			(file as { downloadCount: number } | null)?.downloadCount ?? 0;
		await supabase
			.from('pl_vector_library_file')
			.update({ downloadCount: current + 1 })
			.eq('id', fileId);
	}

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
		category?: string | null;
		formats?: string[] | null;
		featured?: boolean;
	}) {
		const { data: file, error } = await supabase
			.from('pl_vector_library_file')
			.insert({
				name: data.name,
				folderId: data.folderId,
				fileUrl: data.fileUrl,
				mimeType: data.mimeType,
				size: data.size,
				order: data.order,
				category: data.category ?? null,
				formats: data.formats ?? null,
				featured: data.featured ?? false,
			})
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

	async updateFile(
		id: string,
		data: {
			name?: string;
			category?: string | null;
			formats?: string[] | null;
			featured?: boolean;
		},
	) {
		const patch: Record<string, unknown> = {};
		if (data.name !== undefined) patch.name = data.name;
		if (data.category !== undefined) patch.category = data.category;
		if (data.formats !== undefined) patch.formats = data.formats;
		if (data.featured !== undefined) patch.featured = data.featured;

		const { data: row, error } = await supabase
			.from('pl_vector_library_file')
			.update(patch)
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return row;
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
