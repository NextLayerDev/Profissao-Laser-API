import { describe, expect, it } from 'vitest';
import {
	analisarCabeca,
	dimensoesDeImagem,
	ehArteDoSite,
	ehPaginaDeAnuncio,
	extrairOgImage,
	fotoAprovada,
	fotoDeProduto,
	fotoNoCorpo,
	hostPermitido,
	inspecionarPagina,
	inspecionarPaginas,
	MD5_PLACEHOLDER,
} from '@/lib/research/og-image.js';

/**
 * Só a parte PURA: extração da tag e allowlist. Nada aqui toca a rede — os
 * casos de `buscarOgImagem` testados abaixo param na allowlist, ANTES do DNS,
 * que é exatamente a garantia que interessa.
 */

/* ═════════════════════ extração da og:image ═════════════════════ */

const cabeca = (metas: string) =>
	`<!doctype html><html><head><title>x</title>${metas}</head><body><p>oi</p></body></html>`;

describe('extrairOgImage', () => {
	it('lê a og:image padrão', () => {
		expect(
			extrairOgImage(
				cabeca('<meta property="og:image" content="https://cdn.x/1.jpg">'),
			),
		).toBe('https://cdn.x/1.jpg');
	});

	it('aceita `name` no lugar de `property` e atributo fora de ordem', () => {
		// Loja que só marcou o card do Twitter, e gerador de HTML que emite
		// `content` antes de `name` — os dois aparecem no mundo real.
		expect(
			extrairOgImage(
				cabeca(`<meta content='https://cdn.x/2.jpg' name='og:image'/>`),
			),
		).toBe('https://cdn.x/2.jpg');
	});

	it('cai para twitter:image quando não há og:image', () => {
		expect(
			extrairOgImage(
				cabeca('<meta name="twitter:image" content="https://cdn.x/3.jpg">'),
			),
		).toBe('https://cdn.x/3.jpg');
	});

	it('prefere og:image mesmo quando a twitter:image vem antes', () => {
		expect(
			extrairOgImage(
				cabeca(
					'<meta name="twitter:image" content="https://cdn.x/tw.jpg">' +
						'<meta property="og:image" content="https://cdn.x/og.jpg">',
				),
			),
		).toBe('https://cdn.x/og.jpg');
	});

	it('desescapa entidades — `&amp;` no meio da query string é a regra', () => {
		expect(
			extrairOgImage(
				cabeca(
					'<meta property="og:image" content="https://cdn.x/4.jpg?w=800&amp;q=70">',
				),
			),
		).toBe('https://cdn.x/4.jpg?w=800&q=70');
	});

	it('normaliza URL de protocolo relativo para https', () => {
		expect(
			extrairOgImage(
				cabeca('<meta property="og:image" content="//cdn.x/5.jpg">'),
			),
		).toBe('https://cdn.x/5.jpg');
	});

	it('IGNORA og:image fora do <head> — no corpo é conteúdo citado, não metadado', () => {
		const html =
			'<html><head><title>x</title></head><body>' +
			'<meta property="og:image" content="https://cdn.x/corpo.jpg">' +
			'</body></html>';
		expect(extrairOgImage(html)).toBeNull();
	});

	it('descarta o que o front não conseguiria exibir sozinho', () => {
		// Caminho relativo exige base; `data:` seria despejar bytes de terceiro
		// dentro do nosso JSON.
		expect(
			extrairOgImage(cabeca('<meta property="og:image" content="/img/6.jpg">')),
		).toBeNull();
		expect(
			extrairOgImage(
				cabeca(
					'<meta property="og:image" content="data:image/png;base64,AAA">',
				),
			),
		).toBeNull();
		expect(
			extrairOgImage(cabeca('<meta property="og:image" content="">')),
		).toBeNull();
	});

	it('devolve null quando a página não tem a tag (não inventa foto)', () => {
		expect(
			extrairOgImage(cabeca('<meta name="description" content="x">')),
		).toBeNull();
		expect(extrairOgImage('')).toBeNull();
		expect(extrairOgImage('<html><body>sem head</body></html>')).toBeNull();
	});
});

/* ═════════════════════ allowlist (anti-SSRF) ═════════════════════ */

