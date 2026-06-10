import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos GENÉRICOS (categoria `util`) — peças versáteis que o usuário compõe no
 * canvas pra montar "qualquer coisa" sem o motor aceitar código arbitrário. Como
 * todo bloco, são fronteira de segurança: params validados por Zod, saídas
 * simples. Os params chegam JÁ resolvidos (refs `input.x`/`<nó>.campo` trocadas
 * pelos valores reais) — então aqui são apenas valores.
 */

const asText = (v: unknown): string =>
	v === undefined || v === null
		? ''
		: typeof v === 'string'
			? v
			: typeof v === 'object'
				? JSON.stringify(v)
				: String(v);

/* ───────────────────────── util.text_template ─────────────────────────
 * Interpola um texto com até 4 entradas (`{{a}}`..`{{d}}`). Use pra compor
 * mensagens, corpos de requisição, legendas, etc. Saída: `{ text }`. */

const textTemplateSchema = z.object({
	template: z.string().max(20_000).default(''),
	a: z.unknown().optional(),
	b: z.unknown().optional(),
	c: z.unknown().optional(),
	d: z.unknown().optional(),
});

export const textTemplateBlock: ToolBlock<z.infer<typeof textTemplateSchema>> =
	{
		id: 'util.text_template',
		category: 'util',
		description:
			'Monta um texto interpolando até 4 entradas com {{a}}..{{d}} (composição de strings).',
		paramsSchema: textTemplateSchema,
		async run(_ctx, params) {
			const vars: Record<string, string> = {
				a: asText(params.a),
				b: asText(params.b),
				c: asText(params.c),
				d: asText(params.d),
			};
			const text = params.template.replace(
				/\{\{\s*([abcd])\s*\}\}/g,
				(_m, k: string) => vars[k] ?? '',
			);
			return { text };
		},
	};

/* ───────────────────────────── util.math ──────────────────────────────
 * Aritmética básica entre dois números. Saída: `{ value }`. */

const mathSchema = z.object({
	a: z.coerce.number(),
	b: z.coerce.number(),
	op: z.enum(['+', '-', '*', '/', '%']).default('+'),
});

export const mathBlock: ToolBlock<z.infer<typeof mathSchema>> = {
	id: 'util.math',
	category: 'util',
	description: 'Calcula a (op) b com + - * / % (saída numérica).',
	paramsSchema: mathSchema,
	async run(_ctx, params) {
		const { a, b, op } = params;
		if ((op === '/' || op === '%') && b === 0) {
			throw new ToolEngineError(400, 'Divisão por zero em util.math.');
		}
		const value =
			op === '+'
				? a + b
				: op === '-'
					? a - b
					: op === '*'
						? a * b
						: op === '/'
							? a / b
							: a % b;
		if (!Number.isFinite(value)) {
			throw new ToolEngineError(400, 'Resultado inválido em util.math.');
		}
		return { value };
	},
};

/* ──────────────────────────── util.condition ──────────────────────────
 * Seleciona um de dois valores conforme um booleano. ATENÇÃO: o motor é
 * linear — ambos os ramos já foram resolvidos (é seleção de valor, não
 * execução condicional). Saída: `{ result }`. */

const truthy = (v: unknown): boolean =>
	v === true ||
	v === 1 ||
	v === '1' ||
	(typeof v === 'string' && v.trim().toLowerCase() === 'true');

const conditionSchema = z.object({
	test: z.preprocess(truthy, z.boolean()).default(false),
	ifTrue: z.unknown().optional(),
	ifFalse: z.unknown().optional(),
});

export const conditionBlock: ToolBlock<z.infer<typeof conditionSchema>> = {
	id: 'util.condition',
	category: 'util',
	description:
		'Escolhe entre dois valores conforme um sim/não (seleção, não desvio de fluxo).',
	paramsSchema: conditionSchema,
	async run(_ctx, params) {
		return { result: params.test ? params.ifTrue : params.ifFalse };
	},
};

/* ─────────────────────────── util.http_request ────────────────────────
 * Chama uma API externa. É a peça mais versátil — e a mais perigosa: superfície
 * de SSRF. Defesas: desligado por padrão (env), allowlist de hosts, bloqueio de
 * IP privado/loopback/link-local (resolvendo o DNS), sem seguir redirects,
 * timeout e teto de bytes. Saída: `{ status, body, json }`.
 *
 * Limitação conhecida (TOCTOU/DNS-rebinding): validamos o IP resolvido mas o
 * fetch resolve de novo; por isso o bloco fica atrás de flag e allowlist até a
 * revisão de segurança antes de ligar em produção. */

const HTTP_ENABLED = process.env.TOOL_HTTP_ENABLED === 'true';
const HTTP_ALLOWLIST = (process.env.TOOL_HTTP_ALLOW_HOSTS ?? '')
	.split(',')
	.map((h) => h.trim().toLowerCase())
	.filter(Boolean);
const HTTP_TIMEOUT_MS = 10_000;
const HTTP_MAX_BYTES = 5 * 1_024 * 1_024;

