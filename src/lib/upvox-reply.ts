import type { FastifyReply } from 'fastify';
import { UpvoxApiError } from './upvox-client.js';

/**
 * Mapeia erros da upvox-api para respostas HTTP padronizadas.
 * Repassa status + code para o front diferenciar:
 *   • 401 unauthorized               → token inválido/expirado
 *   • 403 subscription_required      → sem assinatura ativa para o curso
 *   • 403 subscription_not_active    → assinatura inadimplente/pausada
 *   • 403 tool_not_entitled          → plano não inclui a ferramenta
 *   • 404 tool                       → toolKey desconhecido/desabilitado
 *   • 402 payment_required           → sem quota e sem voxes suficientes
 *   • 5xx                            → upstream (mapeado p/ 502)
 */
export function replyUpvoxError(err: unknown, reply: FastifyReply) {
	if (err instanceof UpvoxApiError) {
		const status = err.status >= 500 ? 502 : err.status;
		return reply.status(status).send({
			message: err.message,
			code: err.code,
			upstream: 'upvox-api',
		});
	}
	const message = err instanceof Error ? err.message : 'Unknown error';
	return reply.status(502).send({
		message,
		code: 'upstream_error',
		upstream: 'upvox-api',
	});
}

export function isUpvoxError(err: unknown): err is UpvoxApiError {
	return err instanceof UpvoxApiError;
}
