import { describe, expect, it } from 'vitest';
import { parseVectorizeParams } from '@/lib/vectorize.js';

describe('parseVectorizeParams — campos numéricos opcionais', () => {
	// A armadilha: os campos chegam por multipart, sempre como string. Um
	// `String(null)` no chamador vira "null", que é TRUTHY — `parseFloat("null")`
	// é NaN e o clamp o preserva (NaN falha as duas comparações). O sharp então
	// recebia `.blur(NaN)`. Vale pra qualquer string malformada de qualquer
	// cliente, não só pro caso interno que expôs isto.
	const LIXO = ['null', 'undefined', 'abc', 'NaN'];

	for (const raw of LIXO) {
		it(`"${raw}" vira null, não NaN`, () => {
			const p = parseVectorizeParams({
				blur: raw,
				brightness: raw,
				contrast: raw,
				gamma: raw,
				lineAngle: raw,
				dpi: raw,
				outputWidth: raw,
				outputHeight: raw,
			});
			expect(p.blur).toBeNull();
			expect(p.brightness).toBeNull();
			expect(p.contrast).toBeNull();
			expect(p.gamma).toBeNull();
			expect(p.lineAngle).toBeNull();
			expect(p.dpi).toBeNull();
			expect(p.outputWidth).toBeNull();
			expect(p.outputHeight).toBeNull();
		});
	}

	it('ausente continua null', () => {
		const p = parseVectorizeParams({});
		expect(p.blur).toBeNull();
		expect(p.dpi).toBeNull();
		expect(p.outputWidth).toBeNull();
	});

	it('valores válidos continuam passando e sendo limitados', () => {
		const p = parseVectorizeParams({
			blur: '2.5',
			brightness: '99', // acima do teto → limitado
			gamma: '0.1', // abaixo do piso → limitado
			dpi: '300',
			outputWidth: '150',
		});
		expect(p.blur).toBe(2.5);
		expect(p.brightness).toBe(3.0);
		expect(p.gamma).toBe(1.0);
		expect(p.dpi).toBe(300);
		expect(p.outputWidth).toBe(150);
	});

	it('dpi continua inteiro', () => {
		expect(parseVectorizeParams({ dpi: '150.7' }).dpi).toBe(151);
	});
});
