import { blockRegistry } from '../tool-blocks/index.js';
import type { BlockRunContext } from '../tool-blocks/types.js';
import type { InputSpec, ToolDefinitionDoc } from './tool-definitions.js';
import { ToolEngineError } from './tool-errors.js';

export { ToolEngineError } from './tool-errors.js';

/**
 * Motor genérico `blocks_v1` — pipeline LINEAR (sem ramificação; `flow.*` e
 * `agent_v1` vêm nos marcos seguintes). Roda uma ToolDefinition (dado):
 *   1. coage os inputs (multipart → valores tipados) numa "bag"
 *   2. pra cada nó: resolve refs nos params → valida (schema do bloco) → roda →
 *      grava saídas na bag como `${nodeId}.<chave>`
 *   3. projeta a saída final (`definition.output`) resolvendo refs contra a bag
 *
 * Referências num param: `input.X`, `<nodeId>.campo`, `!ref` (negação booleana).
 * Strings sem "." (ou cuja cabeça não seja `input`/um nodeId) são LITERAIS.
 */

/** Bag = mapa plano (proto-null) de valores resolvidos (`input.x`, `node.campo`). */
export type Bag = Record<string, unknown>;

const NODE_ID_RE = /^[a-zA-Z_]\w*$/;
const MAX_PIPELINE_NODES = 32;

/**
 * Coage os inputs do multipart (strings) em valores tipados conforme
 * `definition.input`. Cada input `type:'image'` resolve pelo SEU arquivo, mapeado
 * por fieldname (`files['<nome>']`), permitindo várias imagens de referência (ex.:
 * `referencia`, `referencia2`, `referencia3`). O bloco revalida a fundo; aqui é a
 * 1ª barreira (mensagens claras de 400).
 *
 * Compat com tools de 1 imagem: se existe EXATAMENTE 1 input de imagem e nenhum
 * arquivo casa pelo nome, o único arquivo enviado (qualquer fieldname) é atribuído
 * a esse input — cobre o caso de o front mandar o arquivo sob um fieldname genérico.
 *
 * `type:'file'` (DXF/SVG/…) é tratado como imagem no transporte — também vira
 * Buffer na bag — mas com DUAS diferenças deliberadas:
 *   1. NÃO participa do fallback de 1 imagem. Adivinhar qual input recebe um
 *      arquivo genérico é barato para foto e caro para CAD: um DXF caindo no
 *      input errado gera um orçamento silenciosamente errado.
 *   2. Publica `input.<nome>__filename` e `input.<nome>__mime` na bag, para o
 *      bloco distinguir DXF de SVG sem farejar bytes.
 */
export function coerceInputs(
	inputSpec: Record<string, InputSpec>,
	fields: Record<string, string>,
	files?: Record<string, Buffer> | null,
	fileMeta?: Record<string, { filename?: string; mime?: string }> | null,
): Bag {
	const bag: Bag = Object.create(null);
	// Tolera ausência: `coerceInputs` é exportado e chamado por tools sem arquivo
	// nenhum. `Object.entries(null)` lançaria um TypeError opaco no meio do run.
	const fileMap = files ?? {};
	const metaMap = fileMeta ?? {};

	const imageInputNames = Object.entries(inputSpec)
		.filter(([, spec]) => spec.type === 'image')
		.map(([name]) => name);
	const fileEntries = Object.entries(fileMap);
	// Fallback de 1 imagem: só quando há um único input de imagem, um único arquivo
	// enviado, e esse arquivo NÃO casa por nome com o input (fieldname genérico).
	const singleImageFallback =
		imageInputNames.length === 1 &&
		fileEntries.length === 1 &&
		!(imageInputNames[0] in fileMap)
			? fileEntries[0][1]
			: null;

	for (const [name, spec] of Object.entries(inputSpec)) {
		if (spec.type === 'image' || spec.type === 'file') {
			const isFile = spec.type === 'file';
			const buf =
				fileMap[name] ?? (isFile ? null : (singleImageFallback ?? null));
			if (spec.required && !buf) {
				throw new ToolEngineError(
					400,
					`input '${name}' (${isFile ? 'arquivo' : 'imagem'}) é obrigatório`,
				);
			}
			bag[`input.${name}`] = buf;
			if (isFile) {
				const meta = metaMap[name] ?? {};
				bag[`input.${name}__filename`] = meta.filename ?? null;
				bag[`input.${name}__mime`] = meta.mime ?? null;
			}
			continue;
		}

		const raw = fields[name];
		let val: unknown;

		if (raw === undefined || raw === '') {
			if (spec.default !== undefined) {
				val = spec.default;
			} else if (spec.required) {
				throw new ToolEngineError(400, `input '${name}' é obrigatório`);
			} else {
				bag[`input.${name}`] = undefined;
				continue;
			}
		} else {
			switch (spec.type) {
				case 'number': {
					const n = Number.parseFloat(raw);
					if (Number.isNaN(n)) {
						throw new ToolEngineError(400, `input '${name}' deve ser número`);
					}
					val = n;
					break;
				}
				case 'int': {
					const n = Number.parseInt(raw, 10);
					if (Number.isNaN(n)) {
						throw new ToolEngineError(400, `input '${name}' deve ser inteiro`);
					}
					val = n;
					break;
				}
				case 'bool':
					val = raw === 'true' || raw === '1';
					break;
				case 'enum': {
					// O multipart manda TUDO como string; casa o valor pela representação
					// textual e devolve a OPÇÃO ORIGINAL (preserva number da definição,
					// ex.: dpi [203,254,300,600]). Sem isso, "254" !== 254 e rejeitava.
					if (Array.isArray(spec.options)) {
						const match = spec.options.find((o) => String(o) === raw);
						if (match === undefined) {
							throw new ToolEngineError(400, `input '${name}' inválido`);
						}
						val = match;
					} else {
						val = raw;
					}
					break;
				}
				default:
					val = raw;
			}
		}

		if (
			(spec.type === 'number' || spec.type === 'int') &&
			typeof val === 'number'
		) {
			if (typeof spec.min === 'number' && val < spec.min) {
				throw new ToolEngineError(400, `input '${name}' menor que ${spec.min}`);
			}
			if (typeof spec.max === 'number' && val > spec.max) {
				throw new ToolEngineError(400, `input '${name}' maior que ${spec.max}`);
			}
		}

		bag[`input.${name}`] = val;
	}

	return bag;
}

