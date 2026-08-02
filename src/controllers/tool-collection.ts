import type { FastifyReply, FastifyRequest } from 'fastify';
import { csvCell, parseCsv } from '../lib/csv.js';
import { isStaffRole } from '../lib/external-auth.js';
import {
	type CollectionConfig,
	collectionFacets,
	resolveCollection,
	validateCollectionData,
} from '../lib/tool-collections.js';
import {
	loadPublishedToolDefinition,
	ToolDefinitionLoadError,
} from '../lib/tool-definitions.js';
import { ToolEngineError } from '../lib/tool-errors.js';
import {
	type CollectionEntry,
	type FacetFilter,
	rangeFields,
	toolCollectionRepository as repo,
} from '../repositories/tool-collection.js';

/**
 * API GENÉRICA DAS COLEÇÕES.
 *
 * Nenhum handler aqui sabe o que é "Metallic", "materiais" ou "velocidades de
 * corte": tudo — campos, facetas, quem pode submeter, se passa por moderação,
 * o que é buscável — sai de `definition.collections[nome]`. É por isso que uma
 * ferramenta de catálogo nova custa um JSON e não um deploy.
 */

interface KeyCollectionParams {
	key: string;
	collection: string;
}
interface KeyCollectionIdParams extends KeyCollectionParams {
	id: string;
}

/** Teto do import em lote — protege memória e tempo de request. */
const MAX_IMPORT_ROWS = 5000;

interface Viewer {
	customerId: string;
	isStaff: boolean;
}

/**
 * Identidade de quem chama. Para STAFF o `authenticateCustomer` retorna cedo e
 * NÃO popula `currentCustomer` — daí o fallback em `currentUser.id`. Sem ele,
 * todo endpoint quebraria justamente para quem modera.
 */
function viewerOf(request: FastifyRequest): Viewer | null {
	const isStaff = isStaffRole(request.currentRole);
	const id = request.currentCustomer?.id ?? request.currentUser?.id;
	if (!id) return null;
	return { customerId: id, isStaff };
}

/**
 * Quem pode VER um registro: staff, o dono, ou qualquer um se o registro está
 * aprovado, ativo e público.
 *
 * Regra única para todo endpoint que devolve o conteúdo de um registro. Existe
 * porque `visibility:'owner'` guarda perfil de custo (preço de compra, salário,
 * margem) — deixar um endpoint responder `data` sem passar por aqui vaza o
 * negócio de um aluno para outro.
 */
function podeVer(entry: CollectionEntry, viewer: Viewer): boolean {
	return (
		viewer.isStaff ||
		entry.owner_id === viewer.customerId ||
		(entry.status === 'approved' &&
			entry.active &&
			entry.visibility === 'public')
	);
}

/** Carrega a definition publicada e resolve a coleção pedida. */
async function loadConfig(
	request: FastifyRequest,
	viewer: Viewer,
): Promise<{ config: CollectionConfig; key: string; collection: string }> {
	const { key, collection } = request.params as KeyCollectionParams;
	// Staff pode operar coleção de tool ainda em RASCUNHO — é o que permite
	// montar e testar uma ferramenta de catálogo inteira antes de publicar
	// (publicar aqui é ato de produção: o banco de definitions é compartilhado).
	const row = await loadPublishedToolDefinition(
		key,
		viewer.customerId,
		request.headers.authorization,
		viewer.isStaff,
	);
	return {
		config: resolveCollection(row.definition, collection),
		key,
		collection,
	};
}

/** Traduz erro de domínio em resposta HTTP. Centraliza para não repetir. */
function fail(reply: FastifyReply, err: unknown) {
	if (err instanceof ToolEngineError) {
		return reply.status(err.status).send({ message: err.message });
	}
	if (err instanceof ToolDefinitionLoadError) {
		return reply.status(err.status).send({ message: err.message });
	}
	const message = err instanceof Error ? err.message : 'Unknown error';
	return reply.status(500).send({ message });
}

