import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadFaqImage } from '../lib/storage.js';
import { supabase } from '../lib/supabase.js';
import { faqRepository } from '../repositories/faq.js';
import {
	createFaqSchema,
	reactFaqSchema,
	reorderFaqSchema,
	updateFaqSchema,
} from '../types/faq.js';

const ALLOWED_IMAGE_MIMETYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

async function requireAdmin(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<boolean> {
	const user = request.currentUser;
	if (!user) {
		reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Not authenticated',
		});
		return false;
	}

	const { data: platformUser } = await supabase
		.from('Users')
		.select('id')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (!platformUser) {
		reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Admin access required',
		});
		return false;
	}

	return true;
}

export const listFaqsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id;
		const faqs = await faqRepository.findAll(userId);
		return reply.send(faqs);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createFaqController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const fields: Record<string, string> = {};
		let imageUrl: string | undefined;

		for await (const part of request.parts()) {
			if (part.type === 'file') {
				if (part.fieldname === 'image') {
					if (!ALLOWED_IMAGE_MIMETYPES.includes(part.mimetype)) {
						return reply.status(400).send({
							message: 'Invalid file type. Allowed: jpeg, png, webp, gif',
						});
					}
					const buffer = await part.toBuffer();
					if (buffer.byteLength > MAX_IMAGE_SIZE) {
						return reply
							.status(400)
							.send({ message: 'File too large. Maximum size is 5MB' });
					}
					const ext = part.mimetype.split('/')[1];
					const storagePath = `${crypto.randomUUID()}.${ext}`;
					imageUrl = await uploadFaqImage(buffer, storagePath, part.mimetype);
				} else {
					await part.toBuffer();
				}
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		const data = createFaqSchema.parse({
			question: fields.question,
			answer: fields.answer,
			imageUrl,
			order: Number(fields.order),
		});
		const faq = await faqRepository.create(data);
		return reply.status(201).send(faq);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateFaqController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { id } = request.params;
		const fields: Record<string, string> = {};
		let imageUrl: string | null | undefined;

		for await (const part of request.parts()) {
			if (part.type === 'file') {
				if (part.fieldname === 'image') {
					if (!ALLOWED_IMAGE_MIMETYPES.includes(part.mimetype)) {
						return reply.status(400).send({
							message: 'Invalid file type. Allowed: jpeg, png, webp, gif',
						});
					}
					const buffer = await part.toBuffer();
					if (buffer.byteLength > MAX_IMAGE_SIZE) {
						return reply
							.status(400)
							.send({ message: 'File too large. Maximum size is 5MB' });
					}
					const ext = part.mimetype.split('/')[1];
					const storagePath = `${crypto.randomUUID()}.${ext}`;
					imageUrl = await uploadFaqImage(buffer, storagePath, part.mimetype);
				} else {
					await part.toBuffer();
				}
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		if (fields.removeImage === 'true') imageUrl = null;

		const data = updateFaqSchema.parse({
			...(fields.question !== undefined && { question: fields.question }),
			...(fields.answer !== undefined && { answer: fields.answer }),
			...(fields.order !== undefined && { order: Number(fields.order) }),
			...(imageUrl !== undefined && { imageUrl }),
		});
		const faq = await faqRepository.update(id, data, request.currentUser?.id);
		return reply.send(faq);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteFaqController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { id } = request.params;
		await faqRepository.remove(id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const reorderFaqsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { ids } = reorderFaqSchema.parse(request.body);
		await faqRepository.reorder(ids);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const uploadFaqImageController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const data = await request.file();
		if (!data) return reply.status(400).send({ message: 'No file provided' });

		if (!ALLOWED_IMAGE_MIMETYPES.includes(data.mimetype)) {
			return reply
				.status(400)
				.send({ message: 'Invalid file type. Allowed: jpeg, png, webp, gif' });
		}

		const buffer = await data.toBuffer();

		if (buffer.byteLength > MAX_IMAGE_SIZE) {
			return reply
				.status(400)
				.send({ message: 'File too large. Maximum size is 5MB' });
		}

		const ext = data.mimetype.split('/')[1];
		const storagePath = `${crypto.randomUUID()}.${ext}`;
		const url = await uploadFaqImage(buffer, storagePath, data.mimetype);
		return reply.send({ url });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const reactToFaqController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const { emoji } = reactFaqSchema.parse(request.body);
		const userId = request.currentUser?.id;
		const faq = await faqRepository.upsertReaction(id, userId, emoji);
		return reply.send(faq);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const removeReactionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const userId = request.currentUser?.id;
		const faq = await faqRepository.removeReaction(id, userId);
		return reply.send(faq);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
