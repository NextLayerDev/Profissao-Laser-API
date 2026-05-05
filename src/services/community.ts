import { withCapture } from '@/lib/sentry.js';
import { communityRepository } from '../repositories/community.js';
import type {
	CreateChannel,
	CreateComment,
	CreateEvent,
	CreatePost,
	CreateProject,
	SendMessage,
	UpdateChannel,
	UpdateEvent,
	UpdateProject,
} from '../types/community.js';

export const communityService = {
	async listPosts(page: number, limit: number, currentUserId: string) {
		return withCapture(() =>
			communityRepository.listPosts(page, limit, currentUserId),
		);
	},

	async createPost(
		data: CreatePost,
		author: { id: string; name: string; avatar: string | null },
	) {
		return withCapture(() =>
			communityRepository.createPost({
				...data,
				authorId: author.id,
				authorName: author.name,
				authorAvatar: author.avatar,
			}),
		);
	},

	async listChannels() {
		return withCapture(() => communityRepository.listChannels());
	},

	async getChannel(id: string) {
		return withCapture(() => communityRepository.getChannel(id));
	},

	async createChannel(data: CreateChannel) {
		return withCapture(() => communityRepository.createChannel(data));
	},

	async updateChannel(id: string, data: UpdateChannel) {
		return withCapture(() => communityRepository.updateChannel(id, data));
	},

	async deleteChannel(id: string) {
		return withCapture(() => communityRepository.deleteChannel(id));
	},

	async listMessages(
		channelId: string,
		before: string | undefined,
		limit: number,
		currentUserId: string,
	) {
		return withCapture(() =>
			communityRepository.listMessages(channelId, before, limit, currentUserId),
		);
	},

	async deleteMessage(channelId: string, messageId: string) {
		return withCapture(() =>
			communityRepository.deleteMessage(channelId, messageId),
		);
	},

	async sendMessage(
		channelId: string,
		data: SendMessage,
		author: { id: string; name: string; avatar: string | null },
		fileUrl?: string,
	) {
		return withCapture(() =>
			communityRepository.createMessage(channelId, {
				...data,
				authorId: author.id,
				authorName: author.name,
				authorAvatar: author.avatar,
				fileUrl,
			}),
		);
	},

	async listMembers(search?: string, category?: string) {
		return withCapture(() => communityRepository.listMembers(search, category));
	},

	async listProjects(
		page: number,
		limit: number,
		filters?: {
			material?: string;
			technique?: string;
			search?: string;
			sort?: string;
		},
	) {
		return withCapture(() =>
			communityRepository.listProjects(page, limit, filters),
		);
	},

	async getProject(id: string) {
		return withCapture(() => communityRepository.getProject(id));
	},

	async createProject(data: CreateProject, authorId: string) {
		return withCapture(() =>
			communityRepository.createProject({ ...data, authorId }),
		);
	},

	async updateProject(id: string, data: UpdateProject) {
		return withCapture(() => communityRepository.updateProject(id, data));
	},

	async deleteProject(id: string) {
		return withCapture(() => communityRepository.deleteProject(id));
	},

	async listProjectComments(projectId: string, page: number, limit: number) {
		return withCapture(() =>
			communityRepository.listProjectComments(projectId, page, limit),
		);
	},

	async createProjectComment(
		projectId: string,
		data: CreateComment,
		author: {
			authorId: string;
			authorName: string;
			authorAvatar: string | null;
			isAdmin: boolean;
		},
	) {
		return withCapture(() =>
			communityRepository.createProjectComment(projectId, {
				...data,
				...author,
			}),
		);
	},

	async listPostComments(postId: string, page: number, limit: number) {
		return withCapture(() =>
			communityRepository.listPostComments(postId, page, limit),
		);
	},

	async createPostComment(
		postId: string,
		data: CreateComment,
		author: {
			authorId: string;
			authorName: string;
			authorAvatar: string | null;
			isAdmin: boolean;
		},
	) {
		return withCapture(() =>
			communityRepository.createPostComment(postId, {
				...data,
				...author,
			}),
		);
	},

	async togglePostLike(postId: string, customerId: string) {
		return withCapture(() =>
			communityRepository.togglePostLike(postId, customerId),
		);
	},

	async listEvents(from?: string, to?: string) {
		return withCapture(() => communityRepository.listEvents(from, to));
	},

	async createEvent(data: CreateEvent) {
		return withCapture(() => communityRepository.createEvent(data));
	},

	async updateEvent(id: string, data: UpdateEvent) {
		return withCapture(() => communityRepository.updateEvent(id, data));
	},

	async deleteEvent(id: string) {
		return withCapture(() => communityRepository.deleteEvent(id));
	},

	async getRanking(period?: string) {
		return withCapture(async () => {
			const ranked = await communityRepository.getRanking(period);
			return {
				top: ranked.slice(0, 3),
				rest: ranked.slice(3),
			};
		});
	},

	async listActivity(page: number, limit: number) {
		return withCapture(() => communityRepository.listActivity(page, limit));
	},
};
