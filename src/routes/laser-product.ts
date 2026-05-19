import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createLaserProductController,
	createVariantController,
	deleteLaserProductController,
	deleteVariantController,
	getLaserProductController,
	listLaserProductsController,
	listVariantsController,
	updateLaserProductController,
	updateVariantController,
	uploadProductImageController,
	uploadVariantImageController,
} from '../controllers/laser-product.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createLaserProductSchema,
	createLaserProductVariantSchema,
	laserProductListQuerySchema,
	laserProductListResponseSchema,
	laserProductSchema,
	laserProductVariantListResponseSchema,
	laserProductVariantSchema,
	laserProductWithVariantsSchema,
	updateLaserProductSchema,
	updateLaserProductVariantSchema,
} from '../types/laser-product.js';

export async function laserProductRoute(server: FastifyInstance) {
	// ── List products ─────────────────────────────────────────────────────
	server.get(
		'/laser-products',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista paginada do catálogo de produtos engraváveis (canecas, tábuas, abridores, etc.). Customers só veem ativos; staff vê todos.',
				querystring: laserProductListQuerySchema,
				response: {
					200: laserProductListResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		listLaserProductsController,
	);

	// ── Get one product (with variants embedded) ─────────────────────────
	server.get(
		'/laser-products/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Detalhe do produto + lista de variants (cores/tipos disponíveis).',
				params: z.object({ id: z.string() }),
				response: {
					200: laserProductWithVariantsSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		getLaserProductController,
	);

	// ── Create product (admin) ────────────────────────────────────────────
	server.post(
		'/laser-products',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Cria novo produto no catálogo (apenas staff).',
				body: createLaserProductSchema,
				response: {
					201: laserProductSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		createLaserProductController,
	);

	// ── Update product (admin) ────────────────────────────────────────────
	server.patch(
		'/laser-products/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Atualiza produto (apenas staff).',
				params: z.object({ id: z.string() }),
				body: updateLaserProductSchema,
				response: {
					200: laserProductSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateLaserProductController,
	);

	// ── Delete product (admin, cascade nas variants) ─────────────────────
	server.delete(
		'/laser-products/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Remove produto, suas variants e os arquivos de imagem associados no CDN.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteLaserProductController,
	);

	// ── Upload product image (admin, multipart) ──────────────────────────
	server.post(
		'/laser-products/:id/image',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: [
					'Upload da foto do **produto** via **multipart/form-data**. Substitui a imagem antiga. As variants têm foto própria em `/variants/:variantId/image`.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | Imagem PNG/JPG |',
				].join('\n'),
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: laserProductSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadProductImageController,
	);

	// ── List variants ─────────────────────────────────────────────────────
	server.get(
		'/laser-products/:id/variants',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Lista variants (cores/tipos) de um produto.',
				params: z.object({ id: z.string() }),
				response: {
					200: laserProductVariantListResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		listVariantsController,
	);

	// ── Create variant (admin) ────────────────────────────────────────────
	server.post(
		'/laser-products/:id/variants',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Cria nova variant. Pelo menos colorName OU tipo deve ser informado.',
				params: z.object({ id: z.string() }),
				body: createLaserProductVariantSchema,
				response: {
					201: laserProductVariantSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		createVariantController,
	);

	// ── Update variant (admin) ────────────────────────────────────────────
	server.patch(
		'/laser-products/:id/variants/:variantId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Atualiza variant (apenas staff).',
				params: z.object({ id: z.string(), variantId: z.string() }),
				body: updateLaserProductVariantSchema,
				response: {
					200: laserProductVariantSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateVariantController,
	);

	// ── Upload variant image (admin, multipart) ─────────────────────────
	server.post(
		'/laser-products/:id/variants/:variantId/image',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: [
					'Upload da foto da variant via **multipart/form-data**. Substitui imagem antiga.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | Imagem PNG/JPG |',
				].join('\n'),
				params: z.object({ id: z.string(), variantId: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: laserProductVariantSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadVariantImageController,
	);

	// ── Delete variant (admin) ────────────────────────────────────────────
	server.delete(
		'/laser-products/:id/variants/:variantId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove variant e arquivo de imagem associado.',
				params: z.object({ id: z.string(), variantId: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Laser Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteVariantController,
	);
}
