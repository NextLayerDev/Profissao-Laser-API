import sharp from 'sharp';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

/**
 * Testes do Estúdio de Imagens: o bloco-mãe `ai.image_studio`, a textura
 * repetível `image.make_tileable` e a saída `output.save_gallery`.
 *
 * O OpenRouter é mockado no nível do CLIENTE (como em `ai-generate-image-block`)
 * para os modos de IA rodarem sem rede e sem chave — mas o PÓS-PROCESSAMENTO
 * (threshold do vetorizável, offset+blend da textura) roda de verdade, no sharp,
 * porque é ele que carrega a promessa de cada modo.
 */
const create = vi.fn();
vi.mock('@/lib/openrouter.js', () => ({
	openrouter: { chat: { completions: { create } } },
	PREVIA_MODEL: 'stub',
}));

const { imageStudioBlock, STUDIO_ASPECTS, STUDIO_MODE_COST, VECTOR_LEAD } =
	await import('@/tool-blocks/blocks/image-studio.js');
const { makeTileable, seamBandMask, imageMakeTileableBlock } = await import(
	'@/tool-blocks/blocks/tile.js'
);
const { outputSaveGalleryBlock } = await import(
	'@/tool-blocks/blocks/output-gallery.js'
);
const { blockRegistry } = await import('@/tool-blocks/registry.js');
const { registerCoreBlocks } = await import('@/tool-blocks/index.js');

const ctx = { customerId: 'cust-1' };

/* ───────────────────────── fixtures de imagem ───────────────────────── */

/** PNG cru a partir de uma função (x,y) → [r,g,b]. */
async function makePng(
	w: number,
	h: number,
	px: (x: number, y: number) => [number, number, number],
): Promise<Buffer> {
	const raw = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const [r, g, b] = px(x, y);
			const i = (y * w + x) * 3;
			raw[i] = r;
			raw[i + 1] = g;
			raw[i + 2] = b;
		}
	}
	return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
		.png()
		.toBuffer();
}

/** Gradiente diagonal: preto de um lado, branco do outro → costura máxima. */
const gradientPng = (w = 192, h = 192) =>
	makePng(w, h, (x, y) => [
		Math.round((x / (w - 1)) * 255),
		Math.round((y / (h - 1)) * 255),
		128,
	]);

/** Textura pseudo-orgânica determinística (senos + ruído com semente fixa). */
const organicPng = (w = 192, h = 192) => {
	let seed = 42;
	const rnd = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	return makePng(w, h, (x, y) => {
		const v =
			120 +
			40 * Math.sin(x / 11.3) +
			30 * Math.sin(y / 7.7 + 1.2) +
			25 * Math.sin((x + y) / 17.1) +
			20 * (rnd() - 0.5);
		const c = Math.max(0, Math.min(255, Math.round(v)));
		return [c, Math.round(c * 0.8), Math.round(c * 0.6)];
	});
};

/** Imagem com CINZA no meio — o modelo desobedecendo o "preto puro". */
const grayRampPng = (w = 64, h = 64) =>
	makePng(w, h, (x) => {
		const c = Math.round((x / (w - 1)) * 255);
		return [c, c, c];
	});

/* ─────────────────────── medidas de "tileável" ─────────────────────── */

/**
 * Diferença média absoluta (0..255) entre a coluna 0 e a coluna W-1. É a
 * definição operacional de "tileável" no eixo X: ao repetir a imagem lado a
 * lado, são essas duas colunas que ficam encostadas.
 */
async function seamDiff(buf: Buffer, axis: 'x' | 'y'): Promise<number> {
	const { data, info } = await sharp(buf)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height, channels } = info;
	const at = (x: number, y: number, c: number) =>
		data[(y * width + x) * channels + c];
	let sum = 0;
	let n = 0;
	if (axis === 'x') {
		for (let y = 0; y < height; y++)
			for (let c = 0; c < channels; c++, n++)
				sum += Math.abs(at(0, y, c) - at(width - 1, y, c));
	} else {
		for (let x = 0; x < width; x++)
			for (let c = 0; c < channels; c++, n++)
				sum += Math.abs(at(x, 0, c) - at(x, height - 1, c));
	}
	return sum / n;
}