/**
 * Lê os filtros de faceta da querystring.
 *
 * Formato: `f.material=aco` (exato) e `f.espessura_mm=3..10` (faixa, com
 * qualquer ponta opcional: `3..`, `..10`). Só aceita campo DECLARADO como
 * faceta — assim ninguém filtra por chave arbitrária do jsonb nem descobre
 * campo interno por tentativa.
 */
/** Exportada para teste: é ela que decide o TIPO do valor do filtro. */
export function parseFilters(
	query: Record<string, unknown>,
	config: CollectionConfig,
): Record<string, FacetFilter> {
	const allowed = new Map(
		config.fields.filter((f) => f.facet).map((f) => [f.name, f.facet]),
	);
	const out: Record<string, FacetFilter> = {};

	for (const [rawKey, rawValue] of Object.entries(query)) {
		if (!rawKey.startsWith('f.')) continue;
		const field = rawKey.slice(2);
		const facet = allowed.get(field);
		if (!facet) continue;

		const value = String(rawValue ?? '');
		if (!value) continue;

		if (facet === 'range') {
			const [minRaw, maxRaw] = value.split('..');
			const min = Number(minRaw);
			const max = Number(maxRaw);
			const filter: FacetFilter = { kind: 'range' };
			if (Number.isFinite(min)) filter.min = min;
			if (Number.isFinite(max)) filter.max = max;
			if (filter.min !== undefined || filter.max !== undefined) {
				out[field] = filter;
			}
			continue;
		}

		const spec = config.fields.find((f) => f.name === field);

		/**
		 * Faceta BOOLEANA precisa virar boolean de verdade. O filtro roda como
		 * contenção jsonb (`data @> {...}`), e em jsonb `"true"` (texto) e `true`
		 * (booleano) são valores DIFERENTES: com a string, o filtro "só favoritos"
		 * não devolvia nada — sem erro nenhum, só uma lista vazia.
		 */
		if (spec?.type === 'bool') {
			out[field] = { kind: 'eq', value: value === 'true' || value === '1' };
			continue;
		}

		// Preserva número quando a opção declarada é numérica.
		const match = spec?.options?.find((o) => String(o) === value);
		out[field] = { kind: 'eq', value: match ?? value };
	}
	return out;
}

/** Projeção pública de um registro (nunca devolve coluna interna crua). */
function present(entry: CollectionEntry, viewer: Viewer) {
	return {
		id: entry.id,
		title: entry.title,
		description: entry.description,
		category: entry.category,
		data: entry.data,
		score: entry.score,
		stats: entry.stats,
		image: entry.example_after_url ?? entry.example_before_url,
		created_at: entry.created_at,
		updated_at: entry.updated_at,
		status: entry.status,
		is_mine: !!entry.owner_id && entry.owner_id === viewer.customerId,
		// A nota da moderação é para quem submeteu e para a equipe — não é
		// informação pública sobre o registro de outra pessoa.
		...(viewer.isStaff || entry.owner_id === viewer.customerId
			? { review_note: entry.review_note }
			: {}),
	};
}

/* ─────────────────────────── leitura ─────────────────────────── */

export const listCollectionController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { config, key, collection } = await loadConfig(request, viewer);
		const query = (request.query ?? {}) as Record<string, unknown>;

		const result = await repo.list(key, collection, config, {
			viewer,
			filters: parseFilters(query, config),
			q: typeof query.q === 'string' ? query.q : undefined,
			sort: typeof query.sort === 'string' ? query.sort : undefined,
			page: Number(query.page) || 1,
			pageSize: Number(query.page_size) || undefined,
			mineOnly: query.mine === 'true' || query.mine === '1',
		});

		// O que ESTE cliente já marcou, para a UI desenhar o estado dos botões
		// sem uma segunda requisição por card.
		const mine = await repo.myFeedback(
			result.items.map((e) => e.id),
			viewer.customerId,
		);

		return reply.send({
			items: result.items.map((e) => ({
				...present(e, viewer),
				my_feedback: mine[e.id] ?? {},
			})),
			total: result.total,
			page: result.page,
			page_size: result.pageSize,
			pages: result.pages,
		});
	} catch (err) {
		return fail(reply, err);
	}
};