describe('hostPermitido — vitrine, não internet', () => {
	it('aceita marketplace e subdomínio de anúncio', () => {
		for (const u of [
			'https://mercadolivre.com.br/p/123',
			'https://produto.mercadolivre.com.br/MLB-1',
			'https://shopee.com.br/item',
			'https://www.amazon.com.br/dp/B0',
			'https://www.tiktok.com/shop/1',
			'https://www.elo7.com.br/x',
		]) {
			expect(hostPermitido(u), u).toBe(true);
		}
	});

	it('aceita loja brasileira genérica (.com.br com rótulo próprio)', () => {
		expect(hostPermitido('https://lojadojoao.com.br/produto/1')).toBe(true);
		expect(hostPermitido('https://loja.qualquercoisa.com.br/x')).toBe(true);
	});

	it('sufixo casa em fronteira de rótulo — domínio parecido NÃO passa', () => {
		expect(hostPermitido('https://eviltiktok.com/x')).toBe(false);
		expect(hostPermitido('https://tiktok.com.attacker.net/x')).toBe(false);
		expect(hostPermitido('https://mercadolivre.com.br.attacker.com/x')).toBe(
			false,
		);
	});

	it('barra alvo interno, IP literal, http e lixo', () => {
		for (const u of [
			'https://localhost/x',
			'https://127.0.0.1/x',
			'https://169.254.169.254/latest/meta-data', // metadata da cloud
			'https://[::1]/x',
			'http://mercadolivre.com.br/x', // só https
			'file:///etc/passwd',
			'https://com.br/x',
			'não é url',
			'',
		]) {
			expect(hostPermitido(u), u).toBe(false);
		}
	});
});

/* ═══════════ falha em silêncio, e antes de qualquer DNS ═══════════ */

describe('buscar — foto é enfeite, nunca derruba o dossiê', () => {
	it('host fora da allowlist devolve null sem sair da máquina', async () => {
		await expect(inspecionarPagina('https://127.0.0.1/x')).resolves.toBeNull();
		await expect(inspecionarPagina('http://localhost:9/x')).resolves.toBeNull();
		await expect(inspecionarPagina('nem-url')).resolves.toBeNull();
	});

	it('lista só de host barrado vira mapa vazio, não exceção', async () => {
		const mapa = await inspecionarPaginas([
			'https://169.254.169.254/x',
			'https://localhost/y',
		]);
		expect(mapa.size).toBe(0);
	});

	it('lista vazia não faz nada', async () => {
		expect((await inspecionarPaginas([])).size).toBe(0);
	});
});

describe('achados da verificação adversarial', () => {
	it('code point inválido não lança — HTML de terceiro é hostil', () => {
		// `String.fromCodePoint(0x110000)` lança RangeError. Vinha de entidade
		// numérica malformada numa query string de CDN.
		expect(() =>
			extrairOgImage(
				'<head><meta property="og:image" content="https://cdn.x/a&#x110000;.jpg"></head>',
			),
		).not.toThrow();
	});

	it('og:image COMENTADA não conta como foto do produto', () => {
		// Template de loja deixa o placeholder comentado no head. Mostrá-lo seria
		// errado de um jeito que parece certo — o pior tipo.
		const html =
			'<head><!-- <meta property="og:image" content="https://cdn.x/placeholder.jpg"> -->' +
			'<meta property="og:image" content="https://cdn.x/real.jpg"></head>';
		expect(extrairOgImage(html)).toBe('https://cdn.x/real.jpg');
	});

	it('só comentário ⇒ nenhuma foto, e não a do placeholder', () => {
		const html =
			'<head><!-- <meta property="og:image" content="https://cdn.x/ph.jpg"> --></head>';
		expect(extrairOgImage(html)).toBeNull();
	});
});

