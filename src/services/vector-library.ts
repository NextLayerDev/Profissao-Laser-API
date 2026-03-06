import {
	deleteVectorLibraryFileByUrl,
	uploadVectorLibraryFile,
} from '../lib/storage.js';
import { vectorLibraryRepository } from '../repositories/vector-library.js';
import type { CreateFolder } from '../types/vector-library.js';

class VectorLibraryService {
	async getContents(parentId: string | null) {
		return vectorLibraryRepository.listContents(parentId);
	}

	async getBreadcrumbs(
		folderId: string | null,
	): Promise<Array<{ id: string | null; name: string }>> {
		const root = { id: null, name: 'Biblioteca' };
		if (!folderId) return [root];

		const path = await vectorLibraryRepository.getFolderPath(folderId);
		return [root, ...path];
	}

	async createFolder(data: CreateFolder) {
		const siblings = await vectorLibraryRepository.listContents(data.parentId);
		const order = siblings.folders.length;
		return vectorLibraryRepository.createFolder({ ...data, order });
	}

	async updateFolder(id: string, name: string) {
		return vectorLibraryRepository.updateFolder(id, name);
	}

	async deleteFolder(id: string): Promise<void> {
		const fileUrls = await vectorLibraryRepository.getAllFileUrlsInFolder(id);
		await Promise.all(fileUrls.map((url) => deleteVectorLibraryFileByUrl(url)));
		await vectorLibraryRepository.deleteFolder(id);
	}

	async createFile(
		folderId: string | null,
		buffer: Buffer,
		filename: string,
		mimetype: string,
		size: number | null,
		customName?: string,
	) {
		const ext = filename.split('.').pop() ?? 'bin';
		const storagePath = `${folderId ?? 'root'}/${crypto.randomUUID()}.${ext}`;
		const fileUrl = await uploadVectorLibraryFile(
			buffer,
			storagePath,
			mimetype,
		);

		const siblings = await vectorLibraryRepository.listContents(folderId);
		const order = siblings.files.length;

		return vectorLibraryRepository.createFile({
			name: customName ?? filename,
			folderId,
			fileUrl,
			mimeType: mimetype,
			size,
			order,
		});
	}

	async updateFile(id: string, name: string) {
		return vectorLibraryRepository.updateFile(id, name);
	}

	async deleteFile(id: string): Promise<void> {
		const fileUrl = await vectorLibraryRepository.deleteFile(id);
		await deleteVectorLibraryFileByUrl(fileUrl);
	}
}

export const vectorLibraryService = new VectorLibraryService();
