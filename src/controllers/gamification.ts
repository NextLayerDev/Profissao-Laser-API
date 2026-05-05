import type { FastifyReply, FastifyRequest } from 'fastify';
import { gamificationService } from '../services/gamification.js';

export const getGamificationSummaryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const userId = request.currentCustomer?.id ?? request.currentUser?.id ?? '';
	const { data, error } = await gamificationService.getSummary(userId);
	if (error) {
		return reply.status(500).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	return reply.send(data);
};

export const getGamificationBadgesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const userId = request.currentCustomer?.id ?? request.currentUser?.id ?? '';
	const { data, error } = await gamificationService.getBadges(userId);
	if (error) {
		return reply.status(500).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	return reply.send(data);
};

export const getGamificationStreakController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const userId = request.currentCustomer?.id ?? request.currentUser?.id ?? '';
	const { data, error } = await gamificationService.getStreak(userId);
	if (error) {
		return reply.status(500).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	return reply.send(data);
};

export const getActiveChallengeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const userId = request.currentCustomer?.id ?? request.currentUser?.id ?? '';
	const { data, error } = await gamificationService.getActiveChallenge(userId);
	if (error) {
		return reply.status(500).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	if (!data)
		return reply
			.status(404)
			.send({ message: 'Nenhum desafio ativo no momento' });
	return reply.send(data);
};

export const joinChallengeController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { id } = request.params;
	const userId = request.currentCustomer?.id ?? request.currentUser?.id ?? '';
	const { data, error } = await gamificationService.joinChallenge(id, userId);
	if (error) {
		return reply.status(400).send({
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}
	return reply.status(201).send(data);
};
