/**
 * Smoke do repositório de COLEÇÕES contra o Demo_DB de verdade.
 *
 * Existe porque a sintaxe do PostgREST (`.or()` com `and(...)`, `data->campo`
 * para faixa numérica, `.contains` para faceta) não é verificável por tipo:
 * um erro ali passa no build e no unit test, e só aparece em runtime — ou pior,
 * devolve o resultado ERRADO em silêncio (foi o caso de `->>` vs `->`).
 *
 * Semeia sob um `tool_key` de teste e APAGA tudo no final, inclusive se falhar.
 *
 *   npx tsx --env-file=.env scripts/_smoke-collections.ts
 */
import { supabase } from '../src/lib/supabase.js';
import type { CollectionConfig } from '../src/lib/tool-collections.js';
import { toolCollectionRepository as repo } from '../src/repositories/tool-collection.js';

const TOOL = '__smoke_collections__';
const COL = 'receitas';
const STAFF = { customerId: 'staff-1', isStaff: true };
const ALUNO = { customerId: 'aluno-1', isStaff: false };
const OUTRO = { customerId: 'aluno-2', isStaff: false };

const config: CollectionConfig = {
	fields: [
		{
			name: 'material',
			type: 'enum',
			options: ['aco', 'inox', 'aluminio'],
			facet: true,
		},
		{ name: 'espessura_mm', type: 'number', facet: 'range' },
		{ name: 'potencia_w', type: 'int', facet: 'range' },
		{
			name: 'operacao',
			type: 'enum',
			options: ['corte', 'gravacao'],
			facet: true,
		},
	],
	search: ['title', 'data.material'],
	nearest: { on: ['espessura_mm', 'potencia_w'], groupBy: ['material'] },
};

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
	console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${name}`);
	if (!ok) {
		failures++;
		if (detail !== undefined) console.log('        →', JSON.stringify(detail));
	}
}

async function cleanup() {
	await supabase.from('pl_tool_bank_entry').delete().eq('tool_key', TOOL);
}

async function main() {
	await cleanup();

	console.log('Semeando 60 registros...');
	const rows = Array.from({ length: 60 }, (_, i) => ({
		toolKey: TOOL,
		collection: COL,
		title: `Receita ${i}`,
		data: {
			material: ['aco', 'inox', 'aluminio'][i % 3],
			espessura_mm: 1 + (i % 20),
			potencia_w: 500 + (i % 6) * 1000,
			operacao: i % 2 === 0 ? 'corte' : 'gravacao',
		},
		status: 'approved' as const,
		ownerId: null,
	}));
	const n = await repo.createMany(rows);
	check('createMany insere em lote', n === 60, n);

	console.log('\nPaginação:');
	const p1 = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		pageSize: 24,
		page: 1,
	});
	const p2 = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		pageSize: 24,
		page: 2,
	});
	const p3 = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		pageSize: 24,
		page: 3,
	});
	check('total correto', p1.total === 60, p1.total);
	check('pages correto', p1.pages === 3, p1.pages);
	check(
		'tamanhos 24/24/12',
		p1.items.length === 24 && p2.items.length === 24 && p3.items.length === 12,
		[p1.items.length, p2.items.length, p3.items.length],
	);
	const ids = new Set([...p1.items, ...p2.items, ...p3.items].map((e) => e.id));
	check('sem repetição nem buraco entre páginas', ids.size === 60, ids.size);

	console.log('\nFacetas:');
	const aco = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		filters: { material: { kind: 'eq', value: 'aco' } },
		pageSize: 100,
	});
	check(
		'faceta enum filtra',
		aco.total === 20 && aco.items.every((e) => e.data.material === 'aco'),
		aco.total,
	);

	const duas = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		filters: {
			material: { kind: 'eq', value: 'aco' },
			operacao: { kind: 'eq', value: 'corte' },
		},
		pageSize: 100,
	});
	check(
		'duas facetas combinam (AND)',
		duas.items.every(
			(e) => e.data.material === 'aco' && e.data.operacao === 'corte',
		),
		duas.total,
	);

	console.log('\nFaixa numérica (a armadilha do ->> vs ->):');
	const grossas = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		filters: { espessura_mm: { kind: 'range', min: 10 } },
		pageSize: 100,
	});
	const menores = grossas.items.filter((e) => Number(e.data.espessura_mm) < 10);
	check(
		'espessura >= 10 NÃO traz 9mm (comparação numérica, não alfabética)',
		menores.length === 0,
		menores.map((e) => e.data.espessura_mm),
	);
	check(
		'faixa min+max',
		(
			await repo.list(TOOL, COL, config, {
				viewer: STAFF,
				filters: { espessura_mm: { kind: 'range', min: 5, max: 8 } },
				pageSize: 100,
			})
		).items.every((e) => {
			const v = Number(e.data.espessura_mm);
			return v >= 5 && v <= 8;
		}),
	);

	console.log('\nContagem de facetas:');
	const counts = await repo.facetCounts(TOOL, COL, config, { viewer: STAFF });
	check(
		'conta por opção',
		counts.material?.aco === 20 && counts.material?.inox === 20,
		counts.material,
	);
	const countsFiltrado = await repo.facetCounts(TOOL, COL, config, {
		viewer: STAFF,
		filters: { material: { kind: 'eq', value: 'aco' } },
	});
	check(
		'faceta NÃO se filtra a si mesma (senão o usuário fica preso na escolha)',
		countsFiltrado.material?.inox === 20,
		countsFiltrado.material,
	);

	console.log('\nBusca textual:');
	const busca = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		q: 'Receita 1',
		pageSize: 100,
	});
	check('busca por título retorna algo', busca.total > 0, busca.total);

	console.log('\nModeração e visibilidade:');
	const pend = await repo.create({
		toolKey: TOOL,
		collection: COL,
		title: 'Submissão do aluno',
		data: {
			material: 'aco',
			espessura_mm: 2,
			potencia_w: 1000,
			operacao: 'corte',
		},
		status: 'pending',
		ownerId: ALUNO.customerId,
	});
	const comoStaff = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		pageSize: 100,
	});
	const comoDono = await repo.list(TOOL, COL, config, {
		viewer: ALUNO,
		pageSize: 100,
	});
	const comoOutro = await repo.list(TOOL, COL, config, {
		viewer: OUTRO,
		pageSize: 100,
	});
	check(
		'staff vê o pendente',
		comoStaff.items.some((e) => e.id === pend.id),
	);
	check(
		'o próprio autor vê o seu pendente',
		comoDono.items.some((e) => e.id === pend.id),
	);
	check(
		'outro aluno NÃO vê o pendente',
		!comoOutro.items.some((e) => e.id === pend.id),
	);

	const priv = await repo.create({
		toolKey: TOOL,
		collection: COL,
		title: 'Só staff',
		data: {
			material: 'inox',
			espessura_mm: 1,
			potencia_w: 500,
			operacao: 'corte',
		},
		status: 'approved',
		ownerId: ALUNO.customerId,
		visibility: 'staff',
	});
	check(
		'visibility:staff não vaza nem para o autor',
		!(
			await repo.list(TOOL, COL, config, { viewer: ALUNO, pageSize: 100 })
		).items.some((e) => e.id === priv.id),
	);

	console.log('\nFeedback e score (trigger de Laplace):');
	const alvo = p1.items[0];
	await repo.upsertFeedback({
		entryId: alvo.id,
		customerId: 'c1',
		kind: 'result',
		outcome: 'sucesso',
	});
	await repo.upsertFeedback({
		entryId: alvo.id,
		customerId: 'c2',
		kind: 'result',
		outcome: 'sucesso',
	});
	await repo.upsertFeedback({
		entryId: alvo.id,
		customerId: 'c3',
		kind: 'result',
		outcome: 'falha',
	});
	let depois = await repo.findById(alvo.id, TOOL, COL);
	// (2*2 + 0 + 1) / (2*3 + 2) = 5/8 = 0.625
	check(
		'score de Laplace = 0.625 com 2 sucessos e 1 falha',
		Math.abs(Number(depois?.score) - 0.625) < 1e-6,
		depois?.score,
	);
	check(
		'stats desnormalizado bate',
		depois?.stats?.ok === 2 && depois?.stats?.falha === 1,
		depois?.stats,
	);

	await repo.upsertFeedback({
		entryId: alvo.id,
		customerId: 'c3',
		kind: 'result',
		outcome: 'sucesso',
	});
	depois = await repo.findById(alvo.id, TOOL, COL);
	// upsert, não insert duplicado: 3 sucessos → (2*3+1)/(2*3+2) = 7/8
	check(
		'upsert troca o relato em vez de duplicar (0.875)',
		Math.abs(Number(depois?.score) - 0.875) < 1e-6,
		depois?.score,
	);

	await repo.removeFeedback(alvo.id, 'c3', 'result');
	depois = await repo.findById(alvo.id, TOOL, COL);
	// 2 sucessos → (2*2+1)/(2*2+2) = 5/6
	check(
		'apagar relato recalcula (trigger cobre DELETE)',
		Math.abs(Number(depois?.score) - 5 / 6) < 1e-6,
		depois?.score,
	);

	const meu = await repo.myFeedback([alvo.id], 'c1');
	check(
		'myFeedback devolve o que este cliente marcou',
		meu[alvo.id]?.result?.outcome === 'sucesso',
		meu,
	);

	console.log('\nOrdenação por score:');
	const porScore = await repo.list(TOOL, COL, config, {
		viewer: STAFF,
		sort: 'score',
		pageSize: 5,
	});
	check(
		'o registro com score vem primeiro',
		porScore.items[0]?.id === alvo.id,
		porScore.items[0]?.title,
	);

	console.log('\nReceita mais próxima:');
	const near = await repo.nearest(
		TOOL,
		COL,
		config,
		{ espessura_mm: 6, potencia_w: 1500 },
		{ material: 'aco' },
	);
	check(
		'só traz o grupo pedido',
		near.every((r) => r.entry.data.material === 'aco'),
		near.length,
	);
	check(
		'ordenado por distância crescente',
		near.every((r, i) => i === 0 || near[i - 1].distance <= r.distance),
	);
	const top = near[0];
	check(
		'o mais próximo é plausível (espessura perto de 6)',
		Math.abs(Number(top?.entry.data.espessura_mm) - 6) <= 3,
		{
			esp: top?.entry.data.espessura_mm,
			pot: top?.entry.data.potencia_w,
			d: top?.distance,
		},
	);
	// A regressão que motivou o corte: `nearest` é recomendação, então NUNCA
	// pode devolver submissão pendente — nem para staff, que enxerga pendente
	// no `list`.
	check(
		'nunca recomenda registro pendente (nem para staff)',
		!near.some((r) => r.entry.id === pend.id),
	);
	check(
		'nunca recomenda registro privado',
		!near.some((r) => r.entry.id === priv.id),
	);

	console.log('\nRAG:');
	const rag = await repo.listForRag(TOOL, COL);
	check(
		'listForRag traz só aprovado+ativo+público',
		rag.every(
			(e) => e.status === 'approved' && e.active && e.visibility === 'public',
		),
		rag.length,
	);
	check(
		'listForRag exclui o pendente e o privado',
		!rag.some((e) => e.id === pend.id || e.id === priv.id),
	);

	console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} FALHA(S)`);
}

main()
	.catch((err) => {
		console.error(err);
		failures++;
	})
	.finally(async () => {
		await cleanup();
		console.log('(limpo)');
		process.exit(failures === 0 ? 0 : 1);
	});
