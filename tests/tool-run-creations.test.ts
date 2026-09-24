import { describe, expect, it } from 'vitest';
import {
	resolveCreation,
	resolveVariationCount,
	unidadesDaInvocacao,
	variacoesAEntregar,
	variacoesPagas,
} from '@/lib/tool-creations.js';
import type { Creation, ToolDefinitionDoc } from '@/lib/tool-definitions.js';
import { ToolEngineError } from '@/lib/tool-errors.js';

const mkCreations = (): Creation[] => [
	{ id: 'copos-360', label: 'Copos 360º', width: 2000, height: 1000 },
	{ id: 'copos-180', label: 'Copos 180º', width: 1500, height: 1000 },
	{
		id: 'capinhas',
		label: 'Capinhas',
		width: 1000,
		height: 1000,
		active: false,
	},
];

describe('resolveCreation', () => {
	it('devolve W×H da creation escolhida', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(resolveCreation(doc, 'copos-360')).toEqual({
			width: 2000,
			height: 1000,
		});
		expect(resolveCreation(doc, 'copos-180')).toEqual({
			width: 1500,
			height: 1000,
		});
	});

	it('rejeita (400) quando a tool tem creations mas o cliente não escolheu nenhuma', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(() => resolveCreation(doc, undefined)).toThrow(ToolEngineError);
		try {
			resolveCreation(doc, undefined);
		} catch (e) {
			expect((e as ToolEngineError).status).toBe(400);
			expect((e as ToolEngineError).message).toContain('tipo de criação');
		}
	});

	it('rejeita (400) creation_id inexistente', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(() => resolveCreation(doc, 'inexistente')).toThrow(ToolEngineError);
	});

	it('rejeita (400) creation_id inativo (active:false)', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(() => resolveCreation(doc, 'capinhas')).toThrow(ToolEngineError);
	});

	it('legado: tool sem creations devolve undefined (cai em image_width/height)', () => {
		const doc = { creations: undefined } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		// Não lança mesmo sem creation_id.
		expect(resolveCreation(doc, undefined)).toEqual({
			width: undefined,
			height: undefined,
		});
		expect(resolveCreation(doc, 'whatever')).toEqual({
			width: undefined,
			height: undefined,
		});
	});
});

describe('resolveVariationCount', () => {
	/**
	 * O default é 1 porque o default do `/invoke` é 1 (`variation_count ?? 1`,
	 * api-upvox). Era `allowed[0]`, e com `return_variations: [2,4]` — que a
	 * Fábrica deixa salvar — o cliente que não manda o campo pagava por 1 e o
	 * motor resolvia 2: a reconciliação reduziria TODO run, para sempre, sem
	 * que recarregar a página resolvesse nada. Os dois lados agora derivam o
	 * mesmo número da mesma ausência.
	 */
	it('default = 1, o mesmo default do /invoke — não o 1º do allowlist', () => {
		expect(resolveVariationCount(undefined, [1, 2, 4])).toBe(1);
		expect(resolveVariationCount(undefined, [2, 4])).toBe(1);
		expect(resolveVariationCount(undefined, [])).toBe(1); // allowlist vazia → 1
	});

	it('aceita valor dentro do allowlist', () => {
		expect(resolveVariationCount('1', [1, 2, 4])).toBe(1);
		expect(resolveVariationCount('2', [1, 2, 4])).toBe(2);
		expect(resolveVariationCount('4', [1, 2, 4])).toBe(4);
	});

	it('rejeita (400) valor fora do allowlist', () => {
		expect(() => resolveVariationCount('3', [1, 2, 4])).toThrow(
			ToolEngineError,
		);
		expect(() => resolveVariationCount('5', [1, 2, 4])).toThrow(
			ToolEngineError,
		);
		expect(() => resolveVariationCount('abc', [1, 2, 4])).toThrow(
			ToolEngineError,
		);
	});

	it('rejeita (400) quando allowlist não inclui 1 e o cliente manda 1', () => {
		// Admin pode querer só [2,4] (sem 1x) — 1x deve ser rejeitado.
		expect(() => resolveVariationCount('1', [2, 4])).toThrow(ToolEngineError);
	});
});

/**
 * A aritmética que fecha o furo "paguei 1, pedi 4". `null` significa "não dá
 * para saber", e o motor trata isso como AUTORIZADO de propósito — recusar no
 * escuro quebraria aluno pagante, que é pior que a fraude.
 */
