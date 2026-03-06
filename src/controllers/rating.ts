import type { FastifyReply, FastifyRequest } from 'fastify';
import { ratingRepository } from '../repositories/rating.js';
import { createRatingSchema } from '../types/rating.js';

export const getRatingController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { lessonId } = request.params;
		const customerId =
			request.currentCustomer?.id ?? request.currentUser?.id ?? '';
		const [myRating, stats] = await Promise.all([
			ratingRepository.findByLessonAndCustomer(lessonId, customerId),
			ratingRepository.getAllByLesson(lessonId),
		]);
		return reply.send({
			myRating,
			averageRating: stats.averageRating,
			totalRatings: stats.totalRatings,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const upsertRatingController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { lessonId } = request.params;
		const { stars } = createRatingSchema.parse(request.body);
		const customerId =
			request.currentCustomer?.id ?? request.currentUser?.id ?? '';
		await ratingRepository.upsert(lessonId, customerId, stars);
		const [myRating, stats] = await Promise.all([
			ratingRepository.findByLessonAndCustomer(lessonId, customerId),
			ratingRepository.getAllByLesson(lessonId),
		]);
		return reply.send({
			myRating,
			averageRating: stats.averageRating,
			totalRatings: stats.totalRatings,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
