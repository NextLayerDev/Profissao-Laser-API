import { describe, expect, it } from 'vitest';
import { voxesFromUsage } from '@/lib/tool-agent-metering.js';

// Sem env: defaults Sonnet 4.6 (in 3, out 15, cacheWrite 3.75, cacheRead 0.3
// USD/Mtok), VOX_USD 0.1, MARKUP 3, GRAN 0.05.

describe('voxesFromUsage (token→vox com markup)', () => {
	it('turno sem tokens não custa nada', () => {
		expect(voxesFromUsage({ in: 0, out: 0, cw: 0, cr: 0 })).toBe(0);
	});

	it('1M tokens de input = 3 USD → 90 vox (3/0.1*3)', () => {
		expect(voxesFromUsage({ in: 1_000_000, out: 0, cw: 0, cr: 0 })).toBe(90);
	});

	it('soma cache_write e cache_read com preços distintos', () => {
		// cw 1M = 3.75 USD, cr 1M = 0.30 USD → 4.05 USD → /0.1*3 = 121.5 vox
		expect(
			voxesFromUsage({ in: 0, out: 0, cw: 1_000_000, cr: 1_000_000 }),
		).toBe(121.5);
	});

	it('arredonda PRA CIMA até o passo (GRAN 0.05)', () => {
		// out 100 = 0.0015 USD → raw 0.045 → ceil(0.9)*0.05 = 0.05
		expect(voxesFromUsage({ in: 0, out: 100, cw: 0, cr: 0 })).toBe(0.05);
	});

	it('qualquer uso > 0 custa pelo menos um passo (0.05)', () => {
		expect(voxesFromUsage({ in: 1, out: 0, cw: 0, cr: 0 })).toBe(0.05);
	});

	it('nunca é negativo nem NaN', () => {
		const v = voxesFromUsage({ in: 2000, out: 1500, cw: 4000, cr: 12000 });
		expect(v).toBeGreaterThan(0);
		expect(Number.isFinite(v)).toBe(true);
	});
});
