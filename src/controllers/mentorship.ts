import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { MentorshipError, mentorshipService } from '../services/mentorship.js';
import {
	createMaterialSchema,
	createSessionSchema,
	postMessageSchema,
	updateSessionSchema,
} from '../types/mentorship.js';

/** Contexto de acesso (plano/unlimited/staff + Bearer + invocationId) do request. */
function accessFrom(
	request: FastifyRequest,
	invocationId?: string | null,
): {
	planKey: string | null;
	isUnlimited: boolean;
	isStaff: boolean;
	authHeader?: string;
	invocationId?: string | null;
} {
	return {
		planKey: request.currentPlanKey ?? null,
		isUnlimited: request.isUnlimitedCustomer === true,
		isStaff: isStaffRole(request.currentRole),
		authHeader: request.headers.authorization,
		invocationId: invocationId ?? null,
	};
}

/** Mapeia erro → status HTTP. */
function fail(reply: FastifyReply, err: unknown) {
	if (err instanceof MentorshipError) {
		return reply.status(err.status).send({ message: err.message });
	}
	const message = err instanceof Error ? err.message : 'Unknown error';
	const status = message === 'session_not_found' ? 404 : 500;
	return reply.status(status).send({ message });
}

function requireStaff(request: FastifyRequest, reply: FastifyReply): boolean {
	if (!isStaffRole(request.currentRole)) {
		reply.status(403).send({ message: 'staff_only' });
		return false;
	}
	return true;
}

export const listSessionsController = async (
	request: FastifyRequest<{ Params: { toolKey: string } }>,
	reply: FastifyReply,
) => {
	try {
		const sessions = await mentorshipService.listSessions(
			request.params.toolKey,
		);
		return reply.send(sessions);
	} catch (err) {
		return fail(reply, err);
	}
};

export const createSessionController = async (
	request: FastifyRequest<{ Params: { toolKey: string } }>,
	reply: FastifyReply,
) => {
	if (!requireStaff(request, reply)) return;
	try {
		const body = createSessionSchema.parse(request.body);
		const session = await mentorshipService.createSession(
			request.params.toolKey,
			body,
		);
		return reply.status(201).send(session);
	} catch (err) {
		return fail(reply, err);
	}
};

export const updateSessionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!requireStaff(request, reply)) return;
	try {
		const body = updateSessionSchema.parse(request.body);
		const session = await mentorshipService.updateSession(
			request.params.id,
			body,
		);
		return reply.send(session);
	} catch (err) {
		return fail(reply, err);
	}
};

export const deleteSessionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!requireStaff(request, reply)) return;
	try {
		await mentorshipService.deleteSession(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		return fail(reply, err);
	}
};

export const getRoomController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });
	try {
		const state = await mentorshipService.getRoomState(
			request.params.id,
			customerId,
			accessFrom(request),
		);
		return reply.send(state);
	} catch (err) {
		return fail(reply, err);
	}
};

export const joinRoomController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: { invocationId?: string };
	}>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });
	try {
		const invocationId = request.body?.invocationId ?? null;
		const result = await mentorshipService.joinRoom(
			request.params.id,
			customerId,
			accessFrom(request, invocationId),
		);
		return reply.send(result);
	} catch (err) {
		return fail(reply, err);
	}
};

export const leaveRoomController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });
	try {
		await mentorshipService.leaveRoom(request.params.id, customerId);
		return reply.status(204).send();
	} catch (err) {
		return fail(reply, err);
	}
};

/* ── materiais ── */
export const listMaterialsController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });
	try {
		const materials = await mentorshipService.listMaterials(
			request.params.id,
			customerId,
			accessFrom(request),
		);
		return reply.send(materials);
	} catch (err) {
		return fail(reply, err);
	}
};

export const addMaterialController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!requireStaff(request, reply)) return;
	try {
		const body = createMaterialSchema.parse(request.body);
		const material = await mentorshipService.addMaterial(
			request.params.id,
			body.title,
			body.url,
		);
		return reply.status(201).send(material);
	} catch (err) {
		return fail(reply, err);
	}
};

export const deleteMaterialController = async (
	request: FastifyRequest<{ Params: { materialId: string } }>,
	reply: FastifyReply,
) => {
	if (!requireStaff(request, reply)) return;
	try {
		await mentorshipService.deleteMaterial(request.params.materialId);
		return reply.status(204).send();
	} catch (err) {
		return fail(reply, err);
	}
};

/* ── chat ── */
export const listMessagesController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });
	try {
		const messages = await mentorshipService.listMessages(
			request.params.id,
			customerId,
		);
		return reply.send(messages);
	} catch (err) {
		return fail(reply, err);
	}
};

export const postMessageController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: { content: string };
	}>,
	reply: FastifyReply,
) => {
	const customer = request.currentCustomer;
	if (!customer?.id) return reply.status(401).send({ message: 'Unauthorized' });
	try {
		const body = postMessageSchema.parse(request.body);
		const message = await mentorshipService.postMessage(
			request.params.id,
			{ id: customer.id, name: customer.name ?? null, image: customer.image },
			body.content,
		);
		return reply.status(201).send(message);
	} catch (err) {
		return fail(reply, err);
	}
};
