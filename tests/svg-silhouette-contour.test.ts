import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildSilhouetteContourSvg } from '@/lib/svg-silhouette-contour.js';

async function decodeEmbeddedPng(svg: string) {
	const b64 = svg.match(/href="data:image\/png;base64,([^"]+)"/)?.[1];
	if (!b64) throw new Error('SVG não tem <image> embutida');
	const png = Buffer.from(b64, 'base64');
	const { data, info } = await sharp(png)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		W: info.width,
		H: info.height,
		at: (x: number, y: number) => data[y * info.width + x],
	};
}

// Quadro: quadrado externo (20..120) com um buraco interno ENCLOSED (50..90),
// num único path evenodd — viewBox 150×150. O buraco (branco) fica cercado de
// tinta em todos os lados, então a reconstrução morfológica o inclui na
// silhueta (fillHoles) mesmo sendo originalmente fundo.
const FRAME =
	'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
	'<path fill="#000000" fill-rule="evenodd" d="M20 20H120V120H20Z M50 50H90V90H50Z"/></svg>';

describe('buildSilhouetteContourSvg', () => {
	it('inverte a tinta; JANELA grande de papel vazio fica branca (com rebordo); fundo intacto', async () => {
		const res = await buildSilhouetteContourSvg(FRAME);
		expect(res.ok).toBe(true);
		if (res.ok === false) return;

		expect(res.svg).toContain('<image');

		const { W, H, at } = await decodeEmbeddedPng(res.svg);
		const scale = W / 150;
		// Área que era preta (tinta do quadro) — invertida, agora clara.
		expect(at(Math.round(30 * scale), Math.round(30 * scale))).toBeGreaterThan(
			200,
		);
		// Buraco interno GRANDE e VAZIO (janela de papel visto através da
		// figura, ex.: o vão entre braço levantado e rosto): `carveEmptyPaper`
		// devolve pro fundo — branco no centro...
		expect(at(Math.round(70 * scale), Math.round(70 * scale))).toBeGreaterThan(
			200,
		);
		// ...com um rebordo fino de campo colado na tinta que o delimita
		// (halo de ~8px logo após a borda da tinta em x=50).
		expect(at(Math.round(50 * scale) + 4, Math.round(70 * scale))).toBeLessThan(
			60,
		);
		// Fora do quadro inteiro — fundo de verdade, nunca fez parte da
		// silhueta — permanece exatamente como no original (branco).
		expect(at(Math.round(5 * scale), Math.round(5 * scale))).toBeGreaterThan(
			200,
		);
		expect(H).toBe(W); // viewBox quadrado
	});

	it('vão PEQUENO enclosed (hachura/mecha) continua invertendo — é o que preserva o detalhe', async () => {
		// Buraco de 3×3 vb (~32px no raster): célula vazia fica abaixo do piso
		// do carve → segue no campo invertido.
		const small =
			'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
			'<path fill="#000000" fill-rule="evenodd" d="M20 20H120V120H20Z M69 69H72V72H69Z"/></svg>';
		const res = await buildSilhouetteContourSvg(small);
		if (res.ok === false) throw new Error('esperava sucesso');
		const { W, at } = await decodeEmbeddedPng(res.svg);
		const scale = W / 150;
		expect(at(Math.round(70.5 * scale), Math.round(70.5 * scale))).toBeLessThan(
			60,
		);
	});

	it('anel fino baked: o preto começa logo ANTES da arte, nunca no retângulo', async () => {
		const res = await buildSilhouetteContourSvg(FRAME);
		if (res.ok === false) throw new Error('esperava sucesso');
		const { W, at } = await decodeEmbeddedPng(res.svg);
		const scale = W / 150;

		const y = Math.round(70 * scale);
		let firstDark = -1;
		for (let x = 0; x < W; x++) {
			if (at(x, y) < 60) {
				firstDark = x;
				break;
			}
		}
		expect(firstDark).toBeGreaterThan(Math.round(15 * scale));
		expect(firstDark).toBeLessThanOrEqual(Math.round(20 * scale) + 1);
	});

	it('contorno vetorial presente como geometria (DXF/corte), invisível na visualização', async () => {
		// A borda VISÍVEL é o anel baked no raster — desenhar o contorno traçado
		// por cima duplicava a borda (o Potrace desvia px da borda raster).
		const res = await buildSilhouetteContourSvg(FRAME);
		if (res.ok === false) throw new Error('esperava sucesso');
		const path = res.svg.match(/<path\b[^>]*\/>/)?.[0] ?? '';
		expect(path).toContain('fill="none"');
		expect(path).toContain('stroke="none"');
		expect(path).toMatch(/\bd="M/);
		expect(path).not.toMatch(/[Aa]\d/); // sem arcos (svgToDxf)
	});

	it('silhueta com múltiplos pedaços é aceita: cada um invertido com o próprio anel', async () => {
		// Bloco de 80×80 a 280px do blob principal (200×200) numa tela de
		// 800×800 — longe demais pra fundir. Antes isso RECUSAVA (fragmented) e
		// o serviço caía num negate de imagem inteira → retângulo preto. Agora
		// os dois pedaços são invertidos e o fundo entre eles fica intacto.
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">' +
			'<rect x="300" y="300" width="200" height="200" fill="black"/>' +
			'<rect x="20" y="20" width="80" height="80" fill="black"/>' +
			'</svg>';

		const res = await buildSilhouetteContourSvg(svg);
		expect(res.ok).toBe(true);
		if (res.ok === false) return;

		const { W, at } = await decodeEmbeddedPng(res.svg);
		const s = W / 800;
		// Os dois pedaços invertidos (era tinta → claro).
		expect(at(Math.round(400 * s), Math.round(400 * s))).toBeGreaterThan(200);
		expect(at(Math.round(60 * s), Math.round(60 * s))).toBeGreaterThan(200);
		// Fundo entre os pedaços e cantos: intactos (brancos) — sem retângulo.
		expect(at(Math.round(200 * s), Math.round(600 * s))).toBeGreaterThan(200);
		expect(at(W - 3, 3)).toBeGreaterThan(200);
	});

	// Bolsão: câmara murada (U + vergas) cujo único escape é um canal estreito
	// (20 de 400 vb). Com uma ILHA de desenho flutuando dentro, é interior do
	// assunto → absorve (inverte); sem ilha, é vão vazio → preserva o fundo.
	const pocketSvg = (withIsland: boolean) =>
		'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">' +
		'<rect x="140" y="140" width="20" height="120" fill="black"/>' + // parede esq
		'<rect x="240" y="140" width="20" height="120" fill="black"/>' + // parede dir
		'<rect x="140" y="240" width="120" height="20" fill="black"/>' + // fundo
		'<rect x="140" y="140" width="50" height="20" fill="black"/>' + // verga esq
		'<rect x="210" y="140" width="50" height="20" fill="black"/>' + // verga dir
		(withIsland
			? '<rect x="190" y="190" width="20" height="20" fill="black"/>'
			: '') +
		'</svg>';

	it('bolsão COM ilha de desenho dentro: absorvido (vira campo invertido)', async () => {
		const res = await buildSilhouetteContourSvg(pocketSvg(true));
		if (res.ok === false) throw new Error('esperava sucesso');
		const { W, at } = await decodeEmbeddedPng(res.svg);
		const s = W / 400;
		// Ponto dentro do bolsão (fora da ilha): era fundo branco, vira campo.
		expect(at(Math.round(170 * s), Math.round(200 * s))).toBeLessThan(60);
		// A ilha (era tinta) inverte pra claro.
		expect(at(Math.round(200 * s), Math.round(200 * s))).toBeGreaterThan(200);
		// Fundo aberto fora das paredes: intacto.
		expect(at(Math.round(60 * s), Math.round(60 * s))).toBeGreaterThan(200);
	});

	it('bolsão SEM ilha (vão vazio entre elementos): preservado como fundo', async () => {
		const res = await buildSilhouetteContourSvg(pocketSvg(false));
		if (res.ok === false) throw new Error('esperava sucesso');
		const { W, at } = await decodeEmbeddedPng(res.svg);
		const s = W / 400;
		expect(at(Math.round(170 * s), Math.round(200 * s))).toBeGreaterThan(200);
	});

	it('foto sangrada (bbox ≈ quadro todo): negativo preenche o bbox inteiro, sem bolsão de borda', async () => {
		// Retângulo quase full-frame com uma mordida branca no canto — o análogo
		// do céu claro encostado na borda de um retrato sangrado.
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">' +
			'<path fill="#000000" fill-rule="evenodd" d="M5 5H395V395H5Z M5 5H80V80H5Z"/>' +
			'</svg>';
		const res = await buildSilhouetteContourSvg(svg);
		if (res.ok === false) throw new Error('esperava sucesso');
		const { W, at } = await decodeEmbeddedPng(res.svg);
		const s = W / 400;
		// A mordida (era fundo claro na borda da foto) entra no negativo.
		expect(at(Math.round(40 * s), Math.round(40 * s))).toBeLessThan(60);
		// O corpo da foto (era tinta) inverte pra claro.
		expect(at(Math.round(200 * s), Math.round(200 * s))).toBeGreaterThan(200);
	});

	it('SVG sem geometria preenchível: recusa com no_geometry', async () => {
		const res = await buildSilhouetteContourSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
		);
		expect(res.ok).toBe(false);
		if (res.ok === true) return;
		expect(res.reason).toBe('no_geometry');
	});

	it('SVG com <image> (invertido persistido): recusa em vez de re-inverter lixo', async () => {
		const res = await buildSilhouetteContourSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
				'<image x="0" y="0" width="40" height="40" href="data:image/png;base64,AAAA"/></svg>',
		);
		expect(res.ok).toBe(false);
		if (res.ok === true) return;
		expect(res.reason).toBe('no_geometry');
	});

	it('sem tinta de verdade (só fill branco): recusa com empty', async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">' +
			'<rect x="0" y="0" width="50" height="50" fill="#ffffff"/></svg>';
		const res = await buildSilhouetteContourSvg(svg);
		expect(res.ok).toBe(false);
		if (res.ok === true) return;
		expect(res.reason).toBe('empty');
	});
});
