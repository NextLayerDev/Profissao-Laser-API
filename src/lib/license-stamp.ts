import QRCode from 'qrcode';
import sharp from 'sharp';

/**
 * O carimbo de autenticidade — o QR gravado DENTRO do pixel da arte.
 *
 * Por que dentro e não ao lado: o arquivo que a plataforma entrega vai parar num
 * pendrive, num grupo de WhatsApp, na pasta compartilhada da oficina. O código
 * viajando num JSON ao lado da imagem não sobrevive a nada disso. Dentro do
 * pixel, a arte e a licença dela são o mesmo objeto — e "arte genérica em alta
 * resolução" deixa de existir como coisa baixável, que é o buraco inteiro do
 * controle de volumetria.
 *
 * ┌─ A PLACA VOLTOU, SEM O TEXTO ───────────────────────────────────────────┐
 * │ Primeiro havia uma chapa branca com o código por extenso ao lado do QR   │
 * │ (349×158 px). Saiu por brigar com o desenho. Depois ficou só o QR, sem   │
 * │ fundo, invertendo a cor sobre arte escura.                               │
 * │                                                                          │
 * │ Sem fundo não sobreviveu ao chão de fábrica: sobre arte cinza ou com     │
 * │ textura o QR se mistura ao desenho, e no software do laser — que mostra  │
 * │ tudo em tons de cinza — ninguém acha nem lê o código. O cliente mandou   │
 * │ o print de como tem de ser: QR preto numa PLACA branca de cantos         │
 * │ arredondados com borda preta fina. Na peça gravada é coerente: branco é  │
 * │ "não queime aqui", a borda e os módulos são o queimado.                  │
 * │                                                                          │
 * │ O texto do código NÃO voltou — ele continua no nome do arquivo e na      │
 * │ biblioteca do aluno. A placa é só o que o QR precisa para ler sempre.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** A tinta do QR e da borda da placa. */
const TINTA = '#111111';
/** O fundo da placa. */
const PLACA = '#ffffff';

/** A decisão do selo para uma arte: onde a placa pousa. */
export interface Selo {
	/** Canto superior esquerdo da PLACA, em pixels da arte. */
	left: number;
	top: number;
}

export interface CarimboOpts {
	/** O código em claro, como sai de `gerarCodigoLicenca`. */
	code: string;
	/** A URL pública que o QR carrega (a página `/a/:code`). */
	url: string;
	/**
	 * O selo já decidido. Ausente = a função mede esta arte e decide sozinha.
	 *
	 * `carimbarLote` SEMPRE passa este campo, resolvido uma vez para o lote
	 * todo: é o que mantém as trinta peças de um pedido com o mesmo selo, no
	 * mesmo canto, mesmo quando cada peça é uma geração diferente.
	 */
	selo?: Selo;
}

/** Onde o carimbo caiu, em pixels da arte. */
export interface AreaDoCarimbo {
	/** A PLACA inteira: fundo branco + borda. */
	left: number;
	top: number;
	width: number;
	height: number;
	/** Só o QR, dentro da placa. */
	qr: { left: number; top: number; size: number };
}

export interface CarimboResult {
	png: Buffer;
	/**
	 * Onde o carimbo ficou. Devolvido, e não só usado internamente, porque a
	 * geometria é um FATO da peça: quem grava precisa saber onde o código caiu,
	 * e um teste que recalcula a conta à mão testa a cópia, não o carimbo.
	 */
	area: AreaDoCarimbo;
	/** Onde a placa pousou — o lote inteiro usa a mesma. */
	selo: Selo;
}

/** Lado da grade em que a arte é lida para escolher o lugar do selo. */
const GRADE = 96;

