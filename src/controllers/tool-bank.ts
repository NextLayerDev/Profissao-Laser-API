import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { uploadToolOutput } from '../lib/storage.js';
import { imageSizePresetRepository } from '../repositories/image-size-preset.js';
import { toolBankRepository } from '../repositories/tool-bank.js';
import {
	bankImageSizeSchema,
	createToolBankEntrySchema,
	reorderToolBankSchema,
	resolveImageSizePx,
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
/**
 * Os dois uploads FIXOS do registro (as imagens do card). Qualquer OUTRO campo
 * de arquivo é um campo `type: "image"` declarado em `bank.fields` — a URL dele
 * vai para dentro de `data`, sob o próprio nome.
 *
 * Antes esta lista era a única coisa aceita, e todo arquivo fora dela caía no
 * `else { await part.toBuffer() }` — descartado EM SILÊNCIO. Uma tool com campo
 * de imagem no banco (brasão, logo, mascote) salvava o registro sem a imagem,
 * sem erro nenhum, e só se descobria na hora de usar.
 */
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

/**
 * Se `data.image_size` veio no payload (px/mm/preset — ver `bankImageSizeSchema`),
 * resolve pra px e grava em `data.image_size_px`, que é o que `tool-run` lê pra
 * sobrepor o tamanho de saída do `ai.generate_image` deste item do banco.
 */
async function normalizeImageSize(
	dataObj: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	if (dataObj.image_size === undefined) return dataObj;
	const parsed = bankImageSizeSchema.parse(dataObj.image_size);
	const { image_size, ...rest } = dataObj;
	const image_size_px = await resolveImageSizePx(parsed, (id) =>
		imageSizePresetRepository.findById(id),
	);
	return { ...rest, image_size_px };
}

/** Lê multipart: campos string + uploads de exemplo (example_before/after). */
async function collectMultipart(request: FastifyRequest): Promise<{
	fields: Record<string, string>;
	images: Record<string, string>;
	/** URLs dos campos `type: "image"` do banco, por nome de campo. */
	dataImages: Record<string, string>;
}> {
	const fields: Record<string, string> = {};
	const images: Record<string, string> = {};
	const dataImages: Record<string, string> = {};
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
				// Campo de imagem declarado em `bank.fields`. Mesmas travas de tipo e
				// tamanho: um upload de admin não é motivo para relaxá-las.
				if (!ALLOWED_IMAGE_MIMETYPES.includes(part.mimetype)) {
					throw new Error('Tipo de imagem inválido (png/jpg/webp/gif/svg).');
				}
				const buffer = await part.toBuffer();
				if (buffer.byteLength > MAX_IMAGE_SIZE) {
					throw new Error('Imagem grande demais (máx 5MB).');
				}
				const ext = extFor(part.mimetype);
				dataImages[part.fieldname] = await uploadToolOutput(
					'tool-bank',
					buffer,
					`${crypto.randomUUID()}.${ext}`,
					part.mimetype,
				);
			}
		} else {
			fields[part.fieldname] = part.value as string;
		}
	}
	return { fields, images, dataImages };
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
		const { fields, images, dataImages } = await collectMultipart(request);
		const dataObj0 = parseJsonObject(fields.data);
		const dataObjNorm = dataObj0
			? await normalizeImageSize(dataObj0)
			: dataObj0;
		// As URLs dos campos de imagem entram no `data`, junto dos textos.
		const dataObj =
			Object.keys(dataImages).length > 0
				? { ...(dataObjNorm ?? {}), ...dataImages }
				: dataObjNorm;
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
		const { fields, images, dataImages } = await collectMultipart(request);
		const dataObj0 = parseJsonObject(fields.data);
		const dataObjNorm = dataObj0
			? await normalizeImageSize(dataObj0)
			: dataObj0;
		/**
		 * Imagem NÃO reenviada preserva a que já estava.
		 *
		 * O front só manda o arquivo quando o admin escolhe um novo; sem esta
		 * mesclagem, salvar o registro para corrigir um typo no título apagaria o
		 * brasão — e o `data` é substituído por inteiro no update.
		 */
		const anterior = (await toolBankRepository.findById(id, key)) ?? null;
		const imagensAntigas: Record<string, string> = {};
		for (const [k, v] of Object.entries(
			(anterior?.data ?? {}) as Record<string, unknown>,
		)) {
			if (typeof v === 'string' && /^https?:\/\//.test(v))
				imagensAntigas[k] = v;
		}
		const dataObj = dataObjNorm
			? { ...imagensAntigas, ...dataObjNorm, ...dataImages }
			: dataObjNorm;
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
