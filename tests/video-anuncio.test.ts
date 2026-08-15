import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { videoAdClipBlock } from '@/tool-blocks/blocks/video.js';
import {
	acharFfmpeg,
	esquecerFfmpeg,
	FORMATOS_DE_VIDEO,
	planejarTela,
	planejarTexto,
} from '@/tool-blocks/lib/video.js';
import type { BlockRunContext } from '@/tool-blocks/types.js';

/**
 * O VÍDEO DO ATELIÊ — conferido nos BYTES do MP4, não no "parece que rodou".
 *
 * Nada aqui é dublê de imagem: a arte é desenhada com `sharp` e o bloco é o de
 * produção. O que É dublê, e precisa ser, é o BINÁRIO — porque as duas coisas
 * que mais importam neste bloco só acontecem quando o ffmpeg falta ou falha, e
 * essas são exatamente as que ninguém consegue reproduzir de propósito numa
 * máquina que tem o ffmpeg instalado e funcionando.
 *
 * As perguntas que este arquivo responde:
 *  ① sem o binário, o run SOBREVIVE? (a arte já foi paga — 500 aqui é o pior
 *    desfecho possível);
 *  ② a arte aparece INTEIRA em todos os quadros? (é a invariante do desenho: a
 *    manchete mora no canto do 1:1 e qualquer corte a decapita);
 *  ③ o MP4 sai como a plataforma exige — `yuv420p`, uma faixa só, `moov` antes
 *    do `mdat`?
 *  ④ o temporário morre mesmo quando o encode explode no meio?
 */

const ctx: BlockRunContext = { customerId: 'teste' };

/** Uma "arte": fundo liso com um bloco escuro no meio, para ter o que olhar. */
async function arte(w: number, h: number): Promise<Buffer> {
	const alvo = await sharp({
		create: {
			width: Math.max(2, Math.round(w * 0.3)),
			height: Math.max(2, Math.round(h * 0.3)),
			channels: 3,
			background: '#101010',
		},
	})
		.png()
		.toBuffer();
	return sharp({
		create: { width: w, height: h, channels: 3, background: '#e8e2d8' },
	})
		.composite([
			{
				input: alvo,
				left: Math.round(w * 0.35),
				top: Math.round(h * 0.35),
			},
		])
		.png()
		.toBuffer();
}

/** Roda o bloco pelo SCHEMA, como o motor faz — sem isso os defaults não valem. */
async function rodar(
	image: Buffer,
	params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	const p = videoAdClipBlock.paramsSchema.parse({ image, ...params });
	return (await videoAdClipBlock.run(ctx, p)) as Record<string, unknown>;
}

/**
 * Os átomos de topo do MP4, na ordem em que estão no arquivo.
 *
 * Sem ffprobe de propósito: a especificação de publicação do Instagram exige
 * "moov no início do arquivo", e isso é uma propriedade do ARQUIVO, que se lê
 * com dois `readUInt32BE`. Depender de uma segunda ferramenta para conferir
 * seria trocar uma verificação por uma suposição.
 */
function atomos(b: Buffer): string[] {
	const out: string[] = [];
	let i = 0;
	while (i + 8 <= b.length && out.length < 10) {
		let tam = b.readUInt32BE(i);
		out.push(b.toString('latin1', i + 4, i + 8));
		if (tam === 1 && i + 16 <= b.length) tam = Number(b.readBigUInt64BE(i + 8));
		if (tam <= 0) break;
		i += tam;
	}
	return out;
}

/**
 * O `/tmp` DESTE TESTE É SÓ DELE.
 *
 * `os.tmpdir()` lê `TMPDIR` a cada chamada no POSIX, então apontá-lo para uma
 * pasta própria faz o bloco criar os temporários LÁ — e a conferência de
 * vazamento passa a olhar um diretório onde mais ninguém escreve.
 *
 * Não é preciosismo: medindo no `/tmp` compartilhado, quatro casos falharam de
 * forma intermitente porque OUTRO processo na mesma máquina (um script de
 * fumaça do mesmo bloco) criava `atelie-video-*` no meio da rodada. Um teste
 * que acusa vazamento por causa do vizinho não mede vazamento nenhum.
 */
let meuTmp = '';
const sobrasNovas = (): string[] =>
	readdirSync(meuTmp).filter((n) => n.startsWith('atelie-video-'));

