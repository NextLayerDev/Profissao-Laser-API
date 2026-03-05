import { communityRepository } from '../repositories/community.js';
import type {
	CreateChannel,
	CreatePost,
	CreateProject,
	SendMessage,
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
