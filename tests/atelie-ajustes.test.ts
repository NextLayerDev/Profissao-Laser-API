import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * OS AJUSTES — ampliar, remover fundo, vetorizar e variar EM CIMA da arte
 * pronta.
 *
 * O que estes testes protegem, em ordem de quanto custa errar:
 *
 *  1. COBRANÇA. `ampliar` é sharp na nossa CPU e não pode debitar voxxy; os
 *     outros chamam o fornecedor e não podem sair de graça. A regra vive em
 *     `lib/atelie/ajustes.ts` e é o que decide por qual rota o ajuste corre.
 *  2. SSRF. A galeria aceita submissão de aluno, então `data.url` é texto que
 *     ELE escreve — e o servidor vai buscar. A allowlist de host é a única
 *     coisa entre isso e um `fetch` para dentro da nossa rede.
 *  3. DONO. `entry_id` vem do cliente. Sem a checagem, trocar um UUID na
 *     requisição ajusta (e baixa em resolução cheia) a arte de outro aluno.
 *  4. LINHAGEM. `parent_id` gravado é o que transforma a galeria numa árvore
 *     de iterações. Ele se perde em silêncio — nada quebra quando some.
 *  5. O TETO DA AMPLIAÇÃO. Ampliar o que já foi ampliado duas vezes devolve
 *     menos do que se pediu. Se ninguém disser isso, o aluno acha que quebrou.
 *
 * A única saída de rede é dublada (`fetch` e o cliente do OpenRouter). O sharp,
 * o motor e os schemas rodam de verdade.
 */

vi.mock('@/lib/openrouter.js', () => ({
	openrouter: { chat: { completions: { create: vi.fn() } } },
	PREVIA_MODEL: 'stub',
}));

/** O repositório de coleções é a borda de banco do `collection.image`. */
const findById = vi.fn();
const create = vi.fn();
const listChildren = vi.fn();
vi.mock('@/repositories/tool-collection.js', () => ({
	toolCollectionRepository: {
		findById: (...a: unknown[]) => findById(...a),
		create: (...a: unknown[]) => create(...a),
		listChildren: (...a: unknown[]) => listChildren(...a),
	},
}));

/** O storage é a borda de CDN do `output.save_gallery`. */
const uploadToolOutput = vi.fn();
vi.mock('@/lib/storage.js', () => ({
	uploadToolOutput: (...a: unknown[]) => uploadToolOutput(...a),
}));

// A allowlist lê a env na hora da chamada — definida antes de qualquer import
// que a use, para não depender de ordem de carregamento de módulo.
process.env.BUNNY_CDN_HOSTNAME = 'cdn.teste.net';

const {
	AJUSTES,
	AJUSTES_LOCAIS,
	acharAjuste,
	aiRodaDeGraca,
	ajusteEhLocal,
	resolverModoDoNo,
} = await import('@/lib/atelie/ajustes.js');
const { baixarImagemRemota, urlDeImagemPermitida } = await import(
	'@/lib/imagem-remota.js'
);
const { collectionImageBlock } = await import(
	'@/tool-blocks/blocks/collection-image.js'
);
const { imageStudioBlock, MAX_MP_AMPLIAR_PREVIEW, STUDIO_MODES } = await import(
	'@/tool-blocks/blocks/image-studio.js'
);
const { escalaEfetiva, MAX_MP_AMPLIAR, upscaleBlock } = await import(
	'@/tool-blocks/blocks/ai-extra.js'
);
const { comPipeline, executeTool, selecionarPipeline, ToolEngineError } =
	await import('@/lib/tool-engine.js');
const { blockRegistry } = await import('@/tool-blocks/registry.js');
const { registerCoreBlocks } = await import('@/tool-blocks/index.js');

/**
 * O controller do motor valida env de banco/upvox no topo dos módulos que
 * importa. Aqui nada disso é usado — o que interessa é UMA função pura dele
 * (`skipInPreview`) —, então os valores são de mentira mesmo.
 */
process.env.SUPABASE_URL ??= 'https://teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'chave-de-teste';
process.env.EXTERNAL_API_URL ??= 'http://localhost:1';
const { skipInPreview } = await import('@/controllers/tool-run.js');