interface MapaDaArte {
	/** `true` onde há tinta (pixel opaco e escuro) — o que a máquina queima. */
	tinta: boolean[];
	/**
	 * `true` onde a célula está DENTRO da peça.
	 *
	 * Dentro quer dizer cercada: existe tinta acima, abaixo, à esquerda e à
	 * direita dela. É um teste barato e surpreendentemente certeiro para
	 * silhueta recortada — e é o que separa o vazio de dentro do chaveiro do
	 * vazio que vira sucata depois do corte.
	 */
	dentro: boolean[];
}

/**
 * Lê a arte inteira numa grade pequena, de uma vez.
 *
 * `GRADE × GRADE` é grosseiro de propósito: a pergunta é "cabe aqui?", e ler
 * milhões de pixels para respondê-la seria pagar caro por uma resposta que cabe
 * em nove mil células. Transparente conta como CLARO porque, na arte de laser,
 * transparente é o material cru — e material cru é claro.
 */
async function lerArte(master: Buffer): Promise<MapaDaArte> {
	const { data, info } = await sharp(master)
		.ensureAlpha()
		.resize(GRADE, GRADE, { fit: 'fill' })
		.raw()
		.toBuffer({ resolveWithObject: true });

	const n = GRADE * GRADE;
	const tinta: boolean[] = new Array(n);
	for (let i = 0; i < n; i++) {
		const p = i * info.channels;
		const alfa = info.channels === 4 ? data[p + 3] : 255;
		const l = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
		tinta[i] = alfa >= 32 && l < 200;
	}

	// Para cada linha e coluna, onde começa e termina a tinta. Com isso, "cercada
	// nas quatro direções" sai em O(1) por célula.
	const primeiroNaLinha = new Array(GRADE).fill(-1);
	const ultimoNaLinha = new Array(GRADE).fill(-1);
	const primeiroNaColuna = new Array(GRADE).fill(-1);
	const ultimoNaColuna = new Array(GRADE).fill(-1);
	for (let y = 0; y < GRADE; y++) {
		for (let x = 0; x < GRADE; x++) {
			if (!tinta[y * GRADE + x]) continue;
			if (primeiroNaLinha[y] < 0) primeiroNaLinha[y] = x;
			ultimoNaLinha[y] = x;
			if (primeiroNaColuna[x] < 0) primeiroNaColuna[x] = y;
			ultimoNaColuna[x] = y;
		}
	}

	const dentro: boolean[] = new Array(n);
	for (let y = 0; y < GRADE; y++) {
		for (let x = 0; x < GRADE; x++) {
			dentro[y * GRADE + x] =
				primeiroNaLinha[y] >= 0 &&
				primeiroNaColuna[x] >= 0 &&
				x > primeiroNaLinha[y] &&
				x < ultimoNaLinha[y] &&
				y > primeiroNaColuna[x] &&
				y < ultimoNaColuna[x];
		}
	}

	return { tinta, dentro };
}

/**
 * QUANTO DA ARTE O QR OCUPA: ~8% do menor lado.
 *
 * Proporcional, e não fixo, porque a mesma peça é vendida como chaveiro de
 * 1200 px e como caneca de 2905×1122: um QR de 82 px fixos é discreto num e
 * ilegível no outro. O pedido foi "como no print" — visível, no canto.
 */
const FRACAO_DO_MENOR_LADO = 0.08;

