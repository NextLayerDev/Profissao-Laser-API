import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wiring do Inverter: cada modo usa o builder certo e recusa vira erro
 * (422 no controller) — NUNCA um fallback que devolva o retângulo preto.
 * Mocka só a fronteira (repositório, storage, fetch do SVG original e os
 * dois builders) — a decisão de roteamento é o que este teste protege, não
 * a morfologia em si (coberta por tests/svg-silhouette-contour.test.ts e
 * tests/svg-invert-bounded.test.ts).
 */

const findByIdForExport = vi.fn();
const upsertInverted = vi.fn();
vi.mock('@/repositories/vector.js', () => ({
	vectorRepository: {
		findByIdForExport: (...a: unknown[]) => findByIdForExport(...a),
		upsertInverted: (...a: unknown[]) => upsertInverted(...a),
	},
}));

const uploadVectorPng = vi.fn();
vi.mock('@/lib/storage.js', () => ({
	uploadVectorPng: (...a: unknown[]) => uploadVectorPng(...a),
}));

const buildSilhouetteContourSvg = vi.fn();
vi.mock('@/lib/svg-silhouette-contour.js', () => ({
	buildSilhouetteContourSvg: (...a: unknown[]) =>
		buildSilhouetteContourSvg(...a),
}));

const invertSvgBoundedBySilhouette = vi.fn();
vi.mock('@/lib/svg-invert-bounded.js', () => ({
	invertSvgBoundedBySilhouette: (...a: unknown[]) =>
		invertSvgBoundedBySilhouette(...a),
}));

const { vectorInvertService } = await import('@/services/vector-invert.js');

const ORIGINAL_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
	'<rect x="5" y="5" width="30" height="30" fill="black"/></svg>';

const CONTOUR_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
	'<image x="0" y="0" width="40" height="40" href="data:image/png;base64,AAAA"/></svg>';

const BOUNDED_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
	'<path fill="#000000" fill-rule="evenodd" d="M4 4H36V36H4Z M5 5H35V35H5Z"/></svg>';

function mockVector(subject: 'photo' | 'logo' | 'color' | null) {
	findByIdForExport.mockResolvedValue({
		id: 'vec-1',
		customer_id: 'cust-1',
		svg_url: 'https://cdn.example.com/vec-1.svg',
		original_name: 'foto.png',
		paid_formats: ['svg'],
		params: { subject },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	uploadVectorPng.mockResolvedValue(
		'https://cdn.example.com/vec-1_inverted.png',
	);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(ORIGINAL_SVG, { status: 200 }),
	);
});

describe('vectorInvertService.invert — modo silhouette', () => {
	it('usa o negativo local quando buildSilhouetteContourSvg aceita (ok:true)', async () => {
		mockVector('photo');
		buildSilhouetteContourSvg.mockResolvedValue({ ok: true, svg: CONTOUR_SVG });

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'silhouette',
		);

		expect(result.error).toBeNull();
		expect(result.data?.mode).toBe('silhouette');
		expect(result.data?.svgContent).toBe(CONTOUR_SVG);
		expect(invertSvgBoundedBySilhouette).not.toHaveBeenCalled();
	});

	it('recusa vira erro 422 — NÃO existe mais fallback pro negate de imagem inteira (retângulo)', async () => {
		mockVector('photo');
		buildSilhouetteContourSvg.mockResolvedValue({
			ok: false,
			reason: 'empty',
		});

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'silhouette',
		);

		expect(result.data).toBeNull();
		expect((result.error as Error)?.message).toBe('invert_unsupported_empty');
	});

	it('não recobra nem cria novo formato pago — paidFormats ecoado sem alteração', async () => {
		mockVector('photo');
		buildSilhouetteContourSvg.mockResolvedValue({ ok: true, svg: CONTOUR_SVG });

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'silhouette',
		);

		expect(result.data?.paidFormats).toEqual(['svg']);
		expect(upsertInverted).not.toHaveBeenCalled();
	});
});

describe('vectorInvertService.invert — modo geometric (delimitado pela silhueta)', () => {
	it('usa invertSvgBoundedBySilhouette e devolve o SVG delimitado', async () => {
		mockVector('logo');
		invertSvgBoundedBySilhouette.mockResolvedValue({
			ok: true,
			svg: BOUNDED_SVG,
			strategy: 'vector',
		});

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'geometric',
		);

		expect(result.error).toBeNull();
		expect(result.data?.mode).toBe('geometric');
		expect(result.data?.svgContent).toBe(BOUNDED_SVG);
		expect(buildSilhouetteContourSvg).not.toHaveBeenCalled();
	});

	it('recusa do bounded vira erro 422 (nunca o retângulo do viewBox)', async () => {
		mockVector('logo');
		invertSvgBoundedBySilhouette.mockResolvedValue({
			ok: false,
			reason: 'multicolor',
		});

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'geometric',
		);

		expect(result.data).toBeNull();
		expect((result.error as Error)?.message).toBe(
			'invert_unsupported_multicolor',
		);
	});
});

describe('vectorInvertService.invert — modo auto', () => {
	it('subject photo → silhueta; subject logo → geométrico', async () => {
		mockVector('photo');
		buildSilhouetteContourSvg.mockResolvedValue({ ok: true, svg: CONTOUR_SVG });
		const photo = await vectorInvertService.invert('cust-1', 'vec-1', 'auto');
		expect(photo.data?.mode).toBe('silhouette');

		vi.clearAllMocks();
		uploadVectorPng.mockResolvedValue(
			'https://cdn.example.com/vec-1_inverted.png',
		);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(ORIGINAL_SVG, { status: 200 }),
		);
		mockVector('logo');
		invertSvgBoundedBySilhouette.mockResolvedValue({
			ok: true,
			svg: BOUNDED_SVG,
			strategy: 'vector',
		});
		const logo = await vectorInvertService.invert('cust-1', 'vec-1', 'auto');
		expect(logo.data?.mode).toBe('geometric');
	});
});
