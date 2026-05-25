import { z } from 'zod';

export const vectorLibraryFolderSchema = z.object({
	id: z.string(),
	name: z.string(),
	parentId: z.string().nullable(),
	order: z.number(),
	createdAt: z.string(),
});

export const vectorLibraryFileSchema = z.object({
	id: z.string(),
	name: z.string(),
	folderId: z.string().nullable(),
	fileUrl: z.string(),
	mimeType: z.string(),
	size: z.number().nullable(),
	order: z.number(),
	formats: z.array(z.string()).nullable().optional(),
	downloadCount: z.number().optional(),
	category: z.string().nullable().optional(),
	featured: z.boolean().optional(),
	isFavorited: z.boolean().optional(),
	createdAt: z.string(),
});

export const vectorLibraryStatsSchema = z.object({
	totalFiles: z.number(),
	totalCollections: z.number(),
	totalFavorites: z.number(),
	totalDownloads: z.number(),
});

export const vectorLibraryCategorySchema = z.object({
	name: z.string(),
	icon: z.string().nullable().optional(),
	count: z.number(),
});

export const vectorLibraryFormatSchema = z.object({
	name: z.string(),
	count: z.number(),
});

export const listContentsQuery = z.object({
	parentId: z.string().optional(),
	search: z.string().optional(),
	category: z.string().optional(),
	format: z.string().optional(),
	sort: z.enum(['recent', 'popular', 'name']).optional(),
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(50),
});

export const contentsPaginatedSchema = z.object({
	folders: z.array(vectorLibraryFolderSchema),
	files: z.array(vectorLibraryFileSchema),
	total: z.number(),
});

export const contentsResponseSchema = z.object({
	folders: z.array(vectorLibraryFolderSchema),
	files: z.array(vectorLibraryFileSchema),
});

export const breadcrumbItemSchema = z.object({
	id: z.string().nullable(),
	name: z.string(),
});

export const createFolderSchema = z.object({
	name: z.string(),
	parentId: z.string().nullable(),
});

export const updateFolderSchema = z.object({
	name: z.string(),
});

export const updateFileSchema = z.object({
	name: z.string(),
});

export type CreateFolder = z.infer<typeof createFolderSchema>;
export type UpdateFolder = z.infer<typeof updateFolderSchema>;
export type UpdateFile = z.infer<typeof updateFileSchema>;
