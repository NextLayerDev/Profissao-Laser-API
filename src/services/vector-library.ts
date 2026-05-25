import { withCapture } from '@/lib/sentry.js';
import {
	deleteVectorLibraryFileByUrl,
	uploadVectorLibraryFile,
} from '../lib/storage.js';
import { vectorLibraryRepository } from '../repositories/vector-library.js';
import type { CreateFolder } from '../types/vector-library.js';

export const vectorLibraryService = {
	async getContents(parentId: string | null) {
		return withCapture(() => vectorLibraryRepository.listContents(parentId));
	},

	async getContentsFiltered(
		filters: Parameters<typeof vectorLibraryRepository.listContentsFiltered>[0],
		customerId: string | null,
	) {
		return withCapture(() =>
			vectorLibraryRepository.listContentsFiltered(filters, customerId),
		);
	},

	async getStats(customerId: string | null) {
		return withCapture(() => vectorLibraryRepository.stats(customerId));
	},

	async listCategories() {
		return withCapture(() => vectorLibraryRepository.listCategories());
	},

	async listFormats() {
		return withCapture(() => vectorLibraryRepository.listFormats());
	},

	async addFavorite(fileId: string, customerId: string) {
		return withCapture(() =>
			vectorLibraryRepository.addFavorite(fileId, customerId),
		);
	},

	async removeFavorite(fileId: string, customerId: string) {
		return withCapture(() =>
			vectorLibraryRepository.removeFavorite(fileId, customerId),
		);
	},

	async listFavorites(customerId: string) {
		return withCapture(() => vectorLibraryRepository.listFavorites(customerId));
	},

	async listFeatured() {
		return withCapture(() => vectorLibraryRepository.listFeatured());
	},

	async getBreadcrumbs(folderId: string | null) {
		return withCapture(async () => {
			const root = { id: null, name: 'Biblioteca' };
			if (!folderId) return [root];

			const path = await vectorLibraryRepository.getFolderPath(folderId);
			return [root, ...path];
		});
	},

	async createFolder(data: CreateFolder) {
		return withCapture(async () => {
			const siblings = await vectorLibraryRepository.listContents(
				data.parentId,
			);
			const order = siblings.folders.length;
			return vectorLibraryRepository.createFolder({ ...data, order });
		});
	},

	async updateFolder(id: string, name: string) {
		return withCapture(() => vectorLibraryRepository.updateFolder(id, name));
	},

	async deleteFolder(id: string) {
		return withCapture(async () => {
			const fileUrls = await vectorLibraryRepository.getAllFileUrlsInFolder(id);
			await Promise.all(
				fileUrls.map((url) => deleteVectorLibraryFileByUrl(url)),
			);
			await vectorLibraryRepository.deleteFolder(id);
		});
	},

	async createFile(
		folderId: string | null,
		buffer: Buffer,
		filename: string,
		mimetype: string,
		size: number | null,
		customName?: string,
		config?: {
			category?: string | null;
			formats?: string[] | null;
			featured?: boolean;
		},
	) {
		return withCapture(async () => {
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
				category: config?.category ?? null,
				formats: config?.formats ?? null,
				featured: config?.featured ?? false,
			});
		});
	},

	async updateFile(
		id: string,
		data: {
			name?: string;
			category?: string | null;
			formats?: string[] | null;
			featured?: boolean;
		},
	) {
		return withCapture(() => vectorLibraryRepository.updateFile(id, data));
	},

	async deleteFile(id: string) {
		return withCapture(async () => {
			const fileUrl = await vectorLibraryRepository.deleteFile(id);
			await deleteVectorLibraryFileByUrl(fileUrl);
		});
	},
};
