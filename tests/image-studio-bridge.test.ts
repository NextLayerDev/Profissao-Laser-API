import { type FastifyInstance, fastify } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.hoisted` roda ANTES dos imports do módulo — é o único jeito de plantar as
 * envs que `lib/supabase`, `lib/upvox-tools` e o CDN validam no topo do próprio
 * arquivo. Nenhuma delas é usada de verdade: todo acesso externo entra por
 * injeção de dependência.
 */
vi.hoisted(() => {
	process.env.SUPABASE_URL ??= 'https://supabase.test';
	process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'chave-de-teste';
	process.env.UPVOX_SUPABASE_URL ??= 'https://upvox-db.test';
	process.env.UPVOX_SUPABASE_SERVICE_ROLE_KEY ??= 'chave-de-teste';
	process.env.EXTERNAL_API_URL ??= 'https://upvox.test';
	process.env.BUNNY_CDN_HOSTNAME = 'cdn.profissaolaser.test';
});

/**
 * A PONTE GALERIA → VETORIZAÇÃO e o ENHANCER DE PROMPT — os testes das defesas.
 *
 * O foco é o que dá errado de verdade: imagem de outra pessoa (IDOR), URL
 * apontando para fora do nosso storage (SSRF), estorno quando o Potrace falha,
 * e o enhancer devolvendo o prompt original em vez de derrubar a tela.
 *
 * Tudo entra por injeção de dependência (`makeImageGalleryControllers`), então
 * nenhum teste aqui fala com Supabase, Bunny, upvox ou OpenRouter.
 */

import {
	type ImageGalleryDeps,
	isStorageUrl,
	makeImageGalleryControllers,
} from '@/controllers/image-gallery.js';
import {
	type ImageStudioDeps,
	makeImageStudioControllers,
	stripBannedTerms,
} from '@/controllers/image-studio.js';
import { parseFilters } from '@/controllers/tool-collection.js';
import type { CollectionEntry } from '@/repositories/tool-collection.js';

const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRUNO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CDN = 'cdn.profissaolaser.test';

function entry(over: Partial<CollectionEntry> = {}): CollectionEntry {
	return {
		id: 'img-1',
		tool_key: 'estudio_imagens',
		collection: 'galeria',
		title: 'Coruja geométrica',
		description: null,
		category: null,
		position: 0,
		active: true,
		status: 'approved',
		review_note: null,
		owner_id: ANA,
		visibility: 'owner',
		score: null,
		stats: {},
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		example_before_url: null,
		example_after_url: null,
		data: {
			url: `https://${CDN}/estudio-imagens/${ANA}/img-1.png`,
			thumb_url: `https://${CDN}/estudio-imagens/${ANA}/img-1-thumb.webp`,
			modo: 'texto_imagem',
			vector_ready: false,
		},
		...over,
	};
}

interface Espiao {
	deps: ImageGalleryDeps;
	redraws: number;
	settles: string[];
	refunds: string[];
	baixados: string[];
	vetorizados: { filename: string; threshold: number }[];
	proximoVetor: { falha?: string };
}

