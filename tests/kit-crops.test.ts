import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imageKitCropsBlock } from '@/tool-blocks/blocks/kit.js';
import {
	avaliarExtensao,
	avaliarRecorte,
	extensaoCentrada,
	KIT_FORMATOS,
	LADO_MINIMO,
	mapearConteudo,
	medirBordas,
	pareceTraco,
	recorteCentrado,
} from '@/tool-blocks/lib/enquadramento.js';
import type { BlockRunContext } from '@/tool-blocks/types.js';

/**
 * O kit não fala com rede nenhuma — é sharp puro sobre um Buffer. Então aqui
 * NÃO há dublê: as imagens são desenhadas pixel a pixel, o bloco roda de
 * verdade, e a conferência é feita nos BYTES da saída.
 *
 * As situações que decidem se este bloco presta:
 *   1. o recorte que PRESERVA  → sai, e sai byte-idêntico ao extract;
 *   2. o recorte que RECUSA    → não sai, e a tela recebe o motivo;
 *   3. o 9:16 a partir de 1:1  → o mais violento (joga fora 43,8% da largura);
 *   4. "todos os tamanhos"     → o que o recorte recusa, a MOLDURA entrega — e
 *      só quando a borda aguenta virar faixa.
 */

const ctx = { customerId: 'teste' } as BlockRunContext;

/** Fundo liso, para nada além do que se desenha contar como conteúdo. */
function tela(w: number, h: number, cor = '#f2efe9') {
	return sharp({
		create: { width: w, height: h, channels: 3, background: cor },
	});
}

/** Um retângulo escuro chapado — o "objeto" que o portão tem de enxergar. */
function bloco(w: number, h: number, cor = '#101010'): Promise<Buffer> {
	return sharp({
		create: { width: w, height: h, channels: 3, background: cor },
	})
		.png()
		.toBuffer();
}

async function arteCom(
	lado: number,
	pecas: { buf: Buffer; left: number; top: number }[],
): Promise<Buffer> {
	return tela(lado, lado)
		.composite(pecas.map((p) => ({ input: p.buf, left: p.left, top: p.top })))
		.png()
		.toBuffer();
}

const rodar = async (
	image: Buffer,
	formats?: string[],
	extra: Record<string, unknown> = {},
) =>
	(await imageKitCropsBlock.run(
		ctx,
		imageKitCropsBlock.paramsSchema.parse(
			formats ? { image, formats, ...extra } : { image, ...extra },
		),
	)) as {
		/** A arte principal, ASSINADA — é o que o `output.save_gallery` grava. */
		png: Buffer;
		pngBase64: string;
		logo_aplicado: boolean;
		logo_motivo: string;
		pecas: {
			formato: string;
			largura: number;
			altura: number;
			pngBase64: string;
			recorte: { left: number; top: number; width: number; height: number };
			/** `principal` | `recorte` | `extensao` — COMO a peça foi feita. */
			origem_da_peca: string;
			/** Só existe em peça estendida: quanta faixa nova entrou de cada lado. */
			extensao?: { left: number; top: number; right: number; bottom: number };
			e_a_principal: boolean;
			logo_aplicado: boolean;
			logo_motivo: string;
		}[];
		recusados: { formato: string; motivo: string }[];
		total: number;
		resumo: string;
		origem: { largura: number; altura: number };
	};

const pega = (r: Awaited<ReturnType<typeof rodar>>, f: string) =>
	r.pecas.find((p) => p.formato === f);

/* ─────────────────────── a geometria ─────────────────────── */

describe('recorteCentrado', () => {
	it('devolve a maior área centrada na proporção pedida', () => {
		// 9:16 de um quadrado: 576 de largura, altura cheia, sobras iguais.
		expect(recorteCentrado(1024, 1024, 9 / 16)).toEqual({
			left: 224,
			top: 0,
			width: 576,
			height: 1024,
		});
		// 16:9 do mesmo quadrado — o espelho do caso acima.
		expect(recorteCentrado(1024, 1024, 16 / 9)).toEqual({
			left: 0,
			top: 224,
			width: 1024,
			height: 576,
		});
	});

	it('no formato da própria origem não corta nada', () => {
		const r = recorteCentrado(1024, 1024, 1);
		expect(r).toEqual({ left: 0, top: 0, width: 1024, height: 1024 });
	});

	/**
	 * A conta que decidiu gerar QUADRADO e não 4:3. O 4:3 tem mais área total e
	 * mesmo assim é o pior ponto de partida — se alguém trocar isso um dia, este
	 * teste diz por que não.
	 */
	it('derivar 9:16 de 1:1 guarda mais quadro do que derivar de 4:3', () => {
		const de11 = recorteCentrado(1024, 1024, 9 / 16);
		const de43 = recorteCentrado(1536, 1152, 9 / 16);
		const guarda11 = (de11.width * de11.height) / (1024 * 1024);
		const guarda43 = (de43.width * de43.height) / (1536 * 1152);
		expect(guarda11).toBeCloseTo(0.563, 2);
		expect(guarda43).toBeCloseTo(0.422, 2);
		expect(guarda11).toBeGreaterThan(guarda43);
	});
});

/* ─────────────────────── 1. o recorte que PRESERVA ─────────────────────── */