/**
 * O PISO DE PIXELS POR MÓDULO — medido, não escolhido.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Gerando o QR e tentando decodificá-lo em 24 condições (borrão do         │
 * │ queimado × ângulo da foto × distância), a taxa de leitura é:             │
 * │                                                                          │
 * │     2 px/módulo  →  82 px  →  75% das tentativas                         │
 * │   2,5 px/módulo  → 103 px  →  79%                                        │
 * │     3 px/módulo  → 123 px  → 100%                                        │
 * │                                                                          │
 * │ 3 px/módulo é um DEGRAU, não uma rampa — abaixo dele a leitura despenca. │
 * │ E o múltiplo tem de ser INTEIRO: 110 px (2,68 px/módulo) leu em 13% das  │
 * │ tentativas, com 100 px e 120 px, vizinhos dos dois lados, em ~80%. Com   │
 * │ tamanho quebrado o renderizador reamostra e as bordas dos módulos borram │
 * │ — um defeito intermitente, invisível até a peça estar gravada.           │
 * │                                                                          │
 * │ Por isso o tamanho proporcional é ARREDONDADO para um múltiplo inteiro,  │
 * │ nunca abaixo de 2: em arte até ~1280 px de menor lado dá 2 px/módulo     │
 * │ (82 px); acima disso, 3 (123 px) — e é aí que a leitura chega a 100%.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const MINIMO_PX_POR_MODULO = 2;

/** As medidas do selo para uma arte deste tamanho e esta URL. */
export interface GeometriaDoSelo {
	/** Lado da PLACA — o quadrado que precisa caber na peça. */
	lado: number;
	/** Lado do QR, dentro da placa. */
	qr: number;
	/** Pixels por módulo do QR — inteiro, ver `MINIMO_PX_POR_MODULO`. */
	pxPorModulo: number;
	/** Respiro branco entre a borda e o QR (a "zona quieta" do padrão). */
	respiro: number;
	/** Espessura da borda preta da placa. */
	borda: number;
	/** Raio dos cantos arredondados da placa. */
	raio: number;
	/** Distância mínima da placa às bordas do arquivo. */
	margemX: number;
	margemY: number;
}

/**
 * Exportada para os testes derivarem o lado da REGRA em vez de copiar um
 * número: fixar "94" num teste faria ele testar a constante, não o carimbo.
 */
export function geometriaDoSelo(
	W: number,
	H: number,
	url: string,
): GeometriaDoSelo {
	const menor = Math.min(W, H);
	const modulos = QRCode.create(url, { errorCorrectionLevel: 'H' }).modules
		.size;
	const pxPorModulo = Math.max(
		MINIMO_PX_POR_MODULO,
		Math.round((menor * FRACAO_DO_MENOR_LADO) / modulos),
	);
	const qr = modulos * pxPorModulo;
	// Dois módulos de respiro: o padrão pede quatro para leitores antigos, mas
	// aqui o branco da placa já é o contraste — e cada módulo a mais é arte
	// coberta.
	const respiro = 2 * pxPorModulo;
	const borda = Math.max(2, pxPorModulo);
	const lado = qr + 2 * respiro + 2 * borda;
	return {
		lado,
		qr,
		pxPorModulo,
		respiro,
		borda,
		raio: Math.round(lado / 10),
		// No wrap 360° os 8% externos de cada lado são zona de emenda da caneca.
		margemX: W / H >= 2 ? Math.round(W * 0.1) : Math.round(menor * 0.012),
		margemY: Math.round(menor * 0.012),
	};
}

/**
 * O SELO DO LOTE: ONDE a placa pousa.
 *
 * ┌─ POR QUE NÃO É SIMPLESMENTE "O CANTO DO ARQUIVO" ───────────────────────┐
 * │ Na caneca, que é um retângulo cheio, o canto do arquivo serve. No        │
 * │ chaveiro recortado, o canto do arquivo é o lado de FORA da silhueta, e   │
 * │ ali o QR vai parar na sucata do corte. Código que não fica na peça é     │
 * │ pior que código em cima do nome.                                         │
 * │                                                                          │
 * │ Então o canto é o da PEÇA (a tinta), medido em `MapaDaArte.dentro`, e é  │
 * │ sempre o mesmo: embaixo à ESQUERDA, como no print do cliente. Não há     │
 * │ busca por "canto mais vazio" — isso já mandou o QR para lugares que      │
 * │ ninguém previa. Os outros cantos só entram se ali não couber nada.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Exportada porque `carimbarLote` a chama UMA vez por lote: é isso que mantém
 * as trinta peças de um pedido com o selo idêntico.
 */
