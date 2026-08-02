import type { FastifyReply, FastifyRequest } from 'fastify';
import { incrWithTtl } from '../lib/redis.js';
import { loadPublishedToolDefinition } from '../lib/tool-definitions.js';
import { aiTextBlock } from '../tool-blocks/blocks/ai-text.js';

/**
 * `POST /api/image-studio/enhance` — reescreve o prompt do aluno num prompt bom.
 *
 * REGRA CENTRAL: um enhancer que quebra a geração é pior do que não ter
 * enhancer. Por isso TODO caminho de erro (IA fora do ar, JSON inválido, tool
 * sem definition, Redis caído, timeout) devolve `{enhanced: prompt}` — o texto
 * original, intacto. A tela chama, e no pior caso nada muda.
 *
 * Grátis: 1 turno de LLM barato não justifica montar invocação, débito e
 * liquidação. O que impede abuso é o teto por hora, não a cobrança.
 */

const TOOL_KEY = 'estudio_imagens';
/** Teto por cliente/hora. `incrWithTtl` é fail-open (−1 sem Redis). */
const MAX_PER_HOUR = 30;
const WINDOW_SECONDS = 3600;

const MAX_PROMPT_CHARS = 4_000;
/** Cauda de prompt não é redação: passar disso é o modelo divagando. */
const MAX_ENHANCED_CHARS = 1_200;
const MAX_SUGGESTION_CHARS = 240;

/**
 * PROIBIÇÕES DO MODO `vetorizavel`. Aquele modo termina em
 * `threshold(128)` — preto puro ou branco puro, nada entre os dois. Um prompt
 * que peça "sombra suave" ou "fotorrealista" não produz uma imagem ruim: produz
 * uma imagem que o threshold destrói, e o aluno paga por ela.
 *
 * Vale para o PROMPT (a instrução proíbe) e para o RETORNO (o filtro remove).
 * Só a instrução não basta — modelo de texto contraria instrução negativa com
 * frequência, e aqui a consequência é uma geração paga jogada fora.
 */
const BANNED_VECTOR_TERMS = [
	'gradiente',
	'gradient',
	'degrade',
	'degradê',
	'sombra',
	'sombreamento',
	'sombreado',
	'shadow',
	'shading',
	'fotorrealista',
	'fotorealista',
	'fotorrealismo',
	'photorealistic',
	'photo-realistic',
	'realismo fotográfico',
	'meio-tom',
	'meio tom',
	'halftone',
	'volumetric',
	'volumétrica',
];