describe('anúncio individual vs página de busca', () => {
	it('página de busca NÃO é anúncio — a og:image dela é o logo do marketplace', () => {
		// Caso real: o especialista devolveu esta URL como se fosse um anúncio.
		expect(
			ehPaginaDeAnuncio(
				'https://lista.mercadolivre.com.br/lembrancinhas-de-casamento',
			),
		).toBe(false);
		expect(
			ehPaginaDeAnuncio('https://shopee.com.br/search?keyword=caneca'),
		).toBe(false);
		expect(ehPaginaDeAnuncio('https://www.amazon.com.br/s?k=copo')).toBe(false);
		expect(ehPaginaDeAnuncio('https://shopee.com.br/')).toBe(false);
	});

	/**
	 * ARTIGO DE BLOG NÃO É ANÚNCIO — e a og:image dele é o banner do post.
	 *
	 * MEDIDO num run frio de `mercado+profundo`: 2 dos 8 ladrilhos da "Galeria de
	 * referências" eram `yav.com.br/og/blog/guia-marketplaces-brasil-2026.png` e
	 * `yav.com.br/og/comissoes.png` — as artes de dois posts sobre comissão de
	 * marketplace, que o Especialista em Marketplaces citou legitimamente como
	 * fonte. Os dois respondem HTTP 200, então nada os tirava da tela, e a intro
	 * do box convida o aluno a clicar "para abrir a página de onde ela saiu"
	 * esperando o anúncio de um concorrente.
	 *
	 * Mesma classe do logotipo de marketplace que o filtro de listagem já pega,
	 * por uma porta que ele não fechava.
	 */
	it('ARTIGO E CENTRAL DE AJUDA NÃO SÃO ANÚNCIO — a og:image deles é o banner', () => {
		expect(
			ehPaginaDeAnuncio(
				'https://yav.com.br/blog/guia-marketplaces-brasil-2026',
			),
		).toBe(false);
		expect(ehPaginaDeAnuncio('https://blog.loja.com.br/comissoes-2026')).toBe(
			false,
		);
		expect(
			ehPaginaDeAnuncio('https://www.mercadolivre.com.br/ajuda/custos_1234'),
		).toBe(false);
		expect(
			ehPaginaDeAnuncio('https://exemplo.com.br/2026/07/como-vender-mais'),
		).toBe(false);
		expect(ehPaginaDeAnuncio('https://loja.com/noticias/frete-gratis')).toBe(
			false,
		);
	});

	it('anúncio individual passa', () => {
		expect(
			ehPaginaDeAnuncio(
				'https://produto.mercadolivre.com.br/MLB-123-copo-termico',
			),
		).toBe(true);
		expect(
			ehPaginaDeAnuncio('https://shopee.com.br/Caneca-Personalizada-i.123.456'),
		).toBe(true);
	});

	/**
	 * O PLURAL QUE ESCAPAVA. `\/blog\b` não casa com `/blogs/` — entre o `g` e o
	 * `s` não há fronteira de palavra. Loja Shopify serve o blog dela nesse
	 * caminho, e foi por ele que `bhband.com.br/blogs/novidades-e-tendencias/
	 * calendario-brindes-corporativos` entrou no run mp1 e virou ladrilho.
	 */
	it('`/blogs/` (plural, padrão Shopify) também não é anúncio', () => {
		expect(
			ehPaginaDeAnuncio(
				'https://www.bhband.com.br/blogs/novidades-e-tendencias/calendario-brindes-corporativos',
			),
		).toBe(false);
	});
});

/* ════════ a página DECLARA o que é: og:type manda no ladrilho ════════ */

/**
 * As cabeças abaixo são REDUÇÕES VERBATIM do `<head>` real das páginas dos runs
 * frios gravados (mp1, mp2, mp3, pp1, pp2, pp3) — mesmas tags, mesmos valores.
 * Nenhuma foi inventada para o teste passar: cada uma é uma página que o motor
 * de fato abriu, e a foto ao lado é a que ele de fato trouxe.
 */
const head = (metas: string) =>
	`<!doctype html><html><head><title>t</title>${metas}</head><body>x</body></html>`;

