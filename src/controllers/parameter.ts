import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadParameterImage } from '../lib/storage.js';
import { parameterService } from '../services/parameter.js';
import {
	type CommunityListQuery,
	type CreateParameter,
	type CreateParameterOption,
	createParameterOptionSchema,
	createParameterSchema,
	type ExportQuery,
	type ListParametersQuery,
	type RateParameter,
	type ReviewParameter,
	reviewParameterSchema,
	type UpdateParameter,
	type UpdateParameterOption,
	updateParameterOptionSchema,
	updateParameterSchema,
} from '../types/parameter.js';

function getCurrentId(request: FastifyRequest): string | null {
	return request.currentCustomer?.id ?? request.currentUser?.id ?? null;
}

export const listParametersController = async (
	request: FastifyRequest<{ Querystring: ListParametersQuery }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	const { data, error } = await parameterService.list(
		request.query,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const getParameterController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	const { data, error } = await parameterService.get(
		request.params.id,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	if (!data) return reply.status(404).send({ message: 'Parameter not found' });
	return reply.send(data);
};

export const getParameterPassesController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	const { data, error } = await parameterService.getWithPasses(
		request.params.id,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	if (!data) return reply.status(404).send({ message: 'Parameter not found' });
	return reply.send(data);
};

export const createParameterController = async (
	request: FastifyRequest<{ Body: CreateParameter }>,
	reply: FastifyReply,
) => {
	const userId = request.currentUser?.id;
	if (!userId) return reply.status(401).send({ message: 'Not authenticated' });

	const body = createParameterSchema.parse(request.body);
	const name =
		request.currentCustomer?.name ??
		(request.currentUser?.user_metadata?.name as string | undefined) ??
		null;
	const { data, error } = await parameterService.create(body, userId, name);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(201).send(data);
};

export const updateParameterController = async (
	request: FastifyRequest<{ Params: { id: string }; Body: UpdateParameter }>,
	reply: FastifyReply,
) => {
	const body = updateParameterSchema.parse(request.body);
	const { data, error } = await parameterService.update(
		request.params.id,
		body,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	if (!data) return reply.status(404).send({ message: 'Parameter not found' });
	return reply.send(data);
};

export const deleteParameterController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await parameterService.delete(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

const ALLOWED_IMAGE_MIMETYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
];

export const uploadParameterImageController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const file = await request.file();
	if (!file) return reply.status(400).send({ message: 'No file provided' });
	if (!ALLOWED_IMAGE_MIMETYPES.includes(file.mimetype)) {
		return reply
			.status(400)
			.send({ message: 'Invalid file type. Allowed: jpeg, png, webp, gif' });
	}
	const buffer = await file.toBuffer();
	if (buffer.byteLength > 5 * 1024 * 1024) {
		return reply
			.status(400)
			.send({ message: 'File too large. Maximum size is 5MB' });
	}
	const ext = file.mimetype.split('/')[1];
	const url = await uploadParameterImage(
		buffer,
		`${crypto.randomUUID()}.${ext}`,
		file.mimetype,
	);
	return reply.status(200).send({ url });
};

export const parameterStatsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data, error } = await parameterService.stats();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const parameterSidebarController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data, error } = await parameterService.sidebar();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const listMachinesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data, error } = await parameterService.listMachines();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const listMaterialsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data, error } = await parameterService.listMaterials();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const listCommunityController = async (
	request: FastifyRequest<{ Querystring: CommunityListQuery }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	const { data, error } = await parameterService.listCommunity(
		request.query,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const saveParameterController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	if (!customerId)
		return reply.status(401).send({ message: 'Not authenticated' });
	const { error } = await parameterService.save(request.params.id, customerId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

export const unsaveParameterController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	if (!customerId)
		return reply.status(401).send({ message: 'Not authenticated' });
	const { error } = await parameterService.unsave(
		request.params.id,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

export const likeParameterController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	if (!customerId)
		return reply.status(401).send({ message: 'Not authenticated' });
	const { data, error } = await parameterService.like(
		request.params.id,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.send(data);
};

export const rateParameterController = async (
	request: FastifyRequest<{ Params: { id: string }; Body: RateParameter }>,
	reply: FastifyReply,
) => {
	const customerId = getCurrentId(request);
	if (!customerId)
		return reply.status(401).send({ message: 'Not authenticated' });
	const { error } = await parameterService.rate(
		request.params.id,
		customerId,
		request.body.rating,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

export const exportParametersController = async (
	request: FastifyRequest<{ Querystring: ExportQuery }>,
	reply: FastifyReply,
) => {
	const { format, ...filters } = request.query;
	const { data, error } = await parameterService.exportCsv(filters);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	if (format === 'pdf') {
		return reply
			.status(501)
			.send({ message: 'PDF export not yet implemented' });
	}
	reply.header('Content-Type', 'text/csv');
	reply.header('Content-Disposition', 'attachment; filename="parameters.csv"');
	return reply.send(data);
};

// ── Envio do membro / revisão do admin ──────────────────────────────────────

export const submitParameterController = async (
	request: FastifyRequest<{ Body: CreateParameter }>,
	reply: FastifyReply,
) => {
	const userId = request.currentUser?.id;
	if (!userId) return reply.status(401).send({ message: 'Not authenticated' });

	const body = createParameterSchema.parse(request.body);
	const name =
		request.currentCustomer?.name ??
		(request.currentUser?.user_metadata?.name as string | undefined) ??
		null;
	const { data, error } = await parameterService.submit(body, userId, name);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(201).send(data);
};

export const listPendingParametersController = async (
	request: FastifyRequest<{ Querystring: ListParametersQuery }>,
	reply: FastifyReply,
) => {
	const { data, error } = await parameterService.listPending(request.query);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const reviewParameterController = async (
	request: FastifyRequest<{ Params: { id: string }; Body: ReviewParameter }>,
	reply: FastifyReply,
) => {
	const reviewerId = request.currentUser?.id;
	if (!reviewerId)
		return reply.status(401).send({ message: 'Not authenticated' });

	const body = reviewParameterSchema.parse(request.body);
	const { data, error } = await parameterService.review(
		request.params.id,
		body,
		reviewerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	if (!data) return reply.status(404).send({ message: 'Parameter not found' });
	return reply.send(data);
};

export const listMySubmissionsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const userId = getCurrentId(request);
	if (!userId) return reply.status(401).send({ message: 'Not authenticated' });
	const { data, error } = await parameterService.listMySubmissions(userId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

// ── Vocabulário de opções de filtro ─────────────────────────────────────────

export const listParameterOptionsController = async (
	request: FastifyRequest<{ Querystring: { dimension?: string } }>,
	reply: FastifyReply,
) => {
	const { data, error } = await parameterService.listOptions(
		request.query.dimension,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const createParameterOptionController = async (
	request: FastifyRequest<{ Body: CreateParameterOption }>,
	reply: FastifyReply,
) => {
	const body = createParameterOptionSchema.parse(request.body);
	const { data, error } = await parameterService.createOption(body);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(201).send(data);
};

export const updateParameterOptionController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: UpdateParameterOption;
	}>,
	reply: FastifyReply,
) => {
	const body = updateParameterOptionSchema.parse(request.body);
	const { data, error } = await parameterService.updateOption(
		request.params.id,
		body,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	if (!data) return reply.status(404).send({ message: 'Option not found' });
	return reply.send(data);
};

export const deleteParameterOptionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await parameterService.deleteOption(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};
