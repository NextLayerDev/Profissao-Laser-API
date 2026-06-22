import type { RoomConfig, ToolDefinitionDoc } from './tool-definitions.js';
import { validateDefinition } from './tool-validate.js';

/**
 * Tools do Agente "Tool Engineer" (Claude tool-use) + os REDUCERS que mutam uma
 * cópia da ToolDefinition. Tudo é CATÁLOGO-DRIVEN: o front manda o catálogo de
 * blocos (specs + nós custom) a cada turno; o agente só usa block ids do catálogo
 * e a validação de tipo/ordem usa esse catálogo. Os reducers são puros (recebem
 * doc + catálogo, devolvem {doc, result, error?}); nenhum bloco é hardcoded aqui.
 */

/* ── catálogo enviado pelo front ── */

export type PortType = 'buffer' | 'string' | 'number' | 'bool' | 'enum';

export interface CatalogParam {
	name: string;
	kind: 'ref' | 'literal';
	refType?: 'buffer' | 'string';
	valueType?: 'enum' | 'number' | 'int' | 'bool' | 'string';
	label?: string;
	options?: (string | number)[];
	default?: unknown;
	required?: boolean;
}
export interface CatalogOutput {
	name: string;
	type: PortType;
	label?: string;
}
export interface CatalogBlock {
	id: string;
	label: string;
	sub?: string;
	icon?: string;
	accent?: string;
	params: CatalogParam[];
	outputs: CatalogOutput[];
}
export interface AgentCatalog {
	blocks: CatalogBlock[];
	/** nós custom já sintetizados (id `custom:<x>`), via `customToSpec` no front. */
	custom_nodes?: CatalogBlock[];
	/** campos de entrada atuais (resumo, pra contexto). */
	inputs?: { name: string; type: string; label?: string }[];
	/** planos reais (key + nome) — p/ o agente usar keys VÁLIDAS em set_access_policy. */
	plans?: { key: string; name: string }[];
}

/* ── helpers de tipo (espelham builder-model do front) ── */

function allBlocks(cat: AgentCatalog): CatalogBlock[] {
	return [...cat.blocks, ...(cat.custom_nodes ?? [])];
}
function findBlock(cat: AgentCatalog, id: string): CatalogBlock | undefined {
	return allBlocks(cat).find((b) => b.id === id);
}
function findParam(b: CatalogBlock, name: string): CatalogParam | undefined {
	return b.params.find((p) => p.name === name);
}
/** Tipo que um param espera (ref → refType; literal → valueType; int→number). */
function wantType(p: CatalogParam): PortType {
	if (p.kind === 'ref') return p.refType ?? 'buffer';
	if (p.valueType === 'int') return 'number';
	return (p.valueType as PortType) ?? 'string';
}
function fieldProduces(type: string): PortType {
	if (type === 'image') return 'buffer';
	if (type === 'number' || type === 'int') return 'number';
	if (type === 'bool') return 'bool';
	if (type === 'enum') return 'enum';
	return 'string';
}
/** Aceita-se uma fonte se o tipo "cabe": igual, enum↔string, número/bool→string. */
function typeFits(src: PortType, want: PortType): boolean {
	if (src === want) return true;
	if (
		(want === 'string' || want === 'enum') &&
		(src === 'string' || src === 'enum')
	)
		return true;
	if (want === 'string' && (src === 'number' || src === 'bool')) return true;
	return false;
}

/** Tipo de porta de uma fonte (`input.x` | `nó.campo`) contra o catálogo + inputs do doc. */
function sourceType(
	doc: ToolDefinitionDoc,
	cat: AgentCatalog,
	source: string,
): PortType | undefined {
	const dot = source.indexOf('.');
	if (dot <= 0) return undefined;
	const head = source.slice(0, dot);
	const field = source.slice(dot + 1);
	if (head === 'input') {
		const spec = doc.input?.[field];
		return spec ? fieldProduces(spec.type) : undefined;
	}
	const node = (doc.pipeline ?? []).find((n) => n.id === head);
	if (!node) return undefined;
	const block = findBlock(cat, node.block);
	return block?.outputs.find((o) => o.name === field)?.type;
}

