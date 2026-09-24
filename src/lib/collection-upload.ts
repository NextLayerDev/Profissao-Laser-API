import sharp from 'sharp';
import { classifyImage } from './image-classify.js';
import { ToolEngineError } from './tool-errors.js';
import { extractPalette, type PaletteColor } from './vectorize-color.js';

/**
 * IMAGEM SUBIDA PELO ALUNO — a higienização, separada do HTTP.
 *
 * Este é o PRIMEIRO caminho em que um aluno põe bytes numa CDN pública (Bunny,
 * URL sem assinatura, servida para qualquer um que tenha o link). Todo upload
 * anterior era de admin. A diferença de confiança é o motivo deste arquivo
 * existir: o que o admin manda a gente guarda; o que o aluno manda a gente
 * DECODIFICA E REESCREVE antes de guardar.
 *
 * Mora em `lib/` e não no controller porque é decisão pura sobre bytes — dá
 * para testar sem Fastify, sem Supabase e sem rede.
 */

/**
 * 5 MB — o mesmo teto do upload do admin (`controllers/tool-bank.ts`). Não
 * inventamos um número novo de propósito: o front já sabe recusar acima disso,
 * e um logo de empresa não chega perto.
 *
 * ATENÇÃO: `src/server.ts` registra o multipart com 1,5 GB (o painel sobe
 * vídeo de aula). Este teto SÓ vale se quem lê o arquivo passar `limits` por
 * request — ver `uploadCollectionImageController`.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Teto de pixels da ENTRADA (40 MP). Um PNG de 2 KB pode declarar 30 000 ×
 * 30 000 e explodir a memória do processo ao ser decodificado ("zip bomb" de
 * imagem). 40 MP cobre qualquer foto de celular atual com folga.
 */
const MAX_INPUT_PIXELS = 40 * 1_000_000;

/**
 * Maior lado da imagem GUARDADA. O destino é logo de marca e foto de produto
 * dentro de uma peça — acima disto só engorda a CDN e o tempo de carregamento
 * da tela do aluno.
 */
const MAX_LADO_PX = 2000;

/**
 * Formatos aceitos — a lista do admin MENOS o SVG e o GIF.
 *
 * SVG é MARKUP EXECUTÁVEL, não imagem: aceita `<script>`, `onload=` e
 * referência externa. O admin pode subir (é quem escreve as definitions de
 * qualquer jeito); o aluno, não — seria script de terceiro hospedado na nossa
 * CDN, com o link circulando como se fosse nosso. É também o único formato que
 * não sobrevive ao "decodifica e reescreve" abaixo, que é justamente o que
 * mata payload escondido.
 *
 * GIF fica de fora por ser animação: reescrever quadro a quadro é caro e um
 * logo não pisca. Recusa explícita é melhor que aceitar e entregar o 1º quadro.
 */
const FORMATOS_ACEITOS = new Set(['png', 'jpeg', 'webp']);

const MIME_POR_FORMATO: Record<string, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};

/** Extensão canônica — o Bunny serve pelo Content-Type derivado DELA. */
const EXT_POR_FORMATO: Record<string, string> = {
	png: 'png',
	jpeg: 'jpg',
	webp: 'webp',
};

const MSG_FORMATO = 'Envie uma imagem PNG, JPG ou WEBP (arquivo de até 5 MB).';

export interface ImagemPreparada {
	/** Bytes JÁ reescritos — não são os bytes que chegaram. */
	buffer: Buffer;
	mimetype: string;
	ext: string;
	width: number;
	height: number;
}

/**
 * Valida e REESCREVE a imagem do aluno.
 *
 * Três coisas acontecem aqui, e nenhuma é cosmética:
 *
 * 1. **O formato é lido dos BYTES, não do `Content-Type`.** O mimetype da parte
 *    multipart é escrito por quem envia: `Content-Type: image/png` num arquivo
 *    HTML passa em qualquer verificação de string. Quem decide é o decodificador.
 *
 * 2. **A imagem é re-encodada.** Isso descarta de uma vez o EXIF (que num
 *    celular carrega COORDENADA DE GPS — o endereço da oficina do aluno indo
 *    parar numa URL pública), qualquer bloco de metadado com payload e qualquer
 *    byte extra grudado no fim do arquivo. O `.rotate()` vem antes justamente
 *    porque a orientação mora no EXIF: sem ele, a foto do celular seria
 *    guardada deitada.
 *
 * 3. **O tamanho é limitado nos dois sentidos** — pixels na entrada (bomba de
 *    descompressão) e maior lado na saída (peso na CDN e na tela).
 */