/**
 * Facetas para a tela montar os filtros: as opções declaradas com a CONTAGEM
 * atual, mais os limites reais de cada faixa numérica.
 */
export const collectionFacetsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { config, key, collection } = await loadConfig(request, viewer);
		const query = (request.query ?? {}) as Record<string, unknown>;
		const filters = parseFilters(query, config);

		const counts = await repo.facetCounts(key, collection, config, {
			viewer,
			filters,
		});

		const specs = collectionFacets(config).map((f) => {
			if (f.kind !== 'enum') return f;

			const seen = counts[f.name] ?? {};
			// Campo com opções DECLARADAS (enum): mostra todas, inclusive as com 0.
			// "Titânio (0)" comunica "a base não tem"; sumir comunicaria "o filtro
			// quebrou".
			if (f.options?.length) {
				return {
					...f,
					values: f.options.map((o) => ({
						value: o,
						count: seen[String(o)] ?? 0,
					})),
				};
			}

			// Campo de TEXTO LIVRE usado como faceta (ex.: máquina): as opções só
			// podem vir dos dados. Sem isto o grupo renderizaria vazio — e máquina
			// é o filtro mais importante do Metallic. Ordena por frequência e
			// limita, para uma base com centenas de máquinas não virar uma parede
			// de chips.
			const values = Object.entries(seen)
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.slice(0, 30)
				.map(([value, count]) => ({ value, count }));
			return { ...f, values };
		});

		return reply.send({
			facets: specs,
			ranges: rangeFields(config).map((f) => ({
				name: f.name,
				label: f.label ?? f.name,
				min: f.min,
				max: f.max,
				unit: f.unit,
			})),
			sort: config.sort ?? [],
		});
	} catch (err) {
		return fail(reply, err);
	}
};

/** "Receita mais próxima" — só considera registro aprovado (ver repositório). */
export const collectionNearestController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { config, key, collection } = await loadConfig(request, viewer);
		if (!config.nearest?.on?.length) {
			return reply
				.status(400)
				.send({ message: 'esta coleção não declara `nearest`' });
		}

		const query = (request.query ?? {}) as Record<string, unknown>;
		const target: Record<string, number> = {};
		for (const axis of config.nearest.on) {
			const name = axis.startsWith('data.') ? axis.slice('data.'.length) : axis;
			const v = Number(query[name]);
			if (Number.isFinite(v)) target[name] = v;
		}
		if (!Object.keys(target).length) {
			return reply.status(400).send({
				message: `informe ao menos um eixo: ${config.nearest.on.join(', ')}`,
			});
		}

		const group: Record<string, string | number> = {};
		for (const g of config.nearest.groupBy ?? []) {
			const name = g.startsWith('data.') ? g.slice('data.'.length) : g;
			const v = query[name];
			if (v !== undefined && v !== '') group[name] = String(v);
		}

		const limit = Math.min(Number(query.limit) || 5, 25);
		const hits = await repo.nearest(key, collection, config, target, group);

		return reply.send({
			items: hits.slice(0, limit).map((h) => ({
				...present(h.entry, viewer),
				distance: Number(h.distance.toFixed(4)),
				// A tela PRECISA dizer que isto é aproximação, não receita exata.
				exact: h.distance === 0,
			})),
			target,
			group,
		});
	} catch (err) {
		return fail(reply, err);
	}
};

export const getCollectionEntryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { key, collection } = await loadConfig(request, viewer);
		const { id } = request.params as KeyCollectionIdParams;
		const entry = await repo.findById(id, key, collection);
		if (!entry)
			return reply.status(404).send({ message: 'registro não encontrado' });

		const visible =
			viewer.isStaff ||
			entry.owner_id === viewer.customerId ||
			(entry.status === 'approved' &&
				entry.active &&
				entry.visibility === 'public');
		if (!visible) {
			// 404 e não 403: confirmar a existência de um registro que a pessoa não
			// pode ver já é vazamento.
			return reply.status(404).send({ message: 'registro não encontrado' });
		}

		const mine = await repo.myFeedback([entry.id], viewer.customerId);
		return reply.send({
			...present(entry, viewer),
			my_feedback: mine[entry.id] ?? {},
		});
	} catch (err) {
		return fail(reply, err);
	}
};

