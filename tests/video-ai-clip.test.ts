import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `video.ai_clip` — O BLOCO QUE NÃO EXISTIA, e cujo buraco custou a fase.
 *
 * ┌─ O DEFEITO QUE ESTE ARQUIVO FECHA ───────────────────────────────────────┐
 * │ `lib/video-ia.ts` foi escrito inteiro — 909 linhas, a fila, o             │
 * │ `Authorization` do download, o teto de custo — e ficou com ZERO           │
 * │ importadores. A definition de `estudio_video` apontava o nó central para  │
 * │ `video.ai_clip`, que o registry não conhecia, e o run morria em "bloco    │
 * │ desconhecido" DEPOIS de já ter rodado (e pago) o Diretor de Movimento.    │
 * │ Nenhum portão pegava: o schema do upvox valida `block` como string        │
 * │ qualquer, e o `conferirNoBanco` do seed confere o NÓ, nunca o BLOCO.      │
 * │ Daí o primeiro teste daqui ser o mais bobo e o mais importante: o id está │
 * │ registrado no motor.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A doutrina que o resto verifica: aqui o vídeo É o produto (12 voxxys pagos
 * ANTES), então toda falha LANÇA — lançar é o único gesto que devolve dinheiro.
 * E toda recusa que dá para tomar de graça é tomada ANTES do POST, porque o
 * provedor ACEITA campo desconhecido e ENFILEIRA: foi assim que seis gerações
 * lixo custaram US$ 5,76.
 */

vi.hoisted(() => {
	process.env.OPENROUTER_API_KEY ||= 'test-key';
});

const gerarVideoIA = vi.fn();
vi.mock('@/tool-blocks/lib/video-ia.js', async (importOriginal) => {
	// O resto do módulo é REAL: o encaixe, o teto de custo e o preparo do quadro
	// são exatamente o que estes testes querem exercitar. Só a ida à rede é dublê.
	const real =
		await importOriginal<typeof import('@/tool-blocks/lib/video-ia.js')>();
	return { ...real, gerarVideoIA: (...a: unknown[]) => gerarVideoIA(...a) };
});

/**
 * O ffmpeg é LIGÁVEL por teste, e isso é o ponto: os dois caminhos existem em
 * produção. Sem o binário (máquina de dev) a capa cai no plano B e o áudio fica
 * `null` — "não sei" nunca desmente o pedido. Com o binário, o bloco ABRE o
 * arquivo entregue e diz a verdade sobre ele.
 */
const temFfmpeg = { ok: false };
vi.mock('@/tool-blocks/lib/video.js', async (importOriginal) => {
	const real =
		await importOriginal<typeof import('@/tool-blocks/lib/video.js')>();
	return {
		...real,
		acharFfmpeg: async () =>
			temFfmpeg.ok
				? { ok: true, caminho: 'ffmpeg', versao: 'teste' }
				: { ok: false, caminho: 'ffmpeg' },
	};
});

const { videoAiClipBlock } = await import('@/tool-blocks/blocks/video-ia.js');
const { registerCoreBlocks } = await import('@/tool-blocks/index.js');
const { blockRegistry } = await import('@/tool-blocks/registry.js');

const ctx = { customerId: 'aluno-1' } as never;

/** Um MP4 de mentira — o bloco não inspeciona bytes, quem faz isso é a lib. */
const MP4 = Buffer.from('ftypisom0000000000000000000000000000');

async function arte(w: number, h: number): Promise<Buffer> {
	return sharp({
		create: { width: w, height: h, channels: 3, background: '#c0392b' },
	})
		.png()
		.toBuffer();
}

function rodar(params: Record<string, unknown>) {
	const p = videoAiClipBlock.paramsSchema.parse(params);
	return videoAiClipBlock.run(ctx, p as never);
}

/* ─────────────── MP4 de verdade, para medir áudio de verdade ─────────────── */

const pexec = promisify(execFile);

/**
 * Monta um MP4 REAL (1 s de vídeo preto 64×64 + a trilha pedida) com o ffmpeg
 * da máquina. Dublar o binário aqui testaria o dublê — o defeito mora
 * exatamente na LEITURA do arquivo entregue.
 */
