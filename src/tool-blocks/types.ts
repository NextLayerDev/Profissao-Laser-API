import type { z } from 'zod';

/**
 * Fábrica de Tools — um BLOCO é a unidade que o motor genérico compõe. Cada
 * bloco EMBRULHA uma função já existente do `lib/*` (laserPrep, vectorizeImage,
 * storage…) com um schema de params (Zod) e devolve um mapa de saídas que o
 * motor injeta na "bag" como `${nodeId}.${chave}`. A IA (Marco 3) só compõe
 * estes blocos curados — nunca escreve código. Blocos = fronteira de segurança.
 */

/** Contexto de execução de um run (compartilhado por todos os blocos do pipeline). */
export interface BlockRunContext {
	/** Identidade do cliente que disparou o run (escopo de storage/billing). */
	customerId: string;
	/** Bearer original do request, repassado a chamadas server-to-server. */
	authHeader?: string;
	/** Aborta o run (timeout/cancelamento). Reservado p/ marcos seguintes. */
	signal?: AbortSignal;
}

/**
 * Um bloco do registry. `paramsSchema` valida (e coage) os params JÁ resolvidos
 * (referências `input.x`/`<nodeId>.campo` trocadas pelos valores reais). `run`
 * devolve as saídas do bloco — chaves simples (`png`, `url`, `svg`…) que o motor
 * prefixa com o id do nó na bag.
 */
export interface ToolBlock<P = unknown> {
	/** Identificador estável, ex.: `laser.photoengrave`. */
	id: string;
	/** Categoria pra UI/curadoria (image/laser/output…). */
	category: string;
	/** Descrição curta (docs/Tool Engineer). */
	description: string;
	/** Schema dos params resolvidos. */
	paramsSchema: z.ZodType<P>;
	/** Executa o bloco e devolve as saídas (viram `${nodeId}.<chave>` na bag). */
	run(ctx: BlockRunContext, params: P): Promise<Record<string, unknown>>;
}
