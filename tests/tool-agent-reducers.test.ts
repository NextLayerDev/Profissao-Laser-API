import { beforeAll, describe, expect, it } from 'vitest';
import { type AgentCatalog, applyAgentTool } from '@/lib/tool-agent-tools.js';
import type { ToolDefinitionDoc } from '@/lib/tool-definitions.js';
import { registerCoreBlocks } from '@/tool-blocks/index.js';

// O tool `validate` usa o registry REAL (validateDefinition). Garante os blocos.
beforeAll(() => registerCoreBlocks());

/** Catálogo de teste (espelha ids reais do registry; required controlado aqui). */
const CAT: AgentCatalog = {
	blocks: [
		{
			id: 'image.input',
			label: 'Imagem',
			params: [
				{ name: 'from', kind: 'ref', refType: 'buffer', required: true },
			],
			outputs: [{ name: 'buffer', type: 'buffer' }],
		},
		{
			id: 'util.text_template',
			label: 'Texto',
			params: [
				{ name: 'a', kind: 'ref', refType: 'string', required: true },
				{
					name: 'template',
					kind: 'literal',
					valueType: 'string',
					default: 'Olá {{a}}',
				},
			],
			outputs: [{ name: 'text', type: 'string' }],
		},
		{
			id: 'laser.photoengrave',
			label: 'Gravação',
			params: [
				{ name: 'image', kind: 'ref', refType: 'buffer', required: true },
				{
					name: 'material',
					kind: 'literal',
					valueType: 'enum',
					options: ['wood', 'acrylic'],
					default: 'wood',
				},
			],
			outputs: [{ name: 'png', type: 'buffer' }],
		},
	],
};

const apply = (
	doc: ToolDefinitionDoc,
	name: string,
	input: Record<string, unknown>,
) => applyAgentTool(doc, CAT, name, input);

/** Aplica em sequência, propagando o doc mutado; falha o teste em erro inesperado. */
function chain(steps: [string, Record<string, unknown>][]): ToolDefinitionDoc {
	let doc: ToolDefinitionDoc = {} as ToolDefinitionDoc;
	for (const [name, input] of steps) {
		const out = apply(doc, name, input);
		if (out.error) throw new Error(`${name} falhou: ${out.result}`);
		if (out.doc) doc = out.doc;
	}
	return doc;
}

describe('add_input', () => {
	it('cria o campo e um control visível', () => {
		const out = apply({} as ToolDefinitionDoc, 'add_input', {
			name: 'nome',
			type: 'string',
			label: 'Seu nome',
			required: true,
		});
		expect(out.error).toBeFalsy();
		const doc = out.doc as ToolDefinitionDoc;
		expect(doc.input?.nome).toMatchObject({ type: 'string', required: true });
		const controls = (doc.ui as { controls?: { bind: string }[] }).controls;
		expect(controls?.some((c) => c.bind === 'input.nome')).toBe(true);
	});

	it('recusa nome inválido', () => {
		const out = apply({} as ToolDefinitionDoc, 'add_input', {
			name: '2 espaços',
			type: 'string',
		});
		expect(out.error).toBe(true);
	});
});

describe('add_block', () => {
	it('gera id único e pré-preenche literais default', () => {
		const doc = chain([
			['add_block', { block_id: 'laser.photoengrave' }],
			['add_block', { block_id: 'laser.photoengrave' }],
		]);
		const ids = (doc.pipeline ?? []).map((n) => n.id);
		expect(ids).toEqual(['photoengrave', 'photoengrave2']);
		expect(doc.pipeline?.[0].params).toMatchObject({ material: 'wood' });
	});

	it("evita a cabeça reservada 'input' ao nomear o nó", () => {
		const out = apply({} as ToolDefinitionDoc, 'add_block', {
			block_id: 'image.input',
		});
		expect(out.doc?.pipeline?.[0].id).toBe('entrada');
	});

	it('recusa block_id fora do catálogo', () => {
		const out = apply({} as ToolDefinitionDoc, 'add_block', {
			block_id: 'nao.existe',
		});
		expect(out.error).toBe(true);
	});
});

describe('connect', () => {
	const base = (): ToolDefinitionDoc =>
		chain([
			['add_input', { name: 'nome', type: 'string', required: true }],
			['add_block', { block_id: 'util.text_template', node_id: 'txt' }],
		]);

	it('liga input → param e grava a fonte como string', () => {
		const out = apply(base(), 'connect', {
			node_id: 'txt',
			param: 'a',
			source: 'input.nome',
		});
		expect(out.error).toBeFalsy();
		expect(out.doc?.pipeline?.[0].params?.a).toBe('input.nome');
	});

	it('recusa fonte inexistente', () => {
		const out = apply(base(), 'connect', {
			node_id: 'txt',
			param: 'a',
			source: 'input.fantasma',
		});
		expect(out.error).toBe(true);
	});

	it('recusa tipo incompatível (buffer → string)', () => {
		const doc = chain([
			['add_block', { block_id: 'image.input', node_id: 'img' }],
			['add_block', { block_id: 'util.text_template', node_id: 'txt' }],
		]);
		const out = apply(doc, 'connect', {
			node_id: 'txt',
			param: 'a',
			source: 'img.buffer',
		});
		expect(out.error).toBe(true);
	});

	it('recusa ligar a uma etapa POSTERIOR (ordem linear)', () => {
		// txt antes de img → img.buffer é fonte posterior pra txt
		const doc = chain([
			['add_block', { block_id: 'util.text_template', node_id: 'txt' }],
			['add_block', { block_id: 'image.input', node_id: 'img' }],
		]);
		const out = apply(doc, 'connect', {
			node_id: 'txt',
			param: 'a',
			source: 'img.buffer',
		});
		expect(out.error).toBe(true);
	});
});

