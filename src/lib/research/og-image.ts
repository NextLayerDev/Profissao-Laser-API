import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedIp } from '../../tool-blocks/blocks/util.js';
import { comLimite } from './budget.js';

/**
 * A FOTO REAL do anúncio, buscada na `og:image` da própria página.
 *
 * MEDIDO: pedir `imagem_url` ao especialista no prompt volta 0 de 8. Não é
 * desobediência do modelo — a busca web entrega o TEXTO da página, e a URL da
 * foto simplesmente não está no texto. Nenhum ajuste de prompt conserta a falta
 * de um dado que nunca chegou ao modelo.
 *
 * A `og:image`, sim, está lá: marketplace SERVE essa tag porque precisa dela
 * para o preview do WhatsApp e do Facebook. É literalmente para isso que a tag
 * existe, e é por isso que buscá-la é confiável onde o prompt não é.
 *
 * FOTO É ENFEITE. Este arquivo nunca lança: toda falha (host fora da lista,
 * DNS, timeout, 403, HTML sem a tag) vira `null` em silêncio. Um dossiê pago
 * não pode cair porque uma imagem não abriu.
 */

/** `og:image` vive no `<head>`; 120 KB cobrem o cabeçalho de qualquer loja. */
const MAX_BYTES = 120 * 1_024;
/** Curto de propósito: é enfeite disputando o relógio do dossiê. */
const TIMEOUT_MS = 6_000;

/**
 * Identifica quem está batendo. Marketplace responde 403 a cliente sem
 * `user-agent`, e forjar o do WhatsApp para passar seria mentir sobre quem
 * somos — o token `compatible` com nome e URL é a forma honesta e aceita.
 */
const USER_AGENT =
	'Mozilla/5.0 (compatible; ProfissaoLaserBot/1.0; +https://profissaolaser.com)';

/**
 * ALLOWLIST — vitrine, não internet.
 *
 * Esta função abre uma URL que veio de uma CITAÇÃO de busca, ou seja: de fora.
 * Sem allowlist, um resultado envenenado vira SSRF com a nossa rede de origem.
 *
 * A lista tem duas partes, por um motivo prático: os marketplaces onde os
 * anúncios de fato estão (`tiktok.com` não é `.com.br`, então precisa de linha
 * própria) mais QUALQUER `.com.br` — porque metade dos anúncios que a pesquisa
 * acha está na loja própria do concorrente, e enumerar loja brasileira uma a
 * uma é lista que nasce desatualizada. `.com.br` é registro comercial público:
 * continua sendo alvo externo, nunca `localhost` nem IP de rede interna. O que
 * fecha o buraco de um `.com.br` apontado de propósito para 10.x é a checagem
 * de IP resolvido, logo abaixo — a allowlist é a primeira tranca, não a única.
 */
const MARKETPLACES = [
	'mercadolivre.com.br',
	'mercadolibre.com',
	'shopee.com.br',
	'amazon.com.br',
	'tiktok.com',
	'elo7.com.br',
	'americanas.com.br',
	'magazineluiza.com.br',
	'magalu.com',
	'shein.com.br',
	'etsy.com',
];

/** Sufixo de domínio casa só em fronteira de rótulo (`evilshopee.com.br` não passa). */
function terminaEm(host: string, dominio: string): boolean {
	return host === dominio || host.endsWith(`.${dominio}`);
}

/** A URL aponta para uma vitrine que aceitamos abrir? Pura — exportada p/ teste. */
export function hostPermitido(url: string): boolean {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return false;
	}
	// Só https: `http` em página de anúncio hoje é redirect ou captura.
	if (u.protocol !== 'https:') return false;
	const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (!host || isIP(host) > 0) return false; // IP literal não é loja
	if (MARKETPLACES.some((d) => terminaEm(host, d))) return true;
	// `.com.br` genérico: precisa ter rótulo próprio (`loja.com.br`, não `com.br`).
	return host.endsWith('.com.br') && host.split('.').length >= 3;
}

const ENTIDADES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	'#39': "'",
	'#x27': "'",
	'#x2F': '/',
	'#47': '/',
};

/** `content` de meta vem escapado (`&amp;` no meio de query string é regra, não exceção). */
function decodificar(s: string): string {
	return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, chave: string) => {
		const direto = ENTIDADES[chave] ?? ENTIDADES[chave.toLowerCase()];
		if (direto) return direto;
		const num = /^#x/i.test(chave)
			? Number.parseInt(chave.slice(2), 16)
			: /^#/.test(chave)
				? Number.parseInt(chave.slice(1), 10)
				: Number.NaN;
		return Number.isFinite(num)
			? num > 0 && num <= 0x10ffff
				? String.fromCodePoint(num)
				: ''
			: m;
	});
}

