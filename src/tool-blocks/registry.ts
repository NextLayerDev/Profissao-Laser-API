import type { ToolBlock } from './types.js';

/**
 * Registry de blocos curados. O motor genérico resolve `node.block` aqui; um
 * bloco desconhecido na definition vira erro de validação (400), não 500.
 */
class BlockRegistry {
	private readonly blocks = new Map<string, ToolBlock>();

	register(block: ToolBlock): void {
		if (this.blocks.has(block.id)) {
			throw new Error(`Bloco duplicado no registry: ${block.id}`);
		}
		this.blocks.set(block.id, block);
	}

	get(id: string): ToolBlock | undefined {
		return this.blocks.get(id);
	}

	has(id: string): boolean {
		return this.blocks.has(id);
	}

	/** Lista os ids registrados (curadoria/whitelist do agente — Marco 4). */
	keys(): string[] {
		return [...this.blocks.keys()];
	}
}

export const blockRegistry = new BlockRegistry();
