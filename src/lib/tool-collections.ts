import { z } from 'zod';
import { ToolEngineError } from './tool-errors.js';

/**
 * COLEÇÕES — o armazém genérico da Fábrica de Tools.
 *
 * Uma coleção é um dataset declarado por uma tool na sua `definition`. O
 * back não sabe (e não pode saber) o que é "Metallic", "materiais" ou
 * "velocidades de corte": ele lê `definition.collections[nome]` e monta
 * validação, facetas, moderação e busca a partir dali.
 *
 * É a generalização do "Banco do Admin" (`bank`), que já guardava registros
 * por tool em `pl_tool_bank_entry.data` mas só servia galeria de prompts.
 * O `bank` de hoje é exatamente `collections.default` — retrocompatível.
 *
 * A regra que sustenta o desenho: **computar** algo novo exige um BLOCO
 * (código); **guardar/consultar** algo novo exige uma COLEÇÃO (dado, zero DDL).
 */

/* ─────────────────────────── Tipos ─────────────────────────── */

export type CollectionFieldType =
	| 'text'
	| 'textarea'
	| 'enum'
	| 'number'
	| 'int'
	| 'bool'
	| 'image'
	| 'url';

/**
 * Como o campo entra no filtro da tela:
 *   `true`    → faceta por valor exato (chips com contagem)
 *   `'range'` → faixa numérica (slider de mín/máx)
 *   ausente   → não filtra
 */
export type CollectionFacet = boolean | 'range';

export interface CollectionFieldSpec {
	name: string;
	label?: string;
	type: CollectionFieldType;
	options?: (string | number)[];
	required?: boolean;
	facet?: CollectionFacet;
	/** Unidade só de exibição (mm, W, bar). O valor guardado é o número puro. */
	unit?: string;
	min?: number;
	max?: number;
	placeholder?: string;
	/**
	 * Aplicabilidade condicional: `{ operacao: 'corte' }` faz o campo só existir
	 * (e só ser exigido) quando `data.operacao === 'corte'`. Aceita array para
	 * "um destes". Espelha o que `parameter-field-rules.ts` já faz na tela de
	 * Parâmetros, mas declarado como dado em vez de hardcoded.
	 */
	showIf?: Record<string, string | number | boolean | (string | number)[]>;
}

export interface CollectionConfig {
	label?: string;
	fields: CollectionFieldSpec[];
	/** Quem cria registros e se passa por moderação. Ausente = só staff. */
	submissions?: {
		who?: 'admin' | 'student';
		moderation?: 'none' | 'pending';
		/** O autor pode editar o próprio registro depois de aprovado. */
		ownerEditable?: boolean;
	};
	feedback?: {
		like?: boolean;
		save?: boolean;
		rating?: boolean;
		result?: {
			outcomes?: string[];
			symptoms?: string[];
			adjustments?: boolean;
			photo?: boolean;
		};
	};
	/** Campos considerados na busca textual (`title`, `description`, `data.x`). */
	search?: string[];
	sort?: { value: string; label: string }[];
	/**
	 * "Registro mais próximo" quando não existe o exato: interpola sobre os
	 * campos numéricos de `on`, dentro do mesmo grupo definido por `groupBy`.
	 */
	nearest?: { on: string[]; groupBy?: string[] };
	/** Indexação no Cérebro da IA, com o texto montado pelo `template`. */
	rag?: { enabled?: boolean; template?: string };
	card?: Record<string, string>;
	detail?: Record<string, unknown>;
}

export type CollectionsConfig = Record<string, CollectionConfig>;

/** Nome de coleção válido (vira parte de rota e de chave de índice). */
const COLLECTION_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/* ────────────────────── Resolução da coleção ────────────────────── */

/**
 * Acha a coleção pedida na definition. Trata `default` como o `bank` legado,
 * para que o Prompts Mágicos continue funcionando byte a byte sem migração de
 * dado nem de definition.
 */
export function resolveCollection(
	doc: {
		collections?: CollectionsConfig;
		bank?: { enabled?: boolean; fields?: unknown[] };
	},
	name: string,
): CollectionConfig {
	if (!COLLECTION_NAME_RE.test(name)) {
		throw new ToolEngineError(400, `nome de coleção inválido: '${name}'`);
	}

	const declared = doc.collections?.[name];
	if (declared) return declared;

	// Ponte com o banco legado: `bank.fields` tem a mesma forma que
	// `collection.fields` (name/label/type/options/required), então dá para
	// servi-lo pela API de coleções sem tocar em nenhuma tool publicada.
	if (name === 'default' && doc.bank?.enabled) {
		return {
			label: 'Banco',
			fields: (doc.bank.fields ?? []) as CollectionFieldSpec[],
			submissions: { who: 'admin', moderation: 'none' },
		};
	}

	throw new ToolEngineError(404, `coleção '${name}' não existe nesta tool`);
}

/* ────────────────────── Aplicabilidade (showIf) ────────────────────── */

/**
 * O campo se aplica a este registro? Um campo cujo `showIf` não bate não é
 * exigido nem validado — é assim que "pressão do gás" só existe quando a
 * operação é corte, sem precisar de uma coleção separada por operação.
 */