/* ─────────────────────────── escrita ─────────────────────────── */

/** Quem pode criar, e com que status a submissão nasce. */
function creationPolicy(
	config: CollectionConfig,
	viewer: Viewer,
): { allowed: boolean; status: CollectionEntry['status'] } {
	const who = config.submissions?.who ?? 'admin';
	if (viewer.isStaff) return { allowed: true, status: 'approved' };
	if (who !== 'student') return { allowed: false, status: 'draft' };
	const moderation = config.submissions?.moderation ?? 'pending';
	return {
		allowed: true,
		status: moderation === 'none' ? 'approved' : 'pending',
	};
}

export const createCollectionEntryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { config, key, collection } = await loadConfig(request, viewer);
		const policy = creationPolicy(config, viewer);
		if (!policy.allowed) {
			return reply
				.status(403)
				.send({ message: 'esta coleção não aceita submissão de aluno' });
		}

		const body = (request.body ?? {}) as Record<string, unknown>;
		const data = validateCollectionData(
			config.fields,
			(body.data ?? {}) as Record<string, unknown>,
		);
		const title = String(body.title ?? '').trim();
		if (!title)
			return reply.status(400).send({ message: 'título é obrigatório' });

		const entry = await repo.create({
			toolKey: key,
			collection,
			title: title.slice(0, 200),
			description: body.description ? String(body.description) : null,
			category: body.category ? String(body.category) : null,
			data,
			status: policy.status,
			ownerId: viewer.isStaff ? null : viewer.customerId,
			visibility:
				body.visibility === 'owner' && !viewer.isStaff ? 'owner' : 'public',
			createdBy: viewer.customerId,
		});

		return reply.status(201).send(present(entry, viewer));
	} catch (err) {
		return fail(reply, err);
	}
};

export const updateCollectionEntryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { config, key, collection } = await loadConfig(request, viewer);
		const { id } = request.params as KeyCollectionIdParams;
		const entry = await repo.findById(id, key, collection);
		if (!entry)
			return reply.status(404).send({ message: 'registro não encontrado' });

		const isOwner = !!entry.owner_id && entry.owner_id === viewer.customerId;
		const canEdit =
			viewer.isStaff || (isOwner && config.submissions?.ownerEditable);
		if (!canEdit) return reply.status(403).send({ message: 'sem permissão' });

		const body = (request.body ?? {}) as Record<string, unknown>;
		const patch: Parameters<typeof repo.update>[3] = {};

		if (body.title !== undefined)
			patch.title = String(body.title).slice(0, 200);
		if (body.description !== undefined) {
			patch.description = body.description ? String(body.description) : null;
		}
		if (body.category !== undefined) {
			patch.category = body.category ? String(body.category) : null;
		}
		if (body.data !== undefined) {
			// Valida o registro INTEIRO (merge do que já existe com o patch), não só
			// os campos enviados: `showIf` depende dos outros valores, então validar
			// o fragmento isolado deixaria passar combinação inválida.
			patch.data = validateCollectionData(config.fields, {
				...entry.data,
				...(body.data as Record<string, unknown>),
			});
		}
		if (viewer.isStaff) {
			if (body.active !== undefined) patch.active = !!body.active;
			if (body.position !== undefined) patch.position = Number(body.position);
		} else if (
			entry.status === 'approved' &&
			patch.data &&
			(config.submissions?.moderation ?? 'pending') !== 'none'
		) {
			// Aluno editar receita já aprovada devolve ela para a fila: o que a
			// equipe validou não pode mudar pelas costas.
			//
			// Coleção SEM moderação está fora disso: não existe fila para onde
			// voltar. Sem esta ressalva, favoritar uma imagem da galeria pessoal
			// (que é um patch em `data`) marcaria o registro como "pendente de
			// revisão" de uma revisão que nunca vai acontecer.
			patch.status = 'pending';
		}

		const updated = await repo.update(id, key, collection, patch);
		return reply.send(present(updated, viewer));
	} catch (err) {
		return fail(reply, err);
	}
};

