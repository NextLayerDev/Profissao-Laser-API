import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractPalette } from '@/lib/vectorize-color.js';
import { blockRegistry, registerCoreBlocks } from '@/tool-blocks/index.js';

/**
 * PALETA DOMINANTE — o que sustenta "a arte sai com a cara da empresa dele".
 *
 * O aluno sobe o logo e a tela precisa sugerir as cores da marca. A pergunta
 * "qual é a sua cor primária em hexadecimal?" não tem resposta para quase
 * ninguém; a resposta está dentro do logo.
 *
 * Nada aqui é mock: as imagens são geradas com `sharp` e o k-means é o de
 * verdade (determinístico, sem random — é por isso que dá para afirmar cores
 * exatas num teste).
 */

/** Um "logo": fundo branco + dois blocos de cor sólida. */
async function logoEmFundoBranco(): Promise<Buffer> {
	const bloco = async (cor: string) =>
		sharp({
			create: {
				width: 60,
				height: 60,
				channels: 3,
				background: cor,
			},
		})
			.png()
			.toBuffer();

	return sharp({
		create: {
			width: 200,
			height: 200,
			channels: 3,
			background: '#ffffff',
		},
	})
		.composite([
			{ input: await bloco('#e11d1d'), left: 20, top: 20 },
			{ input: await bloco('#1d3fe1'), left: 100, top: 110 },
		])
		.png()
		.toBuffer();
}

/** Distância entre dois hex — o k-means devolve a MÉDIA do cluster, não o pixel. */
function distanciaHex(a: string, b: string): number {
	const canal = (h: string, i: number) =>
		Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
	return Math.sqrt(
		[0, 1, 2].reduce((acc, i) => acc + (canal(a, i) - canal(b, i)) ** 2, 0),
	);
}

function pertoDe(hex: string, alvo: string, tolerancia = 24): boolean {
	return distanciaHex(hex, alvo) <= tolerancia;
}

describe('extractPalette', () => {
	it('devolve as cores do desenho e NÃO o branco do fundo', async () => {
		const paleta = await extractPalette(await logoEmFundoBranco(), {
			colors: 3,
		});

		const hexes = paleta.map((c) => c.hex);
		expect(hexes.some((h) => pertoDe(h, '#e11d1d'))).toBe(true);
		expect(hexes.some((h) => pertoDe(h, '#1d3fe1'))).toBe(true);

		/**
		 * O ponto inteiro do bloco. Branco é a MAIOR área da imagem: sem descontar
		 * o fundo, a "cor principal" sugerida para a marca do aluno seria branco em
		 * praticamente todo logo enviado.
		 */
		expect(hexes.some((h) => pertoDe(h, '#ffffff', 40))).toBe(false);
	});

	it('a cor principal é a de maior área, e as fatias vêm em ordem', async () => {
		// Vermelho ocupa o dobro do azul (60×60 contra 60×30).
		const azul = await sharp({
			create: { width: 60, height: 30, channels: 3, background: '#1d3fe1' },
		})
			.png()
			.toBuffer();
		const vermelho = await sharp({
			create: { width: 60, height: 60, channels: 3, background: '#e11d1d' },
		})
			.png()
			.toBuffer();
		const img = await sharp({
			create: { width: 200, height: 200, channels: 3, background: '#ffffff' },
		})
			.composite([
				{ input: vermelho, left: 20, top: 20 },
				{ input: azul, left: 110, top: 120 },
			])
			.png()
			.toBuffer();

		const paleta = await extractPalette(img, { colors: 2 });

		expect(pertoDe(paleta[0].hex, '#e11d1d')).toBe(true);
		expect(paleta[0].share).toBeGreaterThan(paleta[1].share);
	});

	it('logo de uma cor chapada não vira paleta PRETA', async () => {
		/**
		 * O chroma-key é de borda: numa arte que sangra até o canto, "o fundo" é a
		 * imagem inteira. Se sobrasse amostra nenhuma, o k-means devolveria preto —
		 * e a marca vermelha do aluno apareceria na tela como preta.
		 */
		const chapado = await sharp({
			create: { width: 120, height: 120, channels: 3, background: '#e11d1d' },
		})
			.png()
			.toBuffer();

		const paleta = await extractPalette(chapado, { colors: 3 });

		expect(paleta.length).toBeGreaterThan(0);
		expect(pertoDe(paleta[0].hex, '#e11d1d')).toBe(true);
	});

	it('é determinística: a mesma imagem devolve a mesma paleta', async () => {
		// O k-means aqui não usa random (init pela cor média + ponto mais
		// distante). Se algum dia usar, a marca do aluno mudaria de cor a cada
		// abertura da tela — e é este teste que avisa.
		const img = await logoEmFundoBranco();
		expect(await extractPalette(img, { colors: 4 })).toEqual(
			await extractPalette(img, { colors: 4 }),
		);
	});

	it('respeita o número de cores pedido', async () => {
		const paleta = await extractPalette(await logoEmFundoBranco(), {
			colors: 2,
		});
		expect(paleta.length).toBeLessThanOrEqual(2);
	});

	it('não repete a mesma cor na paleta', async () => {
		const paleta = await extractPalette(await logoEmFundoBranco(), {
			colors: 8,
		});
		expect(new Set(paleta.map((c) => c.hex)).size).toBe(paleta.length);
	});
});

describe('bloco image.palette', () => {
	it('está no registry e devolve primary/secondary do logo', async () => {
		registerCoreBlocks();
		const bloco = blockRegistry.get('image.palette');
		expect(bloco).toBeDefined();
		if (!bloco) return;

		const params = bloco.paramsSchema.parse({
			image: await logoEmFundoBranco(),
			colors: 3,
		});
		const out = await bloco.run(
			{ customerId: '00000000-0000-4000-8000-000000000000' },
			params,
		);

		// As duas manchas do "logo" têm a MESMA área, então qual delas é a
		// principal é empate — o que o bloco promete é que as duas estão lá, em
		// hex, e que `primary`/`secondary` apontam para elas.
		const cores = out.colors as string[];
		expect(cores.some((h) => pertoDe(h, '#e11d1d'))).toBe(true);
		expect(cores.some((h) => pertoDe(h, '#1d3fe1'))).toBe(true);
		expect(out.primary).toBe(cores[0]);
		expect(out.secondary).toBe(cores[1]);
		expect(
			[out.primary, out.secondary].every(
				(h) =>
					pertoDe(h as string, '#e11d1d') || pertoDe(h as string, '#1d3fe1'),
			),
		).toBe(true);
	});

	it('`remove_background: "false"` desliga mesmo (e aí o branco aparece)', async () => {
		registerCoreBlocks();
		const bloco = blockRegistry.get('image.palette');
		if (!bloco) throw new Error('bloco image.palette não registrado');

		/**
		 * `z.coerce.boolean()` transformaria a string `"false"` em `true` — e uma
		 * definition escrita com `remove_background: "false"` continuaria
		 * descontando o fundo, em silêncio. A checagem é o comportamento, não o
		 * tipo: com o fundo contado, o branco (maior área) tem que aparecer.
		 */
		const params = bloco.paramsSchema.parse({
			image: await logoEmFundoBranco(),
			colors: 3,
			remove_background: 'false',
		});
		const out = await bloco.run(
			{ customerId: '00000000-0000-4000-8000-000000000000' },
			params,
		);

		expect(pertoDe(out.primary as string, '#ffffff', 40)).toBe(true);
	});
});