describe('set_billing', () => {
	it('aceita custo válido', () => {
		const out = apply({} as ToolDefinitionDoc, 'set_billing', { vox_cost: 5 });
		expect(out.error).toBeFalsy();
		expect(out.doc?.billing?.vox_cost).toBe(5);
	});

	it('recusa custo negativo', () => {
		const out = apply({} as ToolDefinitionDoc, 'set_billing', {
			vox_cost: -1,
		});
		expect(out.error).toBe(true);
	});
});

describe('remove_block', () => {
	it('remove o nó e limpa refs órfãs', () => {
		const doc = chain([
			['add_input', { name: 'nome', type: 'string' }],
			['add_block', { block_id: 'util.text_template', node_id: 'txt' }],
			['connect', { node_id: 'txt', param: 'a', source: 'input.nome' }],
			['add_block', { block_id: 'util.text_template', node_id: 'txt2' }],
			['connect', { node_id: 'txt2', param: 'a', source: 'txt.text' }],
		]);
		const out = apply(doc, 'remove_block', { node_id: 'txt' });
		expect(out.error).toBeFalsy();
		const remaining = out.doc?.pipeline ?? [];
		expect(remaining.map((n) => n.id)).toEqual(['txt2']);
		// a ref txt2.a → txt.text ficou órfã e foi limpa
		expect(remaining[0].params?.a).toBeUndefined();
	});
});

describe('remove_input (não derruba OUTRAS refs de input)', () => {
	it('remove só o campo alvo; preserva refs a outros campos', () => {
		const doc = chain([
			['add_input', { name: 'a', type: 'string' }],
			['add_input', { name: 'b', type: 'string' }],
			['add_block', { block_id: 'util.text_template', node_id: 't1' }],
			['connect', { node_id: 't1', param: 'a', source: 'input.a' }],
			['add_block', { block_id: 'util.text_template', node_id: 't2' }],
			['connect', { node_id: 't2', param: 'a', source: 'input.b' }],
		]);
		const out = apply(doc, 'remove_input', { name: 'a' });
		expect(out.error).toBeFalsy();
		const nodes = out.doc?.pipeline ?? [];
		// t1.a apontava pra input.a (removido) → limpo
		expect(nodes.find((n) => n.id === 't1')?.params?.a).toBeUndefined();
		// t2.a apontava pra input.b (intacto) → PRESERVADO (regressão H1)
		expect(nodes.find((n) => n.id === 't2')?.params?.a).toBe('input.b');
	});

	it('limpa saída que apontava pro campo removido (regressão H2)', () => {
		const doc = chain([
			['add_input', { name: 'a', type: 'string' }],
			['set_output', { primary: 'input.a' }],
		]);
		const out = apply(doc, 'remove_input', { name: 'a' });
		const output = (out.doc?.output ?? {}) as Record<string, unknown>;
		expect(output.primary).toBeUndefined();
	});
});

describe('validate (registry real)', () => {
	it('aprova uma ferramenta completa', () => {
		const doc = chain([
			['add_input', { name: 'nome', type: 'string', required: true }],
			['add_block', { block_id: 'util.text_template', node_id: 'txt' }],
			['connect', { node_id: 'txt', param: 'a', source: 'input.nome' }],
			['set_output', { primary: 'txt.text' }],
		]);
		const out = apply(doc, 'validate', {});
		expect(out.result).toMatch(/válida/i);
	});

	it('reporta required não-ligado e falta de resultado', () => {
		const doc = chain([
			['add_input', { name: 'nome', type: 'string' }],
			['add_block', { block_id: 'util.text_template', node_id: 'txt' }],
		]);
		const out = apply(doc, 'validate', {});
		expect(out.result).toMatch(/Problemas/);
		expect(out.result).toMatch(/não ligada/i);
		expect(out.result).toMatch(/Resultado/i);
	});
});

describe('finish / ask_user', () => {
	it('finish sinaliza done', () => {
		const out = apply({} as ToolDefinitionDoc, 'finish', {});
		expect(out.done).toBe(true);
	});
	it('ask_user sinaliza needsInput', () => {
		const out = apply({} as ToolDefinitionDoc, 'ask_user', {
			question: 'Qual material?',
		});
		expect(out.needsInput).toBe(true);
	});
});
