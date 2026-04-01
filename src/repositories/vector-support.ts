import { supabase } from '../lib/supabase.js';
import type { CreateTicket } from '../types/vector-support.js';

interface FileInput {
	fileUrl: string;
	fileName: string;
	fileType: string;
}

class VectorSupportRepository {
	// ── Tickets ───────────────────────────────────────────────────────────────

	async listTicketsByCustomer(customerId: string, status?: string) {
		let query = supabase
			.from('pl_vector_support_ticket')
			.select('*')
			.eq('customerId', customerId)
			.order('updatedAt', { ascending: false });

		if (status) query = query.eq('status', status);

		const { data, error } = await query;
		if (error) throw new Error(error.message);

		return (data ?? []).map(this.mapTicketSummary);
	}

	async listAllTickets(status?: string) {
		let query = supabase
			.from('pl_vector_support_ticket')
			.select('*')
			.order('updatedAt', { ascending: false });

		if (status) query = query.eq('status', status);

		const { data, error } = await query;
		if (error) throw new Error(error.message);

		return (data ?? []).map(this.mapTicketSummary);
	}

	async getTicketById(id: string) {
		const { data: ticket, error } = await supabase
			.from('pl_vector_support_ticket')
			.select('*')
			.eq('id', id)
			.single();
		if (error) throw new Error(error.message);
		if (!ticket) return null;

		const { data: messages, error: msgError } = await supabase
			.from('pl_vector_support_message')
			.select('*')
			.eq('ticketId', id)
			.order('createdAt', { ascending: true });
		if (msgError) throw new Error(msgError.message);

		const messageIds = (messages ?? []).map((m: { id: string }) => m.id);

		const filesMap = new Map<
			string,
			FileInput & { id: string; createdAt: string }[]
		>();
		if (messageIds.length > 0) {
			const { data: files, error: fileError } = await supabase
				.from('pl_vector_support_file')
				.select('*')
				.in('messageId', messageIds);
			if (fileError) throw new Error(fileError.message);

			for (const file of files ?? []) {
				const f = file as {
					id: string;
					messageId: string;
					fileUrl: string;
					fileName: string;
					fileType: string;
					createdAt: string;
				};
				const arr = filesMap.get(f.messageId) ?? [];
				arr.push({
					id: f.id,
					fileUrl: f.fileUrl,
					fileName: f.fileName,
					fileType: f.fileType,
					createdAt: f.createdAt,
				});
				filesMap.set(f.messageId, arr);
			}
		}

		return {
			...this.mapTicketSummary(ticket),
			messages: (messages ?? []).map(
				(m: {
					id: string;
					ticketId: string;
					authorId: string;
					authorName: string;
					isTechnician: boolean;
					content: string | null;
					createdAt: string;
				}) => ({
					id: m.id,
					ticketId: m.ticketId,
					authorId: m.authorId,
					authorName: m.authorName,
					isTechnician: m.isTechnician,
					content: m.content,
					files: (filesMap.get(m.id) ?? []).map((f) => ({
						id: f.id,
						messageId: m.id,
						fileUrl: f.fileUrl,
						fileName: f.fileName,
						fileType: f.fileType,
						createdAt: f.createdAt,
					})),
					createdAt: m.createdAt,
				}),
			),
		};
	}

	async createTicket(
		data: CreateTicket,
		customerId: string,
		customerName: string,
		files: FileInput[],
	) {
		const ticketId = crypto.randomUUID();
		const { error: ticketError } = await supabase
			.from('pl_vector_support_ticket')
			.insert({
				id: ticketId,
				customerId,
				customerName,
				status: 'open',
				subject: data.subject,
			});
		if (ticketError) throw new Error(ticketError.message);

		if (data.initialMessage || files.length > 0) {
			await this.createMessage(
				ticketId,
				{ content: data.initialMessage },
				customerId,
				customerName,
				false,
				files,
			);
		}

		return this.getTicketById(ticketId);
	}

	async createMessage(
		ticketId: string,
		data: { content?: string },
		authorId: string,
		authorName: string,
		isTechnician: boolean,
		files: FileInput[],
	) {
		const messageId = crypto.randomUUID();
		const { error: msgError } = await supabase
			.from('pl_vector_support_message')
			.insert({
				id: messageId,
				ticketId,
				authorId,
				authorName,
				isTechnician,
				content: data.content ?? null,
			});
		if (msgError) throw new Error(msgError.message);

		if (files.length > 0) {
			const fileRows = files.map((f) => ({
				id: crypto.randomUUID(),
				messageId,
				fileUrl: f.fileUrl,
				fileName: f.fileName,
				fileType: f.fileType,
			}));
			const { error: fileError } = await supabase
				.from('pl_vector_support_file')
				.insert(fileRows);
			if (fileError) throw new Error(fileError.message);
		}

		const updates: Record<string, unknown> = {
			updatedAt: new Date().toISOString(),
		};
		if (isTechnician) updates.status = 'answered';

		await supabase
			.from('pl_vector_support_ticket')
			.update(updates)
			.eq('id', ticketId);

		const { data: msg } = await supabase
			.from('pl_vector_support_message')
			.select('*')
			.eq('id', messageId)
			.single();

		const { data: msgFiles } = await supabase
			.from('pl_vector_support_file')
			.select('*')
			.eq('messageId', messageId);

		return {
			id: msg.id,
			ticketId: msg.ticketId,
			authorId: msg.authorId,
			authorName: msg.authorName,
			isTechnician: msg.isTechnician,
			content: msg.content,
			files: (msgFiles ?? []).map(
				(f: {
					id: string;
					messageId: string;
					fileUrl: string;
					fileName: string;
					fileType: string;
					createdAt: string;
				}) => ({
					id: f.id,
					messageId: f.messageId,
					fileUrl: f.fileUrl,
					fileName: f.fileName,
					fileType: f.fileType,
					createdAt: f.createdAt,
				}),
			),
			createdAt: msg.createdAt,
		};
	}

	async closeTicket(id: string) {
		const { error } = await supabase
			.from('pl_vector_support_ticket')
			.update({ status: 'closed', updatedAt: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private mapTicketSummary(ticket: {
		id: string;
		customerId: string;
		customerName: string;
		status: string;
		subject: string;
		createdAt: string;
		updatedAt: string;
	}) {
		return {
			id: ticket.id,
			customerId: ticket.customerId,
			customerName: ticket.customerName,
			status: ticket.status,
			subject: ticket.subject,
			createdAt: ticket.createdAt,
			updatedAt: ticket.updatedAt,
		};
	}
}

export const vectorSupportRepository = new VectorSupportRepository();
