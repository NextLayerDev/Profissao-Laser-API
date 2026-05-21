import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateAdmin } from '@/middleware/auth.js';
import {
	createCursoController,
	deleteCursoController,
	getCursoByIdController,
	getCursosController,
	updateCursoController,
	updateCursoFormController,
	updateCursoStatusController,
	uploadCursoImageController,
} from '../controllers/curso.js';
import {
	createCursoSchema,
	cursoSchema,
	updateCursoSchema,
	updateCursoStatusSchema,
} from '../types/curso.js';
import { ErrorSchema } from '../types/error.js';

export async function cursoRoute(server: FastifyInstance) {
	server.get(
		'/cursos',
		{
			schema: {
				description: 'Lista todos os cursos ativos e inativos.',
				response: {
					200: z.array(cursoSchema),
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		getCursosController,
	);

	server.get(
		'/curso/:id',
		{
			schema: {
				description: 'Busca um curso pelo ID.',
				params: z.object({ id: z.string() }),
				response: {
					200: cursoSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		getCursoByIdController,
	);

	server.post(
		'/curso',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Cria um novo curso no Stripe e salva no banco. Flags de conteúdo: aulas, suporte, biblioteca.',
				body: createCursoSchema,
				response: {
					201: cursoSchema,
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		createCursoController,
	);

	server.patch(
		'/curso/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Atualiza um curso (nome, descrição, preço, flags de conteúdo). Nome e preço são sincronizados com o Stripe.',
				params: z.object({ id: z.string() }),
				body: updateCursoSchema,
				response: {
					200: cursoSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateCursoController,
	);

	server.patch(
		'/curso/:id/status',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Ativa ou desativa um curso (sincroniza com o Stripe).',
				params: z.object({ id: z.string() }),
				body: updateCursoStatusSchema,
				response: {
					200: cursoSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateCursoStatusController,
	);

	server.patch(
		'/curso/:id/form',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: [
					'Atualiza um curso via **multipart/form-data**. Todos os campos são opcionais.',
					'',
					'| Campo | Tipo | Descrição |',
					'|-------|------|-----------|',
					'| `name` | string | Nome do curso (sincronizado com Stripe) |',
					'| `description` | string | Descrição do curso |',
					'| `price` | number (como string) | Preço em BRL (sincronizado com Stripe) |',
					'| `file` | **binary** | Imagem de capa (JPEG, PNG, WebP) |',
				].join('\n'),
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: cursoSchema,
					400: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateCursoFormController,
	);

	server.post(
		'/curso/:id/image',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Faz upload da imagem de capa do curso via multipart/form-data.',
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: cursoSchema,
					400: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadCursoImageController,
	);

	server.delete(
		'/curso/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Arquiva o curso no Stripe e deleta do banco.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Cursos'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteCursoController,
	);
}
