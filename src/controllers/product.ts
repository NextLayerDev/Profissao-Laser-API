import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadCourseImage } from '../lib/storage.js';
import { productRepository } from '../repositories/product.js';
import { productService } from '../services/product.js';
import {
	createProductSchema,
	updateProductSchema,
	updateProductStatusSchema,
} from '../types/product.js';

export const getProductsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const products = await productService.listProducts();
		return reply.send(products);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createProductController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createProductSchema.parse(request.body);
		const product = await productService.createProduct(data);
		return reply.status(201).send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateProductStatusController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { active } = updateProductStatusSchema.parse(request.body);
		const product = await productService.updateProductStatus(
			request.params.id,
			active,
		);
		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const updateProductController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateProductSchema.parse(request.body);
		const product = await productService.updateProduct(request.params.id, data);
		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const updateProductFormController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const parts = request.parts();

		const fields: Record<string, string> = {};
		let fileBuffer: Buffer | null = null;
		let fileMimetype = 'image/jpeg';
		let fileExt = 'jpg';

		for await (const part of parts) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
				fileMimetype = part.mimetype;
				fileExt = part.filename.split('.').pop() ?? 'jpg';
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		const data: import('../types/product.js').ProductUpdate = {};
		if (fields.name) data.name = fields.name;
		if (fields.description) data.description = fields.description;
		if (fields.category) data.category = fields.category;
		if (fields.price) data.price = Number(fields.price);
		if (fields.refundDays) data.refundDays = Number(fields.refundDays);

		let product = await productService.updateProduct(request.params.id, data);

		if (fileBuffer) {
			const storagePath = `${request.params.id}/${crypto.randomUUID()}.${fileExt}`;
			const url = await uploadCourseImage(
				fileBuffer,
				storagePath,
				fileMimetype,
			);
			product = await productRepository.updateImage(request.params.id, url);
		}

		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const uploadProductImageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const file = await request.file();
		if (!file) return reply.status(400).send({ message: 'No file provided' });

		const buffer = await file.toBuffer();
		const ext = file.filename.split('.').pop() ?? 'jpg';
		const storagePath = `${request.params.id}/${crypto.randomUUID()}.${ext}`;

		const url = await uploadCourseImage(buffer, storagePath, file.mimetype);
		const product = await productRepository.updateImage(request.params.id, url);

		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteProductController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await productService.deleteProduct(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
