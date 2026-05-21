import type { FastifyReply, FastifyRequest } from 'fastify';
import { planService } from '../services/plan.js';
import {
	addCursoToPlanSchema,
	createPlanSchema,
	updatePlanSchema,
} from '../types/plan.js';

export const getPlansController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data, error } = await planService.listPlans();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const getPlanByIdController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { data, error } = await planService.getPlanById(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Plan not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(data);
};

export const createPlanController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const data = createPlanSchema.parse(request.body);
	const { data: plan, error } = await planService.createPlan(data);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(plan);
};

export const updatePlanController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const data = updatePlanSchema.parse(request.body);
	const { data: plan, error } = await planService.updatePlan(
		request.params.id,
		data,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Plan not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(plan);
};

export const deletePlanController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await planService.deletePlan(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Plan not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};

export const addCursoToPlanController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { cursoId } = addCursoToPlanSchema.parse(request.body);
	const { error } = await planService.addCurso(request.params.id, cursoId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status =
			message === 'Plan not found' || message === 'Curso not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(201).send(null);
};

export const removeCursoFromPlanController = async (
	request: FastifyRequest<{ Params: { id: string; cursoId: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await planService.removeCurso(
		request.params.id,
		request.params.cursoId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Curso not in plan' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send(null);
};