const RE_META = /<meta\b[^>]*>/gi;
const RE_ATTR = /([a-zA-Z0-9:_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * Ordem de preferência. `og:image` é a oficial; `twitter:image` é o plano B de
 * quem só marcou o card do Twitter — e algumas lojas trocam `property` por
 * `name`, então os dois atributos valem para as duas famílias.
 */
const CHAVES = [
	'og:image',
	'og:image:secure_url',
	'og:image:url',
	'twitter:image',
	'twitter:image:src',
];

/**
 * Todos os `<meta>` do `<head>`, `chave → content` já desescapado.
 *
 * Uma passada só porque quem chama precisa de DOIS metadados da mesma página: a
 * `og:image` (a foto) e a `og:type` (o que a página diz ser). Ler o head duas
 * vezes para responder duas perguntas sobre o mesmo HTML seria desperdício sem
 * ganho de clareza.
 */
function lerMetas(html: string): Map<string, string> {
	/**
	 * Comentário HTML sai ANTES da varredura.
	 *
	 * Template de loja com `<!-- <meta property="og:image" content="…placeholder.jpg"> -->`
	 * é padrão comum, e sem isto o dossiê mostrava o placeholder da template
	 * como se fosse a foto do produto — errado de um jeito que parece certo.
	 */
	const limpo = html.replace(/<!--[\s\S]*?-->/g, '');

	// Só o `<head>`: `og:` no corpo da página é conteúdo citado, não metadado.
	const fim = limpo.search(/<\/head\s*>/i);
	const cabeca = fim >= 0 ? limpo.slice(0, fim) : limpo;

	const achados = new Map<string, string>();
	for (const tag of cabeca.matchAll(RE_META)) {
		const attrs = new Map<string, string>();
		for (const a of tag[0].matchAll(RE_ATTR)) {
			const nome = (a[1] as string).toLowerCase();
			attrs.set(nome, a[2] ?? a[3] ?? a[4] ?? '');
		}
		const chave = (attrs.get('property') ?? attrs.get('name') ?? '')
			.trim()
			.toLowerCase();
		const valor = attrs.get('content');
		// Primeira ocorrência vence: gerador que repete a tag repete o mesmo valor,
		// e quem repete com valor diferente costuma pôr o certo primeiro.
		if (!chave || !valor || achados.has(chave)) continue;
		achados.set(chave, decodificar(valor));
	}
	return achados;
}

/** Extrai a URL da foto de um HTML. Pura, sem rede — exportada p/ teste. */
export function extrairOgImage(html: string): string | null {
	const achados = lerMetas(html);
	for (const chave of CHAVES) {
		const bruto = achados.get(chave);
		if (!bruto) continue;
		const url = normalizarFoto(bruto.trim());
		if (url) return url;
	}
	return null;
}

/**
 * Só devolve o que o `<img>` do front consegue exibir sozinho: absoluta e
 * **https**. Caminho relativo e `data:` ficam de fora — o primeiro exige base e
 * o segundo seria despejar bytes de terceiro dentro do nosso JSON.
 *
 * ┌─ `http://` NÃO É "EXIBÍVEL SOZINHO", E A FUNÇÃO PROMETIA QUE ERA ────────┐
 * │ O dossiê é servido por https, e navegador não carrega imagem http dentro │
 * │ de página https: bloqueia como mixed content. Medido na galeria dos runs │
 * │ gravados: 4 fotos BOAS (`amouh.com.br`, dois CDNs `mitiendanube`)        │
 * │ baixavam por curl e apareceriam como ladrilho vazio em produção — 1 de 7 │
 * │ na `produto-profundo-A` e 2 de 13 na `produto-profundo-B`, justamente o  │
 * │ caminho que hoje entrega galeria de verdade.                             │
 * │                                                                          │
 * │ SOBE PARA https EM VEZ DE DESCARTAR: a loja que anuncia a foto em http   │
 * │ quase sempre serve o MESMO arquivo em https (é o mesmo CDN; o que está   │
 * │ velho é a tag, não o host). Conferido nas 4: `https://` no mesmo host e  │
 * │ caminho devolve 200 com `image/*` nas 4 de 4. Descartar custaria as       │
 * │ quatro; subir o esquema recupera as quatro. Se alguma não existir em     │
 * │ https, o `onError` do front tira o ladrilho — o mesmo que aconteceria    │
 * │ com o link morto de qualquer outra, e melhor que o buraco garantido.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `//cdn/x.jpg` (protocolo relativo) vira https pela mesma regra.
 */
function normalizarFoto(valor: string): string | null {
	const v = valor.startsWith('//') ? `https:${valor}` : valor;
	if (!/^https?:\/\/\S+$/i.test(v)) return null;
	if (v.length > 2_000) return null;
	return v.replace(/^http:\/\//i, 'https://');
}

/* ══════════ É FOTO DE PRODUTO, OU É A ARTE DA PÁGINA? ══════════ */

/**
 * ┌─ O QUE A LISTA DE CAMINHOS NUNCA IA PEGAR ───────────────────────────────┐
 * │ `RE_LISTAGEM` e `RE_EDITORIAL` (lá embaixo) leem só a URL, e URL de       │
 * │ artigo não tem forma. MEDIDO nos 6 runs frios profundos gravados:         │
 * │                                                                           │
 * │   yav.com.br/comissoes-marketplace/          → og/comissoes.png (6 de 6)  │
 * │   promoview.com.br/pesquisa-revela-…-news/   → banner da matéria (2 de 6) │
 * │   redoma.com.br/brindes-…-guia-empresas/     → …/Blogpost-1.jpg           │
 * │   rvb.com.br/marketing-sazonal-para-varejo/  → capa do guia               │
 * │   leadjet.com.br/mercado-b2b/                → print de um painel SaaS    │
 * │                                                                           │
 * │ NENHUMA tem `/blog/`, `/artigos/` ou data no caminho. Escrever mais uma   │
 * │ linha de regex sobre o slug seria adivinhar o assunto pelo endereço, e a  │
 * │ lista nasceria incompleta de novo — foi assim que a rodada passada        │
 * │ declarou fechado um buraco que continuava aberto.                         │
 * │                                                                           │
 * │ O MECANISMO É OUTRO: a própria página DECLARA o que ela é, no mesmo       │
 * │ `<head>` que já baixamos, e pelo mesmo motivo que a `og:image` é          │
 * │ confiável — WordPress, Shopify e afins servem `og:type: article` para o   │
 * │ preview do WhatsApp e do Facebook sair com cara de matéria. Não é palpite │
 * │ nosso sobre a página: é o que o dono dela publicou sobre ela.             │
 * │                                                                           │
 * │ As 5 acima declaram `article`; das 27 páginas de produto dos mesmos runs, │
 * │ 26 declaram `website`/`product`/`nuvemshop:product`/nada.                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * `article` cobre matéria, post e guia; `video`, `music`, `book` e `profile`
 * entram na mesma porta porque nenhum deles é um anúncio (a página de vídeo do
 * YouTube devolve a thumbnail do vídeo, que também não é a foto do produto).
 */
const RE_TIPO_EDITORIAL = /^(article|news|blog|video|music|book|profile)/;

/**
 * O `og:type` sem o prefixo de plataforma: `og:product` e `nuvemshop:product`
 * são as duas grafias que as lojas brasileiras dos runs de fato emitem.
 */
function tipoDeclarado(metas: Map<string, string>): string {
	const t = (metas.get('og:type') ?? '').trim().toLowerCase();
	return t.includes(':') ? t.slice(t.lastIndexOf(':') + 1) : t;
}

/** Segmento de caminho que só existe em página de item. */
const RE_CAMINHO_DE_PRODUTO = /\/(produtos?|products?|item|prod)\//i;

/**
 * A PÁGINA SE DESMENTE? — o resgate da loja com plugin de SEO mal configurado.
 *
 * `dinka.com.br/produto/20-chaveiro-personalizado-em-acrilico-gravacao-laser/`
 * é uma página de produto de verdade (a foto dela entrou na galeria do run mp3)
 * e ainda assim declara `og:type: article` — o tema WooCommerce marca tudo como
 * artigo. Sem este resgate ela morreria junto com os banners.
 *
 * Só conta o que a própria página assina como comércio: preço, disponibilidade,
 * card de produto do Twitter, ou o `/produto/` no caminho. Conferido: nenhuma
 * das 5 páginas editoriais dos runs tem qualquer um desses.
 */
function declaraProduto(metas: Map<string, string>, caminho: string): boolean {
	if (tipoDeclarado(metas).includes('product')) return true;
	for (const k of [
		'product:price:amount',
		'og:price:amount',
		'product:availability',
		'og:availability',
	]) {
		if (metas.get(k)) return true;
	}
	if ((metas.get('twitter:card') ?? '').trim().toLowerCase() === 'product') {
		return true;
	}
	return RE_CAMINHO_DE_PRODUTO.test(caminho);
}

/**
 * A IMAGEM É A IDENTIDADE DO SITE, e não um produto.
 *
 * A armadilha original — og:image de página de LISTAGEM é o LOGOTIPO — não
 * morre no filtro de URL: `imperiodasublimacao.com.br/canecas-brancas` e
 * `baratomaquinas.com.br/canecas-de-porcelana-sublimacao` são categorias sem
 * `/busca/`, `/c/` nem `?q=` no endereço, e as duas devolveram
 * `cdn.awsli.com.br/…/logo/…png` nos runs de produto. `mdcriative.com.br/
 * pecas-em-acrilico/chaveiros-em-acrilico/` devolveu `…/themes/common/logo-…`.
 *
 * Aqui quem denuncia é o ARQUIVO: `logo` como pasta ou começo do nome, e pasta
 * de tema — o que uma loja guarda em `/logo/` e em `/themes/` é a marca dela,
 * nunca o produto. Casa por SEGMENTO, e não por substring, porque
 * `…/MLB-…-com-sua-logo-50-unidades…` é título de anúncio legítimo.
 *
 * Conferido contra as 27 fotos de produto capturadas nos 8 runs: zero falsos
 * positivos (elas vivem em `/produto/`, `/products/`, `/img_prod/`, `/file/`).
 */
const RE_ARTE_DO_SITE =
	/\/(logos?|logotipos?|marcas?|banners?|temas?|themes?)\/|\/(logo|logotipo|banner|marca)[-_.]/i;

/** A foto é a arte do site (logo, banner, tema)? Pura — exportada p/ teste. */
export function ehArteDoSite(foto: string): boolean {
	try {
		return RE_ARTE_DO_SITE.test(new URL(foto).pathname);
	} catch {
		return false;
	}
}

/* ══════════ E O ARQUIVO? — A FOTO CONFERIDA POR BYTES ══════════ */

/**
 * ┌─ HTTP 200 NÃO PROVA IMAGEM. ESTE É O NÚMERO QUE PROVA ───────────────────┐
 * │ O CDN do Mercado Livre responde **200 OK** com `content-type: image/gif` │
 * │ para QUALQUER endereço de foto que não exista — ele redireciona para o    │
 * │ arquivo "imagem indisponível" e entrega o GIF cinza. Medido, baixando:    │
 * │                                                                          │
 * │   .../img-not-available/1.1.0/O.gif      8.456 B  500×500                 │
 * │       md5 fe20176f493696da21e6da31cf78213f                                │
 * │   .../img-not-available/1.1.0/F@2x.gif  52.473 B  1200×1200               │
 * │       md5 5674b1b0587d754e66bf7ce6c0644264                                │
 * │                                                                          │
 * │ Nos 9 runs gravados, QUATRO ladrilhos da galeria eram o primeiro arquivo, │
 * │ o mesmo md5 nos quatro, e todos com status 200 — quem conferisse por      │
 * │ status diria "as quatro fotos estão de pé". Por isso a conferência é de   │
 * │ BYTES: baixa o começo do arquivo, calcula o md5, lê a dimensão do         │
 * │ cabeçalho e recusa o que não é foto de produto.                          │
 * │                                                                          │
 * │ O TAMANHO SOZINHO NÃO SEPARA, e é por isso que existe a lista de md5: a   │
 * │ menor foto BOA dos runs tem 7.816 B e o placeholder tem 8.456 B. Cortar   │
 * │ por tamanho onde eles se cruzam derrubaria foto de verdade.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const MD5_PLACEHOLDER = new Set([
	'fe20176f493696da21e6da31cf78213f',
	'5674b1b0587d754e66bf7ce6c0644264',
]);

/**
 * O CAMINHO que denuncia o "sem imagem" de qualquer CDN, não só o do ML.
 *
 * A lista de md5 pina os dois arquivos MEDIDOS; esta regex pega a família
 * inteira (o ML versiona o arquivo — `1.1.0` vira `1.2.0` e o md5 muda, o
 * caminho não). Casa por SEGMENTO ou por nome de arquivo, nunca por substring:
 * `.../produto/placeholder-de-mesa-em-acrilico.jpg` é nome de produto legítimo.
 */
const RE_SEM_IMAGEM =
	/\/(img-not-available|no[-_]image|image[-_]not[-_]available|sem[-_]imagem|placeholders?)\/|\/(no[-_]image|sem[-_]imagem|placeholder|default[-_]product)[-_.@]/i;

/**
 * Menor arquivo que ainda pode ser foto de produto.
 *
 * 2 KB, e o número é FROUXO de propósito: quem separa placeholder de foto é o
 * md5 e o caminho, não o tamanho (ver o bloco acima — os dois se cruzam em
 * ~8 KB). Este piso existe para o outro caso, o barato: pixel de rastreio e
 * ícone de 16×16 servidos como `og:image`.
 */
const MIN_BYTES_FOTO = 2_048;
/**
 * Menor lado que ainda pode ser foto de produto.
 *
 * 200 px. Das 31 fotos de produto capturadas nos runs gravados, a menor tem
 * 315 px de altura (`iniciativabrindes`, 600×315) — ou seja, o piso não encosta
 * em nenhuma. O que ele derruba é favicon, selo de bandeira de cartão e o
 * spinner de 1×1 que loja com lazy-load às vezes publica na tag.
 */
const MIN_LADO_FOTO = 200;

/**
 * Largura e altura lidas do CABEÇALHO do arquivo — sem decodificar a imagem.
 *
 * Quatro formatos porque são os quatro que os runs devolveram (`jpeg`, `png`,
 * `webp`, `gif`). Devolve `null` para o que não reconhece, e `null` aqui é
 * "não sei", nunca "reprovado": recusar formato desconhecido apagaria AVIF e
 * qualquer coisa que uma loja publique amanhã.
 *
 * Pura e exportada: é regra de bytes, e teste de regra de bytes não precisa de
 * rede.
 */
export function dimensoesDeImagem(
	b: Uint8Array,
): { w: number; h: number; fmt: string } | null {
	const u16 = (i: number) => ((b[i] as number) << 8) | (b[i + 1] as number);
	const u32 = (i: number) =>
		((b[i] as number) << 24) |
		((b[i + 1] as number) << 16) |
		((b[i + 2] as number) << 8) |
		(b[i + 3] as number);
	const texto = (i: number, n: number) =>
		String.fromCharCode(...b.subarray(i, i + n));

	if (b.length >= 24 && texto(1, 3) === 'PNG') {
		return { w: u32(16) >>> 0, h: u32(20) >>> 0, fmt: 'png' };
	}
	if (b.length >= 10 && texto(0, 3) === 'GIF') {
		return {
			w: (b[6] as number) | ((b[7] as number) << 8),
			h: (b[8] as number) | ((b[9] as number) << 8),
			fmt: 'gif',
		};
	}
	if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
		// Anda de marcador em marcador até o SOF, que é quem carrega a dimensão.
		let i = 2;
		while (i < b.length - 9) {
			if (b[i] !== 0xff) {
				i++;
				continue;
			}
			const m = b[i + 1] as number;
			if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) {
				i += 2;
				continue;
			}
			// SOF0..SOF15, menos os quatro que não são start-of-frame.
			if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
				return { w: u16(i + 7), h: u16(i + 5), fmt: 'jpeg' };
			}
			const len = u16(i + 2);
			if (len < 2) break;
			i += 2 + len;
		}
		return { w: 0, h: 0, fmt: 'jpeg' };
	}
	if (b.length >= 30 && texto(0, 4) === 'RIFF' && texto(8, 4) === 'WEBP') {
		const tipo = texto(12, 4);
		if (tipo === 'VP8X') {
			const le24 = (i: number) =>
				(b[i] as number) |
				((b[i + 1] as number) << 8) |
				((b[i + 2] as number) << 16);
			return { w: le24(24) + 1, h: le24(27) + 1, fmt: 'webp' };
		}
		if (tipo === 'VP8L') {
			const x =
				((b[21] as number) |
					((b[22] as number) << 8) |
					((b[23] as number) << 16) |
					((b[24] as number) << 24)) >>>
				0;
			return { w: (x & 0x3fff) + 1, h: ((x >> 14) & 0x3fff) + 1, fmt: 'webp' };
		}
		if (tipo === 'VP8 ') {
			return {
				w: ((b[26] as number) | ((b[27] as number) << 8)) & 0x3fff,
				h: ((b[28] as number) | ((b[29] as number) << 8)) & 0x3fff,
				fmt: 'webp',
			};
		}
		return { w: 0, h: 0, fmt: 'webp' };
	}
	return null;
}

