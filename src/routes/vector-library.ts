import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateVectorizacao } from '@/middleware/auth.js';
import {
	createFolderController,
	deleteFileController,
	deleteFolderController,
	getBreadcrumbsController,
	getContentsController,
	updateFileController,
	updateFolderController,
	uploadFileController,
} from '../controllers/vector-library.js';
import { ErrorSchema } from '../types/error.js';
import {
	breadcrumbItemSchema,
	contentsResponseSchema,
	createFolderSchema,
	updateFileSchema,
	updateFolderSchema,
	vectorLibraryFileSchema,
	vectorLibraryFolderSchema,
} from '../types/vector-library.js';

export async function vectorLibraryRoute(server: FastifyInstance) {
	server.get(
		'/community/vector-library/contents',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description:
					'List folders and files at a given level of the vector library.',
				querystring: z.object({ parentId: z.string().optional() }),
				response: {
					200: contentsResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		getContentsController,
	);

	server.get(
		'/community/vector-library/breadcrumbs',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Get breadcrumb path for a folder in the vector library.',
				querystring: z.object({ folderId: z.string().optional() }),
				response: {
					200: z.array(breadcrumbItemSchema),
					500: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		getBreadcrumbsController,
	);

	server.post(
		'/community/vector-library/folders',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Create a new folder in the vector library (admin only).',
				body: createFolderSchema,
				response: {
					201: vectorLibraryFolderSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		createFolderController,
	);

	server.patch(
		'/community/vector-library/folders/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Rename a folder in the vector library (admin only).',
				params: z.object({ id: z.string() }),
				body: updateFolderSchema,
				response: {
					200: vectorLibraryFolderSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateFolderController,
	);

	server.delete(
		'/community/vector-library/folders/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Delete a folder and all its contents (admin only).',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteFolderController,
	);

	server.post(
		'/community/vector-library/files',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description:
					'Upload a file to the vector library (admin only, multipart/form-data). Fields: file (required), name (optional custom name), folderId (query param).',
				querystring: z.object({ folderId: z.string().optional() }),
				response: {
					201: vectorLibraryFileSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadFileController,
	);

	server.patch(
		'/community/vector-library/files/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Rename a file in the vector library (admin only).',
				params: z.object({ id: z.string() }),
				body: updateFileSchema,
				response: {
					200: vectorLibraryFileSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateFileController,
	);

	server.delete(
		'/community/vector-library/files/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Delete a file from the vector library (admin only).',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Vector Library'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteFileController,
	);
}
