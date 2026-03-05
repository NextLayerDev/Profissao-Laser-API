import { supabase } from '../lib/supabase.js';
import type {
	CreateChannel,
	CreatePost,
	CreateProject,
	SendMessage,
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
			.order('createdAt', { ascending: true });

		if (error) throw new Error(error.message);
		return (data ?? []).map(
			(ch: {
				id: string;
				label: string;
				description: string | null;
				category: string;
			}) => ({
				id: ch.id,
				label: ch.label,
				description: ch.description,
				category: ch.category,
			}),
		);
	}

	async createChannel(data: CreateChannel) {
		const { data: channel, error } = await supabase
			.from('pl_community_channel')
			.insert({
				id: crypto.randomUUID(),
				label: data.name,
				category: 'geral',
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return channel;
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

	async listProjects(page: number, limit: number) {
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		const { data, error } = await supabase
			.from('pl_community_project')
			.select('*')
			.order('createdAt', { ascending: false })
			.range(from, to);

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