/**
 * O veredito sobre um arquivo JÁ BAIXADO. Puro — é aqui que o teste bate.
 *
 * `null` de dimensão é aceito de propósito (ver `dimensoesDeImagem`): formato
 * que não sabemos ler ainda pode ser foto, e o `content-type` do servidor já
 * disse que é imagem.
 */
export function fotoAprovada(
	url: string,
	tipo: string,
	bytes: Uint8Array,
): boolean {
	if (!/^image\//i.test(tipo.trim())) return false;
	if (bytes.length < MIN_BYTES_FOTO) return false;
	if (MD5_PLACEHOLDER.has(createHash('md5').update(bytes).digest('hex'))) {
		return false;
	}
	try {
		if (RE_SEM_IMAGEM.test(new URL(url).pathname)) return false;
	} catch {
		return false;
	}
	const d = dimensoesDeImagem(bytes);
	if (d && (d.w > 0 || d.h > 0)) {
		if (Math.max(d.w, d.h) < MIN_LADO_FOTO) return false;
	}
	return true;
}

/**
 * O QUE UMA PÁGINA ABERTA RESPONDE — as DUAS perguntas, de uma leitura só.
 *
 * `anuncio` é a pergunta cara: a página é mesmo um ANÚNCIO, ou é um artigo que
 * por acaso tem um `R$` no meio? Ver o bloco "A PÁGINA ASSINA QUE VENDE?".
 * `foto` é a de sempre. As duas saem do mesmo `<head>` porque abrir a página
 * duas vezes para responder duas perguntas sobre o mesmo HTML seria pagar dois
 * segundos de relógio pelo mesmo download.
 */
export interface InspecaoPagina {
	/** A própria página assina que está VENDENDO isto. */
	anuncio: boolean;
	/** A foto de produto, ou `null` se o que ela oferece não é uma. */
	foto: string | null;
}

/**
 * ┌─ A PÁGINA ASSINA QUE VENDE? — o portão do PREÇO, não o da foto ──────────┐
 * │ MEDIDO, reabrindo uma a uma as páginas de onde saiu cada preço dos 9      │
 * │ runs gravados: no escopo `mercado`, ZERO das 12+11+12+2+3 "observações   │
 * │ de preço" vinha de um anúncio. Vinham de tabela de comissão              │
 * │ (`yav.com.br/comissoes-marketplace/`, R$ 79 é o DEGRAU da comissão da    │
 * │ Shopee), de exemplo hipotético de artigo fiscal ("quando você vende por  │
 * │ R$ 100 e a plataforma retém R$ 16"), de transcrição de vídeo no YouTube  │
 * │ ("Centro-Oeste R$ 20" é FRETE) e de página de categoria. A tela imprimia │
 * │ "12 anúncios com preço e link" e cravava mediana R$ 36,50 com selo de    │
 * │ confiável — e o aluno fecha trabalho em cima disso.                      │
 * │                                                                          │
 * │ Não adianta olhar só o endereço: `ehPaginaDeAnuncio` (lá embaixo) deixa  │
 * │ passar as cinco, porque nenhuma tem `/blog/` nem data no caminho. E não  │
 * │ adianta pedir no prompt: quem conta os preços é o TypeScript justamente  │
 * │ para não depender de pedido.                                             │
 * │                                                                          │
 * │ Quem responde é a PRÓPRIA PÁGINA, com a mesma classe de evidência que    │
 * │ torna a `og:image` confiável — o metadado que a loja publica para o       │
 * │ preview do WhatsApp e para o Google Shopping. Reaberto nas 111           │
 * │ observações dos 9 runs: mercado 0/40, produto 7/25, 12/27, 5/10 e 5/9.   │
 * │ Ou seja: some a faixa que era mentira e fica de pé a que era verdade.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * É `declaraProduto`, e não "não é editorial", de propósito: a página de
 * categoria e a calculadora de marketplace declaram `website` como qualquer
 * loja, e o que as separa de um anúncio é exatamente não ter preço, nem
 * disponibilidade, nem `/produto/` no caminho.
 *
 * Puro (recebe o HTML já baixado), para que o teste use o `<head>` REAL das
 * páginas dos runs gravados em vez de um HTML inventado.
 */
/**
 * As CDNs de loja brasileira de onde vieram TODAS as fotos boas medidas.
 *
 * A lista não é preferência de fornecedor: é o retrato de onde a foto de
 * produto de fato mora no Brasil (Loja Integrada, Tray, Nuvemshop, Irroba,
 * VTEX, Shopify, Wix). Um `<img>` do corpo só é aceito se vier de uma delas ou
 * de um caminho que a própria loja marca como mídia de produto — sem isso,
 * varrer o corpo pegaria ícone de bandeira, selo de segurança e banner de
 * promoção, que é exatamente o lixo que a galeria não pode ter.
 */
const RE_CDN_DE_LOJA =
	/(awsli\.com\.br|tcdn\.com\.br|mitiendanube\.com|nuvemshop|irroba\.com\.br|vteximg|vtexassets|cdn\.shopify|wixstatic|dooca\.store|fbitsstatic|lojaintegrada)/i;

/** Caminho que a plataforma usa para mídia de PRODUTO, não para arte do site. */
const RE_CAMINHO_DE_MIDIA =
	/\/(produtos?|products?|uploads?|media|imagens?|images?)\//i;

/** Nome de arquivo que denuncia arte do site, não foto de peça. */
const RE_ARQUIVO_DE_SITE =
	/(logo|icone|icon|sprite|banner|selo|bandeira|whatsapp|facebook|instagram|placeholder|loading|spinner|avatar|favicon)/i;

/**
 * A FOTO DE PRODUTO dentro do CORPO da página.
 *
 * Existe porque loja pequena em plataforma brasileira muitas vezes não emite
 * `og:image` — medido num run real: 3 páginas de loja abertas, 0 com a tag, e
 * a foto do produto visível no HTML. Sem isto, aquelas páginas eram abertas,
 * lidas e descartadas.
 *
 * Aceita o PRIMEIRO candidato, porque em página de produto a imagem principal
 * vem antes das miniaturas e dos "quem viu também levou". Tudo passa depois
 * pela conferência de bytes (`conferirFotos`), então um falso positivo aqui
 * ainda morre lá se não for imagem de verdade.
 */
export function fotoNoCorpo(html: string, url = ''): string | null {
	let base: URL | null = null;
	try {
		base = new URL(url);
	} catch {
		base = null;
	}
	/**
	 * Percorre a TAG inteira e testa os atributos em ordem de confiança.
	 *
	 * Não dá para casar um atributo só: a foto principal costuma ser lazy-loaded,
	 * e nessas tags o `src` é um GIF transparente de 1px enquanto a foto de
	 * verdade está no `data-src`. Uma regex por atributo pegaria o `src` (que vem
	 * antes no HTML), descartaria por ser `data:` e pularia a tag inteira — foi
	 * o que o teste do lazy-load pegou.
	 */
	const candidatos: string[] = [];
	for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
		for (const attr of ['data-src', 'data-lazy-src', 'data-lazy', 'src']) {
			const m = tag[0].match(
				new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'),
			);
			if (m?.[1]) candidatos.push(m[1]);
		}
	}
	for (const cand of candidatos) {
		const bruto = cand.trim();
		if (!bruto || bruto.startsWith('data:')) continue;
		let abs = bruto;
		if (abs.startsWith('//')) abs = `https:${abs}`;
		else if (abs.startsWith('/') && base) abs = new URL(abs, base).href;
		if (!/^https?:\/\//i.test(abs)) continue;
		if (RE_ARQUIVO_DE_SITE.test(abs) || ehArteDoSite(abs)) continue;
		if (!RE_CDN_DE_LOJA.test(abs) && !RE_CAMINHO_DE_MIDIA.test(abs)) continue;
		const foto = normalizarFoto(abs);
		if (foto) return foto;
	}
	return null;
}

export function analisarCabeca(html: string, url = ''): InspecaoPagina {
	const metas = lerMetas(html);
	let caminho = '';
	try {
		const u = new URL(url);
		caminho = u.pathname + u.search;
	} catch {
		// URL ausente ou inválida: sem o resgate pelo caminho, sobra o do `<head>`.
	}
	const comercio = declaraProduto(metas, caminho);
	const foto = (() => {
		if (RE_TIPO_EDITORIAL.test(tipoDeclarado(metas)) && !comercio) return null;
		for (const chave of CHAVES) {
			const bruto = metas.get(chave);
			if (!bruto) continue;
			const f = normalizarFoto(bruto.trim());
			if (f) return ehArteDoSite(f) ? null : f;
		}
		// A tag não existir não quer dizer que a página não tenha a foto.
		return fotoNoCorpo(html, url);
	})();
	return { anuncio: comercio, foto };
}

/**
 * A FOTO DE PRODUTO desta página, ou `null` se o que ela oferece não é uma.
 *
 * É o portão único da foto: `inspecionarPagina` não devolve nada que não passe
 * por aqui.
 */
export function fotoDeProduto(html: string, url = ''): string | null {
	return analisarCabeca(html, url).foto;
}

/**
 * Anti-SSRF, mesmo rigor de `util.http_request`: https, allowlist, e TODOS os
 * IPs do host resolvidos — se QUALQUER um for privado/reservado, cai fora.
 *
 * Resíduo conhecido, idêntico ao do bloco: o `fetch` resolve o DNS de novo
 * (TOCTOU/rebinding). Mitigado por allowlist + `redirect:'manual'`; fechar
 * 100% exige pinar o IP no dispatcher do undici.
 */
async function urlSegura(bruta: string): Promise<URL | null> {
	if (!hostPermitido(bruta)) return null;
	let url: URL;
	try {
		url = new URL(bruta);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	try {
		const addrs = await lookup(host, { all: true });
		if (addrs.length === 0) return null;
		for (const a of addrs) if (isBlockedIp(a.address)) return null;
	} catch {
		return null;
	}
	return url;
}

/** Corta o download no `</head>` ou no teto de bytes, o que vier primeiro. */
async function lerCabeca(res: Response): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder('utf-8');
	let html = '';
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			html += decoder.decode(value, { stream: true });
			/**
			 * Entra um pouco no CORPO, e não para no `</head>`.
			 *
			 * Loja pequena montada em plataforma brasileira muitas vezes não emite
			 * `og:image` nenhuma — medido: 3 páginas de loja abertas, 0 com a tag —,
			 * e a foto do produto está ali, no primeiro `<img>` do corpo. Desistir
			 * no `</head>` era jogar fora a única imagem real que aquela página
			 * tinha para oferecer.
			 *
			 * O teto de bytes continua sendo o freio (catálogo tem megabytes de
			 * HTML); o que mudou é que ele passou a valer sozinho, em vez de
			 * empatar com um marcador que chega nos primeiros 5 KB.
			 */
			if (total >= MAX_BYTES) break;
		}
	} finally {
		// A página inteira pode ter megabytes de HTML de catálogo: soltar a
		// conexão aqui é o que impede pagar banda por bytes que não vamos ler.
		await reader.cancel().catch(() => {});
	}
	return html;
}

