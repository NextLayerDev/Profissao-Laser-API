import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { carimbarPeca } from '@/lib/license-stamp.js';

/**
 * O carimbo é a peça central do controle de volumetria: enquanto o código não
 * está DENTRO do pixel, a arte entregue é genérica e serve para gravar quantas
 * vezes quiserem. Estes testes prendem o que faria o carimbo falhar em
 * SILÊNCIO — o pior desfecho possível, porque a peça sai parecendo licenciada.
 *
 * A geometria vem do `area` que a própria função devolve. Recalcular a conta
 * aqui testaria a cópia da conta, não o carimbo.
 */

/**
 * Este código não é qualquer um: é o que EXPÔS a perda de glifos no desenho
 * concatenado. Com um `<path>` só, a segunda linha ("1Z8V6-ERKV0") desenhava
 * um quinto da tinta. Trocar por um código "bonitinho" faria o teste passar
 * com o bug de volta.
 */
const CODE = 'PL-WXQ8W-4Z6NH-1Z8V6-ERKV0';
const URL = 'https://profissaolaser.com.br/a/PL-WXQ8W-4Z6NH-1Z8V6-ERKV0';

const arte = (w: number, h: number, cor: string) =>
	sharp({ create: { width: w, height: h, channels: 3, background: cor } })
		.png()
		.toBuffer();

const cinzas = (png: Buffer, box: sharp.Region) =>
	sharp(png).extract(box).greyscale().raw().toBuffer();

describe('carimbo de autenticidade', () => {
	it('devolve a arte do mesmo tamanho, com o carimbo por cima', async () => {
		const base = await arte(1200, 1200, '#ffffff');
		const { png, aviso, area } = await carimbarPeca(base, {
			code: CODE,
			url: URL,
		});

		const meta = await sharp(png).metadata();
		expect(meta.width).toBe(1200);
		expect(meta.height).toBe(1200);
		expect(aviso).toBeUndefined();
		expect(area.width).toBeGreaterThan(area.qr.size);
	});

	it('o QR gravado é EXATAMENTE o da URL da peça', async () => {
		// Comparação byte a byte contra o QR gerado da URL esperada: prova o
		// conteúdo sem precisar de um leitor de QR, e prova junto que o nível de
		// correção e a escala não mudaram.
		const base = await arte(1200, 1200, '#ffffff');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const esperado = await QRCode.toBuffer(URL, {
			errorCorrectionLevel: 'H',
			type: 'png',
			width: area.qr.size,
			margin: 0,
			color: { dark: '#111111', light: '#ffffff' },
		});
		const esperadoRaw = await sharp(esperado).removeAlpha().raw().toBuffer();
		const recorte = await sharp(png)
			.extract({
				left: area.qr.left,
				top: area.qr.top,
				width: area.qr.size,
				height: area.qr.size,
			})
			.removeAlpha()
			.raw()
			.toBuffer();

		expect(recorte.equals(esperadoRaw)).toBe(true);
	});

	it('um QR de OUTRA peça não passaria neste teste', async () => {
		// Guarda o guarda: se a comparação acima estivesse comparando qualquer
		// coisa com qualquer coisa, este teste passaria junto — e ele tem de
		// falhar.
		const base = await arte(1200, 1200, '#ffffff');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const outro = await QRCode.toBuffer(`${URL}-OUTRA`, {
			errorCorrectionLevel: 'H',
			type: 'png',
			width: area.qr.size,
			margin: 0,
			color: { dark: '#111111', light: '#ffffff' },
		});
		const outroRaw = await sharp(outro).removeAlpha().raw().toBuffer();
		const recorte = await sharp(png)
			.extract({
				left: area.qr.left,
				top: area.qr.top,
				width: area.qr.size,
				height: area.qr.size,
			})
			.removeAlpha()
			.raw()
			.toBuffer();

		expect(recorte.equals(outroRaw)).toBe(false);
	});

	it('o código sai DESENHADO, não como texto de fonte do sistema', async () => {
		// A prova é tinta no pixel. O sharp compõe SVG pelo resvg, que procura
		// fonte no fontconfig do SISTEMA: se isto virasse `<text>`, num contêiner
		// sem fonte instalada a linha do código sumiria SEM ERRO NENHUM. O teste
		// quebra se o pacote da fonte sumir ou se alguém "simplificar" o desenho.
		const base = await arte(1200, 1200, '#ffffff');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		// A faixa à DIREITA do QR, dentro da chapa: só o código mora ali.
		const inicio = area.qr.left + area.qr.size;
		const faixa = await cinzas(png, {
			left: inicio,
			top: area.top,
			width: area.left + area.width - inicio,
			height: area.height,
		});

		const escuros = faixa.filter((v) => v < 100).length;
		expect(escuros).toBeGreaterThan(200);
	});

	it('o código sai INTEIRO — não pela metade', async () => {
		/*
		 * ┌─ O BUG QUE ESTE TESTE EXISTE PARA PEGAR ───────────────────────────┐
		 * │ Com a linha inteira num `<path>` só, o renderizador do sharp        │
		 * │ TRUNCAVA o desenho pela metade: "PL-WXQ8W-4Z6NH" saía "PL-WXQ8".    │
		 * │ Sem erro e sem log — o código ia cortado para dentro da peça        │
		 * │ gravada, e ninguém descobriria antes de alguém tentar digitar o     │
		 * │ código de uma peça já vendida.                                      │
		 * │                                                                     │
		 * │ "Tem tinta na faixa do texto" não pega isso: metade do código ainda │
		 * │ é bastante tinta. A medida é ATÉ ONDE a tinta chega — o fim da      │
		 * │ última linha tem de encostar no fim da chapa.                       │
		 * └─────────────────────────────────────────────────────────────────────┘
		 */
		const base = await arte(1200, 1200, '#ffffff');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		// O último quinto da chapa, por dentro do fio de contorno.
		const borda = Math.ceil(area.width * 0.02) + 2;
		const largura = Math.round(area.width * 0.2) - borda;
		const fim = await cinzas(png, {
			left: area.left + area.width - largura - borda,
			top: area.top + borda,
			width: largura,
			height: area.height - borda * 2,
		});

		expect(fim.filter((v) => v < 100).length).toBeGreaterThan(80);
	});

	it('respeita a zona de emenda do wrap 360°', async () => {
		// Os modelos de caneca reservam os 8% externos de cada lado para a costura
		// da arte. Carimbo ali quebraria a emenda da peça gravada.
		const W = 2905;
		const H = 1122;
		const base = await arte(W, H, '#12212e');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		expect(area.left + area.width).toBeLessThanOrEqual(Math.ceil(W * 0.92));

		const zona = await cinzas(png, {
			left: Math.ceil(W * 0.92),
			top: 0,
			width: W - Math.ceil(W * 0.92),
			height: H,
		});
		expect(zona.filter((v) => v > 200).length).toBe(0);
	});

	it('a chapa fica clara mesmo em arte escura — o QR precisa disso', async () => {
		// Fixar chapa clara e tinta escura não é preguiça de medir contraste:
		// câmera só lê QR escuro sobre claro. Numa arte preta o carimbo tem de
		// continuar claro, ou a peça sai com um QR que ninguém escaneia.
		const base = await arte(1200, 1200, '#0b0b0d');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const canto = await cinzas(png, {
			left: area.left,
			top: area.top,
			width: area.width,
			height: area.height,
		});
		expect(canto.filter((v) => v > 200).length).toBeGreaterThan(
			canto.length * 0.3,
		);
	});
});
