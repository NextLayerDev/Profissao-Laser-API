import { blockRegistry } from '../tool-blocks/index.js';
import type { BlockRunContext } from '../tool-blocks/types.js';
import type {
	InputSpec,
	PipelineNode,
	ToolDefinitionDoc,
} from './tool-definitions.js';
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

/**
 * Conjunto de "cabeças" válidas de ref: `input` + os ids dos nós (validados).
 *
 * Percorre TODOS os fluxos, não só o que vai rodar. Não é zelo: `resolveValue`
 * devolve a string LITERAL quando a cabeça é desconhecida, então uma chave de
 * `output` que aponte para um nó do outro fluxo chegaria à tela como o texto
 * `"time.titulo"` em vez de vir vazia. Conhecendo o id, a mesma referência
 * resolve para `undefined` e a chave simplesmente não aparece — que é o que
 * "aquele passo não rodou neste fluxo" significa.
 */
function buildHeads(def: ToolDefinitionDoc): Set<string> {
	const heads = new Set<string>(['input']);
	for (const nos of todosOsFluxos(def)) {
		// Duplicata é checada POR FLUXO: dois fluxos usarem o mesmo id (`arte` no
		// de criar e no de ajustar) é o caso normal, e é o que faz uma única
		// `output` servir aos dois.
		const seen = new Set<string>();
		for (const node of nos) {
			if (!NODE_ID_RE.test(node.id)) {
				throw new ToolEngineError(400, `id de nó inválido: ${node.id}`);
			}
			if (seen.has(node.id)) {
				throw new ToolEngineError(400, `id de nó duplicado: ${node.id}`);
			}
			seen.add(node.id);
			heads.add(node.id);
		}
	}
	return heads;
}

/** Todos os pipelines declarados: o padrão mais os nomeados. */
function todosOsFluxos(def: ToolDefinitionDoc): PipelineNode[][] {
	const fluxos: PipelineNode[][] = [];
	if (def.pipeline?.length) fluxos.push(def.pipeline);
	for (const nos of Object.values(def.pipelines ?? {})) {
		if (Array.isArray(nos)) fluxos.push(nos);
	}
	return fluxos;
}

/**
 * ┌─ FLUXOS NOMEADOS: UMA TOOL, MAIS DE UM CAMINHO ─────────────────────────┐
 * │ O motor continua LINEAR — não existe `if`, não existe ramo dentro de um  │
 * │ pipeline. O que existe agora é a tool poder declarar MAIS DE UM pipeline │
 * │ e o run escolher um pelo nome (`flow`).                                  │
 * │                                                                          │
 * │ POR QUE ISSO PRECISOU EXISTIR: o Ateliê tem dois caminhos com custo e    │
 * │ trabalho completamente diferentes — CRIAR (seis especialistas lendo foto │
 * │ e marca, depois a geração) e AJUSTAR (pega a arte pronta e amplia, ou    │
 * │ remove fundo, ou varia). Com um pipeline só, ajustar rodaria o time      │
 * │ inteiro de novo para produzir um prompt que ninguém usaria.              │
 * │                                                                          │
 * │ E POR QUE NÃO UMA SEGUNDA TOOL: chave de tool nova é COBRANÇA nova       │
 * │ (funcionalidade, preço, cota) no upvox. O gate de billing é por          │
 * │ `tool_key`; mantendo a mesma chave, o ajuste passa exatamente pelo mesmo │
 * │ caminho de cobrança já provado — nada de invocation nova, nada de preço  │
 * │ inventado aqui dentro.                                                   │
 * │                                                                          │
 * │ RETROCOMPATÍVEL POR CONSTRUÇÃO: tool sem `pipelines` roda o `pipeline`   │
 * │ de sempre, e a única diferença de comportamento é a de `buildHeads`      │
 * │ acima, que não muda nada quando só existe um fluxo.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Lança 400 (e não cai no default em silêncio) quando o nome não existe: um
 * `flow` errado significa que o cliente pediu "ajustar" e receberia "criar" —
 * um run caro que ninguém pediu, cobrado.
 */
export function selecionarPipeline(
	def: ToolDefinitionDoc,
	flow?: string | null,
): PipelineNode[] {
	const nome = flow?.trim();
	if (!nome) return def.pipeline ?? [];
	const nomeado = def.pipelines?.[nome];
	if (!Array.isArray(nomeado)) {
		throw new ToolEngineError(
			400,
			`fluxo '${nome}' não existe nesta ferramenta`,
		);
	}
	return nomeado;
}

/**
 * Devolve uma cópia da definition com os nós do fluxo escolhido TROCADOS.
 * Existe para o preview, que roda o mesmo fluxo com os nós de efeito colateral
 * removidos — sem perder os outros fluxos de vista (ver `buildHeads`).
 */
export function comPipeline(
	def: ToolDefinitionDoc,
	flow: string | null | undefined,
	nos: PipelineNode[],
): ToolDefinitionDoc {
	const nome = flow?.trim();
	if (!nome) return { ...def, pipeline: nos };
	return { ...def, pipelines: { ...(def.pipelines ?? {}), [nome]: nos } };
}

/**
 * Executa a definition: roda o pipeline linear sobre a bag de inputs e devolve a
 * saída projetada JUNTO com a bag. A bag é mutada com as saídas de cada bloco.
 *
 * A bag sai porque `definition.output` é ALLOW-LIST: o que um bloco produz e a
 * definition não lista é calculado, pago e descartado. O buffer da arte é
 * exatamente esse caso — ele existe na bag e nunca é projetado. Devolvê-la
 * permite ao controller carimbar a peça sem depender de a definition expor o
 * master, que é justamente o que NÃO pode acontecer numa tool licenciada.
 */
export async function executeTool(
	def: ToolDefinitionDoc,
	bag: Bag,
	ctx: BlockRunContext,
	flow?: string | null,
): Promise<{ output: Record<string, unknown>; bag: Bag }> {
	const pipeline = selecionarPipeline(def, flow);
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
		/**
		 * Checagem de aborto ENTRE nós. Um bloco individual pode não honrar o
		 * signal (nem todos fazem I/O), mas nenhum pipeline abortado deve começar
		 * o próximo passo — é o que impede um run estourado de continuar gastando
		 * modelo depois do prazo.
		 */
		ctx.signal?.throwIfAborted();

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
		/**
		 * O bloco descreve o evento; o motor carimba de qual nó veio. Assim um
		 * bloco não precisa conhecer o próprio id no pipeline, e o front consegue
		 * ligar cada evento ao passo certo.
		 *
		 * O `try/catch` é deliberado: quem consome progresso é um socket, e um
		 * socket que morreu no meio não pode derrubar um run já pago.
		 */
		const ctxNode: BlockRunContext = ctx.onProgress
			? {
					...ctx,
					onProgress: (ev) => {
						try {
							ctx.onProgress?.({ ...ev, node: node.id });
						} catch {
							// progresso é cosmético; nunca quebra a execução
						}
					},
				}
			: ctx;

		ctxNode.onProgress?.({ kind: 'node_start', block: node.block });
		const outputs = await block.run(ctxNode, parsed.data);
		for (const [k, val] of Object.entries(outputs)) {
			bag[`${node.id}.${k}`] = val;
		}
		ctxNode.onProgress?.({ kind: 'node_done', block: node.block });
	}

	return { output: projectOutput(def.output ?? {}, bag, heads), bag };
}