/* ── resultado dos reducers ── */

export interface ReducerResult {
	doc?: ToolDefinitionDoc; // novo doc se mutou
	result: string; // texto pro tool_result (PT-BR)
	error?: boolean; // is_error no tool_result
}

const ok = (doc: ToolDefinitionDoc, result: string): ReducerResult => ({
	doc,
	result,
});
const fail = (result: string): ReducerResult => ({ result, error: true });

function clone(doc: ToolDefinitionDoc): ToolDefinitionDoc {
	return structuredClone(doc);
}

const NODE_ID_RE = /^[a-zA-Z_]\w*$/;
const MAX_NODES = 32;

/** Limpa refs órfãs (que apontam pra um head removido) nos params e no output. */
function clearRefsTo(doc: ToolDefinitionDoc, head: string): void {
	const orphan = (v: unknown) =>
		typeof v === 'string' &&
		(v.startsWith('!') ? v.slice(1) : v).split('.')[0] === head;
	for (const n of doc.pipeline ?? []) {
		for (const [k, v] of Object.entries(n.params ?? {})) {
			if (orphan(v)) delete (n.params as Record<string, unknown>)[k];
		}
	}
	const out = (doc.output ?? {}) as Record<string, unknown>;
	for (const [k, v] of Object.entries(out)) {
		if (Array.isArray(v)) out[k] = v.filter((x) => !orphan(x));
		else if (orphan(v)) delete out[k];
	}
}

/* ── reducers (1 por tool) ── */

type Input = Record<string, unknown>;

function setIdentity(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const d = clone(doc);
	d.ui = (d.ui ?? {}) as Record<string, unknown>;
	if (typeof i.title === 'string') d.ui.title = i.title;
	if (typeof i.description === 'string') d.ui.description = i.description;
	if (typeof i.icon === 'string') d.ui.icon = i.icon;
	if (typeof i.action_label === 'string') {
		const action = (d.ui.action ?? {}) as Record<string, unknown>;
		action.label = i.action_label;
		action.showCostNotice = true;
		d.ui.action = action;
	}
	return ok(d, 'Identidade atualizada.');
}

function addInput(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const name = String(i.name ?? '');
	if (!NODE_ID_RE.test(name)) return fail(`Nome de campo inválido: '${name}'.`);
	const type = String(i.type ?? 'string');
	if (!['image', 'enum', 'number', 'int', 'bool', 'string'].includes(type))
		return fail(`Tipo de campo inválido: '${type}'.`);
	const d = clone(doc);
	d.input = (d.input ?? {}) as Record<string, never>;
	(d.input as Record<string, unknown>)[name] = {
		type,
		...(i.required ? { required: true } : {}),
		...(i.default !== undefined ? { default: i.default } : {}),
		...(Array.isArray(i.options) ? { options: i.options } : {}),
		...(typeof i.min === 'number' ? { min: i.min } : {}),
		...(typeof i.max === 'number' ? { max: i.max } : {}),
	};
	// control visível
	d.ui = (d.ui ?? {}) as Record<string, unknown>;
	const controls = (
		Array.isArray(d.ui.controls) ? d.ui.controls : []
	) as Record<string, unknown>[];
	if (!controls.some((c) => c.bind === `input.${name}`)) {
		const widget =
			type === 'image'
				? 'file-drop'
				: type === 'bool'
					? 'toggle'
					: Array.isArray(i.options)
						? 'select'
						: type === 'number' || type === 'int'
							? 'number'
							: 'text';
		controls.push({
			bind: `input.${name}`,
			widget,
			label: typeof i.label === 'string' ? i.label : name,
			...(Array.isArray(i.options) ? { options: i.options } : {}),
		});
	}
	d.ui.controls = controls;
	return ok(d, `Campo '${name}' (${type}) adicionado.`);
}

