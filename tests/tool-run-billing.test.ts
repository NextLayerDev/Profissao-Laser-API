import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O FURO DE COBRANÇA DO MOTOR, exercitado de ponta a ponta.
 *
 * O `/invoke` (upvox) debita `vox_cost × variation_count`; o run conferia o N
 * pedido só contra `return_variations` da definition — nunca contra o que a
 * invocação pagou. Dava para pagar 1 e receber 4, e isso valia para uma tool
 * PUBLICADA. Estes testes existem para que essa porta não reabra por descuido.
 *
 * Metade deles não é sobre fraude: é sobre a regra de ouro do conserto — um
 * falso positivo aqui vira 403 em aluno pagante, que é pior que a fraude. Cada
 * canto em que NÃO dá para saber quantas variações foram pagas (cota do plano,
 * conta ilimitada, preço mexido no meio) tem um teste provando que o run passa.
 */

// Envs exigidas no IMPORT por módulos que o controller arrasta (external-auth,
// openrouter…). `vi.hoisted` roda antes dos imports estáticos — sem isto o
// arquivo nem carrega.
vi.hoisted(() => {
	process.env.EXTERNAL_API_URL ||= 'http://upvox.test';
	process.env.OPENROUTER_API_KEY ||= 'test-key';
	process.env.SUPABASE_URL ||= 'http://supabase.test';
	process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';
});

vi.mock('../src/lib/supabase.js', () => ({
	supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}));

vi.mock('../src/lib/upvox-tools.js', async (importOriginal) => {
	// `reservarInvocacao`/`liberarInvocacao` são REAIS de propósito: a trava de
	// recibo é lógica de processo (um Set), não I/O, e é justamente o que o
	// teste de concorrência precisa exercitar de verdade.
	const real =
		await importOriginal<typeof import('../src/lib/upvox-tools.js')>();
	return {
		...real,
		resolveToolBilling: vi.fn(),
		getToolVoxCost: vi.fn(),
		settleInvocation: vi.fn(async () => {}),
		refundInvocation: vi.fn(async () => {}),
		isToolBilled: vi.fn(async () => true),
		getInvocation: vi.fn(),
	};
});

vi.mock('../src/lib/tool-definitions.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('../src/lib/tool-definitions.js')>();
	return { ...real, loadPublishedToolDefinition: vi.fn() };
});

vi.mock('../src/lib/tool-engine.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('../src/lib/tool-engine.js')>();
	return { ...real, executeTool: vi.fn(async () => ({ imagem: 'ok' })) };
});