describe('variacoesPagas', () => {
	const base = { voxesSpent: 0, quotaConsumed: 0, voxCost: 0.5 };

	it('lê quantas variações o voxxy gasto pagou', () => {
		expect(variacoesPagas({ ...base, voxesSpent: 0.5 })).toBe(1);
		expect(variacoesPagas({ ...base, voxesSpent: 1 })).toBe(2);
		expect(variacoesPagas({ ...base, voxesSpent: 2 })).toBe(4);
	});

	it('sobrevive a preço quebrado (o arredondamento é o mesmo do upvox)', () => {
		// round2(0,3 × 3) = 0,9 · round2(0,07 × 3) = 0,21 · round2(0,015 × 3) = 0,05
		expect(variacoesPagas({ ...base, voxCost: 0.3, voxesSpent: 0.9 })).toBe(3);
		expect(variacoesPagas({ ...base, voxCost: 0.07, voxesSpent: 0.21 })).toBe(
			3,
		);
		expect(variacoesPagas({ ...base, voxCost: 0.015, voxesSpent: 0.05 })).toBe(
			3,
		);
		expect(variacoesPagas({ ...base, voxCost: 0.01, voxesSpent: 0.04 })).toBe(
			4,
		);
	});

	it('cota grátis do plano ⇒ indeterminado (o upvox cobra 1 unidade, não N)', () => {
		expect(
			variacoesPagas({ voxesSpent: 0, quotaConsumed: 1, voxCost: 0.5 }),
		).toBeNull();
	});

	it('invocação 0/0 (conta de teste ilimitada) ⇒ indeterminado', () => {
		expect(variacoesPagas({ ...base, voxesSpent: 0 })).toBeNull();
	});

	it('preço ausente, zero ou inválido ⇒ indeterminado', () => {
		expect(
			variacoesPagas({ ...base, voxesSpent: 0.5, voxCost: undefined }),
		).toBeNull();
		expect(variacoesPagas({ ...base, voxesSpent: 0.5, voxCost: 0 })).toBeNull();
		expect(
			variacoesPagas({ ...base, voxesSpent: 0.5, voxCost: -1 }),
		).toBeNull();
		expect(
			variacoesPagas({ ...base, voxesSpent: 0.5, voxCost: Number.NaN }),
		).toBeNull();
	});

	it('valor pago que não é múltiplo do preço ⇒ indeterminado (preço mexeu)', () => {
		// Pagou 0,5 (preço antigo) e o catálogo hoje diz 0,6: deriva, não fraude.
		expect(
			variacoesPagas({ ...base, voxesSpent: 0.5, voxCost: 0.6 }),
		).toBeNull();
		expect(
			variacoesPagas({ ...base, voxesSpent: 0.7, voxCost: 0.3 }),
		).toBeNull();
	});

	it('valor pago menor que um único uso ⇒ indeterminado, nunca zero', () => {
		// Zero seria "pagou nenhuma" e recusaria até o run de 1 variação.
		expect(
			variacoesPagas({ ...base, voxesSpent: 0.2, voxCost: 0.5 }),
		).toBeNull();
	});
});

describe('variacoesAEntregar', () => {
	const allowed = [1, 2, 4];

	it('indeterminado ("não sei") NUNCA reduz a entrega', () => {
		expect(variacoesAEntregar(4, null, allowed)).toBe(4);
		expect(variacoesAEntregar(1, null, allowed)).toBe(1);
	});

	it('pedido dentro do pago passa intacto', () => {
		expect(variacoesAEntregar(2, 2, allowed)).toBe(2);
		expect(variacoesAEntregar(2, 4, allowed)).toBe(2); // pagou mais, perde o troco
	});

	it('pedido acima do pago cai para o maior do allowlist que cabe', () => {
		expect(variacoesAEntregar(4, 1, allowed)).toBe(1);
		expect(variacoesAEntregar(4, 2, allowed)).toBe(2);
		// pago 3 com allowlist [1,2,4]: entrega 2, nunca 3 (3 não é oferecido)
		expect(variacoesAEntregar(4, 3, allowed)).toBe(2);
	});

	it('nunca desce abaixo de 1, mesmo com allowlist que não começa em 1', () => {
		// `return_variations: [2,4]` + invocação de 1: não há valor do allowlist
		// que caiba. Entregar 1 é o único desfecho que não é nem fraude nem erro.
		expect(variacoesAEntregar(4, 1, [2, 4])).toBe(1);
		expect(variacoesAEntregar(4, 1, [])).toBe(1);
	});
});

/* ─────────────────── o número guardado vence a inferência ─────────────────── */

describe('unidadesDaInvocacao', () => {
	it('usa o número que o upvox guardou, sem precisar do preço', () => {
		// Sem `voxCost` a inferência seria impossível; com `units` a pergunta
		// nem chega a ser feita.
		expect(
			unidadesDaInvocacao({
				units: 4,
				voxesSpent: 20,
				quotaConsumed: 0,
				voxCost: null,
			}),
		).toBe(4);
	});

	it('o número guardado vale mesmo quando a divisão daria outra coisa', () => {
		// É o caso da tiragem: `voxes_spent` carrega geração + licença, e dividir
		// pelo `vox_cost` devolveria um número inventado.
		expect(
			unidadesDaInvocacao({
				units: 1,
				voxesSpent: 19, // 1 de geração + 18 de licença
				quotaConsumed: 0,
				voxCost: 1,
			}),
		).toBe(1);
	});

	it('invocação anterior à coluna cai no caminho antigo, inteiro', () => {
		// Sem `units`: infere pelo pago, exatamente como antes.
		expect(
			unidadesDaInvocacao({ voxesSpent: 2, quotaConsumed: 0, voxCost: 0.5 }),
		).toBe(4);
		// E o "não sei" da cota do plano continua sendo "não sei".
		expect(
			unidadesDaInvocacao({ voxesSpent: 0, quotaConsumed: 1, voxCost: 0.5 }),
		).toBeNull();
	});

	it('units inválido não é confiado — volta a inferir', () => {
		expect(
			unidadesDaInvocacao({
				units: 0,
				voxesSpent: 2,
				quotaConsumed: 0,
				voxCost: 0.5,
			}),
		).toBe(4);
	});
});
