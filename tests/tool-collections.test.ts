import { describe, expect, it } from 'vitest';

import {
	type CollectionConfig,
	collectionFacets,
	isFieldApplicable,
	lerPerguntasChat,
	montarContextoChat,
	podarPerguntas,
	renderCollectionEntry,
	resolveCollection,
	resolveVisibility,
	validateCollectionData,
} from '@/lib/tool-collections.js';

/** Recorte da coleção real do Metallic — o caso que motiva o desenho. */
const receitas: CollectionConfig = {
	label: 'Receitas de corte',
	fields: [
		{
			name: 'material',
			type: 'enum',
			options: ['aco_carbono', 'aco_inox'],
			required: true,
			facet: true,
		},
		{
			name: 'espessura_mm',
			type: 'number',
			required: true,
			facet: 'range',
			unit: 'mm',
			min: 0.1,
			max: 50,
		},
		{
			name: 'operacao',
			type: 'enum',
			options: ['corte', 'gravacao'],
			required: true,
			facet: true,
		},
		{ name: 'velocidade_mm_s', type: 'number', required: true },
		{ name: 'potencia_w', type: 'int', facet: 'range', unit: 'W' },
		// Só existem quando a operação é corte.
		{
			name: 'gas',
			type: 'enum',
			options: ['ar', 'o2', 'n2'],
			required: true,
			showIf: { operacao: 'corte' },
		},
		{ name: 'pressao_bar', type: 'number', showIf: { operacao: 'corte' } },
		{ name: 'observacoes', type: 'textarea' },
	],
	rag: {
		enabled: true,
		template:
			'{data.material} {data.espessura_mm}mm · {data.operacao} · {data.velocidade_mm_s}mm/s · gás {data.gas}',
	},
};

describe('resolveCollection', () => {
	it('acha a coleção declarada', () => {
		expect(
			resolveCollection({ collections: { receitas } }, 'receitas').label,
		).toBe('Receitas de corte');
	});

	it('serve o `bank` legado como collections.default', () => {
		// Retrocompatibilidade: o Prompts Mágicos precisa continuar funcionando
		// pela API de coleções sem nenhuma mudança na definition dele.
		const c = resolveCollection(
			{
				bank: {
					enabled: true,
					fields: [{ name: 'prompt_script', type: 'textarea' }],
				},
			},
			'default',
		);
		expect(c.fields).toHaveLength(1);
		expect(c.submissions?.who).toBe('admin');
	});

	it('404 em coleção inexistente', () => {
		expect(() => resolveCollection({}, 'naoexiste')).toThrow(/não existe/);
	});

	it('400 em nome inválido (vira rota e chave de índice)', () => {
		expect(() =>
			resolveCollection({ collections: { receitas } }, '../etc'),
		).toThrow(/inválido/);
		expect(() =>
			resolveCollection({ collections: { receitas } }, 'Maiuscula'),
		).toThrow();
	});
});

/** Campo da fixture, com erro que aponta o campo que sumiu. */
function campo(nome: string) {
	const f = receitas.fields.find((x) => x.name === nome);
	if (!f) throw new Error(`fixture sem o campo '${nome}'`);
	return f;
}

describe('showIf', () => {
	// `find` devolve `| undefined`; o `!` calava o tipo e o biome recusa. Uma
	// falha aqui e defeito da FIXTURE, e o erro tem que dizer isso.
	const gas = campo('gas');

	it('aplica quando a condição bate', () => {
		expect(isFieldApplicable(gas, { operacao: 'corte' })).toBe(true);
	});

	it('não aplica quando não bate', () => {
		expect(isFieldApplicable(gas, { operacao: 'gravacao' })).toBe(false);
	});

	it('campo sem showIf sempre se aplica', () => {
		const m = campo('material');
		expect(isFieldApplicable(m, {})).toBe(true);
	});
});

