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

// `generateToolImage` importa o cliente OpenRouter no topo; mockamos o módulo
// pra não tocar rede no caminho legado (não usado aqui, mas evita quebra se
// algum teste futuro cair nele por engano).
const create = vi.fn();
vi.mock('@/lib/openrouter.js', () => ({
	openrouter: { chat: { completions: { create } } },
	PREVIA_MODEL: 'stub',
}));

const { generateToolImage, nearestAspectRatioPreset, pctDescartadoNoCover } =
	await import('@/lib/image-gen.js');

beforeAll(() => {
	process.env.OPENROUTER_API_KEY = 'test-key';
});

/** Presets reais do `google/gemini-3-pro-image-preview` (modelo padrão),
 * espelhados de `image-models-catalog.ts` — testado isolado, sem rede. */
const GEMINI_PRESETS = [
	'1:1',
	'2:3',
	'3:2',
	'3:4',
	'4:3',
	'4:5',
	'5:4',
	'9:16',
	'16:9',
	'21:9',
];

describe('nearestAspectRatioPreset', () => {
	it('2000×1000 (2:1) → 16:9 (mais próximo em escala log)', () => {
		expect(nearestAspectRatioPreset(2000, 1000, GEMINI_PRESETS)).toBe('16:9');
	});

	it('1500×1000 (3:2) → 3:2 (match exato)', () => {
		expect(nearestAspectRatioPreset(1500, 1000, GEMINI_PRESETS)).toBe('3:2');
	});

	it('1000×1000 (1:1) → 1:1', () => {
		expect(nearestAspectRatioPreset(1000, 1000, GEMINI_PRESETS)).toBe('1:1');
	});

	it('devolve undefined se a lista de presets estiver vazia', () => {
		expect(nearestAspectRatioPreset(2000, 1000, [])).toBeUndefined();
	});
});

