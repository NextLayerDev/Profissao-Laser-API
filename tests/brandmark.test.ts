import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
	type BrandmarkResult,
	cantoDaDirecao,
	imageBrandmarkBlock,
	laudoLineArt,
	legibilidadeDaTinta,
	lerCanto,
} from '@/tool-blocks/blocks/brandmark.js';
import { loadRaster } from '@/tool-blocks/lib/pixels.js';
import type { BlockRunContext } from '@/tool-blocks/types.js';

/**
 * O LOGO NA ARTE — verificado nos BYTES, não no "parece certo".
 *
 * Este bloco existe para fechar o pedido literal do dono ("ele tem que subir
 * logo, cores e tudo mais"). Nada aqui é mock: as imagens são construídas com
 * `sharp`, o bloco é o de produção e cada afirmação é uma contagem de pixel.
 *
 * As três coisas que só um teste de bytes pega:
 *  • o logo colou no CANTO certo (e não em outro canto igualmente plausível);
 *  • o logo é VISÍVEL depois de colado (escuro sobre escuro é logo nenhum, e
 *    custou a ida ao servidor do mesmo jeito);
 *  • a arte de traço continua BITONAL — 2 níveis, 0 pixels coloridos —, que é
 *    a diferença entre uma peça que a máquina corta e uma que ela não corta.
 */

const ctx: BlockRunContext = { customerId: 'teste' };

const rodar = async (
	params: Record<string, unknown>,
): Promise<BrandmarkResult> =>
	(await imageBrandmarkBlock.run(
		ctx,
		imageBrandmarkBlock.paramsSchema.parse(params),
	)) as unknown as BrandmarkResult;

/* ───────────────────────────── fixtures ───────────────────────────── */

/**
 * Arte "de foto": bancada escura e ruidosa com UM canto calmo e claro.
 *
 * A caixa clara é posicionada exatamente onde os defaults novos (`scale` 0,09 e
 * `margin` 0,055) põem o logo, com folga em volta — assim ela é o canto que a
 * escolha por medição TEM de encontrar. O ruído no resto é obrigatório: sem
 * ele todo canto teria desvio 0 e a medição acertaria por sorte.
 */
async function arteComCantoCalmo(
	canto: 'inferior_direito' | 'superior_esquerdo',
	lado = 800,
	folgaExtra = 14,
): Promise<Buffer> {
	const w = lado;
	const bruto = Buffer.alloc(w * w * 3);
	for (let i = 0; i < w * w; i++) {
		const v = 40 + ((i * 2654435761) % 90);
		bruto[i * 3] = v;
		bruto[i * 3 + 1] = v - 10;
		bruto[i * 3 + 2] = v - 20;
	}
	const fundo = sharp(bruto, { raw: { width: w, height: w, channels: 3 } });
	const folga = Math.round(w * 0.055);
	const box = Math.round(w * 0.09);
	const caixa = Math.min(w, box + folgaExtra * 2);
	const canto1 = Math.max(0, folga - folgaExtra);
	const pos =
		canto === 'inferior_direito'
			? { left: w - caixa - canto1, top: w - caixa - canto1 }
			: { left: canto1, top: canto1 };
	const branco = await sharp({
		create: { width: caixa, height: caixa, channels: 3, background: '#ffffff' },
	})
		.png()
		.toBuffer();
	return fundo
		.composite([{ input: branco, ...pos }])
		.png()
		.toBuffer();
}

/** Logo preto sobre transparente — o caso bem-comportado. */
async function logoPretoTransparente(lado = 256): Promise<Buffer> {
	const d = Buffer.alloc(lado * lado * 4);
	for (let y = 0; y < lado; y++) {
		for (let x = 0; x < lado; x++) {
			const p = (y * lado + x) * 4;
			const dentro =
				x > lado * 0.2 && x < lado * 0.8 && y > lado * 0.35 && y < lado * 0.65;
			d[p + 3] = dentro ? 255 : 0;
		}
	}
	return sharp(d, { raw: { width: lado, height: lado, channels: 4 } })
		.png()
		.toBuffer();
}

/** Logo de cor única sobre transparente (dá para inverter sem inventar cor). */
async function logoMonocromatico(hex: number[], lado = 256): Promise<Buffer> {
	const d = Buffer.alloc(lado * lado * 4);
	for (let y = 0; y < lado; y++) {
		for (let x = 0; x < lado; x++) {
			const p = (y * lado + x) * 4;
			const dentro = x > 30 && x < lado - 30 && y > 80 && y < lado - 80;
			d[p] = hex[0];
			d[p + 1] = hex[1];
			d[p + 2] = hex[2];
			d[p + 3] = dentro ? 255 : 0;
		}
	}
	return sharp(d, { raw: { width: lado, height: lado, channels: 4 } })
		.png()
		.toBuffer();
}

