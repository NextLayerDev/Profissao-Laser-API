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
		// A tela cresce para baixo: a faixa do carimbo é área NOVA, não é a arte.
		expect(meta.height).toBeGreaterThan(1200);
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
			// Fundo transparente, como a peça de verdade.
			color: { dark: '#111111', light: '#00000000' },
		});
		const esperadoRaw = await sharp(esperado).ensureAlpha().raw().toBuffer();
		const recorte = await sharp(png)
			.extract({
				left: area.qr.left,
				top: area.qr.top,
				width: area.qr.size,
				height: area.qr.size,
			})
			.ensureAlpha()
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
			color: { dark: '#111111', light: '#00000000' },
		});
		const outroRaw = await sharp(outro).ensureAlpha().raw().toBuffer();
		const recorte = await sharp(png)
			.extract({
				left: area.qr.left,
				top: area.qr.top,
				width: area.qr.size,
				height: area.qr.size,
			})
			.ensureAlpha()
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
		const { area } = await carimbarPeca(base, { code: CODE, url: URL });

		expect(area.left + area.width).toBeLessThanOrEqual(Math.ceil(W * 0.92));
	});

	it('a arte sai INTOCADA — o carimbo não fica em cima dela', async () => {
		/*
		 * A prova mais forte que existe para "não estraga a arte": os pixels da
		 * arte no arquivo entregue são BYTE A BYTE os do master. O carimbo mora
		 * numa faixa que a tela ganhou embaixo.
		 *
		 * Isto nasceu de um defeito visto na peça: no chaveiro, o selo caiu por
		 * cima do nome gravado. A marca que autentica a peça não pode estragá-la.
		 */
		const W = 1200;
		const H = 900;
		const base = await arte(W, H, '#ffffff');
		const { png } = await carimbarPeca(base, { code: CODE, url: URL });

		const meta = await sharp(png).metadata();
		expect(meta.width).toBe(W);
		expect(meta.height).toBeGreaterThan(H);

		const original = await sharp(base).removeAlpha().raw().toBuffer();
		const noArquivo = await sharp(png)
			.extract({ left: 0, top: 0, width: W, height: H })
			.removeAlpha()
			.raw()
			.toBuffer();
		expect(noArquivo.equals(original)).toBe(true);
	});

	it('o fundo do carimbo é TRANSPARENTE, não branco', async () => {
		// Na peça gravada, transparente é "não queime aqui" — que é o contraste
		// de que o QR precisa. Um retângulo branco opaco apagaria o material.
		const base = await arte(1200, 900, '#ffffff');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		// Um pedaço da faixa fora do selo: tem de estar 100% transparente.
		const canto = await sharp(png)
			.extract({ left: 0, top: area.top, width: 60, height: area.height })
			.ensureAlpha()
			.raw()
			.toBuffer();
		const alfas = canto.filter((_v, i) => i % 4 === 3);
		expect(alfas.every((a) => a === 0)).toBe(true);

		// E o QR tem tinta de verdade: transparente não pode virar "vazio".
		const noQr = await sharp(png)
			.extract({
				left: area.qr.left,
				top: area.qr.top,
				width: area.qr.size,
				height: area.qr.size,
			})
			.ensureAlpha()
			.raw()
			.toBuffer();
		expect(noQr.filter((_v, i) => i % 4 === 3).some((a) => a > 200)).toBe(true);
	});
});