let temFfmpeg = false;
/** Um ffmpeg de mentira: responde `-version` e FALHA em qualquer encode. */
let ffmpegQuebrado = '';

beforeAll(async () => {
	temFfmpeg = (await acharFfmpeg()).ok;
	const dir = mkdtempSync(join(tmpdir(), 'fake-ff-'));
	ffmpegQuebrado = join(dir, 'ffmpeg');
	writeFileSync(
		ffmpegQuebrado,
		'#!/bin/sh\nif [ "$1" = "-version" ]; then echo "ffmpeg version 6.1.2"; exit 0; fi\nexit 3\n',
	);
	chmodSync(ffmpegQuebrado, 0o755);

	// só DEPOIS de criar o ffmpeg de mentira: daqui para a frente `os.tmpdir()`
	// deste processo aponta para a pasta privada acima.
	meuTmp = mkdtempSync(join(tmpdir(), 'tmp-do-teste-video-'));
	process.env.TMPDIR = meuTmp;
});

afterEach(() => {
	/**
	 * `= undefined` NÃO serve: em Node isso grava a STRING "undefined" no
	 * ambiente, e o bloco seguinte tentaria executar um binário com esse nome —
	 * foi assim que os quatro testes de MP4 saíram com zero vídeo. Tem de SUMIR.
	 */
	delete process.env.FFMPEG_PATH;
	esquecerFfmpeg();
});

/* ─────────────────────── ① o binário é opcional ─────────────────────── */

describe('sem ffmpeg o run continua', () => {
	/**
	 * ⚠ TODO CASO QUE RODA O BLOCO LEVA TIMEOUT EXPLÍCITO, e o padrão de 5 s do
	 * vitest é curto DEMAIS aqui: mesmo sem chegar a codificar, o bloco decodifica
	 * a arte e monta a tela (um desfoque de 1080×2189), e com 61 arquivos de teste
	 * em paralelo isso passa de 5 s. Medido: o caso do ffmpeg quebrado estourava
	 * em ~1 de 3 rodadas — e, pior, o teste morto no meio deixava o temporário
	 * para trás e derrubava os DOIS casos seguintes com "vazou temporário".
	 */
	it('devolve sem vídeo, com o motivo, e NÃO lança', async () => {
		process.env.FFMPEG_PATH = join(tmpdir(), 'binario-que-nao-existe-xyz');
		esquecerFfmpeg();

		const r = await rodar(await arte(1024, 1024));

		expect(r.ffmpeg_disponivel).toBe(false);
		expect(r.videos).toEqual([]);
		expect(r.mp4).toBeNull();
		expect(r.total).toBe(0);
		// a frase é para o ALUNO: precisa dizer que a arte sobreviveu
		expect(String(r.resumo)).toContain('ffmpeg');
		expect(String(r.resumo)).toContain('arte');
		expect(sobrasNovas()).toEqual([]);
	}, 60_000);

	it('o encode que falha vira recusa com motivo, não exceção', async () => {
		process.env.FFMPEG_PATH = ffmpegQuebrado;
		esquecerFfmpeg();

		/**
		 * CONTROLE POSITIVO. Sem isto a checagem de vazamento lá embaixo passaria
		 * de graça: se o bloco estivesse criando temporário em OUTRO lugar, a
		 * pasta privada ficaria vazia e o teste diria "não vazou" sem ter olhado
		 * onde o arquivo está. O bloco usa `os.tmpdir()`; conferir que ele aponta
		 * para a pasta do teste é o que dá sentido ao `sobrasNovas()`.
		 */
		expect(tmpdir()).toBe(meuTmp);

		const r = await rodar(await arte(1024, 1024));

		expect(r.total).toBe(0);
		expect(r.videos).toEqual([]);
		expect(Array.isArray(r.recusados)).toBe(true);
		expect((r.recusados as { motivo: string }[])[0]?.motivo).toContain('arte');
		// ④ o temporário morre mesmo quando o encode explode NO MEIO
		expect(sobrasNovas()).toEqual([]);
	}, 60_000);
});

/* ─────────────────────── ② a geometria da deriva ─────────────────────── */

/**
 * A INVARIANTE. A arte tem de caber na INTERSEÇÃO de todos os quadros que a
 * câmera vai percorrer — não no primeiro, não no do meio: em TODOS. É isto que
 * garante que a manchete (que mora no canto do 1:1) nunca seja decapitada.
 */
