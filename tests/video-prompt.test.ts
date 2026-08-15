import { describe, expect, it } from 'vitest';
import {
	avisosDoPedido,
	comporPedidoDeVideo,
	extrairMovimento,
	MAX_PROMPT_VIDEO,
	TRAVA_DA_TELA,
	TRAVA_DO_CORTE,
	TRAVA_DO_PRODUTO,
} from '../src/lib/atelie/movimento.js';
import { aiVideoPromptBlock } from '../src/tool-blocks/blocks/ai-video-prompt.js';

/**
 * O QUE ESTES TESTES PROTEGEM — e por que cada um existe.
 *
 * Nenhum deles fala com o OpenRouter: o que se testa aqui é a parte que
 * transforma a resposta de um especialista no pedido que vai ser FILMADO por
 * US$ 0,40. As regressões que eles pegam já custaram dinheiro de verdade nesta
 * frente, e estão nomeadas uma a uma.
 */

describe('extrairMovimento', () => {
	it('lê o campo `movimento` e os apelidos com que a mesma ideia volta', () => {
		expect(
			extrairMovimento({ movimento: 'A câmera se aproxima.' }).movimento,
		).toBe('A câmera se aproxima.');
		// O roster é editável pela tela: quem reescrever a `saida` vai usar o
		// nome que lhe parecer óbvio, e `prompt_video` é o mais provável.
		expect(
			extrairMovimento({ prompt_video: 'A câmera desliza.' }).movimento,
		).toBe('A câmera desliza.');
	});

	it('aceita TEXTO CRU: exigir JSON de quem só tem um parágrafo cria falha à toa', () => {
		expect(
			extrairMovimento(undefined, 'A câmera desce até a gravação.').movimento,
		).toBe('A câmera desce até a gravação.');
	});

	it('RECUSA JSON quebrado como se fosse texto', () => {
		// Uma resposta cortada no teto começa com `{` e não fecha. Mandar isso ao
		// gerador é pagar US$ 0,40 para ele tentar filmar uma chave de abertura.
		expect(
			extrairMovimento(undefined, '{"movimento": "a câmera').movimento,
		).toBe('');
	});

	it('devolve vazio quando não há nada aproveitável', () => {
		expect(extrairMovimento(null, '').movimento).toBe('');
		expect(comporPedidoDeVideo(extrairMovimento(null, ''))).toBe('');
	});
});

describe('comporPedidoDeVideo — as travas são do código', () => {
	const cru = {
		movimento: 'A câmera se aproxima da peça.',
		exibe: '',
		som: '',
	};

	it('acrescenta as três travas quando o especialista esquece', () => {
		const p = comporPedidoDeVideo(cru);
		expect(p).toContain(TRAVA_DO_PRODUTO);
		expect(p).toContain(TRAVA_DA_TELA);
		expect(p).toContain(TRAVA_DO_CORTE);
	});

	it('NÃO repete a trava que o especialista já escreveu', () => {
		/**
		 * Repetir a proibição não a reforça: produz duas frases sobre o mesmo
		 * assunto disputando o mesmo plano de 8 s, e o jeito do modelo de caber
		 * tudo é acelerar a câmera.
		 */
		const p = comporPedidoDeVideo({
			...cru,
			movimento: `A câmera se aproxima. ${TRAVA_DO_PRODUTO}`,
		});
		expect(p.split(TRAVA_DO_PRODUTO).length - 1).toBe(1);
	});

	it('reconhece a trava escrita com outras palavras', () => {
		const p = comporPedidoDeVideo({
			...cru,
			movimento:
				'Plano único de 8 segundos, sem cortes, com a câmera descendo.',
		});
		expect(p).not.toContain(TRAVA_DO_CORTE);
	});

	it('pontua e capitaliza o `som` — ele volta do modelo como fragmento', () => {
		// Medido na primeira chamada real: `som` veio "som ambiente suave de um
		// espaço interno", em minúscula e sem ponto, e o pedido terminava numa
		// frase quebrada exatamente onde se pede o áudio.
		const p = comporPedidoDeVideo({
			...cru,
			som: 'som ambiente suave, sem música',
		});
		expect(p).toContain('Som ambiente suave, sem música.');
	});

	it('respeita o teto de caracteres', () => {
		const p = comporPedidoDeVideo({ ...cru, movimento: 'A '.repeat(3_000) });
		expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_VIDEO);
	});
});

describe('avisosDoPedido', () => {
	it('NÃO delata a si mesmo: as travas falam de texto e logo por dever de ofício', () => {
		/**
		 * A regressão medida: varrer o pedido JÁ COMPOSTO fazia o aviso "o pedido
		 * fala de logotipo" aparecer em 100% dos runs, porque `TRAVA_DA_TELA`
		 * contém a palavra. Aviso que aparece sempre é aviso que ninguém lê.
		 */
		expect(
			avisosDoPedido(
				comporPedidoDeVideo({
					movimento: 'A câmera se aproxima da peça.',
					exibe: '',
					som: '',
				}),
			),
		).toEqual([]);
	});

	it('avisa quando o pedido descreve tipografia', () => {
		// Foi assim que a manchete saiu DUPLICADA no teste com o prompt da imagem.
		const avisos = avisosDoPedido(
			'A frase "LEMBRANÇA DE CASAMENTO" aparece no alto em fonte grossa.',
		);
		expect(avisos.length).toBeGreaterThan(0);
		expect(avisos[0]).toContain('texto');
	});

	it('avisa quando o pedido chama o logotipo', () => {
		const avisos = avisosDoPedido('O logotipo da marca gira no canto.');
		expect(avisos.some((a) => a.includes('logotipo'))).toBe(true);
	});
});

describe('ai.video_prompt — os portões antes da rede', () => {
	it('recusa o run sem a arte, e recusa ANTES de tocar banco ou modelo', async () => {
		/**
		 * A ordem é a regra: `loadDeps()` importa o repositório, que valida
		 * credencial de banco no topo do módulo. Se a checagem da arte viesse
		 * depois, "faltou a arte" viraria erro de conexão — e este teste não
		 * poderia existir sem banco.
		 */
		await expect(
			aiVideoPromptBlock.run(
				{ customerId: 'c1' },
				aiVideoPromptBlock.paramsSchema.parse({ tool: 'estudio_video' }),
			),
		).rejects.toThrow(/arte pronta/i);
	});

	it('nasce pedindo 9:16 e 8 segundos — o formato do Reels, e o plano inteiro', () => {
		const p = aiVideoPromptBlock.paramsSchema.parse({ tool: 'estudio_video' });
		expect(p.formato).toBe('9:16');
		expect(p.duracao_s).toBe(8);
		expect(p.chave).toBe('diretor_movimento');
	});
});
