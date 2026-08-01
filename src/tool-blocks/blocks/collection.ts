import { z } from 'zod';
import type { CollectionConfig } from '../../lib/tool-collections.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { BlockRunContext, ToolBlock } from '../types.js';

/**
 * Blocos de leitura de COLEÇÃO.
 *
 * São o que permite um pipeline (ou, depois, um agente) consultar qualquer
 * dataset da Fábrica sem código novo: a Central de Custos busca a velocidade
 * de corte na coleção que o Metallic alimenta, e o assistente do Metallic
 * responde a partir da mesma base — tudo por `definition`, nada hardcoded.
 *
 * Só leem registro APROVADO (o repositório garante), porque a saída deles vira
 * número em orçamento e receita de corte.
 */

/** Filtros vêm como JSON serializado: o motor trafega params como string. */
function parseJsonParam(
	raw: string | undefined,
	label: string,
): Record<string, unknown> {
	if (!raw) return {};
	if (typeof raw === 'object') return raw as Record<string, unknown>;
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	} catch {
		throw new ToolEngineError(400, `${label} não é um JSON válido`);
	}
}

/**
 * Carrega a definition e o repositório SOB DEMANDA.
 *
 * Import dinâmico de propósito: `tool-definitions` e o cliente Supabase
 * validam env no topo do módulo, e este bloco entra no registry, que é
 * importado por todo teste do motor. Com import estático, rodar um teste de
 * pipeline exigiria `EXTERNAL_API_URL` e credencial de banco — encanamento
 * vazando para dentro da suíte.
 */
async function loadDeps() {
	const [
		{ loadPublishedToolDefinition },
		{ resolveCollection },
		{ toolCollectionRepository },
	] = await Promise.all([
		import('../../lib/tool-definitions.js'),
		import('../../lib/tool-collections.js'),
		import('../../repositories/tool-collection.js'),
	]);
	return {
		loadPublishedToolDefinition,
		resolveCollection,
		toolCollectionRepository,
	};
}

async function loadConfig(
	ctx: BlockRunContext,
	toolKey: string,
	collection: string,
): Promise<CollectionConfig> {
	const { loadPublishedToolDefinition, resolveCollection } = await loadDeps();
	const row = await loadPublishedToolDefinition(
		toolKey,
		ctx.customerId,
		ctx.authHeader,
	);
	return resolveCollection(row.definition, collection);
}

/* ─────────────────────── collection.query ─────────────────────── */

const querySchema = z.object({
	/** Tool dona da coleção. Pode ser outra tool — é assim que o orçamento lê a base do Metallic. */
	tool: z.string().min(1).max(60),
	collection: z.string().min(1).max(40).default('default'),
	/** `{"material":"aco_carbono","operacao":"corte"}` — valor exato. */
	filters: z.string().optional(),
	/** `{"espessura_mm":{"min":2,"max":4}}` — faixas numéricas. */
	ranges: z.string().optional(),
	q: z.string().max(200).optional(),
	sort: z.string().max(20).default('score'),
	limit: z.coerce.number().int().min(1).max(50).default(5),
});

