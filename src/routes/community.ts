import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateCommunity } from '@/middleware/auth.js';
import {
	createChannelController,
	createEventController,
	createPostCommentController,
	createPostController,
	createProjectCommentController,
	createProjectController,
	deleteChannelController,
	deleteEventController,
	deleteMessageController,
	deleteProjectController,
	getActivityController,
	getChannelsController,
	getEventsController,
	getMembersController,
	getMessagesController,
	getPostCommentsController,
	getPostsController,
	getProjectCommentsController,
	getProjectController,
	getProjectsController,
	getRankingController,
	sendMessageController,
	togglePostLikeController,
	updateChannelController,
	updateEventController,
	updateProjectController,
} from '../controllers/community.js';
import {
	activitySchema,
	communityChannelSchema,
	communityEventSchema,
	communityMemberSchema,
	communityMessageSchema,
	communityPostSchema,
	communityProjectSchema,
	communityRankingSchema,
	createChannelSchema,
	createCommentSchema,
	createEventSchema,
	createPostSchema,
	createProjectSchema,
	postCommentSchema,
	projectCommentSchema,
	projectDetailSchema,
	updateChannelSchema,
	updateEventSchema,
	updateProjectSchema,
} from '../types/community.js';
import { ErrorSchema } from '../types/error.js';

export async function communityRoute(server: FastifyInstance) {
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

	server.get(
		'/community/posts/:postId/comments',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'List comments for a community post (paginated).',
				params: z.object({ postId: z.string() }),
				querystring: z.object({
					page: z.string().optional(),
					limit: z.string().optional(),
				}),
				response: {
					200: z.array(postCommentSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPostCommentsController,
	);

	server.post(
		'/community/posts/:postId/comments',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Add a comment to a community post.',
				params: z.object({ postId: z.string() }),
				body: createCommentSchema,
				response: {
					201: postCommentSchema,
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPostCommentController,
	);

	server.post(
		'/community/posts/:postId/like',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Toggle like/unlike on a community post.',
				params: z.object({ postId: z.string() }),
				response: {
					200: z.object({ liked: z.boolean() }),
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		togglePostLikeController,
	);

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

	server.get(
		'/community/projects',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'List community projects (paginated).',
				querystring: z.object({
					page: z.string().optional(),
					limit: z.string().optional(),
					material: z.string().optional(),
					technique: z.string().optional(),
					search: z.string().optional(),
					sort: z.enum(['recent', 'likes']).optional(),
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

	server.get(
		'/community/projects/:projectId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Get a single community project with its comments.',
				params: z.object({ projectId: z.string() }),
				response: {
					200: projectDetailSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getProjectController,
	);

	server.patch(
		'/community/projects/:projectId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Update a community project (admin only).',
				params: z.object({ projectId: z.string() }),
				body: updateProjectSchema,
				response: {
					200: communityProjectSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateProjectController,
	);

	server.delete(
		'/community/projects/:projectId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Delete a community project (admin only).',
				params: z.object({ projectId: z.string() }),
				response: {
					204: z.null(),
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteProjectController,
	);

	server.get(
		'/community/projects/:projectId/comments',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'List comments for a community project.',
				params: z.object({ projectId: z.string() }),
				querystring: z.object({
					page: z.string().optional(),
					limit: z.string().optional(),
				}),
				response: {
					200: z.array(projectCommentSchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getProjectCommentsController,
	);

	server.post(
		'/community/projects/:projectId/comments',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Add a comment to a community project.',
				params: z.object({ projectId: z.string() }),
				body: createCommentSchema,
				response: {
					201: projectCommentSchema,
					400: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		createProjectCommentController,
	);

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

	server.get(
		'/community/activity',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Feed de atividades recentes da comunidade (paginado).',
				querystring: z.object({
					page: z.string().optional(),
					limit: z.string().optional(),
				}),
				response: {
					200: z.array(activitySchema),
					500: ErrorSchema,
				},
				tags: ['Community'],
				security: [{ bearerAuth: [] }],
			},
		},
		getActivityController,
	);
}