/**
 * O logo do aluno REAL, reproduzido: retângulo vermelho e círculo azul que se
 * TOCAM, mais uma barra amarela. Medido na investigação: limiarizado, vermelho e
 * azul (luminâncias 70 e 67) fundem num blob único de 24.791 px.
 */
async function logoQueSoSeLePorCor(lado = 256): Promise<Buffer> {
	const d = Buffer.alloc(lado * lado * 4);
	const meio = lado / 2;
	for (let y = 0; y < lado; y++) {
		for (let x = 0; x < lado; x++) {
			const p = (y * lado + x) * 4;
			const noCirculo = (x - meio) ** 2 + (y - meio) ** 2 < (lado * 0.28) ** 2;
			const noRetangulo = x >= meio && x < lado - 20 && y > 40 && y < lado - 40;
			const naBarra = y > lado - 34 && y < lado - 14 && x > 20 && x < lado - 20;
			let cor: number[] | null = null;
			if (noCirculo)
				cor = [29, 63, 225]; // azul  → luma ≈ 67
			else if (noRetangulo)
				cor = [225, 29, 29]; // vermelho → luma ≈ 71
			else if (naBarra) cor = [234, 179, 8]; // amarelo
			if (!cor) continue;
			d[p] = cor[0];
			d[p + 1] = cor[1];
			d[p + 2] = cor[2];
			d[p + 3] = 255;
		}
	}
	return sharp(d, { raw: { width: lado, height: lado, channels: 4 } })
		.png()
		.toBuffer();
}

/** Arte de traço de verdade: 2 níveis {0,255}, zero cor. */
async function arteDeTraco(lado = 400): Promise<Buffer> {
	const g = Buffer.alloc(lado * lado, 255);
	for (let y = 0; y < lado; y++) {
		for (let x = 0; x < lado; x++) {
			const borda =
				x > 40 && x < lado - 40 && y > 40 && y < lado - 40
					? x < 48 || x > lado - 48 || y < 48 || y > lado - 48
					: false;
			if (borda) g[y * lado + x] = 0;
		}
	}
	return sharp(g, { raw: { width: lado, height: lado, channels: 1 } })
		.png()
		.toBuffer();
}

/* ───────────────────────────── medições ───────────────────────────── */

/** Perfil de bytes: quantos pixels têm cor, quantos níveis de cinza existem. */
async function perfilDeBytes(png: Buffer) {
	const { data, info } = await sharp(png)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const ch = info.channels;
	const niveis = new Set<number>();
	let coloridos = 0;
	let intermediarios = 0;
	for (let i = 0; i < data.length; i += ch) {
		const r = data[i];
		const g = ch >= 3 ? data[i + 1] : r;
		const b = ch >= 3 ? data[i + 2] : r;
		if (r !== g || g !== b) coloridos++;
		niveis.add(r);
		if (r !== 0 && r !== 255) intermediarios++;
	}
	return { coloridos, intermediarios, niveis: niveis.size, ch };
}

/**
 * A pergunta que o bloco inteiro existe para responder: QUANTO DA TINTA se
 * separa do que está atrás dela?
 *
 * A geometria é REPRODUZIDA aqui (mesma `scale`, mesma `margin`, mesmo
 * `fit:'inside'`) em vez de perguntada ao bloco — se o posicionamento sair do
 * lugar, esta conta desaba junto e o teste acusa. Só serve para logo COM
 * transparência: sem ela o bloco recorta o fundo antes, e a silhueta muda.
 */
async function fracaoLegivel(
	arte: Buffer,
	logo: Buffer,
	r: BrandmarkResult,
): Promise<number> {
	const meta = await sharp(arte).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	const lado = Math.min(W, H);
	const L0 = await loadRaster(logo);
	const deitado = L0.width >= L0.height;
	const box = Math.round(lado * 0.09);
	const longo = Math.round(lado * 0.2);
	const folga = Math.round(lado * 0.055);
	const lp = await sharp(logo)
		.resize(deitado ? longo : box, deitado ? box : longo, {
			fit: 'inside',
			kernel: 'lanczos3',
		})
		.png()
		.toBuffer();
	const L = await loadRaster(lp);
	const esq = String(r.canto).endsWith('esquerdo');
	const cima = String(r.canto).startsWith('superior');
	return legibilidadeDaTinta(
		L,
		await loadRaster(arte),
		esq ? folga : W - folga - L.width,
		cima ? folga : H - folga - L.height,
		25,
	);
}

/**
 * A PLACA, medida: existe na imagem um retângulo grande de branco (ou preto)
 * ABSOLUTO e chapado? O `sharp` compõe a pastilha com `{r:255,g:255,b:255}`
 * exato, então ela deixa uma assinatura de bytes que uma foto nunca deixa.
 */
