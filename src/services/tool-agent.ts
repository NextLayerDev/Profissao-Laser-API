import type Anthropic from '@anthropic-ai/sdk';
import { AGENT_MODEL, anthropic } from '../lib/anthropic.js';
import { type Usage, voxesFromUsage } from '../lib/tool-agent-metering.js';
import { buildSystem, summarizeDoc } from '../lib/tool-agent-prompt.js';
import {
	AGENT_TOOLS,
	type AgentCatalog,
	applyAgentTool,
} from '../lib/tool-agent-tools.js';
import type { ToolDefinitionDoc } from '../lib/tool-definitions.js';
import { spendAgent } from '../lib/upvox-agent.js';
import { registerCoreBlocks } from '../tool-blocks/index.js';

// Garante os blocos no registry (o validate do agente usa o registry real).
registerCoreBlocks();

const MAX_ITERATIONS = 16; // teto de passos de tool-use por turno (espelha 32 nós)
const MAX_TOKENS = 8000;

export interface AgentTurnRequest {
	session_id: string;
	definition: ToolDefinitionDoc;
	catalog: AgentCatalog;
	message: string;
	history: { role: 'user' | 'assistant'; content: string }[];
}

export type AgentSend = (event: string, data: unknown) => void;

/**
 * Roda UM turno do agente: loop de tool-use streamando. Emite eventos SSE via
 * `send`: `text` (narração), `action` (cada tool), `doc` (doc novo ao vivo),
 * `cost` (voxes/saldo), `done`. Nunca lança — erros viram evento `error`.
 */
export async function runAgentTurn(
	req: AgentTurnRequest,
	customerId: string,
	refId: string,
	authHeader: string | undefined,
	send: AgentSend,
): Promise<void> {
	let doc: ToolDefinitionDoc = structuredClone(req.definition);
	const system = buildSystem(req.catalog);
	const messages: Anthropic.MessageParam[] = req.history.map((h) => ({
		role: h.role,
		content: h.content,
	}));
	messages.push({
		role: 'user',
		content: [
			{ type: 'text', text: summarizeDoc(doc) },
			{ type: 'text', text: req.message },
		],
	});

	const usage: Usage = { in: 0, out: 0, cw: 0, cr: 0 };
	const actions: { type: string; label: string; ok: boolean }[] = [];
	let done = false;
	let needsInput = false;
	let errored = false;

	try {
		for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
			const stream = anthropic.messages.stream({
				model: AGENT_MODEL,
				max_tokens: MAX_TOKENS,
				system,
				tools: AGENT_TOOLS as unknown as Anthropic.Tool[],
				messages,
			});
			stream.on('text', (delta) => send('text', { delta }));
			const msg = await stream.finalMessage();

			usage.in += msg.usage.input_tokens ?? 0;
			usage.out += msg.usage.output_tokens ?? 0;
			usage.cw += msg.usage.cache_creation_input_tokens ?? 0;
			usage.cr += msg.usage.cache_read_input_tokens ?? 0;

			messages.push({ role: 'assistant', content: msg.content });

			if (msg.stop_reason !== 'tool_use') break;

			const toolResults: Anthropic.ToolResultBlockParam[] = [];
			for (const block of msg.content) {
				if (block.type !== 'tool_use') continue;
				const outcome = applyAgentTool(
					doc,
					req.catalog,
					block.name,
					(block.input ?? {}) as Record<string, unknown>,
				);
				if (outcome.doc) {
					doc = outcome.doc;
					send('doc', { definition: doc });
				}
				send('action', {
					type: block.name,
					label: outcome.actionLabel,
					ok: !outcome.error,
				});
				actions.push({
					type: block.name,
					label: outcome.actionLabel,
					ok: !outcome.error,
				});
				toolResults.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: outcome.result,
					is_error: !!outcome.error,
				});
				if (outcome.done) done = true;
				if (outcome.needsInput) needsInput = true;
			}
			messages.push({ role: 'user', content: toolResults });
			if (done || needsInput) break;
		}
	} catch (err) {
		errored = true;
		console.error('[tool-agent] turno falhou:', err);
		send('error', {
			message:
				'Tive um problema pra montar agora. O que já fiz está aí — tenta de novo?',
		});
	}

	// Metering: cobra por tokens (com markup) ao fim do turno. O `refId` é a
	// chave de auditoria do débito (única por turno — vem do controller).
	// Cortesia: turno que falhou SEM nenhuma ação útil não cobra (não houve build).
	const voxCost = errored && actions.length === 0 ? 0 : voxesFromUsage(usage);
	const spend = await spendAgent(
		customerId,
		{ ref_id: refId, vox_cost: voxCost },
		authHeader,
	);
	let voxesSpent = voxCost;
	let balance: number | null = null;
	let insufficient = false;
	if (spend === null) {
		// erro de rede/HTTP: mantém o custo otimista, saldo desconhecido.
	} else if ('insufficient' in spend) {
		insufficient = true;
	} else {
		voxesSpent = spend.voxes_spent;
		balance = spend.balance;
	}
	send('cost', { voxes_spent: voxesSpent, balance, insufficient });
	send('done', { definition: doc, done, needs_input: needsInput, actions });
}
