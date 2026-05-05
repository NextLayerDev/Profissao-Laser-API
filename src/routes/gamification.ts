import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	getActiveChallengeController,
	getGamificationBadgesController,
	getGamificationStreakController,
	getGamificationSummaryController,
	joinChallengeController,
} from '../controllers/gamification.js';
import { authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	challengeSchema,
	gamificationBadgeSchema,
	gamificationStreakSchema,
	gamificationSummarySchema,
} from '../types/gamification.js';

export async function gamificationRoute(server: FastifyInstance) {
	server.get(
		'/me/gamification/summary',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Resumo de gamificação do usuário: level, XP, streak e badges recentes.',
				response: {
					200: gamificationSummarySchema,
					500: ErrorSchema,
				},
				tags: ['Gamification'],
				security: [{ bearerAuth: [] }],
			},
		},
		getGamificationSummaryController,
	);

	server.get(
		'/me/gamification/badges',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Todas as badges do usuário (conquistadas e disponíveis).',
				response: {
					200: z.array(gamificationBadgeSchema),
					500: ErrorSchema,
				},
				tags: ['Gamification'],
				security: [{ bearerAuth: [] }],
			},
		},
		getGamificationBadgesController,
	);

	server.get(
		'/me/gamification/streak',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Streak atual do usuário e mapa semanal de dias estudados.',
				response: {
					200: gamificationStreakSchema,
					500: ErrorSchema,
				},
				tags: ['Gamification'],
				security: [{ bearerAuth: [] }],
			},
		},
		getGamificationStreakController,
	);

	server.get(
		'/challenges/active',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Desafio semanal ativo com progresso e participantes.',
				response: {
					200: challengeSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Gamification'],
				security: [{ bearerAuth: [] }],
			},
		},
		getActiveChallengeController,
	);

	server.post(
		'/challenges/:id/join',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Participar do desafio ativo.',
				params: z.object({ id: z.string() }),
				response: {
					201: z.object({ id: z.string() }).passthrough(),
					400: ErrorSchema,
				},
				tags: ['Gamification'],
				security: [{ bearerAuth: [] }],
			},
		},
		joinChallengeController,
	);
}