function removeInput(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const name = String(i.name ?? '');
	if (!doc.input?.[name]) return fail(`Campo '${name}' não existe.`);
	const d = clone(doc);
	delete (d.input as Record<string, unknown>)[name];
	if (Array.isArray((d.ui as Record<string, unknown>)?.controls)) {
		(d.ui as Record<string, unknown>).controls = (
			(d.ui as Record<string, unknown>).controls as Record<string, unknown>[]
		).filter((c) => c.bind !== `input.${name}`);
	}
	// Limpa SÓ as refs a input.<name> (a cabeça 'input' NÃO some — outras refs
	// input.* continuam válidas). NÃO usar clearRefsTo('input'): apagaria todas.
	const isThisField = (v: unknown) =>
		typeof v === 'string' && v.replace(/^!/, '') === `input.${name}`;
	for (const n of d.pipeline ?? []) {
		for (const [k, v] of Object.entries(n.params ?? {})) {
			if (isThisField(v)) delete (n.params as Record<string, unknown>)[k];
		}
	}
	// e as saídas que apontavam pro campo removido (escalar ou lista).
	const out = (d.output ?? {}) as Record<string, unknown>;
	for (const [k, v] of Object.entries(out)) {
		if (Array.isArray(v)) out[k] = v.filter((x) => !isThisField(x));
		else if (isThisField(v)) delete out[k];
	}
	return ok(d, `Campo '${name}' removido.`);
}

function uniqueNodeId(doc: ToolDefinitionDoc, base: string): string {
	const taken = new Set((doc.pipeline ?? []).map((n) => n.id));
	let id = base;
	let n = 1;
	while (taken.has(id)) {
		n += 1;
		id = `${base}${n}`;
	}
	return id;
}

function addBlock(
	doc: ToolDefinitionDoc,
	cat: AgentCatalog,
	i: Input,
): ReducerResult {
	const blockId = String(i.block_id ?? '');
	const spec = findBlock(cat, blockId);
	if (!spec) return fail(`Bloco desconhecido: '${blockId}'.`);
	if ((doc.pipeline ?? []).length >= MAX_NODES)
		return fail(`Limite de ${MAX_NODES} blocos atingido.`);
	let baseId = blockId.startsWith('custom:')
		? blockId.slice(7).replace(/[^a-z0-9]+/gi, '_')
		: (blockId.split('.').pop() ?? 'node');
	// 'input' é a cabeça reservada das refs (input.<campo>); um nó com esse id
	// colidiria com os campos do formulário. Renomeia pra evitar ambiguidade.
	if (baseId === 'input') baseId = 'entrada';
	const reqId =
		typeof i.node_id === 'string' &&
		NODE_ID_RE.test(i.node_id) &&
		i.node_id !== 'input'
			? i.node_id
			: baseId;
	const id = uniqueNodeId(doc, reqId);
	const params: Record<string, unknown> = {};
	for (const p of spec.params) {
		if (p.kind === 'literal' && p.default !== undefined)
			params[p.name] = p.default;
	}
	const d = clone(doc);
	d.pipeline = [...(d.pipeline ?? []), { id, block: blockId, params }];
	return ok(d, `Bloco '${spec.label}' adicionado como nó '${id}'.`);
}

function removeBlock(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const id = String(i.node_id ?? '');
	if (!(doc.pipeline ?? []).some((n) => n.id === id))
		return fail(`Nó '${id}' não existe.`);
	const d = clone(doc);
	d.pipeline = (d.pipeline ?? []).filter((n) => n.id !== id);
	clearRefsTo(d, id);
	return ok(d, `Nó '${id}' removido.`);
}

function setParam(
	doc: ToolDefinitionDoc,
	cat: AgentCatalog,
	i: Input,
): ReducerResult {
	const nodeId = String(i.node_id ?? '');
	const param = String(i.param ?? '');
	const node = (doc.pipeline ?? []).find((n) => n.id === nodeId);
	if (!node) return fail(`Nó '${nodeId}' não existe.`);
	const spec = findBlock(cat, node.block);
	const p = spec && findParam(spec, param);
	if (!p) return fail(`Parâmetro '${param}' não existe no bloco.`);
	const d = clone(doc);
	const n = (d.pipeline ?? []).find((x) => x.id === nodeId);
	if (n) {
		n.params = { ...(n.params ?? {}), [param]: i.value };
	}
	return ok(d, `Valor de '${param}' (nó '${nodeId}') definido.`);
}