function montaDeps(over: Partial<ImageGalleryDeps> = {}): Espiao {
	const espiao = {
		redraws: 0,
		settles: [] as string[],
		refunds: [] as string[],
		baixados: [] as string[],
		vetorizados: [] as { filename: string; threshold: number }[],
		proximoVetor: {} as { falha?: string },
	};

	const deps: ImageGalleryDeps = {
		findEntry: async (id, toolKey, collection) =>
			id === 'img-1' &&
			toolKey === 'estudio_imagens' &&
			collection === 'galeria'
				? entry()
				: id === 'img-do-bruno'
					? entry({ id: 'img-do-bruno', owner_id: BRUNO })
					: id === 'img-vetorizavel'
						? entry({
								id: 'img-vetorizavel',
								data: {
									url: `https://${CDN}/estudio-imagens/${ANA}/v.png`,
									vector_ready: true,
								},
							})
						: id === 'img-forasteira'
							? entry({
									id: 'img-forasteira',
									data: { url: 'http://169.254.169.254/latest/meta-data/' },
								})
							: null,
		download: async (url) => {
			espiao.baixados.push(url);
			return Buffer.from('png-falso');
		},
		resolveBilling: async (_c, _t, invocationId) =>
			invocationId
				? { mode: 'paid', invocationId }
				: { mode: 'reject', status: 402, message: 'billing_required' },
		settle: async (_c, id) => {
			espiao.settles.push(id);
		},
		refund: async (_c, id) => {
			espiao.refunds.push(id);
		},
		redraw: async (png) => {
			espiao.redraws++;
			return png;
		},
		vectorize: async (_customerId, input) => {
			espiao.vetorizados.push({
				filename: input.filename,
				threshold: input.params.threshold,
			});
			if (espiao.proximoVetor.falha) {
				return { data: null, error: new Error(espiao.proximoVetor.falha) };
			}
			return {
				data: { id: 'vec-1' },
				error: null,
			};
		},
		setPaidFormats: async (_id, _c, formats) => formats,
		...over,
	} as ImageGalleryDeps;

	// Devolve o MESMO objeto (com `deps` acoplado) em vez de espalhá-lo: espalhar
	// congelaria os contadores numéricos na cópia e o teste leria sempre 0.
	return Object.assign(espiao, { deps }) as unknown as Espiao;
}

/** App mínimo com o cliente autenticado que o teste escolher. */
async function montaApp(
	deps: ImageGalleryDeps,
	customerId: string | null = ANA,
): Promise<FastifyInstance> {
	const app = fastify();
	app.addHook('preHandler', async (req) => {
		if (customerId) {
			(req as { currentCustomer?: { id: string } }).currentCustomer = {
				id: customerId,
			};
		}
	});
	const c = makeImageGalleryControllers(deps);
	app.post('/api/image-gallery/:id/to-vector', c.toVectorController);
	await app.ready();
	return app;
}

function postToVector(
	app: FastifyInstance,
	id: string,
	body: Record<string, unknown> = { invocation_id: 'inv-1' },
) {
	return app.inject({
		method: 'POST',
		url: `/api/image-gallery/${id}/to-vector`,
		payload: body,
	});
}

/* ──────────────────────────── a ponte ──────────────────────────── */

