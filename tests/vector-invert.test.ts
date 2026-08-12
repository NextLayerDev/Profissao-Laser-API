import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wiring do modo `silhouette` do Inverter: tenta o negativo local
 * (`buildSilhouetteContourSvg`) primeiro e só cai no raster negate
 * (`rasterNegative`, não mockado — roda de verdade) quando o detector de
 * fragmentação recusa. Mocka só a fronteira (repositório, storage, fetch do
 * SVG original e o próprio `buildSilhouetteContourSvg`) — a decisão de qual
 * caminho usar é o que este teste protege, não a morfologia em si (isso já é
 * coberto por tests/svg-silhouette-contour.test.ts).
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

const { vectorInvertService } = await import('@/services/vector-invert.js');

const ORIGINAL_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
	'<rect x="5" y="5" width="30" height="30" fill="black"/></svg>';

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
		const contourSvg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
			'<image x="0" y="0" width="40" height="40" href="data:image/png;base64,AAAA"/></svg>';
		buildSilhouetteContourSvg.mockResolvedValue({ ok: true, svg: contourSvg });

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'silhouette',
		);

		expect(result.error).toBeNull();
		expect(result.data?.mode).toBe('silhouette');
		// O resultado é exatamente o que buildSilhouetteContourSvg devolveu —
		// vector-invert.ts não deve chamar rasterNegative no caminho ok:true.
		expect(result.data?.svgContent).toBe(contourSvg);
	});

	it('cai no raster negate quando buildSilhouetteContourSvg recusa (ok:false)', async () => {
		mockVector('photo');
		buildSilhouetteContourSvg.mockResolvedValue({
			ok: false,
			reason: 'fragmented',
		});

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'silhouette',
		);

		expect(result.error).toBeNull();
		expect(result.data?.mode).toBe('silhouette');
		// rasterNegative real (não mockado) embute a arte como <image> base64.
		expect(result.data?.svgContent).toContain('<image');
		expect(result.data?.svgContent).not.toContain('<path');
	});

	it('não recobra nem cria novo formato pago — paidFormats ecoado sem alteração', async () => {
		mockVector('photo');
		buildSilhouetteContourSvg.mockResolvedValue({
			ok: false,
			reason: 'fragmented',
		});

		const result = await vectorInvertService.invert(
			'cust-1',
			'vec-1',
			'silhouette',
		);

		expect(result.data?.paidFormats).toEqual(['svg']);
		expect(upsertInverted).not.toHaveBeenCalled();
	});
});