function arteInteiraEmTodoQuadro(plano: {
	eixo: 'y' | 'x';
	largura: number;
	altura: number;
	tela_largura: number;
	tela_altura: number;
	curso: number;
	arte_esq: number;
	arte_topo: number;
	arte_largura: number;
	arte_altura: number;
}) {
	/**
	 * ① A arte cabe NA TELA. Parece óbvio e não é: a primeira versão dimensionava
	 * a deriva horizontal pelo teto do eixo errado e pedia uma arte de 1652×1652
	 * dentro de uma tela de 2188×1080. O `composite` do sharp recusou e o 16:9
	 * virava formato recusado em TODO run — e o teste de então não pegou, porque
	 * só olhava o eixo do movimento.
	 */
	expect(plano.arte_esq).toBeGreaterThanOrEqual(0);
	expect(plano.arte_topo).toBeGreaterThanOrEqual(0);
	expect(plano.arte_esq + plano.arte_largura).toBeLessThanOrEqual(
		plano.tela_largura,
	);
	expect(plano.arte_topo + plano.arte_altura).toBeLessThanOrEqual(
		plano.tela_altura,
	);

	// ② e cabe na INTERSEÇÃO de todos os quadros do percurso
	if (plano.eixo === 'y') {
		// a janela anda de `top = curso` até `top = 0`
		expect(plano.arte_topo).toBeGreaterThanOrEqual(plano.curso);
		expect(plano.arte_topo + plano.arte_altura).toBeLessThanOrEqual(
			plano.altura,
		);
	} else {
		expect(plano.arte_esq).toBeGreaterThanOrEqual(plano.curso);
		expect(plano.arte_esq + plano.arte_largura).toBeLessThanOrEqual(
			plano.largura,
		);
	}
}

describe('geometria: a arte inteira em todos os quadros', () => {
	it('arte quadrada em 9:16 — deriva vertical, arte no tamanho natural', () => {
		const r = planejarTela(1024, 1024, 'story_9x16');
		if ('recusa' in r) throw new Error(r.recusa);

		expect(r.plano.eixo).toBe('y');
		expect(r.plano.largura).toBe(1080);
		expect(r.plano.altura).toBe(1920);
		// há para onde andar (armadilha ③: curso zero = foto parada)
		expect(r.plano.curso).toBeGreaterThan(200);
		// a arte usa a largura inteira do quadro: nada é cortado nas laterais
		expect(r.plano.arte_largura).toBe(1080);
		arteInteiraEmTodoQuadro(r.plano);
		// e sobra fundo desfocado — é o 9:16 saindo de um quadrado
		expect(r.plano.fracao_de_fundo).toBeGreaterThan(0.35);
	});

	it('arte JÁ 9:16 — encolhe o quanto for preciso, mas não corta', () => {
		const r = planejarTela(1080, 1920, 'story_9x16');
		if ('recusa' in r) throw new Error(r.recusa);

		expect(r.plano.eixo).toBe('y');
		expect(r.plano.curso).toBeGreaterThan(8);
		/**
		 * Aqui a arte NÃO cabe no tamanho natural: ela já tem a proporção do
		 * quadro, então qualquer curso de câmera cortaria as pontas. O desenho
		 * encolhe a arte em vez de cortá-la — 14% de lado é preço, decapitar a
		 * manchete é defeito.
		 */
		expect(r.plano.arte_altura).toBeLessThan(1920);
		expect(r.plano.arte_altura).toBeGreaterThan(1500);
		arteInteiraEmTodoQuadro(r.plano);
	});

	it('arte quadrada em 16:9 — a deriva vira horizontal', () => {
		const r = planejarTela(1024, 1024, 'capa_16x9');
		if ('recusa' in r) throw new Error(r.recusa);

		expect(r.plano.eixo).toBe('x');
		expect(r.plano.curso).toBeGreaterThan(8);
		// na deriva horizontal quem a arte preenche inteiro é a ALTURA
		expect(r.plano.arte_altura).toBe(r.plano.altura);
		arteInteiraEmTodoQuadro(r.plano);
	});

	it('os QUATRO formatos fecham a geometria a partir de uma arte 1:1', () => {
		for (const formato of Object.keys(
			FORMATOS_DE_VIDEO,
		) as (keyof typeof FORMATOS_DE_VIDEO)[]) {
			const r = planejarTela(1024, 1024, formato);
			if ('recusa' in r) throw new Error(`${formato}: ${r.recusa}`);
			arteInteiraEmTodoQuadro(r.plano);
		}
	});

	it('arte minúscula é recusada com motivo, não entregue borrada', () => {
		const r = planejarTela(200, 200, 'story_9x16');
		expect('recusa' in r).toBe(true);
		if ('recusa' in r) expect(r.recusa).toContain('pequena');
	});

	it('nunca amplia a arte além do teto — encolhe o vídeo junto', () => {
		const r = planejarTela(600, 600, 'story_9x16');
		if ('recusa' in r) throw new Error(r.recusa);
		expect(r.plano.ampliacao).toBeLessThanOrEqual(1.5 + 1e-6);
		// e o que sai continua publicável
		expect(Math.min(r.plano.largura, r.plano.altura)).toBeGreaterThanOrEqual(
			540,
		);
		// lado par: o yuv420p não aceita ímpar
		expect(r.plano.largura % 2).toBe(0);
		expect(r.plano.altura % 2).toBe(0);
	});
});

