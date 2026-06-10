import type Anthropic from '@anthropic-ai/sdk';
import { AGENT_MODEL, anthropic } from '../lib/anthropic.js';
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

/** Preços do Claude por TOKEN (USD), env-configuráveis (defaults Sonnet 4.6). */
const num = (k: string, d: number) => {
	const v = Number(process.env[k]);
	return Number.isFinite(v) && v >= 0 ? v : d;
};
const PRICE = {
	in: num('TOOL_AGENT_PRICE_IN', 3 / 1_000_000),
	out: num('TOOL_AGENT_PRICE_OUT', 15 / 1_000_000),
	cacheWrite: num('TOOL_AGENT_PRICE_CACHE_WRITE', 3.75 / 1_000_000),
	cacheRead: num('TOOL_AGENT_PRICE_CACHE_READ', 0.3 / 1_000_000),
};
const VOX_USD = num('TOOL_AGENT_VOX_USD', 0.1); // valor de 1 vox em USD
const MARKUP = num('TOOL_AGENT_MARKUP', 3); // margem (proporcional ao uso + lucro)
const GRAN = num('TOOL_AGENT_VOX_GRANULARITY', 0.05);

interface Usage {
	in: number;
	out: number;
	cw: number;
	cr: number;
}

/** Custo do turno em voxes: USD dos tokens → voxes com markup, arredondado pra cima. */
function voxesFromUsage(u: Usage): number {
	const usd =
		u.in * PRICE.in +
		u.out * PRICE.out +
		u.cw * PRICE.cacheWrite +
		u.cr * PRICE.cacheRead;
	const raw = (usd / VOX_USD) * MARKUP;
	const stepped = Math.ceil(raw / GRAN) * GRAN;
	return Math.max(0, Math.round(stepped * 100) / 100);
}

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
	turn: number,
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
		console.error('[tool-agent] turno falhou:', err);
		send('error', {
			message:
				'Tive um problema pra montar agora. O que já fiz está aí — tenta de novo?',
		});
	}

	// Metering: cobra por tokens (com markup) ao fim do turno.
	const voxCost = voxesFromUsage(usage);
	const refId = `${req.session_id}:${turn}`;
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
