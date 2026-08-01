import { describe, expect, it } from 'vitest';
import {
	type CollectionConfig,
	collectionFacets,
	isFieldApplicable,
	renderCollectionEntry,
	resolveCollection,
	validateCollectionData,
} from '@/lib/tool-collections.js';

/** Recorte da coleção real do Metallic — o caso que motiva o desenho. */
const receitas: CollectionConfig = {
	label: 'Receitas de corte',
	fields: [
		{
			name: 'material',
			type: 'enum',
			options: ['aco_carbono', 'aco_inox'],
			required: true,
			facet: true,
		},
		{
			name: 'espessura_mm',
			type: 'number',
			required: true,
			facet: 'range',
			unit: 'mm',
			min: 0.1,
			max: 50,
		},
		{
			name: 'operacao',
			type: 'enum',
			options: ['corte', 'gravacao'],
			required: true,
			facet: true,
		},
		{ name: 'velocidade_mm_s', type: 'number', required: true },
		{ name: 'potencia_w', type: 'int', facet: 'range', unit: 'W' },
		// Só existem quando a operação é corte.
		{
			name: 'gas',
			type: 'enum',
			options: ['ar', 'o2', 'n2'],
			required: true,
			showIf: { operacao: 'corte' },
		},
		{ name: 'pressao_bar', type: 'number', showIf: { operacao: 'corte' } },
		{ name: 'observacoes', type: 'textarea' },
	],
	rag: {
		enabled: true,
		template:
			'{data.material} {data.espessura_mm}mm · {data.operacao} · {data.velocidade_mm_s}mm/s · gás {data.gas}',
	},
};

describe('resolveCollection', () => {
	it('acha a coleção declarada', () => {
		expect(
			resolveCollection({ collections: { receitas } }, 'receitas').label,
		).toBe('Receitas de corte');
	});

	it('serve o `bank` legado como collections.default', () => {
		// Retrocompatibilidade: o Prompts Mágicos precisa continuar funcionando
		// pela API de coleções sem nenhuma mudança na definition dele.
		const c = resolveCollection(
			{
				bank: {
					enabled: true,
					fields: [{ name: 'prompt_script', type: 'textarea' }],
				},
			},
			'default',
		);
		expect(c.fields).toHaveLength(1);
		expect(c.submissions?.who).toBe('admin');
	});

	it('404 em coleção inexistente', () => {
		expect(() => resolveCollection({}, 'naoexiste')).toThrow(/não existe/);
	});

	it('400 em nome inválido (vira rota e chave de índice)', () => {
		expect(() =>
			resolveCollection({ collections: { receitas } }, '../etc'),
		).toThrow(/inválido/);
		expect(() =>
			resolveCollection({ collections: { receitas } }, 'Maiuscula'),
		).toThrow();
	});
});

describe('showIf', () => {
	const gas = receitas.fields.find((f) => f.name === 'gas')!;

	it('aplica quando a condição bate', () => {
		expect(isFieldApplicable(gas, { operacao: 'corte' })).toBe(true);
	});

	it('não aplica quando não bate', () => {
		expect(isFieldApplicable(gas, { operacao: 'gravacao' })).toBe(false);
	});

	it('campo sem showIf sempre se aplica', () => {
		const m = receitas.fields.find((f) => f.name === 'material')!;
		expect(isFieldApplicable(m, {})).toBe(true);
	});
});

describe('validateCollectionData', () => {
	const base = {
		material: 'aco_carbono',
		espessura_mm: '3',
		operacao: 'corte',
		velocidade_mm_s: '45',
		gas: 'o2',
	};

	it('coage strings do multipart/CSV para número', () => {
		const out = validateCollectionData(receitas.fields, base);
		expect(out.espessura_mm).toBe(3);
		expect(out.velocidade_mm_s).toBe(45);
	});

	it('exige campo condicional quando a condição bate', () => {
		const { gas: _omitido, ...semGas } = base;
		expect(() => validateCollectionData(receitas.fields, semGas)).toThrow(
			/gas/,
		);
	});

	it('NÃO exige campo condicional quando a condição não bate', () => {
		const out = validateCollectionData(receitas.fields, {
			material: 'aco_inox',
			espessura_mm: 2,
			operacao: 'gravacao',
			velocidade_mm_s: 800,
		});
		expect(out.gas).toBeUndefined();
		expect(out.operacao).toBe('gravacao');
	});

	it('descarta campo não declarado (ninguém injeta chave no jsonb)', () => {
		const out = validateCollectionData(receitas.fields, {
			...base,
			hackzor: 'drop table',
		});
		expect(out.hackzor).toBeUndefined();
	});

	it('rejeita valor fora do enum', () => {
		expect(() =>
			validateCollectionData(receitas.fields, { ...base, material: 'madeira' }),
		).toThrow(/material/);
	});

	it('respeita min/max', () => {
		expect(() =>
			validateCollectionData(receitas.fields, { ...base, espessura_mm: 999 }),
		).toThrow(/espessura/i);
	});

	it('acumula TODOS os erros, não só o primeiro', () => {
		try {
			validateCollectionData(receitas.fields, { operacao: 'corte' });
			throw new Error('deveria ter lançado');
		} catch (e) {
			const msg = (e as Error).message;
			expect(msg).toContain('material');
			expect(msg).toContain('espessura_mm');
			expect(msg).toContain('gas');
		}
	});

	it('exige inteiro em type:int', () => {
		expect(() =>
			validateCollectionData(receitas.fields, { ...base, potencia_w: 1500.5 }),
		).toThrow(/potencia/i);
	});
});

describe('collectionFacets', () => {
	it('deriva facetas de fields[].facet, com tipo e unidade', () => {
		const f = collectionFacets(receitas);
		expect(f.map((x) => x.name)).toEqual([
			'material',
			'espessura_mm',
			'operacao',
			'potencia_w',
		]);
		expect(f[1]).toMatchObject({ kind: 'range', unit: 'mm' });
		expect(f[0]).toMatchObject({
			kind: 'enum',
			options: ['aco_carbono', 'aco_inox'],
		});
	});
});

describe('renderCollectionEntry', () => {
	it('renderiza pelo template do rag', () => {
		const txt = renderCollectionEntry(receitas, {
			title: 'Aço 3mm',
			data: {
				material: 'aco_carbono',
				espessura_mm: 3,
				operacao: 'corte',
				velocidade_mm_s: 45,
				gas: 'o2',
			},
		});
		expect(txt).toBe('aco_carbono 3mm · corte · 45mm/s · gás o2');
	});

	it('não deixa buraco quando um campo opcional falta', () => {
		// Sem colapsar espaço e separador, sairia "… · 45mm/s · gás " — lixo no RAG.
		const txt = renderCollectionEntry(receitas, {
			title: 'Gravação',
			data: {
				material: 'aco_inox',
				espessura_mm: 2,
				operacao: 'gravacao',
				velocidade_mm_s: 800,
			},
		});
		expect(txt).toBe('aco_inox 2mm · gravacao · 800mm/s · gás');
		expect(txt).not.toMatch(/\s{2,}/);
	});

	it('sem template, monta rótulo: valor dos campos presentes', () => {
		const txt = renderCollectionEntry(
			{ fields: receitas.fields },
			{ title: 'X', description: 'desc', data: { material: 'aco_inox' } },
		);
		expect(txt).toContain('X');
		expect(txt).toContain('desc');
		expect(txt).toContain('material: aco_inox');
	});
});
