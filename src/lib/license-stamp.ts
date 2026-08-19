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

/** A tinta do carimbo. Não há chapa: o fundo é transparente. */
const TINTA = '#111111';

/**
 * FUNDO TRANSPARENTE, tinta escura.
 *
 * Numa arte de laser, transparente quer dizer "não queime aqui" — que é
 * exatamente o que o fundo do QR precisa ser para os módulos escuros lerem por
 * contraste contra o material cru. Uma chapa branca opaca faria a mesma coisa
 * na máquina, mas apagaria o que estivesse embaixo, e o carimbo NÃO fica em
 * cima da arte (ver `carimbarPeca`).
 */
export interface CarimboOpts {
	/** O código em claro, como sai de `gerarCodigoLicenca`. */
	code: string;
	/** A URL pública que o QR carrega (a página `/a/:code`). */
	url: string;
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

/**
 * Aplica o carimbo e devolve o PNG da peça.
 *
 * A posição é fixa — canto inferior direito, recuado 10% da largura. O recuo
 * não é estético: os modelos de wrap 360° reservam os 8% externos de cada lado
 * como zona de emenda, e um carimbo ali quebraria a costura da caneca. Uma
 * regra só, que serve tanto para a arte quadrada quanto para a panorâmica.
 *
 * Posição FIXA e não "o canto mais quieto": quem grava precisa saber onde o
 * código vai cair para posicionar a peça, e um carimbo que anda de lugar a cada
 * geração é um carimbo que atrapalha a produção.
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
	// sobrevive à gravação a laser e à foto de celular. Abaixo de ~140px na arte
	// os módulos do QR fecham no queimado e ele deixa de ler.
	const menor = Math.min(W, H);
	const qr = Math.max(140, Math.min(260, Math.round(menor * 0.1)));
	const respiro = Math.round(qr * 0.12);
	const alturaTexto = Math.round(qr * 0.17);

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
	const banda = qr + respiro * 2;

	const texto = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${selo}" height="${qr}" viewBox="0 0 ${selo} ${qr}">${paths}</svg>`,
	);

	// O QR sai como PNG e é composto por cima: pixel exato, sem passar por
	// renderizador de SVG. Nível H (30% de redundância) porque ele vai gravado
	// em acrílico ou metal e fotografado de lado, com risco e reflexo. O fundo
	// claro é TRANSPARENTE — na peça, "não queime aqui".
	const qrPng = await QRCode.toBuffer(opts.url, {
		errorCorrectionLevel: 'H',
		type: 'png',
		width: qr,
		margin: 0,
		color: { dark: TINTA, light: '#00000000' },
	});

	/**
	 * O CARIMBO NÃO FICA EM CIMA DA ARTE.
	 *
	 * A tela cresce para baixo e o selo mora na faixa nova. Foi a correção de um
	 * defeito visto na peça: no chaveiro, o carimbo caía por cima do nome
	 * gravado. Uma arte licenciada não pode ser estragada pela marca que a
	 * autentica — e o operador ainda ganha uma área separada, que ele posiciona
	 * ou apara como quiser.
	 *
	 * O recuo da direita só cresce na arte PANORÂMICA: no wrap 360° os 8%
	 * externos de cada lado são zona de emenda, e selo ali quebraria a costura
	 * da caneca.
	 */
	const panoramica = W / H >= 2;
	const margemX = panoramica ? Math.round(W * 0.1) : respiro;
	const left = Math.max(0, W - selo - margemX);
	const top = H + respiro;

	const png = await sharp({
		create: {
			width: W,
			height: H + banda,
			channels: 4,
			// Fundo transparente: nada é pintado onde não há arte nem carimbo.
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([
			{ input: master, left: 0, top: 0 },
			{ input: qrPng, left, top },
			// O SVG do texto tem a largura do selo inteiro e já traz o deslocamento
			// interno para depois do QR — por isso os dois entram na MESMA origem.
			{ input: texto, left, top },
		])
		.png()
		.toBuffer();

	return {
		png,
		area: {
			left,
			top,
			width: selo,
			height: qr,
			qr: { left, top, size: qr },
		},
		aviso,
	};
}