async function mp4Real(audio: 'silencio' | 'tom' | 'nenhum'): Promise<Buffer> {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'teste-audio-'));
	const saida = path.join(dir, 'x.mp4');
	const fonte =
		audio === 'tom'
			? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1']
			: audio === 'silencio'
				? ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo:d=1']
				: [];
	await pexec('ffmpeg', [
		'-y',
		'-f',
		'lavfi',
		'-i',
		'color=c=black:s=64x64:d=1',
		...fonte,
		'-c:v',
		'libx264',
		'-pix_fmt',
		'yuv420p',
		...(audio === 'nenhum' ? [] : ['-c:a', 'aac', '-shortest']),
		saida,
	]);
	const buf = await readFile(saida);
	await rm(dir, { recursive: true, force: true });
	return buf;
}

beforeEach(() => {
	vi.clearAllMocks();
	gerarVideoIA.mockResolvedValue({
		mp4: MP4,
		jobId: 'job-123',
		custoUsd: 0.4,
		consultas: 8,
		ms: 42_000,
	});
});

describe('o bloco existe de verdade (o buraco da fase)', () => {
	it('video.ai_clip está REGISTRADO no motor', () => {
		registerCoreBlocks();
		expect(blockRegistry.get('video.ai_clip')).toBeTruthy();
	});

	/**
	 * O pipeline inteiro de `estudio_video`, nó a nó. Um único id ausente aqui é
	 * um run de 12 voxxys que morre em 400 — e o aluno já pagou.
	 */
	it('todos os blocos do pipeline de estudio_video resolvem', () => {
		registerCoreBlocks();
		for (const id of [
			'collection.image',
			'ai.video_prompt',
			'video.ai_clip',
			'output.save_video',
			'util.text_template',
			'collection.save',
		]) {
			expect(blockRegistry.get(id), `bloco ${id}`).toBeTruthy();
		}
	});
});

describe('as recusas que custam US$ 0,00 — todas ANTES do POST', () => {
	it('sem a arte, nem chega a enfileirar', async () => {
		await expect(
			rodar({ image: Buffer.alloc(0), movimento: 'a câmera gira' }),
		).rejects.toThrow();
		expect(gerarVideoIA).not.toHaveBeenCalled();
	});

	/**
	 * O Veo 3.1 cheio em 8 s custa US$ 3,20 — MAIS que os R$ 14,40 da venda de 12
	 * voxxys. O teto existe para que uma configuração escrita na Fábrica não vire
	 * prejuízo por clique, e a recusa acontece sem enfileirar nada.
	 */
	it('combinação acima do teto de custo é recusada com o número na frase', async () => {
		await expect(
			rodar({
				image: await arte(720, 1280),
				movimento: 'a câmera gira',
				modelo: 'google/veo-3.1',
				duracao_s: 8,
			}),
		).rejects.toThrow(/US\$ 3\.20.*teto/s);
		expect(gerarVideoIA).not.toHaveBeenCalled();
	});

	it('e o modelo escolhido pelo dono passa folgado no mesmo teto', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'a câmera gira',
			duracao_s: 8,
		});
		expect(out.modelo).toBe('google/veo-3.1-lite');
		expect(gerarVideoIA).toHaveBeenCalledTimes(1);
	});
});

