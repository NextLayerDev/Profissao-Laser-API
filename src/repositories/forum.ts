import { supabase } from '../lib/supabase.js';
import type {
	CreateForumCategory,
	CreateForumPost,
	CreateForumReply,
	UpdateForumCategory,
	UpdateForumPost,
} from '../types/forum.js';

// ─── Types for DB rows ────────────────────────────────────────────────────────

type CategoryRow = {
	id: string;
	name: string;
	color: string;
	created_at: string;
};

type PostRow = {
	id: string;
	title: string;
	content: string;
	author_id: string;
	author_name: string;
	category_id: string | null;
	accepted_reply_id: string | null;
	created_at: string;
	updated_at: string;
};

type ReplyRow = {
	id: string;
	post_id: string;
	content: string;
	author_id: string;
	author_name: string;
	is_instructor: boolean;
	created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapReply(
	r: ReplyRow,
	acceptedReplyId: string | null,
	upvotes: number,
	upvotedByMe: boolean,
) {
	return {
		id: r.id,
		postId: r.post_id,
		content: r.content,
		author: r.author_name,
		authorId: r.author_id,
		isInstructor: r.is_instructor,
		isAccepted: r.id === acceptedReplyId,
		upvotes,
		upvotedByMe,
		createdAt: r.created_at,
	};
}

function mapPost(
	post: PostRow,
	category: CategoryRow | null,
	upvotes: number,
	upvotedByMe: boolean,
	repliesCount: number,
	replies?: ReturnType<typeof mapReply>[],
) {
	return {
		id: post.id,
		title: post.title,
		content: post.content,
		author: post.author_name,
		authorId: post.author_id,
		categoryId: post.category_id,
		categoryName: category?.name ?? null,
		categoryColor: category?.color ?? null,
		upvotes,
		upvotedByMe,
		repliesCount,
		acceptedReplyId: post.accepted_reply_id,
		createdAt: post.created_at,
		updatedAt: post.updated_at,
		...(replies !== undefined && { replies }),
	};
}

// ─── Repository ───────────────────────────────────────────────────────────────

class ForumRepository {
	async listCategories() {
		const { data: categories, error } = await supabase
			.from('forum_categories')
			.select('*')
			.order('name', { ascending: true });

		if (error) throw new Error(error.message);

		const { data: postCounts } = await supabase
			.from('forum_posts')
			.select('category_id');

		const counts: Record<string, number> = {};
		for (const row of postCounts ?? []) {
			if (row.category_id) {
				counts[row.category_id] = (counts[row.category_id] ?? 0) + 1;
			}
		}

		return (categories as CategoryRow[]).map((cat) => ({
			id: cat.id,
			name: cat.name,
			color: cat.color,
			postsCount: counts[cat.id] ?? 0,
		}));
	}

	async createCategory(data: CreateForumCategory & { color: string }) {
		const { data: cat, error } = await supabase
			.from('forum_categories')
			.insert({ id: crypto.randomUUID(), name: data.name, color: data.color })
			.select()
			.single();

		if (error) throw new Error(error.message);
		return { ...(cat as CategoryRow), postsCount: 0 };
	}

	/** Busca categoria por nome exato (case-insensitive) — dedupe na criação. */
	async findCategoryByName(name: string) {
		const { data, error } = await supabase
			.from('forum_categories')
			.select('*')
			.ilike('name', name)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data ? { ...(data as CategoryRow), postsCount: 0 } : null;
	}

	async updateCategory(id: string, data: UpdateForumCategory) {
		const updates: Record<string, unknown> = {};
		if (data.name !== undefined) updates.name = data.name;
		if (data.color !== undefined) updates.color = data.color;

		const { data: cat, error } = await supabase
			.from('forum_categories')
			.update(updates)
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return { ...(cat as CategoryRow), postsCount: 0 };
	}

	async deleteCategory(id: string) {
		// Unlink posts before deleting
		await supabase
			.from('forum_posts')
			.update({ category_id: null })
			.eq('category_id', id);

		const { error } = await supabase
			.from('forum_categories')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}

	async listPosts(params: {
		page: number;
		limit: number;
		categoryId?: string;
		search?: string;
		currentUserId: string;
		sort?: 'recent' | 'top' | 'unanswered';
	}) {
		const { page, limit, categoryId, search, currentUserId } = params;
		const sort = params.sort ?? 'recent';
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		// categoryId 'none' = posts sem tema (filtro de moderação do admin).
		// biome-ignore lint/suspicious/noExplicitAny: supabase builder genérico
		const applyFilters = (query: any) => {
			let q = query;
			if (categoryId === 'none') q = q.is('category_id', null);
			else if (categoryId) q = q.eq('category_id', categoryId);
			if (search) q = q.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
			return q;
		};

		if (sort === 'recent') {
			let query = supabase
				.from('forum_posts')
				.select('*', { count: 'exact' })
				.order('created_at', { ascending: false })
				.range(from, to);
			query = applyFilters(query);

			const { data: posts, error, count } = await query;
			if (error) throw new Error(error.message);
			if (!posts || posts.length === 0) {
				return { posts: [], total: 0, page, limit };
			}
			const mapped = await this._enrichPosts(posts as PostRow[], currentUserId);
			return { posts: mapped, total: count ?? 0, page, limit };
		}

		// top/unanswered exigem agregação (upvotes/replies) ANTES de paginar:
		// fase 1 = ids filtrados (cap 500, escala atual do fórum), fase 2 = counts
		// agregados + sort/filtro em JS, fase 3 = rows completas só da página.
		let idsQuery = supabase
			.from('forum_posts')
			.select('id, created_at')
			.order('created_at', { ascending: false })
			.limit(500);
		idsQuery = applyFilters(idsQuery);
		const { data: idRows, error: idsError } = await idsQuery;
		if (idsError) throw new Error(idsError.message);
		if (!idRows || idRows.length === 0) {
			return { posts: [], total: 0, page, limit };
		}

		const allIds = (idRows as Array<{ id: string; created_at: string }>).map(
			(r) => r.id,
		);
		const [{ data: allUpvotes }, { data: allReplies }] = await Promise.all([
			supabase
				.from('forum_post_upvotes')
				.select('post_id')
				.in('post_id', allIds),
			supabase.from('forum_replies').select('post_id').in('post_id', allIds),
		]);
		const upvoteCountMap = this._countByPostId(allUpvotes);
		const replyCountMap = this._countByPostId(allReplies);

		let ordered = idRows as Array<{ id: string; created_at: string }>;
		if (sort === 'unanswered') {
			ordered = ordered.filter((r) => (replyCountMap.get(r.id) ?? 0) === 0);
		} else {
			ordered = [...ordered].sort(
				(a, b) =>
					(upvoteCountMap.get(b.id) ?? 0) - (upvoteCountMap.get(a.id) ?? 0) ||
					b.created_at.localeCompare(a.created_at),
			);
		}

		const total = ordered.length;
		const pageIds = ordered.slice(from, to + 1).map((r) => r.id);
		if (pageIds.length === 0) return { posts: [], total, page, limit };

		const { data: posts, error: postsError } = await supabase
			.from('forum_posts')
			.select('*')
			.in('id', pageIds);
		if (postsError) throw new Error(postsError.message);

		const mapped = await this._enrichPosts(
			(posts as PostRow[]) ?? [],
			currentUserId,
			{ upvoteCountMap, replyCountMap },
		);
		// preserva a ordem calculada (in() não garante ordem)
		const byId = new Map(mapped.map((p) => [p.id, p]));
		const sorted = pageIds
			.map((id) => byId.get(id))
			.filter((p): p is NonNullable<typeof p> => !!p);
		return { posts: sorted, total, page, limit };
	}

	private _countByPostId(rows: unknown[] | null) {
		const map = new Map<string, number>();
		for (const r of rows ?? []) {
			const row = r as { post_id: string };
			map.set(row.post_id, (map.get(row.post_id) ?? 0) + 1);
		}
		return map;
	}

	/** Enriquecimento compartilhado: categoria, upvotes, meu upvote, nº de respostas. */
	private async _enrichPosts(
		posts: PostRow[],
		currentUserId: string,
		precomputed?: {
			upvoteCountMap: Map<string, number>;
			replyCountMap: Map<string, number>;
		},
	) {
		if (posts.length === 0) return [];
		const postIds = posts.map((p) => p.id);

		const [{ data: categories }, { data: userUpvotes }] = await Promise.all([
			supabase.from('forum_categories').select('*'),
			supabase
				.from('forum_post_upvotes')
				.select('post_id')
				.in('post_id', postIds)
				.eq('user_id', currentUserId),
		]);

		let upvoteCountMap = precomputed?.upvoteCountMap;
		let replyCountMap = precomputed?.replyCountMap;
		if (!upvoteCountMap || !replyCountMap) {
			const [{ data: allUpvotes }, { data: replyCounts }] = await Promise.all([
				supabase
					.from('forum_post_upvotes')
					.select('post_id')
					.in('post_id', postIds),
				supabase.from('forum_replies').select('post_id').in('post_id', postIds),
			]);
			upvoteCountMap = this._countByPostId(allUpvotes);
			replyCountMap = this._countByPostId(replyCounts);
		}

		const catMap = new Map<string, CategoryRow>(
			((categories as CategoryRow[]) ?? []).map((c) => [c.id, c]),
		);
		const userUpvotedSet = new Set<string>(
			(userUpvotes ?? []).map((u: { post_id: string }) => u.post_id),
		);

		return posts.map((post) =>
			mapPost(
				post,
				catMap.get(post.category_id ?? '') ?? null,
				upvoteCountMap.get(post.id) ?? 0,
				userUpvotedSet.has(post.id),
				replyCountMap.get(post.id) ?? 0,
			),
		);
	}

	async getPost(id: string, currentUserId: string) {
		const { data: post, error } = await supabase
			.from('forum_posts')
			.select('*')
			.eq('id', id)
			.single();

		if (error) throw new Error(error.message);

		const postRow = post as PostRow;

		const [
			{ data: category },
			{ data: postUpvotes },
			{ data: userPostUpvote },
			{ data: replies },
		] = await Promise.all([
			postRow.category_id
				? supabase
						.from('forum_categories')
						.select('*')
						.eq('id', postRow.category_id)
						.maybeSingle()
				: Promise.resolve({ data: null }),
			supabase.from('forum_post_upvotes').select('user_id').eq('post_id', id),
			supabase
				.from('forum_post_upvotes')
				.select('user_id')
				.eq('post_id', id)
				.eq('user_id', currentUserId)
				.maybeSingle(),
			supabase
				.from('forum_replies')
				.select('*')
				.eq('post_id', id)
				.order('created_at', { ascending: true }),
		]);

		const replyIds = ((replies as ReplyRow[]) ?? []).map((r) => r.id);

		const [{ data: allReplyUpvotes }, { data: userReplyUpvotes }] =
			await Promise.all([
				replyIds.length > 0
					? supabase
							.from('forum_reply_upvotes')
							.select('reply_id, user_id')
							.in('reply_id', replyIds)
					: Promise.resolve({ data: [] }),
				replyIds.length > 0
					? supabase
							.from('forum_reply_upvotes')
							.select('reply_id')
							.in('reply_id', replyIds)
							.eq('user_id', currentUserId)
					: Promise.resolve({ data: [] }),
			]);

		const replyUpvoteMap = new Map<string, number>();
		for (const u of allReplyUpvotes ?? []) {
			const row = u as { reply_id: string };
			replyUpvoteMap.set(
				row.reply_id,
				(replyUpvoteMap.get(row.reply_id) ?? 0) + 1,
			);
		}

		const userReplyUpvotedSet = new Set<string>(
			(userReplyUpvotes ?? []).map((u: { reply_id: string }) => u.reply_id),
		);

		const mappedReplies = ((replies as ReplyRow[]) ?? []).map((r) =>
			mapReply(
				r,
				postRow.accepted_reply_id,
				replyUpvoteMap.get(r.id) ?? 0,
				userReplyUpvotedSet.has(r.id),
			),
		);

		return mapPost(
			postRow,
			(category as CategoryRow | null) ?? null,
			postUpvotes?.length ?? 0,
			!!userPostUpvote,
			mappedReplies.length,
			mappedReplies,
		);
	}

	async createPost(
		data: CreateForumPost,
		author: { id: string; name: string; isInstructor: boolean },
	) {
		const now = new Date().toISOString();
		const { data: post, error } = await supabase
			.from('forum_posts')
			.insert({
				id: crypto.randomUUID(),
				title: data.title,
				content: data.content,
				author_id: author.id,
				author_name: author.name,
				category_id: data.categoryId ?? null,
				created_at: now,
				updated_at: now,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return this.getPost((post as PostRow).id, author.id);
	}

	async updatePost(id: string, data: UpdateForumPost, currentUserId: string) {
		const updates: Record<string, unknown> = {
			updated_at: new Date().toISOString(),
		};
		if (data.title !== undefined) updates.title = data.title;
		if (data.content !== undefined) updates.content = data.content;
		if (data.categoryId !== undefined) updates.category_id = data.categoryId;

		const { error } = await supabase
			.from('forum_posts')
			.update(updates)
			.eq('id', id);

		if (error) throw new Error(error.message);
		return this.getPost(id, currentUserId);
	}

	async deletePost(id: string) {
		// Cascade delete upvotes and replies
		await Promise.all([
			supabase.from('forum_post_upvotes').delete().eq('post_id', id),
			supabase
				.from('forum_replies')
				.select('id')
				.eq('post_id', id)
				.then(async ({ data: replyRows }) => {
					if (replyRows && replyRows.length > 0) {
						const ids = replyRows.map((r: { id: string }) => r.id);
						await supabase
							.from('forum_reply_upvotes')
							.delete()
							.in('reply_id', ids);
					}
				}),
			supabase.from('forum_replies').delete().eq('post_id', id),
		]);

		const { error } = await supabase.from('forum_posts').delete().eq('id', id);

		if (error) throw new Error(error.message);
	}

	async togglePostUpvote(postId: string, userId: string) {
		const { data: existing } = await supabase
			.from('forum_post_upvotes')
			.select('id')
			.eq('post_id', postId)
			.eq('user_id', userId)
			.maybeSingle();

		if (existing) {
			await supabase
				.from('forum_post_upvotes')
				.delete()
				.eq('post_id', postId)
				.eq('user_id', userId);
		} else {
			await supabase
				.from('forum_post_upvotes')
				.insert({ id: crypto.randomUUID(), post_id: postId, user_id: userId });
		}

		return this.getPost(postId, userId);
	}

	async createReply(
		postId: string,
		data: CreateForumReply,
		author: { id: string; name: string; isInstructor: boolean },
	) {
		const { data: _reply, error } = await supabase
			.from('forum_replies')
			.insert({
				id: crypto.randomUUID(),
				post_id: postId,
				content: data.content,
				author_id: author.id,
				author_name: author.name,
				is_instructor: author.isInstructor,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return this.getPost(postId, author.id);
	}

	async updateReply(
		postId: string,
		replyId: string,
		content: string,
		currentUserId: string,
	) {
		const { error } = await supabase
			.from('forum_replies')
			.update({ content })
			.eq('id', replyId)
			.eq('post_id', postId);

		if (error) throw new Error(error.message);
		return this.getPost(postId, currentUserId);
	}

	async deleteReply(postId: string, replyId: string, currentUserId: string) {
		await supabase.from('forum_reply_upvotes').delete().eq('reply_id', replyId);

		// Clear accepted_reply_id if this reply was accepted
		await supabase
			.from('forum_posts')
			.update({ accepted_reply_id: null, updated_at: new Date().toISOString() })
			.eq('id', postId)
			.eq('accepted_reply_id', replyId);

		const { error } = await supabase
			.from('forum_replies')
			.delete()
			.eq('id', replyId)
			.eq('post_id', postId);

		if (error) throw new Error(error.message);
		return this.getPost(postId, currentUserId);
	}

	async acceptReply(postId: string, replyId: string, currentUserId: string) {
		const { error } = await supabase
			.from('forum_posts')
			.update({
				accepted_reply_id: replyId,
				updated_at: new Date().toISOString(),
			})
			.eq('id', postId)
			.eq('author_id', currentUserId); // only post author can accept

		if (error) throw new Error(error.message);
		return this.getPost(postId, currentUserId);
	}

	async toggleReplyUpvote(postId: string, replyId: string, userId: string) {
		const { data: existing } = await supabase
			.from('forum_reply_upvotes')
			.select('id')
			.eq('reply_id', replyId)
			.eq('user_id', userId)
			.maybeSingle();

		if (existing) {
			await supabase
				.from('forum_reply_upvotes')
				.delete()
				.eq('reply_id', replyId)
				.eq('user_id', userId);
		} else {
			await supabase.from('forum_reply_upvotes').insert({
				id: crypto.randomUUID(),
				reply_id: replyId,
				user_id: userId,
			});
		}

		return this.getPost(postId, userId);
	}
}

export const forumRepository = new ForumRepository();
