import sharp from 'sharp';
import {
	findImageModel,
	getDefaultImageModelId,
	type ImageModelEntry,
} from './image-models-catalog.js';
import { type GeminiImageMessage, openrouter } from './openrouter.js';
import { ToolEngineError } from './tool-errors.js';

/**
 * Geração de imagem (texto→imagem) para a Fábrica de Tools — reusa o MESMO
 * cliente OpenRouter + o parser de resposta do `editor-ai`/`previa` (Gemini
 * image), que já roda em produção. Devolve a imagem normalizada em PNG (buffer
 * + data URL pra preview). Modelo configurável por env, com default no já usado.
 */

/**
 * Qual modelo uma geração VAI de fato usar, dado (ou não) o override da tool.
 * Exportado para quem precisa REGISTRAR a escolha — a galeria do Estúdio grava
 * o modelo de cada imagem, e gravar `null` quando o admin não escolheu nada
 * seria arquivar uma informação falsa: alguma coisa gerou aquela imagem.
 *
 * Default vem do catálogo (`getDefaultImageModelId`) — única fonte de verdade;
 * antes havia uma constante hardcoded separada que só coincidia com o
 * `default:true` do catálogo por manutenção manual.
 */
export function resolveImageModel(override?: string): string {
	const trimmed = override?.trim();
	if (trimmed) return trimmed;
	const envOverride = process.env.OPENROUTER_IMAGE_MODEL?.trim();
	if (envOverride) return envOverride;
	return getDefaultImageModelId();
}
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

/** `"21:9"` → `21/9`. Presets sempre vêm como `"W:H"` (nunca `"auto"` aqui —
 * chamador filtra antes). */
function parseAspectRatioPreset(preset: string): number {
	const [w, h] = preset.split(':').map(Number);
	return w / h;
}

/**
 * Preset de `aspect_ratio` mais próximo do alvo W×H, entre os aceitos por
 * ESTE modelo especificamente (cada modelo do catálogo tem um conjunto
 * diferente — ex.: `gemini-3.1-flash-image` vai até 8:1, os demais só 21:9).
 * Distância em escala log — trata 2:1 e 1:2 simetricamente (distância linear
 * puxaria proporções extremas pro preset errado).
 */
export function nearestAspectRatioPreset(
	w: number,
	h: number,
	allowed: readonly string[],
): string | undefined {
	const candidates = allowed.filter((p) => p !== 'auto');
	if (candidates.length === 0) return undefined;
	const target = Math.log(w / h);
	let best = candidates[0];
	let bestDelta = Number.POSITIVE_INFINITY;
	for (const preset of candidates) {
		const delta = Math.abs(target - Math.log(parseAspectRatioPreset(preset)));
		if (delta < bestDelta) {
			bestDelta = delta;
			best = preset;
		}
	}
	return best;
}

/** Maior `resolution` aceito pelo modelo (prioriza nitidez). */
const RESOLUTION_PRIORITY = ['4K', '2K', '1K', '512'];
function bestResolution(allowed?: readonly string[]): string | undefined {
	if (!allowed?.length) return undefined;
	return RESOLUTION_PRIORITY.find((r) => allowed.includes(r));
}

/** `quality:'high'` quando o modelo aceita — senão omite (deixa o provider
 * decidir; nunca pedimos um tier pior que o que já pedíamos, que era nenhum). */
function bestQuality(allowed?: readonly string[]): string | undefined {
	return allowed?.includes('high') ? 'high' : undefined;
}

interface UnifiedImagesResponse {
	success?: boolean;
	error?: { message?: string };
	data?: Array<{ b64_json?: string; media_type?: string }>;
}

/**
 * Gera via o endpoint dedicado `POST /v1/images` da OpenRouter (Unified Image
 * API), em vez do `/chat/completions` legado. Só é chamado quando o modelo
 * tem `unifiedImagesApi:true` no catálogo (confirmado empiricamente pra todo
 * o catálogo atual em 2026-08-01 — ver comentário em `image-models-catalog.ts`).
 *
 * Por que isso resolve o corte/qualidade: diferente do `/chat/completions`
 * (que só aceita um texto de instrução de formato, sem parâmetro real), esse
 * endpoint aceita `aspect_ratio`/`resolution` de verdade pra família Gemini
 * (testado: pedir 16:9 devolveu 1344×768 — genuinamente widescreen, não
 * quadrado cortado depois; pedir 4K devolveu 5504×3072, bem acima do teto de
 * ~1536px que o `/chat/completions` entregava por padrão) e `quality` de
 * verdade pra família GPT (que não aceita aspect_ratio/resolution em NENHUMA
 * API da OpenAI pra geração via texto — só o prompt influencia a composição
 * nesse caso). Imagens de referência vão em `input_references`, mesmo formato
 * de content-part já usado no `/chat/completions` (`{type:'image_url',
 * image_url:{url}}`), confirmado aceito em teste real.
 */
