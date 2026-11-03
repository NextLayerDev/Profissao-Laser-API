import { describe, expect, it, vi } from 'vitest';
import {
	escolherMarca,
	resumoDaMarca,
	varsDaMarca,
	visualDaMarca,
} from '@/lib/marca.js';
import { interpolar } from '@/lib/research/agents.js';

/**
 * A MARCA COMPARTILHADA entre ferramentas.
 *
 * Dois consumidores leem a mesma coleção por caminhos diferentes (o time de
 * agentes recebe o resultado ACHATADO de `collection.query`; o link público
 * recebe `CollectionEntry` cru do repositório) e a regra de escolha precisa ser
 * a MESMA nos dois — senão o aluno com duas marcas vê uma no anúncio e outra na
 * página pública, e ninguém sabe dizer qual está errada.
 */

const CRUA = {
	nome: 'Laser do Zé',
	logo_url: 'https://cdn.example/marca.png',
	cor_primaria: '#ff5500',
	cor_secundaria: '#111111',
	cor_fundo: '#ffffff',
	fonte: 'Poppins',
	tom_de_voz: 'proximo_e_informal',
	publico: 'noivas e cerimonialistas',
	nao_usar: 'emoji e "imperdível"',
};

/** Como `collection.query` entrega: id/title no topo e os campos achatados. */
const achatada = (over: Record<string, unknown> = {}) => ({
	id: 'marca-1',
	title: 'Laser do Zé',
	score: null,
	...CRUA,
	...over,
});

/** Como o repositório entrega: envelope com `data` dentro e `created_at`. */
const comEnvelope = (
	over: Record<string, unknown> = {},
	created_at = '2026-03-01T00:00:00Z',
) => ({
	id: 'marca-1',
	title: 'Laser do Zé',
	created_at,
	data: { ...CRUA, ...over },
});

describe('escolherMarca — a regra de qual marca vale', () => {
	it('lê as DUAS formas em que um registro chega', () => {
		expect(escolherMarca([achatada()])?.nome).toBe('Laser do Zé');
		expect(escolherMarca([comEnvelope()])?.nome).toBe('Laser do Zé');
	});

	it('sem marca nenhuma devolve null — e isso não é erro', () => {
		expect(escolherMarca([])).toBeNull();
		expect(escolherMarca(undefined)).toBeNull();
		expect(escolherMarca(null)).toBeNull();
		expect(escolherMarca('')).toBeNull();
		expect(escolherMarca('não é json')).toBeNull();
	});

	it('com envelope, vale a MAIS RECENTE por `created_at`', () => {
		const escolhida = escolherMarca([
			comEnvelope({ nome: 'Antiga' }, '2020-01-01T00:00:00Z'),
			comEnvelope({ nome: 'Nova' }, '2026-06-01T00:00:00Z'),
		]);
		expect(escolhida?.nome).toBe('Nova');
	});

	it('sem `created_at` (caminho achatado) respeita a ORDEM da consulta', () => {
		// `collection.query` não devolve `created_at`; quem ordena é o `sort:'recent'`
		// do pedido, e a escolha tem que ser o primeiro da lista — nada de reordenar
		// por conta própria e desfazer o que o banco já decidiu.
		const escolhida = escolherMarca([
			achatada({ nome: 'Primeira da consulta' }),
			achatada({ nome: 'Segunda' }),
		]);
		expect(escolhida?.nome).toBe('Primeira da consulta');
	});

	it('cadastro EM BRANCO não vira "a marca mais recente"', () => {
		// Abrir o formulário e desistir não pode apagar a identidade que está
		// pronta: um registro sem nenhum campo útil é descartado ANTES da escolha,
		// mesmo sendo o mais novo de todos.
		const escolhida = escolherMarca([
			{ id: 'rascunho', created_at: '2030-01-01T00:00:00Z', data: {} },
			comEnvelope({ nome: 'A de verdade' }, '2026-01-01T00:00:00Z'),
		]);
		expect(escolhida?.nome).toBe('A de verdade');
		// E se TUDO que existe é rascunho, o resultado é "não tem marca".
		expect(escolherMarca([{ id: 'r', data: {} }])).toBeNull();
	});

	it('aceita string JSON (o motor às vezes não resolve o ref)', () => {
		expect(escolherMarca(JSON.stringify([achatada()]))?.nome).toBe(
			'Laser do Zé',
		);
	});
});