describe('POST /api/image-gallery/:id/to-vector', () => {
	it('vetoriza a própria imagem: redesenha, marca os 3 formatos e liquida', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const res = await postToVector(app, 'img-1');

		expect(res.statusCode).toBe(201);
		expect(res.json()).toEqual({
			vectorId: 'vec-1',
			paidFormats: ['svg', 'png', 'dxf'],
			vectorReady: false,
		});
		expect(espiao.redraws).toBe(1);
		expect(espiao.settles).toEqual(['inv-1']);
		expect(espiao.refunds).toEqual([]);
	});

	/**
	 * IDOR — o teste que justifica a rota existir server-side. Bruno gerou a
	 * imagem; Ana tenta vetorizá-la com o id na mão. Tem que ser 404 (e não 403,
	 * que confirmaria a existência do id), e NADA pode ter sido baixado, pago ou
	 * vetorizado.
	 */
	it('não deixa um cliente vetorizar a imagem de outro (404 seco, sem cobrar)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps, ANA);

		const res = await postToVector(app, 'img-do-bruno');

		expect(res.statusCode).toBe(404);
		expect(res.json().message).toBe('Imagem não encontrada.');
		expect(espiao.baixados).toEqual([]);
		expect(espiao.vetorizados).toEqual([]);
		expect(espiao.settles).toEqual([]);
	});

	it('id inexistente responde igual a id alheio (não dá para enumerar)', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const alheia = await postToVector(app, 'img-do-bruno');
		const inexistente = await postToVector(app, 'img-que-nao-existe');

		expect(inexistente.statusCode).toBe(alheia.statusCode);
		expect(inexistente.json()).toEqual(alheia.json());
	});

	/**
	 * SSRF: a coleção `galeria` aceita submissão de aluno, então ele pode criar
	 * um registro com a URL que quiser. Sem o guard de host, o nosso servidor
	 * buscaria o metadata da nuvem por ele.
	 */
	it('recusa URL fora do nosso CDN sem sequer chamar o fetch', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const res = await postToVector(app, 'img-forasteira');

		expect(res.statusCode).toBe(400);
		expect(espiao.baixados).toEqual([]);
	});

	it('imagem do modo vetorizável pula o redesenho por IA e vai direto ao Potrace', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const res = await postToVector(app, 'img-vetorizavel');

		expect(res.statusCode).toBe(201);
		expect(res.json().vectorReady).toBe(true);
		expect(espiao.redraws).toBe(0);
		expect(espiao.vetorizados[0].threshold).toBe(128);
	});

	it('estorna quando a vetorização falha', async () => {
		const espiao = montaDeps();
		espiao.proximoVetor.falha = 'potrace explodiu';
		const app = await montaApp(espiao.deps);

		const res = await postToVector(app, 'img-1');

		expect(res.statusCode).toBe(500);
		expect(espiao.refunds).toEqual(['inv-1']);
		expect(espiao.settles).toEqual([]);
	});

	it('estorna quando o download do storage falha', async () => {
		const espiao = montaDeps({
			download: async () => {
				throw new Error('O storage respondeu 404 ao buscar a imagem.');
			},
		});
		const app = await montaApp(espiao.deps);

		const res = await postToVector(app, 'img-1');

		expect(res.statusCode).toBe(500);
		expect(espiao.refunds).toEqual(['inv-1']);
	});

	it('sem invocação numa tool cobrada responde 402 e não roda nada', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps);

		const res = await postToVector(app, 'img-1', {});

		expect(res.statusCode).toBe(402);
		expect(espiao.baixados).toEqual([]);
		expect(espiao.vetorizados).toEqual([]);
	});

	/**
	 * O composer do Estúdio cobra a tool `estudio_imagens`; a ponte cobra
	 * `vectorize`. Mandar a invocação errada é o erro mais provável desta rota —
	 * e sem o estorno o aluno ficaria com um débito pendente para sempre.
	 */
	it('estorna a invocação de outra tool em vez de deixar débito órfão', async () => {
		const espiao = montaDeps({
			resolveBilling: async () => ({
				mode: 'reject',
				status: 403,
				message: 'invalid_invocation',
			}),
		});
		const app = await montaApp(espiao.deps);

		const res = await postToVector(app, 'img-1', {
			invocation_id: 'inv-da-tool-errada',
		});

		expect(res.statusCode).toBe(403);
		expect(espiao.refunds).toEqual(['inv-da-tool-errada']);
		expect(espiao.baixados).toEqual([]);
	});

	it('sem cliente autenticado responde 403', async () => {
		const espiao = montaDeps();
		const app = await montaApp(espiao.deps, null);

		const res = await postToVector(app, 'img-1');

		expect(res.statusCode).toBe(403);
	});
});

describe('isStorageUrl', () => {
	it('aceita só https no host do CDN', () => {
		expect(isStorageUrl(`https://${CDN}/a/b.png`)).toBe(true);
		expect(isStorageUrl(`http://${CDN}/a/b.png`)).toBe(false);
		expect(isStorageUrl('https://evil.example/a.png')).toBe(false);
		expect(isStorageUrl('http://169.254.169.254/latest/meta-data/')).toBe(
			false,
		);
		expect(isStorageUrl('file:///etc/passwd')).toBe(false);
		expect(isStorageUrl('não é url')).toBe(false);
		// Truque clássico: o host real é `evil.example`, o CDN vira userinfo.
		expect(isStorageUrl(`https://${CDN}@evil.example/a.png`)).toBe(false);
	});
});

/* ──────────────────────────── o enhancer ──────────────────────────── */

