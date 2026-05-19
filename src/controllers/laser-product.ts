import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { laserProductService } from '../services/laser-product.js';
import {
	createLaserProductSchema,
	createLaserProductVariantSchema,
	updateLaserProductSchema,
	updateLaserProductVariantSchema,
} from '../types/laser-product.js';

function statusFor(message: string): number {
	if (message === 'Laser product not found') return 404;
	if (message === 'Variant not found') return 404;
	if (message === 'Variant inválido ou indisponível') return 400;
	return 500;
}

async function isStaff(
	userId: string,
	email?: string | null,
): Promise<boolean> {
	const { data } = await supabase
		.from('Users')
		.select('id')
		.or(`id.eq.${userId},email.eq.${email ?? ''}`)
		.maybeSingle();
	return !!data;
}

// ── Products ────────────────────────────────────────────────────────────────

export const listLaserProductsController = async (
	request: FastifyRequest<{
		Querystring: {
			page?: number;
			limit?: number;
			category?: string;
			search?: string;
			status?: 'ativo' | 'inativo';
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;
		const staff = user ? await isStaff(user.id, user.email) : false;
		const page = request.query.page ?? 1;
		const limit = request.query.limit ?? 20;
		const result = await laserProductService.list({
			page,
			limit,
			category: request.query.category,
			search: request.query.search,
			status: request.query.status,
			includeInactive: staff,
		});
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getLaserProductController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;
		const staff = user ? await isStaff(user.id, user.email) : false;

		const product = await laserProductService.findByIdWithVariants(
			request.params.id,
			{ includeInactiveVariants: staff },
		);
		if (product.status !== 'ativo' && !staff) {
			return reply.status(404).send({ message: 'Laser product not found' });
		}
		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const createLaserProductController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createLaserProductSchema.parse(request.body);
		const createdBy = request.currentUser?.id ?? null;
		const product = await laserProductService.create(data, createdBy);
		return reply.status(201).send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateLaserProductController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateLaserProductSchema.parse(request.body);
		const product = await laserProductService.update(request.params.id, data);
		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteLaserProductController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await laserProductService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const uploadProductImageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const file = await request.file();
		if (!file) {
			return reply.status(400).send({ message: 'File is required' });
		}
		const buffer = await file.toBuffer();
		const product = await laserProductService.uploadProductImage(
			request.params.id,
			buffer,
			file.mimetype,
			file.filename ?? 'product.png',
		);
		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Variants ────────────────────────────────────────────────────────────────

export const listVariantsController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;
		const staff = user ? await isStaff(user.id, user.email) : false;
		const variants = await laserProductService.listVariants(request.params.id, {
			includeInactiveVariants: staff,
		});
		return reply.send(variants);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createVariantController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = createLaserProductVariantSchema.parse(request.body);
		const variant = await laserProductService.createVariant(
			request.params.id,
			data,
		);
		return reply.status(201).send(variant);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const updateVariantController = async (
	request: FastifyRequest<{ Params: { id: string; variantId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateLaserProductVariantSchema.parse(request.body);
		const variant = await laserProductService.updateVariant(
			request.params.id,
			request.params.variantId,
			data,
		);
		return reply.send(variant);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const uploadVariantImageController = async (
	request: FastifyRequest<{ Params: { id: string; variantId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const file = await request.file();
		if (!file) {
			return reply.status(400).send({ message: 'File is required' });
		}
		const buffer = await file.toBuffer();
		const variant = await laserProductService.uploadVariantImage(
			request.params.id,
			request.params.variantId,
			buffer,
			file.mimetype,
			file.filename ?? 'variant.png',
		);
		return reply.send(variant);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteVariantController = async (
	request: FastifyRequest<{ Params: { id: string; variantId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await laserProductService.deleteVariant(
			request.params.id,
			request.params.variantId,
		);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};