/**
 * O que UMA página responde. Nunca lança: devolve `null` em qualquer tropeço.
 *
 * `null` (não abriu) é diferente de `{anuncio:false}` (abriu e não é anúncio)
 * só para quem lê o log — para o preço os dois valem o mesmo: **não provado,
 * não conta**. Uma página que não abre não pode sustentar um número na tela.
 */
export async function inspecionarPagina(
	url: string,
	signal?: AbortSignal,
): Promise<InspecaoPagina | null> {
	const alvo = await urlSegura(url);
	if (!alvo) return null;

	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const sinal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	try {
		const res = await fetch(alvo, {
			method: 'GET',
			// Não seguir redirect: seguir é o bypass clássico da checagem de IP.
			redirect: 'manual',
			signal: sinal,
			headers: {
				accept: 'text/html,application/xhtml+xml',
				'accept-language': 'pt-BR,pt;q=0.9',
				'user-agent': USER_AGENT,
			},
		});
		if (!res.ok) return null;
		const tipo = res.headers.get('content-type') ?? '';
		if (tipo && !/text\/html|application\/xhtml/i.test(tipo)) return null;
		// `analisarCabeca`, e não `extrairOgImage`: a tag existir não faz dela a
		// foto de um produto (ver o bloco "É FOTO DE PRODUTO, OU É A ARTE DA
		// PÁGINA?"). Quem decide é o `<head>` que acabou de chegar.
		return analisarCabeca(await lerCabeca(res), alvo.href);
	} catch {
		return null;
	}
}