describe('recorte que preserva', () => {
	it('entrega, e o PNG é byte-idêntico ao recorte da origem', async () => {
		// Objeto pequeno, no miolo: sobrevive a qualquer corte centrado.
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const r = await rodar(arte);

		expect(r.recusados).toEqual([]);
		expect(r.total).toBe(4);

		for (const peca of r.pecas) {
			const esperado = await sharp(arte).extract(peca.recorte).png().toBuffer();
			const veio = Buffer.from(peca.pngBase64.split(',')[1], 'base64');
			// Compara o RASTER, não o arquivo: dois PNGs do mesmo pixel podem
			// diferir em bytes de compressão sem diferir em imagem.
			//
			// `Buffer.equals` e não `toEqual`: o matcher do vitest percorre os 3
			// milhões de elementos um a um e sozinho levava 20 s neste teste.
			expect(
				(await sharp(veio).raw().toBuffer()).equals(
					await sharp(esperado).raw().toBuffer(),
				),
			).toBe(true);
			const meta = await sharp(veio).metadata();
			expect([meta.width, meta.height]).toEqual([peca.largura, peca.altura]);
		}
	});

	it('cada peça sai na proporção que o formato promete', async () => {
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const r = await rodar(arte);
		for (const peca of r.pecas) {
			const alvo =
				KIT_FORMATOS[peca.formato as keyof typeof KIT_FORMATOS].proporcao;
			expect(peca.largura / peca.altura).toBeCloseTo(alvo, 2);
		}
	});

	it('o formato da própria origem sai marcado como a peça principal', async () => {
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const feed = pega(await rodar(arte), 'feed_1x1');
		expect(feed?.e_a_principal).toBe(true);
		expect(feed?.largura).toBe(1024);
	});

	/**
	 * NUNCA AMPLIA. 576×1024 é o que existe depois do corte; devolver 864×1536
	 * seria inventar pixel e mentir sobre a resolução da peça.
	 */
	it('não amplia o recorte para o tamanho de catálogo do formato', async () => {
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const story = pega(await rodar(arte), 'story_9x16');
		expect([story?.largura, story?.altura]).toEqual([576, 1024]);
	});
});

/* ─────────────────────── 2. o recorte que RECUSA ─────────────────────── */

describe('recorte que recusa', () => {
	it('recusa quando a faixa de texto atravessa o quadro de ponta a ponta', async () => {
		// A cara do defeito real: título de sobreposição encostando nas bordas.
		// Ele sobrevive ao 16:9 (que só corta em cima e embaixo) e morre no 9:16.
		const arte = await arteCom(1024, [
			{ buf: await bloco(940, 150), left: 42, top: 60 },
			{ buf: await bloco(300, 300), left: 362, top: 500 },
		]);
		const r = await rodar(arte);

		expect(pega(r, 'story_9x16')).toBeUndefined();
		const recusa = r.recusados.find((x) => x.formato === 'story_9x16');
		expect(recusa?.motivo).toMatch(/pela metade/i);
		// A recusa tem de chegar à tela em português, sem jargão de pixel.
		expect(recusa?.motivo).not.toMatch(/\d/);
	});

	it('recusa também quando o elemento inteiro cairia FORA do recorte', async () => {
		// Não é só "cortar ao meio": um título que some por completo entrega uma
		// peça muda, e isso é a mesma perda.
		const arte = await arteCom(1024, [
			{ buf: await bloco(260, 200), left: 382, top: 20 },
			{ buf: await bloco(300, 300), left: 362, top: 500 },
		]);
		const r = await rodar(arte);
		expect(pega(r, 'capa_16x9')).toBeUndefined();
		expect(r.recusados.some((x) => x.formato === 'capa_16x9')).toBe(true);
	});

	it('a recusa nunca derruba a peça principal', async () => {
		const arte = await arteCom(1024, [
			{ buf: await bloco(940, 150), left: 42, top: 60 },
			{ buf: await bloco(940, 150), left: 42, top: 800 },
		]);
		const r = await rodar(arte);
		expect(pega(r, 'feed_1x1')?.e_a_principal).toBe(true);
		expect(r.recusados.length).toBeGreaterThan(0);
		expect(r.resumo).toMatch(/ficaram de fora|ficou de fora/);
	});

	it('não recusa por causa do fundo, que já entrava cortado', async () => {
		// A bancada que sangra pelos quatro lados NÃO é perda nova. Se o portão
		// contasse energia descartada em vez de objetos inteiros, isto reprovaria.
		const arte = await tela(1024, 1024)
			.composite([
				{ input: await bloco(1024, 420, '#8b5a2b'), left: 0, top: 604 },
				{ input: await bloco(240, 240), left: 392, top: 300 },
			])
			.png()
			.toBuffer();
		const r = await rodar(arte);
		expect(r.recusados).toEqual([]);
		expect(r.total).toBe(4);
	});

	it('recusa o recorte que sairia pequeno demais para publicar', async () => {
		const arte = await arteCom(400, [
			{ buf: await bloco(80, 80), left: 160, top: 160 },
		]);
		const r = await rodar(arte);
		// 9:16 de 400×400 dá 225 de largura — abaixo do lado mínimo.
		expect(pega(r, 'story_9x16')).toBeUndefined();
		expect(r.recusados.find((x) => x.formato === 'story_9x16')?.motivo).toMatch(
			/pequeno demais/i,
		);
	});
});

/* ────────────── 3. o 9:16 a partir de 1:1 — o mais violento ────────────── */

describe('o 9:16 a partir de um 1:1', () => {
	it('joga fora 43,8% da largura, e é por isso que ele é o primeiro a cair', async () => {
		const r = recorteCentrado(1024, 1024, 9 / 16);
		expect(1 - r.width / 1024).toBeCloseTo(0.4375, 4);
	});

	it('passa quando o conteúdo cabe na faixa central, reprova quando encosta', async () => {
		const centro = recorteCentrado(1024, 1024, 9 / 16); // left=224, width=576

		// Dentro da faixa por 12px de cada lado: passa.
		const cabe = await arteCom(1024, [
			{ buf: await bloco(552, 220), left: centro.left + 12, top: 400 },
		]);
		expect(pega(await rodar(cabe, ['story_9x16']), 'story_9x16')).toBeDefined();

		// O MESMO objeto, 60px mais largo para cada lado: agora a linha de corte
		// passa por dentro dele. Nada mais mudou na arte.
		const naoCabe = await arteCom(1024, [
			{ buf: await bloco(672, 220), left: centro.left - 48, top: 400 },
		]);
		const r = await rodar(naoCabe, ['story_9x16']);
		expect(pega(r, 'story_9x16')).toBeUndefined();
		expect(r.total).toBe(0);
		expect(r.resumo).toMatch(/Nenhum formato extra/);
	});

	it('o corte cai exatamente onde a aritmética diz — conferido no pixel', async () => {
		// Uma listra vertical clara num quadro escuro: o recorte 9:16 tem de
		// começar na coluna 224 da origem. Verificado lendo o pixel, não a caixa.
		const arte = await tela(1024, 1024, '#101010')
			.composite([
				{ input: await bloco(40, 1024, '#ffffff'), left: 224, top: 0 },
			])
			.png()
			.toBuffer();
		const story = pega(await rodar(arte, ['story_9x16']), 'story_9x16');
		const raw = await sharp(
			Buffer.from(
				(story as { pngBase64: string }).pngBase64.split(',')[1],
				'base64',
			),
		)
			.greyscale()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const linha = 512 * raw.info.width;
		expect(raw.data[linha + 0]).toBeGreaterThan(200); // 1ª coluna = a listra
		expect(raw.data[linha + 39]).toBeGreaterThan(200); // última da listra
		expect(raw.data[linha + 45]).toBeLessThan(60); // já é fundo
	});
});

