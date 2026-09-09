import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
	carimbarPeca,
	escolherSelo,
	geometriaDoSelo,
} from '@/lib/license-stamp.js';

/**
 * O carimbo é a peça central do controle de volumetria: enquanto o código não
 * está DENTRO do pixel, a arte entregue é genérica e serve para gravar quantas
 * vezes quiserem. Estes testes prendem o que faria o carimbo falhar em
 * SILÊNCIO — o pior desfecho possível, porque a peça sai parecendo licenciada.
 *
 * A geometria vem do `area` que a própria função devolve. Recalcular a conta
 * aqui testaria a cópia da conta, não o carimbo.
 */

const CODE = 'PL-WXQ8W-4Z6NH-1Z8V6-ERKV0';
const URL = 'https://profissaolaser.com.br/a/PL-WXQ8W-4Z6NH-1Z8V6-ERKV0';

const arte = (w: number, h: number, cor: string) =>
	sharp({ create: { width: w, height: h, channels: 3, background: cor } })
		.png()
		.toBuffer();

const transparente = (w: number, h: number) =>
	sharp({
		create: {
			width: w,
			height: h,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.png()
		.toBuffer();

/** Contagem de pixels de um recorte por classe de cor. */
async function contar(png: Buffer, area: sharp.Region) {
	const { data, info } = await sharp(png)
		.extract(area)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	let brancos = 0;
	let escuros = 0;
	let transparentes = 0;
	let outros = 0;
	for (let i = 0; i < info.width * info.height; i++) {
		const p = i * info.channels;
		if (data[p + 3] < 32) {
			transparentes++;
			continue;
		}
		const luz = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
		if (luz > 240) brancos++;
		else if (luz < 60) escuros++;
		else outros++;
	}
	return { brancos, escuros, transparentes, outros };
}

describe('carimbo de autenticidade', () => {
	it('devolve a arte do mesmo tamanho, com o carimbo por cima', async () => {
		const base = await arte(1200, 1200, '#ffffff');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const meta = await sharp(png).metadata();
		expect(meta.width).toBe(1200);
		expect(meta.height).toBe(1200);
		expect(area.width).toBeGreaterThan(0);
		expect(area.width).toBe(area.height); // a placa é quadrada
		// E o QR fica DENTRO da placa, com respiro dos quatro lados.
		expect(area.qr.left).toBeGreaterThan(area.left);
		expect(area.qr.top).toBeGreaterThan(area.top);
		expect(area.qr.left + area.qr.size).toBeLessThan(area.left + area.width);
		expect(area.qr.top + area.qr.size).toBeLessThan(area.top + area.height);
	});

	it('o QR gravado é EXATAMENTE o da URL da peça', async () => {
		// Comparação byte a byte contra o QR gerado da URL esperada: prova o
		// conteúdo sem precisar de um leitor de QR, e prova junto que o nível de
		// correção e a escala não mudaram.
		const base = await arte(1200, 1200, '#ffcc00');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const modulos = QRCode.create(URL, { errorCorrectionLevel: 'H' }).modules
			.size;
		const esperado = await QRCode.toBuffer(URL, {
			errorCorrectionLevel: 'H',
			type: 'png',
			scale: area.qr.size / modulos,
			margin: 0,
			color: { dark: '#111111', light: '#ffffff' },
		});
		const esperadoRaw = await sharp(esperado).removeAlpha().raw().toBuffer();
		const naPeca = await sharp(png)
			.extract({
				left: area.qr.left,
				top: area.qr.top,
				width: area.qr.size,
				height: area.qr.size,
			})
			.removeAlpha()
			.raw()
			.toBuffer();

		expect(naPeca.equals(esperadoRaw)).toBe(true);
	});

	it('um QR de OUTRA peça não passaria neste teste', async () => {
		// Guarda o guarda: se a comparação acima estivesse comparando qualquer
		// coisa com qualquer coisa, este teste passaria junto — e ele tem de
		// falhar.
		const base = await arte(1200, 1200, '#ffcc00');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });
		const modulos = QRCode.create(URL, { errorCorrectionLevel: 'H' }).modules
			.size;
		const outro = await QRCode.toBuffer(`${URL}-OUTRA`, {
			errorCorrectionLevel: 'H',
			type: 'png',
			scale: area.qr.size / modulos,
			margin: 0,
			color: { dark: '#111111', light: '#ffffff' },
		});
		const outroRaw = await sharp(outro).removeAlpha().raw().toBuffer();
		const naPeca = await sharp(png)
			.extract({
				left: area.qr.left,
				top: area.qr.top,
				width: area.qr.size,
				height: area.qr.size,
			})
			.removeAlpha()
			.raw()
			.toBuffer();
		expect(naPeca.equals(outroRaw)).toBe(false);
	});

	it('o QR é múltiplo INTEIRO de pixels por módulo, nunca abaixo de 2', async () => {
		// Tamanho quebrado reamostra e borra as bordas dos módulos: medido, 110 px
		// leu em 13% das tentativas contra ~80% dos vizinhos 100 e 120.
		const modulos = QRCode.create(URL, { errorCorrectionLevel: 'H' }).modules
			.size;
		for (const [W, H] of [
			[600, 600],
			[1200, 1200],
			[2905, 1122],
			[4000, 4000],
		]) {
			const g = geometriaDoSelo(W, H, URL);
			expect(g.qr % modulos).toBe(0);
			expect(g.pxPorModulo).toBeGreaterThanOrEqual(2);
		}
	});

	it('o selo cresce com a arte: ~8% do menor lado', async () => {
		// Um QR de 82 px fixos é discreto no chaveiro e ilegível na caneca. A
		// escala é o que faz o mesmo carimbo servir aos dois.
		const pequeno = geometriaDoSelo(1000, 1000, URL);
		const grande = geometriaDoSelo(4000, 4000, URL);
		expect(grande.qr).toBeGreaterThan(pequeno.qr);
		expect(grande.qr / 4000).toBeGreaterThan(0.06);
		expect(grande.qr / 4000).toBeLessThan(0.11);
	});

	it('o selo é DISCRETO: ocupa um canto, não a arte', async () => {
		/*
		 * O carimbo é obrigatório e mora dentro da arte, então a única defesa
		 * contra estragar a peça é ele ser pequeno. Este teste é o teto: se
		 * alguém aumentar o selo "para ler melhor", ele quebra aqui antes de
		 * quebrar numa peça vendida.
		 */
		const W = 1200;
		const H = 1200;
		const base = await arte(W, H, '#ffffff');
		const { area } = await carimbarPeca(base, { code: CODE, url: URL });

		const fracao = (area.width * area.height) / (W * H);
		expect(fracao).toBeLessThan(0.015);
	});
});

describe('a placa', () => {
	/**
	 * A placa é o que faz o QR ler SEMPRE: sobre arte escura, cinza, com textura
	 * — e no software do laser, que mostra tudo em tons de cinza. Branco de
	 * fundo, borda preta fina, QR preto. Na peça gravada: branco é "não queime
	 * aqui", borda e módulos são o queimado.
	 */
	it('existe: fundo branco com borda escura em volta do QR', async () => {
		// Amarelo, para que nem o branco nem o escuro possam vir da arte.
		const base = await arte(1000, 1000, '#ffcc00');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const placa = await contar(png, area);
		expect(placa.brancos).toBeGreaterThan(0);
		expect(placa.escuros).toBeGreaterThan(0);
		// O amarelo da arte só pode aparecer nos cantos arredondados da placa:
		// menos de 2% do quadrado.
		expect(placa.outros / (area.width * area.height)).toBeLessThan(0.02);

		// A moldura (o anel entre a placa e o QR) tem borda escura E respiro
		// branco — e nada da arte.
		const anel = await contar(png, {
			left: area.left,
			top: area.top + Math.round(area.height / 2),
			width: area.qr.left - area.left,
			height: 4,
		});
		expect(anel.escuros).toBeGreaterThan(0);
		expect(anel.brancos).toBeGreaterThan(0);
		expect(anel.outros).toBe(0);
	});

	it('sobre arte ESCURA o QR continua preto — o contraste vem da placa', async () => {
		const base = await arte(1000, 1000, '#101010');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });
		const qr = await contar(png, {
			left: area.qr.left,
			top: area.qr.top,
			width: area.qr.size,
			height: area.qr.size,
		});
		// Módulos escuros E claros dentro do QR: sem inversão, sem arte vazando.
		expect(qr.escuros).toBeGreaterThan(0);
		expect(qr.brancos).toBeGreaterThan(0);
		expect(qr.outros).toBe(0);
		expect(qr.transparentes).toBe(0);
	});

	it('a arte transparente continua transparente FORA da placa', async () => {
		// A arte de laser vem com fundo transparente ("não queime aqui"), e o
		// carimbo não pode achatá-la em branco — isso mandaria a máquina queimar
		// a peça inteira. Só a placa é opaca; o resto fica como veio.
		const { png, area } = await carimbarPeca(await transparente(900, 900), {
			code: CODE,
			url: URL,
		});

		const fora = await contar(png, {
			left: 400,
			top: 0,
			width: 400,
			height: 400,
		});
		expect(fora.transparentes).toBe(400 * 400);

		// E a placa é opaca — inclusive o claro do QR, que agora é branco de
		// verdade e não "deixa a arte passar".
		const dentro = await contar(png, {
			left: area.qr.left,
			top: area.qr.top,
			width: area.qr.size,
			height: area.qr.size,
		});
		expect(dentro.transparentes).toBe(0);
	});

	it('o selo pedido é OBEDECIDO — é assim que o lote sai uniforme', async () => {
		const base = await arte(1000, 1000, '#ffffff');
		const { area, selo } = await carimbarPeca(base, {
			code: CODE,
			url: URL,
			selo: { left: 40, top: 60 },
		});
		expect(selo).toEqual({ left: 40, top: 60 });
		expect(area.left).toBe(40);
		expect(area.top).toBe(60);
	});
});

