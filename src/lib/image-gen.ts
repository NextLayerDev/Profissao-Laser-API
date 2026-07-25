import sharp from 'sharp';
import { type GeminiImageMessage, openrouter } from './openrouter.js';
import { ToolEngineError } from './tool-errors.js';

/**
 * Geração de imagem (texto→imagem) para a Fábrica de Tools — reusa o MESMO
 * cliente OpenRouter + o parser de resposta do `editor-ai`/`previa` (Gemini
 * image), que já roda em produção. Devolve a imagem normalizada em PNG (buffer
 * + data URL pra preview). Modelo configurável por env, com default no já usado.
 */
const IMAGE_MODEL =
	process.env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3-pro-image-preview';
// 240s: o topo de qualidade da OpenAI (gpt-5.4-image-2) faz reasoning + imagem
// e leva ~150-180s por geração; o gpt-5-image ~100s. Ambos estouravam tetos
// menores → 504. O gateway (undici + proxy timeout explícito) e o front (sem
// timeout) acomodam. Gemini continua ~15s.
const GEN_TIMEOUT_MS = 240_000;
const MAX_OUTPUT_BYTES = 20 * 1_000_000; // 20 MB de teto na imagem gerada

/** Maior divisor comum (pra reduzir W×H a uma proporção limpa no prompt). */
function gcdOf(a: number, b: number): number {
	return b === 0 ? a : gcdOf(b, a % b);
}

/**
 * System prompt padrão de ADERÊNCIA: força o modelo a seguir o prompt do admin
 * palavra por palavra e a subordinar as referências ao texto. Genérico
 * (sem regras de domínio) pra valer pra todo `generateToolImage` — inclusive
 * filtros do Estúdio. As travas específicas (cores puras, enquadramento…) vêm
 * no próprio `prompt_script` do admin; aqui só garantimos que elas sejam
 * cumpridas e que as refs não as sobrescrevam.
 *
 * Overrides per-tool (via `definition.system_prompt` na Fábrica de Tools)
 * SUBSTITUEM este prompt — não concatenam. Decisão de arquitetura 2026-07-10.
 */
export const DEFAULT_IMAGE_SYSTEM_PROMPT = [
	'Você é um gerador de imagens de alta fidelidade.',
	'Siga EXATAMENTE as instruções de texto fornecidas pelo usuário — palavra por palavra.',
	'Toda restrição explícita no texto é OBRIGATÓRIA: cores, enquadramento, estilo, fundo, densidade, composição, preenchimento do canvas.',
	'NÃO adicione gradientes, sombreamento, tons de cinza, fotorrealismo, texturas extras ou elementos pedidos apenas como referência, A MENOS que o texto explicitamente os solicite.',
	'As imagens de referência (quando presentes) servem APENAS como referência de assunto/estilo, e SÓ quando o texto permitir. O texto é AUTORITATIVO e prevalece sobre qualquer referência.',
	'Preencha o canvas conforme instruído no texto. Não deixe margens vazias nem altere a composição salvo instrução expressa.',
	"Gere apenas a imagem solicitada. Não inclua texto explicativo, marca d'água nem bordas.",
].join(' ');

/**
 * Resolve o system prompt final. Se `override` for uma string não-vazia,
 * SUBSTITUI o default (decisão: replace total, não concat). Caso contrário
 * retorna o default laser.
 */
export function buildImageSystemPrompt(override?: string | null): string {
	if (override && override.trim().length > 0) return override;
	return DEFAULT_IMAGE_SYSTEM_PROMPT;
}

/**
 * Prefixo do user message: reposiciona o texto DEPOIS das refs e declara o
 * texto autoritativo. Em multimodal, o último segmento (texto) domina a atenção
 * — assim o prompt do admin não é sobreposto pelo estilo das referências.
 */
const TEXT_LEAD =
	'Siga EXATAMENTE estas instruções. O texto abaixo é autoritativo; as imagens acima são apenas referência de assunto/estilo quando o texto permitir:\n\n';

export interface GenImageResult {
	png: Buffer;
	/** data URL `image/png` pra preview inline (não cobra storage). */
	pngBase64: string;
}

