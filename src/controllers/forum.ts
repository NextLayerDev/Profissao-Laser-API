import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import {
	colorForThemeName,
	suggestForumTheme,
} from '../lib/forum-theme-suggest.js';
import { forumRepository } from '../repositories/forum.js';
import {
	createForumCategorySchema,
	createForumPostSchema,
	createForumReplySchema,
	suggestForumCategorySchema,
	updateForumCategorySchema,
	updateForumPostSchema,
	updateForumReplySchema,
} from '../types/forum.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
	const user = request.currentUser;
	if (!user) {
		reply.status(401).send({ message: 'Not authenticated' });
		return false;
	}
	// Admin = role do upvox (admin/staff). Antes fazia lookup na tabela legada
	// `Users`, que dava 403 pro admin migrado (id agora é o do upvox).
	if (!isStaffRole(request.currentRole)) {
		reply.status(403).send({ message: 'Admin access required' });
		return false;
	}
	return true;
}

function getAuthor(request: FastifyRequest) {
	const userId = request.currentUser?.id ?? '';
	const customer = request.currentCustomer;
	const isInstructor = !customer;
	const name = customer?.name ?? request.currentUser?.email ?? 'Membro';
	return { id: userId, name, isInstructor };
}

function requireOwnerOrAdmin(
	request: FastifyRequest,
	reply: FastifyReply,
	ownerId: string,
): boolean {
	const userId = request.currentUser?.id ?? '';
	if (userId === ownerId) return true;

	// Dono OU admin/staff (role do upvox) — sem lookup na tabela legada `Users`.
	if (!isStaffRole(request.currentRole)) {
		reply.status(403).send({ message: 'Not authorized' });
		return false;
	}
	return true;
}

// ─── Category controllers ─────────────────────────────────────────────────────

export const listForumCategoriesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const categories = await forumRepository.listCategories();
		return reply.send(categories);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// Alunos também podem criar temas (pedido do cliente): dedupe por nome
// case-insensitive evita lixo, e a cor é sorteada quando não enviada.
export const createForumCategoryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createForumCategorySchema.parse(request.body);
		const existing = await forumRepository.findCategoryByName(data.name.trim());
		if (existing) return reply.status(201).send(existing);

		const category = await forumRepository.createCategory({
			name: data.name.trim(),
			color: data.color ?? colorForThemeName(data.name.trim()),
		});
		return reply.status(201).send(category);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

/** Tema inteligente: IA (com fallback heurístico) escolhe ou cria o tema. */
export const suggestForumCategoryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { title, content } = suggestForumCategorySchema.parse(request.body);
		const categories = await forumRepository.listCategories();
		const suggestion = await suggestForumTheme(title, content, categories);

		if (suggestion.existingId) {
			const category = categories.find((c) => c.id === suggestion.existingId);
			if (category) return reply.send({ category, isNew: false });
		}

		const newName = (suggestion.newName ?? 'Dúvidas Gerais').trim();
		const existing = await forumRepository.findCategoryByName(newName);
		if (existing) return reply.send({ category: existing, isNew: false });

		const created = await forumRepository.createCategory({
			name: newName,
			color: colorForThemeName(newName),
		});
		return reply.send({ category: created, isNew: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateForumCategoryController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { id } = request.params;
		const data = updateForumCategorySchema.parse(request.body);
		const category = await forumRepository.updateCategory(id, data);
		return reply.send(category);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteForumCategoryController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { id } = request.params;
		await forumRepository.deleteCategory(id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ─── Post controllers ─────────────────────────────────────────────────────────

export const listForumPostsController = async (
	request: FastifyRequest<{
		Querystring: {
			page?: string;
			limit?: string;
			categoryId?: string;
			search?: string;
			sort?: 'recent' | 'top' | 'unanswered';
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const {
			page = '1',
			limit = '20',
			categoryId,
			search,
			sort,
		} = request.query;
		const currentUserId = request.currentUser?.id ?? '';
		const result = await forumRepository.listPosts({
			page: Math.max(1, Number(page)),
			limit: Math.min(50, Math.max(1, Number(limit))),
			categoryId,
			search,
			currentUserId,
			sort,
		});
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getForumPostController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const currentUserId = request.currentUser?.id ?? '';
		const post = await forumRepository.getPost(id, currentUserId);
		return reply.send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(404).send({ message });
	}
};

export const createForumPostController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createForumPostSchema.parse(request.body);
		const author = getAuthor(request);
		const post = await forumRepository.createPost(data, author);
		return reply.status(201).send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateForumPostController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const currentUserId = request.currentUser?.id ?? '';
		const existing = await forumRepository.getPost(id, currentUserId);
		if (!(await requireOwnerOrAdmin(request, reply, existing.authorId))) return;

		const data = updateForumPostSchema.parse(request.body);
		const post = await forumRepository.updatePost(id, data, currentUserId);
		return reply.send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteForumPostController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const currentUserId = request.currentUser?.id ?? '';
		const existing = await forumRepository.getPost(id, currentUserId);
		if (!(await requireOwnerOrAdmin(request, reply, existing.authorId))) return;

		await forumRepository.deletePost(id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const upvoteForumPostController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const userId = request.currentUser?.id ?? '';
		const post = await forumRepository.togglePostUpvote(id, userId);
		return reply.send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ─── Reply controllers ────────────────────────────────────────────────────────

export const createForumReplyController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id: postId } = request.params;
		const data = createForumReplySchema.parse(request.body);
		const author = getAuthor(request);
		const post = await forumRepository.createReply(postId, data, author);
		return reply.status(201).send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateForumReplyController = async (
	request: FastifyRequest<{ Params: { id: string; replyId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id: postId, replyId } = request.params;
		const currentUserId = request.currentUser?.id ?? '';

		const post = await forumRepository.getPost(postId, currentUserId);
		const replyObj = post.replies?.find((r) => r.id === replyId);
		if (!replyObj)
			return reply.status(404).send({ message: 'Reply not found' });

		if (!(await requireOwnerOrAdmin(request, reply, replyObj.authorId))) return;

		const data = updateForumReplySchema.parse(request.body);
		const updated = await forumRepository.updateReply(
			postId,
			replyId,
			data.content,
			currentUserId,
		);
		return reply.send(updated);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteForumReplyController = async (
	request: FastifyRequest<{ Params: { id: string; replyId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id: postId, replyId } = request.params;
		const currentUserId = request.currentUser?.id ?? '';

		// Get the reply to check ownership
		const post = await forumRepository.getPost(postId, currentUserId);
		const replyObj = post.replies?.find((r) => r.id === replyId);
		if (!replyObj)
			return reply.status(404).send({ message: 'Reply not found' });

		if (!(await requireOwnerOrAdmin(request, reply, replyObj.authorId))) return;

		await forumRepository.deleteReply(postId, replyId, currentUserId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const acceptForumReplyController = async (
	request: FastifyRequest<{ Params: { id: string; replyId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id: postId, replyId } = request.params;
		const currentUserId = request.currentUser?.id ?? '';
		const post = await forumRepository.acceptReply(
			postId,
			replyId,
			currentUserId,
		);
		return reply.send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const upvoteForumReplyController = async (
	request: FastifyRequest<{ Params: { id: string; replyId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id: postId, replyId } = request.params;
		const userId = request.currentUser?.id ?? '';
		const post = await forumRepository.toggleReplyUpvote(
			postId,
			replyId,
			userId,
		);
		return reply.send(post);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
