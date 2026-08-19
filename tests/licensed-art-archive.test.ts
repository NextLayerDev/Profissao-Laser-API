import Fastify, { type FastifyInstance } from 'fastify';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Arquivar uma peça é a operação mais perigosa desta feature, e o perigo NÃO é
 * perder dado — é o contrário. A licença tem de sobreviver ao arquivamento,
 * porque o QR dela pode já estar gravado num chaveiro que saiu daqui, e um
 * código que para de responder é lido como falsificação por quem escaneia.
 *
 * Os testes aqui protegem três coisas, nessa ordem de gravidade:
 *   1. o QR público continua resolvendo uma peça arquivada;
 *   2. só o dono arquiva a própria peça;
 *   3. o campo `archived` chega na resposta (o serializer do Fastify já podou
 *      um campo desta mesma rota em silêncio uma vez — ver src/types/tool-run.ts).
 */

/** Gravador da cadeia do supabase: guarda cada chamada e devolve o resultado. */
function consultaFalsa(resultado: unknown) {
	const chamadas: unknown[][] = [];
	const q: Record<string, unknown> = {
		chamadas,
		/* O construtor de consulta do supabase É thenable: `await
		   supabase.from(x).select().limit(n)` resolve sem nenhum método terminal.
		   O dublê tem de ser thenable também, senão o caminho da listagem trava. */
		// biome-ignore lint/suspicious/noThenProperty: dublê de um objeto thenable
		then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
			Promise.resolve(resultado).then(ok, falha),
	};
	for (const metodo of [
		'select',
		'update',
		'eq',
		'is',
		'not',
		'order',
		'limit',
	]) {
		q[metodo] = (...args: unknown[]) => {
			chamadas.push([metodo, ...args]);
			return q;
		};
	}
	q.maybeSingle = () => {
		chamadas.push(['maybeSingle']);
		return Promise.resolve(resultado);
	};
	return q;
}

let ultimaConsulta: ReturnType<typeof consultaFalsa>;
let proximoResultado: unknown = { data: null, error: null };

vi.mock('@/lib/supabase.js', () => ({
	supabase: {
		from: (tabela: string) => {
			ultimaConsulta = consultaFalsa(proximoResultado);
			(ultimaConsulta.chamadas as unknown[][]).push(['from', tabela]);
			return ultimaConsulta;
		},
	},
}));

const { arquivarDoCliente, buscarPorCodigo, listarDoCliente } = await import(
	'@/repositories/licensed-art.js'
);

const chamadas = () => ultimaConsulta.chamadas as unknown[][];
const chamou = (metodo: string, ...args: unknown[]) =>
	chamadas().some(
		(c) => c[0] === metodo && args.every((a, i) => c[i + 1] === a),
	);

const peca = (over: Record<string, unknown> = {}) => ({
	id: 'peca-1',
	customer_id: 'aluno-1',
	feature_key: 'clube:corinthians',
	licensor_name: 'Corinthians',
	code: 'PL-AAAAA-BBBBB-CCCCC-DDDDD',
	code_hash: 'hash',
	tool_key: 'arte_licenciada',
	invocation_id: null,
	preview_url: null,
	prompt_title: 'Caneca 360',
	revoked_at: null,
	revoke_reason: null,
	archived_at: null,
	batch_id: null,
	piece_index: 1,
	batch_size: 1,
	master_path: null,
	created_at: '2026-08-18T00:00:00.000Z',
	...over,
});

beforeEach(() => {
	proximoResultado = { data: null, error: null };
});

