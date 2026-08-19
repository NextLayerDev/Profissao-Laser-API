import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { carimbarPeca, escolherSelo } from '@/lib/license-stamp.js';

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

/** O recorte do carimbo no PNG entregue, achatado sobre uma cor conhecida. */
const recorteDoSelo = (
	png: Buffer,
	area: { left: number; top: number; width: number; height: number },
	fundo: string,
) => sharp(png).extract(area).flatten({ background: fundo }).raw().toBuffer();

describe('carimbo de autenticidade', () => {
	it('devolve a arte do mesmo tamanho, com o carimbo por cima', async () => {
		const base = await arte(1200, 1200, '#ffffff');
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const meta = await sharp(png).metadata();
		expect(meta.width).toBe(1200);
		expect(meta.height).toBe(1200);
		expect(area.width).toBeGreaterThan(0);
		expect(area.width).toBe(area.height); // o selo é o quadrado do QR
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
			// Claro transparente, como sai na peça; achatado no branco da arte
			// para comparar contra o mesmo fundo do recorte.
			color: { dark: '#111111', light: '#00000000' },
		});
		const esperadoRaw = await sharp(esperado)
			.flatten({ background: '#ffffff' })
			.raw()
			.toBuffer();

		expect(
			(await recorteDoSelo(png, area, '#ffffff')).equals(esperadoRaw),
		).toBe(true);
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
		const outroRaw = await sharp(outro)
			.flatten({ background: '#ffffff' })
			.raw()
			.toBuffer();

		expect((await recorteDoSelo(png, area, '#ffffff')).equals(outroRaw)).toBe(
			false,
		);
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

		// E fica NO CANTO, colado nas bordas — a margem é ~1% do menor lado.
		expect(W - (area.left + area.width)).toBeLessThan(W * 0.02);
		expect(H - (area.top + area.height)).toBeLessThan(H * 0.02);
	});
});