const ctx = { customerId: 'aluno-1' };

/* ───────────────────────────── fixtures ───────────────────────────── */

/** PNG chapado de W×H — barato de criar e de ampliar. */
async function png(w: number, h: number): Promise<Buffer> {
	return sharp({
		create: {
			width: w,
			height: h,
			channels: 3,
			background: { r: 200, g: 120, b: 40 },
		},
	})
		.png()
		.toBuffer();
}

/** Uma linha de galeria como o `save_gallery` a grava. */
function entradaDaGaleria(over: Record<string, unknown> = {}) {
	return {
		id: 'arte-mae',
		tool_key: 'estudio_imagens',
		collection: 'galeria',
		title: 'Tábua de churrasco gravada',
		owner_id: 'aluno-1',
		data: {
			url: 'https://cdn.teste.net/estudio-imagens/aluno-1/arte.png',
			thumb_url:
				'https://cdn.teste.net/estudio-imagens/aluno-1/arte-thumb.webp',
			prompt: 'tábua de churrasco em madeira clara',
			modo: 'texto_imagem',
			aspecto: '1:1',
			parent_id: null,
			vector_ready: false,
		},
		...over,
	};
}

/** Resposta HTTP de verdade (Node dá `Response` nativa) — corpo em stream real. */
function respostaComImagem(buf: Buffer, status = 200): Response {
	return new Response(new Uint8Array(buf), {
		status,
		headers: {
			'content-type': 'image/png',
			'content-length': String(buf.byteLength),
		},
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
	findById.mockReset();
	create.mockReset();
	listChildren.mockReset();
	uploadToolOutput.mockReset();
	process.env.BUNNY_CDN_HOSTNAME = 'cdn.teste.net';
	delete process.env.IMAGEM_REMOTA_HOSTS_EXTRA;
});

/* ═══════════════════ 1. o catálogo e quem cobra ═══════════════════ */

describe('o catálogo dos Ajustes', () => {
	it('só oferece modos que o Estúdio realmente tem', () => {
		// Um id com erro de digitação aqui viraria um botão que responde
		// "params inválidos" DEPOIS de o aluno clicar.
		for (const a of AJUSTES) {
			expect(STUDIO_MODES as readonly string[]).toContain(a.id);
		}
	});

	it('classifica AMPLIAR como local e todos os outros como pagos', () => {
		expect(ajusteEhLocal('ampliar')).toBe(true);
		for (const modo of ['variacao', 'vetorizavel', 'remover_fundo']) {
			expect(ajusteEhLocal(modo), `${modo} não pode ser grátis`).toBe(false);
		}
	});

	it('deriva a lista de locais do próprio catálogo (uma fonte, não duas)', () => {
		const doCatalogo = AJUSTES.filter((a) => a.custo === 'local').map(
			(a) => a.id,
		);
		expect([...AJUSTES_LOCAIS].sort()).toEqual(doCatalogo.sort());
	});

	it('não trata modo desconhecido nem vazio como grátis', () => {
		expect(ajusteEhLocal(null)).toBe(false);
		expect(ajusteEhLocal(undefined)).toBe(false);
		expect(ajusteEhLocal('')).toBe(false);
		expect(ajusteEhLocal('texto_imagem')).toBe(false);
		expect(acharAjuste('texto_imagem')).toBeUndefined();
	});

	it('exige texto exatamente nos ajustes que o schema do bloco exige', () => {
		// `variacao` e `vetorizavel` caem no `superRefine` que pede prompt; um
		// botão sem campo de texto neles devolveria 400 no clique.
		expect(acharAjuste('variacao')?.pedeTexto).toBe(true);
		expect(acharAjuste('vetorizavel')?.pedeTexto).toBe(true);
		expect(acharAjuste('ampliar')?.pedeTexto).toBe(false);
		expect(acharAjuste('remover_fundo')?.pedeTexto).toBe(false);
	});
});

describe('descobrir o modo antes de rodar (é o que decide grátis ou pago)', () => {
	it('lê o literal escrito na definition', () => {
		expect(resolverModoDoNo({ mode: 'ampliar' }, {})).toBe('ampliar');
	});

	it('resolve `input.x` contra os campos do request, como o motor faria', () => {
		expect(resolverModoDoNo({ mode: 'input.modo' }, { modo: 'ampliar' })).toBe(
			'ampliar',
		);
	});

	it('na dúvida devolve null — e null vale como PAGO', () => {
		// Campo ausente, referência à saída de outro nó, params vazio: em nenhum
		// desses dá para afirmar que o run é local.
		expect(resolverModoDoNo({ mode: 'input.modo' }, {})).toBeNull();
		expect(resolverModoDoNo({ mode: 'algum_no.modo' }, {})).toBeNull();
		expect(resolverModoDoNo({}, {})).toBeNull();
		expect(resolverModoDoNo(undefined, {})).toBeNull();
		expect(aiRodaDeGraca('ai.image_studio', { mode: 'input.modo' }, {})).toBe(
			false,
		);
	});

	it('abre a exceção do preview SÓ para o Estúdio em modo local', () => {
		expect(aiRodaDeGraca('ai.image_studio', { mode: 'ampliar' }, {})).toBe(
			true,
		);
		expect(aiRodaDeGraca('ai.image_studio', { mode: 'variacao' }, {})).toBe(
			false,
		);
		// Mesmo modo, bloco errado: o time de agentes não roda de graça nunca.
		expect(aiRodaDeGraca('ai.art_team', { mode: 'ampliar' }, {})).toBe(false);
		expect(aiRodaDeGraca('ai.generate_image', { mode: 'ampliar' }, {})).toBe(
			false,
		);
	});
});

describe('o filtro do preview (a rota NÃO cobrada)', () => {
	it('deixa passar o Estúdio no modo local — é a única exceção', () => {
		expect(
			skipInPreview(
				{ block: 'ai.image_studio', params: { mode: 'input.modo' } },
				{ modo: 'ampliar' },
			),
		).toBe(false);
	});

	it('barra o MESMO bloco nos modos que chamam o fornecedor', () => {
		for (const modo of ['variacao', 'vetorizavel', 'texto_imagem']) {
			expect(
				skipInPreview(
					{ block: 'ai.image_studio', params: { mode: 'input.modo' } },
					{ modo },
				),
				`${modo} não pode rodar de graça`,
			).toBe(true);
		}
		// `remover_fundo` é híbrido: às vezes resolve local, às vezes chama o
		// Gemini. Como não dá para saber antes, fica fora do grátis.
		expect(
			skipInPreview(
				{ block: 'ai.image_studio', params: { mode: 'remover_fundo' } },
				{},
			),
		).toBe(true);
	});

	it('não afrouxou nada do que já era barrado', () => {
		for (const block of [
			'ai.art_team',
			'ai.text',
			'ai.generate_image',
			'output.save_gallery',
			'image.upscale',
			'image.removeBackground',
			'algo.persist',
			'algo.save',
		]) {
			expect(skipInPreview({ block }, {}), `${block} voltou a rodar`).toBe(
				true,
			);
		}
	});

	it('continua deixando passar o que sempre passou (orçamento ao vivo)', () => {
		for (const block of ['cad.parse', 'quote.price', 'image.adjust']) {
			expect(skipInPreview({ block }, {})).toBe(false);
		}
	});
});

/* ═══════════════════ 2. a allowlist (SSRF) ═══════════════════ */

describe('de onde o servidor aceita baixar imagem', () => {
	it('aceita a nossa CDN por HTTPS', () => {
		expect(urlDeImagemPermitida('https://cdn.teste.net/a/b.png')).toBe(true);
	});

	it('recusa host de fora, HTTP puro, credencial embutida e lixo', () => {
		expect(urlDeImagemPermitida('https://evil.com/a.png')).toBe(false);
		// O clássico: host permitido no meio da URL, host real no fim.
		expect(urlDeImagemPermitida('https://cdn.teste.net@evil.com/a.png')).toBe(
			false,
		);
		expect(urlDeImagemPermitida('http://cdn.teste.net/a.png')).toBe(false);
		expect(
			urlDeImagemPermitida('https://169.254.169.254/latest/meta-data'),
		).toBe(false);
		expect(urlDeImagemPermitida('file:///etc/passwd')).toBe(false);
		expect(urlDeImagemPermitida('não é url')).toBe(false);
	});

	it('sem a env da CDN, NADA é permitido (env ausente não libera geral)', () => {
		process.env.BUNNY_CDN_HOSTNAME = '';
		expect(urlDeImagemPermitida('https://cdn.teste.net/a.png')).toBe(false);
	});

	it('nem chega a abrir conexão para host proibido', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		await expect(
			baixarImagemRemota('https://evil.com/a.png'),
		).rejects.toMatchObject({ status: 400 });
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('baixar a imagem da nossa CDN', () => {
	const url = 'https://cdn.teste.net/estudio-imagens/aluno-1/arte.png';

	it('devolve o PNG decodificado com as dimensões reais', async () => {
		const arte = await png(120, 80);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaComImagem(arte));
		const img = await baixarImagemRemota(url);
		expect(img.width).toBe(120);
		expect(img.height).toBe(80);
		expect((await sharp(img.png).metadata()).format).toBe('png');
	});

	it('recusa antes de baixar quando o tamanho declarado já estoura', async () => {
		const arte = await png(8, 8);
		const res = new Response(new Uint8Array(arte), {
			headers: { 'content-length': String(99 * 1024 * 1024) },
		});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
		await expect(baixarImagemRemota(url)).rejects.toMatchObject({
			status: 413,
		});
	});

	it('corta no meio quando o content-length MENTE', async () => {
		// O teto de verdade é a contagem byte a byte: um servidor pode declarar
		// 10 bytes e mandar 10 MB.
		const arte = await png(300, 300);
		const res = new Response(new Uint8Array(arte), {
			headers: { 'content-length': '10' },
		});
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
		await expect(
			baixarImagemRemota(url, { maxBytes: 100 }),
		).rejects.toMatchObject({ status: 413 });
	});

	it('404 da CDN vira 404 com recado, não 500', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('', { status: 404 }),
		);
		await expect(baixarImagemRemota(url)).rejects.toMatchObject({
			status: 404,
		});
	});

	it('bytes que não são imagem viram 422 (o decoder é a prova, não a extensão)', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(new Uint8Array(Buffer.from('<html>não sou png</html>'))),
		);
		await expect(baixarImagemRemota(url)).rejects.toMatchObject({
			status: 422,
		});
	});
});