export async function escolherSelo(
	master: Buffer,
	/** A URL que o QR vai carregar — é ela que define o tamanho do selo. */
	url: string,
): Promise<Selo> {
	const meta = await sharp(master).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	const g = geometriaDoSelo(W, H, url);
	/** O canto de baixo à esquerda do arquivo — o desfecho quando nada serve. */
	const ultimoRecurso = (): Selo => ({
		left: Math.min(Math.max(0, W - g.lado), g.margemX),
		top: Math.max(0, H - g.lado - g.margemY),
	});
	if (!W || !H) return { left: 0, top: 0 };

	const mapa = await lerArte(master);
	const porX = GRADE / W;
	const porY = GRADE / H;
	// O selo em células da grade, arredondado para cima: melhor exigir espaço a
	// mais do que descobrir na peça que faltou.
	const larguraEmCelulas = Math.max(1, Math.ceil(g.lado * porX));
	const alturaEmCelulas = Math.max(1, Math.ceil(g.lado * porY));

	const minX = Math.floor(g.margemX * porX);
	const maxX = Math.floor((W - g.lado - g.margemX) * porX);
	const minY = Math.floor(g.margemY * porY);
	const maxY = Math.floor((H - g.lado - g.margemY) * porY);
	if (maxX < minX || maxY < minY) return ultimoRecurso();

	/** O bloco cabe inteiro DENTRO da peça? */
	const cabe = (x: number, y: number): boolean => {
		if (x < minX || y < minY || x > maxX || y > maxY) return false;
		for (let dy = 0; dy < alturaEmCelulas; dy++) {
			for (let dx = 0; dx < larguraEmCelulas; dx++) {
				if (!mapa.dentro[(y + dy) * GRADE + (x + dx)]) return false;
			}
		}
		return true;
	};

	/**
	 * O RETÂNGULO DA PEÇA, que não é o do arquivo.
	 *
	 * Numa arte recortada — o chaveiro — a silhueta ocupa o meio e sobra papel
	 * em volta. O canto do ARQUIVO ali é o lado de fora do corte. O canto que
	 * interessa é o da tinta.
	 */
	let pMinX = GRADE;
	let pMinY = GRADE;
	let pMaxX = -1;
	let pMaxY = -1;
	for (let y = 0; y < GRADE; y++) {
		for (let x = 0; x < GRADE; x++) {
			if (!mapa.tinta[y * GRADE + x]) continue;
			if (x < pMinX) pMinX = x;
			if (x > pMaxX) pMaxX = x;
			if (y < pMinY) pMinY = y;
			if (y > pMaxY) pMaxY = y;
		}
	}
	if (pMaxX < 0) return ultimoRecurso();

	/**
	 * DE UM CANTO DA PEÇA, O PRIMEIRO LUGAR QUE CABE.
	 *
	 * Num losango ou em qualquer silhueta recortada, a quina da caixa é papel
	 * que o corte leva embora, então o selo anda da quina para dentro até o
	 * primeiro bloco inteiramente dentro da peça — e para ali. Três caminhos
	 * (diagonal e as duas bordas), e ganha o que entra mais PERTO da quina,
	 * medido em pixels da arte e não em células: a grade é 96×96 seja qual for
	 * a proporção, e na caneca 360° uma célula horizontal vale duas vezes e
	 * meia uma vertical.
	 */
	const perto = (
		quinaX: number,
		quinaY: number,
		passoX: number,
		passoY: number,
	): { x: number; y: number } | null => {
		let melhor: { x: number; y: number; distPx: number } | null = null;
		for (const [px, py] of [
			[passoX, passoY],
			[passoX, 0],
			[0, passoY],
		]) {
			const passoPx = Math.hypot(px / porX, py / porY);
			for (let k = 0; k < GRADE; k++) {
				const x = quinaX + px * k;
				const y = quinaY + py * k;
				if (!cabe(x, y)) continue;
				const distPx = k * passoPx;
				if (!melhor || distPx < melhor.distPx) melhor = { x, y, distPx };
				break;
			}
		}
		return melhor;
	};

	/**
	 * A quina de partida já nasce DENTRO da zona permitida.
	 *
	 * Sem isto, na caneca 360° a quina da peça caía na zona de emenda (os 10%
	 * externos), e a única rota que saía dela era a diagonal — que troca altura
	 * por largura: o QR terminava 11% acima da borda de baixo, e não a 1%. A
	 * caminhada existe para silhueta recortada, não para pagar margem.
	 */
	const esq = Math.max(pMinX, minX);
	const dir = Math.min(pMaxX - larguraEmCelulas + 1, maxX);
	const baixo = Math.min(pMaxY - alturaEmCelulas + 1, maxY);
	const cima = Math.max(pMinY, minY);
	// Embaixo à esquerda é O canto. Os outros só entram se ali não couber nada
	// dentro da peça — não há comparação de "mais vazio" entre eles.
	const escolhido =
		perto(esq, baixo, 1, -1) ??
		perto(dir, baixo, -1, -1) ??
		perto(esq, cima, 1, 1) ??
		perto(dir, cima, -1, 1);

	if (!escolhido) return ultimoRecurso();

	return {
		left: Math.max(0, Math.min(W - g.lado, Math.round(escolhido.x / porX))),
		top: Math.max(0, Math.min(H - g.lado, Math.round(escolhido.y / porY))),
	};
}