describe('generateToolImage — dimensão final exata via /v1/images (raw_prompt)', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		// O cliente `/chat/completions` é compartilhado pelo arquivo: sem reset,
		// os testes de rota legada contam as chamadas dos testes anteriores.
		create.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		warnSpy.mockRestore();
	});

	/** Monta uma resposta `/v1/images` cujo PNG tem exatamente `width`×`height`. */
	async function mockModelOutput(width: number, height: number) {
		const png = await sharp({
			create: {
				width,
				height,
				channels: 3,
				background: { r: 10, g: 10, b: 10 },
			},
		})
			.png()
			.toBuffer();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }],
			}),
		});
	}

	it('saída nativa PRÓXIMA do alvo (2:1) — crop mínimo, sem warning de desvio', async () => {
		// 1344×672 é 2:1 exato — mesma proporção do alvo 2000×1000.
		await mockModelOutput(1344, 672);
		const result = await generateToolImage('copo azul', [], undefined, {
			width: 2000,
			height: 1000,
			rawPrompt: true,
			fit: 'cover',
		});
		const meta = await sharp(result.png).metadata();
		expect(meta.width).toBe(2000);
		expect(meta.height).toBe(1000);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('saída nativa LONGE do alvo (quadrada p/ alvo 2:1) — ainda bate o pixel exato, warning dispara', async () => {
		// 1024×1024 (quadrado) pedido pra um alvo 2000×1000 (2:1) — exatamente o
		// cenário do bug reportado: modelo ignora a proporção, cover crop tem que
		// cortar metade da imagem pra encaixar.
		await mockModelOutput(1024, 1024);
		const result = await generateToolImage('copo azul', [], undefined, {
			width: 2000,
			height: 1000,
			rawPrompt: true,
			fit: 'cover',
		});
		const meta = await sharp(result.png).metadata();
		expect(meta.width).toBe(2000);
		expect(meta.height).toBe(1000);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toContain('saída nativa muito diferente');
	});

	it('fit:"fill" (legado, sem raw_prompt) também bate o pixel exato', async () => {
		await mockModelOutput(1024, 1024);
		const result = await generateToolImage('copo azul', [], undefined, {
			width: 1500,
			height: 1000,
			rawPrompt: true,
			fit: 'fill',
		});
		const meta = await sharp(result.png).metadata();
		expect(meta.width).toBe(1500);
		expect(meta.height).toBe(1000);
	});

	/**
	 * NÃO COMPRAR PIXEL PARA DELETAR PIXEL.
	 *
	 * O `resize` final sempre roda, então tudo que vem acima do alvo é pago e
	 * jogado fora. Estes testes prendem a faixa pedida ao tamanho pedido — e os
	 * números do comentário de `bestResolution` são MEDIDOS no provedor real
	 * (`/v1/images`, 4:5, mesmo prompt), não estimados.
	 */
	describe('a faixa comprada é a menor que cobre o alvo', () => {
		/** O corpo JSON que foi realmente enviado ao `/v1/images`. */
		function corpoEnviado(): Record<string, unknown> {
			return JSON.parse(fetchMock.mock.calls[0][1].body as string);
		}

		it('post 1080×1350 pede 2K, não o 4K que pagávamos e descartávamos', async () => {
			await mockModelOutput(1856, 2304);
			await generateToolImage('copo', [], undefined, {
				width: 1080,
				height: 1350,
				rawPrompt: true,
			});
			// 1080×1350 = 1,46 MP. Cabe em 2K (≈4,2 MP); 1K (≈1,05 MP) não cobre.
			// Medido: 2K US$ 0,1024 contra 4K US$ 0,1527 no flash — 33% a menos
			// pela MESMA imagem na tela.
			expect(corpoEnviado().resolution).toBe('2K');
		});

		it('miniatura 512×512 desce até a menor faixa QUE O MODELO OFERECE', async () => {
			await mockModelOutput(1024, 1024);
			await generateToolImage('copo', [], undefined, {
				width: 512,
				height: 512,
				rawPrompt: true,
			});
			// O padrão (`gemini-3-pro-image-preview`) só declara ['1K','2K','4K'] —
			// não existe '512' para comprar. A escolha sai da lista do modelo, nunca
			// da tabela de faixas: pedir uma faixa que o modelo não aceita é erro
			// 400 no provedor, não economia.
			expect(corpoEnviado().resolution).toBe('1K');
		});

		it('alvo maior que toda faixa disponível ainda pede o topo', async () => {
			await mockModelOutput(4096, 4096);
			await generateToolImage('copo', [], undefined, {
				width: 6000,
				height: 6000, // 36 MP: acima até do 4K (≈16,8 MP)
				rawPrompt: true,
			});
			expect(corpoEnviado().resolution).toBe('4K');
		});

		it('a fronteira é ÁREA, não largura — 2000×2000 não cabe em 2K', async () => {
			await mockModelOutput(4096, 4096);
			await generateToolImage('copo', [], undefined, {
				width: 2000,
				height: 2000, // 4,0 MP < 4,19 MP do 2K… mas por pouco
				rawPrompt: true,
			});
			// 4,0 MP CABE em 2K (4,19 MP). Se a conta fosse por largura (2000 <
			// 2048) daria o mesmo aqui — o teste seguinte é que separa os dois.
			expect(corpoEnviado().resolution).toBe('2K');
		});

		it('e 2048×2048 (4,19 MP) já estoura o 2K e sobe para 4K', async () => {
			await mockModelOutput(4096, 4096);
			await generateToolImage('copo', [], undefined, {
				width: 2048,
				height: 2100, // 4,30 MP > 4,19 MP: por largura passaria, por área não
				rawPrompt: true,
			});
			expect(corpoEnviado().resolution).toBe('4K');
		});

		/**
		 * ┌─ ÁREA NÃO É LADO, e por isso a faixa voltava a inventar pixel ──────┐
		 * │ A área da faixa é gasta na PROPORÇÃO que a gente pede — e essa      │
		 * │ proporção é o PRESET mais próximo, não a do alvo. Quando os dois    │
		 * │ divergem, "a área cobre" não implica "os dois lados cobrem", e o    │
		 * │ `fit:'cover'` lá embaixo vira ampliação.                            │
		 * │                                                                      │
		 * │ Varrido na grade de 8 px entre 0,4 e 2,6 de proporção: 4.982 alvos  │
		 * │ em que a conta por área comprava uma faixa que NÃO cobria, com      │
		 * │ ampliação de até 1,184×. A conta por lado conserta os 4.982.        │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		it('648×1616 cabia em 1K "pela área" e o 1K entrega 768×1365 — sobe para 2K', async () => {
			await mockModelOutput(1536, 2731);
			await generateToolImage('copo', [], undefined, {
				width: 648,
				height: 1616, // 1,047 MP: 0,1% ABAIXO da área do 1K (1,049 MP)
				rawPrompt: true,
			});
			// Preset 9:16 → o 1K entrega ~768×1365, e 1365 < 1616. Comprar 1K aqui
			// era pagar por uma imagem que o `cover` teria de AMPLIAR 1,18×.
			expect(corpoEnviado().resolution).toBe('2K');
		});

		/**
		 * O contra-exemplo que impede a correção de virar "compre sempre a faixa
		 * de cima": quando o alvo casa com o preset, a conta por lado dá
		 * exatamente o mesmo resultado que a conta por área dava.
		 */
		it('nenhum formato vivo hoje muda de faixa: os 4 do Prompts Mágicos + o 9:16 do Ateliê', async () => {
			const vivos: Array<[string, number, number, string]> = [
				['capinha 9:16', 1080, 1920, '2K'],
				['copo 360°', 2905, 1122, '2K'],
				['wrap 2600×1000', 2600, 1000, '2K'],
				['quadrado', 1200, 1200, '2K'],
				['story do Ateliê', 864, 1536, '2K'],
			];
			for (const [nome, width, height, esperado] of vivos) {
				fetchMock.mockClear();
				await mockModelOutput(2048, 2048);
				await generateToolImage('copo', [], undefined, {
					width,
					height,
					rawPrompt: true,
				});
				expect(corpoEnviado().resolution, nome).toBe(esperado);
			}
		});
	});

	/**
	 * ══════════════════════════════════════════════════════════════════════
	 * O 9:16 QUE SAÍA QUADRADO — `formatoReal` separado de `rawPrompt`.
	 * ══════════════════════════════════════════════════════════════════════
	 *
	 * As duas flags respondiam perguntas diferentes mas eram o MESMO
	 * interruptor, e por isso o Ateliê (que quer aderência, logo nunca passou
	 * `rawPrompt`) não conseguia pedir proporção de verdade: caía sempre no
	 * `/chat/completions`, onde o formato é uma frase no fim do prompt.
	 */
	describe('formatoReal roteia pra /v1/images sem exigir rawPrompt', () => {
		function corpoEnviado(): Record<string, unknown> {
			return JSON.parse(fetchMock.mock.calls[0][1].body as string);
		}

		it('9:16 do Ateliê vira PARÂMETRO aspect_ratio, não frase no prompt', async () => {
			await mockModelOutput(1536, 2752);
			await generateToolImage('uma coruja', [], undefined, {
				width: 864,
				height: 1536,
				formatoReal: true, // ← sem rawPrompt: é o caso do `ai.image_studio`
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/images');
			expect(corpoEnviado().aspect_ratio).toBe('9:16');
		});

		it('o system prompt não se perde na troca de rota — ele é DOBRADO no prompt', async () => {
			// `/v1/images` não tem papel `system`. Sem dobrar, migrar o Ateliê
			// apagaria o `style_system` do estilo escolhido em silêncio.
			await mockModelOutput(1024, 1024);
			await generateToolImage('um leão', [], undefined, {
				width: 1024,
				height: 1024,
				formatoReal: true,
				systemPromptOverride: 'Você é um xilogravurista.',
			});
			const prompt = corpoEnviado().prompt as string;
			expect(prompt.startsWith('Você é um xilogravurista.')).toBe(true);
			expect(prompt).toContain('um leão');
		});

		it('com refs, o lead autoritativo entra e as refs vão em input_references', async () => {
			await mockModelOutput(1024, 1024);
			const ref = await sharp({
				create: {
					width: 8,
					height: 8,
					channels: 3,
					background: { r: 1, g: 2, b: 3 },
				},
			})
				.png()
				.toBuffer();
			await generateToolImage('a mesma coruja de perfil', [ref], undefined, {
				width: 1024,
				height: 1024,
				formatoReal: true,
			});
			const body = corpoEnviado();
			expect((body.input_references as unknown[]).length).toBe(1);
			// O TEXT_LEAD do `/chat/completions` fala em "as imagens ACIMA"; aqui as
			// refs viajam em campo separado, então a frase é a adaptada.
			expect(body.prompt).toContain('as imagens de referência enviadas');
			expect(body.prompt).not.toContain('as imagens acima');
		});

		it('sem refs não entra lead nenhum (não poluir o prompt com ruído)', async () => {
			await mockModelOutput(1024, 1024);
			await generateToolImage('uma coruja', [], undefined, {
				width: 1024,
				height: 1024,
				formatoReal: true,
			});
			expect(corpoEnviado().prompt).not.toContain(
				'as imagens de referência enviadas',
			);
		});

		/**
		 * REGRESSÃO DOS PROMPTS MÁGICOS (tool PUBLICADA em produção).
		 *
		 * Ela já rodava na `/v1/images` via `rawPrompt`. O conserto não pode ter
		 * mudado uma vírgula do corpo dela — `formatoReal` ausente segue
		 * `rawPrompt`, e `rawPrompt` continua significando "nenhuma
		 * intermediação": nada de system dobrado, nada de lead.
		 */
		it('rawPrompt continua indo pra /v1/images com o prompt CRU, sem system dobrado', async () => {
			await mockModelOutput(1024, 1024);
			await generateToolImage('caneca gravada a laser', [], undefined, {
				width: 1024,
				height: 1024,
				rawPrompt: true,
				systemPromptOverride: 'Você é um xilogravurista.',
			});
			expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/images');
			const prompt = corpoEnviado().prompt as string;
			expect(prompt.startsWith('caneca gravada a laser')).toBe(true);
			expect(prompt).not.toContain('xilogravurista');
			expect(prompt).not.toContain('gerador de imagens de alta fidelidade');
		});

		it('rawPrompt com refs também não ganha lead (segue cru)', async () => {
			await mockModelOutput(1024, 1024);
			const ref = await sharp({
				create: {
					width: 8,
					height: 8,
					channels: 3,
					background: { r: 1, g: 2, b: 3 },
				},
			})
				.png()
				.toBuffer();
			await generateToolImage('caneca', [ref], undefined, {
				width: 1024,
				height: 1024,
				rawPrompt: true,
			});
			const body = corpoEnviado();
			expect((body.input_references as unknown[]).length).toBe(1);
			expect(body.prompt).not.toContain('autoritativo');
		});

		it('formatoReal:false FORÇA o caminho legado mesmo com rawPrompt', async () => {
			// Escape hatch explícito: quem quiser o `/chat/completions` de volta
			// (comparar rotas, contornar um provedor instável) tem como pedir.
			const png = await sharp({
				create: {
					width: 512,
					height: 512,
					channels: 3,
					background: { r: 9, g: 9, b: 9 },
				},
			})
				.png()
				.toBuffer();
			create.mockResolvedValue({
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
			});
			await generateToolImage('copo', [], undefined, {
				width: 512,
				height: 512,
				rawPrompt: true,
				formatoReal: false,
			});
			expect(fetchMock).not.toHaveBeenCalled();
			expect(create).toHaveBeenCalledTimes(1);
		});

		it('modelo FORA do catálogo cai no legado em vez de derrubar um run pago', async () => {
			// `findImageModel` devolve undefined → sem `unifiedImagesApi`, sem rota
			// nova. Um 404 aqui aconteceria no meio de uma invocação já cobrada.
			const png = await sharp({
				create: {
					width: 256,
					height: 256,
					channels: 3,
					background: { r: 5, g: 5, b: 5 },
				},
			})
				.png()
				.toBuffer();
			create.mockResolvedValue({
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
			});
			const result = await generateToolImage('copo', [], undefined, {
				model: 'algum/modelo-que-nao-existe-no-catalogo',
				width: 256,
				height: 256,
				formatoReal: true,
			});
			expect(fetchMock).not.toHaveBeenCalled();
			expect(create).toHaveBeenCalledTimes(1);
			const meta = await sharp(result.png).metadata();
			expect([meta.width, meta.height]).toEqual([256, 256]);
		});
	});

	/**
	 * O `fit:'cover'` é o fallback DA FAMÍLIA GPT — ela não aceita
	 * `aspect_ratio`/`resolution` em API nenhuma. O que NÃO pode acontecer é
	 * rebaixar o Gemini "por simetria": ele controla proporção de verdade, e
	 * mandar `quality` (que ele não aceita) seria 400 no provedor.
	 */
	describe('cada família recebe só o que ela aceita', () => {
		function corpoEnviado(): Record<string, unknown> {
			return JSON.parse(fetchMock.mock.calls[0][1].body as string);
		}

		it('GPT: quality high, e NENHUM aspect_ratio/resolution', async () => {
			await mockModelOutput(1024, 1536);
			await generateToolImage('caneca', [], undefined, {
				model: 'openai/gpt-5-image-mini',
				width: 864,
				height: 1536,
				formatoReal: true,
			});
			const body = corpoEnviado();
			expect(body.quality).toBe('high');
			expect(body.aspect_ratio).toBeUndefined();
			expect(body.resolution).toBeUndefined();
		});

		it('Gemini: aspect_ratio + resolution, e NENHUM quality', async () => {
			await mockModelOutput(1536, 2752);
			await generateToolImage('caneca', [], undefined, {
				model: 'google/gemini-3.1-flash-image',
				width: 864,
				height: 1536,
				formatoReal: true,
			});
			const body = corpoEnviado();
			expect(body.aspect_ratio).toBe('9:16');
			expect(body.resolution).toBe('2K');
			expect(body.quality).toBeUndefined();
		});
	});
});

/**
 * A conta do que o `cover` joga fora. Os números são os MEDIDOS em runs frios
 * (2026-08-09) — este teste é o que impede o log de mentir sobre eles.
 */
describe('pctDescartadoNoCover', () => {
	it('1024×1024 pedido como 9:16 (864×1536) descarta 43,75% — o bug do GPT', () => {
		expect(pctDescartadoNoCover(1024, 1024, 864, 1536)).toBe(43.75);
	});

	it('1024×1536 (o que a /v1/images devolve no GPT) cai para 15,63%', () => {
		expect(pctDescartadoNoCover(1024, 1536, 864, 1536)).toBe(15.63);
	});

	it('1536×2752 (Gemini com aspect_ratio real) descarta quase nada', () => {
		expect(pctDescartadoNoCover(1536, 2752, 864, 1536)).toBeLessThan(1);
	});

	it('proporção idêntica não descarta nada, em qualquer escala', () => {
		expect(pctDescartadoNoCover(1344, 672, 2000, 1000)).toBe(0);
	});

	it('dimensão inválida devolve 0 em vez de NaN no log', () => {
		expect(pctDescartadoNoCover(0, 0, 864, 1536)).toBe(0);
	});
});
