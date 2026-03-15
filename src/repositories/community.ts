import { supabase } from '../lib/supabase.js';
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

class CommunityRepository {
	// ── Posts ────────────────────────────────────────────────────────────────

	async listPosts(page: number, limit: number, currentUserId: string) {
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		const { data: posts, error } = await supabase
			.from('pl_community_post')
			.select('*')
			.order('createdAt', { ascending: false })
			.range(from, to);

		if (error) throw new Error(error.message);
		if (!posts || posts.length === 0) return [];

		const postIds = posts.map((p: { id: string }) => p.id);

		const [{ data: likes }, { data: userLikes }] = await Promise.all([
			supabase
				.from('pl_community_post_like')
				.select('postId')
				.in('postId', postIds),
			supabase
				.from('pl_community_post_like')
				.select('postId')
				.in('postId', postIds)
				.eq('customerId', currentUserId),
		]);

		const likeCounts = new Map<string, number>();
		for (const like of likes ?? []) {
			const l = like as { postId: string };
			likeCounts.set(l.postId, (likeCounts.get(l.postId) ?? 0) + 1);
		}

		const userLikedSet = new Set<string>(
			(userLikes ?? []).map((l: { postId: string }) => l.postId),
		);

		return posts.map(
			(post: {
				id: string;
				authorName: string;
				authorAvatar: string | null;
				createdAt: string;
				content: string;
				image: string | null;
			}) => ({
				id: post.id,
				author: post.authorName,
				avatar: post.authorAvatar,
				time: post.createdAt,
				content: post.content,
				image: post.image,
				likes: likeCounts.get(post.id) ?? 0,
				comments: 0,
				shares: 0,
				liked: userLikedSet.has(post.id),
			}),
		);
	}

