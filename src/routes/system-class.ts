import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	addClassToSystemClassController,
	addProductToSystemClassController,
	createSystemClassController,
	deleteSystemClassController,
	getSystemClassController,
	listSystemClassesController,
	removeClassFromSystemClassController,
	removeProductFromSystemClassController,
	updateSystemClassController,
} from '../controllers/system-class.js';
import { ErrorSchema } from '../types/error.js';
import {
	addClassToSystemClassSchema,
	addProductToSystemClassSchema,
	createSystemClassSchema,
	systemClassSchema,
	systemClassWithRelationsSchema,
	updateSystemClassSchema,
} from '../types/system-class.js';

export async function systemClassRoute(server: FastifyInstance) {
	server.get(
		'/system-classes',
		{
			preHandler: [],
			schema: {
				description: 'List all system classes with their products and classes.',
				response: {
					200: z.array(systemClassWithRelationsSchema),
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		listSystemClassesController,
	);

	server.get(
		'/system-class/:id',
		{
			preHandler: [],
			schema: {
				description: 'Get a system class by ID with its products and classes.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					200: systemClassWithRelationsSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		getSystemClassController,
	);

	server.post(
		'/system-class',
		{
			preHandler: [],
			schema: {
				description: 'Create a new system class.',
				body: createSystemClassSchema,
				response: {
					201: systemClassSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		createSystemClassController,
	);

	server.patch(
		'/system-class/:id',
		{
			preHandler: [],
			schema: {
				description: 'Update a system class.',
				params: z.object({ id: z.string().uuid() }),
				body: updateSystemClassSchema,
				response: {
					200: systemClassSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateSystemClassController,
	);

	server.delete(
		'/system-class/:id',
		{
			preHandler: [],
			schema: {
				description: 'Delete a system class.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteSystemClassController,
	);

	server.post(
		'/system-class/:id/product',
		{
			preHandler: [],
			schema: {
				description: 'Add a product to a system class.',
				params: z.object({ id: z.string().uuid() }),
				body: addProductToSystemClassSchema,
				response: {
					201: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		addProductToSystemClassController,
	);

	server.delete(
		'/system-class/:id/product/:productId',
		{
			preHandler: [],
			schema: {
				description: 'Remove a product from a system class.',
				params: z.object({
					id: z.string().uuid(),
					productId: z.string(),
				}),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		removeProductFromSystemClassController,
	);

	server.post(
		'/system-class/:id/class',
		{
			preHandler: [],
			schema: {
				description: 'Add a class to a system class.',
				params: z.object({ id: z.string().uuid() }),
				body: addClassToSystemClassSchema,
				response: {
					201: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		addClassToSystemClassController,
	);

	server.delete(
		'/system-class/:id/class/:classId',
		{
			preHandler: [],
			schema: {
				description: 'Remove a class from a system class.',
				params: z.object({
					id: z.string().uuid(),
					classId: z.string().uuid(),
				}),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['System Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		removeClassFromSystemClassController,
	);
}