/** A placa: quadrado branco de cantos arredondados com borda preta fina. */
function placaSvg(g: GeometriaDoSelo): Buffer {
	// O stroke do SVG é centrado no contorno; deslocar meio traço para dentro
	// deixa a borda inteira dentro do quadrado, sem pixel cortado na aresta.
	const meio = g.borda / 2;
	const interno = g.lado - g.borda;
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${g.lado}" height="${g.lado}">` +
			`<rect x="${meio}" y="${meio}" width="${interno}" height="${interno}" rx="${g.raio}" ry="${g.raio}" ` +
			`fill="${PLACA}" stroke="${TINTA}" stroke-width="${g.borda}"/></svg>`,
	);
}

/**
 * Aplica o carimbo e devolve o PNG da peça.
 *
 * A placa vai como SVG (é geometria: retângulo arredondado), o QR vai como PNG
 * com `scale` inteiro — pixel exato, sem reamostragem, ver `geometriaDoSelo`.
 * Nível H (30% de redundância) porque ele vai gravado em acrílico ou metal e
 * fotografado de lado, com risco e reflexo.
 */
export async function carimbarPeca(
	master: Buffer,
	opts: CarimboOpts,
): Promise<CarimboResult> {
	const meta = await sharp(master).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	if (!W || !H) throw new Error('carimbarPeca: master sem dimensões');

	const selo = opts.selo ?? (await escolherSelo(master, opts.url));
	const g = geometriaDoSelo(W, H, opts.url);
	const placa = {
		left: Math.max(0, Math.min(W - g.lado, selo.left)),
		top: Math.max(0, Math.min(H - g.lado, selo.top)),
		width: Math.min(g.lado, W),
		height: Math.min(g.lado, H),
	};
	const qr = {
		left: placa.left + g.borda + g.respiro,
		top: placa.top + g.borda + g.respiro,
		size: g.qr,
	};

	const qrPng = await QRCode.toBuffer(opts.url, {
		errorCorrectionLevel: 'H',
		type: 'png',
		scale: g.pxPorModulo,
		margin: 0,
		color: { dark: TINTA, light: PLACA },
	});

	const png = await sharp(master)
		.ensureAlpha()
		.composite([
			{ input: placaSvg(g), left: placa.left, top: placa.top },
			{ input: qrPng, left: qr.left, top: qr.top },
		])
		.png()
		.toBuffer();

	return { png, area: { ...placa, qr }, selo };
}
