import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import {
	buildProviderCtx,
	getProvider,
} from '../../lib/omni/providers/index.js';
import { emitOmni } from '../../lib/omni/socket.js';
import { openrouter } from '../../lib/openrouter.js';
import { incrWithTtl } from '../../lib/redis.js';
import { refundOmni, spendOmni } from '../../lib/upvox-agent.js';
import { omniAgentRepository } from '../../repositories/omni-agent.js';
import { omniChatRepository } from '../../repositories/omni-chat.js';
import { omniConfigRepository } from '../../repositories/omni-config.js';
import { omniInstanceRepository } from '../../repositories/omni-instance.js';
import { omniMessageRepository } from '../../repositories/omni-message.js';
import { omniTurnRepository } from '../../repositories/omni-turn.js';
import type { OmniAgent, OmniInstance, OmniMessage } from '../../types/omni.js';
import { omniDebounce } from './debounce.js';
import { describeImage, transcribeAudio } from './media.js';
import {
	buildRouterSystemPrompt,
	buildSpecialistSystemPrompt,
	DEFAULT_ROUTER_PROMPT,
	type OmniBusinessConfigFields,
} from './prompts.js';
import { searchKnowledge } from './rag.js';

/**
 * Turno da IA do OmniResposta — substitui o pipeline n8n do porteira:
 * pré-processa mídia (transcrição/visão) → monta contexto (histórico + config
 * do negócio + RAG) → ROTEADOR com tools (especialistas + transferir_para_
 * humano + buscar_conhecimento + pensar) → COBRA 0,2 voxxys ANTES de enviar
 * (idempotente por ref_id = id da mensagem; refund best-effort se o envio
 * falhar) → envia via provedor → persiste + emite realtime.
 */

const VOX_COST_PER_MESSAGE = 0.2;
const MAX_TOOL_ITERATIONS = 6;
const MAX_OUTPUT_TOKENS = 800;
const HISTORY_MESSAGES = 20;
const TURN_CAP_PER_HOUR = 30;

const OPENROUTER_HEADERS = {
	'HTTP-Referer': 'https://profissaolaser.com.br',
	'X-Title': 'Profissao Laser OmniResposta',
};

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

/** Texto "visível" de uma mensagem pro contexto do LLM. */
function messageText(m: OmniMessage): string {
	const parts: string[] = [];
	if (m.content) parts.push(m.content);
	if (m.caption) parts.push(m.caption);
	if (m.transcription) {
		parts.push(
			m.media_type === 'audio'
				? `[áudio transcrito]: ${m.transcription}`
				: `[imagem]: ${m.transcription}`,
		);
	} else if (m.media_type === 'audio') {
		parts.push('[cliente enviou um áudio]');
	} else if (m.media_type === 'image') {
		parts.push('[cliente enviou uma imagem]');
	} else if (m.media_type === 'document') {
		parts.push(`[cliente enviou um documento: ${m.file_name ?? 'arquivo'}]`);
	} else if (m.media_type === 'video') {
		parts.push('[cliente enviou um vídeo]');
	}
	return parts.join('\n') || '[mensagem]';
}

/** Pré-processa mídia das pendentes (transcrição/visão) e grava no banco. */
async function preprocessMedia(pending: OmniMessage[]): Promise<void> {
	for (const m of pending) {
		if (m.transcription) continue;
		try {
			if (m.media_type === 'audio' && m.media_url) {
				const text = await transcribeAudio({ url: m.media_url });
				if (text) {
					await omniMessageRepository.setTranscription(m.id, text);
					m.transcription = text;
				}
			} else if (m.media_type === 'image' && m.media_url) {
				const desc = await describeImage(m.media_url, m.caption);
				if (desc) {
					await omniMessageRepository.setTranscription(m.id, desc);
					m.transcription = desc;
				}
			}
		} catch (err) {
			console.error('[omni-pipeline] pré-processamento de mídia:', err);
		}
	}
}

function buildHistory(
	all: OmniMessage[],
	pendingIds: Set<string>,
): ChatMessage[] {
	const history: ChatMessage[] = [];
	for (const m of all) {
		if (pendingIds.has(m.id)) continue; // o bloco pendente vai por último
		const text = messageText(m);
		if (m.direction === 'in') history.push({ role: 'user', content: text });
		else if (m.author_type === 'ai') {
			history.push({ role: 'assistant', content: text });
		} else {
			history.push({
				role: 'assistant',
				content: `[atendente humano ${m.sender_name ?? ''}]: ${text}`,
			});
		}
	}
	return history;
}

