import { captureException } from '../lib/sentry.js';
import {
	FALLBACK_ERROR_MESSAGE,
	FALLBACK_GREETING,
} from '../lib/support-chat-prompt.js';
import {
	OpenChatConflictError,
	supportChatRepository,
} from '../repositories/support-chat.js';
import type { SupportChatStatus } from '../types/support-chat.js';
import {
	type AuthContext,
	generateAiReply,
	SUPPORT_CHAT_MODEL,
} from './support-chat-ai.js';

const AI_NAME = 'Assistente IA';
const SYSTEM_NAME = 'Sistema';

class SupportChatService {
	/**
	 * Abre um atendimento — ou devolve o que já está aberto.
	 *
	 * Antes isto inseria uma linha nova incondicionalmente, e como o front
	 * criava chat ao simplesmente ABRIR o widget, um cliente acumulava quatro
	 * atendimentos sobre o mesmo assunto. Agora existe no máximo um chat não
	 * encerrado por cliente, garantido também por índice único no banco
	 * (sql/support-chat-single-open.sql) para o caso de duas abas clicarem
	 * junto.
	 *
	 * `reused` diz ao front que ele deve avisar "você já tem um atendimento
	 * aberto" em vez de mostrar uma conversa nova em branco.
	 */
	async createChat(
		customerId: string,
		customerName: string,
		openingMessage?: string,
		auth?: AuthContext,
	) {
		// Sem cliente identificado não dá pra garantir o invariante: todo mundo
		// cairia no mesmo "slot vazio" e leria o atendimento de outra pessoa.
		if (!customerId?.trim()) {
			throw new Error('Cliente não identificado');
		}

		const existing = await supportChatRepository.findOpenByCustomer(customerId);
		if (existing) {
			return this.resumeExisting(
				existing.id as string,
				customerId,
				customerName,
				openingMessage,
				auth,
			);
		}

		const { id: chatId, created } = await this.createChatRow(
			customerId,
			customerName,
		);

		// Perdemos a corrida por milissegundos e recebemos o chat do vencedor.
		// Seguir daqui pro caminho de criação injetaria uma saudação (ou um turno
		// de IA) dentro de uma conversa que já estava em andamento, e ainda
		// devolveria reused:false — o front não avisaria nada ao aluno.
		if (!created) {
			return this.resumeExisting(
				chatId,
				customerId,
				customerName,
				openingMessage,
				auth,
			);
		}

		if (openingMessage?.trim()) {
			await supportChatRepository.addMessage(chatId, {
				role: 'customer',
				authorId: customerId,
				authorName: customerName,
				content: openingMessage.trim(),
			});
			await this.runAiTurn(chatId, auth);
		} else {
			// saudação estática (sem chamada de modelo → abertura instantânea)
			await supportChatRepository.addMessage(chatId, {
				role: 'ai',
				authorId: null,
				authorName: AI_NAME,
				content: FALLBACK_GREETING,
			});
		}

		return {
			chat: await supportChatRepository.getChatById(chatId),
			reused: false,
		};
	}

	/**
	 * Entrega um atendimento que já existia. A mensagem de abertura, se houver,
	 * entra nele via sendCustomerMessage — que não reinjeta saudação e respeita
	 * o status atual (não aciona a IA se um humano já assumiu).
	 */
	private async resumeExisting(
		chatId: string,
		customerId: string,
		customerName: string,
		openingMessage?: string,
		auth?: AuthContext,
	) {
		if (openingMessage?.trim()) {
			const chat = await this.sendCustomerMessage(
				chatId,
				customerId,
				customerName,
				openingMessage.trim(),
				auth,
			);
			return { chat, reused: true };
		}
		return {
			chat: await supportChatRepository.getChatById(chatId),
			reused: true,
		};
	}