function montaStudio(over: Partial<ImageStudioDeps> = {}) {
	const chamadas: { system: string; user: string; model?: string }[] = [];
	const deps: ImageStudioDeps = {
		incr: async () => 1,
		loadDefinition: (async () => ({
			definition: { text_model: 'modelo-do-admin' },
		})) as unknown as ImageStudioDeps['loadDefinition'],
		runText: (async (
			_ctx: unknown,
			p: { system: string; user: string; model?: string },
		) => {
			chamadas.push(p);
			return {
				text: '',
				json: {
					enhanced: 'coruja geométrica de traço fino, vista de frente',
					suggestions: ['coruja em linhas retas', 'coruja minimalista'],
				},
				model: 'x',
			};
		}) as unknown as ImageStudioDeps['runText'],
		...over,
	};
	return { deps, chamadas };
}

async function montaAppStudio(deps: ImageStudioDeps, customerId = ANA) {
	const app = fastify();
	app.addHook('preHandler', async (req) => {
		(req as { currentCustomer?: { id: string } }).currentCustomer = {
			id: customerId,
		};
	});
	const c = makeImageStudioControllers(deps);
	app.post('/api/image-studio/enhance', c.enhancePromptController);
	await app.ready();
	return app;
}

describe('POST /api/image-studio/enhance', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('melhora o prompt usando o modelo escolhido pelo admin', async () => {
		const { deps, chamadas } = montaStudio();
		const app = await montaAppStudio(deps);

		const res = await app.inject({
			method: 'POST',
			url: '/api/image-studio/enhance',
			payload: { prompt: 'coruja', mode: 'texto_imagem' },
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().enhanced).toContain('coruja');
		expect(res.json().suggestions).toHaveLength(2);
		expect(chamadas[0].model).toBe('modelo-do-admin');
	});

	/** O ponto que mais importa: enhancer quebrado não pode quebrar a geração. */
	it('devolve o prompt original quando a IA explode (fail-open)', async () => {
		const { deps } = montaStudio({
			runText: (async () => {
				throw new Error('openrouter caiu');
			}) as unknown as ImageStudioDeps['runText'],
		});
		const app = await montaAppStudio(deps);

		const res = await app.inject({
			method: 'POST',
			url: '/api/image-studio/enhance',
			payload: { prompt: 'coruja geométrica' },
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({
			enhanced: 'coruja geométrica',
			suggestions: [],
		});
	});

	it('devolve o prompt original quando a definition da tool não existe', async () => {
		const { deps } = montaStudio({
			loadDefinition: (async () => {
				throw new Error('tool_not_found');
			}) as unknown as ImageStudioDeps['loadDefinition'],
		});
		const app = await montaAppStudio(deps);

		const res = await app.inject({
			method: 'POST',
			url: '/api/image-studio/enhance',
			payload: { prompt: 'coruja' },
		});

		// A definition sumiu, mas o turno de IA continua rodando no modelo padrão.
		expect(res.statusCode).toBe(200);
		expect(res.json().enhanced).toContain('coruja');
	});

	it('respeita o teto de 30/h e avisa em vez de mentir', async () => {
		const { deps } = montaStudio({ incr: async () => 31 });
		const app = await montaAppStudio(deps);

		const res = await app.inject({
			method: 'POST',
			url: '/api/image-studio/enhance',
			payload: { prompt: 'coruja' },
		});

		expect(res.json()).toEqual({
			enhanced: 'coruja',
			suggestions: [],
			limited: true,
		});
	});

	it('sem Redis (incr −1) não bloqueia ninguém', async () => {
		const { deps } = montaStudio({ incr: async () => -1 });
		const app = await montaAppStudio(deps);

		const res = await app.inject({
			method: 'POST',
			url: '/api/image-studio/enhance',
			payload: { prompt: 'coruja' },
		});

		expect(res.json().limited).toBeUndefined();
		expect(res.json().suggestions.length).toBeGreaterThan(0);
	});

	/**
	 * A instrução no system prompt PEDE para não citar sombra/gradiente; este
	 * teste prova que a resposta ainda é filtrada quando o modelo desobedece —
	 * que é o caso comum com instrução negativa.
	 */
	it('no modo vetorizável, poda gradiente/sombra/fotorrealismo do retorno', async () => {
		const chamadas: { system: string }[] = [];
		const { deps } = montaStudio({
			runText: (async (_ctx: unknown, p: { system: string }) => {
				chamadas.push(p);
				return {
					text: '',
					json: {
						enhanced:
							'coruja geométrica de traço fino, com sombreamento suave, contorno contínuo, gradiente de fundo',
						suggestions: [
							'coruja fotorrealista com sombra',
							'coruja em linhas retas',
						],
					},
					model: 'x',
				};
			}) as unknown as ImageStudioDeps['runText'],
		});
		const app = await montaAppStudio(deps);

		const res = await app.inject({
			method: 'POST',
			url: '/api/image-studio/enhance',
			payload: { prompt: 'coruja', mode: 'vetorizavel' },
		});

		const body = res.json();
		expect(body.enhanced).toBe(
			'coruja geométrica de traço fino, contorno contínuo',
		);
		expect(body.suggestions).toEqual(['coruja em linhas retas']);
		// E a proibição também vai NO prompt, não só no filtro.
		expect(chamadas[0].system).toContain('PROIBIDO');
	});

	it('prompt vazio não chama a IA', async () => {
		const { deps, chamadas } = montaStudio();
		const app = await montaAppStudio(deps);

		const res = await app.inject({
			method: 'POST',
			url: '/api/image-studio/enhance',
			payload: { prompt: '   ' },
		});

		expect(res.json()).toEqual({ enhanced: '', suggestions: [] });
		expect(chamadas).toHaveLength(0);
	});
});

/* ─────────────────── filtros da galeria (faceta booleana) ─────────────────── */

describe('parseFilters — faceta booleana', () => {
	const galeria = {
		fields: [
			{ name: 'favorito', type: 'bool' as const, facet: true as const },
			{
				name: 'modo',
				type: 'enum' as const,
				options: ['texto_imagem', 'variacao'],
				facet: true as const,
			},
		],
	};

	/**
	 * O filtro roda como contenção jsonb. `data @> '{"favorito":"true"}'` (texto)
	 * NÃO casa com `{"favorito": true}` (booleano) — e o sintoma é o pior
	 * possível: lista vazia, sem erro nenhum.
	 */
	it('converte "true" em boolean de verdade', () => {
		expect(parseFilters({ 'f.favorito': 'true' }, galeria)).toEqual({
			favorito: { kind: 'eq', value: true },
		});
		expect(parseFilters({ 'f.favorito': 'false' }, galeria)).toEqual({
			favorito: { kind: 'eq', value: false },
		});
	});

	it('não mexe nas facetas de enum', () => {
		expect(parseFilters({ 'f.modo': 'variacao' }, galeria)).toEqual({
			modo: { kind: 'eq', value: 'variacao' },
		});
	});

	it('ignora campo que não é faceta declarada', () => {
		expect(parseFilters({ 'f.prompt': 'coruja' }, galeria)).toEqual({});
	});
});

describe('stripBannedTerms', () => {
	it('remove só a cláusula ofensora, preservando o resto', () => {
		expect(
			stripBannedTerms('leão de perfil, com sombra projetada, traço grosso'),
		).toBe('leão de perfil, traço grosso');
	});

	it('pega variação com e sem acento', () => {
		expect(stripBannedTerms('fundo em degradê, silhueta')).toBe('silhueta');
		expect(stripBannedTerms('fundo em degrade, silhueta')).toBe('silhueta');
	});

	it('devolve vazio quando o texto inteiro é proibido (quem chama decide)', () => {
		expect(stripBannedTerms('retrato fotorrealista com sombra')).toBe('');
	});
});