describe('validateCollectionData', () => {
	const base = {
		material: 'aco_carbono',
		espessura_mm: '3',
		operacao: 'corte',
		velocidade_mm_s: '45',
		gas: 'o2',
	};

	it('coage strings do multipart/CSV para número', () => {
		const out = validateCollectionData(receitas.fields, base);
		expect(out.espessura_mm).toBe(3);
		expect(out.velocidade_mm_s).toBe(45);
	});

	it('exige campo condicional quando a condição bate', () => {
		const { gas: _omitido, ...semGas } = base;
		expect(() => validateCollectionData(receitas.fields, semGas)).toThrow(
			/gas/,
		);
	});

	it('NÃO exige campo condicional quando a condição não bate', () => {
		const out = validateCollectionData(receitas.fields, {
			material: 'aco_inox',
			espessura_mm: 2,
			operacao: 'gravacao',
			velocidade_mm_s: 800,
		});
		expect(out.gas).toBeUndefined();
		expect(out.operacao).toBe('gravacao');
	});

	it('descarta campo não declarado (ninguém injeta chave no jsonb)', () => {
		const out = validateCollectionData(receitas.fields, {
			...base,
			hackzor: 'drop table',
		});
		expect(out.hackzor).toBeUndefined();
	});

	it('rejeita valor fora do enum', () => {
		expect(() =>
			validateCollectionData(receitas.fields, { ...base, material: 'madeira' }),
		).toThrow(/material/);
	});

	it('respeita min/max', () => {
		expect(() =>
			validateCollectionData(receitas.fields, { ...base, espessura_mm: 999 }),
		).toThrow(/espessura/i);
	});

	it('acumula TODOS os erros, não só o primeiro', () => {
		try {
			validateCollectionData(receitas.fields, { operacao: 'corte' });
			throw new Error('deveria ter lançado');
		} catch (e) {
			const msg = (e as Error).message;
			expect(msg).toContain('material');
			expect(msg).toContain('espessura_mm');
			expect(msg).toContain('gas');
		}
	});

	it('exige inteiro em type:int', () => {
		expect(() =>
			validateCollectionData(receitas.fields, { ...base, potencia_w: 1500.5 }),
		).toThrow(/potencia/i);
	});
});

describe('collectionFacets', () => {
	it('deriva facetas de fields[].facet, com tipo e unidade', () => {
		const f = collectionFacets(receitas);
		expect(f.map((x) => x.name)).toEqual([
			'material',
			'espessura_mm',
			'operacao',
			'potencia_w',
		]);
		expect(f[1]).toMatchObject({ kind: 'range', unit: 'mm' });
		expect(f[0]).toMatchObject({
			kind: 'enum',
			options: ['aco_carbono', 'aco_inox'],
		});
	});
});

describe('renderCollectionEntry', () => {
	it('renderiza pelo template do rag', () => {
		const txt = renderCollectionEntry(receitas, {
			title: 'Aço 3mm',
			data: {
				material: 'aco_carbono',
				espessura_mm: 3,
				operacao: 'corte',
				velocidade_mm_s: 45,
				gas: 'o2',
			},
		});
		expect(txt).toBe('aco_carbono 3mm · corte · 45mm/s · gás o2');
	});

	it('não deixa buraco quando um campo opcional falta', () => {
		// Sem colapsar espaço e separador, sairia "… · 45mm/s · gás " — lixo no RAG.
		const txt = renderCollectionEntry(receitas, {
			title: 'Gravação',
			data: {
				material: 'aco_inox',
				espessura_mm: 2,
				operacao: 'gravacao',
				velocidade_mm_s: 800,
			},
		});
		expect(txt).toBe('aco_inox 2mm · gravacao · 800mm/s · gás');
		expect(txt).not.toMatch(/\s{2,}/);
	});

	it('sem template, monta rótulo: valor dos campos presentes', () => {
		const txt = renderCollectionEntry(
			{ fields: receitas.fields },
			{ title: 'X', description: 'desc', data: { material: 'aco_inox' } },
		);
		expect(txt).toContain('X');
		expect(txt).toContain('desc');
		expect(txt).toContain('material: aco_inox');
	});
});

/* ─────────────────────────── Conversa ─────────────────────────── */

/** Recorte da coleção `dossies` da Central de Inteligência. */
const dossies: CollectionConfig = {
	label: 'Meus produtos analisados',
	fields: [
		{ name: 'resumo', label: 'Resumo', type: 'textarea', required: true },
		{ name: 'raw', label: 'Dossiê completo', type: 'textarea' },
		{ name: 'nota', label: 'Nota de oportunidade', type: 'int' },
		{ name: 'perguntas', label: 'Perguntas', type: 'textarea' },
	],
	chat: { enabled: true, contextoDe: ['resumo', 'raw'], maxPerguntas: 8 },
};

