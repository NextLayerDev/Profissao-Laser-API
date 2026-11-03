import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O MODO "SÓ LICENCIAR" — a rodada licenciada que NÃO gera.
 *
 * O aluno envia a arte pronta; o motor emite o código, carimba e entrega. Estes
 * testes prendem as duas promessas do modo: (1) o modelo NUNCA roda — nem o
 * escudo é injetado, nem a arte é reinterpretada; (2) tudo o que não é geração
 * (cobrança, estorno, tiragem, lote personalizado) continua idêntico à rodada
 * gerada. E prendem o furo colateral que este modo expôs: o lote com fotos por
 * peça caía em "Arquivo inesperado" antes mesmo de gerar.
 */

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
	return { ...real, executeTool: vi.fn() };
});

vi.mock('../src/repositories/tool-bank.js', () => ({
	toolBankRepository: { findById: vi.fn() },
}));

vi.mock('../src/repositories/licensed-seller.js', () => ({
	declaracaoEmDia: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../src/repositories/licensed-art.js', () => ({
	emitirLote: vi.fn(),
	anexarArtes: vi.fn(async () => {}),
	anexarMaster: vi.fn(async () => {}),
	apagarLoteSemArte: vi.fn(async () => {}),
}));

vi.mock('../src/lib/licensed-piece.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('../src/lib/licensed-piece.js')>();
	return { ...real, carimbarLote: vi.fn() };
});

vi.mock('../src/lib/storage.js', () => ({
	uploadToolOutput: vi.fn(async () => 'https://cdn.test/master.png'),
	fetchToolOutput: vi.fn(),
	deleteByUrl: vi.fn(async () => {}),
}));