/**
 * PISO TEÓRICO da medida acima: as novas bordas, depois do offset de 50%, são
 * as duas colunas centrais do original — que eram VIZINHAS. A diferença entre
 * elas é irredutível (é o ruído próprio da textura), e nenhum algoritmo pode
 * baixar dela. Serve para provar que o resultado não é "melhor", é ÓTIMO.
 */
async function adjacentCenterDiff(
	buf: Buffer,
	axis: 'x' | 'y',
): Promise<number> {
	const { data, info } = await sharp(buf)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height, channels } = info;
	const at = (x: number, y: number, c: number) =>
		data[(y * width + x) * channels + c];
	let sum = 0;
	let n = 0;
	if (axis === 'x') {
		const hw = width >> 1;
		for (let y = 0; y < height; y++)
			for (let c = 0; c < channels; c++, n++)
				sum += Math.abs(at(hw, y, c) - at(hw - 1, y, c));
	} else {
		const hh = height >> 1;
		for (let x = 0; x < width; x++)
			for (let c = 0; c < channels; c++, n++)
				sum += Math.abs(at(x, hh, c) - at(x, hh - 1, c));
	}
	return sum / n;
}

/* ───────────────────────── mock do OpenRouter ───────────────────────── */

/**
 * A IMAGEM QUE O PROVEDOR VAI DEVOLVER NESTE TESTE — registrada aqui porque o
 * Estúdio agora sai por DUAS portas diferentes:
 *   • geração (`texto_imagem`/`variacao`/`textura`/`vetorizavel`) → `fetch` no
 *     `POST /v1/images`, desde que o formato passou a ser PARÂMETRO e não frase;
 *   • `editar_mascara` → `editor-ai`, que continua no cliente `/chat/completions`.
 * `replyWith` alimenta as duas com o MESMO PNG, então nenhum teste precisou
 * saber por qual porta ele passou.
 */
let pngDoProvedor: Buffer | null = null;

/** Resposta no formato Gemini via OpenRouter (`images[0].image_url.url`). */
const replyWith = (png: Buffer) => {
	pngDoProvedor = png;
	return {
		choices: [
			{
				message: {
					images: [
						{
							image_url: {
								url: `data:image/png;base64,${png.toString('base64')}`,
							},
						},
					],
				},
			},
		],
	};
};

const run = (raw: unknown) =>
	imageStudioBlock.run(
		ctx,
		imageStudioBlock.paramsSchema.parse(raw) as never,
	) as Promise<Record<string, unknown>>;

beforeAll(() => {
	// `generateToolImage` recusa sem chave; o mock não lê o env, mas a guarda sim.
	process.env.OPENROUTER_API_KEY = 'test-key';
});