describe('arquivar peça licenciada', () => {
	it('o QR público NÃO filtra arquivadas — a peça gravada continua respondendo', async () => {
		proximoResultado = { data: peca({ archived_at: '2026-08-19T00:00:00Z' }) };
		const achada = await buscarPorCodigo('PL-AAAAA-BBBBB-CCCCC-DDDDD');

		expect(achada).not.toBeNull();
		// A garantia é a AUSÊNCIA do filtro: se alguém "arrumar" o repositório
		// somando `.is('archived_at', null)` aqui, todo chaveiro de peça
		// arquivada vira 404 — que a página pública mostra como falsificação.
		expect(chamou('is', 'archived_at')).toBe(false);
		expect(chamou('eq', 'archived_at')).toBe(false);
	});

	it('o dono entra no WHERE: id sozinho não arquiva peça alheia', async () => {
		proximoResultado = { data: peca(), error: null };
		await arquivarDoCliente('peca-1', 'aluno-1', true);

		expect(chamou('eq', 'id', 'peca-1')).toBe(true);
		expect(chamou('eq', 'customer_id', 'aluno-1')).toBe(true);
	});

	it('arquivar carimba a data; desarquivar volta para nulo', async () => {
		proximoResultado = { data: peca(), error: null };
		await arquivarDoCliente('peca-1', 'aluno-1', true);
		const arquivou = chamadas().find((c) => c[0] === 'update')?.[1] as {
			archived_at: string | null;
		};
		expect(typeof arquivou.archived_at).toBe('string');

		proximoResultado = { data: peca(), error: null };
		await arquivarDoCliente('peca-1', 'aluno-1', false);
		const voltou = chamadas().find((c) => c[0] === 'update')?.[1] as {
			archived_at: string | null;
		};
		expect(voltou.archived_at).toBeNull();
	});

	it('peça de outra pessoa não volta linha nenhuma — o repositório devolve null', async () => {
		proximoResultado = { data: null, error: null };
		expect(await arquivarDoCliente('peca-1', 'outro-aluno', true)).toBeNull();
	});

	it('a biblioteca esconde as arquivadas; o filtro traz só elas', async () => {
		const linhas = [
			peca({ id: 'ativa' }),
			peca({ id: 'guardada', archived_at: '2026-08-19T00:00:00Z' }),
		];

		proximoResultado = { data: linhas };
		expect((await listarDoCliente('aluno-1')).map((a) => a.id)).toEqual([
			'ativa',
		]);

		proximoResultado = { data: linhas };
		expect(
			(await listarDoCliente('aluno-1', { arquivadas: true })).map((a) => a.id),
		).toEqual(['guardada']);
	});

	it('o corte é em memória — a coluna pode nascer sem derrubar a listagem', async () => {
		// Antes da migration, `select('*')` não traz `archived_at`. Um `where` na
		// coluna quebraria a biblioteca inteira; o corte em memória trata o campo
		// ausente como peça ativa.
		const semColuna = { ...peca() } as Record<string, unknown>;
		delete semColuna.archived_at;
		proximoResultado = { data: [semColuna] };

		expect(await listarDoCliente('aluno-1')).toHaveLength(1);
		expect(chamou('is', 'archived_at')).toBe(false);
	});
});

/* ── A rota: autorização e o campo que o serializer poderia podar ── */

/*
 * A rota roda contra o repositório DE VERDADE, com o supabase dublado — o mesmo
 * dublê dos testes acima. Trocar o repositório por um spy aqui esconderia
 * justamente o que interessa: que o dono chega no `where`.
 */
vi.mock('@/repositories/licensed-brand.js', () => ({
	licensedBrandRepository: { findByFeatureKey: async () => null },
}));
vi.mock('@/middleware/auth.js', () => ({
	authenticateCustomer: async (request: {
		currentCustomer: { id: string } | null;
	}) => {
		request.currentCustomer = { id: 'aluno-1' };
	},
}));

async function app(): Promise<FastifyInstance> {
	const { licensedArtRoute } = await import('@/routes/licensed-art.js');
	const server = Fastify().withTypeProvider<ZodTypeProvider>();
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);
	await server.register(licensedArtRoute);
	return server;
}

// UUID v4 de verdade: a rota valida versão e variante, e um id "quase uuid"
// levaria 400 antes de chegar em qualquer regra de dono.
const ID = '11111111-2222-4333-8444-555555555555';

describe('rotas de arquivar', () => {
	it('devolve 404 quando a peça não é de quem pediu', async () => {
		proximoResultado = { data: null, error: null };
		const server = await app();
		const res = await server.inject({
			method: 'POST',
			url: `/api/me/licensed-art/${ID}/archive`,
		});
		// 404 e não 403: um 403 confirmaria que o id existe para quem não é dono.
		expect(res.statusCode).toBe(404);
		await server.close();
	});

	it('POST arquiva e DELETE devolve — e `archived` sobrevive ao serializer', async () => {
		const server = await app();

		proximoResultado = {
			data: peca({ id: ID, archived_at: '2026-08-19T00:00:00Z' }),
			error: null,
		};
		const guardou = await server.inject({
			method: 'POST',
			url: `/api/me/licensed-art/${ID}/archive`,
		});
		expect(guardou.statusCode).toBe(200);
		expect(guardou.json()).toMatchObject({ id: ID, archived: true });

		proximoResultado = { data: peca({ id: ID }), error: null };
		const voltou = await server.inject({
			method: 'DELETE',
			url: `/api/me/licensed-art/${ID}/archive`,
		});
		expect(voltou.statusCode).toBe(200);
		expect(voltou.json()).toMatchObject({ id: ID, archived: false });

		await server.close();
	});

	it('o dono autenticado entra no WHERE — não o id que veio na URL', async () => {
		proximoResultado = { data: peca({ id: ID }), error: null };
		const server = await app();
		await server.inject({
			method: 'POST',
			url: `/api/me/licensed-art/${ID}/archive`,
		});
		expect(chamou('eq', 'id', ID)).toBe(true);
		expect(chamou('eq', 'customer_id', 'aluno-1')).toBe(true);
		await server.close();
	});

	it('a listagem devolve `archived` em cada peça', async () => {
		proximoResultado = {
			data: [peca({ id: ID })],
		};
		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: '/api/me/licensed-art',
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual([expect.objectContaining({ archived: false })]);
		await server.close();
	});
});