import { toolRunController } from '../src/controllers/tool-run.js';
import { carimbarLote } from '../src/lib/licensed-piece.js';
import { loadPublishedToolDefinition } from '../src/lib/tool-definitions.js';
import { executeTool } from '../src/lib/tool-engine.js';
import {
	limparReservas,
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../src/lib/upvox-tools.js';
import { emitirLote } from '../src/repositories/licensed-art.js';
import { toolBankRepository } from '../src/repositories/tool-bank.js';

const mockBilling = vi.mocked(resolveToolBilling);
const mockLoad = vi.mocked(loadPublishedToolDefinition);
const mockExecute = vi.mocked(executeTool);
const mockSettle = vi.mocked(settleInvocation);
const mockRefund = vi.mocked(refundInvocation);
const mockEntry = vi.mocked(toolBankRepository.findById);
const mockEmitir = vi.mocked(emitirLote);
const mockCarimbar = vi.mocked(carimbarLote);

/** A definition licenciada como está publicada: escudo → modelo, com Passo 1. */
function definition() {
	return {
		tool_key: 'arte_licenciada',
		version: 1,
		status: 'published',
		title: 'Arte Licenciada',
		description: null,
		engine_runtime: 'blocks_v1',
		definition: {
			input: {
				bank_entry_id: { type: 'text' },
				feature_key: { type: 'text' },
				prompt: { type: 'text' },
				referencia: { type: 'image' },
				tema: { type: 'text' },
			},
			pipeline: [
				{ id: 'marca', block: 'brand.asset', params: {} },
				{ id: 'gen', block: 'ai.generate_image', params: { prompt: 'x' } },
			],
			output: {},
			licensing: { master: 'gen.png' },
			creations: [{ id: 'vetor', label: 'Vetor', width: 1200, height: 1200 }],
			print_run: [1, 10, 25, 50],
			bank: {
				enabled: true,
				fields: [],
				inject: { prompt: { from: 'data.prompt_script', substitute: true } },
			},
		},
	} as unknown as Awaited<ReturnType<typeof loadPublishedToolDefinition>>;
}

const carimbo = {
	id: 'entry-carimbo',
	tool_key: 'arte_licenciada',
	title: 'Só licenciar — arte pronta',
	description: null,
	category: null,
	position: 0,
	active: true,
	data: { mode: 'carimbo', feature_key: 'clube:teste', licensor_name: 'Teste' },
	example_before_url: null,
	example_after_url: null,
	created_at: '',
	updated_at: '',
};

type Parte =
	| { type: 'field'; fieldname: string; value: string }
	| {
			type: 'file';
			fieldname: string;
			mimetype: string;
			filename: string;
			toBuffer: () => Promise<Buffer>;
	  };

function fakeRequest(
	fields: Record<string, string>,
	files: Record<string, Buffer> = {},
): FastifyRequest {
	return {
		currentCustomer: { id: 'cust-1' },
		currentRole: 'customer',
		headers: { authorization: 'Bearer tok' },
		params: { key: 'arte_licenciada' },
		parts: async function* parts(): AsyncGenerator<Parte> {
			for (const [fieldname, value] of Object.entries(fields)) {
				yield { type: 'field', fieldname, value };
			}
			for (const [fieldname, buf] of Object.entries(files)) {
				yield {
					type: 'file',
					fieldname,
					mimetype: 'image/png',
					filename: `${fieldname}.png`,
					toBuffer: async () => buf,
				};
			}
		},
	} as unknown as FastifyRequest;
}

interface Resposta {
	status: number;
	body: Record<string, unknown>;
}

async function rodar(
	fields: Record<string, string>,
	files: Record<string, Buffer> = {},
): Promise<Resposta> {
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
	await toolRunController(fakeRequest(fields, files), reply);
	return out;
}

/** Uma arte de verdade (PNG), para o normalizador ter o que ler. */
const arte = (cor: string) =>
	sharp({ create: { width: 64, height: 64, channels: 3, background: cor } })
		.png()
		.toBuffer();

/** O `emitirLote` de mentira: N peças com códigos previsíveis. */
function lote(n: number) {
	return Array.from({ length: n }, (_v, i) => ({
		id: `peca-${i + 1}`,
		batch_id: 'lote-1',
		piece_index: i + 1,
		code: `PL-TESTE-${i + 1}`,
		feature_key: 'clube:teste',
		licensor_name: 'Teste',
		created_at: '2026-09-09T00:00:00Z',
	}));
}

const BASE = { invocation_id: 'inv-1', bank_entry_id: 'entry-carimbo' };

beforeEach(() => {
	vi.clearAllMocks();
	limparReservas();
	mockLoad.mockResolvedValue(definition());
	mockEntry.mockResolvedValue(carimbo as never);
	mockBilling.mockResolvedValue({
		mode: 'paid',
		invocationId: 'inv-1',
		voxesSpent: 1,
		quotaConsumed: 0,
		units: 1,
		licenseUnits: 0,
	});
	mockEmitir.mockImplementation(async (args) => lote(args.tamanho) as never);
	mockCarimbar.mockImplementation(async (args) => ({
		entregues: args.pecas.map((p) => ({
			id: p.id,
			index: p.piece_index,
			code: p.code,
			url: `https://cdn.test/${p.code}.png`,
		})),
		thumb: 'data:image/png;base64,x',
		master: args.artes ? null : Buffer.from('master'),
	}));
});

describe('só licenciar: a arte enviada é o master', () => {
	it('não roda o modelo, não exige Passo 1, carimba o upload e entrega', async () => {
		const png = await arte('#ff0000');
		const r = await rodar(BASE, { referencia: png });

		expect(r.status).toBe(201);
		expect(mockExecute).not.toHaveBeenCalled();

		// O `carimbarLote` recebeu um doc apontando para a bag do upload, e a bag
		// tem a arte — normalizada em PNG, mas com os MESMOS pixels.
		const args = mockCarimbar.mock.calls[0][0];
		const chave = args.doc?.licensing?.master as string;
		const master = args.bag?.[chave];
		expect(Buffer.isBuffer(master)).toBe(true);
		const original = await sharp(png).raw().toBuffer();
		const recebido = await sharp(master as Buffer)
			.removeAlpha()
			.raw()
			.toBuffer();
		expect(recebido.equals(original)).toBe(true);
		expect(args.artes).toBeUndefined();

		expect(mockSettle).toHaveBeenCalledTimes(1);
		expect(mockRefund).not.toHaveBeenCalled();
		const output = r.body.output as Record<string, unknown>;
		expect(output.primary).toBe('https://cdn.test/PL-TESTE-1.png');
		expect((output.pieces as unknown[]).length).toBe(1);
	});

	it('um JPEG entra como PNG — mesmo conteúdo, contêiner que o CDN e o carimbo esperam', async () => {
		const jpeg = await sharp({
			create: { width: 64, height: 64, channels: 3, background: '#00ff00' },
		})
			.jpeg()
			.toBuffer();
		const r = await rodar(BASE, { referencia: jpeg });
		expect(r.status).toBe(201);
		const args = mockCarimbar.mock.calls[0][0];
		const master = args.bag?.[args.doc?.licensing?.master as string] as Buffer;
		expect((await sharp(master).metadata()).format).toBe('png');
	});

	it('tiragem "todas iguais": N códigos sobre a MESMA arte', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 3,
			quotaConsumed: 0,
			units: 1,
			licenseUnits: 2,
		});
		const r = await rodar(BASE, { referencia: await arte('#0000ff') });
		expect(r.status).toBe(201);
		expect(mockEmitir.mock.calls[0][0].tamanho).toBe(3);
		expect(mockCarimbar.mock.calls[0][0].pecas).toHaveLength(3);
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('só licenciar: o que é recusado — sempre com estorno', () => {
	it('sem a arte não há o que licenciar', async () => {
		const r = await rodar(BASE);
		expect(r.status).toBe(400);
		expect(String(r.body.message)).toContain('Envie a arte');
		expect(mockRefund).toHaveBeenCalledTimes(1);
		expect(mockEmitir).not.toHaveBeenCalled();
	});

	it('arquivo que não é imagem cai antes de qualquer trabalho', async () => {
		const r = await rodar(BASE, { referencia: Buffer.from('isto não é png') });
		expect(r.status).toBe(400);
		expect(mockRefund).toHaveBeenCalledTimes(1);
		expect(mockEmitir).not.toHaveBeenCalled();
	});

	it('mais de uma variação não faz sentido sem geração', async () => {
		mockLoad.mockResolvedValue({
			...definition(),
			definition: { ...definition().definition, return_variations: [1, 2] },
		} as never);
		const r = await rodar(
			{ ...BASE, variation_count: '2' },
			{ referencia: await arte('#ffffff') },
		);
		expect(r.status).toBe(400);
		expect(mockRefund).toHaveBeenCalledTimes(1);
	});

	it('registro carimbo sem marca é erro de cadastro, não uma peça sem licença', async () => {
		mockEntry.mockResolvedValue({
			...carimbo,
			data: { mode: 'carimbo' },
		} as never);
		const r = await rodar(BASE, { referencia: await arte('#ffffff') });
		expect(r.status).toBe(400);
		expect(String(r.body.message)).toContain('marca');
		expect(mockRefund).toHaveBeenCalledTimes(1);
	});
});

describe('só licenciar: lote "cada peça diferente"', () => {
	const duas = JSON.stringify([{ tema: 'MARINA' }, { tema: 'JOAO' }]);

	it('uma arte por linha: N peças, os textos viram só rótulos', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 2,
			quotaConsumed: 0,
			units: 2,
			licenseUnits: 1,
		});
		const r = await rodar(
			{ ...BASE, pieces: duas },
			{
				piece_image_0: await arte('#111111'),
				piece_image_1: await arte('#eeeeee'),
			},
		);
		expect(r.status).toBe(201);
		expect(mockExecute).not.toHaveBeenCalled();
		expect(mockEmitir.mock.calls[0][0].rotulos).toEqual(['MARINA', 'JOAO']);
		const args = mockCarimbar.mock.calls[0][0];
		expect(args.artes?.size).toBe(2);
		expect(Buffer.isBuffer(args.artes?.get(1))).toBe(true);
		expect(Buffer.isBuffer(args.artes?.get(2))).toBe(true);
	});

	it('linha sem arte é recusada — nome sozinho não vira peça sem geração', async () => {
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 2,
			quotaConsumed: 0,
			units: 2,
			licenseUnits: 1,
		});
		const r = await rodar(
			{ ...BASE, pieces: duas },
			{ piece_image_0: await arte('#111111') },
		);
		expect(r.status).toBe(400);
		expect(String(r.body.message)).toContain('peça 2');
		expect(mockRefund).toHaveBeenCalledTimes(1);
		expect(mockEmitir).not.toHaveBeenCalled();
	});
});