function buildTools(specialists: OmniAgent[]): ChatTool[] {
	const tools: ChatTool[] = [
		{
			type: 'function',
			function: {
				name: 'buscar_conhecimento',
				description:
					'Busca na base de conhecimento da empresa (documentos enviados pelo dono). Use SEMPRE antes de responder algo factual sobre produtos, preços, prazos ou políticas.',
				parameters: {
					type: 'object',
					properties: {
						pergunta: {
							type: 'string',
							description: 'A pergunta/termos a buscar',
						},
					},
					required: ['pergunta'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'transferir_para_humano',
				description:
					'Transfere o atendimento para um atendente humano. Use quando o cliente pedir, estiver insatisfeito, ou o assunto fugir da sua alçada.',
				parameters: {
					type: 'object',
					properties: {
						motivo: { type: 'string', description: 'Motivo da transferência' },
					},
					required: ['motivo'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'pensar',
				description:
					'Rascunho interno para raciocinar antes de responder (o cliente NÃO vê).',
				parameters: {
					type: 'object',
					properties: { pensamento: { type: 'string' } },
					required: ['pensamento'],
				},
			},
		},
	];
	for (const s of specialists) {
		tools.push({
			type: 'function',
			function: {
				name: s.slug,
				description:
					s.tool_description ||
					`Agente especialista "${s.name}". Devolve o texto final para o cliente.`,
				parameters: {
					type: 'object',
					properties: {
						instrucao: {
							type: 'string',
							description:
								'O que o especialista deve responder (contexto + pergunta do cliente)',
						},
					},
					required: ['instrucao'],
				},
			},
		});
	}
	return tools;
}

/** Sub-chamada de um especialista (sem tools; devolve texto). */
async function runSpecialist(
	specialist: OmniAgent,
	config: OmniBusinessConfigFields | null,
	history: ChatMessage[],
	instrucao: string,
	knowledge: string,
): Promise<string> {
	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				buildSpecialistSystemPrompt({
					specialistPrompt: specialist.system_prompt,
					name: specialist.name,
					config,
				}) + (knowledge ? `\n\n## Base de conhecimento\n${knowledge}` : ''),
		},
		...history.slice(-8),
		{ role: 'user', content: instrucao },
	];
	const completion = await openrouter.chat.completions.create(
		{
			model: specialist.model,
			temperature: Number(specialist.temperature) || 0.4,
			max_tokens: MAX_OUTPUT_TOKENS,
			messages,
		},
		{ headers: OPENROUTER_HEADERS },
	);
	return completion.choices[0]?.message?.content?.trim() ?? '';
}

interface TurnOutcome {
	reply: string | null;
	transfer: { motivo: string } | null;
	model: string;
	promptTokens: number;
	completionTokens: number;
}

/** Loop do roteador com tools. */
async function runRouter(
	instance: OmniInstance,
	router: OmniAgent | null,
	specialists: OmniAgent[],
	config: OmniBusinessConfigFields | null,
	history: ChatMessage[],
	userBlock: string,
): Promise<TurnOutcome> {
	const model = router?.model ?? 'google/gemini-2.5-flash';
	const temperature = router ? Number(router.temperature) || 0.4 : 0.4;
	const system = buildRouterSystemPrompt({
		routerPrompt: router?.system_prompt || DEFAULT_ROUTER_PROMPT,
		config,
		specialists: specialists.map((s) => ({
			slug: s.slug,
			name: s.name,
			tool_description: s.tool_description,
		})),
	});

	// RAG automático com o bloco do cliente (além da tool sob demanda).
	const autoKnowledge = await searchKnowledge(instance.id, userBlock, 5);

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				system +
				(autoKnowledge
					? `\n\n## Base de conhecimento (trechos relevantes à mensagem atual)\n${autoKnowledge}`
					: ''),
		},
		...history,
		{ role: 'user', content: userBlock },
	];
	const tools = buildTools(specialists);
	const bySlug = new Map(specialists.map((s) => [s.slug, s]));

	let promptTokens = 0;
	let completionTokens = 0;
	let transfer: { motivo: string } | null = null;

	for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
		const completion = await openrouter.chat.completions.create(
			{
				model,
				temperature,
				max_tokens: MAX_OUTPUT_TOKENS,
				messages,
				tools,
			},
			{ headers: OPENROUTER_HEADERS },
		);
		promptTokens += completion.usage?.prompt_tokens ?? 0;
		completionTokens += completion.usage?.completion_tokens ?? 0;

		const choice = completion.choices[0];
		const msg = choice?.message;
		if (!msg) break;

		const toolCalls = msg.tool_calls ?? [];
		if (toolCalls.length === 0) {
			const reply = msg.content?.trim() ?? '';
			return {
				reply: reply || null,
				transfer,
				model,
				promptTokens,
				completionTokens,
			};
		}

		messages.push(msg as ChatMessage);
		for (const call of toolCalls) {
			if (call.type !== 'function') continue;
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(call.function.arguments || '{}');
			} catch {
				args = {};
			}
			let result = '';
			const name = call.function.name;
			if (name === 'buscar_conhecimento') {
				result =
					(await searchKnowledge(
						instance.id,
						String(args.pergunta ?? ''),
						5,
					)) || 'Nada encontrado na base de conhecimento.';
			} else if (name === 'transferir_para_humano') {
				transfer = { motivo: String(args.motivo ?? 'pedido do cliente') };
				result =
					'Transferência registrada. Responda ao cliente confirmando que um atendente humano vai assumir em instantes.';
			} else if (name === 'pensar') {
				result = 'ok';
			} else if (bySlug.has(name)) {
				const specialist = bySlug.get(name) as OmniAgent;
				try {
					result = await runSpecialist(
						specialist,
						config,
						history,
						String(args.instrucao ?? userBlock),
						autoKnowledge,
					);
				} catch (err) {
					result = `O especialista falhou (${String(err).slice(0, 120)}). Responda você mesmo com o que sabe, sem inventar.`;
				}
			} else {
				result = 'Ferramenta desconhecida.';
			}
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: result.slice(0, 8000),
			});
		}
	}
	return { reply: null, transfer, model, promptTokens, completionTokens };
}