async function pixelsChapadosAbsolutos(png: Buffer): Promise<number> {
	const { data, info } = await sharp(png)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const ch = info.channels;
	let n = 0;
	for (let i = 0; i < data.length; i += ch) {
		const r = data[i];
		const g = ch >= 3 ? data[i + 1] : r;
		const b = ch >= 3 ? data[i + 2] : r;
		if (
			(r === 255 && g === 255 && b === 255) ||
			(r === 0 && g === 0 && b === 0)
		) {
			n++;
		}
	}
	return n;
}

/** Quantos pixels mudaram entre duas artes, e onde ficou o centro da mudança. */
async function ondeMudou(antes: Buffer, depois: Buffer) {
	const a = await loadRaster(antes);
	const b = await loadRaster(depois);
	let n = 0;
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < a.width * a.height; i++) {
		const p = i * 4;
		const dif =
			Math.abs(a.data[p] - b.data[p]) +
			Math.abs(a.data[p + 1] - b.data[p + 1]) +
			Math.abs(a.data[p + 2] - b.data[p + 2]);
		if (dif > 12) {
			n++;
			sx += i % a.width;
			sy += Math.floor(i / a.width);
		}
	}
	return { n, cx: n ? sx / n : 0, cy: n ? sy / n : 0, w: a.width, h: a.height };
}

/* ───────────────────────────── o canto ───────────────────────────── */

describe('lerCanto — o campo do Diretor e a prosa dele', () => {
	it('lê o campo enum, mesmo com underscore (que `\\b` não separa)', () => {
		expect(lerCanto('inferior_direito')).toBe('inferior_direito');
		expect(lerCanto('SUPERIOR_ESQUERDO')).toBe('superior_esquerdo');
		expect(lerCanto('nenhum')).toBe('nenhum');
	});

	it('lê as 4 prosas reais medidas nos runs do time', () => {
		const reais = [
			'Canto inferior direito, bloco de 80x80 pixels, fundo branco sem detalhe, com 10 pixels de folga da borda, para a marca aplicar o logo depois',
			'Canto inferior direito, em área branca lisa, com 10% de margem da borda.',
			'Canto inferior direito, ocupando 15% da largura do quadro, fundo liso branco, sem detalhe atrás, com folga de 5% da borda.',
			'Canto inferior direito, bloco de no mínimo 80x80px, fundo branco sem nenhum detalhe, reservado só para a marca aplicar o logo depois',
		];
		for (const p of reais) expect(lerCanto(p)).toBe('inferior_direito');
	});

	it('recusa a resposta AMBÍGUA que o Leitor da Marca já deu de verdade', () => {
		// "superior direito OU inferior direito" não é uma decisão — são duas.
		expect(
			lerCanto(
				'canto superior direito ou inferior direito, área limpa de 15% da altura da peça',
			),
		).toBeNull();
	});

	it('devolve null quando não há canto nenhum na frase', () => {
		expect(lerCanto('numa faixa lisa atrás do produto')).toBeNull();
		expect(lerCanto('')).toBeNull();
		expect(lerCanto(undefined)).toBeNull();
		expect(lerCanto(42)).toBeNull();
	});

	it('cava o objeto do Diretor: campo primeiro, prosa como socorro', () => {
		expect(
			cantoDaDirecao({
				canto_da_assinatura: 'inferior_esquerdo',
				area_da_assinatura: 'Canto inferior direito, área branca',
			}),
		).toEqual({ canto: 'inferior_esquerdo', origem: 'campo' });

		expect(
			cantoDaDirecao({
				canto_da_assinatura: '',
				area_da_assinatura: 'Canto superior direito, fundo liso',
			}),
		).toEqual({ canto: 'superior_direito', origem: 'prosa' });

		expect(cantoDaDirecao(null)).toEqual({ canto: null, origem: null });
	});
});

/* ───────────────────────────── composição ───────────────────────────── */