	/**
	 * Insere a linha do chat. Se o índice único barrar (duas abas clicaram ao
	 * mesmo tempo), a corrida foi perdida por milissegundos — reusa o chat que
	 * venceu em vez de estourar um erro que o aluno não entenderia.
	 */
	private async createChatRow(
		customerId: string,
		customerName: string,
	): Promise<{ id: string; created: boolean }> {
		try {
			const id = await supportChatRepository.createChat(
				customerId,
				customerName,
			);
			return { id, created: true };
		} catch (err) {
			if (err instanceof OpenChatConflictError) {
				const winner =
					await supportChatRepository.findOpenByCustomer(customerId);
				// `created: false` é o que faz o chamador tratar isto como reuso.
				if (winner) return { id: winner.id as string, created: false };
			}
			throw err;
		}
	}

	/** Gera a resposta da IA pro estado atual do chat. Nunca lança (fallback + handoff). */
	private async runAiTurn(chatId: string, auth?: AuthContext) {
		try {
			const history = await supportChatRepository.getRawHistory(chatId);
			// A busca do RAG roda na upvox; o `auth` repassa o Bearer do aluno.
			// O log de retrieval (aba "Respostas ruins") é gravado LÁ, no endpoint
			// de busca — a main API não toca mais no banco do Cérebro.
			const result = await generateAiReply(history, { auth });

			await supportChatRepository.addMessage(chatId, {
				role: 'ai',
				authorId: null,
				authorName: AI_NAME,
				content: result.reply,
			});

			if (result.handoff) {
				await this.requestHuman(chatId, 'ai_auto');
			}
		} catch (err) {
			// Loga o motivo real (modelo indisponível, sem OPENROUTER_API_KEY,
			// rate limit/429, etc.) pra ficar diagnosticável nos logs, e degrada
			// gracioso: mensagem de fallback + encaminha pra humano.
			console.error(
				`[support-chat] runAiTurn failed (model=${SUPPORT_CHAT_MODEL}, hasKey=${!!process.env.OPENROUTER_API_KEY}):`,
				err,
			);
			captureException(err);

			// O próprio caminho de degradação precisa degradar. Estes awaits
			// tocam o banco, e se o banco for a causa da falha original eles
			// lançam também — a exceção escaparia de runAiTurn (que promete nunca
			// lançar), subiria até a rota e deixaria o chat parado em 'ai', sem
			// resposta e sem humano designado: o aluno esperando alguém que nunca
			// vem.
			try {
				await supportChatRepository.addMessage(chatId, {
					role: 'ai',
					authorId: null,
					authorName: AI_NAME,
					content: FALLBACK_ERROR_MESSAGE,
				});
			} catch (innerErr) {
				console.error('[support-chat] falha ao gravar fallback:', innerErr);
				captureException(innerErr);
			}

			try {
				await this.requestHuman(chatId, 'ai_error');
			} catch (innerErr) {
				console.error('[support-chat] falha ao encaminhar:', innerErr);
				captureException(innerErr);
				// Último recurso: a transição de status é o que faz um humano
				// assumir. Sem mensagem o atendimento é feio; sem status ele fica
				// invisível na fila da staff.
				await supportChatRepository
					.updateStatus(chatId, 'waiting_human', { handoffReason: 'ai_error' })
					.catch(() => {});
			}
		}
	}

	async sendCustomerMessage(
		chatId: string,
		customerId: string,
		customerName: string,
		content: string,
		auth?: AuthContext,
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
			await this.runAiTurn(chatId, auth);
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
		// Sem esta leitura dava pra "assumir" um chat já encerrado: o status
		// voltava pra with_human e o atendimento ressuscitava — o que, com o
		// invariante de 1 chat aberto por cliente, deixaria o cliente com um
		// atendimento aberto que ele não pediu.
		const chat = await supportChatRepository.getChatById(chatId);
		if (!chat) throw new Error('Chat não encontrado');
		if (chat.status === 'closed') {
			throw new Error('Atendimento encerrado — não é possível assumir');
		}

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

		// O chamado encerrado vira conhecimento (anonimizado) pra IA aprender com
		// o que a equipe respondeu — mas isso acontece na UPVOX: o collector de
		// tickets lê os chats encerrados do Demo_DB no próximo sync. A main API
		// não empurra nada, o que evita um canal main→upvox e o secret que ele
		// exigiria.
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
