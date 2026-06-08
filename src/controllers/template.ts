import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { templateService } from '../services/template.js';
import {
	cloneTemplateSchema,
	createTemplateSchema,
	type TemplateTipo,
	updateTemplateSchema,
} from '../types/template.js';

function statusFor(message: string): number {
	if (message === 'Template not found') return 404;
	if (message === 'Template not available') return 400;
	return 500;
}

// ── List ──────────────────────────────────────────────────────────────────
export const listTemplatesController = async (
	request: FastifyRequest<{
		Querystring: {
			page?: number;
			limit?: number;
			categoryId?: string;
			tipoImagem?: TemplateTipo;
			tag?: string;
			search?: string;
			status?: 'ativo' | 'inativo';
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const staff = isStaffRole(request.currentRole);

		const page = request.query.page ?? 1;
		const limit = request.query.limit ?? 20;
		const result = await templateService.list({
			page,
			limit,
			categoryId: request.query.categoryId,
			tipoImagem: request.query.tipoImagem,
			tag: request.query.tag,
			search: request.query.search,
			status: request.query.status,
			includeInactive: staff, // staff pode ver inativos por padrão
		});
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ── Get one ───────────────────────────────────────────────────────────────
export const getTemplateController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const staff = isStaffRole(request.currentRole);

		const template = await templateService.findById(request.params.id);
		if (template.status !== 'ativo' && !staff) {
			return reply.status(404).send({ message: 'Template not found' });
		}
		return reply.send(template);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Create (admin) ────────────────────────────────────────────────────────
export const createTemplateController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createTemplateSchema.parse(request.body);
		const createdBy = request.currentUser?.id ?? null;
		const template = await templateService.create(data, createdBy);
		return reply.status(201).send(template);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Update (admin) ────────────────────────────────────────────────────────
export const updateTemplateController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateTemplateSchema.parse(request.body);
		const template = await templateService.update(request.params.id, data);
		return reply.send(template);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Upload image (admin, multipart) ───────────────────────────────────────
export const uploadTemplateImageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const file = await request.file();
		if (!file) {
			return reply.status(400).send({ message: 'File is required' });
		}
		const buffer = await file.toBuffer();
		const template = await templateService.uploadImage(
			request.params.id,
			buffer,
			file.mimetype,
			file.filename ?? 'template.png',
		);
		return reply.send(template);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Delete (admin) ────────────────────────────────────────────────────────
export const deleteTemplateController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await templateService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Clone (customer) ──────────────────────────────────────────────────────
export const cloneTemplateController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const data = cloneTemplateSchema.parse(request.body ?? {});
		const design = await templateService.clone(
			request.params.id,
			customerId,
			data,
		);
		return reply.status(201).send(design);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};