export async function prepararImagemDoAluno(
	bruto: Buffer,
): Promise<ImagemPreparada> {
	if (!bruto.byteLength) {
		throw new ToolEngineError(400, 'Arquivo vazio.');
	}
	if (bruto.byteLength > MAX_UPLOAD_BYTES) {
		throw new ToolEngineError(413, 'Imagem grande demais (máx 5 MB).');
	}

	let meta: sharp.Metadata;
	try {
		/**
		 * SEM `limitInputPixels` AQUI — de propósito.
		 *
		 * `metadata()` lê o CABEÇALHO, não decodifica: um PNG de 12000×12000 com
		 * poucos KB não vira 576 MB de memória nesta linha. Com o limite ligado,
		 * porém, ela lançava antes da checagem de dimensão logo abaixo, e o aluno
		 * recebia "Envie uma imagem PNG, JPG ou WEBP (até 5 MB)" — enganoso, já
		 * que o arquivo ERA PNG e tinha menos de 5 MB. A defesa funcionava; a
		 * orientação é que mandava a pessoa para o lado errado.
		 *
		 * A bomba continua barrada duas vezes: pela dimensão explícita abaixo e
		 * pelo `limitInputPixels` do pipeline que de fato decodifica.
		 */
		meta = await sharp(bruto).metadata();
	} catch {
		// Não é imagem nenhuma (ou é um formato que o sharp não abre). A mensagem
		// é a mesma do formato recusado: dizer "o arquivo está corrompido" ou "o
		// formato X não é aceito" só ajudaria quem está sondando o endpoint.
		throw new ToolEngineError(400, MSG_FORMATO);
	}

	const formato = meta.format ?? '';
	if (!FORMATOS_ACEITOS.has(formato)) {
		throw new ToolEngineError(400, MSG_FORMATO);
	}

	const w = meta.width ?? 0;
	const h = meta.height ?? 0;
	if (!w || !h) throw new ToolEngineError(400, MSG_FORMATO);
	if (w * h > MAX_INPUT_PIXELS) {
		throw new ToolEngineError(
			400,
			`Imagem grande demais: ${w}×${h}px. Reduza antes de enviar.`,
		);
	}

	// `animated: false` é explícito: um WEBP animado entra e sai como um quadro
	// só, em vez de virar um arquivo pesado que ninguém pediu.
	const pipeline = sharp(bruto, {
		limitInputPixels: MAX_INPUT_PIXELS,
		animated: false,
	})
		.rotate()
		.resize({
			width: MAX_LADO_PX,
			height: MAX_LADO_PX,
			fit: 'inside',
			withoutEnlargement: true,
		});

	// Mantém o formato de origem: PNG preserva a transparência do logo, e
	// converter foto para PNG multiplicaria o peso por 5.
	const codificado =
		formato === 'jpeg'
			? pipeline.jpeg({ quality: 88 })
			: formato === 'webp'
				? pipeline.webp({ quality: 88 })
				: pipeline.png({ compressionLevel: 9 });

	let saida: { data: Buffer; info: sharp.OutputInfo };
	try {
		saida = await codificado.toBuffer({ resolveWithObject: true });
	} catch {
		throw new ToolEngineError(400, MSG_FORMATO);
	}

	return {
		buffer: saida.data,
		mimetype: MIME_POR_FORMATO[formato] ?? 'application/octet-stream',
		ext: EXT_POR_FORMATO[formato] ?? 'bin',
		width: saida.info.width,
		height: saida.info.height,
	};
}

/* ─────────────────────── paleta sugerida ─────────────────────── */

/**
 * Quantas cores a sugestão pede.
 *
 * Seis é teto, não promessa: `extractPalette` corta o que ocupa menos de 0,5%
 * da área, então um logo de duas cores volta com duas. Pedir seis dá à tela
 * material para oferecer escolha (primária, secundária, fundo e sobra) sem
 * inventar cor que não está no logo.
 */
const CORES_SUGERIDAS = 6;

/**
 * AS CORES DOMINANTES DO QUE O ALUNO ACABOU DE SUBIR — sugestão, nunca verdade.
 *
 * Existe para a pergunta "qual é a cor primária da sua marca?" nunca ser feita
 * em hexadecimal: a tela lê do próprio logo e mostra para o aluno confirmar.
 * Vem no MESMO round-trip do upload porque a imagem já está decodificada aqui —
 * um endpoint separado pagaria o download e a decodificação de novo.
 *
 * Três decisões, todas visíveis na assinatura:
 *
 * 1. **NUNCA LANÇA.** A imagem é o produto do upload; a cor é enfeite. Se o
 *    k-means falhar, o aluno tem que receber a URL do mesmo jeito e escolher a
 *    cor na mão. Por isso o `try` mora AQUI e não em quem chama: quem chama
 *    pode esquecer, a função não.
 *
 * 2. **SÓ PARA O QUE PARECE LOGO.** Em foto, as cores dominantes são as da
 *    FOTO (a madeira da bancada, o azulejo do fundo), não as da marca —
 *    pré-preencher a identidade com elas seria pior que não sugerir nada,
 *    porque o aluno confirmaria sem pensar. Quem decide é o classificador
 *    heurístico que já roteia a vetorização, com `allowAI:false`: sem isso ele
 *    faria uma chamada de visão paga na zona de dúvida — cobrar uma pergunta a
 *    um modelo para enfeitar um formulário não se justifica.
 *
 * 3. **Recebe os bytes JÁ REESCRITOS** (`ImagemPreparada.buffer`), não os que
 *    chegaram: as cores sugeridas são as da imagem que ficou guardada, que é a
 *    que o aluno vai ver na tela.
 *
 * `aoFalhar` existe para a falha não ser MUDA: paleta vazia por erro e paleta
 * vazia por ser foto são indistinguíveis na resposta, e sem log ninguém
 * descobriria que o k-means parou de rodar.
 */
export async function paletaSugerida(
	imagem: Buffer,
	aoFalhar?: (err: unknown) => void,
): Promise<PaletteColor[]> {
	try {
		const { kind } = await classifyImage(imagem, { allowAI: false });
		if (kind !== 'logo') return [];
		return await extractPalette(imagem, { colors: CORES_SUGERIDAS });
	} catch (err) {
		aoFalhar?.(err);
		return [];
	}
}