describe('galeria — banner de artigo e logo de loja não são foto de produto', () => {
	/**
	 * O CASO QUE REPROVOU A RODADA: `yav.com.br/comissoes-marketplace/` aparece em
	 * 6 de 6 runs profundos, e em mp1/mp2 era METADE da galeria (2 ladrilhos, os
	 * dois banner). A URL não tem `/blog/`, `/artigos/` nem data — a lista de
	 * caminhos passa. O `<head>` diz `og:type: article`, e isso basta.
	 */
	it('artigo declarado (og:type) NÃO vira foto, mesmo com slug de produto', () => {
		const casos: [string, string, string][] = [
			[
				'https://yav.com.br/comissoes-marketplace/',
				'<meta property="og:type" content="article"><meta property="og:image" content="https://yav.com.br/og/comissoes.png"><meta property="article:published_time" content="2026-06-07">',
				'6 de 6 runs profundos',
			],
			[
				'https://www.promoview.com.br/pesquisa-revela-os-brindes-favoritos-das-empresas-no-brasil-destaque-news/',
				'<meta property="og:type" content="article"><meta property="og:image" content="https://www.promoview.com.br/wp-content/uploads/2024/11/amlvTGQT-04707f9c.webp">',
				'mp1 e mp2',
			],
			[
				'https://redoma.com.br/brindes-corporativos-personalizados-guia-empresas/',
				'<meta property="og:type" content="article"><meta property="og:image" content="http://redoma.com.br/wp-content/uploads/2026/06/20260601-Blogpost-1-Corporativo.jpg">',
				'mp2',
			],
			[
				'https://rvb.com.br/marketing-sazonal-para-varejo/',
				'<meta property="og:type" content="article"><meta property="article:section" content="Marketing"><meta property="og:image" content="https://rvb.com.br/wp-content/uploads/2026/07/marketing-sazonal-para-varejo-calendario-promocional-2026.webp">',
				'pp3',
			],
			[
				'https://leadjet.com.br/mercado-b2b/',
				'<meta property="og:type" content="article"><meta property="og:image" content="https://leadjet.com.br/assets/img/leadjet-painel-novo-1200.png">',
				'pp3',
			],
			[
				'https://seller-br.tiktok.com/university/essay?knowledge_id=6843306600302353',
				'<meta property="og:image" content="https://p16-oec-university-sign-sg.ibyteimg.com/tos-alisg/0967648644b54cc1.jpg"><meta property="og:type" content="article">',
				'mp2',
			],
		];
		for (const [url, metas, onde] of casos) {
			expect(fotoDeProduto(head(metas), url), `${onde}: ${url}`).toBeNull();
		}
	});

	/**
	 * A ARMADILHA ORIGINAL, pela porta que a URL não fecha: categoria de loja sem
	 * `/busca/` nem `?q=` no endereço. As três devolveram o LOGOTIPO.
	 */
	it('logo de loja (página de categoria) NÃO vira foto', () => {
		expect(
			fotoDeProduto(
				head(
					'<meta property="og:type" content="website"><meta property="og:image" content="https://cdn.awsli.com.br/960/960037/logo/logo-imperio-02-photoroom.png">',
				),
				'https://www.imperiodasublimacao.com.br/canecas-brancas',
			),
		).toBeNull();
		expect(
			fotoDeProduto(
				head(
					'<meta property="og:type" content="website"><meta property="og:image" content="https://cdn.awsli.com.br/994/994552/logo/c7c13fce31.png">',
				),
				'https://www.baratomaquinas.com.br/canecas-de-porcelana-sublimacao',
			),
		).toBeNull();
		expect(
			fotoDeProduto(
				head(
					'<meta property="og:image" content="http://dcdn-us.mitiendanube.com/stores/002/876/287/themes/common/logo-1108446972425128982.png?0">',
				),
				'https://www.mdcriative.com.br/pecas-em-acrilico/chaveiros-em-acrilico/',
			),
		).toBeNull();
	});

	/** `logo` casa como PASTA ou início de nome — não como pedaço de palavra. */
	it('`logo` no meio do título do anúncio não condena a foto', () => {
		expect(ehArteDoSite('https://cdn.x/logo/marca.png')).toBe(true);
		expect(ehArteDoSite('https://cdn.x/img/logo-loja.png')).toBe(true);
		expect(
			ehArteDoSite(
				'https://http2.mlstatic.com/D_NQ_NP_854211-chaveiro-com-sua-logomarca.webp',
			),
		).toBe(false);
		expect(ehArteDoSite('nem-url')).toBe(false);
	});

	/**
	 * O RESGATE. Loja WooCommerce cujo tema marca TUDO como `article`. A foto dela
	 * entrou na galeria de mp3 e é uma foto de produto de verdade — sem o resgate
	 * pelo `/produto/` no caminho, o conserto do banner levaria junto um ladrilho
	 * legítimo.
	 */
	it('loja que se declara `article` mas tem /produto/ no caminho MANTÉM a foto', () => {
		expect(
			fotoDeProduto(
				head(
					'<meta property="og:type" content="article"><meta property="article:modified_time" content="2026-06-17T01:41:28+00:00"><meta property="og:image" content="https://dinka.com.br/wp-content/uploads/2024/01/15242210056_D_NQ_NP_2X_989055-MLB47137791205_082021-F.webp">',
				),
				'https://dinka.com.br/produto/20-chaveiro-personalizado-em-acrilico-gravacao-laser/',
			),
		).toBe(
			'https://dinka.com.br/wp-content/uploads/2024/01/15242210056_D_NQ_NP_2X_989055-MLB47137791205_082021-F.webp',
		);
	});

	/** As 27 páginas de produto dos mesmos runs continuam entregando a foto. */
	it('página de produto de verdade continua passando', () => {
		const bons: [string, string, string][] = [
			[
				'https://www.srpersonalizados.com.br/caneca-em-porcelana-branca-personalizada',
				'<meta property="og:type" content="website"><meta name="twitter:card" content="product"><meta property="og:image" content="https://cdn.awsli.com.br/800x800/2725/2725293/produto/259197180f331ba1697.jpg">',
				'https://cdn.awsli.com.br/800x800/2725/2725293/produto/259197180f331ba1697.jpg',
			],
			[
				// A loja anuncia a foto em `http://` e a página é servida por https.
				// Ver o teste "MIXED CONTENT" logo abaixo: a foto SOBE para https.
				'https://www.proarcgrafica.com.br/produtos/caneca-personalizada-branca-porcelana-325ml/',
				'<meta property="og:type" content="nuvemshop:product"><meta property="og:image" content="http://dcdn-us.mitiendanube.com/stores/002/070/139/products/whatsapp-image-640-0.webp">',
				'https://dcdn-us.mitiendanube.com/stores/002/070/139/products/whatsapp-image-640-0.webp',
			],
			[
				'https://www.lojametalnox.com.br/produto/kit-36-canecas-para-sublimacao-de-ceramica-branca-importada-325ml-68301',
				'<meta property="og:type" content="product"><meta property="product:price:amount" content="395.64"><meta property="og:image" content="https://lojametalnox.fbitsstatic.net/img/p/kit-36-canecas/254726.jpg">',
				'https://lojametalnox.fbitsstatic.net/img/p/kit-36-canecas/254726.jpg',
			],
			[
				'https://www.graficaprintcenter.com.br/produto/chaveiro-de-acrilico-5x5cm-185',
				'<meta property="og:image" content="https://www.graficaprintcenter.com.br/uploads/produtos/chaveiro-de-acrilico-f-1729271680.png"><meta property="og:type" content="og:product">',
				'https://www.graficaprintcenter.com.br/uploads/produtos/chaveiro-de-acrilico-f-1729271680.png',
			],
			[
				// Sem `og:type` nenhum — neutro é aceito, e não presumido artigo.
				'https://www.lazershop.com.br/churrasco/tabua/tramontina-premium-madeira-50x38cm/',
				'<meta property="og:image" content="https://www.lazershop.com.br/img/products/tramontina-premium_1_200.webp">',
				'https://www.lazershop.com.br/img/products/tramontina-premium_1_200.webp',
			],
		];
		for (const [url, metas, foto] of bons) {
			expect(fotoDeProduto(head(metas), url), url).toBe(foto);
		}
	});

	it('sem URL de página, o `<head>` sozinho ainda decide', () => {
		expect(
			fotoDeProduto(
				head(
					'<meta property="og:type" content="article"><meta property="og:image" content="https://x.com.br/og/post.png">',
				),
			),
		).toBeNull();
		expect(
			fotoDeProduto(
				head('<meta property="og:image" content="https://x.com.br/p/1.jpg">'),
			),
		).toBe('https://x.com.br/p/1.jpg');
	});

	it('MIXED CONTENT: foto anunciada em http SOBE para https, não é descartada', () => {
		// O dossiê é servido por https e o navegador BLOQUEIA imagem http dentro
		// de página https. Medido na galeria dos runs gravados: 4 fotos boas
		// (`amouh.com.br` e dois CDNs `mitiendanube`) apareceriam como ladrilho
		// vazio em produção — 1 de 7 num run e 2 de 13 em outro. As 4 respondem
		// 200 com `image/*` no MESMO host e caminho em https, conferido com curl.
		expect(
			fotoDeProduto(
				head(
					'<meta property="og:image" content="http://acdn-us.mitiendanube.com/stores/003/products/img_6730-640-0.webp">',
				),
			),
		).toBe(
			'https://acdn-us.mitiendanube.com/stores/003/products/img_6730-640-0.webp',
		);
		// Protocolo relativo continua virando https pela mesma regra.
		expect(
			fotoDeProduto(head('<meta property="og:image" content="//cdn.x/5.jpg">')),
		).toBe('https://cdn.x/5.jpg');
	});
});

