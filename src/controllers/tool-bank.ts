import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { uploadToolOutput } from '../lib/storage.js';
import { toolBankRepository } from '../repositories/tool-bank.js';
import {
	createToolBankEntrySchema,
	reorderToolBankSchema,
	updateToolBankEntrySchema,
} from '../types/tool-bank.js';

const ALLOWED_IMAGE_MIMETYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/svg+xml',
];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const IMAGE_FIELDS = new Set(['example_before', 'example_after']);

/**
 * O Bunny CDN serve cada arquivo pelo Content-Type derivado da EXTENSÃO, não
 * pelo Content-Type enviado no PUT. `mimetype.split('/')[1]` daria `svg+xml`
 * p/ SVG → o CDN serve como octet-stream e o browser NÃO renderiza SVG sem
 * `image/svg+xml`. Este mapa garante a extensão canônica (svg, jpg, …).
 */
const MIME_EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
};
function extFor(mimetype: string): string {
	return MIME_EXT[mimetype] ?? mimetype.split('/')[1] ?? 'bin';
}

interface KeyParams {
	key: string;
}
interface KeyIdParams {
	key: string;
	id: string;
}

async function requireAdmin(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<boolean> {
	if (!request.currentUser) {
		reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Not authenticated',
		});
		return false;
	}
	if (!isStaffRole(request.currentRole)) {
		reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Admin access required',
		});
		return false;
	}
	return true;
}

function parseJsonObject(
	raw: string | undefined,
): Record<string, unknown> | undefined {
	if (raw === undefined || raw === '') return undefined;
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Lê multipart: campos string + uploads de exemplo (example_before/after). */
async function collectMultipart(request: FastifyRequest): Promise<{
	fields: Record<string, string>;
	images: Record<string, string>;
}> {
	const fields: Record<string, string> = {};
	const images: Record<string, string> = {};
	for await (const part of request.parts()) {
		if (part.type === 'file') {
			if (IMAGE_FIELDS.has(part.fieldname)) {
				if (!ALLOWED_IMAGE_MIMETYPES.includes(part.mimetype)) {
					throw new Error('Tipo de imagem inválido (png/jpg/webp/gif/svg).');
				}
				const buffer = await part.toBuffer();
				if (buffer.byteLength > MAX_IMAGE_SIZE) {
					throw new Error('Imagem grande demais (máx 5MB).');
				}
				const ext = extFor(part.mimetype);
				images[part.fieldname] = await uploadToolOutput(
					'tool-bank',
					buffer,
					`${crypto.randomUUID()}.${ext}`,
					part.mimetype,
				);
			} else {
				await part.toBuffer();
			}
		} else {
			fields[part.fieldname] = part.value as string;
		}
	}
	return { fields, images };
}

export const listToolBankController = async (
	request: FastifyRequest<{
		Params: KeyParams;
		Querystring: { category?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { key } = request.params;
		const entries = await toolBankRepository.list(key, {
			activeOnly: !isStaffRole(request.currentRole),
			category: request.query?.category,
		});
		return reply.send(entries);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createToolBankController = async (
	request: FastifyRequest<{ Params: KeyParams }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { key } = request.params;
		const { fields, images } = await collectMultipart(request);
		const dataObj = parseJsonObject(fields.data);
		const data = createToolBankEntrySchema.parse({
			title: fields.title,
			...(fields.description !== undefined && {
				description: fields.description,
			}),
			...(fields.category !== undefined && { category: fields.category }),
			...(fields.position !== undefined && {
				position: Number(fields.position),
			}),
			...(fields.active !== undefined && { active: fields.active === 'true' }),
			...(dataObj !== undefined && { data: dataObj }),
			...(images.example_before !== undefined && {
				example_before_url: images.example_before,
			}),
			...(images.example_after !== undefined && {
				example_after_url: images.example_after,
			}),
		});
		const entry = await toolBankRepository.create(
			key,
			data,
			request.currentUser?.id ?? null,
		);
		return reply.status(201).send(entry);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateToolBankController = async (
	request: FastifyRequest<{ Params: KeyIdParams }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { key, id } = request.params;
		const { fields, images } = await collectMultipart(request);
		const dataObj = parseJsonObject(fields.data);
		const beforeUrl =
			fields.removeExampleBefore === 'true' ? null : images.example_before;
		const afterUrl =
			fields.removeExampleAfter === 'true' ? null : images.example_after;
		const data = updateToolBankEntrySchema.parse({
			...(fields.title !== undefined && { title: fields.title }),
			...(fields.description !== undefined && {
				description: fields.description,
			}),
			...(fields.category !== undefined && { category: fields.category }),
			...(fields.position !== undefined && {
				position: Number(fields.position),
			}),
			...(fields.active !== undefined && { active: fields.active === 'true' }),
			...(dataObj !== undefined && { data: dataObj }),
			...(beforeUrl !== undefined && { example_before_url: beforeUrl }),
			...(afterUrl !== undefined && { example_after_url: afterUrl }),
		});
		const entry = await toolBankRepository.update(id, key, data);
		return reply.send(entry);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteToolBankController = async (
	request: FastifyRequest<{ Params: KeyIdParams }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { key, id } = request.params;
		await toolBankRepository.remove(id, key);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const reorderToolBankController = async (
	request: FastifyRequest<{ Params: KeyParams }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { key } = request.params;
		const { ids } = reorderToolBankSchema.parse(request.body);
		await toolBankRepository.reorder(key, ids);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const uploadToolBankImageController = async (
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
				.send({ message: 'Tipo de imagem inválido (png/jpg/webp/gif/svg).' });
		}
		const buffer = await data.toBuffer();
		if (buffer.byteLength > MAX_IMAGE_SIZE) {
			return reply
				.status(400)
				.send({ message: 'Imagem grande demais (máx 5MB).' });
		}
		const ext = extFor(data.mimetype);
		const url = await uploadToolOutput(
			'tool-bank',
			buffer,
			`${crypto.randomUUID()}.${ext}`,
			data.mimetype,
		);
		return reply.send({ url });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