/* ══════════════ 4. "TODOS OS TAMANHOS" — a moldura ══════════════ */

/**
 * O pedido do dono é literal: "tem q ter uma opcao de todos tamanhos e ele de a
 * arte em todas dimensoes pra pessoa". Com o recorte SOZINHO o kit entregava
 * 1 de 4 — e entregava certo, porque derivar 9:16 de um 1:1 joga fora 43,8% da
 * largura e corta o produto ao meio.
 *
 * A saída não é afrouxar o portão do recorte: é a operação INVERSA. Crescer o
 * quadro em vez de encolher a arte. O que estes testes travam é a fronteira —
 * quando a moldura pode existir, quando ela NÃO pode, e o que continua sendo
 * recorte porque recorte é melhor.
 */
describe('todos os tamanhos: estender em vez de cortar', () => {
	/** Os bytes de uma peça, em cinza, para conferir pixel a pixel. */
	async function cinza(png: Buffer) {
		return sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
	}

	const bytes = (b64: string) => Buffer.from(b64.split(',')[1] ?? '', 'base64');

	/**
	 * Uma barra DEITADA que atravessa quase todo o quadro: o 9:16 (que guarda só
	 * a faixa central x 224…800) a corta ao meio, e as quatro bordas continuam
	 * lisas — é exatamente o caso em que o recorte tem de recusar e a moldura tem
	 * de entregar.
	 */
	async function arteDeitada(lado = 1024): Promise<Buffer> {
		return arteCom(lado, [{ buf: await bloco(940, 150), left: 42, top: 437 }]);
	}

	/** A mesma coisa EM PÉ — aqui quem não sobrevive ao recorte é o 16:9. */
	async function arteEmPe(lado = 1024): Promise<Buffer> {
		return arteCom(lado, [{ buf: await bloco(150, 940), left: 437, top: 42 }]);
	}

	it('a geometria da moldura: nada é descartado, a arte fica centrada', () => {
		// 1:1 → 9:16 cresce só na vertical; 1024/(9/16) = 1820,4 → 1820.
		expect(extensaoCentrada(1024, 1024, 9 / 16)).toEqual({
			left: 0,
			top: 398,
			right: 0,
			bottom: 398,
			width: 1024,
			height: 1820,
		});
		// O espelho: 16:9 cresce só na horizontal.
		expect(extensaoCentrada(1024, 1024, 16 / 9)).toEqual({
			left: 398,
			top: 0,
			right: 398,
			bottom: 0,
			width: 1820,
			height: 1024,
		});
		// Já está na proporção: faixa zero dos quatro lados.
		expect(extensaoCentrada(1024, 1024, 1)).toEqual({
			left: 0,
			top: 0,
			right: 0,
			bottom: 0,
			width: 1024,
			height: 1024,
		});
	});

	it('o 9:16 que o recorte recusa sai pela moldura, com a arte INTEIRA', async () => {
		const arte = await arteDeitada();

		// Sem autorização, o comportamento é o de sempre: recusa.
		const semMoldura = await rodar(arte, ['story_9x16']);
		expect(semMoldura.total).toBe(0);

		const r = await rodar(arte, ['story_9x16'], { estender: true });
		const story = pega(r, 'story_9x16');
		expect(story?.origem_da_peca).toBe('extensao');
		expect([story?.largura, story?.altura]).toEqual([1024, 1820]);
		expect(story?.extensao).toEqual({
			left: 0,
			top: 398,
			right: 0,
			bottom: 398,
		});
		// A extensão não descarta um pixel: o "recorte" declarado é a origem toda.
		expect(story?.recorte).toEqual({
			left: 0,
			top: 0,
			width: 1024,
			height: 1024,
		});
		expect(story?.largura / (story?.altura ?? 1)).toBeCloseTo(9 / 16, 3);

		/**
		 * A PROVA NO PIXEL, e ela é a razão de o bloco existir: a barra que o
		 * recorte cortaria ao meio tem de chegar inteira na peça estendida, dos
		 * dois extremos. Se algum dia alguém trocar a moldura por um recorte com
		 * outro nome, é aqui que quebra.
		 */
		const peca = await cinza(bytes(story?.pngBase64 ?? ''));
		const original = await cinza(arte);
		const linhaDaBarra = (398 + 512) * peca.info.width;
		expect(peca.data[linhaDaBarra + 42]).toBeLessThan(60); // início da barra
		expect(peca.data[linhaDaBarra + 981]).toBeLessThan(60); // e o fim dela
		expect(peca.data[linhaDaBarra + 20]).toBeGreaterThan(200); // fundo à esquerda

		// A arte entra intacta e centrada: a linha 398 da peça É a linha 0 da arte.
		for (const x of [0, 300, 700, 1023]) {
			expect(peca.data[398 * peca.info.width + x]).toBe(original.data[x]);
		}
	});

	it('o 16:9 idem, no eixo oposto — a moldura cresce onde falta', async () => {
		const arte = await arteEmPe();
		const r = await rodar(arte, ['capa_16x9'], { estender: true });
		const capa = pega(r, 'capa_16x9');
		expect(capa?.origem_da_peca).toBe('extensao');
		expect([capa?.largura, capa?.altura]).toEqual([1820, 1024]);
		expect(capa?.extensao).toEqual({
			left: 398,
			top: 0,
			right: 398,
			bottom: 0,
		});

		// A barra em pé chega inteira: topo e base dela existem na peça.
		const peca = await cinza(bytes(capa?.pngBase64 ?? ''));
		const col = 398 + 512;
		expect(peca.data[42 * peca.info.width + col]).toBeLessThan(60);
		expect(peca.data[981 * peca.info.width + col]).toBeLessThan(60);
	});

	/**
	 * A FAIXA É CÓPIA DA LINHA EXTREMA, não invenção livre — `extendWith: 'copy'`.
	 *
	 * ⚠ `extendWith: 'mirror'` foi testado e está ERRADO aqui: ele espelha a
	 * imagem INTEIRA e o produto reaparece de cabeça para baixo no rodapé da
	 * peça. Este teste é o que impede a troca: com `mirror`, a linha 0 da peça
	 * seria a linha 397 da arte (o espelho), e não a linha 0.
	 */
	it('a faixa nova é a linha da beirada repetida, e nada mais', async () => {
		const arte = await arteDeitada();
		const story = pega(
			await rodar(arte, ['story_9x16'], { estender: true }),
			'story_9x16',
		);
		const peca = await cinza(bytes(story?.pngBase64 ?? ''));
		const W = peca.info.width;
		const linha = (y: number) => peca.data.subarray(y * W, (y + 1) * W);

		// Toda linha da faixa de cima é idêntica à primeira linha da arte…
		const beirada = linha(398);
		for (const y of [0, 100, 397]) {
			expect(linha(y).equals(beirada)).toBe(true);
		}
		// …e a de baixo, à última.
		const fundo = linha(398 + 1023);
		for (const y of [398 + 1024, 1700, 1819]) {
			expect(linha(y).equals(fundo)).toBe(true);
		}
	});

	it('borda AGITADA continua recusada — faixa com rastro não é progresso', async () => {
		/**
		 * Listras de alto contraste encostadas em cima e embaixo. Esticar isso
		 * desenha listras até o fim da peça; medido nas artes reais, a aspereza que
		 * produziu rastro visível ficou em 4,30–5,63 e o pior caso sintético (este)
		 * mede ~14,65, contra 0,00–2,71 das bordas que saíram limpas.
		 */
		const listras: { buf: Buffer; left: number; top: number }[] = [];
		for (let x = 0; x < 1024; x += 16) {
			listras.push({ buf: await bloco(8, 48, '#000000'), left: x, top: 0 });
			listras.push({ buf: await bloco(8, 48, '#000000'), left: x, top: 976 });
		}
		const arte = await tela(1024, 1024)
			.composite([
				{ input: await bloco(940, 150), left: 42, top: 437 },
				...listras.map((l) => ({ input: l.buf, left: l.left, top: l.top })),
			])
			.png()
			.toBuffer();

		const r = await rodar(arte, ['story_9x16'], { estender: true });
		expect(pega(r, 'story_9x16')).toBeUndefined();
		const recusa = r.recusados.find((x) => x.formato === 'story_9x16');
		expect(recusa?.motivo).toMatch(/rastro/i);
		// A recusa chega à tela em português, sem número de pixel.
		expect(recusa?.motivo).not.toMatch(/\d/);

		// E a medição que sustenta a recusa, isolada: só quem CRESCE é julgado.
		const bordas = await medirBordas(arte);
		expect(bordas.top.aspereza).toBeGreaterThan(3);
		expect(bordas.left.aspereza).toBeLessThan(3);
		const so9x16 = extensaoCentrada(1024, 1024, 9 / 16);
		expect(avaliarExtensao(bordas, so9x16).entrega).toBe(false);
		// A mesma arte, crescendo pelas LATERAIS (lisas), passaria — a lateral
		// agitada de uma arte não condena um formato que não usa aquela borda.
		const so16x9 = extensaoCentrada(1024, 1024, 16 / 9);
		expect(avaliarExtensao(bordas, so16x9).entrega).toBe(true);
	});

	/**
	 * A MESMA BORDA, DUAS RESPOSTAS — a regra que o teto fixo não tinha.
	 *
	 * Medido nas artes reais, com as imagens olhadas: a arte de cena do copo
	 * (aspereza 3,64 em cima e 5,78 embaixo) sai LIMPA no 4:5, onde a faixa é 20%
	 * do quadro, e vira pente no 9:16, onde ela é 44%. `copy` repete a linha
	 * extrema — o defeito não é a linha, é por quantos pixels ela é arrastada.
	 *
	 * Com o teto fixo em 3, aquela arte entregava 1 de 4: o 4:5 bom era recusado
	 * junto com o 9:16 ruim.
	 */
	it('a mesma borda passa na faixa pequena e reprova na faixa grande', () => {
		const bordaDeCena = { aspereza: 5, degrade: 1 };
		const bordas = {
			top: bordaDeCena,
			bottom: bordaDeCena,
			left: bordaDeCena,
			right: bordaDeCena,
		};
		// 4:5 a partir de 1:1 → faixa de 20% do quadro final: passa.
		expect(
			avaliarExtensao(bordas, extensaoCentrada(1024, 1024, 4 / 5)).entrega,
		).toBe(true);
		// 9:16 a partir de 1:1 → 44%: a mesma borda vira rastro, e recusa.
		expect(
			avaliarExtensao(bordas, extensaoCentrada(1024, 1024, 9 / 16)).entrega,
		).toBe(false);
		// 16:9 é o espelho do 9:16 — mesma faixa, mesmo veredito.
		expect(
			avaliarExtensao(bordas, extensaoCentrada(1024, 1024, 16 / 9)).entrega,
		).toBe(false);
	});

	it('faixa pequena NÃO compra o direito de esticar estrutura dura', () => {
		/**
		 * O teto tem teto. Acima de 8 já não se está falando de textura e sim de
		 * uma letra, uma listra ou um objeto atravessando a borda — e isso vira
		 * rastro em qualquer tamanho de faixa. A listra sintética mede 14,65.
		 */
		const bordaListrada = { aspereza: 14.65, degrade: 1 };
		const bordas = {
			top: bordaListrada,
			bottom: bordaListrada,
			left: bordaListrada,
			right: bordaListrada,
		};
		expect(
			avaliarExtensao(bordas, extensaoCentrada(1024, 1024, 4 / 5)).entrega,
		).toBe(false);
	});

	it('borda de estúdio (a maioria das artes) passa em qualquer formato', () => {
		// Medido em 6 artes reais de fundo liso: 0,00 a 2,40 nas quatro bordas.
		const lisa = { aspereza: 2.4, degrade: 1 };
		const bordas = { top: lisa, bottom: lisa, left: lisa, right: lisa };
		for (const p of [4 / 5, 9 / 16, 16 / 9]) {
			expect(
				avaliarExtensao(bordas, extensaoCentrada(1024, 1024, p)).entrega,
			).toBe(true);
		}
	});

	it('RECORTAR continua ganhando de estender quando o corte é seguro', async () => {
		/**
		 * A ordem não é gosto: todo pixel de um recorte foi composto pelo time,
		 * enquanto a faixa de uma moldura é área inventada. Com um objeto pequeno
		 * no miolo o 4:5 corta sem tocar em nada — e tem de sair como RECORTE
		 * mesmo com "todos os tamanhos" ligado.
		 */
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const r = await rodar(arte, undefined, { estender: true });
		expect(r.recusados).toEqual([]);
		expect(pega(r, 'retrato_4x5')?.origem_da_peca).toBe('recorte');
		expect(pega(r, 'story_9x16')?.origem_da_peca).toBe('recorte');
		expect(pega(r, 'feed_1x1')?.origem_da_peca).toBe('principal');
		// Nenhuma faixa inventada onde o recorte deu conta.
		expect(r.pecas.every((p) => p.extensao === undefined)).toBe(true);
	});

	it('a arte que JÁ é do formato pedido não é cortada NEM esticada', async () => {
		const arte = await arteDeitada();
		const r = await rodar(arte, ['feed_1x1'], { estender: true });
		const feed = pega(r, 'feed_1x1');
		expect(feed?.origem_da_peca).toBe('principal');
		expect(feed?.e_a_principal).toBe(true);
		expect(feed?.extensao).toBeUndefined();
		expect([feed?.largura, feed?.altura]).toEqual([1024, 1024]);
		// Mesmos pixels da entrada: sem logo, a peça principal é a arte.
		const antes = await sharp(arte).raw().toBuffer();
		const depois = await sharp(bytes(feed?.pngBase64 ?? ''))
			.raw()
			.toBuffer();
		expect(depois.equals(antes)).toBe(true);
	});

	it('com a moldura o kit fecha os quatro formatos — 4 de 4', async () => {
		const arte = await arteDeitada();
		const r = await rodar(arte, undefined, { estender: true });
		expect(r.total).toBe(4);
		expect(r.recusados).toEqual([]);
		expect(r.pecas.map((p) => p.formato).sort()).toEqual(
			[...Object.keys(KIT_FORMATOS)].sort(),
		);
		// E a tela é AVISADA de que houve faixa completada — descobrir sozinho,
		// olhando a beirada, seria pior do que ler.
		expect(r.resumo).toMatch(/bordas foram completadas/i);
		expect(r.resumo).not.toMatch(/extens/i); // sem vocabulário de máquina
	});

	it('arte pequena demais continua recusada, com moldura e tudo', async () => {
		// 300×300: a moldura não muda o lado menor, então a peça continuaria
		// pequena demais para publicar. Crescer o quadro não cria resolução.
		const arte = await arteCom(300, [
			{ buf: await bloco(280, 60), left: 10, top: 120 },
		]);
		const r = await rodar(arte, ['story_9x16'], { estender: true });
		expect(pega(r, 'story_9x16')).toBeUndefined();
		expect(r.recusados[0]?.motivo).toMatch(/pequen[oa] demais/i);
	});

	/**
	 * O REQUISITO ④ DA FASE, provado no pixel: numa peça estendida o logo NÃO
	 * pode cair na faixa inventada.
	 *
	 * O `aplicarLogo` MEDE o canto do quadro que recebe — num quadro já esticado
	 * os quatro cantos são faixa, e a assinatura iria parar em área que ninguém
	 * compôs. Por isso o bloco carimba ANTES de estender. A conferência aqui é
	 * dupla: a faixa continua sendo cópia pura da beirada (logo nenhum ali) E a
	 * tinta do logo aparece dentro da região da arte de verdade.
	 */
	it('o logo fica DENTRO da arte, nunca na faixa inventada', async () => {
		const lado = 1024;
		const caixa = Math.round(lado * 0.15);
		const margem = Math.round(lado * 0.04);
		// Barra deitada (força a moldura) + área branca reservada no canto.
		const arte = await arteCom(lado, [
			{ buf: await bloco(940, 150), left: 42, top: 437 },
			{
				buf: await bloco(caixa, caixa, '#ffffff'),
				left: lado - margem - caixa,
				top: lado - margem - caixa,
			},
		]);
		const marca = await sharp({
			create: {
				width: 200,
				height: 200,
				channels: 4,
				background: { r: 20, g: 20, b: 20, alpha: 1 },
			},
		})
			.png()
			.toBuffer();

		const r = await rodar(arte, ['story_9x16'], {
			estender: true,
			logo: marca,
		});
		const story = pega(r, 'story_9x16');
		expect(story?.origem_da_peca).toBe('extensao');
		expect(story?.logo_aplicado).toBe(true);

		const peca = await cinza(bytes(story?.pngBase64 ?? ''));
		const W = peca.info.width;
		const linha = (y: number) => peca.data.subarray(y * W, (y + 1) * W);

		// ① A faixa de baixo é cópia EXATA da última linha da arte. Se o carimbo
		//    tivesse acontecido depois de esticar, o canto inferior direito da
		//    peça (que é faixa) teria tinta e estas linhas divergiriam.
		const ultima = linha(398 + 1023);
		for (const y of [398 + 1024, 1500, 1819]) {
			expect(linha(y).equals(ultima)).toBe(true);
		}

		/**
		 * ② E a tinta EXISTE, dentro da arte. A conta é feita por faixa de linhas
		 *    em vez de por canto: qual canto o `aplicarLogo` escolheu é decisão
		 *    dele (ele MEDE), e travar o canto aqui seria travar uma decisão que
		 *    não é deste bloco. O que importa é onde a tinta NÃO pode estar.
		 */
		const escurosEntre = (y0: number, y1: number) => {
			let n = 0;
			for (let y = y0; y <= y1; y++) {
				for (let x = 0; x < W; x++) if (peca.data[y * W + x] < 100) n++;
			}
			return n;
		};
		const naArte = escurosEntre(398, 398 + lado - 1);
		const original = await cinza(arte);
		let naOriginal = 0;
		for (let i = 0; i < original.data.length; i++) {
			if (original.data[i] < 100) naOriginal++;
		}
		// Ganhou tinta, e a tinta ganha está toda dentro da arte.
		expect(naArte).toBeGreaterThan(naOriginal);

		// ③ E as duas faixas não têm UM pixel escuro — nem do logo, nem de rastro.
		expect(escurosEntre(0, 397)).toBe(0);
		expect(escurosEntre(398 + lado, peca.info.height - 1)).toBe(0);
	});

	it('`estender` não é ligado por engano: só `true`/`"true"`/1 ligam', () => {
		// `z.coerce.boolean()` seria armadilha aqui — `Boolean('false') === true`.
		const parse = (v: unknown) =>
			imageKitCropsBlock.paramsSchema.parse({
				image: Buffer.from('x'),
				estender: v,
			}).estender;
		expect(parse('false')).toBe(false);
		expect(parse('0')).toBe(false);
		expect(parse(undefined)).toBe(false);
		expect(parse('true')).toBe(true);
		expect(parse(true)).toBe(true);
		expect(parse(1)).toBe(true);
	});
});

