import type { FastifyReply, FastifyRequest } from 'fastify';
import { PERMISSION_CATALOG } from '../lib/permissions.js';
import { roleService } from '../services/role.js';
import { roleCreateSchema, roleUpdateSchema } from '../types/role.js';

function errMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Internal Server Error';
}

export const roleController = {
	async list(_request: FastifyRequest, reply: FastifyReply) {
		const { data, error } = await roleService.list();
		if (error) return reply.status(500).send({ message: errMessage(error) });
		return reply.status(200).send(data);
	},

	async getById(
		request: FastifyRequest<{ Params: { id: number } }>,
		reply: FastifyReply,
	) {
		const { data, error } = await roleService.getById(
			Number(request.params.id),
		);
		if (error) return reply.status(500).send({ message: errMessage(error) });
		if (!data)
			return reply.status(404).send({ message: 'Cargo não encontrado' });
		return reply.status(200).send(data);
	},

	async create(request: FastifyRequest, reply: FastifyReply) {
		try {
			const body = roleCreateSchema.parse(request.body);
			const { data, error } = await roleService.create(body);
			if (error) return reply.status(400).send({ message: errMessage(error) });
			return reply.status(201).send(data);
		} catch (err) {
			return reply.status(400).send({ message: errMessage(err) });
		}
	},

	async update(
		request: FastifyRequest<{ Params: { id: number } }>,
		reply: FastifyReply,
	) {
		try {
			const body = roleUpdateSchema.parse(request.body);
			const { data, error } = await roleService.update(
				Number(request.params.id),
				body,
			);
			if (error) return reply.status(400).send({ message: errMessage(error) });
			return reply.status(200).send(data);
		} catch (err) {
			return reply.status(400).send({ message: errMessage(err) });
		}
	},

	async remove(
		request: FastifyRequest<{ Params: { id: number } }>,
		reply: FastifyReply,
	) {
		const { error } = await roleService.remove(Number(request.params.id));
		if (error) return reply.status(400).send({ message: errMessage(error) });
		return reply.status(200).send({ message: 'Cargo excluído' });
	},

	async catalog(_request: FastifyRequest, reply: FastifyReply) {
		return reply.status(200).send(PERMISSION_CATALOG);
	},

	async myPermissions(request: FastifyRequest, reply: FastifyReply) {
		const user = request.currentUser;
		if (!user) return reply.status(401).send({ message: 'Not authenticated' });
		const { data, error } = await roleService.getEffectiveForAuth(
			user.id,
			user.email,
		);
		if (error) return reply.status(500).send({ message: errMessage(error) });
		return reply.status(200).send(data);
	},
};