import {
	toolRunController,
	toolRunStreamController,
} from '../src/controllers/tool-run.js';
import {
	loadPublishedToolDefinition,
	ToolDefinitionLoadError,
} from '../src/lib/tool-definitions.js';
import { executeTool } from '../src/lib/tool-engine.js';
import {
	getToolVoxCost,
	limparReservas,
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../src/lib/upvox-tools.js';

const mockBilling = vi.mocked(resolveToolBilling);
const mockVoxCost = vi.mocked(getToolVoxCost);
const mockLoad = vi.mocked(loadPublishedToolDefinition);
const mockExecute = vi.mocked(executeTool);
const mockSettle = vi.mocked(settleInvocation);
const mockRefund = vi.mocked(refundInvocation);

/** Definition mínima de uma tool de geração de imagem, com Passo 3. */
function definition(returnVariations?: number[]) {
	return {
		tool_key: 'prompts_magicos',
		version: 1,
		status: 'published',
		title: 'Prompts Mágicos',
		description: null,
		engine_runtime: 'blocks_v1',
		definition: {
			input: { prompt: { type: 'text' } },
			pipeline: [
				{ id: 'gen', block: 'ai.generate_image', params: { prompt: 'x' } },
			],
			output: { imagem: 'gen.pngBase64' },
			...(returnVariations ? { return_variations: returnVariations } : {}),
		},
	} as unknown as Awaited<ReturnType<typeof loadPublishedToolDefinition>>;
}

function fakeRequest(fields: Record<string, string>): FastifyRequest {
	return {
		currentCustomer: { id: 'cust-1' },
		currentRole: 'customer',
		headers: { authorization: 'Bearer tok' },
		params: { key: 'prompts_magicos' },
		parts: async function* parts() {
			for (const [fieldname, value] of Object.entries(fields)) {
				yield { type: 'field', fieldname, value };
			}
		},
	} as unknown as FastifyRequest;
}

interface Resposta {
	status: number;
	body: Record<string, unknown>;
}

async function rodar(fields: Record<string, string>): Promise<Resposta> {
	const out: Resposta = { status: 0, body: {} };
	const reply = {
		status(s: number) {
			out.status = s;
			return this;
		},
		send(payload: Record<string, unknown>) {
			out.body = payload;
			return this;
		},
	} as unknown as FastifyReply;
	await toolRunController(fakeRequest(fields), reply);
	return out;
}

/** Roda pela rota SSE e devolve os frames que saíram no socket. */
async function rodarStream(
	fields: Record<string, string>,
): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
	const frames: Array<{ event: string; data: Record<string, unknown> }> = [];
	const reply = {
		hijack: () => {},
		raw: {
			writableEnded: false,
			writeHead: () => {},
			write: (chunk: string) => {
				const m = /^event: (.+)\ndata: (.+)\n\n$/.exec(chunk);
				if (m) frames.push({ event: m[1], data: JSON.parse(m[2]) });
			},
			end: () => {},
		},
	} as unknown as FastifyReply;
	await toolRunStreamController(fakeRequest(fields), reply);
	return frames;
}

/**
 * Quantas variações o motor REALMENTE mandou o bloco gerar — lido do `doc` que
 * chegou no `executeTool`. `undefined` = o override nem foi injetado, que é
 * como o motor diz "uma".
 */
function variacoesInjetadas(): number | undefined {
	const doc = mockExecute.mock.calls[0]?.[0] as
		| { pipeline?: Array<{ params?: Record<string, unknown> }> }
		| undefined;
	return doc?.pipeline?.[0]?.params?.variation_count as number | undefined;
}

beforeEach(() => {
	vi.clearAllMocks();
	limparReservas();
	mockLoad.mockResolvedValue(definition([1, 2, 4]));
	mockExecute.mockResolvedValue({ imagem: 'ok' });
	// O padrão: invocação paga de 1 variação (vox_cost 0,5 × 1), como o
	// `prompts_magicos` publicado.
	mockBilling.mockResolvedValue({
		mode: 'paid',
		invocationId: 'inv-1',
		voxesSpent: 0.5,
		quotaConsumed: 0,
	});
	mockVoxCost.mockResolvedValue(0.5);
});