/**
 * Várias páginas, com limite de concorrência.
 *
 * Devolve `url → inspeção` só do que ABRIU — quem não abriu some do mapa em vez
 * de virar entrada vazia, e some justamente porque "não abriu" não sustenta nem
 * foto nem preço. Concorrência 6 por padrão: são hosts diferentes, o gargalo é
 * a latência, e mais que isso só aumenta a chance de 429.
 */
export async function inspecionarPaginas(
	urls: string[],
	signal?: AbortSignal,
	limite = 6,
): Promise<Map<string, InspecaoPagina>> {
	const unicas = [...new Set(urls.filter((u) => typeof u === 'string' && u))];
	const out = new Map<string, InspecaoPagina>();
	if (unicas.length === 0) return out;

	const rs = await comLimite(
		unicas.map((u) => () => inspecionarPagina(u, signal)),
		limite,
	);
	rs.forEach((r, i) => {
		const url = unicas[i];
		if (url && r.status === 'fulfilled' && r.value) out.set(url, r.value);
	});
	return out;
}

/* ══════════ BAIXAR O COMEÇO DA FOTO PARA CONFERIR ══════════ */

/** Cabeçalho de PNG/JPEG/GIF/WebP cabe MUITO abaixo disto; 64 KB é folga. */
const MAX_BYTES_FOTO = 64 * 1_024;
/** Mais curto que o da página: é conferência de enfeite, não de conteúdo. */
const TIMEOUT_FOTO_MS = 4_000;

