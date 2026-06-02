import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authenticateCustomer } from '@/middleware/auth.js';
import {
	createParameterController,
	deleteParameterController,
	exportParametersController,
	getParameterController,
	getParameterPassesController,
	likeParameterController,
	listCommunityController,
	listMachinesController,
	listMaterialsController,
	listParametersController,
	parameterSidebarController,
	parameterStatsController,
	rateParameterController,
	saveParameterController,
	unsaveParameterController,
	updateParameterController,
	uploadParameterImageController,
} from '../controllers/parameter.js';
import { ErrorSchema } from '../types/error.js';
import {
	communityListQuery,
	createParameterSchema,
	exportQuery,
	listParametersQuery,
	machineSchema,
	materialSchema,
	parameterSchema,
	parameterSidebarSchema,
	parameterStatsSchema,
	parameterWithPassesSchema,
	rateParameterSchema,
	updateParameterSchema,
} from '../types/parameter.js';

export async function parameterRoute(server: FastifyInstance) {
	server.get(
		'/parameters',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List laser parameters with filters and pagination.',
				querystring: listParametersQuery,
				response: {
					200: z.object({
						data: z.array(parameterSchema),
						total: z.number(),
					}),
					500: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		listParametersController,
	);

	server.get(
		'/parameters/stats',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Stats: total parameters, machines, materials, contributors.',
				response: { 200: parameterStatsSchema, 500: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		parameterStatsController,
	);

	server.get(
		'/parameters/sidebar',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Sidebar: top contributors, recent activity, most used parameters.',
				response: { 200: parameterSidebarSchema, 500: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		parameterSidebarController,
	);

	server.get(
		'/parameters/machines',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Catalog of laser machines.',
				response: { 200: z.array(machineSchema), 500: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		listMachinesController,
	);

	server.get(
		'/parameters/materials',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Catalog of materials.',
				response: { 200: z.array(materialSchema), 500: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		listMaterialsController,
	);

	server.get(
		'/parameters/community',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Community-shared parameters with rating, likes.',
				querystring: communityListQuery,
				response: {
					200: z.object({
						data: z.array(parameterSchema),
						total: z.number(),
					}),
					500: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		listCommunityController,
	);

	server.get(
		'/parameters/export',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Export parameters table (CSV/PDF).',
				querystring: exportQuery,
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		exportParametersController,
	);

	server.get(
		'/parameters/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get a single parameter by id.',
				params: z.object({ id: z.string() }),
				response: { 200: parameterSchema, 404: ErrorSchema, 500: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		getParameterController,
	);

	server.get(
		'/parameters/:id/passes',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Get a parameter with its ordered passes (parent = pass 1).',
				params: z.object({ id: z.string() }),
				response: {
					200: parameterWithPassesSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		getParameterPassesController,
	);

	server.post(
		'/parameters',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a new laser parameter.',
				body: createParameterSchema,
				response: { 201: parameterSchema, 400: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		createParameterController,
	);

	server.post(
		'/parameters/image',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Upload a parameter image; returns its URL.',
				consumes: ['multipart/form-data'],
				response: {
					200: z.object({ url: z.string() }),
					400: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadParameterImageController,
	);

	server.put(
		'/parameters/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Update a parameter.',
				params: z.object({ id: z.string() }),
				body: updateParameterSchema,
				response: { 200: parameterSchema, 400: ErrorSchema, 404: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateParameterController,
	);

	server.delete(
		'/parameters/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Delete a parameter.',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteParameterController,
	);

	server.post(
		'/parameters/:id/save',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Bookmark a community parameter.',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		saveParameterController,
	);

	server.delete(
		'/parameters/:id/save',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Remove bookmark from a parameter.',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		unsaveParameterController,
	);

	server.post(
		'/parameters/:id/like',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Toggle like on a parameter.',
				params: z.object({ id: z.string() }),
				response: {
					200: z.object({ liked: z.boolean() }),
					400: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		likeParameterController,
	);

	server.post(
		'/parameters/:id/rate',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Rate a community parameter (1-5 stars).',
				params: z.object({ id: z.string() }),
				body: rateParameterSchema,
				response: { 204: z.null(), 400: ErrorSchema },
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		rateParameterController,
	);
}