describe('resumoDaMarca — o briefing que o modelo lê', () => {
	it('é UMA LINHA, em português, sem nome de campo', () => {
		const r = resumoDaMarca(escolherMarca([achatada()]));
		expect(r).not.toContain('\n');
		// A proibição de falar em campo/chave vale para o que a IA ESCREVE; um
		// briefing cheio de `tom_de_voz` é um convite a violá-la.
		expect(r).not.toContain('tom_de_voz');
		expect(r).not.toContain('nao_usar');
		expect(r).not.toContain('{');
	});

	it('carrega o que muda a escrita: tom, público e o que NÃO usar', () => {
		const r = resumoDaMarca(escolherMarca([achatada()]));
		expect(r).toContain('Laser do Zé');
		// O enum vem como slug; `_` vira espaço sem uma tabela de rótulos que
		// apodreceria em silêncio quando a outra tool mudasse a lista.
		expect(r).toContain('proximo e informal');
		expect(r).toContain('noivas e cerimonialistas');
		expect(r).toContain('NUNCA use: emoji e "imperdível"');
	});

	it('marca pela metade não vira frase quebrada', () => {
		const r = resumoDaMarca(escolherMarca([{ nome: 'Só o nome' }]));
		expect(r).toBe('A MARCA DE QUEM VAI PUBLICAR — empresa "Só o nome".');
	});

	it('sem marca é string vazia, nunca "undefined"', () => {
		expect(resumoDaMarca(null)).toBe('');
	});

	it('texto gigante do aluno não come o teto de tokens do especialista', () => {
		const r = resumoDaMarca(
			escolherMarca([{ nome: 'X', nao_usar: 'a'.repeat(50_000) }]),
		);
		expect(r.length).toBeLessThanOrEqual(700);
	});
});

describe('varsDaMarca + interpolar — como a marca chega ao prompt', () => {
	it('só emite chaves prefixadas por `marca` (não sombreia a pesquisa)', () => {
		const vars = varsDaMarca(escolherMarca([achatada()]));
		for (const k of Object.keys(vars)) expect(k.startsWith('marca')).toBe(true);
		// As variáveis da pesquisa continuam de pé.
		const juntas = { produto: 'copo térmico', ...vars };
		expect(juntas.produto).toBe('copo térmico');
	});

	it('`{marca}` some do template quando o aluno não tem marca', () => {
		const pergunta =
			'Escreva o anúncio para vender {produto}. {marca} Dê 3 títulos.';
		const sem = interpolar(pergunta, { produto: 'copo térmico' });
		expect(sem).toBe(
			'Escreva o anúncio para vender copo térmico. Dê 3 títulos.',
		);
		expect(sem).not.toContain('{');
	});

	it('`{marca}` entra inteiro quando ele tem', () => {
		const vars = {
			produto: 'copo térmico',
			...varsDaMarca(escolherMarca([achatada()])),
		};
		const com = interpolar(
			'Escreva o anúncio para vender {produto}. {marca} Dê 3 títulos.',
			vars,
		);
		expect(com).toContain('copo térmico');
		expect(com).toContain('proximo e informal');
		expect(com).toContain('NUNCA use');
		expect(com).not.toContain('{');
	});

	it('sem marca, `varsDaMarca` é objeto vazio', () => {
		expect(varsDaMarca(null)).toEqual({});
	});
});

describe('visualDaMarca — a parte que uma página renderiza', () => {
	it('a cor de destaque do link é a PRIMÁRIA da marca', () => {
		const v = visualDaMarca(escolherMarca([achatada()]));
		expect(v.logo_url).toBe('https://cdn.example/marca.png');
		expect(v.cor).toBe('#ff5500');
	});

	// O nome é o que assina a proposta que vai para o cliente final: sem ele a
	// página é um preço sem remetente.
	it('leva o NOME da empresa junto do logo e da cor', () => {
		expect(visualDaMarca(escolherMarca([achatada()])).nome).toBe('Laser do Zé');
	});

	it('sem marca devolve vazio (quem chama decide o que fazer com isso)', () => {
		expect(visualDaMarca(null)).toEqual({ logo_url: '', cor: '', nome: '' });
	});
});

/**
 * O CONTRATO COM O `collection.query`.
 *
 * `optional` existe porque a leitura da marca atravessa DUAS tools: a dona
 * (`estudio_imagens`) pode estar em draft, a coleção pode ainda não existir e o
 * banco pode piscar — e nenhum desses três pode derrubar um run já pago por
 * causa de um dado que é enfeite.
 */
