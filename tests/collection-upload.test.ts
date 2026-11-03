import multipart from '@fastify/multipart';
import { type FastifyInstance, fastify } from 'fastify';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.hoisted` roda ANTES dos imports — é o único jeito de plantar as envs que
 * `lib/external-auth` e o cliente de texto validam no topo do próprio arquivo.
 * Nenhuma é usada: tudo que sai da máquina está mockado abaixo.
 */
vi.hoisted(() => {
	process.env.EXTERNAL_API_URL ??= 'https://upvox.test';
	process.env.OPENROUTER_API_KEY ??= 'chave-de-teste';
	process.env.SUPABASE_URL ??= 'https://supabase.test';
	process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'chave-de-teste';
});

/**
 * UPLOAD DE IMAGEM DO ALUNO + O FURO DO `visibility`.
 *
 * Duas coisas que só existem juntas: o aluno cadastra a identidade da empresa
 * dele (logo + cores) uma vez e reusa. O logo é um ARQUIVO — e até agora só
 * admin subia arquivo. O cadastro é um REGISTRO DE COLEÇÃO — e até agora quem
 * decidia se ele nascia público era o corpo do POST.
 *
 * Os testes batem no controller de verdade, por HTTP de verdade, com o
 * multipart registrado EXATAMENTE como em produção (1,5 GB globais). É o único
 * jeito de provar que o teto de 5 MB por request existe: se alguém apagar o
 * `limits` do `request.file()`, o teste do arquivo gigante passa a devolver 200.
 *
 * Falso aqui é só a borda: banco, CDN, Redis e a definition da tool.
 */

/* ───────────────────────────── bordas mockadas ───────────────────────────── */

const repoCreate = vi.fn();

vi.mock('@/repositories/tool-collection.js', () => ({
	rangeFields: () => [],
	toolCollectionRepository: {
		create: (...a: unknown[]) => repoCreate(...a),
	},
}));

/** A definition da tool, trocada por teste. */
let definitionAtual: Record<string, unknown> = {};

vi.mock('@/lib/tool-definitions.js', () => ({
	loadPublishedToolDefinition: async () => ({ definition: definitionAtual }),
	ToolDefinitionLoadError: class ToolDefinitionLoadError extends Error {
		status = 404;
	},
}));

/**
 * Espião sobre a higienização (que continua REAL, só embrulhada). Serve para
 * provar que um arquivo grande demais é recusado ANTES de chegar aqui — ou
 * seja, pelo teto do multipart, e não depois de já ter sido carregado inteiro
 * na memória do processo.
 */
const { preparaSpy } = vi.hoisted(() => ({ preparaSpy: vi.fn() }));
vi.mock('@/lib/collection-upload.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('@/lib/collection-upload.js')>();
	return {
		...real,
		prepararImagemDoAluno: (bruto: Buffer) => {
			preparaSpy(bruto);
			return real.prepararImagemDoAluno(bruto);
		},
	};
});

/**
 * A extração de cor continua REAL (é o k-means de verdade que queremos exercer);
 * a embalagem só permite fazê-la FALHAR de propósito num teste. É assim que se
 * prova que a paleta é enfeite: quebrando-a e vendo o upload chegar inteiro.
 */
const { paletaQuebrada } = vi.hoisted(() => ({
	paletaQuebrada: { on: false },
}));
vi.mock('@/lib/vectorize-color.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('@/lib/vectorize-color.js')>();
	return {
		...real,
		extractPalette: (...args: Parameters<typeof real.extractPalette>) => {
			if (paletaQuebrada.on) throw new Error('k-means explodiu');
			return real.extractPalette(...args);
		},
	};
});

const uploadSpy = vi.fn(
	async (
		_pasta: string,
		_buffer: Buffer,
		_caminho: string,
		_mime: string,
	): Promise<string> => 'https://cdn.exemplo/aluno/x/arquivo.png',
);
vi.mock('@/lib/storage.js', () => ({
	uploadToolOutput: (
		pasta: string,
		buffer: Buffer,
		caminho: string,
		mime: string,
	) => uploadSpy(pasta, buffer, caminho, mime),
}));

/** Contador do teto por hora. -1 = "sem Redis" (fail-open), como em produção. */
let contadorRedis = -1;
vi.mock('@/lib/redis.js', () => ({
	incrWithTtl: async () => contadorRedis,
	cache: {
		cacheAside: async (_k: string, _t: number, f: () => unknown) => f(),
	},
}));

/**
 * Auth falsa PARA MONTAR A ROTA DE VERDADE (ver o último describe). O
 * `preHandler` real está soldado dentro de `toolCollectionRoute`, então é o
 * módulo do middleware que precisa ser trocado — os outros testes deste arquivo
 * montam o controller na mão e não passam por aqui.
 */
vi.mock('@/middleware/auth.js', () => ({
	authenticateCustomer: async (request: {
		currentUser?: unknown;
		currentRole?: string;
		currentCustomer?: unknown;
	}) => {
		request.currentUser = { id: ator.id, name: 'Aluno' };
		request.currentRole = ator.role;
		request.currentCustomer = { id: ator.id, name: 'Aluno', image: null };
	},
}));

import {
	createCollectionEntryController,
	uploadCollectionImageController,
} from '@/controllers/tool-collection.js';
import { prepararImagemDoAluno } from '@/lib/collection-upload.js';
import { toolCollectionRoute } from '@/routes/tool-collection.js';

/* ────────────────────────────── fixtures ────────────────────────────── */

const ALUNO = '11111111-1111-4111-8111-111111111111';
const OUTRO_ALUNO = '22222222-2222-4222-8222-222222222222';

const TOM = 'Rústico e artesanal';

/**
 * A coleção "Minha marca": aluno cria, sem moderação, só o dono vê.
 *
 * ESPELHO de `api-upvox/scripts/seed-estudio-imagens.ts` (a fonte de verdade,
 * que este repositório não importa). Os dez campos estão aqui porque campo não
 * declarado é DESCARTADO EM SILÊNCIO por `validateCollectionData` — um erro de
 * digitação no seed não derruba nada, só faz a cor da marca sumir do cadastro
 * sem uma linha de log. O teste "nenhum campo é descartado" abaixo é o que
 * transforma esse silêncio em vermelho.
 */
const marca = {
	label: 'Minha marca',
	titleLabel: 'Nome da marca',
	fields: [
		{
			name: 'nome',
			label: 'Nome como aparece na arte',
			type: 'text',
			required: true,
		},
		{ name: 'publico', label: 'Para quem você vende', type: 'textarea' },
		{
			name: 'tom_de_voz',
			label: 'Jeito da marca',
			type: 'enum',
			options: [TOM, 'Simples e direto'],
		},
		{ name: 'logo_url', label: 'Logo da empresa', type: 'image' },
		{ name: 'cor_primaria', label: 'Cor principal', type: 'text' },
		{ name: 'cor_secundaria', label: 'Cor de apoio', type: 'text' },
		{ name: 'cor_fundo', label: 'Cor de fundo das peças', type: 'text' },
		{ name: 'fonte', label: 'Letra da marca', type: 'text' },
		{
			name: 'exemplo_url',
			label: 'Uma peça com a cara da marca',
			type: 'image',
		},
		{ name: 'nao_usar', label: 'O que NUNCA usar', type: 'textarea' },
	],
	submissions: { who: 'student', moderation: 'none', ownerEditable: true },
	visibility: 'owner',
};

/** Coleção de catálogo: só admin cria, e o registro é público de propósito. */
const materiais = {
	label: 'Materiais',
	fields: [{ name: 'material', type: 'text' }],
	submissions: { who: 'admin' },
};

function pngValido(): Promise<Buffer> {
	return sharp({
		create: { width: 40, height: 40, channels: 3, background: '#e11d1d' },
	})
		.png()
		.toBuffer();
}

/** Pinta um retângulo cheio num raster RGB cru. */
function pinta(
	px: Buffer,
	w: number,
	caixa: { x: number; y: number; larg: number; alt: number },
	cor: [number, number, number],
) {
	for (let y = caixa.y; y < caixa.y + caixa.alt; y++) {
		for (let x = caixa.x; x < caixa.x + caixa.larg; x++) {
			const i = (y * w + x) * 3;
			px[i] = cor[0];
			px[i + 1] = cor[1];
			px[i + 2] = cor[2];
		}
	}
}

/**
 * O que um LOGO é para o classificador: arte chapada, poucas cores, sem
 * degradê, em cima do branco do arquivo. Vermelho ocupa o dobro do azul — é o
 * que faz `primary` ser previsível em vez de sorteado.
 */
async function logoChapado(): Promise<Buffer> {
	const w = 300;
	const h = 300;
	const px = Buffer.alloc(w * h * 3, 255);
	pinta(px, w, { x: 40, y: 40, larg: 220, alt: 120 }, [225, 29, 29]);
	pinta(px, w, { x: 90, y: 200, larg: 120, alt: 60 }, [29, 63, 225]);
	return sharp(px, { raw: { width: w, height: h, channels: 3 } })
		.png()
		.toBuffer();
}

/**
 * O que uma FOTO é: tom contínuo, muitos níveis, transição suave. Uma foto de
 * produto na bancada tem exatamente essas três coisas.
 */
async function fotoDeProduto(): Promise<Buffer> {
	const w = 400;
	const h = 300;
	const px = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			px[i] = Math.min(
				255,
				Math.round(30 + (x / w) * 200 + Math.sin(y / 9) * 12),
			);
			px[i + 1] = Math.min(
				255,
				Math.round(60 + (y / h) * 150 + Math.cos(x / 11) * 10),
			);
			px[i + 2] = Math.min(255, Math.round(90 + ((x + y) / (w + h)) * 140));
		}
	}
	return sharp(px, { raw: { width: w, height: h, channels: 3 } })
		.jpeg({ quality: 85 })
		.toBuffer();
}

/* ───────────────────────── app Fastify de verdade ───────────────────────── */

/** Quem está chamando. Trocado por teste. */
let ator: { id: string; role: string } = { id: ALUNO, role: 'customer' };

/**
 * O multipart entra com 1,5 GB — o MESMO valor de `src/server.ts`. É essa
 * igualdade que dá sentido ao teste do arquivo gigante: quem segura os 5 MB é o
 * override por request, dentro do controller.
 */
async function montaApp(): Promise<FastifyInstance> {
	const app = fastify();
	await app.register(multipart, { limits: { fileSize: 1500 * 1024 * 1024 } });
	const autentica = async (request: {
		currentUser?: unknown;
		currentRole?: string;
		currentCustomer?: unknown;
	}) => {
		request.currentUser = { id: ator.id, name: 'Aluno' };
		request.currentRole = ator.role;
		if (ator.role === 'customer') {
			request.currentCustomer = { id: ator.id, name: 'Aluno', image: null };
		}
	};
	app.post(
		'/api/tools/:key/c/:collection/upload-image',
		// biome-ignore lint/suspicious/noExplicitAny: preHandler de teste
		{ preHandler: [autentica as any] },
		uploadCollectionImageController,
	);
	app.post(
		'/api/tools/:key/c/:collection',
		// biome-ignore lint/suspicious/noExplicitAny: preHandler de teste
		{ preHandler: [autentica as any] },
		createCollectionEntryController,
	);
	await app.ready();
	return app;
}

const BOUNDARY = '----vitestUploadColecao';

/** Corpo multipart de verdade — é o busboy que queremos exercitar. */
function corpoMultipart(arquivo: {
	nome: string;
	conteudo: Buffer | string;
	mime: string;
}): Buffer {
	return Buffer.concat([
		Buffer.from(
			`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${arquivo.nome}"\r\n` +
				`Content-Type: ${arquivo.mime}\r\n\r\n`,
		),
		Buffer.isBuffer(arquivo.conteudo)
			? arquivo.conteudo
			: Buffer.from(arquivo.conteudo, 'utf8'),
		Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
	]);
}