describe('o run entrega o que foi pago — nunca mais, e nunca um erro', () => {
	/**
	 * A versão anterior deste conserto respondia 409 aqui. Fechava a fraude e
	 * abria a falha oposta: um cliente REAL (aba aberta desde antes do deploy)
	 * mandou `/invoke` de 1 e run de 2 e tomou o 409 na cara. Entregar o que foi
	 * pago fecha a fraude do mesmo jeito — quem paga 1 recebe 1 — e não tem como
	 * transformar run legítimo em erro.
	 */
	it('pagou 1 e pediu 4: gera UMA, cobra uma, e não devolve erro', async () => {
		const res = await rodar({ variation_count: '4' });

		expect(res.status).toBe(201);
		// O que mais importa: o fornecedor foi chamado para UMA imagem, não quatro.
		expect(variacoesInjetadas()).toBeUndefined(); // undefined = 1
		expect(mockExecute).toHaveBeenCalledTimes(1);
		// Run legítimo: liquida a invocação e NÃO estorna.
		expect(mockSettle).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
		expect(mockRefund).not.toHaveBeenCalled();
	});

	it('pagou 2 e pediu 4: entrega 2 (o maior do allowlist que cabe no pago)', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 1, // 0,5 × 2
			quotaConsumed: 0,
		});

		const res = await rodar({ variation_count: '4' });

		expect(res.status).toBe(201);
		expect(variacoesInjetadas()).toBe(2);
	});

	it('a rota SSE entrega pelo mesmo caminho (não é um portão paralelo)', async () => {
		const frames = await rodarStream({ variation_count: '4' });

		expect(frames.some((f) => f.event === 'erro')).toBe(false);
		expect(frames.at(-1)?.event).toBe('done');
		expect(variacoesInjetadas()).toBeUndefined();
	});

	it('pagou 4 e pediu 4: roda e liquida', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 2,
			quotaConsumed: 0,
		});

		const res = await rodar({ variation_count: '4' });

		expect(res.status).toBe(201);
		expect(variacoesInjetadas()).toBe(4);
		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockSettle).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
		expect(mockRefund).not.toHaveBeenCalled();
	});

	it('pagou 4 e pediu 2 (o aluno perde o troco, mas o run é legítimo)', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 2,
			quotaConsumed: 0,
		});

		const res = await rodar({ variation_count: '2' });

		expect(res.status).toBe(201);
		expect(variacoesInjetadas()).toBe(2);
	});

	it('preço quebrado (0,3/vox): 2 pagas entrega 2, mesmo pedindo 4', async () => {
		mockVoxCost.mockResolvedValue(0.3);
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 0.6, // round2(0,3 × 2)
			quotaConsumed: 0,
		});

		expect((await rodar({ variation_count: '2' })).status).toBe(201);
		expect(variacoesInjetadas()).toBe(2);

		vi.clearAllMocks();
		limparReservas();
		mockLoad.mockResolvedValue(definition([1, 2, 4]));
		mockVoxCost.mockResolvedValue(0.3);
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 0.6,
			quotaConsumed: 0,
		});
		expect((await rodar({ variation_count: '4' })).status).toBe(201);
		expect(variacoesInjetadas()).toBe(2);
	});

	it('o allowlist manda no teto: pago 3 com [1,2,4] entrega 2, não 3', async () => {
		mockVoxCost.mockResolvedValue(0.5);
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 1.5, // 0,5 × 3
			quotaConsumed: 0,
		});

		expect((await rodar({ variation_count: '4' })).status).toBe(201);
		expect(variacoesInjetadas()).toBe(2);
	});
});

describe('cobrar N e entregar 1 — a falha do furo virada do avesso', () => {
	/**
	 * `ai.image_studio` recebe os overrides mas o schema dele faz `strip` de
	 * `variation_count`. Uma tool que declare `return_variations` rodando nesse
	 * bloco cobraria 4× e entregaria uma imagem, em silêncio. Aqui isso é erro de
	 * configuração, e o aluno não paga por ele.
	 */
	it('bloco que não sabe fazer N: recusa 409 COM estorno, sem chamar fornecedor', async () => {
		mockLoad.mockResolvedValue({
			...definition([1, 2, 4]),
			definition: {
				input: { prompt: { type: 'text' } },
				pipeline: [
					{
						id: 'gen',
						block: 'ai.image_studio',
						params: { mode: 'texto_imagem' },
					},
				],
				output: { imagem: 'gen.pngBase64' },
				return_variations: [1, 2, 4],
			},
		} as unknown as Awaited<ReturnType<typeof loadPublishedToolDefinition>>);
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 1, // pagou 2 de verdade — o problema não é a cobrança
			quotaConsumed: 0,
		});

		const res = await rodar({ variation_count: '2', invocation_id: 'inv-1' });

		expect(res.status).toBe(409);
		expect(mockExecute).not.toHaveBeenCalled();
		expect(mockRefund).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
		expect(mockSettle).not.toHaveBeenCalled();
	});
});

