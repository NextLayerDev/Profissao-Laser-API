import { describe, expect, it } from 'vitest';
import {
	outlineMarginPx,
	scaleAbsolutePathD,
	traceMaskToPathD,
} from '@/lib/svg-outline-trace.js';

describe('scaleAbsolutePathD', () => {
	it('identidade preserva os valores', () => {
		const d = 'M10 10L90 10C80 20 70 30 60 40Z';
		expect(scaleAbsolutePathD(d, 1, 1, 0, 0)).toBe(d);
	});

	it('aplica escala e deslocamento por eixo', () => {
		expect(scaleAbsolutePathD('M10 20L30 40Z', 2, 0.5, 5, -10)).toBe(
			'M25 0L65 10Z',
		);
	});

	it('H escala só x; V escala só y', () => {
		expect(scaleAbsolutePathD('M0 0H100V50Z', 2, 3, 1, 2)).toBe(
			'M1 2H201V152Z',
		);
	});

	it('pares implícitos após M viram lineto', () => {
		expect(scaleAbsolutePathD('M0 0 10 10 20 20Z', 1, 1, 0, 0)).toBe(
			'M0 0L10 10L20 20Z',
		);
	});

	it('lança em comando relativo ou não suportado — nunca transforma errado em silêncio', () => {
		expect(() => scaleAbsolutePathD('m10 10l5 5Z', 1, 1, 0, 0)).toThrow();
		expect(() => scaleAbsolutePathD('M0 0Q10 10 20 20', 1, 1, 0, 0)).toThrow();
		expect(() =>
			scaleAbsolutePathD('M0 0A5 5 0 0 1 10 10', 1, 1, 0, 0),
		).toThrow();
	});
});

describe('outlineMarginPx', () => {
	it('fica no clamp fino [2, 10]', () => {
		expect(outlineMarginPx(100)).toBe(2); // 0.4 → piso
		expect(outlineMarginPx(1600)).toBe(6);
		expect(outlineMarginPx(10000)).toBe(10); // 40 → teto
	});
});

describe('traceMaskToPathD', () => {
	function circleMask(W: number, H: number, cx: number, cy: number, r: number) {
		const mask = new Uint8Array(W * H);
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const dx = x - cx;
				const dy = y - cy;
				if (dx * dx + dy * dy <= r * r) mask[y * W + x] = 1;
			}
		}
		return mask;
	}

	it('círculo → um subpath fechado, sem arcos, coords dentro do quadro', async () => {
		const d = await traceMaskToPathD(
			circleMask(200, 200, 100, 100, 60),
			200,
			200,
			{
				turdSize: 2,
			},
		);
		expect(d.length).toBeGreaterThan(0);
		expect(d.startsWith('M')).toBe(true);
		expect(d).not.toMatch(/[Aa]\d/); // svgToDxf ignora arcos
		const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
		expect(nums.length).toBeGreaterThan(4);
		for (const n of nums) {
			expect(n).toBeGreaterThanOrEqual(-1);
			expect(n).toBeLessThanOrEqual(201);
		}
	});

	it('dois blobs → dois subpaths (dois M)', async () => {
		const mask = new Uint8Array(300 * 300);
		const put = (cx: number, cy: number, r: number) => {
			for (let y = cy - r; y <= cy + r; y++) {
				for (let x = cx - r; x <= cx + r; x++) mask[y * 300 + x] = 1;
			}
		};
		put(70, 70, 40);
		put(220, 220, 40);
		const d = await traceMaskToPathD(mask, 300, 300, { turdSize: 2 });
		expect((d.match(/M/g) ?? []).length).toBe(2);
	});

	it('máscara vazia → d vazio (chamador decide o fallback)', async () => {
		const d = await traceMaskToPathD(new Uint8Array(100 * 100), 100, 100);
		expect(d).toBe('');
	});
});