async function downloadAsDataUrl(
	url: string,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(url, { signal });
	if (!res.ok)
		throw new ToolEngineError(502, 'Falha ao baixar a imagem gerada.');
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > MAX_OUTPUT_BYTES) {
		throw new ToolEngineError(502, 'Imagem gerada grande demais.');
	}
	const mime = res.headers.get('content-type') || 'image/png';
	return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Gera uma imagem a partir de `prompt` (+ até N imagens de referência). Lança
 * `ToolEngineError` em qualquer falha — o controller do motor faz refund da
 * invocação automaticamente, então o cliente nunca paga por uma geração falha.
 *
 * `opts.model` — override do modelo OpenRouter (vindo de `definition.model`
 * na Fábrica). Se ausente, usa `IMAGE_MODEL` (env ou default).
 *
 * `opts.systemPromptOverride` — substitui o system prompt laser padrão
 * (decisão: replace total). Se ausente/vazio, usa `DEFAULT_IMAGE_SYSTEM_PROMPT`.
 */
export async function generateToolImage(
	prompt: string,
	refs: Buffer[] = [],
	signal?: AbortSignal,
	opts?: {
		model?: string;
		systemPromptOverride?: string;
		width?: number;
		height?: number;
	},
): Promise<GenImageResult> {
	if (!process.env.OPENROUTER_API_KEY) {
		throw new ToolEngineError(
			503,
			'Geração de imagem indisponível (sem chave OpenRouter).',
		);
	}
	let text = prompt.trim();
	if (!text) throw new ToolEngineError(400, 'Prompt vazio.');

	// Dimensões EXATAS (arte de gravação a laser): reforça a proporção no prompt
	// (o modelo tende a respeitar) e o tamanho é garantido no pós (sharp resize).
	const outW = opts?.width;
	const outH = opts?.height;
	if (outW && outH) {
		const g = gcdOf(outW, outH) || 1;
		const ratio = `${outW / g}:${outH / g}`;
		const orient =
			outW > outH
				? 'horizontal (paisagem)'
				: outW < outH
					? 'vertical (retrato)'
					: 'quadrada';
		text = `${text}\n\nFORMATO OBRIGATÓRIO DA IMAGEM: proporção ${ratio} — orientação ${orient} (${outW}×${outH} px). Componha preenchendo TODO esse formato, sem margens/bordas vazias e sem distorcer.`;
	}

	const model = opts?.model?.trim() || IMAGE_MODEL;
	const systemPrompt = buildImageSystemPrompt(opts?.systemPromptOverride);

	const timeout = AbortSignal.timeout(GEN_TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

	// Refs PRIMEIRO, texto por último (com LEAD autoritativo) — o último
	// segmento multimodal domina a atenção, então o prompt do admin prevalece
	// sobre o estilo/composição das referências.
	// biome-ignore lint/suspicious/noExplicitAny: conteúdo multimodal OpenRouter
	const content: any[] = [];
	for (const ref of refs) {
		content.push({
			type: 'image_url',
			image_url: { url: `data:image/png;base64,${ref.toString('base64')}` },
		});
	}
	// O TEXT_LEAD fala "as imagens acima são referência" — só faz sentido quando
	// HÁ imagens. Sem refs (geração só-texto, ex.: Prompts Mágicos), mandar isso
	// é ruído confuso que pode empobrecer a composição → manda o prompt limpo.
	const userText = refs.length > 0 ? `${TEXT_LEAD}${text}` : text;
	content.push({ type: 'text', text: userText });
	const body = {
		model,
		// temperature omitido: Gemini image preview não documenta suporte a
		// temperature; passar params desconhecidos pode 400. O system prompt
		// + a reordenação (texto por último) são os levers de aderência.
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content },
		],
		modalities: ['image', 'text'],
	};

	if (process.env.DEBUG_IMAGE_GEN) {
		// Não loga o prompt cheio (IP do admin); só metadados pra debugar
		// "não seguiu o prompt" sem vazar curadoria.
		console.debug('[image-gen] calling OpenRouter', {
			model,
			promptLen: text.length,
			refs: refs.length,
			hasSystem: true,
			modelOverride: !!opts?.model,
			systemOverride:
				!!opts?.systemPromptOverride &&
				opts.systemPromptOverride.trim().length > 0,
		});
	}

	let result: string | null = null;
	try {
		const completion = await openrouter.chat.completions.create(
			// biome-ignore lint/suspicious/noExplicitAny: body multimodal + modalities fora do tipo do SDK
			body as any,
			{
				signal: combined,
				headers: {
					'HTTP-Referer':
						process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
					'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Prompts Mágicos`,
				},
			},
		);
		// OpenRouter pode responder HTTP 200 com `{ error }` e SEM `choices`
		// (ex.: "Provider returned an empty response", refusa de moderação,
		// modelo indisponível). Tratar como erro LIMPO — sem isso, `choices[0]`
		// quebra com "Cannot read properties of undefined (reading '0')".
		const errBody = (completion as unknown as { error?: { message?: string } })
			.error;
		if (errBody) {
			throw new ToolEngineError(
				502,
				`O modelo não gerou imagem: ${errBody.message ?? 'provedor retornou erro'}. Tente outro modelo ou ajuste o tema.`,
			);
		}
		const message = completion.choices?.[0]?.message as
			| GeminiImageMessage
			| undefined;

		// 0. campo images (Gemini via OpenRouter)
		if (message?.images && message.images.length > 0) {
			const imageData = message.images[0];
			if (imageData.image_url && typeof imageData.image_url === 'object') {
				result = (imageData.image_url as { url: string }).url;
			} else if (typeof imageData.image_url === 'string') {
				result = imageData.image_url;
			}
		}
		// 1. fallback: markdown / URL no content
		if (!result && message?.content) {
			const md = message.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
			if (md?.[1]) result = await downloadAsDataUrl(md[1], combined);
			if (!result) {
				const url = message.content.match(
					/(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|gif|webp))/i,
				);
				if (url?.[1]) result = await downloadAsDataUrl(url[1], combined);
			}
		}
		if (!result) {
			const hint = message?.content
				? ` (${message.content.slice(0, 160)})`
				: '';
			throw new ToolEngineError(
				502,
				`O modelo não gerou imagem${hint}. Ajuste o tema.`,
			);
		}
	} catch (err: unknown) {
		if (err instanceof ToolEngineError) throw err;
		const e = err as {
			status?: number;
			code?: number;
			name?: string;
			message?: string;
		};
		if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
			throw new ToolEngineError(504, 'Tempo esgotado na geração da imagem.');
		}
		if (e?.status === 429 || e?.code === 429) {
			throw new ToolEngineError(
				429,
				'Limite de requisições. Tente em alguns segundos.',
			);
		}
		throw new ToolEngineError(
			502,
			`Erro na geração de imagem (${e?.status ?? '?'}): ${e?.message ?? 'falha'}`,
		);
	}

	// `result` é data URL, http (baixa) ou base64 puro → normaliza pra PNG.
	let decoded: Buffer;
	if (result.startsWith('data:')) {
		const m = result.match(/^data:[^;]+;base64,(.+)$/);
		decoded = Buffer.from(m ? m[1] : '', 'base64');
	} else if (result.startsWith('http')) {
		const dataUrl = await downloadAsDataUrl(result, combined);
		const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
		decoded = Buffer.from(m ? m[1] : '', 'base64');
	} else {
		decoded = Buffer.from(result, 'base64');
	}
	if (decoded.byteLength === 0) {
		throw new ToolEngineError(502, 'Imagem gerada vazia.');
	}
	if (decoded.byteLength > MAX_OUTPUT_BYTES) {
		throw new ToolEngineError(502, 'Imagem gerada grande demais.');
	}

	// Redimensiona pro tamanho EXATO pedido (gravação a laser precisa ser exata).
	// `fit: 'cover'` dá W×H exato cortando o excedente (centralizado) em vez de
	// esticar — o modelo nem sempre respeita a proporção pedida no prompt, e
	// `fill` distorcia a imagem inteira nesse caso.
	let sharpPipe = sharp(decoded);
	if (outW && outH) {
		sharpPipe = sharpPipe.resize(outW, outH, {
			fit: 'cover',
			position: 'centre',
		});
	}
	const png = await sharpPipe.png().toBuffer();
	const pngBase64 = `data:image/png;base64,${png.toString('base64')}`;
	return { png, pngBase64 };
}
