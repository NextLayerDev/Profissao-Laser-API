import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	confirmVideoUploadController,
	createLessonController,
	createPresignedVideoUrlController,
	deleteLessonController,
	listLessonsController,
	reorderLessonsController,
	updateLessonController,
	uploadLessonVideoController,
} from '../controllers/lesson.js';
import {
	deleteMaterialController,
	listMaterialsController,
	uploadLessonFileController,
	uploadMaterialController,
} from '../controllers/material.js';
import { ErrorSchema } from '../types/error.js';
import {
	confirmVideoUploadSchema,
	createLessonSchema,
	lessonSchema,
	presignedVideoUrlSchema,
	reorderLessonsSchema,
	updateLessonSchema,
} from '../types/lesson.js';
import { materialSchema } from '../types/material.js';

export async function lessonRoute(server: FastifyInstance) {
	server.get(
		'/module/:moduleId/lessons',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all lessons of a module ordered by position.',
				params: z.object({ moduleId: z.string() }),
				response: {
					200: z.array(lessonSchema),
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		listLessonsController,
	);

	server.post(
		'/lesson',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a new lesson inside a module.',
				body: createLessonSchema,
				response: {
					201: lessonSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		createLessonController,
	);

	server.put(
		'/lesson/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Update a lesson.',
				params: z.object({ id: z.string() }),
				body: updateLessonSchema,
				response: {
					200: lessonSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateLessonController,
	);

	server.post(
		'/lesson/:id/video/presigned-url',
		{
			preHandler: [authenticate],
			schema: {
				description: [
					'Get a signed upload URL for direct video upload to Supabase Storage.',
					'Use this for large videos to avoid 502/timeouts. Flow: 1) Call this endpoint, 2) Upload file to Supabase using `uploadToSignedUrl(path, token, file)` from Supabase client, 3) Call PATCH `/lesson/:id/video/confirm` with the path.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `filename` | string | — | Original filename (used for extension, defaults to .mp4) |',
				].join('\n'),
				params: z.object({ id: z.string() }),
				body: presignedVideoUrlSchema.optional(),
				response: {
					200: z.object({
						videoId: z.string(),
						tusEndpoint: z.string(),
						authSignature: z.string(),
						authExpire: z.number(),
						libraryId: z.string(),
					}),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPresignedVideoUrlController,
	);

	server.patch(
		'/lesson/:id/video/confirm',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Confirm video upload after direct upload to Supabase. Call after uploading via presigned URL.',
				params: z.object({ id: z.string() }),
				body: confirmVideoUploadSchema,
				response: {
					200: lessonSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		confirmVideoUploadController,
	);

	server.post(
		'/lesson/:id/video',
		{
			preHandler: [authenticate],
			schema: {
				description: [
					'Upload a video for a lesson via **multipart/form-data**.',
					'For large videos, prefer POST `/lesson/:id/video/presigned-url` + direct upload.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | Video file (MP4, MOV, AVI, etc.) |',
				].join('\n'),
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: lessonSchema,
					400: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadLessonVideoController,
	);

	server.patch(
		'/lesson/reorder',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Reorder lessons by position in the given array.',
				body: reorderLessonsSchema,
				response: {
					204: z.null(),
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderLessonsController,
	);

	server.delete(
		'/lesson/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Delete a lesson.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteLessonController,
	);

	// Materials
	server.get(
		'/lesson/:lessonId/materials',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all support materials for a lesson.',
				params: z.object({ lessonId: z.string() }),
				response: {
					200: z.array(materialSchema),
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		listMaterialsController,
	);

	server.post(
		'/lesson/:lessonId/material',
		{
			preHandler: [authenticate],
			schema: {
				description: [
					'Upload a support material to a lesson via **multipart/form-data**.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | Material file (PDF, Word, image, etc.) |',
					'| `name` | string | — | Display name for the material (defaults to filename) |',
				].join('\n'),
				params: z.object({ lessonId: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					201: materialSchema,
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadMaterialController,
	);

	server.post(
		'/lesson/:lessonId/file',
		{
			preHandler: [authenticate],
			schema: {
				description: [
					'Upload a document file to a lesson via **multipart/form-data**.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | Document file (PDF, Word, ODT, or any file) |',
					'| `name` | string | — | Display name for the file (defaults to filename) |',
				].join('\n'),
				params: z.object({ lessonId: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					201: materialSchema,
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadLessonFileController,
	);

	server.delete(
		'/lesson/:lessonId/material/:materialId',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Remove a support material from a lesson.',
				params: z.object({
					lessonId: z.string(),
					materialId: z.string(),
				}),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteMaterialController,
	);
}
