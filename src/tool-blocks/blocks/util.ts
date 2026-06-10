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
 * Resíduo conhecido (TOCTOU/DNS-rebinding): validamos o IP resolvido mas o fetch
 * resolve de novo. Mitigado por: allowlist OBRIGATÓRIA quando ligado (fail
 * closed), redirect:manual e checagem de IP (v4+v6 mapeado/comprimido). Fechar
 * 100% pede pinar o IP validado no fetch (dispatcher undici) — follow-up. */

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

function isBlockedV4(ip: string): boolean {
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

/** Expande um IPv6 (com `::` e/ou cauda IPv4 dotted) nos 8 hextets numéricos. */
function parseV6(ip: string): number[] | null {
	let s = ip.toLowerCase();
	// cauda IPv4 (mapeado/compat dotted, ex.: ::ffff:127.0.0.1) → dois hextets hex
	const dotted = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (dotted) {
		const o = [
			Number(dotted[2]),
			Number(dotted[3]),
			Number(dotted[4]),
			Number(dotted[5]),
		];
		if (o.some((x) => x > 255)) return null;
		s = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
	}
	const halves = s.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail =
		halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
	let groups: string[];
	if (tail === null) {
		groups = head;
	} else {
		const fill = 8 - head.length - tail.length;
		if (fill < 0) return null;
		groups = [...head, ...Array(fill).fill('0'), ...tail];
	}
	if (groups.length !== 8) return null;
	const nums = groups.map((g) => Number.parseInt(g || '0', 16));
	if (nums.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff)) return null;
	return nums;
}

const v4FromHextets = (a: number, b: number): string =>
	`${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;

function isBlockedV6(ip: string): boolean {
	const h = parseV6(ip);
	if (!h) return true; // não parseou → bloqueia (fail closed)
	const zeroHi =
		h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
	// ::1 (loopback) / :: (não especificado)
	if (zeroHi && h[5] === 0 && h[6] === 0 && (h[7] === 0 || h[7] === 1))
		return true;
	// ::ffff:0:0/96 (IPv4-mapeado) → checa o v4 embutido (também forma hex)
	if (zeroHi && h[5] === 0xffff) return isBlockedV4(v4FromHextets(h[6], h[7]));
	// ::/96 (IPv4-compat, depreciado) → v4
	if (zeroHi && h[5] === 0 && !(h[6] === 0 && h[7] <= 1))
		return isBlockedV4(v4FromHextets(h[6], h[7]));
	// 64:ff9b::/96 (NAT64) → v4
	if (
		h[0] === 0x64 &&
		h[1] === 0xff9b &&
		h[2] === 0 &&
		h[3] === 0 &&
		h[4] === 0 &&
		h[5] === 0
	)
		return isBlockedV4(v4FromHextets(h[6], h[7]));
	if ((h[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
	if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
	if ((h[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
	return false;
}

/** IP reservado/privado que NÃO deve ser alvo (anti-SSRF). Exportado p/ teste. */
export function isBlockedIp(ip: string): boolean {
	const v = isIP(ip);
	if (v === 4) return isBlockedV4(ip);
	if (v === 6) return isBlockedV6(ip);
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
	// literais IPv6 vêm com colchetes em url.hostname ([::1]) — tira pra isIP ver.
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
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
		// Fail closed: ligado sem allowlist seria internet aberta + só a checagem
		// de IP (racy) — exige allowlist explícita.
		if (HTTP_ALLOWLIST.length === 0) {
			throw new ToolEngineError(
				403,
				'util.http_request exige uma allowlist (TOOL_HTTP_ALLOW_HOSTS).',
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
