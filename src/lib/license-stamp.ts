import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import QRCode from 'qrcode';
import sharp from 'sharp';

/**
 * O carimbo de autenticidade — o código e o QR gravados DENTRO do pixel da arte.
 *
 * Por que dentro e não ao lado: o arquivo que a plataforma entrega vai parar num
 * pendrive, num grupo de WhatsApp, na pasta compartilhada da oficina. O código
 * viajando num JSON ao lado da imagem não sobrevive a nada disso. Dentro do
 * pixel, a arte e a licença dela são o mesmo objeto — e "arte genérica em alta
 * resolução" deixa de existir como coisa baixável, que é o buraco inteiro do
 * controle de volumetria.
 *
 * ┌─ POR QUE NENHUM `<text>` APARECE AQUI ──────────────────────────────────┐
 * │ O sharp compõe SVG pelo resvg, que procura fonte no fontconfig do        │
 * │ SISTEMA — ele não carrega fonte de buffer. Num contêiner sem fonte       │
 * │ instalada, `<text>` não dá erro: some. O repositório já tem isso medido  │
 * │ e documentado (`tool-blocks/lib/video.ts`, `temFontes`).                 │
 * │                                                                          │
 * │ Um carimbo que some em silêncio é pior que carimbo nenhum, porque a peça │
 * │ sai parecendo licenciada. Então a fonte vira GEOMETRIA antes do SVG: o   │
 * │ `opentype.js` devolve `<path>`, e o renderizador nunca precisa saber o   │
 * │ que é uma fonte. O risco deixa de existir por construção, em vez de ser  │
 * │ testado por sonda.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const require_ = createRequire(import.meta.url);

/**
 * JetBrains Mono Bold, a mesma monoespaçada que a interface usa nos fatos de
 * registro — o código na peça sai igual ao código na tela. Vem do pacote
 * `@fontsource` (OFL) em vez de um `.ttf` solto no repositório: assim é
 * dependência declarada, versionada e com licença rastreável.
 */
const CAMINHO_FONTE = require_.resolve(
	'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff',
);

let fonteCache: opentype.Font | null = null;

function fonte(): opentype.Font {
	if (fonteCache) return fonteCache;
	const buf = readFileSync(CAMINHO_FONTE);
	fonteCache = opentype.parse(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	);
	return fonteCache;
}

/** Tinta e chapa do carimbo. */
const TINTA = '#111111';
const CHAPA = '#ffffff';

/**
 * Chapa clara e tinta escura, sempre, e isso não é preguiça de medir contraste:
 * câmera só lê QR escuro sobre claro. Fixar as duas cores garante a leitura em
 * qualquer arte — e, na peça gravada, uma chapa branca é exatamente "não queime
 * aqui", que é o que a máquina precisa saber.
 */
export interface CarimboOpts {
	/** O código em claro, como sai de `gerarCodigoLicenca`. */
	code: string;
	/** A URL pública que o QR carrega (a página `/a/:code`). */
	url: string;
	/**
	 * Em qual canto pousar. Ausente = a função mede a arte e escolhe o mais
	 * quieto.
	 *
	 * `carimbarLote` SEMPRE passa este campo, decidido uma vez para o lote todo:
	 * é o que mantém as trinta peças de um pedido com o selo no mesmo lugar,
	 * mesmo quando cada peça é uma geração diferente.
	 */
	canto?: Canto;
}

/** Onde o carimbo caiu, em pixels da arte. */
export interface AreaDoCarimbo {
	left: number;
	top: number;
	width: number;
	height: number;
	/** O quadrado do QR dentro da chapa. */
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
	/** Preenchido quando o código saiu sem a linha de texto — ver o catch abaixo. */
	aviso?: string;
}

/** Quebra o código em duas linhas nos grupos, para a chapa não ficar comprida. */
function duasLinhas(code: string): [string, string] {
	const partes = code.split('-');
	if (partes.length < 4) return [code, ''];
	const meio = Math.ceil(partes.length / 2);
	return [partes.slice(0, meio).join('-'), partes.slice(meio).join('-')];
}

/** Duas casas, como texto — sem notação científica e sem `-0`. */
const num = (v: number): string => {
	const r = Math.round(v * 100) / 100;
	return Object.is(r, -0) ? '0' : String(r);
};