/* ═══════════════════ 3. a ida: a arte volta como bytes ═══════════════════ */

describe('collection.image — a arte da galeria virando entrada do ajuste', () => {
	it('traz a imagem e os metadados que a linhagem precisa', async () => {
		const arte = await png(64, 64);
		findById.mockResolvedValue(entradaDaGaleria());
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaComImagem(arte));

		const out = await collectionImageBlock.run(
			ctx,
			collectionImageBlock.paramsSchema.parse({
				tool: 'estudio_imagens',
				entry_id: 'arte-mae',
			}),
		);

		expect(Buffer.isBuffer(out.png)).toBe(true);
		expect(out.width).toBe(64);
		// É este id que vira o `parent_id` do filho. Sem ele, árvore nenhuma.
		expect(out.entry_id).toBe('arte-mae');
		expect(out.prompt).toBe('tábua de churrasco em madeira clara');
		expect(out.origem).toBe('galeria');
	});

	it('recusa a arte de OUTRO aluno com a mesma resposta de "não existe"', async () => {
		findById.mockResolvedValue(entradaDaGaleria({ owner_id: 'outro-aluno' }));
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		await expect(
			collectionImageBlock.run(
				ctx,
				collectionImageBlock.paramsSchema.parse({
					tool: 'estudio_imagens',
					entry_id: 'arte-mae',
				}),
			),
		).rejects.toMatchObject({ status: 404 });
		// E não baixou nada: a checagem de dono vem ANTES da rede.
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('registro inexistente devolve exatamente a mesma coisa (não confirma existência alheia)', async () => {
		findById.mockResolvedValue(null);
		await expect(
			collectionImageBlock.run(
				ctx,
				collectionImageBlock.paramsSchema.parse({
					tool: 'estudio_imagens',
					entry_id: 'sumiu',
				}),
			),
		).rejects.toMatchObject({ status: 404 });
	});

	it('registro sem arquivo guardado é 422, não 500', async () => {
		findById.mockResolvedValue(entradaDaGaleria({ data: { prompt: 'x' } }));
		await expect(
			collectionImageBlock.run(
				ctx,
				collectionImageBlock.paramsSchema.parse({
					tool: 'estudio_imagens',
					entry_id: 'arte-mae',
				}),
			),
		).rejects.toMatchObject({ status: 422 });
	});

	it('sem id e sem bytes, pede a arte em português — não estoura', async () => {
		await expect(
			collectionImageBlock.run(
				ctx,
				collectionImageBlock.paramsSchema.parse({ tool: 'estudio_imagens' }),
			),
		).rejects.toMatchObject({ status: 400 });
	});

	it('plano B: bytes do navegador entram, mas SEM linhagem', async () => {
		const arte = await png(40, 20);
		const out = await collectionImageBlock.run(
			ctx,
			collectionImageBlock.paramsSchema.parse({
				tool: 'estudio_imagens',
				imagem: arte,
			}),
		);
		expect(out.origem).toBe('upload');
		expect(out.width).toBe(40);
		// Bytes soltos não provam de qual arte vieram — `parent_id` seria palpite.
		expect(out.entry_id).toBeNull();
	});
});

/* ═══════════════ 4. ampliar: o teto e a honestidade sobre ele ═══════════════ */

describe('o teto da ampliação', () => {
	it('respeita o fator pedido quando cabe', () => {
		expect(escalaEfetiva(1024, 1024, 2)).toBe(2);
		expect(escalaEfetiva(1024, 1024, 4)).toBe(4);
	});

	/**
	 * O caso que o produto pediu por escrito: ampliar uma arte que JÁ FOI
	 * ampliada duas vezes. 1024 → 2048 → 4096; no terceiro pedido o teto de
	 * megapixels entra e o "4×" vira ~1,55×.
	 */
	it('encolhe o fator na terceira ampliação em vez de estourar', () => {
		const um = escalaEfetiva(1024, 1024, 2);
		expect(um).toBe(2);
		const dois = escalaEfetiva(2048, 2048, 2);
		expect(dois).toBe(2);
		const tres = escalaEfetiva(4096, 4096, 4);
		expect(tres).toBeCloseTo(Math.sqrt(MAX_MP_AMPLIAR / (4096 * 4096)), 3);
		expect(tres).toBeGreaterThan(1);
		expect(tres).toBeLessThan(2);
		// E o resultado continua dentro do teto de pixels.
		expect((4096 * tres) ** 2).toBeLessThanOrEqual(MAX_MP_AMPLIAR + 1);
	});

	it('nunca encolhe a imagem (o piso é 1×, mesmo no absurdo)', () => {
		expect(escalaEfetiva(9000, 9000, 16)).toBe(1);
		expect(escalaEfetiva(0, 0, 4)).toBe(4);
	});

	it('o teto do preview é mais apertado que o do run cobrado', () => {
		const cobrado = escalaEfetiva(2048, 2048, 4);
		const gratis = escalaEfetiva(2048, 2048, 4, {
			maxMp: MAX_MP_AMPLIAR_PREVIEW,
		});
		expect(gratis).toBeLessThan(cobrado);
		// 4× sobre a arte quadrada padrão (1024) continua passando inteiro.
		expect(
			escalaEfetiva(1024, 1024, 4, { maxMp: MAX_MP_AMPLIAR_PREVIEW }),
		).toBe(4);
	});

	it('o bloco de upscale honra um teto de megapixels menor', async () => {
		const base = await png(600, 600);
		const out = await upscaleBlock.run(
			ctx,
			upscaleBlock.paramsSchema.parse({
				image: base,
				factor: '4',
				max_mp: 1_000_000,
			}),
		);
		const meta = await sharp(out.png as Buffer).metadata();
		expect((meta.width ?? 0) * (meta.height ?? 0)).toBeLessThanOrEqual(
			1_000_001,
		);
		expect(meta.width).toBe(1000);
	});
});

describe('ai.image_studio no modo ampliar', () => {
	it('diz quanto pediu e quanto ampliou de verdade', async () => {
		const base = await png(64, 64);
		const out = await imageStudioBlock.run(
			ctx,
			imageStudioBlock.paramsSchema.parse({
				mode: 'ampliar',
				image: base,
				factor: '2',
			}),
		);
		expect(out.width).toBe(128);
		expect(out.escala_pedida).toBe(2);
		expect(out.escala_real).toBe(2);
		expect(out.limite_ampliacao).toBe(false);
		// Não é geração: modelo nenhum rodou, e a galeria precisa registrar isso.
		expect(out.model).toBeNull();
		expect(out.cost_multiplier).toBe(0);
	});

	it('avisa quando entregou menos do que foi pedido', async () => {
		// Imagem larguíssima: o teto de LADO (10.000 px) entra com poucos pixels
		// no total, então o caso real é exercitado sem alocar 40 MP no teste.
		const tira = await png(9000, 2);
		const out = await imageStudioBlock.run(
			ctx,
			imageStudioBlock.paramsSchema.parse({
				mode: 'ampliar',
				image: tira,
				factor: '4',
			}),
		);
		expect(out.escala_pedida).toBe(4);
		expect(out.escala_real as number).toBeLessThan(4);
		expect(out.limite_ampliacao).toBe(true);
		expect(out.width).toBe(10_000);
	});

	it('no preview aperta o teto — o run de graça não devolve arquivo gigante', async () => {
		const espiao = vi.spyOn(upscaleBlock, 'run');
		const base = await png(32, 32);

		await imageStudioBlock.run(
			{ ...ctx, preview: true },
			imageStudioBlock.paramsSchema.parse({
				mode: 'ampliar',
				image: base,
				factor: '2',
			}),
		);
		expect(espiao.mock.calls[0]?.[1]).toMatchObject({
			max_mp: MAX_MP_AMPLIAR_PREVIEW,
		});

		espiao.mockClear();
		await imageStudioBlock.run(
			ctx,
			imageStudioBlock.paramsSchema.parse({
				mode: 'ampliar',
				image: base,
				factor: '2',
			}),
		);
		// Fora do preview o run é cobrado e vale o teto cheio: nada de `max_mp`.
		expect(espiao.mock.calls[0]?.[1]).not.toHaveProperty('max_mp');
	});

	it('não inventa escala nos modos que não são ampliação', async () => {
		const base = await png(32, 32);
		const out = await imageStudioBlock.run(
			ctx,
			imageStudioBlock.paramsSchema.parse({
				mode: 'remover_fundo',
				image: base,
			}),
		);
		// `1` aqui seria lido pela tela como "ampliei uma vez", que é falso.
		expect(out.escala_real).toBeNull();
		expect(out.escala_pedida).toBeNull();
		expect(out.limite_ampliacao).toBe(false);
	});
});

/* ═══════════════════ 5. fluxos nomeados no motor ═══════════════════ */

const ecoSchema = z.object({ v: z.unknown() });
blockRegistry.register({
	id: 'test.eco_fluxo',
	category: 'test',
	description: 'eco para os testes de fluxo',
	paramsSchema: ecoSchema,
	async run(_ctx, p: z.infer<typeof ecoSchema>) {
		return { v: p.v };
	},
});

const docDoisFluxos = {
	pipeline: [
		{ id: 'criar', block: 'test.eco_fluxo', params: { v: 'do criar' } },
	],
	pipelines: {
		ajustar: [
			{ id: 'ajuste', block: 'test.eco_fluxo', params: { v: 'do ajustar' } },
		],
	},
	output: { criado: 'criar.v', ajustado: 'ajuste.v' },
};

describe('uma tool, mais de um caminho', () => {
	it('sem fluxo pedido, roda o pipeline de sempre', () => {
		expect(selecionarPipeline(docDoisFluxos)[0].id).toBe('criar');
		expect(selecionarPipeline(docDoisFluxos, '')[0].id).toBe('criar');
	});

	it('com fluxo pedido, roda o pipeline daquele nome', () => {
		expect(selecionarPipeline(docDoisFluxos, 'ajustar')[0].id).toBe('ajuste');
	});

	it('fluxo inexistente é 400, e nunca cai no padrão em silêncio', () => {
		// Cair no padrão significaria rodar o time de seis especialistas — caro,
		// demorado e cobrado — para quem pediu "ampliar".
		expect(() => selecionarPipeline(docDoisFluxos, 'inventado')).toThrow(
			ToolEngineError,
		);
		try {
			selecionarPipeline(docDoisFluxos, 'inventado');
		} catch (err) {
			expect((err as InstanceType<typeof ToolEngineError>).status).toBe(400);
		}
	});

	it('executa só os nós do fluxo escolhido', async () => {
		const saida = await executeTool(docDoisFluxos, {}, ctx, 'ajustar');
		expect(saida.ajustado).toBe('do ajustar');
		// A chave do outro fluxo some da resposta — não vira o texto "criar.v".
		expect(saida.criado).toBeUndefined();
	});

	it('referência a nó de outro fluxo resolve vazia, não vira string literal', async () => {
		const saida = await executeTool(docDoisFluxos, {}, ctx);
		expect(saida.criado).toBe('do criar');
		expect(saida.ajustado).toBeUndefined();
		expect(saida.ajustado).not.toBe('ajuste.v');
	});

	it('tool sem fluxos nomeados continua igualzinha', async () => {
		const antigo = {
			pipeline: [{ id: 'n', block: 'test.eco_fluxo', params: { v: 'legado' } }],
			output: { x: 'n.v' },
		};
		expect(await executeTool(antigo, {}, ctx)).toEqual({ x: 'legado' });
	});

	it('dois fluxos podem repetir id de nó (é o que faz uma `output` servir aos dois)', async () => {
		const doc = {
			pipeline: [{ id: 'arte', block: 'test.eco_fluxo', params: { v: 'A' } }],
			pipelines: {
				ajustar: [{ id: 'arte', block: 'test.eco_fluxo', params: { v: 'B' } }],
			},
			output: { arte: 'arte.v' },
		};
		expect(await executeTool(doc, {}, ctx)).toEqual({ arte: 'A' });
		expect(await executeTool(doc, {}, ctx, 'ajustar')).toEqual({ arte: 'B' });
	});

	it('id duplicado DENTRO do mesmo fluxo continua sendo erro', async () => {
		const doc = {
			pipelines: {
				ajustar: [
					{ id: 'arte', block: 'test.eco_fluxo', params: { v: 'A' } },
					{ id: 'arte', block: 'test.eco_fluxo', params: { v: 'B' } },
				],
			},
		};
		await expect(executeTool(doc, {}, ctx, 'ajustar')).rejects.toThrow(
			/duplicado/,
		);
	});

	it('comPipeline troca só o fluxo alvo e preserva o resto', () => {
		const trocado = comPipeline(docDoisFluxos, 'ajustar', []);
		expect(trocado.pipelines?.ajustar).toEqual([]);
		expect(trocado.pipeline?.[0].id).toBe('criar');
	});
});

/* ═══════════ 6. o caminho inteiro: ida, ajuste e linhagem gravada ═══════════ */

describe('um Ajuste de ponta a ponta', () => {
	/**
	 * O pipeline que a definition do Ateliê vai declarar no fluxo `ajustar`:
	 * a arte da galeria volta como bytes, o Estúdio ajusta, e o resultado é
	 * gravado APONTANDO PARA A ORIGEM. É o teste que prova a árvore.
	 */
	const fluxoAjustar = {
		input: {
			origem_id: { type: 'string' as const, default: '' },
			modo: { type: 'string' as const, default: 'ampliar' },
		},
		pipelines: {
			ajustar: [
				{
					id: 'origem',
					block: 'collection.image',
					params: {
						tool: 'estudio_imagens',
						collection: 'galeria',
						entry_id: 'input.origem_id',
					},
				},
				{
					id: 'arte',
					block: 'ai.image_studio',
					params: {
						mode: 'input.modo',
						image: 'origem.png',
						factor: '2',
					},
				},
				{
					id: 'salvar',
					block: 'output.save_gallery',
					params: {
						from: 'arte.png',
						tool: 'estudio_imagens',
						collection: 'galeria',
						folder: 'estudio-imagens',
						title: 'origem.titulo',
						modo: 'arte.mode',
						prompt: 'origem.prompt',
						modelo: 'arte.model',
						aspecto: 'origem.aspecto',
						largura: 'arte.width',
						altura: 'arte.height',
						parent_id: 'origem.entry_id',
					},
				},
			],
		},
		output: {
			preview: 'arte.pngBase64',
			url: 'salvar.url',
			entry_id: 'salvar.entry_id',
			escala_real: 'arte.escala_real',
		},
	};

	it('amplia a arte da galeria e grava o filho apontando para a mãe', async () => {
		registerCoreBlocks();
		const arte = await png(100, 50);
		findById.mockResolvedValue(entradaDaGaleria());
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaComImagem(arte));
		uploadToolOutput.mockResolvedValue('https://cdn.teste.net/nova.png');
		create.mockResolvedValue({ id: 'arte-filha' });

		const { coerceInputs } = await import('@/lib/tool-engine.js');
		const bag = coerceInputs(
			fluxoAjustar.input,
			{ origem_id: 'arte-mae', modo: 'ampliar' },
			null,
		);
		const saida = await executeTool(fluxoAjustar, bag, ctx, 'ajustar');

		expect(saida.entry_id).toBe('arte-filha');
		expect(saida.escala_real).toBe(2);

		const gravado = create.mock.calls[0]?.[0] as {
			data: Record<string, unknown>;
			ownerId: string;
			visibility: string;
		};
		// A LINHA DA ÁRVORE.
		expect(gravado.data.parent_id).toBe('arte-mae');
		expect(gravado.data.largura).toBe(200);
		expect(gravado.data.altura).toBe(100);
		expect(gravado.data.modo).toBe('ampliar');
		// O prompt herdado da mãe: sem ele o filho nasce sem descrição nenhuma.
		expect(gravado.data.prompt).toBe('tábua de churrasco em madeira clara');
		expect(gravado.ownerId).toBe('aluno-1');
		expect(gravado.visibility).toBe('owner');
	});

	it('o ajuste de outro dono morre ANTES de gerar, gravar ou gastar', async () => {
		registerCoreBlocks();
		findById.mockResolvedValue(entradaDaGaleria({ owner_id: 'outro-aluno' }));
		const { coerceInputs } = await import('@/lib/tool-engine.js');
		const bag = coerceInputs(
			fluxoAjustar.input,
			{ origem_id: 'arte-mae', modo: 'ampliar' },
			null,
		);

		await expect(
			executeTool(fluxoAjustar, bag, ctx, 'ajustar'),
		).rejects.toMatchObject({ status: 404 });
		expect(uploadToolOutput).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});

	it('sem escolher a arte de origem, o run para no primeiro nó com recado', async () => {
		registerCoreBlocks();
		const { coerceInputs } = await import('@/lib/tool-engine.js');
		const bag = coerceInputs(fluxoAjustar.input, { modo: 'ampliar' }, null);
		await expect(
			executeTool(fluxoAjustar, bag, ctx, 'ajustar'),
		).rejects.toMatchObject({ status: 400 });
		expect(create).not.toHaveBeenCalled();
	});

	/**
	 * Os NOMES são o contrato com a definition (que mora no outro repositório).
	 * Renomear uma saída aqui não quebra compilação nenhuma: o motor resolve a
	 * ref para `undefined` e o filho nasce sem prompt, sem tamanho e — o pior —
	 * sem pai, em silêncio. Este teste é o alarme.
	 */
	it('as saídas do collection.image cobrem as refs que a definition liga', async () => {
		const arte = await png(16, 16);
		findById.mockResolvedValue(entradaDaGaleria());
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaComImagem(arte));
		const out = await collectionImageBlock.run(
			ctx,
			collectionImageBlock.paramsSchema.parse({
				tool: 'estudio_imagens',
				entry_id: 'arte-mae',
			}),
		);
		for (const chave of [
			'png',
			'entry_id',
			'url',
			'titulo',
			'prompt',
			'modo',
			'aspecto',
			'parent_id',
			'vector_ready',
			'width',
			'height',
			'origem',
		]) {
			expect(out, `collection.image perdeu '${chave}'`).toHaveProperty(chave);
		}
	});
});
