import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateCommunity } from '@/middleware/auth.js';
import {
	createChannelController,
	createEventController,
	createPostController,
	createProjectController,
	deleteChannelController,
	deleteEventController,
	deleteMessageController,
	getChannelsController,
	getEventsController,
	getMembersController,
	getMessagesController,
	getPostsController,
	getProjectsController,
	getRankingController,
	sendMessageController,
	updateChannelController,
	updateEventController,
} from '../controllers/community.js';
import {
	communityChannelSchema,
	communityEventSchema,
	communityMemberSchema,
	communityMessageSchema,
	communityPostSchema,
	communityProjectSchema,
	communityRankingSchema,
	createChannelSchema,
	createEventSchema,
	createPostSchema,
	createProjectSchema,
	updateChannelSchema,
	updateEventSchema,
} from '../types/community.js';
import { ErrorSchema } from '../types/error.js';

export async function communityRoute(server: FastifyInstance) {
	// ── Posts ────────────────────────────────────────────────────────────────

	server.get(
		'/community/posts',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'List community posts (paginated).',
				querystring: z.object({
					page: z.string().optional(),
					limit: z.string().optional(),
				}),
				response: {
					200: z.array(communityPostSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPostsController,
	);

	server.post(
		'/community/posts',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Create a new community post.',
				body: createPostSchema,
				response: {
					201: z.object({ id: z.string() }).passthrough(),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPostController,
	);

	// ── Channels ─────────────────────────────────────────────────────────────

	server.get(
		'/community/channels',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'List all community channels.',
				response: {
					200: z.array(communityChannelSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getChannelsController,
	);

	server.post(
		'/community/channels',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Create a new community channel.',
				body: createChannelSchema,
				response: {
					201: z.object({ id: z.string() }).passthrough(),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		createChannelController,
	);

	server.patch(
		'/community/channels/:channelId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Update a community channel.',
				params: z.object({ channelId: z.string() }),
				body: updateChannelSchema,
				response: {
					200: communityChannelSchema,
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateChannelController,
	);

	server.delete(
		'/community/channels/:channelId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Delete a community channel and all its messages.',
				params: z.object({ channelId: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteChannelController,
	);

	// ── Messages ──────────────────────────────────────────────────────────────

	server.get(
		'/community/channels/:channelId/messages',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'List messages for a channel (cursor-based pagination).',
				params: z.object({ channelId: z.string() }),
				querystring: z.object({
					before: z.string().optional(),
					limit: z.string().optional(),
				}),
				response: {
					200: z.array(communityMessageSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getMessagesController,
	);

	server.post(
		'/community/channels/:channelId/messages',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description:
					'Send a message to a channel (multipart/form-data). Fields: content (text), file (any file).',
				params: z.object({ channelId: z.string() }),
				response: {
					201: z.object({ id: z.string() }).passthrough(),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		sendMessageController,
	);

	server.delete(
		'/community/channels/:channelId/messages/:messageId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Delete a message from a channel.',
				params: z.object({ channelId: z.string(), messageId: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteMessageController,
	);

	// ── Members ───────────────────────────────────────────────────────────────

	server.get(
		'/community/members',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description:
					'List community members, optionally filtered by search or category.',
				querystring: z.object({
					search: z.string().optional(),
					category: z.string().optional(),
				}),
				response: {
					200: z.array(communityMemberSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getMembersController,
	);

	// ── Projects ──────────────────────────────────────────────────────────────

	server.get(
		'/community/projects',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'List community projects (paginated).',
				querystring: z.object({
					page: z.string().optional(),
					limit: z.string().optional(),
				}),
				response: {
					200: z.array(communityProjectSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getProjectsController,
	);

	server.post(
		'/community/projects',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Create a new community project.',
				body: createProjectSchema,
				response: {
					201: z.object({ id: z.string() }).passthrough(),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		createProjectController,
	);

	// ── Events ─────────────────────────────────────────────────────────────────

	server.get(
		'/community/events',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description:
					'List community events, optionally filtered by date range.',
				querystring: z.object({
					from: z.string().optional(),
					to: z.string().optional(),
				}),
				response: {
					200: z.array(communityEventSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getEventsController,
	);

	server.post(
		'/community/events',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Create a new community event.',
				body: createEventSchema,
				response: {
					201: communityEventSchema,
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		createEventController,
	);

	server.patch(
		'/community/events/:eventId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Update a community event.',
				params: z.object({ eventId: z.string() }),
				body: updateEventSchema,
				response: {
					200: communityEventSchema,
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateEventController,
	);

	server.delete(
		'/community/events/:eventId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Delete a community event.',
				params: z.object({ eventId: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteEventController,
	);

	// ── Ranking ────────────────────────────────────────────────────────────────

	server.get(
		'/community/ranking',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Get community ranking (all-time, week or month).',
				querystring: z.object({
					period: z.enum(['week', 'month']).optional(),
				}),
				response: {
					200: communityRankingSchema,
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getRankingController,
	);
}
