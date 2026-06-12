/**
 * Erro do motor/blocos com status HTTP a propagar (400 = definição/uso inválido).
 * Em módulo próprio pra os blocos poderem lançá-lo sem ciclo de import com
 * `tool-engine` (que importa o registry, que importa os blocos).
 */
export class ToolEngineError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'ToolEngineError';
	}
}