describe('collection.query — `optional` e `mine`', () => {
	it('`optional` transforma falha em resultado vazio, não em run derrubado', async () => {
		vi.resetModules();
		vi.doMock('@/lib/tool-definitions.js', () => ({
			loadPublishedToolDefinition: async () => {
				throw new Error('tool_not_found');
			},
		}));
		vi.doMock('@/lib/tool-collections.js', () => ({
			resolveCollection: () => ({ fields: [] }),
		}));
		vi.doMock('@/repositories/tool-collection.js', () => ({
			toolCollectionRepository: { list: async () => ({ items: [], total: 0 }) },
		}));
		const { collectionQueryBlock } = await import(
			'@/tool-blocks/blocks/collection.js'
		);
		const ctx = { customerId: 'c1' } as never;

		const vazio = await collectionQueryBlock.run(
			ctx,
			collectionQueryBlock.paramsSchema.parse({
				tool: 'estudio_imagens',
				collection: 'marca',
				optional: true,
			}),
		);
		expect(vazio.found).toBe(false);
		expect(vazio.items).toEqual([]);

		// Sem `optional`, o erro continua subindo: quem depende do dado tem que
		// saber que ele não veio.
		await expect(
			collectionQueryBlock.run(
				ctx,
				collectionQueryBlock.paramsSchema.parse({
					tool: 'estudio_imagens',
					collection: 'marca',
				}),
			),
		).rejects.toThrow();
		vi.doUnmock('@/lib/tool-definitions.js');
		vi.doUnmock('@/lib/tool-collections.js');
		vi.doUnmock('@/repositories/tool-collection.js');
		vi.resetModules();
	});

	it('`mine` filtra por dono no REPOSITÓRIO, não só pela visibilidade', async () => {
		vi.resetModules();
		const chamadas: Record<string, unknown>[] = [];
		vi.doMock('@/lib/tool-definitions.js', () => ({
			loadPublishedToolDefinition: async () => ({ definition: {} }),
		}));
		vi.doMock('@/lib/tool-collections.js', () => ({
			resolveCollection: () => ({ fields: [] }),
		}));
		vi.doMock('@/repositories/tool-collection.js', () => ({
			toolCollectionRepository: {
				list: async (
					_t: string,
					_c: string,
					_cfg: unknown,
					opts: Record<string, unknown>,
				) => {
					chamadas.push(opts);
					return { items: [], total: 0 };
				},
			},
		}));
		const { collectionQueryBlock } = await import(
			'@/tool-blocks/blocks/collection.js'
		);
		await collectionQueryBlock.run(
			{ customerId: 'aluno-1' } as never,
			collectionQueryBlock.paramsSchema.parse({
				tool: 'estudio_imagens',
				collection: 'marca',
				mine: true,
			}),
		);
		expect(chamadas[0]?.mineOnly).toBe(true);
		expect(chamadas[0]?.viewer).toEqual({
			customerId: 'aluno-1',
			isStaff: false,
		});
		vi.doUnmock('@/lib/tool-definitions.js');
		vi.doUnmock('@/lib/tool-collections.js');
		vi.doUnmock('@/repositories/tool-collection.js');
		vi.resetModules();
	});
});

describe('escolherMarca — a marca PRINCIPAL ganha da mais recente', () => {
	const base = { nome: 'X', tom_de_voz: 'Rústico', created_at: '' };

	it('usa a marcada como principal, mesmo sendo a mais ANTIGA', () => {
		// O defeito que originou o campo: a escolha do aluno vivia no localStorage,
		// o servidor lia sempre a mais recente, e a tela mostrava "em uso" numa
		// marca enquanto a arte saía com outra.
		const m = escolherMarca([
			{ ...base, nome: 'Nova', created_at: '2026-08-04T10:00:00Z' },
			{
				...base,
				nome: 'Escolhida',
				principal: true,
				created_at: '2026-01-01T10:00:00Z',
			},
		]);
		expect(m?.nome).toBe('Escolhida');
	});

	it('sem nenhuma principal, continua valendo a mais recente', () => {
		const m = escolherMarca([
			{ ...base, nome: 'Velha', created_at: '2026-01-01T10:00:00Z' },
			{ ...base, nome: 'Nova', created_at: '2026-08-04T10:00:00Z' },
		]);
		expect(m?.nome).toBe('Nova');
	});

	it('duas principais (corrida de edição) caem na mais recente entre elas', () => {
		const m = escolherMarca([
			{
				...base,
				nome: 'A',
				principal: true,
				created_at: '2026-01-01T10:00:00Z',
			},
			{
				...base,
				nome: 'B',
				principal: true,
				created_at: '2026-08-04T10:00:00Z',
			},
			{ ...base, nome: 'C', created_at: '2026-12-01T10:00:00Z' },
		]);
		expect(m?.nome).toBe('B');
	});

	it('`principal` como string "false" NÃO marca (Boolean("false") é true)', () => {
		const m = escolherMarca([
			{
				...base,
				nome: 'Falsa',
				principal: 'false',
				created_at: '2026-01-01T10:00:00Z',
			},
			{ ...base, nome: 'Recente', created_at: '2026-08-04T10:00:00Z' },
		]);
		expect(m?.nome).toBe('Recente');
	});
});