/** Comparação sem acento e sem caixa (o modelo escreve "degradê" e "degrade"). */
function fold(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

function hasBanned(text: string): boolean {
	const f = fold(text);
	return BANNED_VECTOR_TERMS.some((t) => f.includes(fold(t)));
}

/**
 * Remove os TRECHOS proibidos em vez do texto inteiro: o modelo costuma
 * escrever um prompt bom e enfiar "com sombreamento suave" no meio. Jogar tudo
 * fora por causa de uma oração perderia o resto, que era útil.
 *
 * Corta em vírgula/ponto-e-vírgula/quebra de linha porque é assim que prompt de
 * imagem se organiza (uma qualidade por cláusula). Se sobrar pouco demais, quem
 * chama cai no prompt original.
 */
export function stripBannedTerms(text: string): string {
	return text
		.split(/([,;\n]+)/)
		.filter((part, i) => i % 2 === 1 || !hasBanned(part))
		.join('')
		.replace(/\s*([,;])\s*([,;])+/g, '$1 ')
		.replace(/^[\s,;]+|[\s,;]+$/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

const SYSTEM = [
	'Você reescreve descrições curtas em prompts de geração de imagem para arte de corte e gravação a laser.',
	'Responda SEMPRE em português do Brasil e SEMPRE em JSON válido, no formato {"enhanced": "...", "suggestions": ["...","...","..."]}.',
	'"enhanced" é a MESMA ideia do aluno, escrita melhor: assunto, composição, enquadramento, estilo de traço e nível de detalhe. Nunca troque o assunto por outro.',
	'"suggestions" são 3 variações CURTAS (até 12 palavras) que levariam a arte para direções diferentes.',
	'Nada de preâmbulo, nada de explicação, nada de markdown.',
].join('\n');

/** Regra extra do modo vetorizável, anexada ao system prompt. */
const VECTOR_RULE = [
	'ESTE PROMPT VAI GERAR ARTE VETORIZÁVEL: preto puro sobre branco puro, sem meio-tom.',
	'É PROIBIDO citar gradiente, degradê, sombra, sombreamento, iluminação volumétrica, fotorrealismo ou qualquer efeito de profundidade tonal.',
	'Prefira: traço fechado, contorno contínuo, silhueta legível, contraste chapado, formas sólidas.',
].join(' ');

export interface EnhanceResult {
	enhanced: string;
	suggestions: string[];
	/** `true` quando o teto por hora bateu — a tela avisa em vez de mentir. */
	limited?: boolean;
}

interface EnhanceBody {
	prompt?: string;
	mode?: string;
}

export interface ImageStudioDeps {
	incr: typeof incrWithTtl;
	loadDefinition: typeof loadPublishedToolDefinition;
	runText: typeof aiTextBlock.run;
}

const defaultDeps: ImageStudioDeps = {
	incr: incrWithTtl,
	loadDefinition: loadPublishedToolDefinition,
	runText: (ctx, params) => aiTextBlock.run(ctx, params),
};

export function makeImageStudioControllers(
	deps: ImageStudioDeps = defaultDeps,
) {
	const enhancePromptController = async (
		request: FastifyRequest<{ Body?: EnhanceBody }>,
		reply: FastifyReply,
	) => {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		const prompt = (request.body?.prompt ?? '')
			.slice(0, MAX_PROMPT_CHARS)
			.trim();
		const mode = request.body?.mode ?? '';
		const vectorMode = mode === 'vetorizavel';

		// Identidade: o que devolvemos em QUALQUER falha.
		const passthrough: EnhanceResult = { enhanced: prompt, suggestions: [] };
		if (!prompt) return reply.status(200).send(passthrough);

		const used = await deps.incr(
			`studio:enhance:${customerId}`,
			WINDOW_SECONDS,
		);
		if (used > 0 && used > MAX_PER_HOUR) {
			return reply.status(200).send({ ...passthrough, limited: true });
		}

		try {
			// Modelo escolhido pelo admin na Fábrica. A definition pode nem existir
			// (tool ainda em rascunho) — daí o try próprio: sem modelo o bloco cai
			// no padrão do catálogo, que é exatamente o que queremos.
			let model: string | undefined;
			try {
				const def = await deps.loadDefinition(
					TOOL_KEY,
					customerId,
					request.headers.authorization,
				);
				const doc = def.definition as { text_model?: string };
				model = doc?.text_model;
			} catch {
				model = undefined;
			}

			const out = await deps.runText(
				{ customerId, authHeader: request.headers.authorization },
				aiTextBlock.paramsSchema.parse({
					system: vectorMode ? `${SYSTEM}\n${VECTOR_RULE}` : SYSTEM,
					user: [
						`Modo escolhido: ${mode || 'texto_imagem'}.`,
						`Descrição do aluno: ${prompt}`,
					].join('\n'),
					model,
					json: true,
					temperature: 0.6,
					max_tokens: 700,
				}),
			);

			const json = (out.json ?? {}) as {
				enhanced?: unknown;
				suggestions?: unknown;
			};

			let enhanced =
				typeof json.enhanced === 'string' ? json.enhanced.trim() : '';
			if (vectorMode && enhanced) enhanced = stripBannedTerms(enhanced);
			// Sobrou uma frase solta depois do filtro? O prompt do aluno é melhor
			// do que um prompt mutilado.
			if (enhanced.length < 8) enhanced = prompt;
			enhanced = enhanced.slice(0, MAX_ENHANCED_CHARS);

			const suggestions = (
				Array.isArray(json.suggestions) ? json.suggestions : []
			)
				.filter((s): s is string => typeof s === 'string')
				.map((s) => (vectorMode ? stripBannedTerms(s) : s.trim()))
				.filter((s) => s.length >= 3)
				.slice(0, 3)
				.map((s) => s.slice(0, MAX_SUGGESTION_CHARS));

			return reply.status(200).send({ enhanced, suggestions });
		} catch (err) {
			console.error(
				'[image-studio/enhance] falhou (devolvendo o prompt original):',
				err instanceof Error ? err.message : err,
			);
			return reply.status(200).send(passthrough);
		}
	};

	return { enhancePromptController };
}

export const { enhancePromptController } = makeImageStudioControllers();