class OmniPipeline {
	/** Entry-point chamado pelo debounce (lock já garantido). */
	async runTurn(
		instance: OmniInstance,
		chatId: string,
		turnId: string,
		inputMessageIds: string[],
	): Promise<void> {
		const chat = await omniChatRepository.findById(chatId);
		if (!chat) {
			await omniTurnRepository.finish(turnId, 'failed', {
				error: 'chat não encontrado',
			});
			return;
		}
		// Estado pode ter mudado durante a janela (pausa/transfer/toggle).
		if (
			!instance.ia_enabled ||
			chat.ia_paused ||
			chat.assigned_to !== 'ai' ||
			instance.billing_status !== 'ok'
		) {
			await omniMessageRepository.markSkipped(inputMessageIds);
			await omniTurnRepository.finish(turnId, 'done');
			return;
		}

		// Cap anti-loop por chat/hora.
		const cap = await incrWithTtl(`omni:cap:${chatId}`, 3600);
		if (cap > TURN_CAP_PER_HOUR) {
			await omniMessageRepository.markSkipped(inputMessageIds);
			await omniTurnRepository.finish(turnId, 'failed', {
				error: `cap de ${TURN_CAP_PER_HOUR} turnos/hora atingido`,
			});
			return;
		}

		emitOmni(instance.id, 'ai-typing', { chatId, active: true });
		try {
			const pending = (await omniMessageRepository.listPending(chatId)).filter(
				(m) => inputMessageIds.includes(m.id),
			);
			if (pending.length === 0) {
				await omniTurnRepository.finish(turnId, 'done');
				return;
			}

			await preprocessMedia(pending);

			const [agents, config, allRecent] = await Promise.all([
				omniAgentRepository.listByInstance(instance.id, { enabledOnly: true }),
				omniConfigRepository.get(instance.id),
				omniMessageRepository.lastN(chatId, HISTORY_MESSAGES),
			]);
			const router = agents.find((a) => a.role === 'router') ?? null;
			const specialists = agents.filter((a) => a.role === 'specialist');
			const pendingIds = new Set(pending.map((m) => m.id));
			const history = buildHistory(allRecent, pendingIds);
			const userBlock = pending.map((m) => messageText(m)).join('\n');

			const outcome = await runRouter(
				instance,
				router,
				specialists,
				config,
				history,
				userBlock,
			);

			// Transferência pra humano (mesmo sem texto final).
			if (outcome.transfer) {
				await omniChatRepository.updateChat(chatId, {
					assigned_to: 'human',
					assigned_user_id: null,
					assigned_user_name: null,
					status: 'waiting',
				});
				const freshChat = await omniChatRepository.findById(chatId);
				if (freshChat)
					emitOmni(instance.id, 'chat-update', { chat: freshChat });
			}

			if (!outcome.reply) {
				await omniMessageRepository.markConsumed(inputMessageIds);
				await omniTurnRepository.finish(turnId, 'done', {
					model: outcome.model,
					prompt_tokens: outcome.promptTokens,
					completion_tokens: outcome.completionTokens,
				});
				return;
			}

			await this.chargeAndSend(instance, chat.id, chat.wa_chat_id, outcome, {
				turnId,
				inputMessageIds,
			});
		} finally {
			emitOmni(instance.id, 'ai-typing', { chatId, active: false });
		}
	}