/* ─────────────────────── ③ o texto ─────────────────────── */

const zona = (f: keyof typeof FORMATOS_DE_VIDEO) => ({
	duracao_s: 5,
	largura: FORMATOS_DE_VIDEO[f].largura,
	altura: FORMATOS_DE_VIDEO[f].altura,
	formato: f,
});

describe('texto: entra o que dá para ler', () => {
	it('texto vazio não vira fala nem aviso', () => {
		const r = planejarTexto({
			titulo: '',
			chamada: null,
			...zona('story_9x16'),
		});
		expect(r.falas).toEqual([]);
		expect(r.avisos).toEqual([]);
	});

	it('só espaço em branco também não vira fala', () => {
		const r = planejarTexto({
			titulo: '   \n  ',
			chamada: undefined,
			...zona('story_9x16'),
		});
		expect(r.falas).toEqual([]);
		expect(r.avisos).toEqual([]);
	});

	it('texto longo demais fica de fora, e o aviso diz por quê', () => {
		const r = planejarTexto({
			titulo: 'Copo inox preto que não descasca',
			// 65 caracteres pedem 3,8s na tela; entrando a 1,4s num clipe de 5s
			// sobram 3,0s. Não cabe.
			chamada:
				'A pintura fosca revela o nome em aço e o presente vira lembrança.',
			...zona('story_9x16'),
		});
		expect(r.falas).toHaveLength(1);
		expect(r.falas[0]?.estilo).toBe('titulo');
		expect(r.avisos.join(' ')).toContain('não dá tempo de ler');
	});

	it('a MESMA chamada cabe quando o clipe é mais longo', () => {
		const r = planejarTexto({
			titulo: 'Copo inox preto que não descasca',
			chamada:
				'A pintura fosca revela o nome em aço e o presente vira lembrança.',
			...zona('story_9x16'),
			duracao_s: 8,
		});
		expect(r.falas).toHaveLength(2);
		expect(r.avisos).toEqual([]);
	});

	it('não repete o que a arte já mostra', () => {
		const r = planejarTexto({
			titulo: 'Amigo Secreto',
			chamada: 'Um copo que ninguém esquece.',
			texto_na_arte: 'AMIGO SECRETO',
			...zona('story_9x16'),
		});
		expect(r.falas).toHaveLength(1);
		expect(r.falas[0]?.texto).toContain('copo');
		expect(r.avisos.join(' ')).toContain('a arte já mostra');
	});

	it('texto absurdamente longo não vaza da zona segura', () => {
		const gigante = 'palavra '.repeat(120).trim();
		const r = planejarTexto({
			titulo: gigante,
			chamada: gigante,
			...zona('story_9x16'),
			duracao_s: 60,
		});
		/**
		 * Com 60s de clipe o tempo de leitura não barra nada — quem barra é a
		 * ZONA SEGURA. O que não pode acontecer é a fala entrar e o texto sair
		 * por cima da interface do Instagram.
		 */
		const z = FORMATOS_DE_VIDEO.story_9x16.zona_segura;
		const disponivel = (z.base - z.topo) * 1920;
		for (const f of r.falas) {
			const corpo = 1080 * (f.estilo === 'titulo' ? 0.072 : 0.037);
			const entre = corpo * (f.estilo === 'titulo' ? 1.12 : 1.3);
			expect(f.linhas.length * entre).toBeLessThanOrEqual(disponivel);
		}
	});

	it('a linha respeita a largura útil do formato', () => {
		const r = planejarTexto({
			titulo:
				'Uma manchete bem comprida para forçar a quebra em várias linhas seguidas',
			...zona('story_9x16'),
			duracao_s: 20,
		});
		expect(r.falas[0]?.linhas.length).toBeGreaterThan(1);
		for (const l of r.falas[0]?.linhas ?? []) expect(l.length).toBeLessThan(26);
	});
});