describe('o corpo do pedido — onde o dinheiro e a moldura são decididos', () => {
	it('NUNCA omite `resolution` (omitir custa 3,2× mais pelo mesmo arquivo)', async () => {
		await rodar({ image: await arte(720, 1280), movimento: 'gira' });
		const corpo = gerarVideoIA.mock.calls[0][0];
		expect(corpo.resolution).toBe('720p');
	});

	it('manda a arte como PRIMEIRO QUADRO — sem isso o modelo inventa outro produto', async () => {
		await rodar({ image: await arte(720, 1280), movimento: 'gira' });
		const corpo = gerarVideoIA.mock.calls[0][0];
		expect(corpo.frame_images).toHaveLength(1);
		expect(corpo.frame_images[0].frame_type).toBe('first_frame');
		// Data URL, não link: a arte do aluno não vira endereço público.
		expect(corpo.frame_images[0].image_url.url.startsWith('data:image/')).toBe(
			true,
		);
	});

	it('vertical é vertical: 9:16 sai 720×1280 e formato story', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
			aspecto: '9:16',
		});
		expect(gerarVideoIA.mock.calls[0][0].aspect_ratio).toBe('9:16');
		expect(out.largura).toBe(720);
		expect(out.altura).toBe(1280);
		expect(out.formato).toBe('story_9x16');
	});

	it('16:9 continua deitado, para quem pediu deitado', async () => {
		const out = await rodar({
			image: await arte(1280, 720),
			movimento: 'gira',
			aspecto: '16:9',
		});
		expect(out.largura).toBe(1280);
		expect(out.altura).toBe(720);
		expect(out.formato).toBe('capa_16x9');
	});

	/**
	 * Duração fora do conjunto {4,6,8} é ENCAIXADA com aviso, nunca enviada crua:
	 * o provedor aceita o valor desconhecido e enfileira assim mesmo.
	 */
	it('duração fora do conjunto é encaixada e avisada, não enviada crua', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
			duracao_s: 5,
		});
		expect(gerarVideoIA.mock.calls[0][0].duration).toBe(4);
		expect(out.duracao_s).toBe(4);
		expect(out.avisos).toMatch(/5s/);
	});

	/** `Boolean('false') === true` — a armadilha que já mordeu neste repo. */
	it('com_audio "false" (string) desliga o áudio de verdade', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
			com_audio: 'false',
		});
		expect(gerarVideoIA.mock.calls[0][0].generate_audio).toBe(false);
		expect(out.com_audio).toBe(false);
		expect(out.resumo).toMatch(/sem áudio/);
	});
});

describe('a arte que não está na proporção', () => {
	it('arte 1:1 num 9:16 é reenquadrada (e o aluno é avisado)', async () => {
		const out = await rodar({
			image: await arte(1024, 1024),
			movimento: 'gira',
			aspecto: '9:16',
		});
		expect(out.reenquadrado).toBe(true);
		expect(out.avisos).toMatch(/9:16/);
	});

	it('arte que já nasce 9:16 passa sem reenquadramento e sem aviso', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
			aspecto: '9:16',
		});
		expect(out.reenquadrado).toBe(false);
		expect(out.avisos).toBe('');
	});
});

describe('o que volta para o pipeline', () => {
	/**
	 * O custo REAL do provedor, e não a estimativa. Sem ele ninguém reconcilia a
	 * margem de uma venda de 12 voxxys — o número existiria por 200 ms e morreria.
	 */
	it('devolve o custo REAL do provedor quando ele veio', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		expect(out.custo_usd).toBe(0.4);
		expect(out.custo_real).toBe(true);
	});

	it('e cai na estimativa da tabela quando o provedor não informou', async () => {
		gerarVideoIA.mockResolvedValue({
			mp4: MP4,
			jobId: 'j',
			custoUsd: null,
			consultas: 1,
			ms: 1,
		});
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		expect(out.custo_usd).toBeCloseTo(0.4, 4); // 0,05 US$/s × 8 s
		expect(out.custo_real).toBe(false);
	});

	/**
	 * A CAPA NUNCA É NULA. Sem ffmpeg (este teste) ela cai no quadro que nós
	 * mesmos montamos — que já está na proporção do vídeo e já tem o fundo
	 * desfocado. Capa nula abriria o player em preto e poria um cartão preto na
	 * grade de "Meus vídeos", que parece defeito.
	 */
	it('sempre devolve uma capa, mesmo sem ffmpeg na máquina', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		expect(Buffer.isBuffer(out.poster)).toBe(true);
		const meta = await sharp(out.poster as Buffer).metadata();
		expect(meta.width).toBe(720);
		expect(meta.height).toBe(1280);
	});

	it('o MP4 e o job do fornecedor sobem para o pipeline', async () => {
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		expect(out.mp4).toBe(MP4);
		expect(out.job_id).toBe('job-123');
	});
});

describe('falha do fornecedor: LANÇA, para o run estornar', () => {
	it('erro na fila sobe como erro do bloco (nunca "vazio com aviso")', async () => {
		gerarVideoIA.mockRejectedValue(new Error('provedor caiu'));
		await expect(
			rodar({ image: await arte(720, 1280), movimento: 'gira' }),
		).rejects.toThrow(/provedor caiu/);
	});
});

