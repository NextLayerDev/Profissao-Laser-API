import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A TIRAGEM é o que fecha o buraco da volumetria: 50 peças passam a ser 50
 * códigos e 50 créditos, em vez de uma arte genérica gravada 50 vezes.
 *
 * O que estes testes prendem é a IDEMPOTÊNCIA. Uma retentativa que regerasse os
 * códigos transformaria em órfão todo QR de peça já entregue ao aluno — e essas
 * peças podem já estar gravadas em acrílico.
 */

type Linha = Record<string, unknown>;

const banco: Linha[] = [];
let falharInsert: string | null = null;

/** Dublê do supabase: guarda linhas em memória e respeita o unique do lote. */
function consulta() {
	const filtros: [string, unknown][] = [];
	let inseridas: Linha[] | null = null;
	const q: Record<string, unknown> = {
		select: () => q,
		insert: (linhas: Linha[]) => {
			inseridas = linhas;
			return q;
		},
		eq: (col: string, val: unknown) => {
			filtros.push([col, val]);
			return q;
		},
		order: () => q,
		/* O construtor de consulta do supabase É thenable: `await
		   supabase.from(x).select().eq(...)` resolve sem método terminal. */
		// biome-ignore lint/suspicious/noThenProperty: dublê de um objeto thenable
		then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
			if (inseridas) {
				if (falharInsert) {
					return Promise.resolve({ error: { code: falharInsert } }).then(
						ok,
						falha,
					);
				}
				for (const l of inseridas) {
					const colide = banco.some(
						(b) =>
							b.invocation_id === l.invocation_id &&
							b.piece_index === l.piece_index,
					);
					if (colide) {
						return Promise.resolve({ error: { code: '23505' } }).then(
							ok,
							falha,
						);
					}
				}
				banco.push(
					...inseridas.map((l, i) => ({
						...l,
						id: `id-${banco.length + i}`,
						created_at: '2026-08-19T00:00:00Z',
						revoked_at: null,
						archived_at: null,
					})),
				);
				return Promise.resolve({ error: null }).then(ok, falha);
			}
			const data = banco.filter((b) => filtros.every(([c, v]) => b[c] === v));
			return Promise.resolve({ data, error: null }).then(ok, falha);
		},
	};
	return q;
}

vi.mock('@/lib/supabase.js', () => ({ supabase: { from: () => consulta() } }));

const { emitirLote } = await import('@/repositories/licensed-art.js');

const base = {
	customerId: 'aluno-1',
	featureKey: 'clube:corinthians',
	licensorName: 'Corinthians',
	toolKey: 'arte_licenciada',
	invocationId: 'inv-1',
	promptTitle: 'Chaveiro',
	batchId: 'lote-1',
};

beforeEach(() => {
	banco.length = 0;
	falharInsert = null;
});

describe('emissão em lote', () => {
	it('emite N peças, uma por índice, com códigos distintos', async () => {
		const pecas = await emitirLote({ ...base, tamanho: 10 });

		expect(pecas).toHaveLength(10);
		expect(pecas.map((p) => p.piece_index)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
		expect(new Set(pecas.map((p) => p.code)).size).toBe(10);
		expect(pecas.every((p) => p.batch_size === 10)).toBe(true);
	});

	it('a retentativa devolve os MESMOS códigos e não insere nada', async () => {
		const primeira = await emitirLote({ ...base, tamanho: 10 });
		const segunda = await emitirLote({ ...base, tamanho: 10 });

		expect(segunda.map((p) => p.code)).toEqual(primeira.map((p) => p.code));
		expect(banco).toHaveLength(10);
	});

	it('retentativa PARCIAL completa o que falta sem regerar o que existe', async () => {
		// A peça 7 já foi entregue ao aluno; trocar o código dela deixaria o QR
		// dela órfão.
		const parcial = await emitirLote({ ...base, tamanho: 3 });
		const antes = parcial.map((p) => p.code);

		const completo = await emitirLote({ ...base, tamanho: 10 });

		expect(completo).toHaveLength(10);
		expect(completo.slice(0, 3).map((p) => p.code)).toEqual(antes);
		expect(banco).toHaveLength(10);
	});

	it('quem perde a corrida lê o lote do vencedor', async () => {
		// O vencedor gravou; o insert do perdedor bate no unique do banco.
		await emitirLote({ ...base, tamanho: 5 });
		falharInsert = '23505';

		const lido = await emitirLote({ ...base, tamanho: 5 });
		expect(lido).toHaveLength(5);
		expect(banco).toHaveLength(5);
	});

	it('erro que NÃO é colisão sobe — não vira lote silenciosamente vazio', async () => {
		falharInsert = '42703';
		await expect(emitirLote({ ...base, tamanho: 3 })).rejects.toThrow(
			/emitirLote/,
		);
	});

	it('lote de uma peça é o caso de sempre, sem nada de especial', async () => {
		const pecas = await emitirLote({ ...base, tamanho: 1 });
		expect(pecas).toHaveLength(1);
		expect(pecas[0].piece_index).toBe(1);
		expect(pecas[0].batch_size).toBe(1);
	});
});
