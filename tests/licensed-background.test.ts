import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
	garantirSemFundo,
	temFundoTransparente,
} from '@/lib/licensed-background.js';

/**
 * A peça de recorte (chaveiro, vetor, capinha) tem de sair com alfa REAL. O
 * modelo devolve com frequência um PNG opaco — fundo branco, ou o xadrez falso
 * de "transparência". Gravado assim, a máquina queima a placa inteira.
 */

const ctx = { customerId: 'teste' };

/** Um "escudo": quadrado preto no meio de um fundo liso. */
const arteOpaca = (fundo: string) =>
	sharp({ create: { width: 400, height: 400, channels: 3, background: fundo } })
		.composite([
			{
				input: {
					create: {
						width: 160,
						height: 160,
						channels: 3,
						background: '#000000',
					},
				},
				left: 120,
				top: 120,
			},
		])
		.png()
		.toBuffer();

const arteTransparente = () =>
	sharp({
		create: {
			width: 400,
			height: 400,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([
			{
				input: {
					create: {
						width: 160,
						height: 160,
						channels: 4,
						background: { r: 0, g: 0, b: 0, alpha: 1 },
					},
				},
				left: 120,
				top: 120,
			},
		])
		.png()
		.toBuffer();

const alfaEm = async (png: Buffer, x: number, y: number) => {
	const { data } = await sharp(png)
		.ensureAlpha()
		.extract({ left: x, top: y, width: 1, height: 1 })
		.raw()
		.toBuffer({ resolveWithObject: true });
	return data[3];
};

describe('temFundoTransparente', () => {
	it('PNG opaco (RGB) não tem fundo transparente', async () => {
		expect(await temFundoTransparente(await arteOpaca('#ffffff'))).toBe(false);
	});

	it('PNG com canal alfa mas todo opaco também não — o alfa só existe no nome', async () => {
		const png = await sharp({
			create: {
				width: 50,
				height: 50,
				channels: 4,
				background: { r: 255, g: 255, b: 255, alpha: 1 },
			},
		})
			.png()
			.toBuffer();
		expect(await temFundoTransparente(png)).toBe(false);
	});

	it('PNG com pixel transparente de verdade tem', async () => {
		expect(await temFundoTransparente(await arteTransparente())).toBe(true);
	});
});

describe('garantirSemFundo', () => {
	it('arte já transparente volta como veio — byte a byte', async () => {
		const png = await arteTransparente();
		expect((await garantirSemFundo(png, ctx)).equals(png)).toBe(true);
	});

	it('arte opaca em fundo branco sai com o fundo transparente e o desenho inteiro', async () => {
		// Fundo uniforme: o removedor resolve no chroma-key, sem IA e sem rede.
		const saida = await garantirSemFundo(await arteOpaca('#ffffff'), ctx);
		expect(await temFundoTransparente(saida)).toBe(true);
		// Um canto do fundo virou transparente…
		expect(await alfaEm(saida, 5, 5)).toBeLessThan(32);
		// …e o miolo do "escudo" continua opaco.
		expect(await alfaEm(saida, 200, 200)).toBe(255);
		// Mesmo tamanho: o carimbo depende disso.
		const meta = await sharp(saida).metadata();
		expect([meta.width, meta.height]).toEqual([400, 400]);
	});

	it('fundo cinza claro também cai — não é só branco que o modelo inventa', async () => {
		const saida = await garantirSemFundo(await arteOpaca('#cfcfcf'), ctx);
		expect(await alfaEm(saida, 5, 5)).toBeLessThan(32);
		expect(await alfaEm(saida, 200, 200)).toBe(255);
	});
});
