import { describe, expect, it } from 'vitest';
import { coerceInputs } from '@/lib/tool-engine.js';

const dxf = Buffer.from('0\nSECTION\n');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('coerceInputs — input type:"file"', () => {
	it('põe o Buffer na bag junto de __filename e __mime', () => {
		const bag = coerceInputs(
			{ arquivo: { type: 'file', required: true, accept: ['dxf'] } },
			{},
			{ arquivo: dxf },
			{ arquivo: { filename: 'peca.dxf', mime: 'application/octet-stream' } },
		);
		expect(bag['input.arquivo']).toBe(dxf);
		expect(bag['input.arquivo__filename']).toBe('peca.dxf');
		expect(bag['input.arquivo__mime']).toBe('application/octet-stream');
	});

	it('publica __filename/__mime nulos quando não há metadado', () => {
		const bag = coerceInputs(
			{ arquivo: { type: 'file' } },
			{},
			{ arquivo: dxf },
		);
		expect(bag['input.arquivo__filename']).toBeNull();
		expect(bag['input.arquivo__mime']).toBeNull();
	});

	it('exige o arquivo quando required', () => {
		expect(() =>
			coerceInputs({ arquivo: { type: 'file', required: true } }, {}, {}),
		).toThrow(/obrigatório/);
	});

	it('aceita ausência quando não é required', () => {
		const bag = coerceInputs({ arquivo: { type: 'file' } }, {}, {});
		expect(bag['input.arquivo']).toBeNull();
	});

	it('NÃO participa do fallback de 1 imagem', () => {
		// O fallback existe para foto (fieldname genérico). Aplicá-lo a um input
		// de arquivo faria um DXF cair num input errado e gerar um orçamento
		// silenciosamente errado — por isso é restrito a `type:'image'`.
		const bag = coerceInputs(
			{ arquivo: { type: 'file' } },
			{},
			{ campo_generico: dxf },
		);
		expect(bag['input.arquivo']).toBeNull();
	});

	it('o fallback de 1 imagem continua valendo para type:"image"', () => {
		const bag = coerceInputs(
			{ foto: { type: 'image' } },
			{},
			{ campo_generico: png },
		);
		expect(bag['input.foto']).toBe(png);
	});

	it('convive com imagem e arquivo na mesma tool', () => {
		const bag = coerceInputs(
			{ foto: { type: 'image' }, arquivo: { type: 'file' } },
			{},
			{ foto: png, arquivo: dxf },
			{ arquivo: { filename: 'x.dxf' } },
		);
		expect(bag['input.foto']).toBe(png);
		expect(bag['input.arquivo']).toBe(dxf);
	});

	it('tolera `files` ausente ou nulo sem lançar', () => {
		// Regressão: `Object.entries(null)` derrubava o run com um TypeError opaco.
		expect(() =>
			coerceInputs({ v: { type: 'number' } }, { v: '7' }),
		).not.toThrow();
		expect(() =>
			coerceInputs({ v: { type: 'number' } }, { v: '7' }, null),
		).not.toThrow();
		const bag = coerceInputs({ v: { type: 'number' } }, { v: '7' }, null);
		expect(bag['input.v']).toBe(7);
	});
});