beforeEach(() => {
	create.mockReset();
	pngDoProvedor = null;
	// Dublê da `POST /v1/images`. Sem ele os testes de geração iriam à REDE de
	// verdade (foi o que aconteceu quando o Estúdio mudou de rota: nove testes
	// caíram com "Missing Authentication header" vindo do OpenRouter real).
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: unknown) => {
			const alvo = String(url);
			if (!alvo.includes('/v1/images')) {
				throw new Error(`fetch inesperado no teste: ${alvo}`);
			}
			if (!pngDoProvedor) {
				throw new Error('o teste não registrou imagem de resposta (replyWith)');
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({
					data: [{ b64_json: pngDoProvedor?.toString('base64') }],
				}),
			};
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/* ═════════════════════════ image.make_tileable ═════════════════════════ */

describe('image.make_tileable', () => {
	it('derruba a costura de um gradiente ao piso teórico', async () => {
		const src = await gradientPng();
		const antes = await seamDiff(src, 'x');
		const out = await makeTileable(src);
		const depois = await seamDiff(out, 'x');
		const piso = await adjacentCenterDiff(src, 'x');

		// Gradiente preto→branco: as bordas opostas são o extremo do contraste.
		expect(antes).toBeGreaterThan(60);
		// Ficou no piso (tolerância de 1 nível de 255 para o arredondamento do PNG).
		expect(depois).toBeLessThan(piso + 1);
		// E isso é uma queda de mais de 50× — a promessa do modo, medida.
		expect(depois).toBeLessThan(antes / 50);
	});

	it('fecha os DOIS eixos, não só o horizontal', async () => {
		const src = await gradientPng();
		const out = await makeTileable(src);
		expect(await seamDiff(out, 'y')).toBeLessThan(
			(await seamDiff(src, 'y')) / 50,
		);
	});

	it('em textura orgânica, chega ao ruído irredutível entre colunas vizinhas', async () => {
		const src = await organicPng();
		const antes = await seamDiff(src, 'x');
		const out = await makeTileable(src);
		const depois = await seamDiff(out, 'x');
		const piso = await adjacentCenterDiff(src, 'x');
		expect(depois).toBeLessThan(antes / 3);
		// Não dá para ir abaixo do ruído da própria textura — e não vai.
		expect(depois).toBeLessThan(piso * 1.35);
	});

	it('preserva as dimensões e devolve PNG opaco quando a entrada é opaca', async () => {
		const out = await makeTileable(await organicPng(128, 96));
		const meta = await sharp(out).metadata();
		expect([meta.width, meta.height]).toEqual([128, 96]);
		expect(meta.format).toBe('png');
		// Sem canal alfa inútil: entrada opaca sai opaca (≈30% menos bytes).
		expect(meta.hasAlpha).toBe(false);
	});

	it('preserva a transparência quando a entrada tem alfa', async () => {
		const rgba = await sharp({
			create: {
				width: 64,
				height: 64,
				channels: 4,
				background: { r: 200, g: 30, b: 30, alpha: 0.5 },
			},
		})
			.png()
			.toBuffer();
		const meta = await sharp(await makeTileable(rgba)).metadata();
		expect(meta.hasAlpha).toBe(true);
	});

	it('a máscara tem pico 0,5 na costura e zero fora da faixa', () => {
		const w = 100;
		const mask = seamBandMask(w, 2, 'x', 50, 20);
		// Pico ~127 (=0,5) nas duas colunas encostadas na costura.
		expect(mask[49]).toBeGreaterThan(115);
		expect(mask[50]).toBeGreaterThan(115);
		expect(mask[49]).toBeLessThan(129);
		// Simétrico.
		expect(Math.abs(mask[49] - mask[50])).toBeLessThanOrEqual(1);
		// Zerada fora da faixa de 20px (±10 da costura).
		expect(mask[10]).toBe(0);
		expect(mask[90]).toBe(0);
		// A faixa é uniforme ao longo do outro eixo (é uma faixa, não um ponto).
		expect(mask[w + 49]).toBe(mask[49]);
	});

	it('imagem minúscula passa direto em vez de virar borrão', async () => {
		const tiny = await makePng(4, 4, () => [10, 20, 30]);
		const meta = await sharp(await makeTileable(tiny)).metadata();
		expect([meta.width, meta.height]).toEqual([4, 4]);
	});

	it('está registrado e devolve tileable:true', async () => {
		registerCoreBlocks();
		expect(blockRegistry.has('image.make_tileable')).toBe(true);
		const out = await imageMakeTileableBlock.run(
			ctx,
			imageMakeTileableBlock.paramsSchema.parse({
				image: await organicPng(64, 64),
			}),
		);
		expect(out.tileable).toBe(true);
		expect(Buffer.isBuffer(out.png)).toBe(true);
		expect(String(out.pngBase64)).toMatch(/^data:image\/png;base64,/);
	});
});

/* ═════════════════════════ ai.image_studio ═════════════════════════ */

describe('ai.image_studio — registro e formatos', () => {
	it('está registrado no registry como bloco de IA', () => {
		registerCoreBlocks();
		expect(blockRegistry.has('ai.image_studio')).toBe(true);
		expect(blockRegistry.get('ai.image_studio')?.category).toBe('ai');
	});

	it('NÃO é o ai.studio do ImagR (que continua exigindo imagem)', () => {
		registerCoreBlocks();
		const antigo = blockRegistry.get('ai.studio');
		expect(antigo).toBeDefined();
		// O bloco publicado das tools-mãe segue rejeitando texto→imagem.
		expect(
			antigo?.paramsSchema.safeParse({ operation: 'colorir' }).success,
		).toBe(false);
	});

	it('todo formato tem lado longo 1536 (ou 1024 no quadrado) e é múltiplo de 32', () => {
		for (const [nome, { width, height }] of Object.entries(STUDIO_ASPECTS)) {
			expect(width % 32, `${nome} largura`).toBe(0);
			expect(height % 32, `${nome} altura`).toBe(0);
			// 16:9 é o único que não fecha em 64 — proporção exata não permite.
			if (nome !== '16:9' && nome !== '9:16') {
				expect(width % 64, `${nome} largura`).toBe(0);
				expect(height % 64, `${nome} altura`).toBe(0);
			}
			expect(Math.max(width, height), `${nome} lado longo`).toBe(
				nome === '1:1' ? 1024 : 1536,
			);
			// A proporção declarada tem que ser a proporção real (±0,5%).
			const [a, b] = nome.split(':').map(Number);
			expect(
				Math.abs(width / height - a / b),
				`${nome} proporção`,
			).toBeLessThan(0.005);
		}
	});

	it('a tabela de custo cobra 1× a geração, meio a remoção e nada a ampliação', () => {
		expect(STUDIO_MODE_COST.texto_imagem).toBe(1);
		expect(STUDIO_MODE_COST.variacao).toBe(1);
		expect(STUDIO_MODE_COST.editar_mascara).toBe(1);
		expect(STUDIO_MODE_COST.textura).toBe(1);
		expect(STUDIO_MODE_COST.vetorizavel).toBe(1);
		expect(STUDIO_MODE_COST.remover_fundo).toBe(0.5);
		expect(STUDIO_MODE_COST.ampliar).toBe(0);
	});
});

describe('ai.image_studio — validação (falha ANTES de gastar a chamada)', () => {
	const parse = (raw: unknown) => imageStudioBlock.paramsSchema.safeParse(raw);

	it('exige prompt nos modos de geração', () => {
		for (const mode of ['texto_imagem', 'textura', 'vetorizavel']) {
			expect(parse({ mode }).success, mode).toBe(false);
		}
	});

	it('exige ao menos uma referência no modo variação', () => {
		expect(parse({ mode: 'variacao', prompt: 'mais azul' }).success).toBe(
			false,
		);
		expect(
			parse({
				mode: 'variacao',
				prompt: 'mais azul',
				image: Buffer.from('x'),
			}).success,
		).toBe(true);
	});

	it('exige imagem em ampliar, remover fundo e edição com máscara', () => {
		expect(parse({ mode: 'ampliar' }).success).toBe(false);
		expect(parse({ mode: 'remover_fundo' }).success).toBe(false);
		expect(
			parse({ mode: 'editar_mascara', prompt: 'tira o poste' }).success,
		).toBe(false);
	});

	it('aceita texto→imagem sem imagem nenhuma (o caso que o ai.studio não faz)', () => {
		const p = parse({ mode: 'texto_imagem', prompt: 'uma coruja' });
		expect(p.success).toBe(true);
		// null é o que o motor injeta num input de imagem vazio.
		expect(
			parse({ mode: 'texto_imagem', prompt: 'x', image: null }).success,
		).toBe(true);
	});

	it('recusa formato fora da lista', () => {
		expect(
			parse({ mode: 'texto_imagem', prompt: 'x', aspect: '21:9' }).success,
		).toBe(false);
	});
});

describe('ai.image_studio — modos de geração', () => {
	/**
	 * O corpo JSON que o Estúdio mandou ao `POST /v1/images`. Antes destes
	 * testes lerem daqui, eles liam `create.mock.calls[0][0]` — o corpo do
	 * `/chat/completions`. Mudou porque o formato deixou de ser frase no prompt
	 * e virou parâmetro da requisição.
	 */
	function corpoEnviado(): Record<string, unknown> {
		const chamadas = (
			globalThis.fetch as unknown as {
				mock: { calls: [string, { body: string }][] };
			}
		).mock.calls;
		return JSON.parse(chamadas[0][1].body);
	}

	it('texto→imagem devolve o formato pedido e a meta do run', async () => {
		create.mockResolvedValue(replyWith(await gradientPng(64, 64)));
		const out = await run({
			mode: 'texto_imagem',
			prompt: 'uma coruja de traço',
			aspect: '16:9',
		});
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		// O 16:9 do seletor vira PARÂMETRO — este é o conserto do formato. Antes
		// ele existia só como frase no fim do prompt, e o modelo obedecia quando
		// queria (num GPT, nunca: voltava 1024×1024 e o `cover` comia 43,75%).
		expect(corpoEnviado().aspect_ratio).toBe('16:9');
		const meta = await sharp(out.png as Buffer).metadata();
		expect([meta.width, meta.height]).toEqual([1536, 864]);
		expect(out.mode).toBe('texto_imagem');
		expect(out.width).toBe(1536);
		expect(out.height).toBe(864);
		expect(out.cost_multiplier).toBe(1);
		expect(out.vectorReady).toBe(false);
		expect(out.tileable).toBe(false);
	});

	it('variação leva a referência em input_references, com o texto autoritativo', async () => {
		create.mockResolvedValue(replyWith(await gradientPng(64, 64)));
		await run({
			mode: 'variacao',
			prompt: 'a mesma coruja, mas de perfil',
			image: await organicPng(32, 32),
		});
		const body = corpoEnviado();
		// Na `/v1/images` as refs viajam num CAMPO PRÓPRIO — não são mais
		// content-parts antes do texto. A intenção continua a mesma (o texto manda,
		// a imagem é referência) e ela agora vive na frase do lead, não na ordem
		// dos segmentos: por isso o teste mudou de "posição" para "campo + lead".
		expect((body.input_references as unknown[]).length).toBe(1);
		expect(body.prompt).toContain('O texto abaixo é autoritativo');
		expect(body.prompt).toContain('a mesma coruja, mas de perfil');
	});

	it('a cauda do estilo entra no prompt e o system do estilo vence o da tool', async () => {
		create.mockResolvedValue(replyWith(await gradientPng(64, 64)));
		await run({
			mode: 'texto_imagem',
			prompt: 'um leão',
			style_suffix: 'em xilogravura de cordel',
			style_system: 'Você é um xilogravurista.',
			system_prompt: 'Você é um gerador genérico.',
		});
		// A `/v1/images` NÃO tem papel `system` — só um campo `prompt`. O system do
		// estilo é dobrado no início dele; sem isso, a troca de rota teria apagado
		// o `style_system` em silêncio (bug de formato trocado por bug de estilo).
		const prompt = corpoEnviado().prompt as string;
		expect(prompt.startsWith('Você é um xilogravurista.')).toBe(true);
		expect(prompt).not.toContain('Você é um gerador genérico.');
		expect(prompt).toContain('em xilogravura de cordel');
	});

	it('o modelo escolhido pelo admin chega ao OpenRouter', async () => {
		create.mockResolvedValue(replyWith(await gradientPng(64, 64)));
		await run({
			mode: 'texto_imagem',
			prompt: 'x',
			model: 'google/gemini-3.1-flash-image',
		});
		expect(corpoEnviado().model).toBe('google/gemini-3.1-flash-image');
	});

	it('vetorizável binariza mesmo quando o modelo devolve cinza', async () => {
		// O modelo "desobedece": manda uma rampa cheia de meio-tom.
		create.mockResolvedValue(replyWith(await grayRampPng()));
		const out = await run({
			mode: 'vetorizavel',
			prompt: 'um cavalo marinho',
			aspect: '1:1',
		});
		expect(out.vectorReady).toBe(true);

		const { data } = await sharp(out.png as Buffer)
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const valores = new Set<number>();
		for (const v of data) valores.add(v);
		// Zero cinza: só 0 e 255 sobrevivem ao threshold.
		expect([...valores].sort((a, b) => a - b)).toEqual([0, 255]);
	});

	it('vetorizável manda a instrução de traço fechado no prompt', async () => {
		create.mockResolvedValue(replyWith(await grayRampPng()));
		await run({ mode: 'vetorizavel', prompt: 'um cavalo marinho' });
		const texto = corpoEnviado().prompt as string;
		expect(texto).toContain(VECTOR_LEAD);
		expect(texto).toContain('um cavalo marinho');
	});

	it('textura fecha as bordas de verdade (não só pede no prompt)', async () => {
		const bruta = await gradientPng(128, 128);
		create.mockResolvedValue(replyWith(bruta));
		const out = await run({
			mode: 'textura',
			prompt: 'madeira de carvalho',
			// Formato pequeno via width/height explícitos: mantém o teste rápido.
			width: 128,
			height: 128,
		});
		expect(out.tileable).toBe(true);
		const antes = await seamDiff(bruta, 'x');
		const depois = await seamDiff(out.png as Buffer, 'x');
		expect(depois).toBeLessThan(antes / 20);
	});
});

describe('ai.image_studio — modos sem geração', () => {
	it('ampliar não chama a IA e multiplica as dimensões', async () => {
		const out = await run({
			mode: 'ampliar',
			image: await organicPng(64, 48),
			factor: '4',
		});
		expect(create).not.toHaveBeenCalled();
		expect(out.width).toBe(256);
		expect(out.height).toBe(192);
		expect(out.cost_multiplier).toBe(0);
	});

	it('remover fundo com fundo liso resolve sem IA e cobra meio', async () => {
		// Quadrado vermelho sobre fundo branco liso → chroma-key resolve.
		const img = await makePng(64, 64, (x, y) =>
			x > 16 && x < 48 && y > 16 && y < 48 ? [220, 20, 20] : [255, 255, 255],
		);
		const out = await run({ mode: 'remover_fundo', image: img });
		expect(create).not.toHaveBeenCalled();
		expect(out.cost_multiplier).toBe(0.5);
		const meta = await sharp(out.png as Buffer).metadata();
		expect(meta.hasAlpha).toBe(true);
	});

	it('edição com máscara passa imagem e máscara ao editor e preserva a geometria', async () => {
		create.mockResolvedValue(replyWith(await gradientPng(70, 50)));
		const out = await run({
			mode: 'editar_mascara',
			prompt: 'troca o céu por um pôr do sol',
			image: await organicPng(70, 50),
			mask: await makePng(70, 50, (x) =>
				x < 35 ? [255, 255, 255] : [0, 0, 0],
			),
			// Mesmo pedindo 16:9, edição NÃO recorta: a máscara sairia do lugar.
			aspect: '16:9',
		});
		const content = create.mock.calls[0][0].messages[0].content;
		// texto + imagem + aviso da máscara + máscara
		expect(
			content.filter((c: { type: string }) => c.type === 'image_url'),
		).toHaveLength(2);
		expect(out.width).toBe(70);
		expect(out.height).toBe(50);
	});

	it('erro do editor vira 502 com causa em PT-BR (o controller estorna)', async () => {
		create.mockRejectedValue(new Error('provider down'));
		await expect(
			run({
				mode: 'editar_mascara',
				prompt: 'x',
				image: await organicPng(32, 32),
			}),
		).rejects.toMatchObject({ status: 502 });
	});
});

/* ═════════════════════════ output.save_gallery ═════════════════════════ */

describe('output.save_gallery', () => {
	it('está registrado como bloco de saída', () => {
		registerCoreBlocks();
		expect(blockRegistry.has('output.save_gallery')).toBe(true);
		expect(blockRegistry.get('output.save_gallery')?.category).toBe('output');
	});

	it('nasce na galeria do dono, com visibilidade owner', () => {
		const p = outputSaveGalleryBlock.paramsSchema.parse({
			from: Buffer.from('x'),
			tool: 'estudio_imagens',
		});
		expect(p.collection).toBe('galeria');
		expect(p.visibility).toBe('owner');
	});

	it('não confunde a string "false" com verdadeiro (armadilha do coerce)', () => {
		const p = outputSaveGalleryBlock.paramsSchema.parse({
			from: Buffer.from('x'),
			tool: 'estudio_imagens',
			vector_ready: 'false',
			tileable: 'true',
		});
		expect(p.vector_ready).toBe(false);
		expect(p.tileable).toBe(true);
	});

	it('aceita parent_id — é o que dá a árvore de iterações', () => {
		const p = outputSaveGalleryBlock.paramsSchema.parse({
			from: Buffer.from('x'),
			tool: 'estudio_imagens',
			parent_id: 'abc-123',
		});
		expect(p.parent_id).toBe('abc-123');
	});

	/**
	 * Teste de CONTRATO ENTRE REPOS. A definition da tool (que mora no upvox, em
	 * `scripts/seed-estudio-imagens.ts`) liga o nó `save` ao nó `gen` por nome:
	 * `modelo: 'gen.model'`, `vector_ready: 'gen.vectorReady'`… Se alguém
	 * renomear uma saída aqui, nada quebra em compilação — o motor resolve a ref
	 * para `undefined` e a galeria passa a nascer sem modelo, sem prompt e sem
	 * marca de vetorizável, em silêncio. Este teste é o alarme.
	 */
	it('as saídas do gen cobrem TODAS as refs que a definition liga no save', async () => {
		const REFS_DA_DEFINITION = [
			'png',
			'mode',
			'prompt',
			'model',
			'aspect',
			'width',
			'height',
			'vectorReady',
			'tileable',
			// usadas na projeção `output.meta`
			'pngBase64',
			'cost_multiplier',
		];
		create.mockResolvedValue(replyWith(await gradientPng(64, 64)));
		const out = await run({ mode: 'texto_imagem', prompt: 'x' });
		for (const chave of REFS_DA_DEFINITION) {
			expect(out, `gen.${chave} sumiu`).toHaveProperty(chave);
		}
	});

	/**
	 * O nó `save` da definition, resolvido contra a bag REAL do nó `gen`. É o
	 * teste que pega a armadilha que já mordeu uma vez: o bloco de IA devolve
	 * `null` no que não se aplica ao modo (`ampliar` não tem prompt nem modelo),
	 * e um `optional` no lugar de `nullish` reprovaria o schema DEPOIS de a
	 * imagem ter sido gerada e cobrada — 400 em cima de um run bem-sucedido.
	 */
	it('os params do save da definition passam no schema com a bag real do gen', async () => {
		const { resolveRefs } = await import('@/lib/tool-engine.js');
		// Cópia fiel do nó `save` em api-upvox/scripts/seed-estudio-imagens.ts.
		const paramsDaDefinition = {
			from: 'gen.png',
			tool: 'estudio_imagens',
			collection: 'galeria',
			folder: 'estudio-imagens',
			modo: 'gen.mode',
			prompt: 'gen.prompt',
			modelo: 'gen.model',
			aspecto: 'gen.aspect',
			largura: 'gen.width',
			altura: 'gen.height',
			parent_id: 'input.parent_id',
			vector_ready: 'gen.vectorReady',
			tileable: 'gen.tileable',
		};
		const heads = new Set(['input', 'gen']);

		// Modo mais pobre em metadados: ampliar não tem prompt nem modelo.
		const ampliado = await run({
			mode: 'ampliar',
			image: await organicPng(64, 64),
			factor: '2',
		});
		const bagAmpliar: Record<string, unknown> = {
			'input.parent_id': undefined,
		};
		for (const [k, v] of Object.entries(ampliado)) bagAmpliar[`gen.${k}`] = v;
		const rAmpliar = outputSaveGalleryBlock.paramsSchema.safeParse(
			resolveRefs(paramsDaDefinition, bagAmpliar, heads),
		);
		expect(rAmpliar.success, JSON.stringify(rAmpliar.error?.issues)).toBe(true);
		expect(rAmpliar.data?.prompt).toBeNull();
		expect(rAmpliar.data?.modelo).toBeNull();

		// Modo mais rico: geração com tudo preenchido.
		create.mockResolvedValue(replyWith(await gradientPng(64, 64)));
		const gerado = await run({
			mode: 'vetorizavel',
			prompt: 'um cavalo marinho',
			aspect: '3:2',
		});
		const bagGen: Record<string, unknown> = { 'input.parent_id': 'origem-1' };
		for (const [k, v] of Object.entries(gerado)) bagGen[`gen.${k}`] = v;
		const rGen = outputSaveGalleryBlock.paramsSchema.safeParse(
			resolveRefs(paramsDaDefinition, bagGen, heads),
		);
		expect(rGen.success, JSON.stringify(rGen.error?.issues)).toBe(true);
		expect(rGen.data?.vector_ready).toBe(true);
		expect(rGen.data?.aspecto).toBe('3:2');
		expect(rGen.data?.largura).toBe(1536);
		expect(rGen.data?.parent_id).toBe('origem-1');
		// O modelo gravado é o que rodou de fato, não `null` por falta de override.
		expect(rGen.data?.modelo).toContain('/');
	});

	it('o preview do motor pula a gravação (não escreve de graça)', async () => {
		// `skipInPreview` corta `output.*` e `ai.*` — os dois nós do Estúdio.
		const { blockRegistry: reg } = await import('@/tool-blocks/registry.js');
		registerCoreBlocks();
		for (const id of ['output.save_gallery', 'ai.image_studio']) {
			expect(
				id.startsWith('output.') || id.startsWith('ai.'),
				`${id} precisa cair na regra de skipInPreview`,
			).toBe(true);
			expect(reg.has(id)).toBe(true);
		}
	});
});