	async createPost(
		data: CreatePost & {
			authorId: string;
			authorName: string;
			authorAvatar: string | null;
		},
	) {
		const { data: post, error } = await supabase
			.from('pl_community_post')
			.insert({
				id: crypto.randomUUID(),
				authorId: data.authorId,
				authorName: data.authorName,
				authorAvatar: data.authorAvatar,
				content: data.content,
				image: data.image ?? null,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return post;
	}

	// ── Channels ─────────────────────────────────────────────────────────────

	async listChannels() {
		const { data, error } = await supabase
			.from('pl_community_channel')
			.select('*')
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return (data ?? []).map(
			(ch: {
				id: string;
				label: string;
				description: string | null;
				category: string;
				adminOnly: boolean;
				adminView: boolean;
				order: number;
			}) => ({
				id: ch.id,
				label: ch.label,
				description: ch.description,
				category: ch.category,
				adminOnly: ch.adminOnly ?? false,
				adminView: ch.adminView ?? false,
				order: ch.order ?? 0,
			}),
		);
	}

	async getChannel(id: string) {
		const { data, error } = await supabase
			.from('pl_community_channel')
			.select('*')
			.eq('id', id)
			.single();
		if (error) throw new Error(error.message);
		return data as {
			id: string;
			label: string;
			description: string | null;
			category: string;
			adminOnly: boolean;
			adminView: boolean;
			order: number;
		} | null;
	}

	async createChannel(data: CreateChannel) {
		const { data: channel, error } = await supabase
			.from('pl_community_channel')
			.insert({
				id: crypto.randomUUID(),
				label: data.name,
				category: 'geral',
				adminOnly: data.adminOnly ?? false,
				adminView: data.adminView ?? false,
				order: data.order ?? 0,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return channel;
	}

	async updateChannel(id: string, data: UpdateChannel) {
		const updates: Record<string, unknown> = {};
		if (data.name !== undefined) updates.label = data.name;
		if (data.description !== undefined) updates.description = data.description;
		if (data.adminOnly !== undefined) updates.adminOnly = data.adminOnly;
		if (data.adminView !== undefined) updates.adminView = data.adminView;
		if (data.order !== undefined) updates.order = data.order;

		const { data: channel, error } = await supabase
			.from('pl_community_channel')
			.update(updates)
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return channel;
	}

	async deleteChannel(id: string) {
		await supabase.from('pl_community_message').delete().eq('channelId', id);

		const { error } = await supabase
			.from('pl_community_channel')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}

	// ── Messages ──────────────────────────────────────────────────────────────

	async listMessages(
		channelId: string,
		before: string | undefined,
		limit: number,
		currentUserId: string,
	) {
		let query = supabase
			.from('pl_community_message')
			.select('*')
			.eq('channelId', channelId)
			.order('createdAt', { ascending: false })
			.limit(limit);

		if (before) {
			query = query.lt('createdAt', before);
		}

		const { data, error } = await query;
		if (error) throw new Error(error.message);

		return (data ?? [])
			.reverse()
			.map(
				(msg: {
					id: string;
					authorName: string;
					authorAvatar: string | null;
					authorId: string;
					content: string;
					createdAt: string;
					fileUrl: string | null;
				}) => ({
					id: msg.id,
					user: msg.authorName,
					avatar: msg.authorAvatar,
					content: msg.content,
					time: msg.createdAt,
					isMe: msg.authorId === currentUserId,
					fileUrl: msg.fileUrl,
				}),
			);
	}

	async createMessage(
		channelId: string,
		data: SendMessage & {
			authorId: string;
			authorName: string;
			authorAvatar: string | null;
			fileUrl?: string;
		},
	) {
		const { data: msg, error } = await supabase
			.from('pl_community_message')
			.insert({
				id: crypto.randomUUID(),
				channelId,
				authorId: data.authorId,
				authorName: data.authorName,
				authorAvatar: data.authorAvatar,
				content: data.content,
				fileUrl: data.fileUrl ?? null,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return msg;
	}

	async deleteMessage(channelId: string, messageId: string) {
		const { error } = await supabase
			.from('pl_community_message')
			.delete()
			.eq('id', messageId)
			.eq('channelId', channelId);

		if (error) throw new Error(error.message);
	}

	// ── Members ───────────────────────────────────────────────────────────────

	async listMembers(search?: string, category?: string) {
		let query = supabase.from('Customers').select(`
				id,
				name,
				pl_community_profile (
					specialty,
					badges,
					category,
					image
				)
			`);

		if (search) {
			query = query.ilike('name', `%${search}%`);
		}

		const { data, error } = await query;
		if (error) throw new Error(error.message);

		return (data ?? [])
			.map(
				(m: {
					name: string;
					pl_community_profile: {
						specialty: string | null;
						badges: string[];
						category: string | null;
						image: string | null;
					}[];
				}) => {
					const profile = m.pl_community_profile?.[0] ?? null;
					return {
						name: m.name,
						specialty: profile?.specialty ?? null,
						badges: profile?.badges ?? [],
						category: profile?.category ?? null,
						image: profile?.image ?? null,
					};
				},
			)
			.filter(
				(m: { category: string | null }) =>
					!category || m.category === category,
			);
	}

	// ── Projects ──────────────────────────────────────────────────────────────

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
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		let query = supabase
			.from('pl_community_project')
			.select('*')
			.range(from, to);

		if (filters?.material) query = query.eq('material', filters.material);
		if (filters?.technique) query = query.eq('technique', filters.technique);
		if (filters?.search)
			query = query.or(
				`title.ilike.%${filters.search}%,authorName.ilike.%${filters.search}%`,
			);

		query =
			filters?.sort === 'likes'
				? query.order('likes', { ascending: false })
				: query.order('createdAt', { ascending: false });

		const { data, error } = await query;
		if (error) throw new Error(error.message);

		return (data ?? []).map(
			(p: {
				id: string;
				title: string;
				authorName: string;
				img: string | null;
				description: string | null;
				material: string | null;
				technique: string | null;
				createdAt: string;
				likes: number;
				comments: number;
			}) => ({
				id: p.id,
				title: p.title,
				author: p.authorName,
				img: p.img,
				description: p.description,
				material: p.material,
				technique: p.technique,
				time: p.createdAt,
				likes: p.likes,
				comments: p.comments,
			}),
		);
	}

	private mapProject(p: {
		id: string;
		title: string;
		authorName: string;
		img: string | null;
		description: string | null;
		material: string | null;
		technique: string | null;
		createdAt: string;
		likes: number;
		comments: number;
	}) {
		return {
			id: p.id,
			title: p.title,
			author: p.authorName,
			img: p.img,
			description: p.description,
			material: p.material,
			technique: p.technique,
			time: p.createdAt,
			likes: p.likes,
			comments: p.comments,
		};
	}

	async getProject(id: string) {
		const [{ data: project, error }, comments] = await Promise.all([
			supabase.from('pl_community_project').select('*').eq('id', id).single(),
			this.listProjectComments(id, 1, 100),
		]);
		if (error) throw new Error(error.message);
		if (!project) return null;
		return { ...this.mapProject(project), commentList: comments };
	}

	async updateProject(id: string, data: UpdateProject) {
		const updates: Record<string, unknown> = {};
		if (data.title !== undefined) updates.title = data.title;
		if (data.description !== undefined) updates.description = data.description;
		if (data.img !== undefined) updates.img = data.img;
		if (data.material !== undefined) updates.material = data.material;
		if (data.technique !== undefined) updates.technique = data.technique;

		const { data: project, error } = await supabase
			.from('pl_community_project')
			.update(updates)
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return this.mapProject(project);
	}

	async deleteProject(id: string) {
		const { error } = await supabase
			.from('pl_community_project')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	async listProjectComments(projectId: string, page: number, limit: number) {
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		const { data, error } = await supabase
			.from('pl_community_project_comment')
			.select('*')
			.eq('projectId', projectId)
			.order('createdAt', { ascending: true })
			.range(from, to);
		if (error) throw new Error(error.message);

		return (data ?? []).map(
			(c: {
				id: string;
				projectId: string;
				authorName: string;
				content: string;
				createdAt: string;
				isAdmin: boolean;
			}) => ({
				id: c.id,
				projectId: c.projectId,
				author: c.authorName,
				content: c.content,
				time: c.createdAt,
				isAdmin: c.isAdmin,
			}),
		);
	}

	async createProjectComment(
		projectId: string,
		data: CreateComment & {
			authorId: string;
			authorName: string;
			authorAvatar: string | null;
			isAdmin: boolean;
		},
	) {
		const { data: comment, error } = await supabase
			.from('pl_community_project_comment')
			.insert({
				id: crypto.randomUUID(),
				projectId,
				content: data.content,
				authorId: data.authorId,
				authorName: data.authorName,
				authorAvatar: data.authorAvatar,
				isAdmin: data.isAdmin,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);

		// Increment comments counter
		const { data: proj } = await supabase
			.from('pl_community_project')
			.select('comments')
			.eq('id', projectId)
			.single();
		await supabase
			.from('pl_community_project')
			.update({ comments: (proj?.comments ?? 0) + 1 })
			.eq('id', projectId);

		return {
			id: comment.id,
			projectId,
			author: data.authorName,
			content: data.content,
			time: comment.createdAt,
			isAdmin: data.isAdmin,
		};
	}

	async createProject(data: CreateProject & { authorId: string }) {
		const { data: project, error } = await supabase
			.from('pl_community_project')
			.insert({
				id: crypto.randomUUID(),
				title: data.title,
				description: data.description ?? null,
				authorId: data.authorId,
				authorName: data.author,
				img: data.img ?? null,
				material: data.material ?? null,
				technique: data.technique ?? null,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return project;
	}

	// ── Events ────────────────────────────────────────────────────────────────

	async listEvents(from?: string, to?: string) {
		let query = supabase
			.from('pl_community_event')
			.select('*')
			.order('date', { ascending: true });

		if (from) query = query.gte('date', from);
		if (to) query = query.lte('date', to);

		const { data, error } = await query;
		if (error) throw new Error(error.message);

		return (data ?? []).map(
			(e: {
				id: string;
				title: string;
				date: string;
				time: string | null;
				type: 'workshop' | 'live' | 'qa';
				description: string | null;
			}) => ({
				id: e.id,
				title: e.title,
				date: e.date,
				time: e.time,
				type: e.type,
				description: e.description,
			}),
		);
	}

	async createEvent(data: CreateEvent) {
		const { data: event, error } = await supabase
			.from('pl_community_event')
			.insert({ id: crypto.randomUUID(), ...data })
			.select()
			.single();
		if (error) throw new Error(error.message);
		return event;
	}

	async updateEvent(id: string, data: UpdateEvent) {
		const { data: event, error } = await supabase
			.from('pl_community_event')
			.update(data)
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return event;
	}

	async deleteEvent(id: string) {
		const { error } = await supabase
			.from('pl_community_event')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ── Ranking ───────────────────────────────────────────────────────────────

	async getRanking(period?: string) {
		const now = new Date();
		let since: string | undefined;

		if (period === 'week') {
			const d = new Date(now);
			d.setDate(d.getDate() - 7);
			since = d.toISOString();
		} else if (period === 'month') {
			const d = new Date(now);
			d.setMonth(d.getMonth() - 1);
			since = d.toISOString();
		}

		const applyPeriod = <T extends object>(query: T, field: string): T => {
			if (!since) return query;
			// biome-ignore lint/suspicious/noExplicitAny: dynamic query builder
			return (query as any).gte(field, since);
		};

		const [{ data: postAuthors }, { data: msgAuthors }, { data: projAuthors }] =
			await Promise.all([
				applyPeriod(
					supabase.from('pl_community_post').select('authorId, authorName'),
					'createdAt',
				),
				applyPeriod(
					supabase.from('pl_community_message').select('authorId, authorName'),
					'createdAt',
				),
				applyPeriod(
					supabase.from('pl_community_project').select('authorId, authorName'),
					'createdAt',
				),
			]);

		const scores = new Map<string, { name: string; pts: number }>();

		const add = (rows: { authorId: string; authorName: string }[] | null) => {
			for (const row of rows ?? []) {
				const entry = scores.get(row.authorId) ?? {
					name: row.authorName,
					pts: 0,
				};
				entry.pts += 1;
				scores.set(row.authorId, entry);
			}
		};

		add(postAuthors as { authorId: string; authorName: string }[] | null);
		add(msgAuthors as { authorId: string; authorName: string }[] | null);
		add(projAuthors as { authorId: string; authorName: string }[] | null);

		return Array.from(scores.values())
			.sort((a, b) => b.pts - a.pts)
			.map((entry, i) => ({ pos: i + 1, name: entry.name, pts: entry.pts }));
	}
}

export const communityRepository = new CommunityRepository();