describe('um recibo, um run (a outra metade do furo)', () => {
	/**
	 * O portão só LIA `status === 'pending'`. Enquanto o primeiro run trabalha —
	 * 99 s no Ateliê, medido — o mesmo `invocation_id` passava de novo. Três runs
	 * em paralelo = três vezes o fornecedor por uma cobrança. Fechar a contagem
	 * não fechava isto: bastava mandar N runs de 1 variação com o mesmo recibo.
	 */
	it('dois runs simultâneos com o MESMO recibo: só um chama o fornecedor', async () => {
		let liberar: (() => void) | undefined;
		mockExecute.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					liberar = () => resolve({ imagem: 'ok' });
				}),
		);

		const primeiro = rodar({ invocation_id: 'inv-9' });
		// Deixa o primeiro chegar até o `executeTool` antes de disparar o segundo.
		await new Promise((r) => setImmediate(r));
		const segundo = await rodar({ invocation_id: 'inv-9' });

		expect(segundo.status).toBe(409);
		expect(String(segundo.body.message)).toMatch(/já está sendo processada/i);
		// E o mais importante: o segundo NÃO estorna o recibo do primeiro.
		expect(mockRefund).not.toHaveBeenCalled();
		expect(mockExecute).toHaveBeenCalledTimes(1);

		liberar?.();
		expect((await primeiro).status).toBe(201);
	});

	it('o recibo volta quando o run termina — o aluno consegue gerar de novo', async () => {
		expect((await rodar({ invocation_id: 'inv-9' })).status).toBe(201);
		expect((await rodar({ invocation_id: 'inv-9' })).status).toBe(201);
	});

	it('o recibo volta mesmo quando o run explode', async () => {
		mockExecute.mockRejectedValueOnce(new Error('fornecedor caiu'));
		expect((await rodar({ invocation_id: 'inv-9' })).status).toBe(500);
		expect((await rodar({ invocation_id: 'inv-9' })).status).toBe(201);
	});
});

describe('os cantos em que NÃO se recusa (regra de ouro)', () => {
	it('uma variação: nem pergunta o preço ao upvox', async () => {
		const res = await rodar({ variation_count: '1' });

		expect(res.status).toBe(201);
		// Nenhuma chamada de rede nova no caminho de 99% dos runs.
		expect(mockVoxCost).not.toHaveBeenCalled();
	});

	it('variation_count ausente (tool sem Passo 3): passa sem conferência', async () => {
		mockLoad.mockResolvedValue(definition()); // sem return_variations — o Ateliê

		const res = await rodar({});

		expect(res.status).toBe(201);
		expect(mockVoxCost).not.toHaveBeenCalled();
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('cota grátis do plano: 1 unidade por invoke, não escala — roda', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 0,
			quotaConsumed: 1,
		});

		const res = await rodar({ variation_count: '4' });

		expect(res.status).toBe(201);
		expect(mockExecute).toHaveBeenCalledTimes(1);
		expect(mockRefund).not.toHaveBeenCalled();
	});

	it('conta de teste ilimitada (invocação 0/0): roda', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 0,
			quotaConsumed: 0,
		});

		expect((await rodar({ variation_count: '4' })).status).toBe(201);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('preço desconhecido (upvox fora do ar): roda', async () => {
		mockVoxCost.mockResolvedValue(undefined);

		expect((await rodar({ variation_count: '4' })).status).toBe(201);
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('vox_cost zero: roda (não há divisão possível)', async () => {
		mockVoxCost.mockResolvedValue(0);

		expect((await rodar({ variation_count: '4' })).status).toBe(201);
	});

	it('admin mexeu no preço entre o invoke e o run: roda', async () => {
		// Pagou 0,5 (preço antigo); o catálogo agora diz 0,6. 0,5 não é múltiplo
		// de 0,6 — é deriva de preço, não fraude.
		mockVoxCost.mockResolvedValue(0.6);

		expect((await rodar({ variation_count: '4' })).status).toBe(201);
	});

	it('tool não cobrada (gate free): não confere nada', async () => {
		mockBilling.mockResolvedValue({ mode: 'free' });

		const res = await rodar({ variation_count: '4' });

		expect(res.status).toBe(201);
		expect(mockVoxCost).not.toHaveBeenCalled();
		expect(mockSettle).not.toHaveBeenCalled();
	});
});

