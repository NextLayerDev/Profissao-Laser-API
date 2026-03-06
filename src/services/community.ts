import { communityRepository } from '../repositories/community.js';
import type {
	CreateChannel,
	CreateEvent,
	CreatePost,
	CreateProject,
	SendMessage,
	UpdateChannel,
	UpdateEvent,
} from '../types/community.js';

class CommunityService {
	// ── Posts ────────────────────────────────────────────────────────────────

	async listPosts(page: number, limit: number, currentUserId: string) {
		return communityRepository.listPosts(page, limit, currentUserId);
	}

	async createPost(
		data: CreatePost,
		author: { id: string; name: string; avatar: string | null },
	) {
		return communityRepository.createPost({
			...data,
			authorId: author.id,
			authorName: author.name,
			authorAvatar: author.avatar,
		});
	}

	// ── Channels ─────────────────────────────────────────────────────────────

	async listChannels() {
		return communityRepository.listChannels();
	}

	async createChannel(data: CreateChannel) {
		return communityRepository.createChannel(data);
	}

	async updateChannel(id: string, data: UpdateChannel) {
		return communityRepository.updateChannel(id, data);
	}

	async deleteChannel(id: string) {
		return communityRepository.deleteChannel(id);
	}

	// ── Messages ──────────────────────────────────────────────────────────────

	async listMessages(
		channelId: string,
		before: string | undefined,
		limit: number,
		currentUserId: string,
	) {
		return communityRepository.listMessages(
			channelId,
			before,
			limit,
			currentUserId,
		);
	}

	async deleteMessage(channelId: string, messageId: string) {
		return communityRepository.deleteMessage(channelId, messageId);
	}

	async sendMessage(
		channelId: string,
		data: SendMessage,
		author: { id: string; name: string; avatar: string | null },
		fileUrl?: string,
	) {
		return communityRepository.createMessage(channelId, {
			...data,
			authorId: author.id,
			authorName: author.name,
			authorAvatar: author.avatar,
			fileUrl,
		});
	}

	// ── Members ───────────────────────────────────────────────────────────────

	async listMembers(search?: string, category?: string) {
		return communityRepository.listMembers(search, category);
	}

	// ── Projects ──────────────────────────────────────────────────────────────

	async listProjects(page: number, limit: number) {
		return communityRepository.listProjects(page, limit);
	}

	async createProject(data: CreateProject, authorId: string) {
		return communityRepository.createProject({ ...data, authorId });
	}

	// ── Events ────────────────────────────────────────────────────────────────

	async listEvents(from?: string, to?: string) {
		return communityRepository.listEvents(from, to);
	}

	async createEvent(data: CreateEvent) {
		return communityRepository.createEvent(data);
	}

	async updateEvent(id: string, data: UpdateEvent) {
		return communityRepository.updateEvent(id, data);
	}

	async deleteEvent(id: string) {
		return communityRepository.deleteEvent(id);
	}

	// ── Ranking ───────────────────────────────────────────────────────────────

	async getRanking(period?: string) {
		const ranked = await communityRepository.getRanking(period);
		return {
			top: ranked.slice(0, 3),
			rest: ranked.slice(3),
		};
	}
}

export const communityService = new CommunityService();
