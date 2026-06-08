import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadCourseImage } from '../lib/storage.js';
import { productRepository } from '../repositories/product.js';
import { productService } from '../services/product.js';
import {
	createAddonSchema,
	createProductSchema,
	updateProductSchema,
	updateProductStatusSchema,
} from '../types/product.js';

export const getProductsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data: products, error } = await productService.listProducts();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(products);
};

export const createProductController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const data = createProductSchema.parse(request.body);
	const { data: product, error } = await productService.createProduct(data);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(product);
};

export const createAddonController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const data = createAddonSchema.parse(request.body);
	const { data: addon, error } = await productService.createAddon(data);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(addon);
};

export const updateProductStatusController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { active } = updateProductStatusSchema.parse(request.body);
	const { data: product, error } = await productService.updateProductStatus(
		request.params.id,
		active,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(product);
};

export const updateProductController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const data = updateProductSchema.parse(request.body);
	const { data: product, error } = await productService.updateProduct(
		request.params.id,
		data,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(product);
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

		const { data: updatedProduct, error: updateError } =
			await productService.updateProduct(request.params.id, data);
		if (updateError) {
			const message =
				updateError instanceof Error ? updateError.message : 'Unknown error';
			const status = message === 'Product not found' ? 404 : 500;
			return reply.status(status).send({ message });
		}

		let product = updatedProduct;

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
	const { error } = await productService.deleteProduct(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};
