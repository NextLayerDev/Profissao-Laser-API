import { withCapture } from '@/lib/sentry.js';
import { vectorSupportRepository } from '../repositories/vector-support.js';
import type { CreateTicket } from '../types/vector-support.js';

interface FileInput {
	fileUrl: string;
	fileName: string;
	fileType: string;
}

export const vectorSupportService = {
	async listTicketsByCustomer(customerId: string, status?: string) {
		return withCapture(() =>
			vectorSupportRepository.listTicketsByCustomer(customerId, status),
		);
	},

	async listAllTickets(status?: string) {
		return withCapture(() => vectorSupportRepository.listAllTickets(status));
	},

	async getTicket(id: string) {
		return withCapture(() => vectorSupportRepository.getTicketById(id));
	},

	async createTicket(
		data: CreateTicket,
		customerId: string,
		customerName: string,
		files: FileInput[],
	) {
		return withCapture(() =>
			vectorSupportRepository.createTicket(
				data,
				customerId,
				customerName,
				files,
			),
		);
	},

	async sendMessage(
		ticketId: string,
		data: { content?: string },
		authorId: string,
		authorName: string,
		isTechnician: boolean,
		files: FileInput[],
	) {
		return withCapture(() =>
			vectorSupportRepository.createMessage(
				ticketId,
				data,
				authorId,
				authorName,
				isTechnician,
				files,
			),
		);
	},

	async closeTicket(id: string) {
		return withCapture(() => vectorSupportRepository.closeTicket(id));
	},
};
