import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createFaqController,
	deleteFaqController,
	listFaqsController,
	reactToFaqController,
	removeReactionController,
	reorderFaqsController,
	updateFaqController,
	uploadFaqImageController,
} from '../controllers/faq.js';
import { authenticate, authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import { faqSchema, reactFaqSchema, reorderFaqSchema } from '../types/faq.js';

export async function faqRoute(server: FastifyInstance) {
	server.get(
		'/faqs',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all FAQs with reactions.',
				response: {
					200: z.array(faqSchema),
					500: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		listFaqsController,
	);

	server.post(
		'/faqs',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Create a new FAQ (admin only). Accepts multipart/form-data: question, answer, order (required) + image file (optional).',
				response: {
					201: faqSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		createFaqController,
	);

	server.post(
		'/faqs/reorder',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Reorder FAQs (admin only).',
				body: reorderFaqSchema,
				response: {
					204: z.null(),
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderFaqsController,
	);

	server.post(
		'/faqs/upload-image',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Upload a FAQ image (admin only, multipart/form-data).',
				response: {
					200: z.object({ url: z.string() }),
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadFaqImageController,
	);

	server.patch(
		'/faqs/:id',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Update a FAQ (admin only). Accepts multipart/form-data: question, answer, order (optional) + image file (optional). Send removeImage=true to clear the image.',
				params: z.object({ id: z.string() }),
				response: {
					200: faqSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateFaqController,
	);

	server.delete(
		'/faqs/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Delete a FAQ (admin only).',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteFaqController,
	);

	server.post(
		'/faqs/:id/react',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'React to a FAQ with an emoji.',
				params: z.object({ id: z.string() }),
				body: reactFaqSchema,
				response: {
					200: faqSchema,
					400: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		reactToFaqController,
	);

	server.delete(
		'/faqs/:id/react',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Remove a reaction from a FAQ.',
				params: z.object({ id: z.string() }),
				response: {
					200: faqSchema,
					400: ErrorSchema,
				},
				tags: ['FAQ'],
				security: [{ bearerAuth: [] }],
			},
		},
		removeReactionController,
	);
}