function connect(
	doc: ToolDefinitionDoc,
	cat: AgentCatalog,
	i: Input,
): ReducerResult {
	const nodeId = String(i.node_id ?? '');
	const param = String(i.param ?? '');
	const source = String(i.source ?? '');
	const node = (doc.pipeline ?? []).find((n) => n.id === nodeId);
	if (!node) return fail(`Nó '${nodeId}' não existe.`);
	const spec = findBlock(cat, node.block);
	const p = spec && findParam(spec, param);
	if (!p) return fail(`Parâmetro '${param}' não existe no bloco.`);
	// tipo
	const srcType = sourceType(doc, cat, source);
	if (!srcType) return fail(`Fonte '${source}' não existe.`);
	if (!typeFits(srcType, wantType(p)))
		return fail(
			`Tipos incompatíveis: '${source}' (${srcType}) não cabe em '${param}' (${wantType(p)}).`,
		);
	// ordem: se a fonte for um nó, tem que vir ANTES
	const dot = source.indexOf('.');
	const head = source.slice(0, dot);
	if (head !== 'input') {
		const srcIdx = (doc.pipeline ?? []).findIndex((n) => n.id === head);
		const tgtIdx = (doc.pipeline ?? []).findIndex((n) => n.id === nodeId);
		if (srcIdx < 0 || srcIdx >= tgtIdx)
			return fail(`Ligue a saída de uma etapa ANTERIOR a '${nodeId}'.`);
	}
	const d = clone(doc);
	const n = (d.pipeline ?? []).find((x) => x.id === nodeId);
	if (n) n.params = { ...(n.params ?? {}), [param]: source };
	return ok(d, `Ligado '${source}' → '${param}' do nó '${nodeId}'.`);
}

function setOutput(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const d = clone(doc);
	d.output = (d.output ?? {}) as Record<string, unknown>;
	if (typeof i.primary === 'string') d.output.primary = i.primary;
	if (typeof i.preview === 'string') d.output.preview = i.preview;
	if (Array.isArray(i.meta)) d.output.meta = i.meta;
	d.output.savable = true;
	return ok(d, 'Resultado (saída) definido.');
}

function setBilling(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const cost = Number(i.vox_cost);
	if (!Number.isFinite(cost) || cost < 0) return fail('vox_cost inválido.');
	const d = clone(doc);
	d.billing = {
		vox_cost: cost,
		free_quota:
			(i.free_quota as Record<string, number | null> | undefined) ??
			d.billing?.free_quota ??
			{},
	};
	return ok(d, `Preço definido: ${cost} vox/uso.`);
}

/**
 * Transforma a ferramenta numa SALA (Mentoria/live): cria/atualiza `doc.room`
 * (capacidade, agendamento, recursos). O link é SEMPRE externo (Zoom/Meet),
 * colado depois ao criar cada sessão. Mutação pura; a validação fica no
 * validateRoomDefinition (chamado em `validate`).
 */
function setRoomConfig(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const d = clone(doc);
	const room: RoomConfig = { ...(d.room ?? {}) };
	if (typeof i.cap === 'number' || i.cap === null) {
		room.cap = i.cap as number | null;
	}
	if (i.schedule && typeof i.schedule === 'object') {
		const s = i.schedule as Record<string, unknown>;
		const schedule = { ...(room.schedule ?? {}) };
		if (typeof s.opensMinutesBefore === 'number') {
			schedule.opensMinutesBefore = s.opensMinutesBefore;
		}
		if (typeof s.defaultDurationMin === 'number') {
			schedule.defaultDurationMin = s.defaultDurationMin;
		}
		room.schedule = schedule;
	}
	if (i.features && typeof i.features === 'object') {
		const f = i.features as Record<string, unknown>;
		const features = { ...(room.features ?? {}) };
		if (typeof f.recording === 'boolean') features.recording = f.recording;
		if (typeof f.chat === 'boolean') features.chat = f.chat;
		if (typeof f.materials === 'boolean') features.materials = f.materials;
		room.features = features;
	}
	room.link = { mode: 'external' }; // sala = sempre link externo
	d.room = room;
	return ok(d, 'Sala configurada (capacidade, agendamento, recursos).');
}