/* ─────────────────────── ④ o MP4 de verdade ─────────────────────── */

describe('o MP4', () => {
	it('arte quadrada vira Reels 1080×1920 com moov antes do mdat', async () => {
		if (!temFfmpeg) return; // máquina sem o binário: o caso ① já cobre
		const r = await rodar(await arte(1024, 1024), {
			duracao_s: 3,
			titulo: 'Copo preto',
		});

		expect(r.total).toBe(1);
		const mp4 = r.mp4 as Buffer;
		expect(Buffer.isBuffer(mp4)).toBe(true);
		expect(mp4.length).toBeGreaterThan(10_000);
		expect(r.largura).toBe(1080);
		expect(r.altura).toBe(1920);

		// `+faststart`: o `moov` TEM de vir antes do `mdat`
		const a = atomos(mp4);
		expect(a[0]).toBe('ftyp');
		expect(a.indexOf('moov')).toBeGreaterThan(-1);
		expect(a.indexOf('moov')).toBeLessThan(a.indexOf('mdat'));

		// a tela recebe data URL, e o Buffer NÃO entra no array
		const v = (r.videos as Record<string, unknown>[])[0];
		expect(String(v?.dataUrl).startsWith('data:video/mp4;base64,')).toBe(true);
		expect(v?.mp4).toBeUndefined();

		// nada sobrou no disco
		expect(sobrasNovas()).toEqual([]);
	}, 60_000);

	it('arte já 9:16 também sai, e sai no formato pedido', async () => {
		if (!temFfmpeg) return;
		const r = await rodar(await arte(1080, 1920), { duracao_s: 3 });
		expect(r.total).toBe(1);
		expect(r.largura).toBe(1080);
		expect(r.altura).toBe(1920);
	}, 60_000);

	it('arte minúscula é recusada sem chamar o ffmpeg', async () => {
		if (!temFfmpeg) return;
		const r = await rodar(await arte(180, 180), { duracao_s: 3 });
		expect(r.total).toBe(0);
		expect((r.recusados as { motivo: string }[])[0]?.motivo).toContain(
			'pequena',
		);
	}, 30_000);

	it('os QUATRO formatos saem de verdade, em MP4', async () => {
		if (!temFfmpeg) return;
		/**
		 * Este caso existe porque o teste de geometria SOZINHO não pegou o
		 * defeito do 16:9: a conta fechava e o `composite` do sharp é que
		 * recusava. Só renderizando os quatro de ponta a ponta se descobre.
		 */
		const r = await rodar(await arte(1024, 1024), {
			duracao_s: 3,
			formats: ['story_9x16', 'feed_1x1', 'retrato_4x5', 'capa_16x9'],
		});
		expect(r.recusados).toEqual([]);
		expect(r.total).toBe(4);
		const dims = (r.videos as { largura: number; altura: number }[]).map(
			(v) => `${v.largura}x${v.altura}`,
		);
		expect(dims).toEqual(['1080x1920', '1080x1080', '1080x1350', '1920x1080']);
		expect(sobrasNovas()).toEqual([]);
	}, 180_000);

	it('dois formatos no mesmo run saem os dois', async () => {
		if (!temFfmpeg) return;
		const r = await rodar(await arte(1024, 1024), {
			duracao_s: 3,
			formats: ['story_9x16', 'feed_1x1'],
		});
		expect(r.total).toBe(2);
		const dims = (r.videos as { largura: number; altura: number }[]).map(
			(v) => `${v.largura}x${v.altura}`,
		);
		expect(dims).toEqual(['1080x1920', '1080x1080']);
		expect(sobrasNovas()).toEqual([]);
	}, 90_000);
});