describe('o furo colateral: fotos por peça na rodada GERADA', () => {
	/**
	 * `piece_image_<i>` nunca esteve no `input` da definition, e a validação de
	 * upload só perdoava UM arquivo sem spec. Duas fotos = "Arquivo inesperado"
	 * = 400 com estorno, antes de gerar. Era isso que derrubava o lote
	 * personalizado com foto — e não tinha nada a ver com o modelo.
	 */
	it('duas fotos passam pela validação e chegam à geração', async () => {
		mockEntry.mockResolvedValue({
			...carimbo,
			data: {
				mode: 'imagem',
				feature_key: 'clube:teste',
				prompt_script: 'chaveiro {tema}',
			},
		} as never);
		mockBilling.mockResolvedValue({
			mode: 'paid',
			invocationId: 'inv-1',
			voxesSpent: 2,
			quotaConsumed: 0,
			units: 2,
			licenseUnits: 1,
		});
		mockExecute.mockImplementation(async () => ({
			output: {},
			bag: { 'gen.png': await arte('#abcdef') },
		}));
		const r = await rodar(
			{
				...BASE,
				creation_id: 'vetor',
				pieces: JSON.stringify([{ tema: 'A' }, { tema: 'B' }]),
			},
			{
				piece_image_0: await arte('#111111'),
				piece_image_1: await arte('#eeeeee'),
			},
		);
		expect(r.status).toBe(201);
		expect(mockExecute).toHaveBeenCalledTimes(2);
		expect(mockRefund).not.toHaveBeenCalled();
	});
});
