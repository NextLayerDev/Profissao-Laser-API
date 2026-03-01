import type { FastifyReply, FastifyRequest } from 'fastify';
import { quizRepository } from '../repositories/quiz.js';
import {
	createQuestionSchema,
	createQuizSchema,
	updateQuestionSchema,
} from '../types/quiz.js';

export const getQuizController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const quiz = await quizRepository.findByLesson(request.params.lessonId);
		if (!quiz) return reply.status(404).send({ message: 'Quiz not found' });
		return reply.send(quiz);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createQuizController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { title } = createQuizSchema.parse(request.body);
		const quiz = await quizRepository.create(request.params.lessonId, title);
		return reply.status(201).send(quiz);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const deleteQuizController = async (
	request: FastifyRequest<{ Params: { quizId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await quizRepository.delete(request.params.quizId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Quiz not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const addQuestionController = async (
	request: FastifyRequest<{ Params: { quizId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = createQuestionSchema.parse(request.body);
		const question = await quizRepository.addQuestion(
			request.params.quizId,
			data,
		);
		return reply.status(201).send(question);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Quiz not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const updateQuestionController = async (
	request: FastifyRequest<{ Params: { questionId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateQuestionSchema.parse(request.body);
		const question = await quizRepository.updateQuestion(
			request.params.questionId,
			data,
		);
		return reply.send(question);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Question not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteQuestionController = async (
	request: FastifyRequest<{ Params: { questionId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await quizRepository.deleteQuestion(request.params.questionId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Question not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
