import { describe, expect, it, vi } from 'vitest';

/**
 * `output.save_video` — O INTERRUPTOR QUE SEPARA "EXTRA" DE "PRODUTO".
 *
 * ┌─ O QUE ESTES TESTES PROTEGEM, EM DINHEIRO ───────────────────────────────┐
 * │ O mesmo bloco serve a dois donos com doutrinas OPOSTAS:                   │
 * │                                                                          │
 * │  · no Ateliê o clipe é EXTRA de uma arte já paga. Falhar o upload e ainda │
 * │    assim entregar a arte com um recado é o certo — derrubar um run porque │
 * │    o CDN piscou seria jogar fora um trabalho cobrado;                     │
 * │  · no Vídeo do Anúncio o MP4 **é** o produto: o aluno pagou 12 voxxys por │
 * │    ele. Um upload que falha em silêncio grava uma linha sem arquivo, o    │
 * │    run chega ao fim e o `settle` LIQUIDA a cobrança — e depois do settle  │
 * │    não existe estorno (`refundInvocation` só transiciona a partir de      │
 * │    `pending`). Lançar aqui é a ÚNICA janela para devolver o dinheiro.     │
 * │                                                                          │
 * │ O caso do `ok:false` silencioso já custou a rodada do download sem        │
 * │ `Authorization`: HTTP 200 com corpo vazio, arquivo de 0 byte arquivado e  │
 * │ cobrança liquidada. É exatamente esse desfecho que o `obrigatorio` fecha. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * O padrão do Ateliê é testado junto, e de propósito: o dia em que alguém
 * "melhorar" o bloco fazendo-o sempre lançar, o teste do `ok:false` cai e diz
 * por quê.
 */

const uploadToolOutput = vi.fn();
vi.mock('@/lib/storage.js', () => ({
	uploadToolOutput: (...a: unknown[]) => uploadToolOutput(...a),
}));

const { outputSaveVideoBlock } = await import(
	'@/tool-blocks/blocks/output-gallery.js'
);

const ctx = { customerId: 'aluno-1' } as never;

/** Um "MP4" qualquer — este bloco não inspeciona bytes, só os sobe. */
const MP4 = Buffer.from('ftypisom-------------------------------');

/** Roda o bloco já com o schema aplicado (os defaults importam aqui). */
async function rodar(params: Record<string, unknown>) {
	const p = outputSaveVideoBlock.paramsSchema.parse(params);
	return outputSaveVideoBlock.run(ctx, p as never);
}

describe('output.save_video — o vídeo como EXTRA (padrão do Ateliê)', () => {
	it('sem clipe devolve ok:false com o motivo, e NÃO derruba o run', async () => {
		uploadToolOutput.mockReset();

		const out = await rodar({
			mp4: null,
			tool: 'estudio_imagens',
			motivo: 'Este servidor está sem ffmpeg.',
		});

		expect(out.ok).toBe(false);
		expect(out.url).toBeNull();
		expect(out.motivo).toBe('Este servidor está sem ffmpeg.');
		// Nada foi ao CDN: não há o que subir.
		expect(uploadToolOutput).not.toHaveBeenCalled();
	});

	it('upload que falha vira ok:false com frase de gente, e NÃO derruba o run', async () => {
		uploadToolOutput.mockReset();
		uploadToolOutput.mockRejectedValue(new Error('bunny 503'));

		const out = await rodar({ mp4: MP4, tool: 'estudio_imagens' });

		expect(out.ok).toBe(false);
		expect(out.url).toBeNull();
		// A frase é a do aluno; `bunny 503` fica no log do servidor.
		expect(String(out.motivo)).toContain('não conseguimos guardá-lo');
	});
});

describe('output.save_video — o vídeo como PRODUTO (`obrigatorio`)', () => {
	it('sem clipe LANÇA — é o que aciona o estorno dos 12 voxxys', async () => {
		uploadToolOutput.mockReset();

		await expect(
			rodar({
				mp4: null,
				tool: 'estudio_video',
				obrigatorio: true,
				motivo: 'O gerador de vídeo não entregou desta vez.',
			}),
		).rejects.toThrow('O gerador de vídeo não entregou desta vez.');

		expect(uploadToolOutput).not.toHaveBeenCalled();
	});

	it('upload que falha LANÇA em vez de gravar uma linha sem arquivo', async () => {
		uploadToolOutput.mockReset();
		uploadToolOutput.mockRejectedValue(new Error('bunny 503'));

		await expect(
			rodar({ mp4: MP4, tool: 'estudio_video', obrigatorio: true }),
		).rejects.toThrow(/não conseguimos guardá-lo/);
	});

	it('com upload bom entrega a URL normalmente — o interruptor não muda o caminho feliz', async () => {
		uploadToolOutput.mockReset();
		uploadToolOutput.mockResolvedValue('https://cdn.test/v/abc.mp4');

		const out = await rodar({
			mp4: MP4,
			tool: 'estudio_video',
			obrigatorio: true,
			formato: 'story_9x16',
			duracao_s: 8,
		});

		expect(out.ok).toBe(true);
		expect(out.url).toBe('https://cdn.test/v/abc.mp4');
		expect(out.bytes).toBe(MP4.length);
		expect(out.duracao_s).toBe(8);
		// O rótulo do formato sai da tabela compartilhada, não de uma cópia.
		expect(out.rotulo).toBe('Story e Reels');
	});

	it('⚠ `obrigatorio` NASCE DESLIGADO — o Ateliê não passa o parâmetro e não pode mudar de comportamento', () => {
		const p = outputSaveVideoBlock.paramsSchema.parse({
			mp4: null,
			tool: 'estudio_imagens',
		}) as { obrigatorio: boolean };
		expect(p.obrigatorio).toBe(false);
	});

	it('⚠ a string "false" NÃO liga o interruptor (`Boolean("false") === true` é a armadilha)', () => {
		const p = outputSaveVideoBlock.paramsSchema.parse({
			mp4: null,
			tool: 'estudio_imagens',
			obrigatorio: 'false',
		}) as { obrigatorio: boolean };
		expect(p.obrigatorio).toBe(false);
	});
});