/**
 * Define o acesso de uma SALA: planos com entrada grátis, custo em voxes p/ quem
 * não tem plano e se a entrada por voxes é permitida (false = só plano). Mutação
 * pura; cria `doc.room` se ainda não existir.
 */
function setAccessPolicy(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const hasPlans = Array.isArray(i.includedPlanKeys);
	const hasCost = typeof i.voxCost === 'number';
	const hasEntry = typeof i.allowVoxEntry === 'boolean';
	if (!hasPlans && !hasCost && !hasEntry) {
		return fail(
			'Informe ao menos um: includedPlanKeys, voxCost ou allowVoxEntry.',
		);
	}
	const d = clone(doc);
	const room: RoomConfig = { ...(d.room ?? {}) };
	const access = { ...(room.access ?? {}) };
	if (Array.isArray(i.includedPlanKeys)) {
		access.includedPlanKeys = (i.includedPlanKeys as unknown[]).filter(
			(x): x is string => typeof x === 'string',
		);
	}
	if (typeof i.voxCost === 'number') access.voxCost = i.voxCost;
	if (typeof i.allowVoxEntry === 'boolean') {
		access.allowVoxEntry = i.allowVoxEntry;
	}
	room.access = access;
	d.room = room;
	return ok(d, 'Política de acesso definida (planos / voxes).');
}

function createCustomNode(doc: ToolDefinitionDoc, i: Input): ReducerResult {
	const id = String(i.id ?? '').replace(/[^a-z0-9_]/gi, '_');
	const baseBlock = String(i.base_block ?? '');
	if (!id || !baseBlock) return fail('id e base_block são obrigatórios.');
	const d = clone(doc);
	d.ui = (d.ui ?? {}) as Record<string, unknown>;
	const cn = (d.ui.custom_nodes ?? { defs: [], instances: {} }) as {
		defs: unknown[];
		instances: Record<string, string>;
	};
	const defs = (Array.isArray(cn.defs) ? cn.defs : []) as Record<
		string,
		unknown
	>[];
	const def = {
		id,
		label: String(i.label ?? id),
		icon: String(i.icon ?? 'box'),
		accent: String(i.accent ?? 'slate'),
		baseBlock,
		defaults: (i.defaults as Record<string, unknown>) ?? {},
	};
	const idx = defs.findIndex((x) => x.id === id);
	if (idx >= 0) defs[idx] = def;
	else defs.push(def);
	d.ui.custom_nodes = { defs, instances: cn.instances ?? {} };
	return ok(
		d,
		`Nó personalizado '${def.label}' criado (custom:${id}). Use add_block com block_id "custom:${id}".`,
	);
}

/** Checagem catálogo-aware extra: refs de tipo certo (já no connect) + required não ligados. */
function catalogValidate(doc: ToolDefinitionDoc, cat: AgentCatalog): string[] {
	const errs: string[] = [];
	for (const node of doc.pipeline ?? []) {
		const spec = findBlock(cat, node.block);
		if (!spec) continue;
		for (const p of spec.params) {
			if (p.kind === 'ref' && p.required) {
				const v = node.params?.[p.name];
				if (typeof v !== 'string' || !v)
					errs.push(
						`Nó '${node.id}': entrada '${p.label ?? p.name}' não ligada.`,
					);
			}
		}
	}
	if (!doc.output || !(doc.output as Record<string, unknown>).primary)
		errs.push('Defina o "Resultado" (saída principal).');
	return errs;
}

/* ── dispatch ── */

export interface AgentToolOutcome extends ReducerResult {
	done?: boolean;
	needsInput?: boolean;
	actionLabel: string;
}