/* ─────────────────────── arte de traço (o modo gravar) ─────────────────── */

describe('arte de traço', () => {
	/** Preto e branco puros, como o `ai.image_studio` limiariza no `vetorizavel`. */
	async function traco(): Promise<Buffer> {
		return sharp({
			create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' },
		})
			.composite([
				{ input: await bloco(300, 300, '#000000'), left: 362, top: 362 },
			])
			.png()
			.toBuffer();
	}

	it('é reconhecida como traço', async () => {
		expect(pareceTraco(await mapearConteudo(await traco()))).toBe(true);
	});

	it('uma foto NÃO é confundida com traço', async () => {
		const foto = await arteCom(1024, [
			{ buf: await bloco(300, 300, '#7a6a55'), left: 362, top: 362 },
		]);
		expect(pareceTraco(await mapearConteudo(foto))).toBe(false);
	});

	it('não é recortada, e diz por quê — mas a peça principal continua saindo', async () => {
		const r = await rodar(await traco());
		expect(pega(r, 'feed_1x1')?.e_a_principal).toBe(true);
		expect(r.recusados.length).toBe(3);
		for (const x of r.recusados) expect(x.motivo).toMatch(/traço/i);
	});
});

/* ─────────────────────── o contrato de saída ─────────────────────── */

