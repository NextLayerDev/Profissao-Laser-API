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
	/**
	 * SÓ OS REGISTROS DO ALUNO QUE ESTÁ RODANDO.
	 *
	 * Uma coleção `visibility:'owner'` já esconde o registro dos outros — mas a
	 * imposição do back só existe onde a coleção DECLARA a visibilidade, e
	 * nasceu depois dos primeiros registros. `mine:true` fecha isso pelo outro
	 * lado, no filtro (`owner_id = eu`): mesmo que uma linha tenha sido gravada
	 * como pública por um escritor antigo, ela não entra na consulta de outro
	 * aluno. Vale a pena onde a resposta vira TEXTO DELE — a identidade da
	 * marca no anúncio da Central é o caso que motivou o parâmetro.
	 */
	mine: z.coerce.boolean().default(false),
	/**
	 * ESTA CONSULTA NÃO PODE DERRUBAR O RUN.
	 *
	 * Uma leitura entre tools tem três jeitos de falhar que não são culpa do
	 * aluno: a tool dona ainda está em DRAFT (`loadPublishedToolDefinition`
	 * devolve 404 para quem não é testador), a coleção ainda não foi declarada
	 * (`resolveCollection` devolve 404) ou o banco piscou. Sem este parâmetro,
	 * qualquer um dos três derruba um run JÁ PAGO por causa de um dado
	 * OPCIONAL — que é exatamente o caso da marca: quem não cadastrou marca
	 * nenhuma tem que receber o dossiê do mesmo jeito.
	 *
	 * Com `optional:true` a falha vira resultado VAZIO (`found:false`) e um
	 * `warn` no log. É deliberado que ele engula qualquer erro, e não só o 404:
	 * declarar `optional` é dizer que esta leitura não sustenta nada: se ela
	 * pudesse derrubar o run num 502, o parâmetro não estaria cumprindo o que
	 * promete. Quem depende do dado NÃO usa este parâmetro.
	 */
	optional: z.coerce.boolean().default(false),
});

/** Resultado de uma consulta que não achou (ou não pôde ler) nada. */
function nenhumRegistro() {
	return { items: [], json: [], count: 0, first: null, found: false };
}

export const collectionQueryBlock: ToolBlock<z.infer<typeof querySchema>> = {
	id: 'collection.query',
	category: 'data',
	description:
		'Consulta uma coleção da Fábrica com filtros, faixas e busca. Devolve os registros aprovados mais relevantes.',
	paramsSchema: querySchema,
	async run(ctx, p) {
		try {
			return await consultar(ctx, p);
		} catch (e) {
			if (!p.optional) throw e;
			console.warn(
				`[collection.query] leitura opcional de '${p.tool}/${p.collection}' falhou e foi ignorada: ${
					e instanceof Error ? e.message : String(e)
				}`,
			);
			return nenhumRegistro();
		}
	},
};

async function consultar(ctx: BlockRunContext, p: z.infer<typeof querySchema>) {
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
		mineOnly: p.mine,
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
}

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

/* ─────────────────────── collection.save ─────────────────────── */

const saveSchema = z
	.object({
		/** Tool dona da coleção onde gravar. */
		tool: z.string().min(1).max(60),
		collection: z.string().min(1).max(40).default('default'),
		title: z.string().min(1).max(200),
		description: z.string().max(2000).optional(),
		category: z.string().max(80).optional(),
		/**
		 * Base do registro, como JSON serializado. Opcional — normalmente o
		 * registro é montado pelos `set_*` abaixo.
		 */
		data: z.string().optional(),
		/**
		 * `owner` = do aluno (histórico dele). `public` = de todo mundo (um cache de
		 * pesquisa compartilhado). `staff` = configuração interna, invisível para
		 * aluno.
		 */
		visibility: z.enum(['owner', 'public', 'staff']).default('owner'),
		/**
		 * Campo de `data` que identifica o registro para não duplicar. Recarregar a
		 * página no meio de um run não pode gerar dois registros do mesmo trabalho.
		 */
		dedupe_key: z.string().max(60).optional(),
	})
	/**
	 * `set_<campo>` monta o registro campo a campo — é o único jeito que
	 * funciona com o resolvedor do motor, que é RASO: `resolveRefs` troca
	 * referência só no primeiro nível dos params, então uma referência dentro de
	 * um objeto aninhado ficaria literal (a string `"visao.text"` iria para o
	 * banco em vez do texto).
	 *
	 *   set_run_id: 'input.run_id'
	 *   set_resumo: 'visao.text'
	 *
	 * O `catchall` deixa essas chaves passarem pela validação do bloco; quem
	 * valida o CONTEÚDO é `validateCollectionData` contra os `fields` da coleção.
	 */
	.catchall(z.unknown());

