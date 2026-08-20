import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DADOS VARIÁVEIS: 30 canecas com 30 nomes, não 30 cópias de uma.
 *
 * O que muda de natureza aqui é a origem do pixel. No lote uniforme existe UMA
 * arte-mãe e as peças são cópias dela — por isso o lote pode crescer depois. No
 * lote personalizado cada peça é uma geração própria, e a mãe não existe: pedir
 * "mais 20 iguais" repetiria o nome de alguém.
 *
 * Os dois testes que importam de verdade são os dois últimos: cada peça sai com
 * a SUA arte (trocar isso entregaria a caneca da Marina com o nome do João), e
 * o lote personalizado NÃO guarda arte-mãe.
 */

// `licensed-piece` importa o repositório, que valida a env do supabase já no
// import. Nada aqui toca o banco — o dublê existe só para o módulo carregar.
vi.mock('@/lib/supabase.js', () => ({ supabase: { from: () => ({}) } }));

const subidas: { path: string; buf: Buffer }[] = [];
vi.mock('@/lib/storage.js', () => ({
	uploadToolOutput: async (
		folder: string,
		buf: Buffer,
		path: string,
	): Promise<string> => {
		subidas.push({ path, buf });
		return `https://cdn.test/${folder}/${path}`;
	},
	fetchToolOutput: async () => Buffer.alloc(0),
	deleteByUrl: async () => {},
}));

const { camposDaPeca, carimbarLote, lerDadosVariaveis, MAX_TIRAGEM } =
	await import('@/lib/licensed-piece.js');

/** Arte chapada numa cor — a cor É a identidade da peça neste teste. */
const arte = (cor: string) =>
	sharp({ create: { width: 700, height: 700, channels: 3, background: cor } })
		.png()
		.toBuffer();

/** A cor média de um recorte longe do carimbo (que fica no canto de baixo). */
async function corDoMiolo(png: Buffer) {
	const { data } = await sharp(png)
		.extract({ left: 0, top: 0, width: 300, height: 300 })
		.raw()
		.toBuffer({ resolveWithObject: true });
	return [data[0], data[1], data[2]].join(',');
}

/** As subidas de UM lote. Um worker que falha tarde não suja o teste seguinte. */
const doLote = (batchId: string) =>
	subidas.filter((s) => s.path.startsWith(`${batchId}/`));

const pecasDe = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		id: `id-${i + 1}`,
		code: `PL-AAAAA-BBBBB-CCCCC-${String(i + 1).padStart(5, '0')}`,
		piece_index: i + 1,
	}));

beforeEach(() => {
	subidas.length = 0;
});

describe('a lista de dados variáveis', () => {
	it('ausente é o lote uniforme de sempre', () => {
		expect(lerDadosVariaveis(undefined)).toBeNull();
		expect(lerDadosVariaveis('')).toBeNull();
		expect(lerDadosVariaveis('   ')).toBeNull();
	});

	it('lê uma linha por peça, na ordem', () => {
		const lidas = lerDadosVariaveis('[{"tema":"Marina"},{"tema":"João"}]');
		expect(lidas).toEqual([{ tema: 'Marina' }, { tema: 'João' }]);
	});

	it('linha sem texto vale — é a peça que só muda de foto', () => {
		expect(lerDadosVariaveis('[{"tema":"  "},{}]')).toEqual([
			{ tema: null },
			{ tema: null },
		]);
	});

	it('recusa lista vazia, JSON quebrado e tipo errado', () => {
		expect(() => lerDadosVariaveis('[]')).toThrow(/vazia/);
		expect(() => lerDadosVariaveis('{')).toThrow(/JSON/);
		expect(() => lerDadosVariaveis('[{"tema":42}]')).toThrow(/peça 1/);
	});

	it('recusa lista maior que o teto da tiragem', () => {
		const gigante = JSON.stringify(
			Array.from({ length: MAX_TIRAGEM + 1 }, () => ({ tema: 'x' })),
		);
		expect(() => lerDadosVariaveis(gigante)).toThrow(String(MAX_TIRAGEM));
	});
});

