import { adjustBlocks } from './blocks/adjust.js';
import { aiGenerateImageBlock } from './blocks/ai.js';
import { aiExtraBlocks } from './blocks/ai-extra.js';
import { aiTextBlock } from './blocks/ai-text.js';
import { cadBlocks } from './blocks/cad.js';
import { collectionBlocks } from './blocks/collection.js';
import { dispatchBlocks } from './blocks/dispatch.js';
import { ditherBlocks } from './blocks/dither.js';
import { edgeBlurBlocks } from './blocks/edge-blur.js';
import { geoBlocks } from './blocks/geo.js';
import { imageInputBlock, imageVectorizeBlock } from './blocks/image.js';
import { imageStudioBlocks } from './blocks/image-studio.js';
import { laserPhotoengraveBlock } from './blocks/laser.js';
import { laserExtraBlocks } from './blocks/laser-extra.js';
import {
	outputReturnBase64Block,
	outputUploadPngBlock,
	outputUploadSvgBlock,
} from './blocks/output.js';
import { outputCadBlocks } from './blocks/output-cad.js';
import { outputExtraBlocks } from './blocks/output-extra.js';
import { outputGalleryBlocks } from './blocks/output-gallery.js';
import { quoteBlocks } from './blocks/quote.js';
import { stylizeBlocks } from './blocks/stylize.js';
import { tileBlocks } from './blocks/tile.js';
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
	// IA — texto (raciocínio/redação). Modelo escolhido pelo admin na Fábrica.
	blockRegistry.register(aiTextBlock);
	// Dados — leitura de qualquer coleção da Fábrica (zero código por tool).
	for (const b of collectionBlocks) blockRegistry.register(b);
	// CAD paramétrico — gerador, nesting e prévia saem da mesma IR (`lib/cad/*`);
	// os export de arquivo ficam separados porque são os únicos que tocam storage.
	for (const b of [...cadBlocks, ...outputCadBlocks]) blockRegistry.register(b);
	// Central de Custos — leitura de DXF/SVG, métricas, diagnóstico e orçamento.
	// Nenhum deles toca storage nem IA: são todos puros sobre `lib/cad`/`lib/quote`.
	for (const b of quoteBlocks) blockRegistry.register(b);
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
		// Dispatchers das tools-mãe (efeito/dither/IA por dropdown).
		...dispatchBlocks,
		// Estúdio de Imagens: a mãe dos 7 modos, a textura repetível (sharp puro,
		// sem IA) e a gravação na galeria pessoal (coleção, sem DDL).
		...imageStudioBlocks,
		...tileBlocks,
		...outputGalleryBlocks,
	])
		blockRegistry.register(b);
}

export { blockRegistry } from './registry.js';
export type { BlockRunContext, ToolBlock } from './types.js';