describe('contrato de saída', () => {
	it('nenhuma PEÇA carrega Buffer — só data URL', async () => {
		/**
		 * Buffer dentro de um array vira `{"type":"Buffer","data":[…]}` no
		 * `projectOutput` e despeja megabytes de números na resposta.
		 *
		 * O `png` de fora é a EXCEÇÃO, e ela é o contrato com o próximo nó: o
		 * `output.save_gallery` sobe bytes, não data URL. Ele nunca chega ao
		 * navegador porque a allow-list de `output` da definition não o lista —
		 * o que atravessa é `pecas`, e é `pecas` que este teste protege.
		 */
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const r = await rodar(arte);
		expect(Buffer.isBuffer(r.png)).toBe(true);
		expect(JSON.stringify(r.pecas)).not.toContain('"type":"Buffer"');
		expect(JSON.stringify(r.recusados)).not.toContain('"type":"Buffer"');
		for (const p of r.pecas) {
			expect(p.pngBase64.startsWith('data:image/png;base64,')).toBe(true);
			expect('png' in p).toBe(false);
		}
	});

	it('cada peça carrega o recorte na coordenada da origem', async () => {
		// É o gancho de quem compõe o logo DEPOIS do recorte, por formato.
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const story = pega(await rodar(arte), 'story_9x16');
		expect(story?.recorte).toEqual({
			left: 224,
			top: 0,
			width: 576,
			height: 1024,
		});
	});

	it('respeita a lista de formatos pedida', async () => {
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const r = await rodar(arte, ['capa_16x9']);
		expect(r.pecas.map((p) => p.formato)).toEqual(['capa_16x9']);
	});

	it('recusa entrada sem imagem com frase de gente', () => {
		const res = imageKitCropsBlock.paramsSchema.safeParse({ image: null });
		expect(res.success).toBe(false);
		expect(JSON.stringify(res.error?.issues)).toMatch(/arte pronta/i);
	});
});