export function applyAgentTool(
	doc: ToolDefinitionDoc,
	cat: AgentCatalog,
	name: string,
	input: Input,
): AgentToolOutcome {
	switch (name) {
		case 'set_identity':
			return {
				...setIdentity(doc, input),
				actionLabel: 'Atualizou a identidade',
			};
		case 'add_input':
			return {
				...addInput(doc, input),
				actionLabel: `Adicionou o campo "${input.name}"`,
			};
		case 'remove_input':
			return {
				...removeInput(doc, input),
				actionLabel: `Removeu o campo "${input.name}"`,
			};
		case 'add_block':
			return {
				...addBlock(doc, cat, input),
				actionLabel: `Adicionou um bloco (${input.block_id})`,
			};
		case 'remove_block':
			return {
				...removeBlock(doc, input),
				actionLabel: `Removeu o nó "${input.node_id}"`,
			};
		case 'set_param':
			return {
				...setParam(doc, cat, input),
				actionLabel: `Ajustou "${input.param}"`,
			};
		case 'connect':
			return {
				...connect(doc, cat, input),
				actionLabel: `Ligou ${input.source} → ${input.param}`,
			};
		case 'set_output':
			return { ...setOutput(doc, input), actionLabel: 'Definiu o resultado' };
		case 'set_billing':
			return { ...setBilling(doc, input), actionLabel: 'Definiu o preço' };
		case 'set_room_config':
			return {
				...setRoomConfig(doc, input),
				actionLabel: 'Configurou a sala',
			};
		case 'set_access_policy':
			return {
				...setAccessPolicy(doc, input),
				actionLabel: 'Definiu o acesso',
			};
		case 'create_custom_node':
			return {
				...createCustomNode(doc, input),
				actionLabel: `Criou o nó "${input.label}"`,
			};
		case 'validate': {
			const structural = validateDefinition(doc);
			const cat2 = catalogValidate(doc, cat);
			const all = [...structural.errors.map((e) => e.message), ...cat2];
			return {
				result:
					all.length === 0
						? 'OK — a ferramenta está válida e pronta pra publicar.'
						: `Problemas:\n- ${all.join('\n- ')}`,
				actionLabel: 'Validou a ferramenta',
			};
		}
		case 'ask_user':
			return {
				result: 'Pergunta enviada ao usuário.',
				needsInput: true,
				actionLabel: 'Pediu mais detalhes',
			};
		case 'finish':
			return {
				result: 'Concluído.',
				done: true,
				actionLabel: 'Concluiu a montagem',
			};
		default:
			return {
				result: `Ferramenta desconhecida: ${name}.`,
				error: true,
				actionLabel: name,
			};
	}
}

/* ── definições das tools (schema p/ o Claude) ── */

const sourceDesc =
	'Fonte no formato "input.<campo>" ou "<id_do_nó>.<saída>". Use só campos/saídas que existem.';