describe('onde o carimbo pousa', () => {
	/**
	 * ┌─ O QUE ESTES TESTES EXISTEM PARA IMPEDIR ───────────────────────────────┐
	 * │ O selo já procurou o "canto mais vazio" (foi parar em cima à esquerda   │
	 * │ numa caneca com foto), já procurou o canto da SILHUETA de tinta (foi    │
	 * │ parar no MEIO de um escudo, em cima da âncora). Duas vezes "em lugar    │
	 * │ aleatório" para o cliente.                                              │
	 * │                                                                          │
	 * │ Agora é o canto inferior ESQUERDO do ARQUIVO, sempre, sem olhar o        │
	 * │ conteúdo: arte cheia, arte transparente, silhueta no meio, desenho no   │
	 * │ canto — o QR cai no mesmo lugar. Previsível é o requisito.              │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	const W = 1200;
	const H = 1200;
	const LADO = geometriaDoSelo(W, H, URL).lado;
	/** Margem de ~1% do menor lado, com folga de arredondamento. */
	const MARGEM_MAX = Math.round(W * 0.012) + 1;

	/** Arte branca com blocos pretos onde for pedido. */
	async function arteCom(blocos: sharp.Region[]): Promise<Buffer> {
		return sharp({
			create: { width: W, height: H, channels: 3, background: '#ffffff' },
		})
			.composite(
				blocos.map((b) => ({
					input: {
						create: {
							width: b.width,
							height: b.height,
							channels: 3,
							background: '#000000',
						},
					},
					left: b.left,
					top: b.top,
				})),
			)
			.png()
			.toBuffer();
	}

	const noCantoInferiorEsquerdo = (selo: { left: number; top: number }) => {
		expect(selo.left).toBeLessThanOrEqual(MARGEM_MAX);
		expect(H - (selo.top + LADO)).toBeLessThanOrEqual(MARGEM_MAX);
	};

	it('arte cheia: canto inferior esquerdo do arquivo', async () => {
		noCantoInferiorEsquerdo(
			await escolherSelo(await arte(W, H, '#3a3a3a'), URL),
		);
	});

	it('arte TRANSPARENTE: o mesmo canto — não vai atrás da silhueta', async () => {
		noCantoInferiorEsquerdo(await escolherSelo(await transparente(W, H), URL));
	});

	it('escudo no meio com nome embaixo: o mesmo canto, nunca em cima do escudo', async () => {
		// O caso real que motivou a regra: a placa ia parar dentro do escudo.
		const base = await arteCom([
			{ left: 350, top: 150, width: 500, height: 600 }, // o escudo
			{ left: 380, top: 900, width: 440, height: 160 }, // o nome
		]);
		const selo = await escolherSelo(base, URL);
		noCantoInferiorEsquerdo(selo);
		// E a placa não encosta no escudo nem no nome.
		expect(selo.left + LADO).toBeLessThan(350);
	});

	it('desenho ocupando o próprio canto: o QR pousa em cima dele mesmo assim', async () => {
		// "Sempre no canto" vale mais que "fora do desenho": a placa branca é o
		// que garante que o QR continua legível em cima do que estiver lá.
		const base = await arteCom([
			{ left: 0, top: H / 2, width: W, height: H / 2 },
		]);
		noCantoInferiorEsquerdo(await escolherSelo(base, URL));
	});

	it('respeita a zona de emenda do wrap 360°, colado embaixo', async () => {
		// Os modelos de caneca reservam os 8% externos de cada lado para a costura
		// da arte. Carimbo ali quebraria a emenda da peça gravada.
		const Wp = 2905;
		const Hp = 1122;
		const lado = geometriaDoSelo(Wp, Hp, URL).lado;
		const { left, top } = await escolherSelo(
			await arte(Wp, Hp, '#12212e'),
			URL,
		);
		expect(left).toBeGreaterThanOrEqual(Math.floor(Wp * 0.08));
		expect(left + lado).toBeLessThanOrEqual(Math.ceil(Wp * 0.92));
		expect(Hp - (top + lado)).toBeLessThan(Hp * 0.03);
	});

	it('arte menor que a placa: encosta no zero em vez de sair do arquivo', async () => {
		const { left, top } = await escolherSelo(
			await arte(60, 60, '#ffffff'),
			URL,
		);
		expect(left).toBe(0);
		expect(top).toBe(0);
	});
});