/* ─────────────────────── o portão, isolado ─────────────────────── */

describe('avaliarRecorte', () => {
	it('aprova o recorte que não corta nada', async () => {
		const mapa = await mapearConteudo(
			await arteCom(1024, [
				{ buf: await bloco(200, 200), left: 412, top: 412 },
			]),
		);
		const v = avaliarRecorte(mapa, recorteCentrado(1024, 1024, 1));
		expect(v.entrega).toBe(true);
		expect(v.objetosPartidos).toBe(0);
	});

	it('conta quantos objetos inteiros o recorte partiria', async () => {
		const mapa = await mapearConteudo(
			await arteCom(1024, [
				{ buf: await bloco(900, 120), left: 62, top: 100 },
				{ buf: await bloco(900, 120), left: 62, top: 800 },
			]),
		);
		const v = avaliarRecorte(mapa, recorteCentrado(1024, 1024, 9 / 16));
		expect(v.entrega).toBe(false);
		expect(v.objetosPartidos).toBe(2);
	});

	it('o lado mínimo é o mesmo que o bloco aplica', () => {
		expect(LADO_MINIMO).toBe(320);
	});
});

/* ═════════ a manchete que o piso de área deixava passar ═════════ */

/**
 * REGRESSÃO MEDIDA, e é a pior classe de defeito que este bloco pode ter:
 * entregar peça QUEBRADA em VERDE, com `recusados: []` e o resumo dizendo
 * "todos a partir da mesma arte".
 *
 * O caso real: a arte `placa` ("PORTA DA MATERNIDADE"). A manchete mede 1,93%
 * do quadro; o piso de área estava em 2%. Ela perdia por 3,6%, sumia da lista
 * de objetos, e aí `avaliarRecorte` aprovava os quatro cortes POR VACUIDADE —
 * o 4:5 saía "ORTA DA / ATERNIDADE" e o 9:16 saía "D A / NIDADE".
 *
 * A fixture reproduz a geometria da placa de propósito: a manchete fica À
 * ESQUERDA e VERTICALMENTE CENTRADA, então o 16:9 (que só corta em cima e
 * embaixo) a preserva inteira, enquanto o 4:5 e o 9:16 (que comem largura) a
 * decapitam. É essa SELETIVIDADE que o teste protege — baixar o piso até
 * recusar tudo seria igualmente errado, só que na direção contrária.
 */