export const AGENT_TOOLS = [
	{
		name: 'set_identity',
		description:
			'Define nome, descrição, ícone e texto do botão da ferramenta (o que o cliente vê).',
		input_schema: {
			type: 'object',
			properties: {
				title: { type: 'string' },
				description: { type: 'string' },
				icon: { type: 'string' },
				action_label: { type: 'string' },
			},
		},
	},
	{
		name: 'add_input',
		description:
			'Adiciona um campo do formulário que o cliente preenche (imagem, número, texto, sim/não, opções).',
		input_schema: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'identificador (letras/números/_)',
				},
				type: {
					type: 'string',
					enum: ['image', 'number', 'int', 'bool', 'enum', 'string'],
				},
				label: { type: 'string' },
				required: { type: 'boolean' },
				default: {},
				options: { type: 'array' },
				min: { type: 'number' },
				max: { type: 'number' },
			},
			required: ['name', 'type'],
		},
	},
	{
		name: 'remove_input',
		description: 'Remove um campo do formulário.',
		input_schema: {
			type: 'object',
			properties: { name: { type: 'string' } },
			required: ['name'],
		},
	},
	{
		name: 'add_block',
		description:
			'Adiciona um bloco/etapa ao fluxo. Use SÓ um block_id que exista no catálogo (inclui custom:<id>).',
		input_schema: {
			type: 'object',
			properties: {
				block_id: { type: 'string' },
				node_id: { type: 'string', description: 'opcional; gerado se omitido' },
			},
			required: ['block_id'],
		},
	},
	{
		name: 'remove_block',
		description: 'Remove um nó/etapa do fluxo.',
		input_schema: {
			type: 'object',
			properties: { node_id: { type: 'string' } },
			required: ['node_id'],
		},
	},
	{
		name: 'set_param',
		description: 'Define um VALOR FIXO de um parâmetro de um bloco.',
		input_schema: {
			type: 'object',
			properties: {
				node_id: { type: 'string' },
				param: { type: 'string' },
				value: {},
			},
			required: ['node_id', 'param', 'value'],
		},
	},
	{
		name: 'connect',
		description: `Liga uma fonte a um parâmetro (entrada) de um bloco. ${sourceDesc}`,
		input_schema: {
			type: 'object',
			properties: {
				node_id: { type: 'string' },
				param: { type: 'string' },
				source: { type: 'string', description: sourceDesc },
			},
			required: ['node_id', 'param', 'source'],
		},
	},
	{
		name: 'set_output',
		description: `Define o que o cliente recebe no fim. ${sourceDesc}`,
		input_schema: {
			type: 'object',
			properties: {
				primary: {
					type: 'string',
					description: `arquivo final. ${sourceDesc}`,
				},
				preview: {
					type: 'string',
					description: `prévia (opcional). ${sourceDesc}`,
				},
				meta: { type: 'array', items: { type: 'string' } },
			},
		},
	},
	{
		name: 'set_billing',
		description: 'Define o custo por uso (em voxes) e a cota grátis por plano.',
		input_schema: {
			type: 'object',
			properties: {
				vox_cost: { type: 'number' },
				free_quota: { type: 'object' },
			},
			required: ['vox_cost'],
		},
	},
	{
		name: 'set_room_config',
		description:
			'Torna a ferramenta uma SALA (Mentoria / live de vídeo) e define capacidade, agendamento e recursos. Use ISTO (e set_access_policy) em vez de blocos quando o usuário pedir mentoria, sala ao vivo, live ou aula ao vivo. O vídeo é sempre um link externo (Zoom/Meet) colado depois ao criar cada sessão.',
		input_schema: {
			type: 'object',
			properties: {
				cap: {
					type: ['integer', 'null'],
					description: 'Limite de participantes; null = sem limite.',
				},
				schedule: {
					type: 'object',
					properties: {
						opensMinutesBefore: {
							type: 'integer',
							description: 'Minutos antes do início em que a sala abre.',
						},
						defaultDurationMin: {
							type: 'integer',
							description: 'Duração padrão da sessão, em minutos.',
						},
					},
				},
				features: {
					type: 'object',
					properties: {
						recording: { type: 'boolean' },
						chat: { type: 'boolean' },
						materials: { type: 'boolean' },
					},
				},
			},
		},
	},
	{
		name: 'set_access_policy',
		description:
			'Define quem entra na SALA: includedPlanKeys (planos com entrada grátis), voxCost (custo em voxes p/ quem NÃO tem um plano incluído) e allowVoxEntry (false = só plano, sem comprar entrada). Use junto com set_room_config.',
		input_schema: {
			type: 'object',
			properties: {
				includedPlanKeys: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Keys dos planos com entrada grátis (ex.: ["pro","max"]).',
				},
				voxCost: { type: 'number' },
				allowVoxEntry: { type: 'boolean' },
			},
		},
	},
	{
		name: 'create_custom_node',
		description:
			'Cria um nó personalizado reutilizável (preset sobre um bloco base). Depois use add_block com "custom:<id>".',
		input_schema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				label: { type: 'string' },
				icon: { type: 'string' },
				accent: { type: 'string' },
				base_block: { type: 'string' },
				defaults: { type: 'object' },
			},
			required: ['id', 'label', 'base_block'],
		},
	},
	{
		name: 'validate',
		description:
			'Verifica se a ferramenta está válida (ids, ligações, tipos, resultado). Use SEMPRE antes de finish.',
		input_schema: { type: 'object', properties: {} },
	},
	{
		name: 'ask_user',
		description:
			'Faz UMA pergunta clara ao usuário e PARA o turno (quando faltar informação essencial).',
		input_schema: {
			type: 'object',
			properties: { question: { type: 'string' } },
			required: ['question'],
		},
	},
	{
		name: 'finish',
		description:
			'Termina o turno com um resumo curto do que montou. Só depois de validate sem erros.',
		input_schema: {
			type: 'object',
			properties: { summary: { type: 'string' } },
			required: ['summary'],
		},
	},
] as const;
