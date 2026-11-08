import { describe, expect, it } from 'vitest';
import {
	normalizeCardSuggestion,
	normalizePhoneSuggestion,
	normalizePopular,
} from '../src/lib/prompt-studio-assist.js';

describe('normalizeCardSuggestion', () => {
	it('conserta o marcador e filtra formatos desconhecidos', () => {
		const c = normalizeCardSuggestion(
			{
				title: 'Nome em flores',
				category: 'Família',
				description: 'Nome cercado de flores',
				mode: 'texto',
				prompt_script: 'Aquarela com o nome { TEMA } entre flores',
				formats: ['capinha', 'nao-existe'],
				example_temas: ['Ana', 'Lucas', 'Bia', 'Extra'],
			},
			['capinha', 'caneca-325'],
		);
		expect(c?.prompt_script).toBe('Aquarela com o nome {tema} entre flores');
		expect(c?.formats).toEqual(['capinha']);
		expect(c?.example_temas).toHaveLength(3);
	});

	it('acrescenta {tema} quando falta e o card pede texto', () => {
		const c = normalizeCardSuggestion(
			{ title: 'X', prompt_script: 'Arte retrô', mode: 'outro' },
			[],
		);
		expect(c?.mode).toBe('texto');
		expect(c?.prompt_script).toMatch(/Tema: \{tema\}$/);
	});

	it('todos os formatos marcados viram "todos" (lista vazia)', () => {
		const c = normalizeCardSuggestion(
			{ title: 'X', prompt_script: '{tema}', formats: ['a', 'b'] },
			['a', 'b'],
		);
		expect(c?.formats).toEqual([]);
	});

	it('sem título ou prompt não é sugestão', () => {
		expect(normalizeCardSuggestion({ title: 'X' }, [])).toBeNull();
	});
});

describe('normalizePhoneSuggestion', () => {
	const base = {
		found: true,
		label: 'Galaxy A26 5G',
		height_mm: 164,
		width_mm: 77.5,
		corner_radius_mm: 10,
		cameras: [
			{
				shape: 'rect',
				x_mm: 7,
				y_mm: 8,
				w_mm: 17,
				h_mm: 42,
				corner_radius_mm: 8.5,
			},
		],
	};

	it('monta o molde com a câmera e adivinha a marca', () => {
		const p = normalizePhoneSuggestion(base);
		if ('error' in p) throw new Error(p.error);
		expect(p.brand).toBe('Samsung');
		expect(p.template).toMatchObject({ width_mm: 77.5, height_mm: 164 });
		expect(p.template.zones?.[0]).toMatchObject({
			x: 7,
			y: 8,
			w: 17,
			h: 42,
			r: 8.5,
		});
	});

	it('desvira medida deitada e encosta câmera que vaza a borda', () => {
		const p = normalizePhoneSuggestion({
			...base,
			height_mm: 77.5,
			width_mm: 164,
			cameras: [{ x_mm: 70, y_mm: -1, w_mm: 20, h_mm: 30 }],
		});
		if ('error' in p) throw new Error(p.error);
		expect(p.template.width_mm).toBe(77.5);
		expect(p.template.zones?.[0]).toMatchObject({ x: 70, y: 0, w: 7.5 });
	});

	it('recusa medida que não é de celular e modelo não encontrado', () => {
		expect(
			'error' in normalizePhoneSuggestion({ ...base, width_mm: 300 }),
		).toBe(true);
		expect(
			normalizePhoneSuggestion({ found: false, note: 'Não existe' }),
		).toEqual({
			error: 'Não existe',
		});
	});

	it('sem câmera pede o desenho à mão', () => {
		const p = normalizePhoneSuggestion({ ...base, cameras: [] });
		expect('error' in p && p.error).toMatch(/câmera/);
	});
});

describe('normalizePopular', () => {
	it('tira repetidos e os que já existem', () => {
		expect(
			normalizePopular(
				{ models: ['iPhone 16', 'Galaxy A16', 'galaxy a16', 'Moto G85'] },
				['iPhone 16'],
			),
		).toEqual(['Galaxy A16', 'Moto G85']);
	});
});