describe('manchete logo abaixo do piso de área', () => {
	/** ~1,90% do quadro: acima do piso de 1,5 e abaixo do antigo, de 2. */
	const MANCHETE = { w: 260, h: 50 } as const;

	async function arteTipoPlaca(): Promise<Buffer> {
		return arteCom(1024, [
			// manchete encostada à esquerda, na altura do meio
			{ buf: await bloco(MANCHETE.w, MANCHETE.h), left: 60, top: 450 },
			// o produto, no centro — e DENTRO da faixa do 16:9 (y 224…800), para
			// que a única razão de recusa em jogo seja a manchete.
			{ buf: await bloco(300, 300), left: 400, top: 430 },
		]);
	}

	it('a manchete de ~1,9% do quadro É VISTA como objeto inteiro', async () => {
		const mapa = await mapearConteudo(await arteTipoPlaca());
		const quadro = mapa.w * mapa.h;
		const manchete = mapa.inteiros.find(
			(o) => o.x0 < mapa.w / 2 && o.y1 - o.y0 < 40,
		);

		// Se este expect cair, o piso subiu de novo e o defeito da placa voltou.
		expect(manchete, 'a manchete sumiu da lista de objetos').toBeDefined();
		const pct = ((manchete as { area: number }).area / quadro) * 100;
		expect(pct).toBeGreaterThan(1.5);
		expect(pct).toBeLessThan(2);
	});

	it('o 4:5 e o 9:16 são RECUSADOS, com motivo e sem número', async () => {
		const r = await rodar(await arteTipoPlaca());

		for (const f of ['retrato_4x5', 'story_9x16']) {
			expect(pega(r, f), `${f} foi entregue decapitado`).toBeUndefined();
			const recusa = r.recusados.find((x) => x.formato === f);
			expect(recusa?.motivo).toMatch(/pela metade/i);
			expect(recusa?.motivo).not.toMatch(/\d/);
		}
	});

	it('o 16:9, que preserva a manchete, CONTINUA saindo', async () => {
		// A prova de que o piso novo não virou uma recusa geral: na arte real da
		// placa o 16:9 é o único recorte derivado limpo, e ele tem de sobreviver.
		const r = await rodar(await arteTipoPlaca());
		expect(
			pega(r, 'capa_16x9'),
			'o 16:9 limpo foi recusado junto',
		).toBeDefined();
		expect(pega(r, 'capa_16x9')?.origem_da_peca).toBe('recorte');
	});

	it('o que o recorte recusa, a moldura entrega — a manchete fica inteira', async () => {
		// Com "Todos os tamanhos" ligado o aluno não perde as duas peças: elas
		// voltam por extensão, e aí NADA da arte foi cortado.
		const r = await rodar(await arteTipoPlaca(), undefined, { estender: true });
		for (const f of ['retrato_4x5', 'story_9x16']) {
			expect(pega(r, f)?.origem_da_peca).toBe('extensao');
		}
	});
});

/* ═══════════ a assinatura da marca, peça a peça ═══════════ */

/**
 * A ORDEM É O TESTE INTEIRO: recorta primeiro, carimba depois.
 *
 * Carimbar antes é uma tentação natural (um nó a menos no pipeline) e ela
 * quebra de DUAS formas ao mesmo tempo, as duas medidas aqui:
 *   ① o logo mora no canto, e o canto é a primeira coisa que o recorte come —
 *     o 4:5 o corta ao meio, o 9:16 e o 16:9 o jogam fora inteiro;
 *   ② um logo carimbado vira "objeto inteiro" para o `avaliarRecorte`, e
 *     perder um objeto inteiro é justo o que faz o portão RECUSAR. A arte
 *     passaria a reprovar os próprios recortes por causa da nossa assinatura.
 */