describe('sem fundo', () => {
	/**
	 * "Sem fundo" é o pedido, e ele tem consequência: o contraste do QR deixa de
	 * vir de uma chapa e passa a vir da própria arte. É por isso que a cor do QR
	 * é decidida medindo o canto.
	 */
	it('NÃO existe chapa: o claro do QR deixa o pixel da arte passar', async () => {
		/*
		 * Amarelo, e não vermelho: `#cc0000` tem luminância 61 e a arte contaria
		 * como ESCURA, o QR inverteria para branco e os "brancos" contados abaixo
		 * seriam os módulos, não uma chapa. Amarelo é claro (luminância ~196),
		 * então o QR sai escuro e sobra a cor da arte para procurar.
		 */
		const base = await arte(1000, 1000, '#ffcc00');
		const { png, area, selo } = await carimbarPeca(base, {
			code: CODE,
			url: URL,
		});
		expect(selo.escuro).toBe(false);

		const { data, info } = await sharp(png)
			.extract(area)
			.raw()
			.toBuffer({ resolveWithObject: true });

		let daArte = 0;
		let brancos = 0;
		for (let i = 0; i < info.width * info.height; i++) {
			const p = i * info.channels;
			if (data[p] > 240 && data[p + 1] > 180 && data[p + 2] < 60) daArte++;
			if (data[p] > 240 && data[p + 1] > 240 && data[p + 2] > 240) brancos++;
		}
		// O amarelo da arte aparece DENTRO do selo: é ele que faz o claro do QR.
		expect(daArte).toBeGreaterThan(0);
		// E não há um pixel de chapa branca.
		expect(brancos).toBe(0);
	});

	it('a arte transparente continua transparente, inclusive no selo', async () => {
		// A arte de laser vem com fundo transparente ("não queime aqui"), e o
		// carimbo não pode achatá-la em branco — isso mandaria a máquina queimar
		// a peça inteira. Sem chapa, nem o próprio selo achata.
		const base = await sharp({
			create: {
				width: 900,
				height: 900,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.png()
			.toBuffer();
		const { png, area } = await carimbarPeca(base, { code: CODE, url: URL });

		const foraDoSelo = await sharp(png)
			.extract({ left: 0, top: 0, width: 60, height: 60 })
			.ensureAlpha()
			.raw()
			.toBuffer();
		expect(
			foraDoSelo.filter((_v, i) => i % 4 === 3).every((a) => a === 0),
		).toBe(true);

		// Dentro do selo há pixel opaco (os módulos escuros) E pixel transparente
		// (o claro do QR, que continua sendo "não queime aqui").
		const noSelo = await sharp(png)
			.extract(area)
			.ensureAlpha()
			.raw()
			.toBuffer();
		const alfas = noSelo.filter((_v, i) => i % 4 === 3);
		expect(alfas.some((a) => a === 255)).toBe(true);
		expect(alfas.some((a) => a === 0)).toBe(true);
	});
});

describe('a cor do QR acompanha a arte', () => {
	/**
	 * Sem chapa, um QR escuro sobre arte escura não escaneia — nem na tela nem
	 * gravado. A resposta escolhida foi inverter: sobre campo escuro o QR sai
	 * branco, que na peça gravada é o material cru dentro do queimado.
	 */
	const corDosModulos = async (png: Buffer, area: sharp.Region) => {
		const { data, info } = await sharp(png)
			.extract(area)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		let claros = 0;
		let escuros = 0;
		for (let i = 0; i < info.width * info.height; i++) {
			const p = i * info.channels;
			if (data[p + 3] < 32) continue; // transparente = o claro do QR
			const luz =
				(data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
			if (luz > 200) claros++;
			else if (luz < 60) escuros++;
		}
		return { claros, escuros };
	};

	it('sobre arte CLARA o QR sai escuro', async () => {
		const base = await arte(1000, 1000, '#ffffff');
		const { png, area, selo } = await carimbarPeca(base, {
			code: CODE,
			url: URL,
		});
		expect(selo.escuro).toBe(false);
		const { escuros } = await corDosModulos(png, area);
		expect(escuros).toBeGreaterThan(0);
	});

	it('sobre arte ESCURA o QR inverte para branco', async () => {
		const base = await arte(1000, 1000, '#101010');
		const { png, area, selo } = await carimbarPeca(base, {
			code: CODE,
			url: URL,
		});
		expect(selo.escuro).toBe(true);
		const { claros } = await corDosModulos(png, area);
		expect(claros).toBeGreaterThan(0);
	});

	it('arte TRANSPARENTE conta como clara — o material cru é claro', async () => {
		// Tratar transparente como escuro faria todo chaveiro de laser sair com
		// QR branco sobre nada, que é invisível na máquina e na tela.
		const base = await sharp({
			create: {
				width: 900,
				height: 900,
				channels: 4,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			},
		})
			.png()
			.toBuffer();
		expect((await escolherSelo(base)).escuro).toBe(false);
	});

	it('o selo pedido é OBEDECIDO — é assim que o lote sai uniforme', async () => {
		// A arte é clara e pediria QR escuro; o lote já decidiu o contrário.
		const base = await arte(1000, 1000, '#ffffff');
		const { png, area, selo } = await carimbarPeca(base, {
			code: CODE,
			url: URL,
			selo: { left: 40, top: 60, escuro: true },
		});
		expect(selo).toEqual({ left: 40, top: 60, escuro: true });
		expect(area.left).toBe(40);
		expect(area.top).toBe(60);
		const { claros } = await corDosModulos(png, area);
		expect(claros).toBeGreaterThan(0);
	});
});

describe('onde o carimbo pousa', () => {
	/**
	 * ┌─ O QUE ESTES TESTES EXISTEM PARA IMPEDIR ───────────────────────────────┐
	 * │ O selo já foi fixo no canto inferior direito do ARQUIVO. Na caneca, que  │
	 * │ é um retângulo cheio, funcionava. No chaveiro quebrou de dois jeitos, e  │
	 * │ o segundo é pior que o primeiro:                                         │
	 * │                                                                          │
	 * │  ① cobria o nome — "JOAO" saiu com o "O" tapado pelo selo;               │
	 * │  ② ao procurar "o canto mais vazio", ia parar FORA da silhueta, porque   │
	 * │    o vazio de verdade num recorte é o papel em volta — e ali o QR é      │
	 * │    cortado fora e some da peça.                                          │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	const W = 1200;
	const H = 1200;

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

	/** Uma silhueta recortada: moldura de contorno com papel sobrando em volta. */
	async function pecaRecortada(extra: sharp.Region[] = []): Promise<Buffer> {
		const m = 300; // o papel que sobra e vira sucata depois do corte
		const esp = 12;
		return arteCom([
			{ left: m, top: m, width: W - 2 * m, height: esp },
			{ left: m, top: H - m - esp, width: W - 2 * m, height: esp },
			{ left: m, top: m, width: esp, height: H - 2 * m },
			{ left: W - m - esp, top: m, width: esp, height: H - 2 * m },
			...extra,
		]);
	}

	/**
	 * Um LOSANGO — a peça cujos cantos da caixa ficam FORA dela.
	 *
	 * É o formato que separa "restringi à caixa do desenho" de "fiquei dentro da
	 * peça". Numa peça retangular as duas coisas coincidem e o teste não prova
	 * nada; aqui, o canto da caixa é papel que o corte leva embora.
	 */
	async function losango(): Promise<Buffer> {
		const lados: sharp.Region[] = [];
		const passos = 240;
		const meio = W / 2;
		const raio = 520;
		for (let i = 0; i <= passos; i++) {
			const t = i / passos;
			const dx = Math.round(raio * (1 - Math.abs(2 * t - 1)));
			const y = Math.round(t * 2 * raio);
			for (const x of [meio - dx, meio + dx - 14]) {
				lados.push({
					left: Math.round(x),
					top: Math.round(meio - raio + y),
					width: 14,
					height: 14,
				});
			}
		}
		return arteCom(lados);
	}

	/** O ponto está dentro do losango desenhado acima? */
	const dentroDoLosango = (x: number, y: number) =>
		Math.abs(x - W / 2) + Math.abs(y - W / 2) <= 520;

	it('numa arte cheia, o selo vai para um CANTO do arquivo', async () => {
		// Sangria total (o caso da caneca): a peça É o arquivo, então o canto da
		// peça e o canto do arquivo são o mesmo lugar.
		const base = await sharp({
			create: { width: W, height: H, channels: 3, background: '#3a3a3a' },
		})
			.png()
			.toBuffer();
		const { left, top } = await escolherSelo(base);
		expect(left < W * 0.15 || left + 120 > W * 0.85).toBe(true);
		expect(top < H * 0.15 || top + 120 > H * 0.85).toBe(true);
	});

	it('numa arte recortada, o canto é o da PEÇA, não o do arquivo', async () => {
		// A silhueta ocupa o miolo e sobra papel em volta. O selo encosta no
		// contorno da peça, não na borda do arquivo.
		const m = 300;
		const { left, top } = await escolherSelo(await pecaRecortada());
		const perto = 120 + (W - 2 * m) * 0.25;
		const noCantoDaPeca =
			(left < m + perto || left + 120 > W - m - perto + 120) &&
			(top < m + perto || top + 120 > H - m - perto + 120);
		expect(noCantoDaPeca).toBe(true);
	});

	it('NUNCA cai fora da peça: os quatro vértices do selo ficam dentro dela', async () => {
		/*
		 * O TESTE QUE MAIS IMPORTA DESTE ARQUIVO.
		 *
		 * Num losango, os cantos da caixa do desenho são papel — e papel é o
		 * lugar mais vazio da arte inteira, então qualquer busca por "vazio" vai
		 * parar lá. Ali o QR é cortado fora e some da peça vendida, que é pior
		 * do que ele cobrir o desenho.
		 */
		const { left, top } = await escolherSelo(await losango());
		const lado = 120;
		const vertices = [
			[left, top],
			[left + lado, top],
			[left, top + lado],
			[left + lado, top + lado],
		];
		for (const [x, y] of vertices) {
			expect(dentroDoLosango(x, y)).toBe(true);
		}
	});

	it('numa peça retangular, também não escapa para o papel em volta', async () => {
		/*
		 * O teste que mais importa deste arquivo. O papel em volta da silhueta é
		 * o lugar mais vazio da arte inteira; qualquer busca ingênua por "vazio"
		 * vai parar lá, e o QR sai na sucata.
		 */
		const { left, top } = await escolherSelo(await pecaRecortada());
		const m = 300;
		expect(left).toBeGreaterThanOrEqual(m);
		expect(top).toBeGreaterThanOrEqual(m);
		expect(left + 120).toBeLessThanOrEqual(W - m);
		expect(top + 120).toBeLessThanOrEqual(H - m);
	});

	it('dentro da peça, foge de onde tem desenho', async () => {
		// Metade de baixo da peça tomada: o selo tem de ir para a metade de cima.
		const m = 300;
		const { top } = await escolherSelo(
			await pecaRecortada([
				{ left: m + 20, top: H / 2, width: W - 2 * m - 40, height: H / 2 - m },
			]),
		);
		expect(top + 120).toBeLessThanOrEqual(H / 2);
	});

	it('respeita a zona de emenda mesmo escolhendo o canto', async () => {
		const Wp = 2905;
		const Hp = 1122;
		const base = await sharp({
			create: { width: Wp, height: Hp, channels: 3, background: '#12212e' },
		})
			.png()
			.toBuffer();
		const { left } = await escolherSelo(base);
		expect(left + 120).toBeLessThanOrEqual(Math.ceil(Wp * 0.92));
		expect(left).toBeGreaterThanOrEqual(Math.floor(Wp * 0.08));
	});
});
