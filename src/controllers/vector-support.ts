import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadVectorSupportFile } from '../lib/storage.js';
import { supabase } from '../lib/supabase.js';
import { vectorSupportService } from '../services/vector-support.js';
import { createTicketSchema } from '../types/vector-support.js';

async function isStaff(userId: string): Promise<boolean> {
	const { data } = await supabase
		.from('Users')
		.select('id')
		.eq('id', userId)
		.maybeSingle();
	return !!data;
}

export const listTicketsController = async (
	request: FastifyRequest<{ Querystring: { status?: string } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id ?? '';
	const { status } = request.query;
	const { data: tickets, error } =
		await vectorSupportService.listTicketsByCustomer(customerId, status);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(tickets);
};

export const listAdminTicketsController = async (
	request: FastifyRequest<{ Querystring: { status?: string } }>,
	reply: FastifyReply,
) => {
	const { status } = request.query;
	const { data: tickets, error } =
		await vectorSupportService.listAllTickets(status);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(tickets);
};

export const getTicketController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const { data: ticket, error } = await vectorSupportService.getTicket(id);

		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		if (!ticket) {
			return reply.status(404).send({ message: 'Ticket not found' });
		}

		const userId = request.currentUser?.id ?? '';
		const staff = await isStaff(userId);
		if (!staff && ticket.customerId !== request.currentCustomer?.id) {
			return reply.status(403).send({ message: 'Access denied' });
		}

		return reply.send(ticket);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createTicketController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? '';
		const customerName = request.currentCustomer?.name ?? 'Cliente';

		const parts = request.parts();
		let subject = '';
		let initialMessage: string | undefined;
		const files: { fileUrl: string; fileName: string; fileType: string }[] = [];

		for await (const part of parts) {
			if (part.type === 'field') {
				if (part.fieldname === 'subject') {
					subject = part.value as string;
				} else if (part.fieldname === 'initialMessage') {
					initialMessage = part.value as string;
				}
			} else if (part.type === 'file' && part.fieldname === 'files') {
				const buffer = await part.toBuffer();
				const ext = part.filename?.split('.').pop() ?? 'bin';
				const path = `${crypto.randomUUID()}.${ext}`;
				const fileUrl = await uploadVectorSupportFile(
					buffer,
					path,
					part.mimetype,
				);
				files.push({
					fileUrl,
					fileName: part.filename ?? 'file',
					fileType: part.mimetype,
				});
			}
		}

		if (!subject) {
			return reply.status(400).send({ message: 'subject is required' });
		}

		if (!initialMessage && files.length === 0) {
			return reply
				.status(400)
				.send({ message: 'initialMessage or at least one file is required' });
		}

		const data = createTicketSchema.parse({ subject, initialMessage });
		const { data: ticket, error } = await vectorSupportService.createTicket(
			data,
			customerId,
			customerName,
			files,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.status(201).send(ticket);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const sendMessageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;

		const parts = request.parts();
		let content = '';
		const files: { fileUrl: string; fileName: string; fileType: string }[] = [];

		for await (const part of parts) {
			if (part.type === 'field' && part.fieldname === 'content') {
				content = part.value as string;
			} else if (part.type === 'file' && part.fieldname === 'files') {
				const buffer = await part.toBuffer();
				const ext = part.filename?.split('.').pop() ?? 'bin';
				const path = `${id}/${crypto.randomUUID()}.${ext}`;
				const fileUrl = await uploadVectorSupportFile(
					buffer,
					path,
					part.mimetype,
				);
				files.push({
					fileUrl,
					fileName: part.filename ?? 'file',
					fileType: part.mimetype,
				});
			}
		}

		if (!content && files.length === 0) {
			return reply
				.status(400)
				.send({ message: 'Content or at least one file is required' });
		}

		const userId = request.currentUser?.id ?? '';
		const staff = await isStaff(userId);

		let authorId: string;
		let authorName: string;

		if (staff) {
			authorId = userId;
			const { data: user } = await supabase
				.from('Users')
				.select('name')
				.eq('id', userId)
				.maybeSingle();
			authorName = user?.name ?? 'Técnico';
		} else {
			authorId = request.currentCustomer?.id ?? userId;
			authorName = request.currentCustomer?.name ?? 'Cliente';
		}

		const { data: msg, error } = await vectorSupportService.sendMessage(
			id,
			{ content: content || undefined },
			authorId,
			authorName,
			staff,
			files,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}

		return reply.status(201).send(msg);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const closeTicketController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { id } = request.params;
	const { error } = await vectorSupportService.closeTicket(id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};
