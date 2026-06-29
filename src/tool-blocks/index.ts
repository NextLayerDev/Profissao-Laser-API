import { adjustBlocks } from './blocks/adjust.js';
import { aiGenerateImageBlock } from './blocks/ai.js';
import { aiExtraBlocks } from './blocks/ai-extra.js';
import { ditherBlocks } from './blocks/dither.js';
import { edgeBlurBlocks } from './blocks/edge-blur.js';
import { geoBlocks } from './blocks/geo.js';
import { imageInputBlock, imageVectorizeBlock } from './blocks/image.js';
import { laserPhotoengraveBlock } from './blocks/laser.js';
import { laserExtraBlocks } from './blocks/laser-extra.js';
import {
	outputReturnBase64Block,
	outputUploadPngBlock,
	outputUploadSvgBlock,
} from './blocks/output.js';
import { outputExtraBlocks } from './blocks/output-extra.js';
import { stylizeBlocks } from './blocks/stylize.js';
import {
	conditionBlock,
	httpRequestBlock,
	mathBlock,
	textTemplateBlock,
} from './blocks/util.js';
import { vectorExtraBlocks } from './blocks/vector-extra.js';
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
	// IA — geração de imagem (texto→imagem via OpenRouter Gemini).
	blockRegistry.register(aiGenerateImageBlock);
	// Blocos genéricos (composição livre).
	blockRegistry.register(textTemplateBlock);
	blockRegistry.register(mathBlock);
	blockRegistry.register(conditionBlock);
	blockRegistry.register(httpRequestBlock);
	// Biblioteca ImagR — port do catálogo (ajustes/dither/borda/desfoque/estilizar/
	// geometria/laser/IA/saída/vetor). Cada grupo é um arquivo em ./blocks/*.
	for (const b of [
		...adjustBlocks,
		...ditherBlocks,
		...edgeBlurBlocks,
		...stylizeBlocks,
		...geoBlocks,
		...laserExtraBlocks,
		...aiExtraBlocks,
		...outputExtraBlocks,
		...vectorExtraBlocks,
	])
		blockRegistry.register(b);
}

export { blockRegistry } from './registry.js';
export type { BlockRunContext, ToolBlock } from './types.js';