describe('carimbo de lote com dados variáveis', () => {
	it('cada peça sai com a SUA arte, não com a da primeira', async () => {
		const cores = ['#ff0000', '#00ff00', '#0000ff'];
		const artes = new Map<number, Buffer>();
		for (let i = 0; i < cores.length; i++) {
			artes.set(i + 1, await arte(cores[i]));
		}

		const lote = await carimbarLote({
			artes,
			customerId: 'aluno-1',
			batchId: 'lote-1',
			pecas: pecasDe(3),
		});

		expect(lote.entregues).toHaveLength(3);
		// Sobe uma por peça, e o nome do arquivo continua sendo o código.
		expect(doLote('lote-1')).toHaveLength(3);
		const mioloDeCada = await Promise.all(
			doLote('lote-1')
				.sort((a, b) => a.path.localeCompare(b.path))
				.map((s) => corDoMiolo(s.buf)),
		);
		expect(mioloDeCada).toEqual(['255,0,0', '0,255,0', '0,0,255']);
	});

	it('NÃO devolve arte-mãe — o lote personalizado não pode ser ampliado', async () => {
		const artes = new Map([[1, await arte('#123456')]]);
		const lote = await carimbarLote({
			artes,
			customerId: 'aluno-1',
			batchId: 'lote-2',
			pecas: pecasDe(1),
		});
		expect(lote.master).toBeNull();
	});

	it('peça sem arte derruba o lote em vez de entregar a arte de outra', async () => {
		// Só a peça 1 tem arte; a 2 ficou de fora. Cair aqui é o desfecho certo:
		// tudo-ou-nada, estorno, e nenhum código nasce sem arquivo.
		const artes = new Map([[1, await arte('#123456')]]);
		const diario: string[] = [];
		await expect(
			carimbarLote({
				artes,
				customerId: 'aluno-1',
				batchId: 'lote-3',
				pecas: pecasDe(2),
				subidas: diario,
			}),
		).rejects.toThrow(/sem arte para a peça 2/);

		// O DIÁRIO É O QUE PERMITE LIMPAR. A peça 1 chegou a subir antes de a 2
		// derrubar o lote; sem esta lista ela ficaria órfã no CDN, com código
		// gravado e sem dono. Não há valor de retorno num throw.
		expect(diario.length).toBeGreaterThan(0);
		expect(diario.every((u) => u.includes('lote-3/'))).toBe(true);
	});

	it('o lote uniforme continua tirando tudo da arte-mãe', async () => {
		const lote = await carimbarLote({
			doc: { licensing: { master: 'gen.png' } } as never,
			bag: { 'gen.png': await arte('#ffffff') },
			customerId: 'aluno-1',
			batchId: 'lote-4',
			pecas: pecasDe(3),
		});
		expect(lote.master).not.toBeNull();
		const mioloDeCada = await Promise.all(
			doLote('lote-4').map((s) => corDoMiolo(s.buf)),
		);
		expect(new Set(mioloDeCada).size).toBe(1);
	});
});

describe('os campos de cada peça', () => {
	/**
	 * O TESTE QUE MAIS IMPORTA DESTE ARQUIVO.
	 *
	 * A injeção do banco troca `{tema}` UMA vez, no começo do run. Sem refazer a
	 * troca a partir do molde cru, mudar o `tema` da peça não muda mais nada — e
	 * o lote sai cobrado como N gerações com N artes que não têm o nome de
	 * ninguém. Foi exatamente o que aconteceu em produção com MARINA e JOAO.
	 */
	const MOLDES = {
		prompt: 'chaveiro do corinthians com o nome {tema} em relevo',
	};

	it('refaz o prompt com o texto DA PEÇA, não com o do formulário', () => {
		const fields = {
			tema: '',
			prompt: 'chaveiro do corinthians com o nome  em relevo',
		};
		const marina = camposDaPeca(fields, MOLDES, { tema: 'MARINA' });
		const joao = camposDaPeca(fields, MOLDES, { tema: 'JOAO' });

		expect(marina.prompt).toContain('MARINA');
		expect(joao.prompt).toContain('JOAO');
		expect(marina.prompt).not.toBe(joao.prompt);
		// E o `fields` original não é tocado: a peça seguinte parte do mesmo lugar.
		expect(fields.prompt).not.toContain('MARINA');
	});

	it('linha sem texto cai no tema do formulário, que vale para todas', () => {
		const fields = { tema: 'escudo grande', prompt: 'ignorado' };
		const campos = camposDaPeca(fields, MOLDES, { tema: null });
		expect(campos.prompt).toContain('escudo grande');
	});

	it('sem moldes, os campos passam intactos — é o lote uniforme', () => {
		const fields = { tema: 'x', prompt: 'já pronto' };
		expect(camposDaPeca(fields, {}, { tema: 'MARINA' })).toEqual({
			tema: 'MARINA',
			prompt: 'já pronto',
		});
	});

	it('variável que ninguém preencheu fica visível, não vira vazio', () => {
		const campos = camposDaPeca(
			{},
			{ prompt: 'grave {tema} em {material}' },
			{
				tema: 'MARINA',
			},
		);
		expect(campos.prompt).toBe('grave MARINA em {material}');
	});
});