/** Resolve UM valor de param: ref (`input.x`/`node.campo`, com `!` opcional) ou literal. */
function resolveValue(v: unknown, bag: Bag, heads: Set<string>): unknown {
	if (typeof v !== 'string') return v;
	const negate = v.startsWith('!');
	const path = negate ? v.slice(1) : v;
	const dot = path.indexOf('.');
	if (dot <= 0) return v; // sem cabeça pontuada → literal
	const head = path.slice(0, dot);
	if (!heads.has(head)) return v; // cabeça desconhecida → literal
	const resolved = bag[path];
	return negate ? !resolved : resolved;
}

/** Resolve todos os params de um nó contra a bag. */
export function resolveRefs(
	params: Record<string, unknown>,
	bag: Bag,
	heads: Set<string>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(params)) {
		out[k] = resolveValue(v, bag, heads);
	}
	return out;
}

/**
 * Projeta `definition.output` contra a bag. Strings viram refs resolvidas;
 * arrays de refs viram um objeto chaveado pelo último segmento do path
 * (`["prep.width_mm", ...]` → `{ width_mm, ... }`); outros valores passam literais.
 */
export function projectOutput(
	output: Record<string, unknown>,
	bag: Bag,
	heads: Set<string>,
): Record<string, unknown> {
	const project = (v: unknown): unknown => {
		if (typeof v === 'string') return resolveValue(v, bag, heads);
		if (Array.isArray(v)) {
			const obj: Record<string, unknown> = {};
			for (const item of v) {
				if (typeof item === 'string') {
					const key = item.split('.').pop() ?? item;
					obj[key] = resolveValue(item, bag, heads);
				}
			}
			return obj;
		}
		return v;
	};

	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(output)) {
		result[k] = project(v);
	}
	return result;
}

/** Conjunto de "cabeças" válidas de ref: `input` + os ids dos nós (validados). */
function buildHeads(def: ToolDefinitionDoc): Set<string> {
	const heads = new Set<string>(['input']);
	const seen = new Set<string>();
	for (const node of def.pipeline ?? []) {
		if (!NODE_ID_RE.test(node.id)) {
			throw new ToolEngineError(400, `id de nó inválido: ${node.id}`);
		}
		if (seen.has(node.id)) {
			throw new ToolEngineError(400, `id de nó duplicado: ${node.id}`);
		}
		seen.add(node.id);
		heads.add(node.id);
	}
	return heads;
}

/**
 * Executa a definition: roda o pipeline linear sobre a bag de inputs e devolve a
 * saída projetada. A bag é mutada com as saídas de cada bloco.
 */
export async function executeTool(
	def: ToolDefinitionDoc,
	bag: Bag,
	ctx: BlockRunContext,
): Promise<Record<string, unknown>> {
	const pipeline = def.pipeline ?? [];
	if (pipeline.length === 0) {
		throw new ToolEngineError(400, 'pipeline vazio');
	}
	if (pipeline.length > MAX_PIPELINE_NODES) {
		throw new ToolEngineError(
			400,
			`pipeline grande demais (${pipeline.length} > ${MAX_PIPELINE_NODES})`,
		);
	}

	const heads = buildHeads(def);

	for (const node of pipeline) {
		const block = blockRegistry.get(node.block);
		if (!block) {
			throw new ToolEngineError(400, `bloco desconhecido: ${node.block}`);
		}
		const resolved = resolveRefs(node.params ?? {}, bag, heads);
		const parsed = block.paramsSchema.safeParse(resolved);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const where = issue?.path?.join('.') ?? '';
			throw new ToolEngineError(
				400,
				`params inválidos no nó '${node.id}' (${node.block})${
					where ? ` campo '${where}'` : ''
				}: ${issue?.message ?? 'erro de validação'}`,
			);
		}
		const outputs = await block.run(ctx, parsed.data);
		for (const [k, val] of Object.entries(outputs)) {
			bag[`${node.id}.${k}`] = val;
		}
	}

	return projectOutput(def.output ?? {}, bag, heads);
}