	/**
	 * COBRA ANTES DE ENVIAR (idempotente por ref_id = id da mensagem de saída;
	 * partial unique no upvox). Envio falhou depois do débito → refund
	 * best-effort. Racional: enviar antes e falhar o débito = perda inauditável;
	 * assim o pior caso fica detectável no ledger (spend sem refund + msg failed).
	 */
	private async chargeAndSend(
		instance: OmniInstance,
		chatId: string,
		waChatId: string,
		outcome: TurnOutcome,
		meta: { turnId: string; inputMessageIds: string[] },
	): Promise<void> {
		const outId = randomUUID();
		const spend = await spendOmni(instance.owner_id, {
			ref_id: outId,
			vox_cost: VOX_COST_PER_MESSAGE,
		});

		if (spend === null) {
			// upvox fora do ar → NÃO responde; pendentes ficam; varredura re-tenta.
			await omniTurnRepository.finish(meta.turnId, 'failed', {
				error: 'upvox indisponível no débito',
				model: outcome.model,
			});
			return;
		}
		if ('insufficient' in spend) {
			await omniInstanceRepository.setBillingStatus(instance.id, 'no_balance');
			await omniMessageRepository.markSkipped(meta.inputMessageIds);
			await omniTurnRepository.finish(meta.turnId, 'no_balance');
			emitOmni(instance.id, 'billing-status', {
				billing_status: 'no_balance',
			});
			return;
		}

		try {
			const provider = getProvider(instance.provider);
			const ctx = buildProviderCtx(instance);
			const { providerMessageId } = await provider.sendText(
				ctx,
				waChatId,
				outcome.reply as string,
			);
			const msg = await omniMessageRepository.insertOutbound({
				id: outId,
				chat_id: chatId,
				instance_id: instance.id,
				provider_message_id: providerMessageId,
				direction: 'out',
				author_type: 'ai',
				sender_name: 'Agente IA',
				content: outcome.reply,
				status: 'sent',
				billing: 'billed',
				wa_timestamp: new Date().toISOString(),
			});
			await omniMessageRepository.markConsumed(meta.inputMessageIds);
			await omniChatRepository.bumpOutbound(chatId, outcome.reply as string);
			await omniTurnRepository.finish(meta.turnId, 'done', {
				output_message_id: outId,
				model: outcome.model,
				prompt_tokens: outcome.promptTokens,
				completion_tokens: outcome.completionTokens,
				voxxys_charged: spend.voxes_spent,
			});
			emitOmni(instance.id, 'new-message', { chatId, message: msg });
			const fresh = await omniChatRepository.findById(chatId);
			if (fresh) emitOmni(instance.id, 'chat-update', { chat: fresh });
		} catch (sendErr) {
			await refundOmni(instance.owner_id, {
				ref_id: outId,
				vox_cost: VOX_COST_PER_MESSAGE,
			}).catch(() => false);
			await omniMessageRepository
				.insertOutbound({
					id: outId,
					chat_id: chatId,
					instance_id: instance.id,
					direction: 'out',
					author_type: 'ai',
					sender_name: 'Agente IA',
					content: outcome.reply,
					status: 'failed',
					billing: 'refunded',
					error: String(sendErr).slice(0, 500),
					wa_timestamp: new Date().toISOString(),
				})
				.catch(() => null);
			await omniMessageRepository.markSkipped(meta.inputMessageIds);
			await omniTurnRepository.finish(meta.turnId, 'failed', {
				output_message_id: outId,
				model: outcome.model,
				error: `envio falhou: ${String(sendErr).slice(0, 500)}`,
			});
		}
	}
}

export const omniPipeline = new OmniPipeline();

// Pluga o motor no debounce (evita import circular) e liga a varredura.
omniDebounce.setRunner((instance, chatId, turnId, inputIds) =>
	omniPipeline.runTurn(instance, chatId, turnId, inputIds),
);