describe('image.brandmark — o logo entra onde o Diretor mandou', () => {
	it('cola no canto do CAMPO do Diretor, e só ali', async () => {
		const arte = await arteComCantoCalmo('inferior_direito');
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
		expect(r.canto).toBe('inferior_direito');
		expect(r.canto_origem).toBe('campo');

		const m = await ondeMudou(arte, r.png);
		expect(m.n).toBeGreaterThan(500);
		// O centro da mudança tem que estar no quadrante inferior direito.
		expect(m.cx).toBeGreaterThan(m.w * 0.6);
		expect(m.cy).toBeGreaterThan(m.h * 0.6);
	});

	it('sem campo, obedece a PROSA do Diretor', async () => {
		const arte = await arteComCantoCalmo('superior_esquerdo');
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: {
				area_da_assinatura:
					'Canto superior esquerdo, fundo branco liso, com folga da borda',
			},
		});
		expect(r.canto).toBe('superior_esquerdo');
		expect(r.canto_origem).toBe('prosa');
		const m = await ondeMudou(arte, r.png);
		expect(m.cx).toBeLessThan(m.w * 0.4);
		expect(m.cy).toBeLessThan(m.h * 0.4);
	});

	it('CANTO AUSENTE: mede a arte e acha a área reservada sozinho', async () => {
		const arte = await arteComCantoCalmo('inferior_direito');
		const r = await rodar({ image: arte, logo: await logoPretoTransparente() });
		expect(r.logo_aplicado).toBe(true);
		expect(r.canto_origem).toBe('medido');
		expect(r.canto).toBe('inferior_direito');
	});

	it('CANTO IRRECONHECÍVEL cai na medição — não vira erro nem chute', async () => {
		const arte = await arteComCantoCalmo('superior_esquerdo');
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: { canto_da_assinatura: 'no meio, mais ou menos' },
			canto_texto: 'perto do produto',
		});
		expect(r.canto_origem).toBe('medido');
		expect(r.canto).toBe('superior_esquerdo');
	});

	/**
	 * MUDOU DE VEREDICTO, DE PROPÓSITO. Este teste exigia que uma arte sem canto
	 * chapado saísse SEM logo, e isso fazia sentido enquanto o prompt mandava o
	 * gerador reservar área limpa: se a área não estava lá, algo tinha dado
	 * errado. A instrução saiu do roster (era ela que desenhava o retângulo
	 * branco da queixa do dono), e com ela sumiu o canto chapado de TODA arte —
	 * manter a exigência seria entregar arte sem assinatura para todo mundo.
	 * O contrato novo: cai no canto menos agitado, e o que se cobra é que o logo
	 * SE LEIA ali.
	 */
	it('arte agitada nos 4 cantos: assina no menos pior, e o logo se lê', async () => {
		const w = 800;
		const bruto = Buffer.alloc(w * w * 3);
		for (let i = 0; i < w * w * 3; i++) bruto[i] = (i * 7919) % 256;
		const arte = await sharp(bruto, {
			raw: { width: w, height: w, channels: 3 },
		})
			.png()
			.toBuffer();

		const logo = await logoPretoTransparente();
		const r = await rodar({ image: arte, logo });
		expect(r.logo_aplicado).toBe(true);
		expect(r.canto_origem).toBe('medido');
		expect(r.png.equals(arte)).toBe(false);
		expect(await fracaoLegivel(arte, logo, r)).toBeGreaterThanOrEqual(0.85);
	});

	/**
	 * O DIRETOR SUGERE, A MEDIÇÃO DECIDE — e este é o comportamento novo.
	 *
	 * Antes, canto declarado era ordem. Mas quem declara é um modelo de texto que
	 * NUNCA VÊ a imagem gerada: medido nas artes reais, o canto que ele pediu
	 * caiu em cima do buquê de eucalipto numa e da quina da tábua noutra. Aqui a
	 * arte tem o canto calmo embaixo à direita e o Diretor manda assinar em cima
	 * à esquerda, onde só há ruído.
	 */
	it('canto declarado que perde FEIO na medição é trocado', async () => {
		// Canto calmo embaixo à direita; o resto é textura forte de verdade
		// (desvio ≈ 74, a faixa de uma madeira rústica ou de uma folhagem).
		const w = 800;
		const bruto = Buffer.alloc(w * w * 3);
		for (let i = 0; i < w * w * 3; i++) bruto[i] = (i * 2654435761) % 256;
		const folga = Math.round(w * 0.055);
		const caixa = Math.round(w * 0.09) + 28;
		const arte = await sharp(bruto, {
			raw: { width: w, height: w, channels: 3 },
		})
			.composite([
				{
					input: await sharp({
						create: {
							width: caixa,
							height: caixa,
							channels: 3,
							background: '#ffffff',
						},
					})
						.png()
						.toBuffer(),
					left: w - caixa - Math.max(0, folga - 14),
					top: w - caixa - Math.max(0, folga - 14),
				},
			])
			.png()
			.toBuffer();
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: { canto_da_assinatura: 'superior_esquerdo' },
		});
		expect(r.canto).toBe('inferior_direito');
		expect(r.canto_origem).toBe('medido');
	});

	/**
	 * O CASO REAL QUE A MARGEM DE 0,15 DEIXAVA PASSAR — e é o mais comum.
	 *
	 * Com logo COLORIDO a legibilidade dá 1,0 nos quatro cantos (é o que a
	 * medição do logo real achou em 20 de 20 casos), então a nota inteira passa
	 * a depender da `calma`, que só move 0,30 de ponta a ponta. Uma margem de
	 * 0,15 é metade dessa faixa: o canto declarado ficava inderrotável.
	 *
	 * Aqui a arte reproduz o flagrante: o Diretor declara o alto à esquerda e é
	 * exatamente ali que o gerador pôs a manchete (região agitada, desvio ~35),
	 * enquanto os outros cantos são parede desfocada (desvio ~15). A diferença
	 * de nota fica em ~0,10 — a faixa que a margem antiga engolia.
	 */
	it('canto declarado com a MANCHETE em cima perde, mesmo com o logo legível nos 4', async () => {
		const w = 800;
		const folga = Math.round(w * 0.055);
		const box = Math.round(w * 0.09);
		const bruto = Buffer.alloc(w * w * 3);
		for (let y = 0; y < w; y++) {
			for (let x = 0; x < w; x++) {
				// A "manchete": a faixa do alto à esquerda, onde o logo iria pousar.
				const naManchete =
					x >= folga - 8 &&
					x < folga + box + 8 &&
					y >= folga - 8 &&
					y < folga + box + 8;
				// Fração de pixels escuros: 35% na manchete (desvio ≈ 35), 7% no
				// resto (desvio ≈ 15). `dev = Δ · √(f(1−f))`, com Δ = 60.
				const limite = naManchete ? 35 : 7;
				const escuro = (x * 2654435761 + y * 40503) % 100 < limite;
				const v = escuro ? 120 : 180;
				const p = (y * w + x) * 3;
				bruto[p] = v;
				bruto[p + 1] = v;
				bruto[p + 2] = v;
			}
		}
		const arte = await sharp(bruto, {
			raw: { width: w, height: w, channels: 3 },
		})
			.png()
			.toBuffer();
		const r = await rodar({
			image: arte,
			logo: await logoQueSoSeLePorCor(),
			direcao_arte: { canto_da_assinatura: 'superior_esquerdo' },
		});
		expect(r.canto_origem).toBe('medido');
		expect(r.canto).not.toBe('superior_esquerdo');
		// E ele continua LEGÍVEL onde pousou — trocar de canto não pode custar
		// legibilidade, que é o que a nota pesa mais.
		expect(r.tratamento).toBe('direto');
	});

	it('empate técnico mantém o canto do Diretor (não troca por 0,01)', async () => {
		// Arte chapada: os quatro cantos dão exatamente a mesma nota.
		const arte = await sharp({
			create: { width: 800, height: 800, channels: 3, background: '#8a8f94' },
		})
			.png()
			.toBuffer();
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: { canto_da_assinatura: 'superior_esquerdo' },
		});
		expect(r.canto).toBe('superior_esquerdo');
		expect(r.canto_origem).toBe('campo');
	});

	it('logo em `data:` URL entra sem ir à rede', async () => {
		const arte = await arteComCantoCalmo('inferior_direito');
		const png = await logoPretoTransparente();
		const r = await rodar({
			image: arte,
			logo: `data:image/png;base64,${png.toString('base64')}`,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
	});

	it('URL fora da allowlist da CDN não derruba o run — só não assina', async () => {
		// `logo_url` é dado que o ALUNO escreve: `baixarImagemRemota` recusa host
		// de fora (SSRF) lançando `ToolEngineError`. Aqui a arte já foi paga, então
		// o erro tem que virar "arte sem assinatura", nunca um 400 no meio do run.
		const arte = await arteComCantoCalmo('inferior_direito');
		const r = await rodar({
			image: arte,
			logo: 'https://169.254.169.254/latest/meta-data/',
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(false);
		expect(r.png.equals(arte)).toBe(true);
	});

	it('`nenhum` do Diretor é obedecido — a arte sai sem assinatura', async () => {
		const arte = await arteComCantoCalmo('inferior_direito');
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: { canto_da_assinatura: 'nenhum' },
		});
		expect(r.logo_aplicado).toBe(false);
		expect(r.canto).toBe('nenhum');
		expect(r.png.equals(arte)).toBe(true);
	});

	it('SEM LOGO não é erro: a arte volta inteira, com motivo para a tela', async () => {
		const arte = await arteComCantoCalmo('inferior_direito');
		for (const logo of [undefined, null, '', '   ', 'não-é-url']) {
			const r = await rodar({ image: arte, logo });
			expect(r.logo_aplicado).toBe(false);
			expect(r.motivo.length).toBeGreaterThan(10);
			expect(r.png.equals(arte)).toBe(true);
		}
	});
});

