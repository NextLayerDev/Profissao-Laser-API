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

export const getPostsController = async (
	request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>,
	reply: FastifyReply,
) => {
	const page = Number(request.query.page ?? 1);
	const limit = Number(request.query.limit ?? 20);
	const currentUserId = request.currentUser?.id;
	const { data: posts, error } = await communityService.listPosts(
		page,
		limit,
		currentUserId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(posts);
};

export const createPostController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createPostSchema.parse(request.body);
		const userId = request.currentUser?.id ?? '';
		const customer = request.currentCustomer;
		const { data: post, error } = await communityService.createPost(data, {
			id: userId,
			name: customer?.name ?? request.currentUser?.email ?? 'Membro',
			avatar: customer?.image ?? null,
		});
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.status(201).send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const getPostCommentsController = async (
	request: FastifyRequest<{
		Params: { postId: string };
		Querystring: { page?: string; limit?: string };
	}>,
	reply: FastifyReply,
) => {
	const { postId } = request.params;
	const page = Number(request.query.page ?? 1);
	const limit = Number(request.query.limit ?? 20);
	const { data: comments, error } = await communityService.listPostComments(
		postId,
		page,
		limit,
	);
	if (error) {
		return reply.status(500).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	return reply.send(comments);
};

export const createPostCommentController = async (
	request: FastifyRequest<{ Params: { postId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { postId } = request.params;
		const data = createCommentSchema.parse(request.body);
		const isAdmin = !request.currentCustomer;
		const userId = request.currentUser?.id ?? '';
		const customer = request.currentCustomer;
		const { data: comment, error } = await communityService.createPostComment(
			postId,
			data,
			{
				authorId: userId,
				authorName: customer?.name ?? request.currentUser?.email ?? 'Admin',
				authorAvatar: customer?.image ?? null,
				isAdmin,
			},
		);
		if (error) {
			return reply.status(400).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		return reply.status(201).send(comment);
	} catch (err) {
		return reply
			.status(400)
			.send({ message: err instanceof Error ? err.message : 'Unknown error' });
	}
};

export const togglePostLikeController = async (
	request: FastifyRequest<{ Params: { postId: string } }>,
	reply: FastifyReply,
) => {
	const { postId } = request.params;
	const customerId =
		request.currentCustomer?.id ?? request.currentUser?.id ?? '';
	const { data: result, error } = await communityService.togglePostLike(
		postId,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.send(result);
};

export const getChannelsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data: channels, error } = await communityService.listChannels();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	const isAdmin = !request.currentCustomer;
	return reply.send(isAdmin ? channels : channels?.filter((c) => !c.adminView));
};

export const createChannelController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createChannelSchema.parse(request.body);
		const { data: channel, error } = await communityService.createChannel(data);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
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
		const { data: channel, error } = await communityService.updateChannel(
			channelId,
			data,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
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
	const { channelId } = request.params;
	const { error } = await communityService.deleteChannel(channelId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

export const getMessagesController = async (
	request: FastifyRequest<{
		Params: { channelId: string };
		Querystring: { before?: string; limit?: string };
	}>,
	reply: FastifyReply,
) => {
	const { channelId } = request.params;
	const before = request.query.before;
	const limit = Number(request.query.limit ?? 50);
	const currentUserId = request.currentUser?.id;
	const { data: messages, error } = await communityService.listMessages(
		channelId,
		before,
		limit,
		currentUserId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(messages);
};

export const sendMessageController = async (
	request: FastifyRequest<{ Params: { channelId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { channelId } = request.params;

		const { data: channel, error: channelError } =
			await communityService.getChannel(channelId);
		if (channelError || !channel)
			return reply.status(500).send({ message: 'Channel not found' });
		if (channel.adminOnly && request.currentCustomer) {
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
		const { data: msg, error: msgError } = await communityService.sendMessage(
			channelId,
			{ content },
			{
				id: userId,
				name: customer?.name ?? request.currentUser?.email ?? 'Membro',
				avatar: customer?.image ?? null,
			},
			fileUrl,
		);
		if (msgError) {
			const message =
				msgError instanceof Error ? msgError.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
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
	const { channelId, messageId } = request.params;
	const { error } = await communityService.deleteMessage(channelId, messageId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

export const getMembersController = async (
	request: FastifyRequest<{
		Querystring: {
			search?: string;
			category?: string;
			featured?: string;
			online?: string;
		};
	}>,
	reply: FastifyReply,
) => {
	const { search, category, featured, online } = request.query;
	const { data: members, error } = await communityService.listMembers(
		search,
		category,
		featured === 'true',
		online === 'true',
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(members);
};

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
	const { page, limit, material, technique, search, sort } = request.query;
	const { data: projects, error } = await communityService.listProjects(
		Number(page ?? 1),
		Number(limit ?? 20),
		{ material, technique, search, sort },
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(projects);
};

export const getProjectController = async (
	request: FastifyRequest<{ Params: { projectId: string } }>,
	reply: FastifyReply,
) => {
	const { projectId } = request.params;
	const { data: project, error } = await communityService.getProject(projectId);
	if (error) {
		return reply.status(500).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	if (!project) return reply.status(404).send({ message: 'Not found' });
	return reply.send(project);
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
		const { data: project, error } = await communityService.updateProject(
			projectId,
			data,
		);
		if (error) {
			return reply.status(400).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
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
	const { projectId } = request.params;
	const { error } = await communityService.deleteProject(projectId);
	if (error) {
		return reply.status(400).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	return reply.status(204).send();
};

export const getProjectCommentsController = async (
	request: FastifyRequest<{
		Params: { projectId: string };
		Querystring: { page?: string; limit?: string };
	}>,
	reply: FastifyReply,
) => {
	const { projectId } = request.params;
	const page = Number(request.query.page ?? 1);
	const limit = Number(request.query.limit ?? 20);
	const { data: comments, error } = await communityService.listProjectComments(
		projectId,
		page,
		limit,
	);
	if (error) {
		return reply.status(500).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	return reply.send(comments);
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
		const { data: comment, error } =
			await communityService.createProjectComment(projectId, data, {
				authorId: userId,
				authorName: customer?.name ?? request.currentUser?.email ?? 'Admin',
				authorAvatar: customer?.image ?? null,
				isAdmin,
			});
		if (error) {
			return reply.status(400).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
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
		const { data: project, error } = await communityService.createProject(
			data,
			authorId,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.status(201).send(project);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const getEventsController = async (
	request: FastifyRequest<{ Querystring: { from?: string; to?: string } }>,
	reply: FastifyReply,
) => {
	const { from, to } = request.query;
	const { data: events, error } = await communityService.listEvents(from, to);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(events);
};

export const createEventController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createEventSchema.parse(request.body);
		const { data: event, error } = await communityService.createEvent(data);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
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
		const { data: event, error } = await communityService.updateEvent(
			eventId,
			data,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
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
	const { eventId } = request.params;
	const { error } = await communityService.deleteEvent(eventId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

export const getRankingController = async (
	request: FastifyRequest<{ Querystring: { period?: string } }>,
	reply: FastifyReply,
) => {
	const { period } = request.query;
	const { data: ranking, error } = await communityService.getRanking(period);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(ranking);
};

export const getActivityController = async (
	request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>,
	reply: FastifyReply,
) => {
	const page = Math.max(1, Number(request.query.page ?? 1));
	const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20)));
	const { data: activity, error } = await communityService.listActivity(
		page,
		limit,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(activity);
};