async function postaArquivo(
	app: FastifyInstance,
	arquivo: { nome: string; conteudo: Buffer | string; mime: string },
	colecao = 'marca',
) {
	return app.inject({
		method: 'POST',
		url: `/api/tools/estudio_imagens/c/${colecao}/upload-image`,
		headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
		payload: corpoMultipart(arquivo),
	});
}

let app: FastifyInstance;

beforeEach(async () => {
	vi.clearAllMocks();
	uploadSpy.mockResolvedValue('https://cdn.exemplo/aluno/x/arquivo.png');
	repoCreate.mockImplementation(async (input: Record<string, unknown>) => ({
		id: 'entry-1',
		title: input.title,
		description: null,
		category: null,
		data: input.data,
		score: 0,
		stats: {},
		owner_id: input.ownerId,
		visibility: input.visibility,
		status: input.status,
		active: true,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
	definitionAtual = { collections: { marca, materiais } };
	ator = { id: ALUNO, role: 'customer' };
	contadorRedis = -1;
	paletaQuebrada.on = false;
	app = await montaApp();
});

/* ─────────────────────────────── upload ─────────────────────────────── */

describe('POST /c/:collection/upload-image', () => {
	it('aluno sobe o logo e recebe uma URL', async () => {
		const res = await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: await pngValido(),
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ url: expect.any(String), width: 40 });
		expect(uploadSpy).toHaveBeenCalledTimes(1);
	});

	it('guarda na pasta do DONO, com nome sorteado', async () => {
		await postaArquivo(app, {
			nome: '../../etc/passwd.png',
			conteudo: await pngValido(),
			mime: 'image/png',
		});

		const [pasta, , caminho, mime] = uploadSpy.mock.calls[0];
		// Pasta por dono: dá para achar (e apagar) tudo o que uma pessoa subiu.
		expect(pasta).toBe(`aluno/${ALUNO}`);
		// O nome que o cliente mandou NÃO vira caminho — nem para escapar da pasta,
		// nem para sobrescrever o arquivo de outra pessoa.
		expect(caminho).toMatch(/^[0-9a-f-]{36}\.png$/);
		expect(caminho).not.toContain('passwd');
		expect(mime).toBe('image/png');
	});

	it('cada aluno escreve na PRÓPRIA pasta', async () => {
		ator = { id: OUTRO_ALUNO, role: 'customer' };
		app = await montaApp();
		await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: await pngValido(),
			mime: 'image/png',
		});
		expect(uploadSpy.mock.calls[0][0]).toBe(`aluno/${OUTRO_ALUNO}`);
	});

	it('recusa arquivo que NÃO é imagem, mesmo declarando image/png', async () => {
		/**
		 * O `Content-Type` da parte multipart é escrito por quem envia. O upload do
		 * admin confia nele (`ALLOWED_IMAGE_MIMETYPES.includes(data.mimetype)`) — e
		 * confiar nele aqui significaria HTML executável hospedado na nossa CDN
		 * pública com o link parecendo nosso.
		 */
		const res = await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: '<html><script>alert(1)</script></html>',
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(400);
		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('recusa SVG (o upload do admin aceita; o do aluno não)', async () => {
		const res = await postaArquivo(app, {
			nome: 'logo.svg',
			conteudo:
				'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>fetch("http://mau.example")</script></svg>',
			mime: 'image/svg+xml',
		});

		expect(res.statusCode).toBe(400);
		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('segura os 5 MB mesmo com o multipart global em 1,5 GB', async () => {
		// PNG legítimo e grande: o que reprova é o TAMANHO, não o formato.
		const gordo = await sharp({
			create: {
				width: 2600,
				height: 2600,
				channels: 3,
				background: '#ffffff',
				noise: { type: 'gaussian', mean: 128, sigma: 90 },
			},
		})
			.png({ compressionLevel: 0 })
			.toBuffer();
		expect(gordo.byteLength).toBeGreaterThan(5 * 1024 * 1024);

		const res = await postaArquivo(app, {
			nome: 'gigante.png',
			conteudo: gordo,
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(413);
		expect(uploadSpy).not.toHaveBeenCalled();
		/**
		 * A parte que importa: o arquivo nem CHEGOU à higienização. Quem cortou foi
		 * o `limits` do `request.file()`, no meio do stream. Sem esse override, o
		 * multipart global (1,5 GB) deixaria o processo carregar o arquivo inteiro
		 * na memória antes de qualquer verificação — e aí o 413 sairia igual, só
		 * que depois do estrago.
		 */
		expect(preparaSpy).not.toHaveBeenCalled();
	});

	it('descarta o EXIF — a foto do celular carrega a localização junto', async () => {
		const comExif = await sharp({
			create: { width: 60, height: 60, channels: 3, background: '#1d3fe1' },
		})
			.jpeg()
			.withExif({ IFD0: { Copyright: 'COORDENADA-SECRETA' } })
			.toBuffer();
		expect(comExif.includes(Buffer.from('COORDENADA-SECRETA'))).toBe(true);

		const res = await postaArquivo(app, {
			nome: 'foto.jpg',
			conteudo: comExif,
			mime: 'image/jpeg',
		});

		expect(res.statusCode).toBe(200);
		const enviado = uploadSpy.mock.calls[0][1];
		// O que vai para a CDN pública são os bytes REESCRITOS, não os recebidos.
		expect(enviado.includes(Buffer.from('COORDENADA-SECRETA'))).toBe(false);
	});

	it('recusa quem não pode criar registro na coleção', async () => {
		// Mesma regra do POST de criação: o upload não é uma segunda porta.
		const res = await postaArquivo(
			app,
			{ nome: 'logo.png', conteudo: await pngValido(), mime: 'image/png' },
			'materiais',
		);

		expect(res.statusCode).toBe(403);
		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('recusa coleção sem campo de imagem (senão a URL não teria onde morar)', async () => {
		definitionAtual = {
			collections: {
				marca: { ...marca, fields: [{ name: 'nome', type: 'text' }] },
			},
		};
		const res = await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: await pngValido(),
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(400);
		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('teto por hora devolve 429 em vez de encher a CDN', async () => {
		contadorRedis = 31; // acima do teto
		const res = await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: await pngValido(),
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(429);
		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('sem Redis o cadastro continua funcionando (fail-open)', async () => {
		contadorRedis = -1;
		const res = await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: await pngValido(),
			mime: 'image/png',
		});
		expect(res.statusCode).toBe(200);
	});

	it('sem arquivo nenhum devolve 400, não 500', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/estudio_imagens/c/marca/upload-image',
			headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
			payload: Buffer.from(`--${BOUNDARY}--\r\n`),
		});
		expect(res.statusCode).toBe(400);
	});
});

/* ──────────────────────── paleta no upload ──────────────────────── */

describe('a paleta vem junto do upload', () => {
	it('logo devolve as cores dele — o cadastro não pergunta hexadecimal', async () => {
		const res = await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: await logoChapado(),
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(200);
		const { palette } = res.json() as {
			palette: { hex: string; share: number }[];
		};
		/**
		 * As duas cores do logo, na ordem de ÁREA — e o BRANCO DE FUNDO FORA.
		 * Se o descarte de fundo parar de acontecer, o branco vira a maior fatia
		 * e a "cor principal" sugerida ao aluno passa a ser #ffffff em quase todo
		 * logo real. Por isso a asserção é na primeira posição, não em "contém".
		 */
		expect(palette.map((c) => c.hex)).toEqual(['#e11d1d', '#1d3fe1']);
		expect(palette[0].share).toBeGreaterThan(palette[1].share);
	});

	it('foto NÃO sugere paleta: as cores de uma foto não são as da marca', async () => {
		/**
		 * A bancada de madeira e o azulejo do fundo virariam "identidade da
		 * empresa" — e o aluno confirmaria sem pensar, porque já veio preenchido.
		 * Sugestão errada com cara de sugestão certa é pior que campo vazio.
		 */
		const res = await postaArquivo(app, {
			nome: 'produto.jpg',
			conteudo: await fotoDeProduto(),
			mime: 'image/jpeg',
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().url).toEqual(expect.any(String));
		expect(res.json().palette).toEqual([]);
	});

	it('paleta quebrada NÃO derruba o upload — a imagem é o produto, a cor é enfeite', async () => {
		paletaQuebrada.on = true;

		const res = await postaArquivo(app, {
			nome: 'logo.png',
			conteudo: await logoChapado(),
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().url).toEqual(expect.any(String));
		expect(res.json().palette).toEqual([]);
		// O arquivo foi para a CDN do mesmo jeito: o aluno recebe o logo e
		// escolhe a cor na mão, em vez de perder o upload por causa de um enfeite.
		expect(uploadSpy).toHaveBeenCalledTimes(1);
	});
});

/* ─────────────────── higienização (sem HTTP no meio) ─────────────────── */

describe('prepararImagemDoAluno', () => {
	it('reduz ao teto de 2000px sem esticar o que é menor', async () => {
		const grande = await sharp({
			create: { width: 3000, height: 1500, channels: 3, background: '#0a0a0a' },
		})
			.png()
			.toBuffer();

		const saida = await prepararImagemDoAluno(grande);
		expect(saida.width).toBe(2000);
		expect(saida.height).toBe(1000);

		const pequena = await prepararImagemDoAluno(await pngValido());
		expect(pequena.width).toBe(40);
	});

	it('PNG continua PNG — logo sem transparência não é logo', async () => {
		const comAlpha = await sharp({
			create: {
				width: 50,
				height: 50,
				channels: 4,
				background: { r: 225, g: 29, b: 29, alpha: 0 },
			},
		})
			.png()
			.toBuffer();

		const saida = await prepararImagemDoAluno(comAlpha);
		expect(saida.ext).toBe('png');
		expect(saida.mimetype).toBe('image/png');
		expect((await sharp(saida.buffer).metadata()).hasAlpha).toBe(true);
	});

	it('JPEG continua JPEG — reencodar foto para PNG multiplicaria o peso', async () => {
		const foto = await sharp({
			create: { width: 80, height: 80, channels: 3, background: '#1d3fe1' },
		})
			.jpeg()
			.toBuffer();

		const saida = await prepararImagemDoAluno(foto);
		expect(saida.ext).toBe('jpg');
		expect(saida.mimetype).toBe('image/jpeg');
	});
});

/* ──────────────────────────── visibility ──────────────────────────── */

describe('POST /c/:collection — visibilidade declarada pela coleção', () => {
	async function cria(body: Record<string, unknown>) {
		return app.inject({
			method: 'POST',
			url: '/api/tools/estudio_imagens/c/marca',
			payload: body,
		});
	}

	it('registro do aluno NASCE PRIVADO quando a coleção declara `owner`', async () => {
		/**
		 * O furo: até aqui quem gravava `visibility` era o cliente. Um POST sem o
		 * campo — uma tela nova, um script, um curl — criava a marca (logo, cores,
		 * tom de voz) e o perfil de custo (salário, margem, preço de compra) do
		 * aluno como PÚBLICOS, visíveis para todo aluno logado.
		 */
		const res = await cria({ title: 'Minha empresa', data: { nome: 'Acme' } });

		expect(res.statusCode).toBe(201);
		expect(repoCreate.mock.calls[0][0]).toMatchObject({
			visibility: 'owner',
			ownerId: ALUNO,
		});
	});

	it('aluno pedindo `public` numa coleção `owner` continua privado', async () => {
		await cria({
			title: 'Minha empresa',
			data: { nome: 'Acme' },
			visibility: 'public',
		});
		expect(repoCreate.mock.calls[0][0]).toMatchObject({ visibility: 'owner' });
	});

	it('coleção sem declaração continua como era (aluno escolhe)', async () => {
		definitionAtual = {
			collections: {
				marca: { ...marca, visibility: undefined },
			},
		};
		await cria({ title: 'Minha empresa', data: { nome: 'Acme' } });
		expect(repoCreate.mock.calls[0][0]).toMatchObject({ visibility: 'public' });
	});

	it('staff continua conseguindo criar registro `staff` (roster de agentes)', async () => {
		ator = { id: OUTRO_ALUNO, role: 'admin' };
		app = await montaApp();
		definitionAtual = {
			collections: { marca: { ...marca, visibility: undefined } },
		};

		await cria({
			title: 'Leitor da Marca',
			data: { nome: 'Leitor' },
			visibility: 'staff',
		});
		expect(repoCreate.mock.calls[0][0]).toMatchObject({ visibility: 'staff' });
	});
});

/* ─────────────────── a marca inteira, campo a campo ─────────────────── */

/** Um cadastro de marca completo, como a tela manda. */
const MARCA_COMPLETA = {
	nome: 'LASER ART',
	publico: 'Noivas que querem lembrancinha de casamento, 25 a 40 anos.',
	tom_de_voz: TOM,
	logo_url: 'https://cdn.exemplo/aluno/x/logo.png',
	cor_primaria: '#E11D1D',
	cor_secundaria: '#1D3FE1',
	cor_fundo: '#FFFFFF',
	fonte: 'Montserrat — sem serifa, grossa, tudo em maiúscula',
	exemplo_url: 'https://cdn.exemplo/aluno/x/post.jpg',
	nao_usar: 'nada de fundo escuro, nada de fonte manuscrita, sem emoji',
};

describe('POST /c/marca — os dez campos chegam ao banco', () => {
	it('nenhum campo é descartado em silêncio', async () => {
		/**
		 * `validateCollectionData` JOGA FORA o que a coleção não declara, sem erro
		 * e sem log — é o comportamento certo (coleção ganha campo sem quebrar
		 * registro antigo) e a armadilha mais cara desta fase: um `nao_usar` que
		 * não esteja em `fields` faz o aluno preencher "sem fundo escuro", salvar
		 * com sucesso, e a arte sair com fundo escuro para sempre.
		 *
		 * Este teste é a única coisa entre um erro de digitação no seed e esse
		 * silêncio.
		 */
		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/estudio_imagens/c/marca',
			payload: { title: 'Laser Art Marcenaria', data: MARCA_COMPLETA },
		});

		expect(res.statusCode).toBe(201);
		const gravado = repoCreate.mock.calls[0][0] as {
			data: Record<string, unknown>;
			title: string;
			visibility: string;
		};
		expect(gravado.data).toEqual(MARCA_COMPLETA);
		expect(Object.keys(gravado.data).sort()).toEqual(
			Object.keys(MARCA_COMPLETA).sort(),
		);
		expect(gravado.title).toBe('Laser Art Marcenaria');
		expect(gravado.visibility).toBe('owner');
	});

	it('tom de voz fora da lista é recusado, não guardado torto', async () => {
		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/estudio_imagens/c/marca',
			payload: {
				title: 'Laser Art',
				data: { ...MARCA_COMPLETA, tom_de_voz: 'irado' },
			},
		});

		expect(res.statusCode).toBe(400);
		expect(res.json().message).toContain('Jeito da marca');
		expect(repoCreate).not.toHaveBeenCalled();
	});

	it('sem o nome da empresa o cadastro é recusado', async () => {
		/**
		 * `nome` é o ÚNICO campo obrigatório além do título, e é obrigatório por
		 * causa de quem lê: `src/lib/marca.ts` monta o briefing a partir de `data`
		 * e não enxerga o `title` (o caminho do repositório entrega só `data`).
		 * Marca sem `nome` viraria arte sem o nome da empresa — sem erro, sem log,
		 * e cobrada.
		 */
		const { nome: _fora, ...semNome } = MARCA_COMPLETA;
		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/estudio_imagens/c/marca',
			payload: { title: 'Laser Art Marcenaria', data: semNome },
		});

		expect(res.statusCode).toBe(400);
		expect(res.json().message).toContain('Nome como aparece na arte');
		expect(repoCreate).not.toHaveBeenCalled();
	});

	it('logo é URL, não bytes coladas no campo', async () => {
		// O campo `type:'image'` guarda o ENDEREÇO que o upload devolveu. Aceitar
		// texto solto aqui deixaria o registro com um logo que não existe.
		const res = await app.inject({
			method: 'POST',
			url: '/api/tools/estudio_imagens/c/marca',
			payload: {
				title: 'Laser Art',
				data: { ...MARCA_COMPLETA, logo_url: 'meu-logo.png' },
			},
		});

		expect(res.statusCode).toBe(400);
		expect(repoCreate).not.toHaveBeenCalled();
	});
});

/* ──────────────── a rota de verdade (schema de resposta) ──────────────── */

describe('a rota registrada, com o schema de resposta ligado', () => {
	/**
	 * POR QUE MONTAR A ROTA INTEIRA em vez de só o controller: o serializador do
	 * `fastify-type-provider-zod` responde PELO SCHEMA. Chave que o controller
	 * manda e o schema não declara é apagada da resposta em silêncio — a mesma
	 * armadilha do `output` allow-list das definitions, agora no HTTP.
	 *
	 * Todos os outros testes deste arquivo montam o controller na mão e passariam
	 * felizes com o schema desatualizado. Este é o único que enxerga a diferença.
	 */
	async function montaAppComRota(): Promise<FastifyInstance> {
		const { serializerCompiler, validatorCompiler } = await import(
			'fastify-type-provider-zod'
		);
		const app = fastify();
		app.setValidatorCompiler(validatorCompiler);
		app.setSerializerCompiler(serializerCompiler);
		await app.register(multipart, {
			limits: { fileSize: 1500 * 1024 * 1024 },
		});
		await app.register(toolCollectionRoute);
		await app.ready();
		return app;
	}

	it('a paleta sobrevive à serialização da resposta', async () => {
		const comRota = await montaAppComRota();
		const res = await postaArquivo(comRota, {
			nome: 'logo.png',
			conteudo: await logoChapado(),
			mime: 'image/png',
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({
			url: expect.any(String),
			width: 300,
			height: 300,
			palette: [
				{ hex: '#e11d1d', share: expect.any(Number) },
				{ hex: '#1d3fe1', share: expect.any(Number) },
			],
		});
		await comRota.close();
	});
});
