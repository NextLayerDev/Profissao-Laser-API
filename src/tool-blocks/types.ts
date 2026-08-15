import type { z } from 'zod';

/**
 * Fábrica de Tools — um BLOCO é a unidade que o motor genérico compõe. Cada
 * bloco EMBRULHA uma função já existente do `lib/*` (laserPrep, vectorizeImage,
 * storage…) com um schema de params (Zod) e devolve um mapa de saídas que o
 * motor injeta na "bag" como `${nodeId}.${chave}`. A IA (Marco 3) só compõe
 * estes blocos curados — nunca escreve código. Blocos = fronteira de segurança.
 */

/**
 * Um evento de progresso. `kind` é livre (cada bloco descreve o que faz) e o
 * motor carimba `node` antes de repassar, para o front saber de onde veio sem
 * o bloco precisar conhecer o próprio id.
 */
export interface BlockProgressEvent {
	kind: string;
	[k: string]: unknown;
}

/** Contexto de execução de um run (compartilhado por todos os blocos do pipeline). */
export interface BlockRunContext {
	/** Identidade do cliente que disparou o run (escopo de storage/billing). */
	customerId: string;
	/** Bearer original do request, repassado a chamadas server-to-server. */
	authHeader?: string;
	/**
	 * Aborta o run. AGORA É PREENCHIDO DE VERDADE — por anos ficou declarado e
	 * ignorado, e o motor montava o contexto sem ele.
	 *
	 * Serve para DEADLINE e cancelamento explícito, **não** para socket que caiu:
	 * um bloco que dispara vários agentes grava o resultado antes de responder, e
	 * abortar quando o cliente desconecta jogaria fora um trabalho já cobrado
	 * para economizar centavos de API.
	 */
	signal?: AbortSignal;
	/**
	 * Progresso ao vivo, quando quem chamou sabe transmitir (rota SSE). Ausente
	 * no caminho normal — por isso é opcional e nenhum bloco existente muda.
	 *
	 * Nunca lança: um `onProgress` que estoure derrubaria um run que já deu
	 * certo. Quem passa é responsável por engolir os próprios erros.
	 */
	onProgress?: (ev: BlockProgressEvent) => void;
	/**
	 * Definition JÁ carregada, para o bloco não ir buscá-la de novo.
	 *
	 * Existe por causa do LINK PÚBLICO de orçamento: lá não há Bearer do dono
	 * (o visitante não tem conta), e `loadPublishedToolDefinition` fala com o
	 * upvox por HTTP — que, com `EXTERNAL_API_URL` apontando para o gateway,
	 * exige o Bearer e devolveria 401. A rota pública lê a definition direto do
	 * banco do upvox (cliente de serviço) e a injeta aqui. Ausente = o bloco
	 * carrega sozinho, como sempre fez.
	 */
	toolDoc?: unknown;
	/**
	 * `true` quando o run é PREVIEW: a rota não cobrada, sem storage e sem
	 * registro em banco (`/api/tool-run/:key/preview`).
	 *
	 * Um bloco NÃO usa isto para decidir se roda — quem decide é o controller,
	 * que filtra o pipeline antes. Serve para o bloco ser mais econômico quando
	 * o trabalho é de graça: hoje, só a ampliação, que aperta o teto de
	 * megapixels porque no preview a imagem volta inteira dentro do JSON.
	 */
	preview?: boolean;
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