/* ═══════ o portão do PREÇO: a página assina que está vendendo? ═══════ */

describe('só é "anúncio" o que a própria página assina como comércio', () => {
	/**
	 * O `<head>` REAL das páginas de onde saiu cada preço dos runs gravados.
	 *
	 * É a diferença que custou a seção de preço em 5 runs de 9: a tela imprimia
	 * "12 anúncios com preço e link" e cravava mediana R$ 36,50 sobre uma tabela
	 * de comissão, um exemplo de artigo fiscal e a transcrição de um vídeo.
	 */
	it('tabela de comissão, artigo fiscal e página de categoria NÃO são anúncio', () => {
		const naoSao: [string, string][] = [
			// R$ 79 aqui é o DEGRAU da comissão da Shopee, não um preço de produto.
			[
				'https://yav.com.br/comissoes-marketplace/',
				'<meta property="og:type" content="article">',
			],
			// Categoria de loja: declara `website` como qualquer loja, mas não tem
			// preço, nem disponibilidade, nem `/produto/` no caminho.
			[
				'https://www.luminatibrindes.com.br/brindes/squeezes-personalizados/',
				'<meta property="og:type" content="website">',
			],
			// Calculadora de marketplace — cheia de `R$`, nenhum deles à venda.
			[
				'https://www.precisaofinanceira.com.br/calculadoras-marketplaces/precificacao',
				'<meta property="og:type" content="website">',
			],
			// Página sem `og:type` nenhum: neutro NÃO é prova de que vende.
			['https://www.ltp1.com.br/setor-brindes-no-brasil/', ''],
		];
		for (const [url, metas] of naoSao) {
			expect(analisarCabeca(head(metas), url).anuncio, url).toBe(false);
		}
	});

	it('anúncio de verdade assina — por og:type, por preço, por card ou por caminho', () => {
		const sao: [string, string][] = [
			// `og:type: product` e as duas grafias que as lojas brasileiras emitem.
			[
				'https://www.copygloria.com.br/produto/caneca-porcelana',
				'<meta property="og:type" content="product">',
			],
			[
				'https://www.proarcgrafica.com.br/produtos/caneca-personalizada/',
				'<meta property="og:type" content="nuvemshop:product">',
			],
			// `website` + preço publicado: a loja assina que aquilo está à venda.
			[
				'https://www.nakalubrindes.com.br/caneca-termica-500ml-personalizada',
				'<meta property="og:type" content="website"><meta property="product:price:amount" content="55.00">',
			],
			// `website` + card de produto do Twitter.
			[
				'https://www.srpersonalizados.com.br/caneca-em-porcelana-branca',
				'<meta property="og:type" content="website"><meta name="twitter:card" content="product">',
			],
			// WooCommerce que marca tudo como artigo, mas o caminho é `/produto/`.
			[
				'https://graficadaka.com.br/produto/caneca-personalizada/',
				'<meta property="og:type" content="article">',
			],
		];
		for (const [url, metas] of sao) {
			expect(analisarCabeca(head(metas), url).anuncio, url).toBe(true);
		}
	});

	it('uma leitura, DUAS respostas — é anúncio E qual é a foto', () => {
		// O motivo de `analisarCabeca` existir em vez de dois `fotoDeProduto`:
		// quem chama precisa das duas coisas do MESMO `<head>` já baixado.
		const r = analisarCabeca(
			head(
				'<meta property="og:type" content="product"><meta property="og:image" content="https://cdn.x.com.br/produto/1.jpg">',
			),
			'https://x.com.br/produto/caneca',
		);
		expect(r).toEqual({
			anuncio: true,
			foto: 'https://cdn.x.com.br/produto/1.jpg',
		});
		// E o artigo continua sem foto E sem virar anúncio, na mesma passada.
		expect(
			analisarCabeca(
				head(
					'<meta property="og:type" content="article"><meta property="og:image" content="https://x.com.br/og/banner.png">',
				),
				'https://x.com.br/comissoes-marketplace/',
			),
		).toEqual({ anuncio: false, foto: null });
	});
});