describe('image.brandmark — os arquivos que o aluno realmente sobe', () => {
	it('LOGO MAIOR QUE A ARTE cabe na caixa e não vaza pela borda', async () => {
		const arte = await arteComCantoCalmo('inferior_direito', 300);
		const gigante = await logoPretoTransparente(2400);
		const r = await rodar({
			image: arte,
			logo: gigante,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
		// A arte mantém a dimensão original (o logo não a esticou).
		const meta = await sharp(r.png).metadata();
		expect(meta.width).toBe(300);
		expect(meta.height).toBe(300);
		// E a mudança cabe dentro de uma caixa de ~15% do lado + folga.
		const m = await ondeMudou(arte, r.png);
		expect(m.n).toBeLessThan(300 * 300 * 0.1);
	});

	it('arte pequena demais para o logo ficar legível: não cola', async () => {
		const arte = await arteComCantoCalmo('inferior_direito', 100);
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(false);
		expect(r.motivo).toContain('pequena demais');
	});

	it('LOGO SEM TRANSPARÊNCIA (JPG achatado): o fundo liso é recortado', async () => {
		// Logo preto num quadrado branco OPACO — o que sai de um "salvar como JPG".
		const lado = 256;
		const d = Buffer.alloc(lado * lado * 3, 255);
		for (let y = 80; y < lado - 80; y++) {
			for (let x = 40; x < lado - 40; x++) {
				const p = (y * lado + x) * 3;
				d[p] = 0;
				d[p + 1] = 0;
				d[p + 2] = 0;
			}
		}
		const logo = await sharp(d, {
			raw: { width: lado, height: lado, channels: 3 },
		})
			.jpeg()
			.toBuffer();

		const arte = await arteComCantoCalmo('inferior_direito');
		const r = await rodar({
			image: arte,
			logo,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
		expect(r.tratamento).toBe('fundo_removido');
	});

	it('LOGO ESCURO SOBRE FUNDO ESCURO não pode sumir', async () => {
		// Arte inteira quase preta e chapada: os 4 cantos são "limpos", e um logo
		// preto colado ali seria invisível. É o caso que custa a ida ao servidor
		// e não entrega nada.
		const arte = await sharp({
			create: { width: 800, height: 800, channels: 3, background: '#141414' },
		})
			.png()
			.toBuffer();
		const logo = await logoMonocromatico([10, 10, 10]);

		const r = await rodar({
			image: arte,
			logo,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
		// Tinta única → inverter é a correção honesta (não inventa cor).
		expect(r.tratamento).toBe('invertido');

		// E o teste que importa: o logo é VISÍVEL contra o fundo.
		const m = await ondeMudou(arte, r.png);
		expect(m.n).toBeGreaterThan(400);
		// `.stats()` do sharp IGNORA o `.extract()` encadeado (ver `estatDaRegiao`
		// no bloco) — medir o recorte exige extrair os bytes de verdade.
		const { data } = await sharp(r.png)
			.extract({ left: 660, top: 660, width: 140, height: 140 })
			.raw()
			.toBuffer({ resolveWithObject: true });
		let claros = 0;
		for (let i = 0; i < data.length; i += 3) if (data[i] > 200) claros++;
		expect(claros).toBeGreaterThan(500);
	});

	/**
	 * ESTE TESTE TROCOU DE VEREDICTO, e é o coração da queixa do dono.
	 *
	 * Ele afirmava que logo colorido sobre fundo de mesma LUMINÂNCIA ganhava
	 * placa. Ganhava mesmo — e era isso o "fundo na logo". A luminância média não
	 * enxerga cor: primária saturada sobre cinza dessaturado se lê perfeitamente,
	 * e tapar era destruir uma assinatura que já estava boa.
	 */
	it('logo COLORIDO sobre cinza de mesma luminância entra DIRETO (cor não é luma)', async () => {
		const arte = await sharp({
			create: { width: 800, height: 800, channels: 3, background: '#4a4a4a' },
		})
			.png()
			.toBuffer();
		// Cores diferentes, todas com luminância perto de 74 (o tom do fundo).
		const logo = await logoQueSoSeLePorCor();
		const r = await rodar({
			image: arte,
			logo,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
		expect(r.tratamento).toBe('direto');
		expect(await fracaoLegivel(arte, logo, r)).toBeGreaterThan(0.95);
		// Nenhuma pastilha: o fundo cinza não tem branco nem preto absolutos, e o
		// logo também não — se aparecer área chapada, veio de camada nossa.
		expect(await pixelsChapadosAbsolutos(r.png)).toBe(0);
	});

	it('logo na COR DA PRÓPRIA MARCA sobre fundo da mesma cor: halo, nunca placa', async () => {
		// O caso honesto: a arte foi pintada no vermelho da marca, e o retângulo
		// vermelho do logo some de verdade — nem luma nem cor o separam.
		const arte = await sharp({
			create: { width: 800, height: 800, channels: 3, background: '#E11D1D' },
		})
			.png()
			.toBuffer();
		const logo = await logoQueSoSeLePorCor();
		expect(
			await fracaoLegivel(arte, logo, {
				canto: 'inferior_direito',
			} as BrandmarkResult),
		).toBeLessThan(0.85);

		const r = await rodar({
			image: arte,
			logo,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
		expect(r.tratamento).toBe('halo');

		// O halo é SUAVE: nada de branco absoluto (a placa era 255 em todo pixel),
		// e o resgate é local — menos de 3% do quadro muda.
		expect(await pixelsChapadosAbsolutos(r.png)).toBe(0);
		const m = await ondeMudou(arte, r.png);
		expect(m.n).toBeLessThan(800 * 800 * 0.03);
		// E funciona: o miolo do retângulo vermelho do logo agora tem um vizinho
		// claro (o halo) — mede-se a diferença máxima de luma dentro da caixa.
		const { data } = await sharp(r.png)
			.extract({ left: 660, top: 660, width: 140, height: 140 })
			.raw()
			.toBuffer({ resolveWithObject: true });
		let claro = 0;
		for (let i = 0; i < data.length; i += 3) if (data[i + 1] > 120) claro++;
		expect(claro).toBeGreaterThan(300);
	});

	it('halo com `margin: 0` (logo colado na borda) não derruba o run', async () => {
		// O halo transborda a caixa do logo, e o `composite` do sharp LANÇA com
		// offset negativo. Com folga zero o transbordo cai para fora da arte — se
		// a camada não fosse aparada antes, seria uma exceção no meio de um run
		// já pago, que é exatamente o que a regra de ouro proíbe.
		const arte = await sharp({
			create: { width: 600, height: 600, channels: 3, background: '#E11D1D' },
		})
			.png()
			.toBuffer();
		const r = await rodar({
			image: arte,
			logo: await logoQueSoSeLePorCor(),
			direcao_arte: { canto_da_assinatura: 'superior_esquerdo' },
			margin: 0,
		});
		expect(r.logo_aplicado).toBe(true);
		expect(r.tratamento).toBe('halo');
		expect((await sharp(r.png).metadata()).width).toBe(600);
	});

	it('A PLACA NÃO EXISTE MAIS: nenhum caso difícil produz pastilha', async () => {
		const fundos = ['#141414', '#4a4a4a', '#E11D1D', '#1D3FE1', '#f7f7f5'];
		const logos = [
			await logoQueSoSeLePorCor(),
			await logoMonocromatico([10, 10, 10]),
			await logoMonocromatico([246, 246, 242]),
		];
		for (const bg of fundos) {
			const arte = await sharp({
				create: { width: 600, height: 600, channels: 3, background: bg },
			})
				.png()
				.toBuffer();
			for (const logo of logos) {
				for (const canto of ['superior_direito', 'inferior_esquerdo']) {
					const r = await rodar({
						image: arte,
						logo,
						direcao_arte: { canto_da_assinatura: canto },
					});
					expect(r.tratamento).not.toContain('placa');
				}
			}
		}
	});

	it('LOCKUP DEITADO 5:1 ganha altura de letra, não uma faixa de dois pixels', async () => {
		// 9 em cada 10 logos de oficina são um lockup horizontal. Dimensionar pelo
		// QUADRADO da `scale` daria 72×14 num 800 — ilegível. O teto do lado longo
		// é o que devolve altura à letra.
		const w = 1000;
		const h = 200;
		const d = Buffer.alloc(w * h * 4);
		for (let y = 40; y < h - 40; y++) {
			for (let x = 20; x < w - 20; x++) {
				const p = (y * w + x) * 4;
				d[p + 3] = 255;
			}
		}
		const logo = await sharp(d, { raw: { width: w, height: h, channels: 4 } })
			.png()
			.toBuffer();

		const arte = await arteComCantoCalmo('inferior_direito');
		const r = await rodar({
			image: arte,
			logo,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
		});
		expect(r.logo_aplicado).toBe(true);
		// 800 × 0,20 = 160 de largura → 32 de altura de caixa, e a tinta ocupa 24
		// deles. Com a régua do quadrado seriam 14 e 11.
		const m = await ondeMudou(arte, r.png);
		expect(m.n).toBeGreaterThan(2000);
	});
});

/* ───────────────────── o caminho `gravar` (arte de traço) ───────────────────── */

describe('image.brandmark — arte de traço continua cortável', () => {
	it('a arte de partida é bitonal de verdade (a premissa do teste)', async () => {
		const p = await perfilDeBytes(await arteDeTraco(800));
		expect(p.coloridos).toBe(0);
		expect(p.intermediarios).toBe(0);
		expect(p.niveis).toBe(2);
	});

	it('LINE ART: logo entra como tinta preta e a saída segue 2 níveis', async () => {
		const arte = await arteDeTraco(800);
		const r = await rodar({
			image: arte,
			logo: await logoPretoTransparente(),
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
			line_art: true,
		});
		expect(r.logo_aplicado).toBe(true);
		expect(r.tratamento).toBe('tinta_preta');

		const p = await perfilDeBytes(r.png);
		expect(p.coloridos).toBe(0); // nada de cor: a máquina corta
		expect(p.intermediarios).toBe(0); // nada de cinza de anti-aliasing
		expect(p.niveis).toBe(2);

		// Sem canal alfa: arquivo de corte não usa alfa, e um alfa herdado do
		// composite passaria despercebido até a máquina.
		expect((await sharp(r.png).metadata()).hasAlpha).toBe(false);

		// E o logo de fato acrescentou tinta (não foi um no-op silencioso).
		const m = await ondeMudou(arte, r.png);
		expect(m.n).toBeGreaterThan(300);
	});

	it('logo COLORIDO em line art: recusa e DIZ, em vez de virar mancha', async () => {
		const arte = await arteDeTraco(800);
		const logo = await logoQueSoSeLePorCor();

		// A medição que decide, antes de colar: quase toda fronteira de cor some.
		const laudo = laudoLineArt(await loadRaster(logo));
		expect(laudo.fronteiras).toBeGreaterThan(24);
		expect(laudo.perdidas / laudo.fronteiras).toBeGreaterThan(0.5);

		const r = await rodar({
			image: arte,
			logo,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
			line_art: true,
		});
		expect(r.logo_aplicado).toBe(false);
		expect(r.tratamento).toBe('recusado_cor');
		expect(r.motivo).toContain('mancha');
		expect(r.png.equals(arte)).toBe(true); // a peça saiu intacta
	});

	it('logo claro demais some no limiar: recusa em vez de entregar vazio', async () => {
		const arte = await arteDeTraco(800);
		const r = await rodar({
			image: arte,
			logo: await logoMonocromatico([248, 248, 248]),
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
			line_art: true,
		});
		expect(r.logo_aplicado).toBe(false);
		expect(r.tratamento).toBe('recusado_claro');
		expect(r.png.equals(arte)).toBe(true);
	});

	it('logo chapado (bloco cheio) vira queima longa: recusa', async () => {
		const lado = 256;
		const d = Buffer.alloc(lado * lado * 4);
		for (let i = 0; i < lado * lado; i++) d[i * 4 + 3] = 255; // preto 100% opaco
		const logo = await sharp(d, {
			raw: { width: lado, height: lado, channels: 4 },
		})
			.png()
			.toBuffer();

		const r = await rodar({
			image: await arteDeTraco(800),
			logo,
			direcao_arte: { canto_da_assinatura: 'inferior_direito' },
			line_art: true,
		});
		expect(r.logo_aplicado).toBe(false);
		expect(r.tratamento).toBe('recusado_chapado');
	});

	it('laudoLineArt não vê fronteira nenhuma num logo de traço', async () => {
		const laudo = laudoLineArt(await loadRaster(await logoPretoTransparente()));
		expect(laudo.fronteiras).toBe(0);
		expect(laudo.tinta).toBeGreaterThan(0.02);
		expect(laudo.tinta).toBeLessThan(0.6);
	});
});

/* ─────────────── o contrato entre o DADO (roster) e o CÓDIGO ─────────────── */

describe('roster do Ateliê — o campo que o bloco lê', () => {
	const roster = readFileSync(
		new URL('../scripts/seed-agentes-arte.ts', import.meta.url),
		'utf8',
	);

	it('o Diretor de Arte declara `canto_da_assinatura` na saída', () => {
		// Sem isto no template do `saida`, o modelo simplesmente não devolve o
		// campo — e o bloco cai para a prosa em 100% dos runs, calado.
		expect(roster).toContain('"canto_da_assinatura":""');
		// E a prosa CONTINUA existindo: é o que o gerador de imagem lê e o que o
		// cartão do Diretor mostra ao aluno.
		expect(roster).toContain('"area_da_assinatura":""');
	});

	it('as cinco palavras que o roster ensina são as cinco que o bloco entende', () => {
		const instrucao = roster.match(
			/usando EXATAMENTE uma destas cinco palavras e nada mais: ([^.]+)\./,
		);
		expect(instrucao).not.toBeNull();
		const palavras = (instrucao?.[1] ?? '').split(',').map((s) => s.trim());
		expect(palavras).toHaveLength(5);
		for (const p of palavras) expect(lerCanto(p)).toBe(p);
	});
});

describe('image.brandmark — contrato do registry', () => {
	it('está registrado com o id que a definition vai referenciar', async () => {
		const { blockRegistry, registerCoreBlocks } = await import(
			'@/tool-blocks/index.js'
		);
		registerCoreBlocks();
		expect(blockRegistry.has('image.brandmark')).toBe(true);
	});
});