export function isFieldApplicable(
	field: CollectionFieldSpec,
	data: Record<string, unknown>,
): boolean {
	if (!field.showIf) return true;
	return Object.entries(field.showIf).every(([key, expected]) => {
		const actual = data[key];
		if (Array.isArray(expected)) {
			return expected.some((e) => String(e) === String(actual));
		}
		return String(expected) === String(actual);
	});
}

/* ────────────────────── Validação dinâmica ────────────────────── */

function fieldSchema(field: CollectionFieldSpec): z.ZodTypeAny {
	switch (field.type) {
		case 'number':
		case 'int': {
			let s = z.coerce.number();
			if (field.type === 'int') s = s.int();
			if (typeof field.min === 'number') s = s.min(field.min);
			if (typeof field.max === 'number') s = s.max(field.max);
			return s;
		}
		case 'bool':
			// O multipart e o CSV mandam tudo como string.
			return z.preprocess(
				(v) => v === true || v === 'true' || v === '1' || v === 1,
				z.boolean(),
			);
		case 'enum': {
			const opts = (field.options ?? []).map(String);
			if (!opts.length) return z.string().max(500);
			// Casa pela representação textual e devolve a OPÇÃO ORIGINAL, para
			// preservar número quando as opções são numéricas — mesma técnica que
			// `coerceInputs` já usa nos inputs do motor.
			return z.preprocess(
				(v) => {
					const match = (field.options ?? []).find(
						(o) => String(o) === String(v),
					);
					return match ?? v;
				},
				z
					.union([z.string(), z.number()])
					.refine((v) => opts.includes(String(v)), {
						message: `valor inválido (aceita: ${opts.join(', ')})`,
					}),
			);
		}
		case 'image':
		case 'url':
			return z.string().url().max(2000);
		case 'textarea':
			return z.string().max(20_000);
		default:
			return z.string().max(2000);
	}
}

/**
 * Monta um zod para o `data` de um registro a partir de `collection.fields`.
 *
 * Feito em duas passadas de propósito: `showIf` depende dos VALORES do próprio
 * registro, então o schema precisa ser construído já conhecendo `raw`. Um
 * schema estático não conseguiria expressar "pressão é obrigatória só quando a
 * operação é corte".
 *
 * Campos não declarados são DESCARTADOS (não `strict`, que erraria): assim uma
 * coleção pode ganhar campos sem quebrar registros antigos, e ninguém injeta
 * chave arbitrária no jsonb.
 */
export function validateCollectionData(
	fields: CollectionFieldSpec[],
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const issues: string[] = [];

	for (const field of fields) {
		if (!isFieldApplicable(field, raw)) continue;

		const value = raw[field.name];
		const empty = value === undefined || value === null || value === '';

		if (empty) {
			if (field.required) {
				issues.push(`'${field.label ?? field.name}' é obrigatório`);
			}
			continue;
		}

		const parsed = fieldSchema(field).safeParse(value);
		if (!parsed.success) {
			const first = parsed.error.issues[0]?.message ?? 'valor inválido';
			issues.push(`'${field.label ?? field.name}': ${first}`);
			continue;
		}
		out[field.name] = parsed.data;
	}

	if (issues.length) {
		throw new ToolEngineError(400, issues.join('; '));
	}
	return out;
}

/* ────────────────────── Facetas declaradas ────────────────────── */

export interface FacetSpec {
	name: string;
	label: string;
	kind: 'enum' | 'range';
	options?: (string | number)[];
	unit?: string;
}

/** Facetas que a tela deve desenhar, derivadas de `fields[].facet`. */
export function collectionFacets(config: CollectionConfig): FacetSpec[] {
	return config.fields
		.filter((f) => f.facet)
		.map((f) => ({
			name: f.name,
			label: f.label ?? f.name,
			kind: f.facet === 'range' ? ('range' as const) : ('enum' as const),
			...(f.options ? { options: f.options } : {}),
			...(f.unit ? { unit: f.unit } : {}),
		}));
}

/**
 * Renderiza o texto de um registro para o Cérebro da IA, a partir do
 * `rag.template` declarado (`'{data.material} {data.espessura_mm}mm'`).
 * Placeholder sem valor vira string vazia, e sobra de espaço é colapsada — um
 * template com campo opcional ausente não pode gerar "aço  mm ·  · ".
 */
export function renderCollectionEntry(
	config: CollectionConfig,
	entry: {
		title: string;
		description?: string | null;
		data: Record<string, unknown>;
	},
): string {
	const template = config.rag?.template;
	if (!template) {
		const pairs = config.fields
			.filter((f) => entry.data[f.name] !== undefined)
			.map((f) => `${f.label ?? f.name}: ${String(entry.data[f.name])}`);
		return [entry.title, entry.description, ...pairs]
			.filter(Boolean)
			.join('\n');
	}
	return template
		.replace(/\{([\w.]+)\}/g, (_m, path: string) => {
			if (path === 'title') return entry.title;
			if (path === 'description') return entry.description ?? '';
			if (path.startsWith('data.')) {
				const v = entry.data[path.slice('data.'.length)];
				return v === undefined || v === null ? '' : String(v);
			}
			return '';
		})
		.replace(/\s{2,}/g, ' ')
		.replace(/(\s·\s)+/g, ' · ')
		.replace(/^[\s·]+|[\s·]+$/g, '')
		.trim();
}
