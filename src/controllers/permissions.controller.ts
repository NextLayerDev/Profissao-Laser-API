import type { FastifyReply, FastifyRequest } from 'fastify';
import { permissionsService } from '@/services/permissions.service';

export const getPermissionsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await permissionsService.getAllPermissions();
		return reply.send(result);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return reply.status(400).send({ message });
	}
};
