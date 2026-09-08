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

	it('respeita a zona de emenda do wrap 360°', async () => {
		// Os modelos de caneca reservam os 8% externos de cada lado para a costura
		// da arte. Carimbo ali quebraria a emenda da peça gravada.
		const W = 2905;
		const H = 1122;
		const base = await arte(W, H, '#12212e');
		const { area } = await carimbarPeca(base, { code: CODE, url: URL });

		expect(area.left).toBeGreaterThanOrEqual(Math.floor(W * 0.08));
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

		// E fica NO CANTO de baixo à esquerda, colado nas bordas — a margem é ~1%
		// do menor lado.
		expect(area.left).toBeLessThan(W * 0.02);
		expect(H - (area.top + area.height)).toBeLessThan(H * 0.02);
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
	 * │ O selo já foi fixo num canto do ARQUIVO. Na caneca, que é um retângulo   │
	 * │ cheio, funcionava. No chaveiro quebrou: ao procurar "o canto mais       │
	 * │ vazio", ia parar FORA da silhueta, porque o vazio de verdade num        │
	 * │ recorte é o papel em volta — e ali o QR é cortado fora e some da peça.  │
	 * │                                                                          │
	 * │ E já "fugiu do desenho" para o canto mais quieto: na caneca com foto    │
	 * │ foi parar em cima à esquerda, "em lugar aleatório" para o cliente. O    │
	 * │ canto é FIXO agora — embaixo à esquerda — e o selo só se move para      │
	 * │ ficar dentro da peça.                                                    │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	const W = 1200;
	const H = 1200;
	const LADO = geometriaDoSelo(W, H, URL).lado;

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

	/**
	 * O ponto está dentro do losango desenhado acima?
	 *
	 * Com a folga de UMA célula da grade (1200/96 = 12,5 px). A escolha do lugar
	 * é feita numa grade de 96×96 — é isso que a torna barata —, então exigir
	 * precisão de pixel seria cobrar do algoritmo uma garantia que ele não dá e
	 * não precisa dar: meia célula de sobra na borda não tira o selo da peça.
	 */
	const GRADE_PX = W / 96;
	const dentroDoLosango = (x: number, y: number) =>
		Math.abs(x - W / 2) + Math.abs(y - W / 2) <= 520 + GRADE_PX;

	it('numa arte cheia, o selo vai para o canto de baixo à ESQUERDA', async () => {
		// Sangria total (o caso da caneca): a peça É o arquivo, então o canto da
		// peça e o canto do arquivo são o mesmo lugar.
		const base = await sharp({
			create: { width: W, height: H, channels: 3, background: '#3a3a3a' },
		})
			.png()
			.toBuffer();
		const { left, top } = await escolherSelo(base, URL);
		expect(left).toBeLessThan(W * 0.03);
		expect(H - (top + LADO)).toBeLessThan(H * 0.03);
	});

	it('numa arte recortada, o canto é o da PEÇA, não o do arquivo', async () => {
		// A silhueta ocupa o miolo e sobra papel em volta. O selo encosta no
		// contorno da peça, não na borda do arquivo.
		const m = 300;
		const { left, top } = await escolherSelo(await pecaRecortada(), URL);
		const folga = 2 * GRADE_PX;
		expect(left).toBeGreaterThanOrEqual(m);
		expect(left).toBeLessThanOrEqual(m + folga + 12);
		expect(top + LADO).toBeLessThanOrEqual(H - m);
		expect(top + LADO).toBeGreaterThanOrEqual(H - m - folga - 12);
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
		const { left, top } = await escolherSelo(await losango(), URL);
		const vertices = [
			[left, top],
			[left + LADO, top],
			[left, top + LADO],
			[left + LADO, top + LADO],
		];
		for (const [x, y] of vertices) {
			expect(dentroDoLosango(x, y)).toBe(true);
		}
	});

	it('numa peça retangular, também não escapa para o papel em volta', async () => {
		const { left, top } = await escolherSelo(await pecaRecortada(), URL);
		const m = 300;
		expect(left).toBeGreaterThanOrEqual(m);
		expect(top).toBeGreaterThanOrEqual(m);
		expect(left + LADO).toBeLessThanOrEqual(W - m);
		expect(top + LADO).toBeLessThanOrEqual(H - m);
	});

	it('fica no canto de BAIXO À ESQUERDA da peça mesmo com desenho ali', async () => {
		// O canto é fixo: o selo não foge do desenho, ele pousa no canto e a
		// placa garante que continua legível em cima do que estiver lá.
		const m = 300;
		const { left, top } = await escolherSelo(
			await pecaRecortada([
				{ left: m + 20, top: H / 2, width: W - 2 * m - 40, height: H / 2 - m },
			]),
			URL,
		);
		const folga = 2 * GRADE_PX;
		expect(left).toBeLessThanOrEqual(m + folga + 12);
		expect(top + LADO).toBeGreaterThanOrEqual(H - m - folga - 12);
	});

	it('na arte cheia o canto é SEMPRE o de baixo à esquerda', async () => {
		// Duas artes, a mesma quina: o cliente tem de saber onde o QR vai cair
		// antes de gerar. Metade de cima clara e metade de baixo escura não muda
		// nada — não existe mais "canto mais vazio".
		const base = await arteCom([
			{ left: 0, top: H / 2, width: W, height: H / 2 },
		]);
		const { left, top } = await escolherSelo(base, URL);
		expect(left).toBeLessThan(W * 0.03);
		expect(H - (top + LADO)).toBeLessThan(H * 0.03);
	});

	it('respeita a zona de emenda mesmo escolhendo o canto', async () => {
		const Wp = 2905;
		const Hp = 1122;
		const lado = geometriaDoSelo(Wp, Hp, URL).lado;
		const base = await sharp({
			create: { width: Wp, height: Hp, channels: 3, background: '#12212e' },
		})
			.png()
			.toBuffer();
		const { left, top } = await escolherSelo(base, URL);
		expect(left).toBeGreaterThanOrEqual(Math.floor(Wp * 0.08));
		expect(left + lado).toBeLessThanOrEqual(Math.ceil(Wp * 0.92));
		// E a emenda não empurra o selo para CIMA: ele continua colado na borda
		// de baixo.
		expect(Hp - (top + lado)).toBeLessThan(Hp * 0.03);
	});
});