/* ═════════════ o ARQUIVO da foto — status 200 não prova nada ═════════════ */

/**
 * ┌─ O QUE ESTE BLOCO DEFENDE ───────────────────────────────────────────────┐
 * │ Quatro ladrilhos da galeria dos runs gravados eram o MESMO arquivo: o GIF │
 * │ cinza "imagem indisponível" do CDN do Mercado Livre, servido com HTTP 200 │
 * │ e `content-type: image/gif` para um endereço de foto que não existe.      │
 * │ Conferir por status diria "as quatro estão de pé".                        │
 * │                                                                          │
 * │ Os dois arquivos, baixados: `img-not-available/1.1.0/O.gif` (8.456 B,     │
 * │ 500×500, md5 fe20176f49…) e `F@2x.gif` (52.473 B, 1200×1200, md5          │
 * │ 5674b1b058…). E a menor foto BOA dos mesmos runs tem 7.816 B — ou seja,   │
 * │ tamanho SOZINHO não separa os dois, e é por isso que existe a lista de    │
 * │ md5 e a regra de caminho.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const gif = (w: number, h: number, bytes: number) => {
	const b = new Uint8Array(Math.max(13, bytes));
	b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
	b[6] = w & 0xff;
	b[7] = (w >> 8) & 0xff;
	b[8] = h & 0xff;
	b[9] = (h >> 8) & 0xff;
	return b;
};

const png = (w: number, h: number, bytes: number) => {
	const b = new Uint8Array(Math.max(24, bytes));
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	new DataView(b.buffer).setUint32(16, w);
	new DataView(b.buffer).setUint32(20, h);
	return b;
};

const jpeg = (w: number, h: number, bytes: number) => {
	const b = new Uint8Array(Math.max(32, bytes));
	// SOI, depois um APP0 curto (para provar que o leitor ANDA até o SOF), e o
	// SOF0 com altura antes da largura — que é a ordem do formato.
	b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], 0);
	b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 8);
	const v = new DataView(b.buffer);
	v.setUint16(13, h);
	v.setUint16(15, w);
	return b;
};

const webp = (w: number, h: number, bytes: number) => {
	const b = new Uint8Array(Math.max(30, bytes));
	b.set(
		[...'RIFF'].map((c) => c.charCodeAt(0)),
		0,
	);
	b.set(
		[...'WEBP'].map((c) => c.charCodeAt(0)),
		8,
	);
	b.set(
		[...'VP8X'].map((c) => c.charCodeAt(0)),
		12,
	);
	const le24 = (i: number, n: number) => {
		b[i] = n & 0xff;
		b[i + 1] = (n >> 8) & 0xff;
		b[i + 2] = (n >> 16) & 0xff;
	};
	le24(24, w - 1);
	le24(27, h - 1);
	return b;
};

describe('dimensoesDeImagem — lê o cabeçalho, não decodifica', () => {
	it('os quatro formatos que os runs devolveram', () => {
		expect(dimensoesDeImagem(png(1240, 1240, 40))).toEqual({
			w: 1240,
			h: 1240,
			fmt: 'png',
		});
		expect(dimensoesDeImagem(gif(500, 500, 40))).toEqual({
			w: 500,
			h: 500,
			fmt: 'gif',
		});
		expect(dimensoesDeImagem(jpeg(800, 600, 64))).toEqual({
			w: 800,
			h: 600,
			fmt: 'jpeg',
		});
		expect(dimensoesDeImagem(webp(2000, 2000, 64))).toEqual({
			w: 2000,
			h: 2000,
			fmt: 'webp',
		});
	});

	it('formato desconhecido é "NÃO SEI", nunca "reprovado"', () => {
		// Se `null` reprovasse, AVIF e o que uma loja publicar amanhã sairiam da
		// galeria sem ninguém notar. Quem já disse que é imagem é o servidor.
		expect(dimensoesDeImagem(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(
			null,
		);
		expect(
			fotoAprovada(
				'https://cdn.x.com.br/produto/1.avif',
				'image/avif',
				new Uint8Array(9_000),
			),
		).toBe(true);
	});
});

describe('fotoAprovada — a foto é conferida por BYTES', () => {
	it('O PLACEHOLDER DO MERCADO LIVRE É RECUSADO, com 200 e content-type de imagem', () => {
		// O arquivo real: `image/gif`, 8.456 B, 500×500 — nada nisso denuncia.
		// Quem denuncia é o CAMINHO (a família inteira do "sem imagem" do CDN).
		expect(
			fotoAprovada(
				'https://http2.mlstatic.com/resources/frontend/statics/img-not-available/1.1.0/O.gif',
				'image/gif',
				gif(500, 500, 8_456),
			),
		).toBe(false);
		// E a versão 2x, que tem 52 KB e 1200×1200 — grande, e mesmo assim cinza.
		expect(
			fotoAprovada(
				'https://http2.mlstatic.com/resources/frontend/statics/img-not-available/1.1.0/F@2x.gif',
				'image/gif',
				gif(1_200, 1_200, 52_473),
			),
		).toBe(false);
	});

	it('os dois md5 MEDIDOS ficam pinados — o caminho versiona, o arquivo não', () => {
		// `1.1.0` vira `1.2.0` e a regra de caminho continua valendo; o md5 é o
		// cinto para o dia em que o CDN mudar o endereço e não o arquivo.
		expect(MD5_PLACEHOLDER.has('fe20176f493696da21e6da31cf78213f')).toBe(true);
		expect(MD5_PLACEHOLDER.has('5674b1b0587d754e66bf7ce6c0644264')).toBe(true);
	});

	it('A MENOR FOTO BOA DOS RUNS CONTINUA PASSANDO — tamanho não separa', () => {
		// 7.816 B contra os 8.456 B do placeholder: cortar por tamanho onde eles
		// se cruzam derrubaria foto de verdade. Esta é a `inovapersonalizados`.
		expect(
			fotoAprovada(
				'https://inovapersonalizados.com.br/wp-content/uploads/2025/06/caneca-termica-700ml.webp',
				'image/webp',
				webp(500, 500, 7_816),
			),
		).toBe(true);
		// E a menor em LADO (600×315, `iniciativabrindes`) também.
		expect(
			fotoAprovada(
				'https://www.iniciativabrindes.com.br/image/cache/catalog/brindes/caneca-cn19-600x315w.jpg',
				'image/jpeg',
				jpeg(600, 315, 19_315),
			),
		).toBe(true);
	});

	it('não-imagem servida como og:image cai fora', () => {
		// Aconteceu num run gravado: `nao_e_imagem` na grade de `produto-profundo-B`.
		expect(
			fotoAprovada(
				'https://loja.com.br/produto/1',
				'text/html; charset=utf-8',
				png(800, 800, 40_000),
			),
		).toBe(false);
		expect(
			fotoAprovada('https://loja.com.br/x.jpg', '', png(800, 800, 40_000)),
		).toBe(false);
	});

	it('pixel de rastreio e ícone não são foto de produto', () => {
		// Piso de tamanho: o GIF de 1×1 que loja com lazy-load publica na tag.
		expect(
			fotoAprovada('https://loja.com.br/px.gif', 'image/gif', gif(1, 1, 43)),
		).toBe(false);
		// Piso de LADO: o arquivo é gordo, mas 64×64 é selo, não produto.
		expect(
			fotoAprovada(
				'https://loja.com.br/selo.png',
				'image/png',
				png(64, 64, 9_000),
			),
		).toBe(false);
	});

	it('"placeholder" no NOME DO PRODUTO não derruba a foto', () => {
		// Casa por segmento ou por nome de arquivo, nunca por substring: o
		// endereço abaixo é anúncio legítimo de uma placa de mesa.
		expect(
			fotoAprovada(
				'https://cdn.awsli.com.br/800x800/1/produto/placa-de-mesa-em-acrilico.jpg',
				'image/jpeg',
				jpeg(800, 800, 30_000),
			),
		).toBe(true);
	});
});

describe('fotoNoCorpo — a loja que não declara og:image', () => {
	it('pega a foto do produto na CDN da plataforma', () => {
		const html = `<img src="/img/logo.png"><img data-src="https://cdn.awsli.com.br/800x800/1/produto/caneca-azul.jpg">`;
		expect(fotoNoCorpo(html, 'https://loja.com.br/produto/caneca')).toBe(
			'https://cdn.awsli.com.br/800x800/1/produto/caneca-azul.jpg',
		);
	});

	it('IGNORA logo, ícone, selo e bandeira — é o lixo que a galeria não pode ter', () => {
		const html = `
			<img src="https://cdn.awsli.com.br/1/logo-da-loja.png">
			<img src="https://cdn.awsli.com.br/1/selo-seguranca.png">
			<img src="https://cdn.awsli.com.br/1/bandeira-visa.png">
			<img src="https://cdn.awsli.com.br/1/produto/tabua-churrasco.jpg">`;
		expect(fotoNoCorpo(html, 'https://loja.com.br/p/tabua')).toBe(
			'https://cdn.awsli.com.br/1/produto/tabua-churrasco.jpg',
		);
	});

	it('resolve caminho relativo contra a página', () => {
		const html = `<img src="/media/produtos/chaveiro.jpg">`;
		expect(fotoNoCorpo(html, 'https://loja.com.br/p/chaveiro')).toBe(
			'https://loja.com.br/media/produtos/chaveiro.jpg',
		);
	});

	it('recusa img de host qualquer que não é CDN de loja nem caminho de mídia', () => {
		const html = `<img src="https://blogaleatorio.com/foto.jpg">`;
		expect(fotoNoCorpo(html, 'https://blogaleatorio.com/post')).toBeNull();
	});

	it('ignora o GIF de 1px do lazy-load e pega o `data-src`', () => {
		const html = `<img src="data:image/gif;base64,R0lGOD" data-src="https://cdn.tcdn.com.br/img/produtos/porta-copos.jpg">`;
		expect(fotoNoCorpo(html, 'https://loja.com.br/p/x')).toBe(
			'https://cdn.tcdn.com.br/img/produtos/porta-copos.jpg',
		);
	});
});
