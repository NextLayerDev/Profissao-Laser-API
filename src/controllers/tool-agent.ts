import type { FastifyReply, FastifyRequest } from 'fastify';
import { incrWithTtl } from '../lib/redis.js';
import { type AgentTurnRequest, runAgentTurn } from '../services/tool-agent.js';

const MAX_TURNS = Number(process.env.TOOL_AGENT_MAX_TURNS_PER_SESSION) || 40;
const SESSION_TTL_SECONDS = 6 * 60 * 60; // 6h

/**
 * `POST /api/tool-agent/turn` — um turno do Agente "Tool Engineer", em SSE.
 * Checa o teto de turnos por sessão (Redis, fail-open) ANTES de chamar o modelo,
 * abre o stream e delega pro service, que emite os eventos (text/action/doc/
 * cost/done). Cobrança por tokens→voxes acontece no fim do turno (no service).
 */
export const toolAgentController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
	if (!customerId) {
		return reply.status(403).send({ message: 'Customer not found' });
	}

	const body = request.body as unknown as AgentTurnRequest;

	// Teto de turnos por sessão (Redis). incrWithTtl devolve -1 sem Redis (fail-open).
	const turn = await incrWithTtl(
		`agent:turns:${body.session_id}`,
		SESSION_TTL_SECONDS,
	);
	if (turn > 0 && turn > MAX_TURNS) {
		return reply.status(402).send({ message: 'session_budget_exceeded' });
	}

	// SSE: assume o controle da resposta crua.
	reply.hijack();
	const raw = reply.raw;
	raw.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	const send = (event: string, data: unknown) => {
		raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};

	try {
		await runAgentTurn(body, customerId, turn < 0 ? 0 : turn, authHeader, send);
	} catch (err) {
		console.error('[tool-agent] controller erro:', err);
		try {
			send('error', { message: 'Erro inesperado.' });
		} catch {
			// stream já fechado
		}
	} finally {
		raw.end();
	}
};
