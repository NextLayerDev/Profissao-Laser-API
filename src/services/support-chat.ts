import { openrouter } from '../lib/openrouter.js';
import {
	buildMessages,
	FALLBACK_ERROR_MESSAGE,
	FALLBACK_GREETING,
	parseAiResponse,
} from '../lib/support-chat-prompt.js';
import { supportChatRepository } from '../repositories/support-chat.js';
import type { SupportChatStatus } from '../types/support-chat.js';

const SUPPORT_CHAT_MODEL =
	process.env.SUPPORT_CHAT_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';

const AI_NAME = 'Assistente IA';
const SYSTEM_NAME = 'Sistema';

class SupportChatService {
	async createChat(
		customerId: string,
		customerName: string,
		openingMessage?: string,
	) {
		const chatId = await supportChatRepository.createChat(
			customerId,
			customerName,
		);

		if (openingMessage?.trim()) {
			await supportChatRepository.addMessage(chatId, {
				role: 'customer',
				authorId: customerId,
				authorName: customerName,
				content: openingMessage.trim(),
			});
			await this.runAiTurn(chatId);
		} else {
			// saudação estática (sem chamada de modelo → abertura instantânea)
			await supportChatRepository.addMessage(chatId, {
				role: 'ai',
				authorId: null,
				authorName: AI_NAME,
				content: FALLBACK_GREETING,
			});
		}

		return supportChatRepository.getChatById(chatId);
	}

	/** Gera a resposta da IA pro estado atual do chat. Nunca lança (fallback + handoff). */
	private async runAiTurn(chatId: string) {
		try {
			if (!process.env.OPENROUTER_API_KEY) {
				throw new Error('OPENROUTER_API_KEY não configurada');
			}
			const history = await supportChatRepository.getRawHistory(chatId);
			const messages = buildMessages(history);

			const completion = await openrouter.chat.completions.create(
				{
					model: SUPPORT_CHAT_MODEL,
					messages,
					temperature: 0.3,
					max_tokens: 500,
				},
				{
					headers: {
						'HTTP-Referer':
							process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
						'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Suporte`,
					},
				},
			);

			const raw = completion.choices[0]?.message?.content ?? '';
			const parsed = parseAiResponse(
				typeof raw === 'string' ? raw : JSON.stringify(raw),
			);

			await supportChatRepository.addMessage(chatId, {
				role: 'ai',
				authorId: null,
				authorName: AI_NAME,
				content: parsed.reply,
			});

			if (parsed.handoff) {
				await this.requestHuman(chatId, 'ai_auto');
			}
		} catch {
			// degrada gracioso: mensagem de fallback + encaminha pra humano
			await supportChatRepository.addMessage(chatId, {
				role: 'ai',
				authorId: null,
				authorName: AI_NAME,
				content: FALLBACK_ERROR_MESSAGE,
			});
			await this.requestHuman(chatId, 'ai_error');
		}
	}

	async sendCustomerMessage(
		chatId: string,
		customerId: string,
		customerName: string,
		content: string,
	) {
		const chat = await supportChatRepository.getChatById(chatId);
		if (!chat) throw new Error('Chat não encontrado');
		if (chat.customerId !== customerId) throw new Error('Acesso negado');
		if (chat.status === 'closed') throw new Error('Chat encerrado');

		await supportChatRepository.addMessage(chatId, {
			role: 'customer',
			authorId: customerId,
			authorName: customerName,
			content,
		});

		if (chat.status === 'ai') {
			await this.runAiTurn(chatId);
		}

		return supportChatRepository.getChatById(chatId);
	}

	async requestHuman(chatId: string, reason: string) {
		try {
			await supportChatRepository.assignRandomAttendant(chatId);
			await supportChatRepository.updateStatus(chatId, 'waiting_human', {
				handoffReason: reason,
			});
			await supportChatRepository.addMessage(chatId, {
				role: 'system',
				authorId: null,
				authorName: SYSTEM_NAME,
				content:
					'Você foi encaminhado para um atendente. Em breve alguém da equipe continua o atendimento.',
			});
		} catch {
			// sem atendentes cadastrados: ainda marca como aguardando humano
			await supportChatRepository.updateStatus(chatId, 'waiting_human', {
				handoffReason: reason,
			});
			await supportChatRepository.addMessage(chatId, {
				role: 'system',
				authorId: null,
				authorName: SYSTEM_NAME,
				content:
					'Nenhum atendente disponível no momento. Assim que possível retornaremos o seu atendimento.',
			});
		}
		return supportChatRepository.getChatById(chatId);
	}

	async adminSendMessage(
		chatId: string,
		attendantId: string,
		attendantName: string,
		content: string,
	) {
		const chat = await supportChatRepository.getChatById(chatId);
		if (!chat) throw new Error('Chat não encontrado');
		if (chat.status === 'closed') throw new Error('Chat encerrado');

		await supportChatRepository.addMessage(chatId, {
			role: 'attendant',
			authorId: attendantId,
			authorName: attendantName,
			content,
		});
		await supportChatRepository.updateStatus(
			chatId,
			'with_human',
			chat.attendantId ? {} : { attendantId },
		);
		return supportChatRepository.getChatById(chatId);
	}

	async takeOver(chatId: string, attendantId: string, attendantName: string) {
		await supportChatRepository.updateStatus(chatId, 'with_human', {
			attendantId,
		});
		await supportChatRepository.addMessage(chatId, {
			role: 'system',
			authorId: null,
			authorName: SYSTEM_NAME,
			content: `${attendantName} assumiu a conversa.`,
		});
		return supportChatRepository.getChatById(chatId);
	}

	async closeChat(chatId: string) {
		await supportChatRepository.updateStatus(chatId, 'closed', {
			closedAt: new Date().toISOString(),
		});
		await supportChatRepository.addMessage(chatId, {
			role: 'system',
			authorId: null,
			authorName: SYSTEM_NAME,
			content: 'Atendimento encerrado.',
		});
		return supportChatRepository.getChatById(chatId);
	}

	async getById(chatId: string) {
		return supportChatRepository.getChatById(chatId);
	}

	async listForCustomer(customerId: string) {
		return supportChatRepository.listByCustomer(customerId);
	}

	async listForAdmin(status?: SupportChatStatus) {
		return supportChatRepository.listAll(status);
	}
}

export const supportChatService = new SupportChatService();
