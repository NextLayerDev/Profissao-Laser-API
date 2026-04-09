import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateAdmin, authenticateCustomer } from '@/middleware/auth.js';
import {
	closeTicketController,
	createTicketController,
	getTicketController,
	listAdminTicketsController,
	listTicketsController,
	sendMessageController,
} from '../controllers/vector-support.js';
import { ErrorSchema } from '../types/error.js';
import {
	vectorSupportMessageSchema,
	vectorSupportTicketSchema,
	vectorSupportTicketSummarySchema,
} from '../types/vector-support.js';

export async function vectorSupportRoute(server: FastifyInstance) {
	server.get(
		'/vector-support/tickets',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: "List the current customer's vector support tickets.",
				querystring: z.object({ status: z.string().optional() }),
				response: {
					200: z.array(vectorSupportTicketSummarySchema),
					500: ErrorSchema,
				},
				tags: ['Vector Support'],
				security: [{ bearerAuth: [] }],
			},
		},
		listTicketsController,
	);

	server.post(
		'/vector-support/tickets',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Create a new vector support ticket (multipart/form-data). Fields: subject (text), initialMessage (text), files (multiple files).',
				response: {
					201: vectorSupportTicketSchema,
					400: ErrorSchema,
				},
				tags: ['Vector Support'],
				security: [{ bearerAuth: [] }],
			},
		},
		createTicketController,
	);

	server.get(
		'/vector-support/tickets/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Get a vector support ticket with messages and files.',
				params: z.object({ id: z.string() }),
				response: {
					200: vectorSupportTicketSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vector Support'],
				security: [{ bearerAuth: [] }],
			},
		},
		getTicketController,
	);

	server.get(
		'/vector-support/tickets/admin',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'List all vector support tickets (staff only).',
				querystring: z.object({ status: z.string().optional() }),
				response: {
					200: z.array(vectorSupportTicketSummarySchema),
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vector Support'],
				security: [{ bearerAuth: [] }],
			},
		},
		listAdminTicketsController,
	);

	server.post(
		'/vector-support/tickets/:id/messages',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Send a message in a vector support ticket (multipart/form-data). Fields: content (text), files (multiple files).',
				params: z.object({ id: z.string() }),
				response: {
					201: vectorSupportMessageSchema,
					400: ErrorSchema,
				},
				tags: ['Vector Support'],
				security: [{ bearerAuth: [] }],
			},
		},
		sendMessageController,
	);

	server.post(
		'/vector-support/tickets/:id/close',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Close a vector support ticket (staff only).',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Vector Support'],
				security: [{ bearerAuth: [] }],
			},
		},
		closeTicketController,
	);
}