export const deleteCollectionEntryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { key, collection } = await loadConfig(request, viewer);
		const { id } = request.params as KeyCollectionIdParams;
		const entry = await repo.findById(id, key, collection);
		if (!entry)
			return reply.status(404).send({ message: 'registro não encontrado' });

		const isOwner = !!entry.owner_id && entry.owner_id === viewer.customerId;
		if (!viewer.isStaff && !isOwner) {
			return reply.status(403).send({ message: 'sem permissão' });
		}

		await repo.remove(id, key, collection);
		return reply.status(204).send();
	} catch (err) {
		return fail(reply, err);
	}
};

/** Moderação (staff): aprova ou rejeita, com nota. */
export const reviewCollectionEntryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });
		if (!viewer.isStaff)
			return reply.status(403).send({ message: 'sem permissão' });

		const { key, collection } = await loadConfig(request, viewer);
		const { id } = request.params as KeyCollectionIdParams;
		const body = (request.body ?? {}) as Record<string, unknown>;
		const status = String(body.status ?? '');
		if (status !== 'approved' && status !== 'rejected') {
			return reply
				.status(400)
				.send({ message: "status deve ser 'approved' ou 'rejected'" });
		}

		const updated = await repo.update(id, key, collection, {
			status,
			review_note: body.review_note ? String(body.review_note) : null,
			reviewed_by: viewer.customerId,
			reviewed_at: new Date().toISOString(),
		});
		return reply.send(present(updated, viewer));
	} catch (err) {
		return fail(reply, err);
	}
};

/* ─────────────────────────── feedback ─────────────────────────── */

export const collectionFeedbackController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });

		const { config, key, collection } = await loadConfig(request, viewer);
		const { id } = request.params as KeyCollectionIdParams;
		const body = (request.body ?? {}) as Record<string, unknown>;
		const kind = String(body.kind ?? '');

		const enabled =
			(kind === 'like' && config.feedback?.like) ||
			(kind === 'save' && config.feedback?.save) ||
			(kind === 'rating' && config.feedback?.rating) ||
			(kind === 'result' && !!config.feedback?.result);
		if (!enabled) {
			return reply
				.status(400)
				.send({ message: `esta coleção não aceita feedback '${kind}'` });
		}

		const entry = await repo.findById(id, key, collection);
		if (!entry)
			return reply.status(404).send({ message: 'registro não encontrado' });

		// Remover o próprio like/save é o mesmo endpoint com `remove: true` — a UI
		// é um botão que alterna.
		if (body.remove) {
			await repo.removeFeedback(id, viewer.customerId, kind);
		} else {
			if (kind === 'result') {
				const outcomes = config.feedback?.result?.outcomes ?? [
					'sucesso',
					'parcial',
					'falha',
				];
				const outcome = String(body.outcome ?? '');
				if (!outcomes.includes(outcome)) {
					return reply.status(400).send({
						message: `outcome deve ser um de: ${outcomes.join(', ')}`,
					});
				}
				await repo.upsertFeedback({
					entryId: id,
					customerId: viewer.customerId,
					kind: 'result',
					outcome,
					payload: (body.payload ?? {}) as Record<string, unknown>,
					note: body.note ? String(body.note) : null,
				});
			} else if (kind === 'rating') {
				const value = Number(body.value);
				if (!Number.isFinite(value) || value < 1 || value > 5) {
					return reply
						.status(400)
						.send({ message: 'rating deve ser de 1 a 5' });
				}
				await repo.upsertFeedback({
					entryId: id,
					customerId: viewer.customerId,
					kind: 'rating',
					value,
				});
			} else {
				await repo.upsertFeedback({
					entryId: id,
					customerId: viewer.customerId,
					kind: kind as 'like' | 'save',
				});
			}
		}

		// Devolve o registro já com `score`/`stats` recalculados pelo trigger, para
		// a UI não precisar de um GET extra.
		const fresh = await repo.findById(id, key, collection);
		const mine = await repo.myFeedback([id], viewer.customerId);
		return reply.send({
			...present(fresh as CollectionEntry, viewer),
			my_feedback: mine[id] ?? {},
		});
	} catch (err) {
		return fail(reply, err);
	}
};