/**
 * Serializa o contorno de um glifo à mão, com ESPAÇO entre todo número.
 *
 * ┌─ POR QUE NÃO `path.toPathData()` ────────────────────────────────────────┐
 * │ O serializador do opentype junta os números do jeito compacto que o SVG   │
 * │ permite (`L278.73-24.82`, onde o menos faz as vezes de separador). É      │
 * │ válido — e o renderizador do sharp engole errado: glifos somem do         │
 * │ desenho, e QUAIS somem depende da string.                                 │
 * │                                                                           │
 * │ Medido com a mesma fonte e o mesmo tamanho: "1Z8V6-ERKV0" perdia o "0"    │
 * │ final; "PL-WXQ8W-4Z6NH" saía com o "N" deformado. Não é limite de         │
 * │ tamanho do `d`, não é `fill-rule` (nonzero e evenodd dão o mesmo) e não   │
 * │ é precisão (2 ou 5 casas dão o mesmo). É a formatação.                    │
 * │                                                                           │
 * │ E some SEM ERRO NENHUM — que num código de autenticidade é o pior         │
 * │ desfecho possível: a peça sai gravada e vendida com o código incompleto,  │
 * │ e o defeito só aparece quando alguém tenta digitar aquele código meses    │
 * │ depois.                                                                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
function glifoComoPath(p: opentype.Path): string {
	const partes: string[] = [];
	for (const c of p.commands) {
		if (c.type === 'M') partes.push(`M ${num(c.x)} ${num(c.y)}`);
		else if (c.type === 'L') partes.push(`L ${num(c.x)} ${num(c.y)}`);
		else if (c.type === 'C')
			partes.push(
				`C ${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`,
			);
		else if (c.type === 'Q')
			partes.push(`Q ${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`);
		else partes.push('Z');
	}
	return partes.join(' ');
}

/**
 * O texto do código como `<path>` — geometria, nunca `<text>`. Um path por
 * glifo, para que um contorno problemático nunca leve os vizinhos junto.
 */
function textoComoPaths(
	texto: string,
	tamanho: number,
): { paths: string; largura: number } {
	const f = fonte();
	const paths = f
		.getPaths(texto, 0, 0, tamanho)
		.map((g) => `<path d="${glifoComoPath(g)}"/>`)
		.join('');
	return { paths, largura: f.getAdvanceWidth(texto, tamanho) };
}

/** Os quatro cantos onde o selo pode morar. */
export type Canto =
	| 'baixo-direita'
	| 'baixo-esquerda'
	| 'alto-direita'
	| 'alto-esquerda';

/**
 * Quanta TINTA há num retângulo da arte, de 0 a 1.
 *
 * "Tinta" é pixel opaco E escuro — que é literalmente o que a máquina vai
 * queimar. Transparente não conta (na peça significa "não queime aqui") e claro
 * não conta (é o vazio da composição). Serve igual para os dois fundos que a
 * ferramenta produz: PNG com alfa e PNG achatado no branco.
 */
async function tinta(
	master: Buffer,
	box: { left: number; top: number; width: number; height: number },
): Promise<number> {
	if (box.width <= 0 || box.height <= 0) return 1;
	const { data, info } = await sharp(master)
		.extract(box)
		.ensureAlpha()
		// Reduz antes de contar: a decisão é grosseira ("tem desenho aqui?") e ler
		// duzentos mil pixels por canto seria pagar caro por uma resposta que cabe
		// em 64×64.
		.resize(64, 64, { fit: 'fill' })
		.raw()
		.toBuffer({ resolveWithObject: true });
	const canais = info.channels;
	const total = info.width * info.height;
	let marcados = 0;
	for (let i = 0; i < total; i++) {
		const p = i * canais;
		if (canais === 4 && data[p + 3] < 32) continue;
		const luz = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
		if (luz < 200) marcados++;
	}
	return marcados / total;
}

/**
 * As medidas do selo para uma arte deste tamanho.
 *
 * A largura da chapa depende do código desenhado, que só existe dentro de
 * `carimbarPeca`. Aqui ela é ESTIMADA por cima de propósito: a única usuária é
 * a escolha do canto, e superestimar torna a medida mais exigente — que é o
 * lado seguro de errar quando a pergunta é "cabe sem atrapalhar?".
 */
function geometriaDoSelo(
	W: number,
	H: number,
): { chapaL: number; chapaA: number; margemX: number; margemY: number } {
	const menor = Math.min(W, H);
	const qr = Math.max(130, Math.min(220, Math.round(menor * 0.085)));
	const respiro = Math.round(qr * 0.11);
	return {
		chapaL: Math.round(respiro * 2 + qr * 2.8),
		chapaA: respiro * 2 + qr,
		// No wrap 360° os 8% externos de cada lado são zona de emenda.
		margemX: W / H >= 2 ? Math.round(W * 0.1) : Math.round(menor * 0.025),
		margemY: Math.round(menor * 0.025),
	};
}