describe('a validação que continua vindo antes do portão', () => {
	it('quantidade fora do allowlist: 400 sem nem chegar ao billing', async () => {
		const res = await rodar({ variation_count: '3' });

		expect(res.status).toBe(400);
		expect(String(res.body.message)).toMatch(/variações inválida/i);
		expect(mockBilling).not.toHaveBeenCalled();
	});

	it('tool sem Passo 3 recebendo variation_count: 400 sem cobrar', async () => {
		mockLoad.mockResolvedValue(definition());

		const res = await rodar({ variation_count: '4' });

		expect(res.status).toBe(400);
		expect(mockBilling).not.toHaveBeenCalled();
	});
});

describe('recusa antes do portão: o voxxy VOLTA (e o status é o certo)', () => {
	/**
	 * ┌─ "400 ANTES DO PORTÃO REJEITA SEM COBRAR" ERA FALSO ────────────────┐
	 * │ A cobrança acontece no `/invoke`, no cliente, ANTES deste request    │
	 * │ existir. Todo 400 devolvido antes do gate deixava a invocação        │
	 * │ `pending` com o voxxy debitado — e o front não estorna, e o upvox    │
	 * │ não tem reaper: `pending` é terminal na prática.                     │
	 * └──────────────────────────────────────────────────────────────────────┘
	 */
	it('quantidade fora do allowlist: 400 e devolve o voxxy', async () => {
		const res = await rodar({ variation_count: '3', invocation_id: 'inv-1' });

		expect(res.status).toBe(400);
		expect(mockExecute).not.toHaveBeenCalled();
		expect(mockRefund).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
	});

	it('fluxo inexistente: 400 e devolve o voxxy', async () => {
		const res = await rodar({ flow: 'nao_existe', invocation_id: 'inv-1' });

		expect(res.status).toBe(400);
		expect(mockRefund).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
	});

	/**
	 * `resolveCreation` lança `ToolEngineError(400)`, mas o catch externo só
	 * conhecia `ToolDefinitionLoadError` — e este 400 saía como **HTTP 500**,
	 * com a mensagem de usuário dentro e o voxxy preso. Erro de cliente vestido
	 * de falha de servidor.
	 */
	it('creation_id ausente: 400 (não 500), com a mensagem certa e estorno', async () => {
		mockLoad.mockResolvedValue({
			...definition(),
			definition: {
				input: { prompt: { type: 'text' } },
				pipeline: [
					{ id: 'gen', block: 'ai.generate_image', params: { prompt: 'x' } },
				],
				output: { imagem: 'gen.pngBase64' },
				creations: [
					{ id: 'capinha', label: 'Capinha', width: 1080, height: 1920 },
				],
			},
		} as unknown as Awaited<ReturnType<typeof loadPublishedToolDefinition>>);

		const res = await rodar({ invocation_id: 'inv-1' });

		expect(res.status).toBe(400);
		expect(String(res.body.message)).toMatch(/tipo de criação/i);
		expect(mockRefund).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
	});

	/**
	 * A mina do dia da publicação: com a key ainda em `TOOL_PREVIEW_KEYS`, o
	 * upvox some com a tool dos entitlements, `isToolBilled` vira `false` e o
	 * motor rodaria de graça para todo mundo. Melhor quebrar alto.
	 */
	it('tool PUBLICADA ainda em TOOL_PREVIEW_KEYS não roda de graça', async () => {
		const antes = process.env.TOOL_PREVIEW_KEYS;
		process.env.TOOL_PREVIEW_KEYS = 'prompts_magicos';
		mockBilling.mockResolvedValue({ mode: 'free' });
		try {
			const res = await rodar({});
			expect(res.status).toBe(402);
			expect(mockExecute).not.toHaveBeenCalled();
		} finally {
			if (antes === undefined) delete process.env.TOOL_PREVIEW_KEYS;
			else process.env.TOOL_PREVIEW_KEYS = antes;
		}
	});

	it('e a mesma tool FORA da env roda de graça normalmente (sem regressão)', async () => {
		const antes = process.env.TOOL_PREVIEW_KEYS;
		delete process.env.TOOL_PREVIEW_KEYS;
		mockBilling.mockResolvedValue({ mode: 'free' });
		try {
			expect((await rodar({})).status).toBe(201);
			expect(mockExecute).toHaveBeenCalledTimes(1);
		} finally {
			if (antes !== undefined) process.env.TOOL_PREVIEW_KEYS = antes;
		}
	});
});

