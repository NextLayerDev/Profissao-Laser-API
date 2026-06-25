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

		const [{ data: likes }, { data: userLikes }, { data: comments }] =
			await Promise.all([
				supabase
					.from('pl_community_post_like')
					.select('postId')
					.in('postId', postIds),
				supabase
					.from('pl_community_post_like')
					.select('postId')
					.in('postId', postIds)
					.eq('customerId', currentUserId),
				supabase
					.from('pl_community_post_comment')
					.select('postId')
					.in('postId', postIds),
			]);

		const likeCounts = new Map<string, number>();
		for (const like of likes ?? []) {
			const l = like as { postId: string };
			likeCounts.set(l.postId, (likeCounts.get(l.postId) ?? 0) + 1);
		}

		const commentCounts = new Map<string, number>();
		for (const comment of comments ?? []) {
			const c = comment as { postId: string };
			commentCounts.set(c.postId, (commentCounts.get(c.postId) ?? 0) + 1);
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
				comments: commentCounts.get(post.id) ?? 0,
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

	async listMembers(
		search?: string,
		category?: string,
		featured?: boolean,
		online?: boolean,
		limit = 200,
		offset = 0,
		includePhone = false,
	) {
		const onlineThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		// Filtros (online/featured/category) sao do perfil -> inner join + SQL +
		// paginacao, pra NAO puxar todos os Customers e filtrar em JS (a 'demora
		// ao abrir' de membros/chat/online).
		const needsInner = !!(category || featured || online);
		const join = needsInner
			? 'pl_community_profile!inner'
			: 'pl_community_profile';
		let query = supabase.from('Customers').select(`
				id,
				name,
				${includePhone ? 'phone,' : ''}
				${join} (
					specialty,
					nickname,
					badges,
					badge,
					"featuredRole",
					featured,
					category,
					image,
					banner,
					"lastSeenAt"
				)
			`);

		if (search) query = query.ilike('name', `%${search}%`);
		if (category) query = query.eq('pl_community_profile.category', category);
		if (featured) query = query.eq('pl_community_profile.featured', true);
		if (online)
			query = query.gte('pl_community_profile.lastSeenAt', onlineThreshold);

		query = query
			.order('name', { ascending: true })
			.range(offset, offset + limit - 1);

		const { data, error } = await query;
		if (error) throw new Error(error.message);

		return (data ?? []).map((m) => {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic join result
			const member = m as any;
			const profile = member.pl_community_profile?.[0] ?? null;
			const lastSeenAt: string | null = profile?.lastSeenAt ?? null;
			const isOnline = lastSeenAt ? lastSeenAt >= onlineThreshold : false;
			return {
				id: member.id as string,
				name: member.name as string,
				nickname: (profile?.nickname ?? null) as string | null,
				specialty: (profile?.specialty ?? null) as string | null,
				badges: (profile?.badges ?? []) as string[],
				badge: (profile?.badge ?? null) as string | null,
				featuredRole: (profile?.featuredRole ?? null) as string | null,
				featured: (profile?.featured ?? false) as boolean,
				category: (profile?.category ?? null) as string | null,
				image: (profile?.image ?? null) as string | null,
				banner: (profile?.banner ?? null) as string | null,
				isOnline,
				lastSeenAt,
				...(includePhone
					? { phone: (member.phone ?? null) as string | null }
					: {}),
			};
		});
	}

	/** Totais para a visão admin: membros cadastrados e online agora (<5min). */
	async presenceCounts() {
		const onlineThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		const [membersRes, onlineRes] = await Promise.all([
			supabase.from('Customers').select('id', { count: 'exact', head: true }),
			supabase
				.from('pl_community_profile')
				.select('customerId', { count: 'exact', head: true })
				.gte('lastSeenAt', onlineThreshold),
		]);
		if (membersRes.error) throw new Error(membersRes.error.message);
		if (onlineRes.error) throw new Error(onlineRes.error.message);
		return {
			totalMembers: membersRes.count ?? 0,
			onlineNow: onlineRes.count ?? 0,
		};
	}

	async listProjects(
		page: number,
		limit: number,
		filters?: {
			material?: string;
			technique?: string;
			search?: string;
			sort?: string;
		},
		currentCustomerId?: string,
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

		const rows = data ?? [];
		const [avatarMap, likedSet] = await Promise.all([
			this.getAuthorAvatars(
				rows.map((p: { authorId?: string | null }) => p.authorId),
			),
			this.getLikedProjectIds(
				rows.map((p: { id: string }) => p.id),
				currentCustomerId,
			),
		]);
		return rows.map((p: { id: string; authorId?: string | null }) =>
			this.mapProject(
				p,
				avatarMap.get(p.authorId ?? '') ?? null,
				likedSet.has(p.id),
			),
		);
	}

	/** Versão cacheável da lista (sem o flag de like por usuário). */
	async listProjectsBase(
		page: number,
		limit: number,
		filters?: {
			material?: string;
			technique?: string;
			search?: string;
			sort?: string;
		},
	) {
		return this.listProjects(page, limit, filters);
	}

	/** Projetos curtidos pelo customer atual (entre os ids dados) — 1 query. */
	async getLikedProjectIds(
		projectIds: string[],
		customerId?: string,
	): Promise<Set<string>> {
		const set = new Set<string>();
		if (!customerId || projectIds.length === 0) return set;
		const { data, error } = await supabase
			.from('pl_community_project_like')
			.select('projectId')
			.eq('customerId', customerId)
			.in('projectId', projectIds);
		if (error) throw new Error(error.message);
		for (const row of (data ?? []) as { projectId: string }[]) {
			set.add(row.projectId);
		}
		return set;
	}

	/** Curtir/descurtir um projeto; recomputa o contador e retorna o estado. */
	async toggleProjectLike(projectId: string, customerId: string) {
		const { data: existing } = await supabase
			.from('pl_community_project_like')
			.select('id')
			.eq('projectId', projectId)
			.eq('customerId', customerId)
			.maybeSingle();

		if (existing) {
			const { error } = await supabase
				.from('pl_community_project_like')
				.delete()
				.eq('projectId', projectId)
				.eq('customerId', customerId);
			if (error) throw new Error(error.message);
		} else {
			const { error } = await supabase
				.from('pl_community_project_like')
				.insert({ projectId, customerId });
			if (error) throw new Error(error.message);
		}

		// Mantém o contador denormalizado (pl_community_project.likes) sincronizado.
		const { count, error: countError } = await supabase
			.from('pl_community_project_like')
			.select('*', { count: 'exact', head: true })
			.eq('projectId', projectId);
		if (countError) throw new Error(countError.message);
		const likes = count ?? 0;
		await supabase
			.from('pl_community_project')
			.update({ likes })
			.eq('id', projectId);

		return { liked: !existing, likes };
	}

	/** Busca a foto (pl_community_profile.image) dos autores em uma só query. */
	private async getAuthorAvatars(
		authorIds: (string | null | undefined)[],
	): Promise<Map<string, string | null>> {
		const ids = Array.from(
			new Set(authorIds.filter((id): id is string => !!id)),
		);
		const map = new Map<string, string | null>();
		if (ids.length === 0) return map;
		const { data, error } = await supabase
			.from('pl_community_profile')
			.select('customerId, image')
			.in('customerId', ids);
		if (error) throw new Error(error.message);
		for (const row of (data ?? []) as {
			customerId: string;
			image: string | null;
		}[]) {
			map.set(row.customerId, row.image ?? null);
		}
		return map;
	}

	private mapProject(
		p: {
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
		},
		authorAvatar: string | null = null,
		liked = false,
	) {
		return {
			id: p.id,
			title: p.title,
			author: p.authorName,
			authorAvatar,
			img: p.img,
			description: p.description,
			material: p.material,
			technique: p.technique,
			time: p.createdAt,
			likes: p.likes,
			comments: p.comments,
			liked,
		};
	}

	async getProject(id: string, currentCustomerId?: string) {
		const [{ data: project, error }, comments] = await Promise.all([
			supabase.from('pl_community_project').select('*').eq('id', id).single(),
			this.listProjectComments(id, 1, 100),
		]);
		if (error) throw new Error(error.message);
		if (!project) return null;
		const [avatarMap, likedSet] = await Promise.all([
			this.getAuthorAvatars([project.authorId]),
			this.getLikedProjectIds([project.id], currentCustomerId),
		]);
		return {
			...this.mapProject(
				project,
				avatarMap.get(project.authorId) ?? null,
				likedSet.has(project.id),
			),
			commentList: comments,
		};
	}

	/** Versão cacheável do detalhe (sem o flag de like por usuário). */
	async getProjectBase(id: string) {
		return this.getProject(id);
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

	async listEvents(from?: string, to?: string) {
		let query = supabase
			.from('pl_community_event')
			.select(
				'id, title, date, time, type, description, "streamUrl", "streamProvider", "waitingRoomOpensMinutesBefore", "hostId", "allowedPlanKeys"',
			)
			.order('date', { ascending: true });

		if (from) query = query.gte('date', from);
		if (to) query = query.lte('date', to);

		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async findEventById(id: string) {
		const { data, error } = await supabase
			.from('pl_community_event')
			.select(
				'id, title, date, time, type, description, "streamUrl", "streamProvider", "waitingRoomOpensMinutesBefore", "hostId", "allowedPlanKeys"',
			)
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Event not found');
		return data;
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
			.update({ ...data, updatedAt: new Date().toISOString() })
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

	// ── Sala de espera (attendance) ───────────────────────────────────────────

	async joinEventWaitingRoom(eventId: string, customerId: string) {
		// Se já existe presença ativa (leftAt NULL), reusar (idempotente).
		const { data: existing } = await supabase
			.from('pl_event_attendance')
			.select('id')
			.eq('eventId', eventId)
			.eq('customerId', customerId)
			.is('leftAt', null)
			.maybeSingle();
		if (existing) return existing as { id: string };

		const { data, error } = await supabase
			.from('pl_event_attendance')
			.insert({ eventId, customerId })
			.select('id')
			.single();
		if (error) throw new Error(error.message);
		return data as { id: string };
	}

	async leaveEventWaitingRoom(eventId: string, customerId: string) {
		const { error } = await supabase
			.from('pl_event_attendance')
			.update({ leftAt: new Date().toISOString() })
			.eq('eventId', eventId)
			.eq('customerId', customerId)
			.is('leftAt', null);
		if (error) throw new Error(error.message);
	}

	async listEventAttendees(eventId: string) {
		// Presenças ativas + nome/foto resolvidos SEM embed: as pl_* perderam o FK
		// → Customers (drop p/ usuários nativos do upvox), então `!inner(Customers)`
		// estoura no schema cache. Buscamos FROM Customers (FK → pl_community_profile
		// ainda existe) e mapeamos por id; ids sem Customers caem em null.
		const { data, error } = await supabase
			.from('pl_event_attendance')
			.select('customerId, joinedAt')
			.eq('eventId', eventId)
			.is('leftAt', null)
			.order('joinedAt', { ascending: true });
		if (error) throw new Error(error.message);
		const rows = (data ?? []) as { customerId: string; joinedAt: string }[];

		const ids = [...new Set(rows.map((r) => r.customerId))];
		const byId = new Map<
			string,
			{ name: string | null; image: string | null }
		>();
		if (ids.length > 0) {
			const { data: customers, error: cErr } = await supabase
				.from('Customers')
				.select('id, name, pl_community_profile(image)')
				.in('id', ids);
			if (cErr) throw new Error(cErr.message);
			for (const row of customers ?? []) {
				// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
				const r = row as any;
				const profileList = r.pl_community_profile;
				const profile = Array.isArray(profileList)
					? profileList[0]
					: profileList;
				byId.set(r.id as string, {
					name: (r.name as string | null) ?? null,
					image: (profile?.image as string | null) ?? null,
				});
			}
		}

		return rows.map((r) => {
			const c = byId.get(r.customerId);
			return {
				customerId: r.customerId,
				customerName: c?.name ?? null,
				customerImage: c?.image ?? null,
				joinedAt: r.joinedAt,
			};
		});
	}

	async isCustomerInWaitingRoom(eventId: string, customerId: string) {
		const { data, error } = await supabase
			.from('pl_event_attendance')
			.select('id')
			.eq('eventId', eventId)
			.eq('customerId', customerId)
			.is('leftAt', null)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return !!data;
	}

	async listPostComments(postId: string, page: number, limit: number) {
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		const { data, error } = await supabase
			.from('pl_community_post_comment')
			.select('*')
			.eq('postId', postId)
			.order('createdAt', { ascending: true })
			.range(from, to);
		if (error) throw new Error(error.message);

		return (data ?? []).map(
			(c: {
				id: string;
				postId: string;
				authorName: string;
				content: string;
				createdAt: string;
				isAdmin: boolean;
			}) => ({
				id: c.id,
				postId: c.postId,
				author: c.authorName,
				content: c.content,
				time: c.createdAt,
				isAdmin: c.isAdmin,
			}),
		);
	}

	async createPostComment(
		postId: string,
		data: CreateComment & {
			authorId: string;
			authorName: string;
			authorAvatar: string | null;
			isAdmin: boolean;
		},
	) {
		const { data: comment, error } = await supabase
			.from('pl_community_post_comment')
			.insert({
				id: crypto.randomUUID(),
				postId,
				content: data.content,
				authorId: data.authorId,
				authorName: data.authorName,
				authorAvatar: data.authorAvatar,
				isAdmin: data.isAdmin,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);

		return {
			id: comment.id,
			postId,
			author: data.authorName,
			content: data.content,
			time: comment.createdAt,
			isAdmin: data.isAdmin,
		};
	}

	async togglePostLike(postId: string, customerId: string) {
		const { data: existing } = await supabase
			.from('pl_community_post_like')
			.select('id')
			.eq('postId', postId)
			.eq('customerId', customerId)
			.maybeSingle();

		if (existing) {
			await supabase
				.from('pl_community_post_like')
				.delete()
				.eq('id', existing.id);
			return { liked: false };
		}

		await supabase.from('pl_community_post_like').insert({
			id: crypto.randomUUID(),
			postId,
			customerId,
		});
		return { liked: true };
	}

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

	async getStats() {
		const [
			{ count: membersCount },
			{ count: projectsCount },
			{ count: messagesCount },
			{ count: livesCount },
		] = await Promise.all([
			supabase.from('Customers').select('*', { count: 'exact', head: true }),
			supabase
				.from('pl_community_project')
				.select('*', { count: 'exact', head: true }),
			supabase
				.from('pl_community_message')
				.select('*', { count: 'exact', head: true }),
			supabase
				.from('pl_community_event')
				.select('*', { count: 'exact', head: true })
				.eq('type', 'live'),
		]);

		return {
			activeMembers: membersCount ?? 0,
			completedProjects: projectsCount ?? 0,
			messagesSent: messagesCount ?? 0,
			livesRealized: livesCount ?? 0,
		};
	}

	async listActivity(page: number, limit: number) {
		const fetchLimit = page * limit;
		const offset = (page - 1) * limit;

		const [
			{ data: completions },
			{ data: badges },
			{ data: forumPosts },
			{ data: forumReplies },
			{ data: challengeParticipants },
			{ data: newMembers },
		] = await Promise.all([
			supabase
				.from('customer_lesson_completions')
				.select('customer_id, lesson_id, completed_at')
				.order('completed_at', { ascending: false })
				.limit(fetchLimit),
			supabase
				.from('pl_gamification_user_badge')
				.select(
					'userId, badgeId, earnedAt, pl_gamification_badge(id, name, icon)',
				)
				.order('earnedAt', { ascending: false })
				.limit(fetchLimit),
			supabase
				.from('forum_posts')
				.select('id, title, author_id, author_name, created_at')
				.order('created_at', { ascending: false })
				.limit(fetchLimit),
			supabase
				.from('forum_replies')
				.select('id, post_id, author_id, author_name, created_at')
				.order('created_at', { ascending: false })
				.limit(fetchLimit),
			supabase
				.from('pl_challenge_participant')
				.select('id, userId, challengeId, joinedAt, pl_challenge(title)')
				.order('joinedAt', { ascending: false })
				.limit(fetchLimit),
			supabase
				.from('Customers')
				.select('id, name, created_at, pl_community_profile(image)')
				.order('created_at', { ascending: false })
				.limit(fetchLimit),
		]);

		// Collect IDs for batch lookups
		const lessonIds = [
			...new Set(
				(completions ?? []).map((c) => (c as { lesson_id: string }).lesson_id),
			),
		];
		const customerIds = new Set<string>();

		for (const c of completions ?? [])
			customerIds.add((c as { customer_id: string }).customer_id);
		for (const b of badges ?? [])
			customerIds.add((b as { userId: string }).userId);
		for (const fp of forumPosts ?? [])
			customerIds.add((fp as { author_id: string }).author_id);
		for (const fr of forumReplies ?? [])
			customerIds.add((fr as { author_id: string }).author_id);
		for (const cp of challengeParticipants ?? [])
			customerIds.add((cp as { userId: string }).userId);

		const replyPostIds = [
			...new Set(
				(forumReplies ?? []).map((r) => (r as { post_id: string }).post_id),
			),
		];

		// Batch lookups
		const [{ data: lessons }, { data: customerRows }, { data: postRows }] =
			await Promise.all([
				lessonIds.length > 0
					? supabase
							.from('pl_lesson')
							.select('id, title, productId, pl_product(name)')
							.in('id', lessonIds)
					: Promise.resolve({ data: [] as unknown[] }),
				customerIds.size > 0
					? supabase
							.from('Customers')
							.select('id, name, pl_community_profile(image)')
							.in('id', [...customerIds])
					: Promise.resolve({ data: [] as unknown[] }),
				replyPostIds.length > 0
					? supabase
							.from('forum_posts')
							.select('id, title')
							.in('id', replyPostIds)
					: Promise.resolve({ data: [] as unknown[] }),
			]);

		// Build lookup maps
		type UserInfo = { id: string; name: string; avatar: string | null };

		const lessonMap = new Map<string, { title: string; courseName: string }>();
		for (const l of lessons ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic join result
			const lesson = l as any;
			lessonMap.set(lesson.id, {
				title: lesson.title ?? '',
				courseName: lesson.pl_product?.name ?? '',
			});
		}

		const customerMap = new Map<string, UserInfo>();
		for (const c of customerRows ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic join result
			const customer = c as any;
			const profile = customer.pl_community_profile?.[0] ?? null;
			customerMap.set(customer.id, {
				id: customer.id,
				name: customer.name,
				avatar: profile?.image ?? null,
			});
		}
		for (const m of newMembers ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic join result
			const member = m as any;
			if (!customerMap.has(member.id)) {
				const profile = member.pl_community_profile?.[0] ?? null;
				customerMap.set(member.id, {
					id: member.id,
					name: member.name,
					avatar: profile?.image ?? null,
				});
			}
		}

		const postTitleMap = new Map<string, string>();
		for (const p of postRows ?? []) {
			const post = p as { id: string; title: string };
			postTitleMap.set(post.id, post.title);
		}

		type ActivityItem = {
			id: string;
			type: string;
			user: UserInfo;
			data: Record<string, unknown>;
			createdAt: string;
		};

		const items: ActivityItem[] = [];

		for (const c of completions ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic row
			const row = c as any;
			if (!row.completed_at) continue;
			const lesson = lessonMap.get(row.lesson_id);
			const user = customerMap.get(row.customer_id);
			if (!lesson || !user) continue;
			items.push({
				id: `lesson_completed_${row.customer_id}_${row.lesson_id}`,
				type: 'lesson_completed',
				user,
				data: { lessonTitle: lesson.title, courseName: lesson.courseName },
				createdAt: row.completed_at,
			});
		}

		for (const b of badges ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic join result
			const row = b as any;
			if (!row.earnedAt) continue;
			const user = customerMap.get(row.userId);
			if (!user) continue;
			const badge = row.pl_gamification_badge as {
				name: string;
				icon: string;
			} | null;
			items.push({
				id: `badge_earned_${row.userId}_${row.badgeId}`,
				type: 'badge_earned',
				user,
				data: { badgeName: badge?.name ?? '', badgeIcon: badge?.icon ?? '' },
				createdAt: row.earnedAt,
			});
		}

		for (const fp of forumPosts ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic row
			const row = fp as any;
			if (!row.created_at) continue;
			const user: UserInfo = customerMap.get(row.author_id) ?? {
				id: row.author_id,
				name: row.author_name,
				avatar: null,
			};
			items.push({
				id: `forum_post_${row.id}`,
				type: 'forum_post',
				user,
				data: { postTitle: row.title },
				createdAt: row.created_at,
			});
		}

		for (const fr of forumReplies ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic row
			const row = fr as any;
			if (!row.created_at) continue;
			const user: UserInfo = customerMap.get(row.author_id) ?? {
				id: row.author_id,
				name: row.author_name,
				avatar: null,
			};
			items.push({
				id: `forum_reply_${row.id}`,
				type: 'forum_reply',
				user,
				data: { postTitle: postTitleMap.get(row.post_id) ?? '' },
				createdAt: row.created_at,
			});
		}

		for (const cp of challengeParticipants ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic join result
			const row = cp as any;
			if (!row.joinedAt) continue;
			const user = customerMap.get(row.userId);
			if (!user) continue;
			const challenge = row.pl_challenge as { title: string } | null;
			items.push({
				id: `challenge_completed_${row.id}`,
				type: 'challenge_completed',
				user,
				data: { challengeTitle: challenge?.title ?? '' },
				createdAt: row.joinedAt,
			});
		}

		for (const m of newMembers ?? []) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic join result
			const row = m as any;
			if (!row.created_at) continue;
			const profile = row.pl_community_profile?.[0] ?? null;
			items.push({
				id: `member_joined_${row.id}`,
				type: 'member_joined',
				user: { id: row.id, name: row.name, avatar: profile?.image ?? null },
				data: {},
				createdAt: row.created_at,
			});
		}

		items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return items.slice(offset, offset + limit);
	}
}

export const communityRepository = new CommunityRepository();