function ip4ToInt(ip: string): number {
	const p = ip.split('.').map(Number);
	return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inRange4(ip: number, base: string, bits: number): boolean {
	const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
	return (ip & mask) === (ip4ToInt(base) & mask);
}

/** IP reservado/privado que NÃO deve ser alvo (anti-SSRF). */
function isBlockedIp(ip: string): boolean {
	const v = isIP(ip);
	if (v === 4) {
		const n = ip4ToInt(ip);
		return (
			inRange4(n, '0.0.0.0', 8) ||
			inRange4(n, '10.0.0.0', 8) ||
			inRange4(n, '100.64.0.0', 10) || // CGNAT
			inRange4(n, '127.0.0.0', 8) || // loopback
			inRange4(n, '169.254.0.0', 16) || // link-local
			inRange4(n, '172.16.0.0', 12) ||
			inRange4(n, '192.0.0.0', 24) ||
			inRange4(n, '192.168.0.0', 16) ||
			inRange4(n, '198.18.0.0', 15) || // benchmarking
			inRange4(n, '224.0.0.0', 4) || // multicast
			inRange4(n, '240.0.0.0', 4) // reservado
		);
	}
	if (v === 6) {
		const lc = ip.toLowerCase();
		if (lc === '::1' || lc === '::') return true;
		// IPv4 mapeado/compatível (::ffff:a.b.c.d) — checa o v4 embutido.
		const m = lc.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
		if (m && isIP(m[1]) === 4) return isBlockedIp(m[1]);
		const head = lc.split(':')[0];
		// ULA fc00::/7, link-local fe80::/10, multicast ff00::/8.
		return (
			head.startsWith('fc') ||
			head.startsWith('fd') ||
			head.startsWith('fe8') ||
			head.startsWith('fe9') ||
			head.startsWith('fea') ||
			head.startsWith('feb') ||
			head.startsWith('ff')
		);
	}
	return true; // não é IP reconhecível → bloqueia
}

async function assertSafeUrl(raw: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new ToolEngineError(400, 'URL inválida em util.http_request.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ToolEngineError(400, 'util.http_request só aceita http/https.');
	}
	const host = url.hostname.toLowerCase();
	if (HTTP_ALLOWLIST.length > 0 && !HTTP_ALLOWLIST.includes(host)) {
		throw new ToolEngineError(403, `Host não permitido: ${host}.`);
	}
	// Resolve TODOS os endereços e barra se QUALQUER um for reservado/privado.
	const addrs =
		isIP(host) > 0 ? [{ address: host }] : await lookup(host, { all: true });
	for (const a of addrs) {
		if (isBlockedIp(a.address)) {
			throw new ToolEngineError(403, `Destino bloqueado (rede interna).`);
		}
	}
	return url;
}

const httpRequestSchema = z.object({
	url: z.string().min(1),
	method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
	headers: z
		.preprocess(
			(v) => {
				if (typeof v !== 'string') return v;
				try {
					return JSON.parse(v);
				} catch {
					return {};
				}
			},
			z.record(z.string(), z.string()),
		)
		.default({}),
	body: z.string().optional(),
});

export const httpRequestBlock: ToolBlock<z.infer<typeof httpRequestSchema>> = {
	id: 'util.http_request',
	category: 'util',
	description:
		'Chama uma API externa (GET/POST/…). Saídas: status, body, json. Requer liberação de segurança.',
	paramsSchema: httpRequestSchema,
	async run(_ctx, params) {
		if (!HTTP_ENABLED) {
			throw new ToolEngineError(
				403,
				'Bloco util.http_request desabilitado neste ambiente.',
			);
		}
		const url = await assertSafeUrl(params.url);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
		try {
			const hasBody = params.method !== 'GET' && params.body !== undefined;
			const res = await fetch(url, {
				method: params.method,
				headers: params.headers,
				body: hasBody ? params.body : undefined,
				redirect: 'manual', // não seguir redirect (evita bypass do SSRF)
				signal: controller.signal,
			});
			// Lê o corpo com teto de bytes (evita exaustão de memória).
			const reader = res.body?.getReader();
			const chunks: Uint8Array[] = [];
			let total = 0;
			if (reader) {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) {
						total += value.byteLength;
						if (total > HTTP_MAX_BYTES) {
							await reader.cancel();
							throw new ToolEngineError(
								400,
								'Resposta grande demais em util.http_request.',
							);
						}
						chunks.push(value);
					}
				}
			}
			const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString(
				'utf8',
			);
			let json = '';
			try {
				json = JSON.stringify(JSON.parse(text));
			} catch {
				json = '';
			}
			return { status: res.status, body: text, json };
		} catch (err) {
			if (err instanceof ToolEngineError) throw err;
			if (err instanceof Error && err.name === 'AbortError') {
				throw new ToolEngineError(504, 'Tempo esgotado em util.http_request.');
			}
			throw new ToolEngineError(
				502,
				`Falha na requisição: ${err instanceof Error ? err.message : 'erro'}.`,
			);
		} finally {
			clearTimeout(timer);
		}
	},
};
