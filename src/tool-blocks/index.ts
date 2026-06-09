import { imageInputBlock, imageVectorizeBlock } from './blocks/image.js';
import { laserPhotoengraveBlock } from './blocks/laser.js';
import {
	outputReturnBase64Block,
	outputUploadPngBlock,
	outputUploadSvgBlock,
} from './blocks/output.js';
import { blockRegistry } from './registry.js';

/**
 * Registra os blocos MVP (Marco 1). Cada bloco embrulha uma função já existente
 * do `lib/*`. Marcos seguintes ampliam a biblioteca (texto/documento/dados/web)
 * e o runtime (flow.*, agent_v1) — sempre por composição, sem motor novo.
 */
let registered = false;

export function registerCoreBlocks(): void {
	if (registered) return;
	registered = true;
	blockRegistry.register(imageInputBlock);
	blockRegistry.register(laserPhotoengraveBlock);
	blockRegistry.register(imageVectorizeBlock);
	blockRegistry.register(outputUploadPngBlock);
	blockRegistry.register(outputUploadSvgBlock);
	blockRegistry.register(outputReturnBase64Block);
}

export { blockRegistry } from './registry.js';
export type { BlockRunContext, ToolBlock } from './types.js';