/**
 * O ALUNO PAGA E NÃO RECEBE — o pior desfecho que o sistema sabe produzir, e o
 * único que não tem conserto automático depois.
 *
 * Medido ao vivo antes do conserto: `/invoke` debitou, o run tomou 404
 * `tool_not_found` (definition em `draft`, ou key fora do `TOOL_PREVIEW_KEYS`
 * daquele processo) e a invocação ficou `pending` PARA SEMPRE — não existe
 * reaper em nenhum dos dois serviços. Em produção havia 65 invocações presas,
 * a mais antiga de junho.
 *
 * A causa era de escopo, não de intenção: o `catch` externo estornava por
 * `invocationId`, que só é atribuído DEPOIS do portão de billing — e a carga da
 * definition acontece ANTES dele. Numa tool de 12 voxxys, duas dessas custam
 * mais que todo o vazamento acumulado desde junho.
 */
describe('estorno quando o run morre ANTES do portão de billing', () => {
	it('definition 404 depois de o /invoke ter cobrado: estorna pelo recibo', async () => {
		mockLoad.mockRejectedValue(
			new ToolDefinitionLoadError(404, 'tool_not_found'),
		);

		const res = await rodar({ invocation_id: 'inv-paga' });

		expect(res.status).toBe(404);
		expect(String(res.body.message)).toBe('tool_not_found');
		// O que importa: os voxxys voltaram, mesmo o portão de billing nunca
		// tendo rodado (invocationId continuou `null` o run inteiro).
		expect(mockRefund).toHaveBeenCalledWith('cust-1', 'inv-paga', 'Bearer tok');
	});

	it('sem recibo nenhum, nada é estornado (não inventa invocação)', async () => {
		mockLoad.mockRejectedValue(
			new ToolDefinitionLoadError(404, 'tool_not_found'),
		);

		expect((await rodar({})).status).toBe(404);
		expect(mockRefund).not.toHaveBeenCalled();
	});

	/**
	 * O contrapeso, e é ele que impede o conserto de virar estorno duplo: quando
	 * o portão RODOU, o id do portão é o que vale, e o estorno sai UMA vez só.
	 */
	it('quando o portão rodou, estorna uma vez só — pelo id do portão', async () => {
		mockExecute.mockRejectedValue(new Error('fornecedor caiu'));

		const res = await rodar({ invocation_id: 'inv-1' });

		expect(res.status).toBe(500);
		expect(mockRefund).toHaveBeenCalledTimes(1);
		expect(mockRefund).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
	});

	/** E um run que deu certo continua liquidando, sem estorno nenhum. */
	it('run bem-sucedido não estorna', async () => {
		expect((await rodar({ invocation_id: 'inv-1' })).status).toBe(201);
		expect(mockSettle).toHaveBeenCalledWith('cust-1', 'inv-1', 'Bearer tok');
		expect(mockRefund).not.toHaveBeenCalled();
	});
});