describe('montarContextoChat', () => {
	it('junta só os campos de contextoDe, rotulados e na ordem declarada', () => {
		const txt = montarContextoChat(dossies, {
			raw: '{"precos":[10,20]}',
			resumo: 'Caneca gravada vende bem.',
			nota: 72,
			// O histórico não pode voltar como contexto: a resposta anterior viraria
			// fonte da próxima, e o modelo passaria a citar a si mesmo como dossiê.
			perguntas:
				'[{"p":"e o frete?","r":"não está no dossiê","em":"2026-08-01"}]',
		});

		expect(txt).toBe(
			'## Resumo\nCaneca gravada vende bem.\n\n## Dossiê completo\n{"precos":[10,20]}',
		);
		expect(txt).not.toContain('72');
		expect(txt).not.toContain('frete');
	});

	it('pula campo ausente ou vazio sem deixar rótulo órfão', () => {
		const txt = montarContextoChat(dossies, {
			resumo: 'Só o resumo.',
			raw: '',
		});
		expect(txt).toBe('## Resumo\nSó o resumo.');
	});

	it('corta do FIM: o campo mais importante sobrevive inteiro', () => {
		// É por isso que a ordem de `contextoDe` é contrato e não estilo.
		const txt = montarContextoChat(
			dossies,
			{ resumo: 'importante', raw: 'x'.repeat(5_000) },
			80,
		);
		expect(txt.length).toBeLessThanOrEqual(80);
		expect(txt).toContain('## Resumo\nimportante');
		expect(txt.endsWith('…')).toBe(true);
	});

	it('não entra rótulo sem conteúdo embaixo quando o teto acaba', () => {
		const txt = montarContextoChat(
			dossies,
			{ resumo: 'a'.repeat(40), raw: 'b'.repeat(40) },
			52,
		);
		expect(txt).not.toContain('Dossiê completo');
		expect(txt.length).toBeLessThanOrEqual(52);
	});

	it('sem contextoDe, usa todos os campos declarados', () => {
		const semLista: CollectionConfig = {
			fields: dossies.fields,
			chat: { enabled: true },
		};
		const txt = montarContextoChat(semLista, { resumo: 'r', nota: 72 });
		expect(txt).toContain('## Resumo\nr');
		// Valor não-string ainda precisa chegar legível ao modelo.
		expect(txt).toContain('## Nota de oportunidade\n72');
	});

	it('NUNCA leva o histórico junto, nem no fallback sem contextoDe', () => {
		const semLista: CollectionConfig = {
			fields: [
				...dossies.fields,
				{ name: 'perguntas', label: 'Perguntas do aluno', type: 'textarea' },
			],
			chat: { enabled: true },
		};
		const txt = montarContextoChat(semLista, {
			resumo: 'r',
			perguntas: JSON.stringify([
				{ p: 'quanto custa?', r: 'uns R$ 90', em: '' },
			]),
		});
		// A resposta anterior viraria fonte autorizada da próxima — o modelo
		// passaria a citar o que ele mesmo escreveu como se estivesse no dossiê.
		expect(txt).not.toContain('uns R$ 90');
		expect(txt).toContain('## Resumo\nr');
	});
});

describe('podarPerguntas', () => {
	const turno = (i: number, tamanho: number) => ({
		p: `pergunta ${i}`,
		r: 'x'.repeat(tamanho),
		em: '2026-08-03T00:00:00.000Z',
	});

	it('não mexe no que já cabe', () => {
		const lista = [turno(1, 100), turno(2, 100)];
		expect(podarPerguntas(lista, 5_000)).toEqual(lista);
	});

	it('corta os turnos MAIS ANTIGOS até caber', () => {
		const lista = [turno(1, 400), turno(2, 400), turno(3, 400)];
		const podada = podarPerguntas(lista, 900);
		expect(JSON.stringify(podada).length).toBeLessThanOrEqual(900);
		// O último turno é o que o aluno acabou de ler: ele nunca é o descartado.
		expect(podada[podada.length - 1]?.p).toBe('pergunta 3');
		expect(podada.some((t) => t.p === 'pergunta 1')).toBe(false);
	});

	it('um único turno gigante é cortado, não descartado', () => {
		const podada = podarPerguntas([turno(1, 40_000)], 1_000);
		expect(podada).toHaveLength(1);
		expect(JSON.stringify(podada).length).toBeLessThanOrEqual(1_000);
		expect(podada[0]?.p).toBe('pergunta 1');
	});

	it('lista vazia continua vazia', () => {
		expect(podarPerguntas([], 100)).toEqual([]);
	});
});

describe('lerPerguntasChat', () => {
	it('lê o histórico como JSON serializado (o formato do contrato)', () => {
		const h = lerPerguntasChat({
			perguntas:
				'[{"p":"vale a pena?","r":"vale","em":"2026-08-01T10:00:00Z"}]',
		});
		expect(h).toHaveLength(1);
		expect(h[0]).toEqual({
			p: 'vale a pena?',
			r: 'vale',
			em: '2026-08-01T10:00:00Z',
		});
	});

	it('aceita array já desserializado (o jsonb devolve o que foi escrito)', () => {
		const h = lerPerguntasChat({ perguntas: [{ p: 'a', r: 'b', em: 'c' }] });
		expect(h).toHaveLength(1);
	});

	it('histórico corrompido não bloqueia a pergunta', () => {
		// Recusar a pergunta por causa de um campo ilegível seria pior que perder a
		// contagem: o aluno já pagou pela análise.
		expect(lerPerguntasChat({ perguntas: 'não é json' })).toEqual([]);
		expect(lerPerguntasChat({ perguntas: '{"p":"objeto solto"}' })).toEqual([]);
		expect(
			lerPerguntasChat({ perguntas: [null, 7, { r: 'sem pergunta' }] }),
		).toEqual([]);
		expect(lerPerguntasChat({})).toEqual([]);
	});
});