/* ─────────────────────────── import / export ─────────────────────────── */

/**
 * Import em lote (staff). Aceita CSV com cabeçalho ou um array JSON.
 *
 * Valida LINHA A LINHA e reporta cada erro com o número da linha — semear uma
 * base de milhares de receitas com um "erro de validação" genérico seria
 * inutilizável. Nada é inserido se houver erro, para o import ser atômico do
 * ponto de vista de quem opera.
 */
export const importCollectionController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });
		if (!viewer.isStaff)
			return reply.status(403).send({ message: 'sem permissão' });

		const { config, key, collection } = await loadConfig(request, viewer);
		const body = (request.body ?? {}) as Record<string, unknown>;

		let records: Record<string, string>[];
		if (typeof body.csv === 'string') {
			const rows = parseCsv(body.csv);
			if (rows.length < 2) {
				return reply
					.status(400)
					.send({ message: 'CSV precisa de cabeçalho e ao menos uma linha' });
			}
			const header = rows[0].map((h) => h.trim());
			records = rows.slice(1).map((r) => {
				const obj: Record<string, string> = {};
				header.forEach((h, i) => {
					obj[h] = (r[i] ?? '').trim();
				});
				return obj;
			});
		} else if (Array.isArray(body.rows)) {
			records = body.rows as Record<string, string>[];
		} else {
			return reply
				.status(400)
				.send({ message: 'envie `csv` (texto) ou `rows` (array)' });
		}

		if (records.length > MAX_IMPORT_ROWS) {
			return reply.status(413).send({
				message: `import limitado a ${MAX_IMPORT_ROWS} linhas por vez (recebido: ${records.length})`,
			});
		}

		const errors: { line: number; message: string }[] = [];
		const prepared: Parameters<typeof repo.createMany>[0] = [];

		records.forEach((rec, i) => {
			try {
				const title = String(rec.title ?? '').trim();
				if (!title) throw new ToolEngineError(400, 'título é obrigatório');
				const { title: _t, description: _d, category: _c, ...rest } = rec;
				prepared.push({
					toolKey: key,
					collection,
					title: title.slice(0, 200),
					description: rec.description || null,
					category: rec.category || null,
					data: validateCollectionData(config.fields, rest),
					status: 'approved',
					ownerId: null,
					createdBy: viewer.customerId,
				});
			} catch (e) {
				// +2: linha 1 é o cabeçalho e o índice começa em 0.
				errors.push({
					line: i + 2,
					message: e instanceof Error ? e.message : 'erro',
				});
			}
		});

		if (errors.length) {
			return reply.status(400).send({
				message: `${errors.length} linha(s) com erro — nada foi importado`,
				errors: errors.slice(0, 50),
			});
		}

		const inserted = await repo.createMany(prepared);
		return reply.status(201).send({ imported: inserted });
	} catch (err) {
		return fail(reply, err);
	}
};

export const exportCollectionController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const viewer = viewerOf(request);
		if (!viewer)
			return reply.status(403).send({ message: 'Customer not found' });
		if (!viewer.isStaff)
			return reply.status(403).send({ message: 'sem permissão' });

		const { config, key, collection } = await loadConfig(request, viewer);
		const rows = await repo.listForRag(key, collection, 5000);

		const cols = [
			'title',
			'description',
			'category',
			...config.fields.map((f) => f.name),
		];
		const lines = [cols.join(',')];
		for (const r of rows) {
			lines.push(
				cols
					.map((c) =>
						c === 'title' || c === 'description' || c === 'category'
							? csvCell((r as unknown as Record<string, unknown>)[c])
							: csvCell(r.data[c]),
					)
					.join(','),
			);
		}

		return reply
			.header('Content-Type', 'text/csv; charset=utf-8')
			.header(
				'Content-Disposition',
				`attachment; filename="${key}-${collection}.csv"`,
			)
			.send(lines.join('\n'));
	} catch (err) {
		return fail(reply, err);
	}
};