async function generateViaUnifiedImagesApi(opts: {
	model: string;
	prompt: string;
	refs: Buffer[];
	signal: AbortSignal;
	entry: ImageModelEntry;
	outW?: number;
	outH?: number;
}): Promise<Buffer> {
	const { model, prompt, refs, signal, entry, outW, outH } = opts;
	const body: Record<string, unknown> = {
		model,
		prompt,
		output_format: 'png',
	};
	if (outW && outH && entry.apiAspectRatios?.length) {
		body.aspect_ratio = nearestAspectRatioPreset(
			outW,
			outH,
			entry.apiAspectRatios,
		);
	}
	const resolution = bestResolution(entry.apiResolutions);
	if (resolution) body.resolution = resolution;
	const quality = bestQuality(entry.apiQuality);
	if (quality) body.quality = quality;
	if (refs.length > 0) {
		body.input_references = refs.map((ref) => ({
			type: 'image_url',
			image_url: { url: `data:image/png;base64,${ref.toString('base64')}` },
		}));
	}

	if (process.env.DEBUG_IMAGE_GEN) {
		console.debug('[image-gen] calling OpenRouter /v1/images', {
			model,
			promptLen: prompt.length,
			refs: refs.length,
			aspectRatio: body.aspect_ratio,
			resolution: body.resolution,
			quality: body.quality,
		});
	}

	let res: Response;
	try {
		res = await fetch('https://openrouter.ai/api/v1/images', {
			method: 'POST',
			signal,
			headers: {
				Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
				'Content-Type': 'application/json',
				'HTTP-Referer':
					process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
				'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Prompts Mágicos`,
			},
			body: JSON.stringify(body),
		});
	} catch (err: unknown) {
		const e = err as { name?: string; message?: string };
		if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
			throw new ToolEngineError(504, 'Tempo esgotado na geração da imagem.');
		}
		throw new ToolEngineError(
			502,
			`Erro na geração de imagem: ${e?.message ?? 'falha de rede'}`,
		);
	}

	let payload: UnifiedImagesResponse;
	try {
		payload = (await res.json()) as UnifiedImagesResponse;
	} catch {
		throw new ToolEngineError(502, 'Resposta inválida da geração de imagem.');
	}
	if (!res.ok || payload.success === false) {
		if (res.status === 429) {
			throw new ToolEngineError(
				429,
				'Limite de requisições. Tente em alguns segundos.',
			);
		}
		throw new ToolEngineError(
			502,
			`O modelo não gerou imagem: ${payload.error?.message ?? `provedor retornou ${res.status}`}. Tente outro modelo ou ajuste o tema.`,
		);
	}
	const b64 = payload.data?.[0]?.b64_json;
	if (!b64) {
		throw new ToolEngineError(502, 'O modelo não gerou imagem. Ajuste o tema.');
	}
	const decoded = Buffer.from(b64, 'base64');
	if (decoded.byteLength === 0) {
		throw new ToolEngineError(502, 'Imagem gerada vazia.');
	}
	if (decoded.byteLength > MAX_OUTPUT_BYTES) {
		throw new ToolEngineError(502, 'Imagem gerada grande demais.');
	}
	return decoded;
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
 * na Fábrica). Se ausente, usa o `default:true` do catálogo (ou
 * `OPENROUTER_IMAGE_MODEL` do env, se setado).
 *
 * `opts.systemPromptOverride` — substitui o system prompt laser padrão
 * (decisão: replace total). Se ausente/vazio, usa `DEFAULT_IMAGE_SYSTEM_PROMPT`.
 * Só se aplica no `/chat/completions` (ver `opts.rawPrompt` abaixo).
 *
 * `opts.rawPrompt` — quando true, manda SÓ a user message ao modelo: SEM system
 * prompt e SEM `TEXT_LEAD` (prefixo de refs). O sufixo `FORMATO OBRIGATÓRIO` de
 * dimensão CONTINUA sendo adicionado (é spec de formato, não intermediação de
 * estilo — vale pra todo modo). Além disso, se o modelo resolvido tiver
 * `unifiedImagesApi:true` no catálogo, a geração roteia pro endpoint dedicado
 * `POST /v1/images` da OpenRouter em vez do `/chat/completions`, o que dá
 * `aspect_ratio`/`resolution` REAIS (família Gemini) ou `quality` real
 * (família GPT) — não só uma instrução de texto. Escopado por tool (Prompts
 * Mágicos curados) — ai-extra não passa a flag e mantém o default.
 *
 * `opts.fit` — estratégia do sharp resize final (sempre roda, em ambas as
 * rotas, pra garantir o pixel exato pedido): `'fill'` (default, legado —
 * distorce pro W×H exato) ou `'cover'` (crop sem distorção — usado com
 * `rawPrompt`; agora que o modelo recebe um hint real de proporção na maioria
 * dos casos, só precisa aparar uma sobra pequena, não corrigir um quadrado
 * bruto).
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
		rawPrompt?: boolean;
		fit?: 'fill' | 'cover' | 'contain';
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

	// Dimensões EXATAS (arte de gravação a laser): passa a proporção pro modelo
	// no prompt (ele compõe PRAQUELE formato) e o tamanho exato é garantido no
	// pós (sharp resize). Sem este sufixo, o modelo gera ~quadrado e o sharp
	// `fit:'cover'` CORTA conteúdo pra encaixar — por isso o sufixo vale até no
	// `rawPrompt` (a dimensão é spec de formato, não intermediação de estilo).
	// `rawPrompt` continua sem system prompt e sem TEXT_LEAD; só este sufixo de
	// dimensão é adicionado ao prompt do admin.
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

	const model = resolveImageModel(opts?.model);
	const modelEntry = findImageModel(model);
	const timeout = AbortSignal.timeout(GEN_TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

	// `rawPrompt` + modelo com `unifiedImagesApi` (todo o catálogo atual) →
	// rota nova (`POST /v1/images`, aspect_ratio/resolution/quality reais).
	// Sem isso (tools legadas com system prompt/aderência, ou um modelo futuro
	// sem a flag), mantém o `/chat/completions` de sempre — essa rota depende
	// de mensagens system/user com ordenação específica que não existe na API
	// nova (prompt único), então não vale a pena migrar esse caso agora.
	const useUnifiedImagesApi =
		!!opts?.rawPrompt && !!modelEntry?.unifiedImagesApi;

	let decoded: Buffer;
	if (useUnifiedImagesApi) {
		decoded = await generateViaUnifiedImagesApi({
			model,
			prompt: text,
			refs,
			signal: combined,
			// biome-ignore lint/style/noNonNullAssertion: useUnifiedImagesApi já checou modelEntry
			entry: modelEntry!,
			outW,
			outH,
		});
	} else {
		// `rawPrompt`: sem intermediação — só a user message. ai-extra não passa a
		// flag e continua com o system prompt laser padrão.
		const useSystem = !opts?.rawPrompt;
		const systemPrompt = useSystem
			? buildImageSystemPrompt(opts?.systemPromptOverride)
			: null;

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
		// `rawPrompt` pula o LEAD mesmo com refs — o prompt definido vai cru ao modelo.
		const userText =
			!opts?.rawPrompt && refs.length > 0 ? `${TEXT_LEAD}${text}` : text;
		content.push({ type: 'text', text: userText });
		const body = {
			model,
			// temperature omitido: Gemini image preview não documenta suporte a
			// temperature; passar params desconhecidos pode 400. O system prompt
			// + a reordenação (texto por último) são os levers de aderência.
			messages: [
				...(useSystem
					? [{ role: 'system' as const, content: systemPrompt }]
					: []),
				{ role: 'user' as const, content },
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
				hasSystem: useSystem,
				rawPrompt: !!opts?.rawPrompt,
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
			const errBody = (
				completion as unknown as { error?: { message?: string } }
			).error;
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
	}

	// Observabilidade (sem mudar comportamento): se a saída nativa do modelo
	// já vem MUITO diferente do alvo, o resize abaixo vai cortar/distorcer uma
	// fração grande da imagem — provavelmente o modelo ignorou o aspect_ratio
	// real (useUnifiedImagesApi) ou o sufixo de texto (`/chat/completions`).
	// Log, não exceção: a imagem ainda sai no tamanho exato pedido, só pode
	// ter perdido mais conteúdo nas bordas do que o esperado.
	if (outW && outH) {
		const meta = await sharp(decoded).metadata();
		if (meta.width && meta.height) {
			const deviation = Math.abs(
				Math.log(meta.width / meta.height) - Math.log(outW / outH),
			);
			if (deviation > 0.35) {
				console.warn(
					'[image-gen] saída nativa muito diferente do alvo — corte/distorção acima do normal',
					{
						model,
						useUnifiedImagesApi,
						nativeW: meta.width,
						nativeH: meta.height,
						outW,
						outH,
						deviation: Number(deviation.toFixed(3)),
					},
				);
			}
		}
	}

	// Redimensiona pro tamanho EXATO pedido (gravação a laser precisa ser exata).
	// `fit: 'cover'` dá W×H exato cortando o excedente (centralizado) em vez de
	// esticar — o modelo nem sempre respeita a proporção pedida no prompt, e
	// `fill` distorcia a imagem inteira nesse caso (fix já em dev, `45fc330`).
	// `opts?.fit` continua como escape hatch caso algum caller precise de outro
	// modo, mas o default seguro agora é `cover`. Com `useUnifiedImagesApi` o
	// modelo já recebe `aspect_ratio` real (ou, na falta dele, o sufixo de
	// texto), então `cover` normalmente só apara uma sobra pequena — não mais
	// corrige um quadrado bruto contra um alvo bem diferente.
	let sharpPipe = sharp(decoded);
	if (outW && outH) {
		sharpPipe = sharpPipe.resize(outW, outH, {
			fit: opts?.fit ?? 'cover',
			position: 'centre',
		});
	}
	const png = await sharpPipe.png().toBuffer();
	const pngBase64 = `data:image/png;base64,${png.toString('base64')}`;
	return { png, pngBase64 };
}