/**
 * ⚠ `com_audio` PASSOU A SER A ENTREGA, e não mais o pedido.
 *
 * O bloco gravava na coleção o que tinha sido PEDIDO ao provedor, e a tela
 * imprimia "com áudio" ao lado do player a partir disso. Não havia uma leitura
 * da trilha entregue em lugar nenhum do repositório (`grep -rn ffprobe src/` =
 * 0). Medido nas quatro gerações reais: três voltaram entre −2,4 e −0,7 dBFS de
 * pico e UMA voltou com pico de −46,2 dBFS — faixa AAC presente, silêncio na
 * prática — e teria sido entregue com a etiqueta "com áudio" numa venda de 12
 * voxxys em que o som é item da ficha do produto.
 *
 * Estes testes rodam com o ffmpeg REAL sobre buffers de verdade: dublar o
 * binário aqui testaria o dublê, e o defeito mora exatamente na leitura.
 */
describe('o áudio prometido é o áudio medido', () => {
	beforeEach(() => {
		temFfmpeg.ok = true;
	});
	afterEach(() => {
		temFfmpeg.ok = false;
	});

	it('trilha audível: entrega com áudio, sem ressalva', async () => {
		gerarVideoIA.mockResolvedValue({
			mp4: await mp4Real('tom'),
			jobId: 'j',
			custoUsd: 0.4,
			consultas: 1,
			ms: 1,
		});
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		expect(out.com_audio).toBe(true);
		expect(out.resumo).toMatch(/com áudio/);
		expect(out.avisos).not.toMatch(/sem som/i);
	});

	it('faixa presente mas SILENCIOSA: o vídeo sai, e a etiqueta diz a verdade', async () => {
		gerarVideoIA.mockResolvedValue({
			mp4: await mp4Real('silencio'),
			jobId: 'j',
			custoUsd: 0.4,
			consultas: 1,
			ms: 1,
		});
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		// O que importa: pedimos áudio, veio mudo, e NÃO mentimos.
		expect(out.com_audio).toBe(false);
		expect(out.resumo).toMatch(/sem áudio/);
		expect(out.avisos).toMatch(/sem som/i);
		// E o vídeo continua entregue: recusar aqui jogaria fora US$ 0,40 e os
		// 12 voxxys por causa da trilha, num arquivo cuja imagem está correta.
		expect(Buffer.isBuffer(out.mp4)).toBe(true);
	});

	it('arquivo SEM faixa de áudio nenhuma: mesma verdade, sem estourar', async () => {
		gerarVideoIA.mockResolvedValue({
			mp4: await mp4Real('nenhum'),
			jobId: 'j',
			custoUsd: 0.4,
			consultas: 1,
			ms: 1,
		});
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		expect(out.com_audio).toBe(false);
		expect(out.avisos).toMatch(/sem som/i);
	});

	/**
	 * Quem NÃO pediu áudio não recebe a ressalva: ela existe para desmentir uma
	 * promessa, e sem promessa não há o que desmentir.
	 */
	it('quem pediu sem áudio não ganha ressalva sobre som', async () => {
		gerarVideoIA.mockResolvedValue({
			mp4: await mp4Real('nenhum'),
			jobId: 'j',
			custoUsd: 0.24,
			consultas: 1,
			ms: 1,
		});
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
			com_audio: false,
		});
		expect(out.com_audio).toBe(false);
		expect(out.avisos).not.toMatch(/sem som/i);
	});

	/** E a capa passa a sair do PRÓPRIO arquivo quando há ffmpeg. */
	it('com ffmpeg, a capa é o quadro zero do MP4 entregue', async () => {
		gerarVideoIA.mockResolvedValue({
			mp4: await mp4Real('tom'),
			jobId: 'j',
			custoUsd: 0.4,
			consultas: 1,
			ms: 1,
		});
		const out = await rodar({
			image: await arte(720, 1280),
			movimento: 'gira',
		});
		const meta = await sharp(out.poster as Buffer).metadata();
		// 64×64 é o vídeo de teste — ou seja, veio do ARQUIVO, não da arte
		// (que é 720×1280). É exatamente essa troca que impede a capa de
		// anunciar uma manchete que o vídeo apaga.
		expect(meta.width).toBe(64);
		expect(meta.height).toBe(64);
	});
});