export const collectionQueryBlock: ToolBlock<z.infer<typeof querySchema>> = {
	id: 'collection.query',
	category: 'data',
	description:
		'Consulta uma coleção da Fábrica com filtros, faixas e busca. Devolve os registros aprovados mais relevantes.',
	paramsSchema: querySchema,
	async run(ctx, p) {
		const config = await loadConfig(ctx, p.tool, p.collection);
		const { toolCollectionRepository: repo } = await loadDeps();

		const filters: Record<
			string,
			| { kind: 'eq'; value: string | number }
			| { kind: 'range'; min?: number; max?: number }
		> = {};
		for (const [k, v] of Object.entries(parseJsonParam(p.filters, 'filters'))) {
			if (v !== undefined && v !== null && v !== '') {
				filters[k] = { kind: 'eq', value: v as string | number };
			}
		}
		for (const [k, v] of Object.entries(parseJsonParam(p.ranges, 'ranges'))) {
			const r = v as { min?: number; max?: number };
			filters[k] = {
				kind: 'range',
				...(Number.isFinite(r?.min) ? { min: Number(r.min) } : {}),
				...(Number.isFinite(r?.max) ? { max: Number(r.max) } : {}),
			};
		}

		const result = await repo.list(p.tool, p.collection, config, {
			// Bloco lê como PÚBLICO, nunca como staff: a saída dele vira número em
			// orçamento e parâmetro de corte, então não pode incluir registro
			// pendente de moderação nem privado de outra pessoa.
			viewer: { customerId: ctx.customerId, isStaff: false },
			filters,
			q: p.q,
			sort: p.sort,
			pageSize: p.limit,
			page: 1,
		});

		const items = result.items.map((e) => ({
			id: e.id,
			title: e.title,
			score: e.score,
			...e.data,
		}));

		return {
			items,
			json: items,
			count: result.total,
			// Facilita o caso mais comum ("me dá o melhor") sem o pipeline precisar
			// de um bloco de índice.
			first: items[0] ?? null,
			found: items.length > 0,
		};
	},
};

/* ────────────────────── collection.nearest ────────────────────── */

const nearestSchema = z.object({
	tool: z.string().min(1).max(60),
	collection: z.string().min(1).max(40).default('default'),
	/** `{"espessura_mm":3,"potencia_w":1500}` — o alvo da interpolação. */
	target: z.string(),
	/** `{"material":"aco_carbono"}` — restringe ao grupo comparável. */
	group: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(25).default(3),
});

export const collectionNearestBlock: ToolBlock<z.infer<typeof nearestSchema>> =
	{
		id: 'collection.nearest',
		category: 'data',
		description:
			'Registro mais próximo de uma coleção por interpolação (ex.: receita para uma espessura que não existe na base). Marca claramente se o resultado é exato ou aproximado.',
		paramsSchema: nearestSchema,
		async run(ctx, p) {
			const config = await loadConfig(ctx, p.tool, p.collection);
			const { toolCollectionRepository: repo } = await loadDeps();
			if (!config.nearest?.on?.length) {
				throw new ToolEngineError(
					400,
					`a coleção '${p.collection}' não declara \`nearest\``,
				);
			}

			const targetRaw = parseJsonParam(p.target, 'target');
			const target: Record<string, number> = {};
			for (const [k, v] of Object.entries(targetRaw)) {
				const n = Number(v);
				if (Number.isFinite(n)) target[k] = n;
			}
			if (!Object.keys(target).length) {
				throw new ToolEngineError(400, 'target precisa de ao menos um número');
			}

			const groupRaw = parseJsonParam(p.group, 'group');
			const group: Record<string, string | number> = {};
			for (const [k, v] of Object.entries(groupRaw)) {
				if (v !== undefined && v !== null && v !== '') {
					group[k] = v as string | number;
				}
			}

			const hits = await repo.nearest(
				p.tool,
				p.collection,
				config,
				target,
				group,
			);
			const items = hits.slice(0, p.limit).map((h) => ({
				id: h.entry.id,
				title: h.entry.title,
				score: h.entry.score,
				distance: Number(h.distance.toFixed(4)),
				exact: h.distance === 0,
				...h.entry.data,
			}));

			return {
				items,
				json: items,
				first: items[0] ?? null,
				found: items.length > 0,
				/**
				 * `exact:false` é a informação mais importante desta saída. Quem consome
				 * (tela ou agente) TEM que dizer ao usuário que é aproximação — uma
				 * receita interpolada apresentada como validada é o pior modo de falha
				 * possível: alguém corta chapa com ela.
				 */
				exact: items[0]?.exact ?? false,
			};
		},
	};

export const collectionBlocks = [collectionQueryBlock, collectionNearestBlock];
