import { vectorSupportRepository } from '../repositories/vector-support.js';
import type { CreateTicket } from '../types/vector-support.js';

interface FileInput {
	fileUrl: string;
	fileName: string;
	fileType: string;
}

class VectorSupportService {
	async listTicketsByCustomer(customerId: string, status?: string) {
		return vectorSupportRepository.listTicketsByCustomer(customerId, status);
	}

	async listAllTickets(status?: string) {
		return vectorSupportRepository.listAllTickets(status);
	}

	async getTicket(id: string) {
		return vectorSupportRepository.getTicketById(id);
	}

	async createTicket(
		data: CreateTicket,
		customerId: string,
		customerName: string,
		files: FileInput[],
	) {
		return vectorSupportRepository.createTicket(
			data,
			customerId,
			customerName,
			files,
		);
	}

	async sendMessage(
		ticketId: string,
		data: { content?: string },
		authorId: string,
		authorName: string,
		isTechnician: boolean,
		files: FileInput[],
	) {
		return vectorSupportRepository.createMessage(
			ticketId,
			data,
			authorId,
			authorName,
			isTechnician,
			files,
		);
	}

	async closeTicket(id: string) {
		return vectorSupportRepository.closeTicket(id);
	}
}

export const vectorSupportService = new VectorSupportService();