describe('kit + logo da marca', () => {
	/** Logo de tinta única sobre transparente — o caso bem-comportado. */
	async function logo(lado = 200): Promise<Buffer> {
		const d = Buffer.alloc(lado * lado * 4);
		for (let y = 0; y < lado; y++) {
			for (let x = 0; x < lado; x++) {
				const p = (y * lado + x) * 4;
				// Um "L" grosso: tinta em ~30% da caixa, longe dos dois pisos.
				const dentro =
					(x > lado * 0.2 && x < lado * 0.4 && y > lado * 0.2) ||
					(y > lado * 0.7 && y < lado * 0.85 && x > lado * 0.2);
				d[p] = 20;
				d[p + 1] = 20;
				d[p + 2] = 20;
				d[p + 3] = dentro ? 255 : 0;
			}
		}
		return sharp(d, { raw: { width: lado, height: lado, channels: 4 } })
			.png()
			.toBuffer();
	}

	/** Arte de foto com área branca reservada no canto inferior direito. */
	async function arteComReserva(lado = 1024): Promise<Buffer> {
		const caixa = Math.round(lado * 0.15);
		const margem = Math.round(lado * 0.04);
		return arteCom(lado, [
			// O "produto", no miolo — é ele que o portão precisa ver inteiro.
			{
				buf: await bloco(300, 300),
				left: (lado - 300) / 2,
				top: (lado - 300) / 2,
			},
			{
				buf: await bloco(caixa, caixa, '#ffffff'),
				left: lado - margem - caixa,
				top: lado - margem - caixa,
			},
		]);
	}

	const direcao = {
		area_da_assinatura: 'Canto inferior direito, área branca lisa.',
		canto_da_assinatura: 'inferior_direito',
	};

	it('sem logo cadastrado, a arte sai intacta e cada peça DIZ por quê', async () => {
		const arte = await arteComReserva();
		const r = await rodar(arte, ['feed_1x1']);
		expect(r.logo_aplicado).toBe(false);
		expect(r.logo_motivo).toMatch(/Minha marca/i);
		for (const p of r.pecas) {
			expect(p.logo_aplicado).toBe(false);
			expect(p.logo_motivo.length).toBeGreaterThan(0);
		}
		// Intacta de verdade: mesmos pixels da entrada.
		const antes = await sharp(arte).raw().toBuffer();
		const depois = await sharp(r.png).raw().toBuffer();
		expect(depois.equals(antes)).toBe(true);
	});

	it('a peça principal recebe o logo no canto que o Diretor reservou', async () => {
		const arte = await arteComReserva();
		const r = await rodar(arte, ['feed_1x1'], {
			logo: await logo(),
			direcao_arte: direcao,
		});
		expect(r.logo_aplicado).toBe(true);
		expect(r.pecas[0]?.logo_aplicado).toBe(true);

		// A prova nos BYTES: a caixa branca reservada deixou de ser branca.
		const lado = 1024;
		const caixa = Math.round(lado * 0.15);
		const margem = Math.round(lado * 0.04);
		const regiao = {
			left: lado - margem - caixa,
			top: lado - margem - caixa,
			width: caixa,
			height: caixa,
		};
		const conta = async (png: Buffer) => {
			const d = await sharp(png).extract(regiao).raw().toBuffer();
			let escuros = 0;
			for (let i = 0; i + 2 < d.length; i += 3) if (d[i] < 100) escuros++;
			return escuros;
		};
		expect(await conta(arte)).toBe(0);
		expect(await conta(r.png)).toBeGreaterThan(0);
	});

	/**
	 * O CASO QUE JUSTIFICA A ORDEM. Com o logo carimbado ANTES, o mapa de
	 * conteúdo enxergaria a assinatura como um objeto inteiro no canto e os
	 * recortes que a deixam de fora seriam recusados. O veredito tem que ser o
	 * MESMO com e sem logo — quem decide o kit é a arte, não a marca.
	 */
	it('o carimbo NÃO muda quais formatos o portão aprova', async () => {
		const arte = await arteComReserva();
		const semMarca = await rodar(arte);
		const comMarca = await rodar(arte, undefined, {
			logo: await logo(),
			direcao_arte: direcao,
		});
		expect(comMarca.pecas.map((p) => p.formato)).toEqual(
			semMarca.pecas.map((p) => p.formato),
		);
		expect(comMarca.recusados.map((p) => p.formato)).toEqual(
			semMarca.recusados.map((p) => p.formato),
		);
		// E entregou mais de um formato: um kit de uma peça só não provaria nada.
		expect(comMarca.pecas.length).toBeGreaterThan(1);
	});

	/**
	 * O recorte não herda o canto declarado — ele MEDE o próprio quadro. Aqui a
	 * afirmação é a que importa para o aluno: nenhuma peça sai com o logo
	 * cortado, porque o logo entra depois de a peça já ter o tamanho final.
	 */
	it('cada peça é carimbada no próprio quadro, com a caixa proporcional a ela', async () => {
		const arte = await arteComReserva();
		const r = await rodar(arte, undefined, {
			logo: await logo(),
			direcao_arte: direcao,
		});
		for (const p of r.pecas) {
			const meta = await sharp(
				Buffer.from(p.pngBase64.split(',')[1] ?? '', 'base64'),
			).metadata();
			expect(meta.width).toBe(p.largura);
			expect(meta.height).toBe(p.altura);
		}
	});

	it('arte de traço com logo continua bitonal — 2 níveis, 0 cor', async () => {
		// Traço puro: preto e branco, sem cinza nenhum.
		const traco = await sharp({
			create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' },
		})
			.composite([
				{ input: await bloco(300, 300, '#000000'), left: 362, top: 362 },
			])
			.png()
			.toBuffer();
		const r = await rodar(traco, ['feed_1x1'], {
			logo: await logo(),
			line_art: true,
		});
		const d = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
		const niveis = new Set<number>();
		let coloridos = 0;
		for (
			let i = 0;
			i + d.info.channels - 1 < d.data.length;
			i += d.info.channels
		) {
			const [a, b, c] = [d.data[i], d.data[i + 1], d.data[i + 2]];
			niveis.add(a);
			if (a !== b || b !== c) coloridos++;
		}
		expect(coloridos).toBe(0);
		expect([...niveis].sort((x, y) => x - y)).toEqual([0, 255]);
	});
});

/**
 * O CONTRATO COM A DEFINITION, congelado.
 *
 * `output` é ALLOW-LIST: uma chave que este bloco emite e a definition não lista
 * é calculada e jogada fora em silêncio; e uma chave que a definition referencia
 * e o bloco NÃO emite chega à tela como `undefined`, sem erro nenhum. Os dois
 * lados falham calados, então o conjunto exato fica travado aqui — renomear
 * `pecas` para `formatos` quebra ESTE teste em vez de esvaziar a seção do kit
 * numa tool paga.
 *
 * A lista espelha `scripts/seed-estudio-imagens.ts` (api-upvox), nó `arte`:
 *   png/pngBase64 → o `save_gallery` e o `output.preview`
 *   logo_aplicado/logo_motivo → "o logo entrou?" na tela
 *   pecas/recusados/total/resumo/origem → a seção do kit
 */
describe('contrato com a definition', () => {
	it('emite exatamente as chaves que a allow-list do Ateliê lista', async () => {
		const arte = await arteCom(1024, [
			{ buf: await bloco(300, 300), left: 362, top: 362 },
		]);
		const r = (await rodar(arte)) as unknown as Record<string, unknown>;
		expect(Object.keys(r).sort()).toEqual(
			[
				'logo_aplicado',
				'logo_motivo',
				'origem',
				'pecas',
				'png',
				'pngBase64',
				'recusados',
				'resumo',
				'total',
			].sort(),
		);
	});
});