type SaveParams = z.infer<typeof saveSchema>;

const PREFIXO_CAMPO = 'set_';

/**
 * `collection.save` — grava o resultado de um run numa coleção.
 *
 * POR QUE O SUFIXO `.save` IMPORTA: `skipInPreview` (`controllers/tool-run.ts`)
 * pula por convenção todo bloco terminado em `.save`. Nomeando assim, o preview
 * grátis continua não escrevendo nada no banco, sem uma linha de configuração.
 *
 * POR QUE ISTO EXISTE: é o que dá DURABILIDADE sem fila e sem tabela de job. Um
 * run longo (um time de agentes leva minutos) grava o resultado ANTES de
 * responder; se o socket do aluno morreu no caminho, o trabalho não evapora —
 * ele recarrega e está lá. De brinde vêm o histórico ("meus produtos
 * analisados") e o cache compartilhado entre alunos.
 *
 * Escreve pelo repositório, não pelo endpoint HTTP: o bloco já roda dentro do
 * servidor e passar por HTTP seria dar uma volta pela própria API só para
 * reautenticar quem já está autenticado.
 */
export const collectionSaveBlock: ToolBlock<SaveParams> = {
	id: 'collection.save',
	category: 'collection',
	description:
		'Grava o resultado do run numa coleção (histórico, cache). Pulado no preview por convenção do sufixo `.save`.',
	paramsSchema: saveSchema,
	async run(ctx, p) {
		const { toolCollectionRepository: repo } = await loadDeps();
		const cfg = await loadConfig(ctx, p.tool, p.collection);

		const data = parseJsonParam(p.data, 'data');
		// `set_*` vence a base: é o caminho normal de montar o registro.
		for (const [k, v] of Object.entries(p)) {
			if (k.startsWith(PREFIXO_CAMPO) && v !== undefined && v !== null) {
				data[k.slice(PREFIXO_CAMPO.length)] = v;
			}
		}

		const { validateCollectionData } = await import(
			'../../lib/tool-collections.js'
		);
		// Valida contra os `fields` declarados, igual ao caminho HTTP: um bloco
		// gravando lixo numa coleção é pior que um bloco falhando.
		const limpo = validateCollectionData(cfg.fields, data);

		/**
		 * Registro `public` é de TODO MUNDO (o cache de pesquisa), então não pode
		 * ter dono — senão o filtro `mine` do aluno passaria a devolver o cache
		 * inteiro como se fosse dele.
		 */
		const ownerId = p.visibility === 'owner' ? ctx.customerId : null;

		if (p.dedupe_key) {
			const chave = limpo[p.dedupe_key];
			if (chave !== undefined && chave !== null && chave !== '') {
				const achados = await repo.list(p.tool, p.collection, cfg, {
					viewer: { customerId: ctx.customerId, isStaff: true },
					filters: { [p.dedupe_key]: { kind: 'eq', value: String(chave) } },
					pageSize: 1,
					page: 1,
				});
				const existente = achados.items[0];
				if (existente) {
					const atualizado = await repo.update(
						existente.id,
						p.tool,
						p.collection,
						{
							title: p.title.slice(0, 200),
							description: p.description ?? null,
							/**
							 * MERGE, não substituição.
							 *
							 * O pipeline reescreve os campos que ele mesmo produz, mas o
							 * registro pode ter ganhado conteúdo do ALUNO depois de gravado
							 * — a conversa sobre o dossiê é o caso real. Trocar o jsonb
							 * inteiro apagava essa conversa sem erro e sem log, e ainda
							 * zerava o contador que segura o teto de perguntas, toda vez que
							 * o aluno mandasse refazer a análise.
							 */
							data: { ...existente.data, ...limpo },
						},
					);
					ctx.onProgress?.({
						kind: 'salvo',
						entry_id: atualizado.id,
						novo: false,
					});
					return { entry_id: atualizado.id, criado: false };
				}
			}
		}

		const entry = await repo.create({
			toolKey: p.tool,
			collection: p.collection,
			title: p.title.slice(0, 200),
			description: p.description ?? null,
			category: p.category ?? null,
			data: limpo,
			status: 'approved',
			ownerId,
			visibility: p.visibility,
			createdBy: ctx.customerId,
		});

		ctx.onProgress?.({ kind: 'salvo', entry_id: entry.id, novo: true });
		return { entry_id: entry.id, criado: true };
	},
};

export const collectionBlocks = [
	collectionQueryBlock,
	collectionNearestBlock,
	collectionSaveBlock,
];