/* ─────────────────────────── Visibilidade ─────────────────────────── */

describe('visibilidade na ESCRITA — o portão do IP interno', () => {
	/**
	 * A leitura já sabia esconder `visibility:'staff'` (`scoped()` no repositório
	 * aplica `.neq('visibility','staff')` para quem não é staff). Só que a
	 * escrita não deixava NINGUÉM criar um registro assim — tudo nascia `public`
	 * ou `owner`.
	 *
	 * O buraco só ficou visível quando uma coleção passou a guardar CONFIGURAÇÃO
	 * INTERNA: os system prompts dos agentes de pesquisa, que são o produto.
	 * Sem isto, `GET /api/tools/:key/c/agentes` entregaria os prompts para
	 * qualquer aluno logado.
	 */
	it('staff consegue criar registro interno (`staff`)', () => {
		expect(resolveVisibility('staff', true)).toBe('staff');
	});

	it('ALUNO nunca consegue criar registro interno, nem pedindo', () => {
		expect(resolveVisibility('staff', false)).toBe('public');
	});

	it('aluno continua podendo guardar coisa dele (`owner`)', () => {
		// É o que protege perfil de custo: preço de compra, salário, margem.
		expect(resolveVisibility('owner', false)).toBe('owner');
		expect(resolveVisibility('owner', true)).toBe('owner');
	});

	it('sem pedido, ou com pedido inválido, cai em público — como antes', () => {
		expect(resolveVisibility(undefined, false)).toBe('public');
		expect(resolveVisibility(undefined, true)).toBe('public');
		expect(resolveVisibility('qualquer-coisa', true)).toBe('public');
		expect(resolveVisibility({ nao: 'é string' }, true)).toBe('public');
	});
});

describe('visibilidade DECLARADA pela coleção', () => {
	/**
	 * O outro lado do mesmo portão. A coleção `perfis` da Central de Custos
	 * declara `visibility:'owner'` desde o primeiro dia — mas a declaração era só
	 * um comentário: quem gravava era o CLIENTE, no corpo do POST. Uma tela que
	 * esquecesse o campo (ou um `curl`) criava o perfil de custo do aluno — preço
	 * de compra, salário, margem — como PÚBLICO, sem erro e sem log. A marca do
	 * Ateliê (logo, cores, tom de voz) mora exatamente no mesmo lugar.
	 */
	it('coleção `owner`: registro de aluno nasce privado mesmo sem pedido', () => {
		expect(resolveVisibility(undefined, false, 'owner')).toBe('owner');
	});

	it('coleção `owner`: aluno pedindo `public` não abre o registro', () => {
		expect(resolveVisibility('public', false, 'owner')).toBe('owner');
		expect(resolveVisibility('qualquer-coisa', false, 'owner')).toBe('owner');
	});

	it('aluno ainda pode pedir MAIS privacidade que o declarado', () => {
		// O declarado é piso de privacidade, não teto.
		expect(resolveVisibility('owner', false, 'public')).toBe('owner');
	});

	it('coleção `staff`: para aluno vira `owner`, nunca `staff`', () => {
		/**
		 * `scoped()` esconde `visibility:'staff'` de todo não-staff — INCLUSIVE do
		 * dono. Um registro de aluno criado como `staff` sumiria da tela dele no
		 * segundo seguinte ao cadastro.
		 */
		expect(resolveVisibility(undefined, false, 'staff')).toBe('owner');
		expect(resolveVisibility('owner', false, 'staff')).toBe('owner');
	});

	it('staff mandando explicitamente continua mandando', () => {
		// É o que preserva o roster de agentes (`staff`) e qualquer publicação
		// deliberada da equipe dentro de uma coleção privada.
		expect(resolveVisibility('staff', true, 'owner')).toBe('staff');
		expect(resolveVisibility('public', true, 'owner')).toBe('public');
		expect(resolveVisibility('owner', true, 'public')).toBe('owner');
	});

	it('staff em SILÊNCIO herda o declarado (lead não nasce público)', () => {
		// Sem pedido explícito, o registro criado pela equipe numa coleção privada
		// segue a coleção — o bug é o mesmo, só muda o autor.
		expect(resolveVisibility(undefined, true, 'owner')).toBe('owner');
		expect(resolveVisibility(undefined, true, undefined)).toBe('public');
	});

	it('coleção sem declaração: nada muda em relação ao que já rodava', () => {
		expect(resolveVisibility(undefined, false, undefined)).toBe('public');
		expect(resolveVisibility('owner', false, undefined)).toBe('owner');
		expect(resolveVisibility('staff', false, undefined)).toBe('public');
	});
});
