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
 * O SELO DO LOTE: ONDE a placa pousa — o canto inferior esquerdo do ARQUIVO.
 *
 * ┌─ O QUE SAIU DAQUI, E POR QUÊ ───────────────────────────────────────────┐
 * │ Havia uma leitura da arte numa grade 96×96 para achar o canto da PEÇA    │
 * │ (a silhueta de tinta), e não do arquivo: num chaveiro recortado, o canto │
 * │ do arquivo é papel que o corte leva embora. A ideia era boa e o resultado│
 * │ não: exigir que a placa ficasse "cercada de tinta" num escudo com o nome │
 * │ embaixo mandou o QR para o MEIO do escudo, em cima da âncora — e o       │
 * │ cliente foi claro: "sempre no canto, nunca no meio da arte, independente │
 * │ da dimensão".                                                            │
 * │                                                                          │
 * │ Então o canto é o do arquivo, sempre o mesmo, sem olhar o conteúdo. Quem │
 * │ grava um recorte já posiciona o QR na peça no software do laser — o      │
 * │ print que motivou a placa mostra exatamente isso, o QR como objeto à     │
 * │ parte, arrastado para onde cabe. O que a plataforma garante é que ele    │
 * │ está no arquivo, legível, e num lugar previsível.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Continua assíncrona e exportada pela mesma razão de sempre: `carimbarLote`
 * a chama UMA vez por lote, e o lote inteiro sai com o selo idêntico.
 */
export async function escolherSelo(
	master: Buffer,
	/** A URL que o QR vai carregar — é ela que define o tamanho do selo. */
	url: string,
): Promise<Selo> {
	const meta = await sharp(master).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	if (!W || !H) return { left: 0, top: 0 };
	const g = geometriaDoSelo(W, H, url);
	return {
		left: Math.min(Math.max(0, W - g.lado), g.margemX),
		top: Math.max(0, H - g.lado - g.margemY),
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