/** A caixa do selo num canto, já presa dentro da arte. */
function caixaDoCanto(
	canto: Canto,
	m: {
		W: number;
		H: number;
		chapaL: number;
		chapaA: number;
		margemX: number;
		margemY: number;
	},
): { left: number; top: number; width: number; height: number } {
	const maxL = Math.max(0, m.W - m.chapaL);
	const maxT = Math.max(0, m.H - m.chapaA);
	const direita = canto.endsWith('direita');
	const embaixo = canto.startsWith('baixo');
	return {
		left: Math.max(0, Math.min(maxL, direita ? maxL - m.margemX : m.margemX)),
		top: Math.max(0, Math.min(maxT, embaixo ? maxT - m.margemY : m.margemY)),
		width: Math.min(m.chapaL, m.W),
		height: Math.min(m.chapaA, m.H),
	};
}

/**
 * Acima disto o canto tem DESENHO, não respingo: traço de contorno, letra,
 * escudo. Abaixo, a chapa (que é opaca) pousa ali sem tirar nada de ninguém.
 */
const CANTO_OCUPADO = 0.08;

/**
 * O CANTO MAIS QUIETO, com preferência forte por embaixo.
 *
 * A ordem é a que foi pedida: embaixo sempre que der; dos dois de baixo, o mais
 * vazio; e só sobe quando os dois estão ocupados E o alto é mesmo bem mais
 * limpo. Empate vai para a direita, onde o olho já procura assinatura.
 *
 * Exportada porque `carimbarLote` a chama UMA vez por lote: é isso que mantém
 * as trinta peças de um pedido com o selo no mesmo lugar.
 */
export async function cantoMaisQuieto(master: Buffer): Promise<Canto> {
	const meta = await sharp(master).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	if (!W || !H) return 'baixo-direita';
	const m = { ...geometriaDoSelo(W, H), W, H };

	const medir = async (c: Canto) => tinta(master, caixaDoCanto(c, m));
	const [bd, be] = await Promise.all([
		medir('baixo-direita'),
		medir('baixo-esquerda'),
	]);
	const baixo: Canto = be < bd - 0.01 ? 'baixo-esquerda' : 'baixo-direita';
	const tintaBaixo = Math.min(bd, be);
	if (tintaBaixo <= CANTO_OCUPADO) return baixo;

	const [ad, ae] = await Promise.all([
		medir('alto-direita'),
		medir('alto-esquerda'),
	]);
	const alto: Canto = ae < ad - 0.01 ? 'alto-esquerda' : 'alto-direita';
	// Na dúvida, embaixo — como foi pedido. Só sobe com folga clara.
	return Math.min(ad, ae) < tintaBaixo - 0.05 ? alto : baixo;
}

