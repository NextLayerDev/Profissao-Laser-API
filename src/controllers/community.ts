import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadCommunityFile } from '../lib/storage.js';
import { communityService } from '../services/community.js';
import {
	createChannelSchema,
	createCommentSchema,
	createEventSchema,
	createPostSchema,
	createProjectSchema,
	updateChannelSchema,
	updateEventSchema,
	updateProjectSchema,
} from '../types/community.js';

// ── Posts ──────────────────────────────────────────────────────────────────

export const getPostsController = async (
	request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>,
	reply: FastifyReply,
) => {
	try {
		const page = Number(request.query.page ?? 1);
		const limit = Number(request.query.limit ?? 20);
		const currentUserId = request.currentUser?.id;
		const posts = await communityService.listPosts(page, limit, currentUserId);
		return reply.send(posts);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createPostController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createPostSchema.parse(request.body);
		const userId = request.currentUser?.id ?? '';
		const customer = request.currentCustomer;
		const post = await communityService.createPost(data, {
			id: userId,
			name: customer?.name ?? request.currentUser?.email ?? 'Membro',
			avatar: customer?.image ?? null,
		});
		return reply.status(201).send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Channels ───────────────────────────────────────────────────────────────

export const getChannelsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const channels = await communityService.listChannels();
		return reply.send(channels);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createChannelController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createChannelSchema.parse(request.body);
		const channel = await communityService.createChannel(data);
		return reply.status(201).send(channel);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateChannelController = async (
	request: FastifyRequest<{ Params: { channelId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { channelId } = request.params;
		const data = updateChannelSchema.parse(request.body);
		const channel = await communityService.updateChannel(channelId, data);
		return reply.send(channel);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteChannelController = async (
	request: FastifyRequest<{ Params: { channelId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { channelId } = request.params;
		await communityService.deleteChannel(channelId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Messages ───────────────────────────────────────────────────────────────

export const getMessagesController = async (
	request: FastifyRequest<{
		Params: { channelId: string };
		Querystring: { before?: string; limit?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { channelId } = request.params;
		const before = request.query.before;
		const limit = Number(request.query.limit ?? 50);
		const currentUserId = request.currentUser?.id;
		const messages = await communityService.listMessages(
			channelId,
			before,
			limit,
			currentUserId,
		);
		return reply.send(messages);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const sendMessageController = async (
	request: FastifyRequest<{ Params: { channelId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { channelId } = request.params;

		const channel = await communityService.getChannel(channelId);
		if (channel?.adminOnly && request.currentCustomer) {
			return reply.status(403).send({
				message: 'Apenas administradores podem enviar mensagens neste canal',
			});
		}

		const parts = request.parts();
		let content = '';
		let fileUrl: string | undefined;

		for await (const part of parts) {
			if (part.type === 'field' && part.fieldname === 'content') {
				content = part.value as string;
			} else if (part.type === 'file' && part.fieldname === 'file') {
				const buffer = await part.toBuffer();
				const ext = part.filename?.split('.').pop() ?? 'bin';
				const path = `${channelId}/${crypto.randomUUID()}.${ext}`;
				fileUrl = await uploadCommunityFile(buffer, path, part.mimetype);
			}
		}

		if (!content && !fileUrl) {
			return reply.status(400).send({ message: 'Content or file is required' });
		}

		const userId = request.currentUser?.id ?? '';
		const customer = request.currentCustomer;
		const msg = await communityService.sendMessage(
			channelId,
			{ content },
			{
				id: userId,
				name: customer?.name ?? request.currentUser?.email ?? 'Membro',
				avatar: customer?.image ?? null,
			},
			fileUrl,
		);
		return reply.status(201).send(msg);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteMessageController = async (
	request: FastifyRequest<{ Params: { channelId: string; messageId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { channelId, messageId } = request.params;
		await communityService.deleteMessage(channelId, messageId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Members ────────────────────────────────────────────────────────────────

export const getMembersController = async (
	request: FastifyRequest<{
		Querystring: { search?: string; category?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { search, category } = request.query;
		const members = await communityService.listMembers(search, category);
		return reply.send(members);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ── Projects ───────────────────────────────────────────────────────────────

export const getProjectsController = async (
	request: FastifyRequest<{
		Querystring: {
			page?: string;
			limit?: string;
			material?: string;
			technique?: string;
			search?: string;
			sort?: string;
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const { page, limit, material, technique, search, sort } = request.query;
		const projects = await communityService.listProjects(
			Number(page ?? 1),
			Number(limit ?? 20),
			{ material, technique, search, sort },
		);
		return reply.send(projects);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getProjectController = async (
	request: FastifyRequest<{ Params: { projectId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { projectId } = request.params;
		const project = await communityService.getProject(projectId);
		if (!project) return reply.status(404).send({ message: 'Not found' });
		return reply.send(project);
	} catch (err) {
		return reply
			.status(500)
			.send({ message: err instanceof Error ? err.message : 'Unknown error' });
	}
};

export const updateProjectController = async (
	request: FastifyRequest<{ Params: { projectId: string } }>,
	reply: FastifyReply,
) => {
	if (request.currentCustomer)
		return reply.status(403).send({ message: 'Admin access required' });
	try {
		const { projectId } = request.params;
		const data = updateProjectSchema.parse(request.body);
		const project = await communityService.updateProject(projectId, data);
		return reply.send(project);
	} catch (err) {
		return reply
			.status(400)
			.send({ message: err instanceof Error ? err.message : 'Unknown error' });
	}
};

export const deleteProjectController = async (
	request: FastifyRequest<{ Params: { projectId: string } }>,
	reply: FastifyReply,
) => {
	if (request.currentCustomer)
		return reply.status(403).send({ message: 'Admin access required' });
	try {
		const { projectId } = request.params;
		await communityService.deleteProject(projectId);
		return reply.status(204).send();
	} catch (err) {
		return reply
			.status(400)
			.send({ message: err instanceof Error ? err.message : 'Unknown error' });
	}
};

export const getProjectCommentsController = async (
	request: FastifyRequest<{
		Params: { projectId: string };
		Querystring: { page?: string; limit?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { projectId } = request.params;
		const page = Number(request.query.page ?? 1);
		const limit = Number(request.query.limit ?? 20);
		const comments = await communityService.listProjectComments(
			projectId,
			page,
			limit,
		);
		return reply.send(comments);
	} catch (err) {
		return reply
			.status(500)
			.send({ message: err instanceof Error ? err.message : 'Unknown error' });
	}
};

export const createProjectCommentController = async (
	request: FastifyRequest<{ Params: { projectId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { projectId } = request.params;
		const data = createCommentSchema.parse(request.body);
		const isAdmin = !request.currentCustomer;
		const userId = request.currentUser?.id ?? '';
		const customer = request.currentCustomer;
		const comment = await communityService.createProjectComment(
			projectId,
			data,
			{
				authorId: userId,
				authorName: customer?.name ?? request.currentUser?.email ?? 'Admin',
				authorAvatar: customer?.image ?? null,
				isAdmin,
			},
		);
		return reply.status(201).send(comment);
	} catch (err) {
		return reply
			.status(400)
			.send({ message: err instanceof Error ? err.message : 'Unknown error' });
	}
};

export const createProjectController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createProjectSchema.parse(request.body);
		const authorId = request.currentUser?.id;
		const project = await communityService.createProject(data, authorId);
		return reply.status(201).send(project);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Events ─────────────────────────────────────────────────────────────────

export const getEventsController = async (
	request: FastifyRequest<{ Querystring: { from?: string; to?: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { from, to } = request.query;
		const events = await communityService.listEvents(from, to);
		return reply.send(events);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createEventController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createEventSchema.parse(request.body);
		const event = await communityService.createEvent(data);
		return reply.status(201).send(event);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateEventController = async (
	request: FastifyRequest<{ Params: { eventId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { eventId } = request.params;
		const data = updateEventSchema.parse(request.body);
		const event = await communityService.updateEvent(eventId, data);
		return reply.send(event);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteEventController = async (
	request: FastifyRequest<{ Params: { eventId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { eventId } = request.params;
		await communityService.deleteEvent(eventId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Ranking ────────────────────────────────────────────────────────────────

export const getRankingController = async (
	request: FastifyRequest<{ Querystring: { period?: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { period } = request.query;
		const ranking = await communityService.getRanking(period);
		return reply.send(ranking);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