/**
 * A MESMA TRANCA DA PÁGINA, MENOS A ALLOWLIST — e a diferença é obrigatória.
 *
 * A `og:image` de uma loja quase nunca mora no domínio dela: as fotos medidas
 * saíram de `cdn.awsli.com.br`, `images.tcdn.com.br`, `cdn.shopify.com` e
 * `http2.mlstatic.com`. Exigir `MARKETPLACES`/`.com.br` do ARQUIVO reprovaria a
 * maioria das fotos boas — a allowlist é sobre em que VITRINE a gente entra, e
 * a vitrine já foi conferida quando a página foi aberta.
 *
 * O que continua de pé é o que protege a nossa rede, e é o que importa aqui:
 * https, sem IP literal, e TODOS os endereços resolvidos precisam ser públicos.
 * Some o `redirect: 'manual'` logo abaixo, que fecha o desvio clássico.
 */
async function urlDeFotoSegura(bruta: string): Promise<URL | null> {
	let url: URL;
	try {
		url = new URL(bruta);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (!host || isIP(host) > 0) return null;
	try {
		const addrs = await lookup(host, { all: true });
		if (addrs.length === 0) return null;
		for (const a of addrs) if (isBlockedIp(a.address)) return null;
	} catch {
		return null;
	}
	return url;
}

/**
 * Baixa o COMEÇO de uma foto e responde se ela pode entrar no dossiê.
 *
 * REDIRECT REPROVA, e é decisão medida: das 31 fotos de produto capturadas nos
 * runs gravados, ZERO redirecionam (a URL final é igual à da tag em 31 de 31).
 * Já o caminho que o placeholder do Mercado Livre percorre é EXATAMENTE um
 * redirect — `D_NQ_NP_…-F.webp` que não existe responde 302 para
 * `img-not-available/1.1.0/F@2x.gif` e entrega o GIF cinza com 200. Recusar o
 * desvio custa zero foto de verdade e fecha a porta pela qual o cinza entrava;
 * de quebra, é o mesmo motivo pelo qual a página usa `redirect: 'manual'`.
 *
 * Nunca lança: foto é enfeite (ver o cabeçalho do arquivo).
 */
async function conferirFoto(
	url: string,
	signal?: AbortSignal,
): Promise<boolean> {
	const alvo = await urlDeFotoSegura(url);
	if (!alvo) return false;
	const timeout = AbortSignal.timeout(TIMEOUT_FOTO_MS);
	const sinal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	try {
		const res = await fetch(alvo, {
			method: 'GET',
			redirect: 'manual',
			signal: sinal,
			headers: {
				accept: 'image/*',
				// `Range` é PEDIDO, não garantia: CDN que ignora manda o arquivo
				// inteiro, e por isso o corte real é o do leitor, logo abaixo.
				range: `bytes=0-${MAX_BYTES_FOTO - 1}`,
				'user-agent': USER_AGENT,
			},
		});
		// `res.ok` já cobre o 206 do `Range` atendido e o 200 de quem ignora o
		// pedido e manda o arquivo inteiro (o corte, nesse caso, é o do leitor).
		if (!res.ok) return false;
		const tipo = res.headers.get('content-type') ?? '';
		const reader = res.body?.getReader();
		if (!reader) return false;
		const partes: Uint8Array[] = [];
		let total = 0;
		try {
			while (total < MAX_BYTES_FOTO) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				partes.push(value);
				total += value.byteLength;
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		const bytes = new Uint8Array(total);
		let i = 0;
		for (const p of partes) {
			bytes.set(p, i);
			i += p.byteLength;
		}
		return fotoAprovada(alvo.href, tipo, bytes);
	} catch {
		return false;
	}
}

/**
 * Quais destas fotos passam na conferência de bytes. Uma leva só, no fim.
 *
 * SEPARADA de `inspecionarPagina` de propósito: assim o custo de relógio é UM
 * lote no fim (concorrência 12, ~1 s medido) em vez de somar 4 s de timeout
 * dentro de cada leva de páginas — que é o número que `tetoDeFotos` usa para
 * decidir quantas páginas cabem, e dobrá-lo cortaria o teto pela metade no
 * Rápido para conferir fotos que o Rápido quase não tem.
 */
export async function conferirFotos(
	urls: string[],
	signal?: AbortSignal,
	limite = 12,
): Promise<Set<string>> {
	const unicas = [...new Set(urls.filter((u) => typeof u === 'string' && u))];
	const ok = new Set<string>();
	if (unicas.length === 0) return ok;
	const rs = await comLimite(
		unicas.map((u) => () => conferirFoto(u, signal)),
		limite,
	);
	rs.forEach((r, i) => {
		const u = unicas[i];
		if (u && r.status === 'fulfilled' && r.value) ok.add(u);
	});
	return ok;
}

/**
 * A URL é de um ANÚNCIO ou de uma página de BUSCA?
 *
 * Descoberto testando: o especialista devolvia `lista.mercadolivre.com.br/
 * lembrancinhas-de-casamento` como se fosse um anúncio. É uma página de
 * resultados — e a `og:image` dela é o LOGOTIPO do Mercado Livre. O card
 * mostraria a marca do marketplace no lugar da foto do produto, que é errado
 * de um jeito que parece certo.
 *
 * Pedir "traga o link do anúncio" no prompt ajuda, mas prompt é pedido, não
 * mecanismo: quem decide é este filtro.
 */
const RE_LISTAGEM =
	/(^|\.)lista\.|\/lista\/|\/search\b|\/busca\b|\/s\?|[?&](q|query|search|keyword)=|\/c\/|\/categoria\//i;

/**
 * ARTIGO NÃO É ANÚNCIO — a segunda porta, mas só a metade barata dela.
 *
 * ┌─ O QUE ESTA LISTA PEGA, E O QUE ELA NÃO PEGA ───────────────────────────┐
 * │ PEGA o endereço que se entrega: `/blog/`, `/blogs/` (a loja Shopify de   │
 * │ `bhband.com.br/blogs/novidades-e-tendencias/…` escapava pelo plural),    │
 * │ `/ajuda/`, data no caminho. Serve para não GASTAR uma vaga de foto —     │
 * │ o teto de páginas abertas é de relógio, e cada blog na fila é um anúncio │
 * │ a menos aberto.                                                          │
 * │                                                                          │
 * │ NÃO PEGA o artigo cujo slug parece um produto, e a lista nunca vai       │
 * │ pegar: `yav.com.br/comissoes-marketplace/` e `promoview.com.br/          │
 * │ pesquisa-revela-os-brindes-favoritos-das-empresas-no-brasil-…/` não têm  │
 * │ marca nenhuma no caminho. Quem barra esses é `fotoDeProduto`, lendo o    │
 * │ `og:type` que a própria página publica — este filtro é a economia, e     │
 * │ aquele é o mecanismo.                                                    │
 * │                                                                          │
 * │ ERRAR PARA MENOS É DE PROPÓSITO: uma foto boa descartada custa um        │
 * │ ladrilho; um banner de post aceito custa a credibilidade da seção        │
 * │ inteira, que existe porque o dono do produto pediu "mais imagens" — e    │
 * │ imagem errada é pior que imagem nenhuma.                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
const RE_EDITORIAL =
	/(^|\.)blog\.|\/blogs?\b|\/noticias?\b|\/artigos?\b|\/posts?\b|\/guias?\b|\/tutoriais?\b|\/dicas\b|\/ajuda\b|\/help\b|\/faq\b|\/suporte\b|\/central-de-ajuda\b|\/institucional\b|\/sobre-?nos\b|\/\d{4}\/\d{2}\//i;

export function ehPaginaDeAnuncio(url: string): boolean {
	try {
		const u = new URL(url);
		const caminho = u.pathname + u.search;
		if (RE_LISTAGEM.test(u.hostname) || RE_LISTAGEM.test(caminho)) {
			return false;
		}
		if (RE_EDITORIAL.test(u.hostname) || RE_EDITORIAL.test(caminho)) {
			return false;
		}
		// Raiz do domínio também não é anúncio ("shopee.com.br/" é a home).
		return u.pathname.replace(/\/+$/, '').length > 1;
	} catch {
		return false;
	}
}