/**
 * Aplica o carimbo e devolve o PNG da peça.
 *
 * O recuo lateral não é estético: os modelos de wrap 360° reservam os 8%
 * externos de cada lado como zona de emenda, e um carimbo ali quebraria a
 * costura da caneca.
 *
 * ┌─ POR QUE O CANTO DEIXOU DE SER FIXO ────────────────────────────────────┐
 * │ Era sempre o inferior direito, e o argumento escrito aqui era bom: quem  │
 * │ grava precisa saber onde o código cai, e carimbo que anda de lugar       │
 * │ atrapalha a produção.                                                    │
 * │                                                                          │
 * │ Só que o chaveiro "escudo e nome" — o carro-chefe da ferramenta — põe o  │
 * │ nome ocupando a base inteira. Medido em produção: "JOAO" saiu com o      │
 * │ último "O" coberto pela chapa. Um carimbo que come a peça é pior que um  │
 * │ carimbo que muda de canto.                                               │
 * │                                                                          │
 * │ A produção continua atendida, porque a estabilidade que ela precisa é    │
 * │ POR LOTE, não universal: `carimbarLote` decide o canto uma vez e passa o │
 * │ mesmo para todas as peças. As 30 canecas de um pedido saem iguais.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export async function carimbarPeca(
	master: Buffer,
	opts: CarimboOpts,
): Promise<CarimboResult> {
	const meta = await sharp(master).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	if (!W || !H) throw new Error('carimbarPeca: master sem dimensões');

	// O carimbo é obrigatório, então tem de ser DISCRETO: o menor que ainda
	// sobrevive à gravação a laser e à foto de celular. Abaixo de ~130px na arte
	// os módulos do QR fecham no queimado e ele deixa de ler.
	const menor = Math.min(W, H);
	const qr = Math.max(130, Math.min(220, Math.round(menor * 0.085)));
	const respiro = Math.round(qr * 0.11);
	const alturaTexto = Math.round(qr * 0.16);

	let paths = '';
	let larguraTexto = 0;
	let aviso: string | undefined;
	try {
		const [a, b] = duasLinhas(opts.code);
		const l1 = textoComoPaths(a, alturaTexto);
		const l2 = b ? textoComoPaths(b, alturaTexto) : { paths: '', largura: 0 };
		larguraTexto = Math.ceil(Math.max(l1.largura, l2.largura));
		const baseX = qr + respiro;
		const baseY = Math.round(qr * 0.42);
		paths =
			`<g fill="${TINTA}">` +
			`<g transform="translate(${baseX} ${baseY})">${l1.paths}</g>` +
			(l2.paths
				? `<g transform="translate(${baseX} ${baseY + Math.round(alturaTexto * 1.4)})">${l2.paths}</g>`
				: '') +
			`</g>`;
	} catch (err) {
		// O QR é o que o consumidor escaneia; a linha de texto é o atalho humano.
		// Perder a segunda NUNCA pode custar a peça inteira — sai o carimbo com
		// QR e um aviso, em vez de uma arte licenciada sem marca nenhuma.
		aviso = `código não pôde ser desenhado: ${err instanceof Error ? err.message : 'erro'}`;
		larguraTexto = 0;
		paths = '';
	}

	const selo = qr + (larguraTexto ? respiro + larguraTexto : 0);
	const chapaL = respiro + selo + respiro;
	const chapaA = respiro + qr + respiro;
	const raio = Math.round(respiro * 0.9);

	/**
	 * A CHAPA existe porque o QR precisa de zona quieta clara para a câmera ler
	 * — sobre uma foto escura, módulos escuros não leem. É o único jeito de o
	 * carimbo morar DENTRO da arte e continuar escaneável.
	 *
	 * O fio de contorno é para a arte de laser, que é branca: sem ele a chapa
	 * branca some no fundo e o QR parece flutuar solto sobre o desenho.
	 */
	const fio = Math.max(1, Math.round(qr * 0.012));
	const chapa = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${chapaL}" height="${chapaA}" viewBox="0 0 ${chapaL} ${chapaA}">` +
			`<rect x="${fio / 2}" y="${fio / 2}" width="${chapaL - fio}" height="${chapaA - fio}" rx="${raio}" ry="${raio}" fill="${CHAPA}" stroke="${TINTA}" stroke-width="${fio}"/>` +
			`<g transform="translate(${respiro} ${respiro})">${paths}</g>` +
			`</svg>`,
	);

	/**
	 * O CARIMBO É PARTE DA ARTE, não um campo colado nela.
	 *
	 * A tela NÃO cresce: o selo mora no canto inferior direito da própria arte.
	 * Uma faixa acrescentada embaixo mudava a proporção da peça e parecia um
	 * apêndice — na caneca 360° chegava a quebrar o formato do wrap.
	 *
	 * O preço disso é honesto e escolhido: o selo cobre um pedaço do canto. Por
	 * isso ele é o menor que ainda escaneia, e por isso os modelos deveriam
	 * reservar esse canto na composição.
	 *
	 * O recuo da direita só cresce na arte PANORÂMICA: no wrap 360° os 8%
	 * externos de cada lado são zona de emenda, e selo ali quebraria a costura
	 * da caneca.
	 */
	// O QR sai como PNG e é composto por cima: pixel exato, sem passar por
	// renderizador de SVG. Nível H (30% de redundância) porque ele vai gravado
	// em acrílico ou metal e fotografado de lado, com risco e reflexo.
	//
	// Fundo transparente aqui porque quem dá a zona quieta é a CHAPA: assim o
	// selo é uma peça só, de canto arredondado, em vez de um quadrado branco do
	// QR encostado num retângulo do texto.
	const qrPng = await QRCode.toBuffer(opts.url, {
		errorCorrectionLevel: 'H',
		type: 'png',
		width: qr,
		margin: 0,
		color: { dark: TINTA, light: '#00000000' },
	});

	const panoramica = W / H >= 2;
	const margemX = panoramica ? Math.round(W * 0.1) : Math.round(menor * 0.025);
	const margemY = Math.round(menor * 0.025);
	// O canto do LOTE, quando veio; senão mede esta arte e escolhe.
	const canto = opts.canto ?? (await cantoMaisQuieto(master));
	const { left, top } = caixaDoCanto(canto, {
		W,
		H,
		chapaL,
		chapaA,
		margemX,
		margemY,
	});

	const png = await sharp(master)
		.ensureAlpha()
		.composite([
			{ input: chapa, left, top },
			{ input: qrPng, left: left + respiro, top: top + respiro },
		])
		.png()
		.toBuffer();

	return {
		png,
		area: {
			left,
			top,
			width: chapaL,
			height: chapaA,
			qr: { left: left + respiro, top: top + respiro, size: qr },
		},
		aviso,
	};
}
