import { adjustBlocks } from './blocks/adjust.js';
import { aiGenerateImageBlock } from './blocks/ai.js';
import { aiArtTeamBlock } from './blocks/ai-art-team.js';
import { aiExtraBlocks } from './blocks/ai-extra.js';
import { aiResearchTeamBlock } from './blocks/ai-research-team.js';
import { aiTextBlock } from './blocks/ai-text.js';
import { videoPromptBlocks } from './blocks/ai-video-prompt.js';
import { aiVisionBlock } from './blocks/ai-vision.js';
import { brandmarkBlocks } from './blocks/brandmark.js';
import { cadBlocks } from './blocks/cad.js';
import { collectionBlocks } from './blocks/collection.js';
import { collectionImageBlocks } from './blocks/collection-image.js';
import { dispatchBlocks } from './blocks/dispatch.js';
import { ditherBlocks } from './blocks/dither.js';
import { edgeBlurBlocks } from './blocks/edge-blur.js';
import { geoBlocks } from './blocks/geo.js';
import {
	imageInputBlock,
	imagePaletteBlock,
	imageVectorizeBlock,
} from './blocks/image.js';
import { imageStudioBlocks } from './blocks/image-studio.js';
import { kitBlocks } from './blocks/kit.js';
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
import { quotePerfilPadraoBlock } from './blocks/quote-profile.js';
import { stylizeBlocks } from './blocks/stylize.js';
import { tileBlocks } from './blocks/tile.js';
import {
	conditionBlock,
	httpRequestBlock,
	mathBlock,
	textTemplateBlock,
} from './blocks/util.js';
import { vectorExtraBlocks } from './blocks/vector-extra.js';
import { videoBlocks } from './blocks/video.js';
import { videoIaBlocks } from './blocks/video-ia.js';
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
	// Cores dominantes (k-means local): a paleta da marca lida do próprio logo.
	blockRegistry.register(imagePaletteBlock);
	blockRegistry.register(outputUploadPngBlock);
	blockRegistry.register(outputUploadSvgBlock);
	blockRegistry.register(outputReturnBase64Block);
	// IA — geração de imagem (texto→imagem via OpenRouter Gemini).
	blockRegistry.register(aiGenerateImageBlock);
	// IA — texto (raciocínio/redação). Modelo escolhido pelo admin na Fábrica.
	blockRegistry.register(aiTextBlock);
	blockRegistry.register(aiVisionBlock);
	blockRegistry.register(aiResearchTeamBlock);
	// Ateliê — o time que lê foto, marca e referências e escreve o PROMPT da
	// arte. A imagem sai do `ai.image_studio` que vem depois dele no pipeline.
	blockRegistry.register(aiArtTeamBlock);
	// Dados — leitura de qualquer coleção da Fábrica (zero código por tool).
	for (const b of collectionBlocks) blockRegistry.register(b);
	// Dados → IMAGEM: a arte que já está na galeria voltando como bytes. É o que
	// deixa um Ajuste (ampliar/variar/limpar o fundo) começar do resultado em vez
	// de começar do zero.
	for (const b of collectionImageBlocks) blockRegistry.register(b);
	// CAD paramétrico — gerador, nesting e prévia saem da mesma IR (`lib/cad/*`);
	// os export de arquivo ficam separados porque são os únicos que tocam storage.
	for (const b of [...cadBlocks, ...outputCadBlocks]) blockRegistry.register(b);
	// Central de Custos — leitura de DXF/SVG, métricas, diagnóstico e orçamento.
	// Nenhum deles toca storage nem IA: são todos puros sobre `lib/cad`/`lib/quote`.
	for (const b of quoteBlocks) blockRegistry.register(b);
	// Perfil curto: seis perguntas → os 31 campos do perfil de custo. Fica em
	// arquivo próprio porque é o único bloco de `quote` que NÃO precifica nada —
	// ele monta o cadastro que o precificador vai ler depois.
	blockRegistry.register(quotePerfilPadraoBlock);
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
		// Ateliê — o logo do aluno COMPOSTO por cima da área que o time reservou.
		// Determinístico (sharp puro): é o que fecha "arte 100% com a cara da
		// empresa", porque o gerador de imagem nunca vê o arquivo do logo.
		...brandmarkBlocks,
		// Ateliê — o KIT: uma geração, vários formatos. Recorte por sharp, sem
		// gerar imagem nova (gerar N exigiria `variation_count`, que o
		// `ai.image_studio` descarta — o aluno pagaria 3 e receberia 1).
		...kitBlocks,
		// Ateliê — o ANÚNCIO EM MOVIMENTO sobre a arte que o kit já entregou.
		// Determinístico (sharp + ffmpeg local): movimento de CÂMERA sobre imagem
		// já paga, custo de fornecedor US$ 0,00. É o degrau de baixo, e continua
		// grátis e incluso. O binário é opcional: sem ele o bloco devolve sem
		// vídeo, nunca 500.
		//
		// ⚠ O comentário antigo daqui dizia que "o OpenRouter não tem um único
		// modelo de vídeo". Isso ficou VELHO e custou uma fase: `GET /v1/models`
		// de fato não lista vídeo até hoje — quem lista é `GET /v1/videos/models`,
		// um endpoint separado, com 22 modelos. Ver `videoIaBlocks` logo abaixo.
		...videoBlocks,
		// Vídeo GENERATIVO — compra separada, e este bloco é só QUEM ESCREVE O
		// PEDIDO. Prompt de vídeo descreve MOVIMENTO (o que se move, para onde,
		// em quanto tempo), e não composição: mandar o prompt da IMAGEM para o
		// gerador de vídeo foi medido e sai pior que não pedir nada — ver a caixa
		// das três gerações em `lib/atelie/movimento.ts`.
		...videoPromptBlocks,
		// Vídeo GENERATIVO — QUEM GERA. O degrau de cima: a arte vira o primeiro
		// quadro e o modelo cria o movimento. Custa dólar por clique, então é
		// tool própria com preço próprio (12 voxxys), e toda falha aqui LANÇA —
		// lançar é o que aciona o estorno no controller.
		...videoIaBlocks,
	])
		blockRegistry.register(b);
}

export { blockRegistry } from './registry.js';
export type { BlockRunContext, ToolBlock } from './types.js';
