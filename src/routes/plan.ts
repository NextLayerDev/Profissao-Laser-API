import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateAdmin } from '@/middleware/auth.js';
import {
	addCursoToPlanController,
	createPlanController,
	deletePlanController,
	getPlanByIdController,
	getPlansController,
	removeCursoFromPlanController,
	updatePlanController,
} from '../controllers/plan.js';
import { ErrorSchema } from '../types/error.js';
import {
	addCursoToPlanSchema,
	createPlanSchema,
	planSchema,
	planWithCursosSchema,
	updatePlanSchema,
} from '../types/plan.js';

export async function planRoute(server: FastifyInstance) {
	server.get(
		'/planos',
		{
			preHandler: [],
			schema: {
				description: 'Lista todos os planos com seus cursos associados.',
				response: {
					200: z.array(planWithCursosSchema),
					500: ErrorSchema,
				},
				tags: ['Planos'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPlansController,
	);

	server.get(
		'/plano/:id',
		{
			preHandler: [],
			schema: {
				description: 'Busca um plano pelo ID com seus cursos.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					200: planWithCursosSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Planos'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPlanByIdController,
	);

	server.post(
		'/plano',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: [
					'Cria um novo plano no Stripe e salva no banco.',
					'',
					'**Funcionalidades de ferramentas:** previas, canva, vetorizacao, parametros, fornecedores',
					'',
					'**Conteúdo incluso:** aulas, suporte, biblioteca, comunidade',
				].join('\n'),
				body: createPlanSchema,
				response: {
					201: planSchema,
					500: ErrorSchema,
				},
				tags: ['Planos'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPlanController,
	);

	server.patch(
		'/plano/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Atualiza um plano (nome, preço, funcionalidades). Nome e preço são sincronizados com o Stripe.',
				params: z.object({ id: z.string().uuid() }),
				body: updatePlanSchema,
				response: {
					200: planSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Planos'],
				security: [{ bearerAuth: [] }],
			},
		},
		updatePlanController,
	);

	server.delete(
		'/plano/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Deleta um plano.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Planos'],
				security: [{ bearerAuth: [] }],
			},
		},
		deletePlanController,
	);

	server.post(
		'/plano/:id/curso',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Associa um curso a um plano.',
				params: z.object({ id: z.string().uuid() }),
				body: addCursoToPlanSchema,
				response: {
					201: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Planos'],
				security: [{ bearerAuth: [] }],
			},
		},
		addCursoToPlanController,
	);

	server.delete(
		'/plano/:id/curso/:cursoId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove a associação de um curso de um plano.',
				params: z.object({
					id: z.string().uuid(),
					cursoId: z.string(),
				}),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Planos'],
				security: [{ bearerAuth: [] }],
			},
		},
		removeCursoFromPlanController,
	);
}
