/**
 * Gera o manifesto das tools ImagR a partir do REGISTRY de blocos (fonte única
 * de verdade): introspecta o schema Zod de cada bloco e emite
 * { id, title, description, category(slug), output, hasImage, params[] }.
 * O seed do upvox (scripts/seed-imagr-tools.ts) consome esse JSON.
 *
 * Uso: npx tsx scripts/export-imagr-manifest.ts
 */
import fs from 'node:fs';
import { blockRegistry, registerCoreBlocks } from '../src/tool-blocks/index.js';

registerCoreBlocks();

// Blocos que NÃO viram tool (originais MVP + saídas de pipeline).
const EXCLUDE = new Set([
	'image.input',
	'image.vectorize',
	'laser.photoengrave',
	'ai.generate_image',
	'output.upload_png',
	'output.upload_svg',
	'output.return_base64',
	'output.export_dxf',
	'output.export_lbrn2',
	'util.text_template',
	'util.math',
	'util.condition',
	'util.http_request',
]);

/** prefixo do id → slug de categoria (tool_categories). */
function categoryOf(id: string): string {
	const p = id.split('.')[0];
	if (p === 'adjust') return 'ajustes';
	if (p === 'dither') return 'dither';
	if (
		p === 'edge' ||
		p === 'blur' ||
		p === 'detail' ||
		p === 'fx' ||
		p === 'mask'
	)
		return 'filtros';
	if (p === 'stylize') return 'estilizar';
	if (p === 'geo') return 'geometria';
	if (p === 'laser') return 'producao';
	if (p === 'vector') return 'vetor';
	if (p === 'ai' || id === 'image.upscale') return 'ia';
	if (id === 'util.dpiTest') return 'producao';
	return 'outros';
}

function outputOf(id: string): 'image' | 'svg' {
	return id === 'vector.contour' ? 'svg' : 'image';
}

function hasImageInput(id: string): boolean {
	return id !== 'util.dpiTest';
}

/** Desembrulha default/optional/nullable e devolve { schema, default }. */
// biome-ignore lint/suspicious/noExplicitAny: introspecção do Zod
function unwrap(f: any): { s: any; def: unknown } {
	let s = f;
	let def: unknown;
	while (s?.def) {
		const t = s.def.type;
		if (t === 'default') {
			def = s.def.defaultValue;
			s = s.def.innerType;
		} else if (t === 'optional' || t === 'nullable') {
			s = s.def.innerType;
		} else if (t === 'pipe') {
			// .transform()/preprocess → desce pro schema de ENTRADA (o que o user dá)
			s = s.def.in;
		} else break;
	}
	return { s, def };
}

interface Param {
	name: string;
	type: 'number' | 'int' | 'bool' | 'enum' | 'color' | 'string';
	min?: number;
	max?: number;
	step?: number;
	default?: unknown;
	options?: (string | number)[];
}

// biome-ignore lint/suspicious/noExplicitAny: introspecção do Zod
function introspectParam(name: string, f: any): Param {
	const { s, def } = unwrap(f);
	const d = s?.def ?? {};
	const t = d.type as string;
	// número (com possível marca de inteiro + min/max nos checks)
	if (t === 'number') {
		const checks = (d.checks ?? []).map(
			// biome-ignore lint/suspicious/noExplicitAny: shape dos checks varia
			(c: any) => c._zod?.def ?? c.def ?? c,
		);
		let min: number | undefined;
		let max: number | undefined;
		let isInt = false;
		for (const c of checks) {
			if (c.check === 'greater_than') min = c.value;
			else if (c.check === 'less_than') max = c.value;
			else if (c.format === 'safeint' || c.check === 'int') isInt = true;
		}
		const step = isInt || (max !== undefined && (max as number) > 5) ? 1 : 0.01;
		return {
			name,
			type: isInt ? 'int' : 'number',
			min,
			max,
			step,
			default: def,
		};
	}
	if (t === 'enum') {
		const options = d.entries ? Object.keys(d.entries) : (d.values ?? []);
		return { name, type: 'enum', options, default: def };
	}
	if (t === 'boolean') return { name, type: 'bool', default: def ?? false };
	// preprocess/pipe/transform e afins → inferir pelo default
	if (typeof def === 'boolean') return { name, type: 'bool', default: def };
	if (typeof def === 'number')
		return { name, type: 'number', default: def, step: 0.01 };
	// string → cor se o default parece #hex
	const isColor = typeof def === 'string' && /^#[0-9a-f]{6}$/i.test(def);
	return { name, type: isColor ? 'color' : 'string', default: def };
}

/** Títulos curtos sobrescritos (onde a description é longa demais). */
const TITLE_OVERRIDES: Record<string, string> = {
	'image.upscale': 'Ampliar (upscale)',
	'ai.backgroundRemoval': 'Remover fundo (IA)',
	'ai.colorize': 'Colorir (IA)',
	'ai.restoration': 'Restaurar foto (IA)',
};

/** title a partir da description (parte antes de ':' ou '('). */
function titleOf(description: string, id: string): string {
	if (TITLE_OVERRIDES[id]) return TITLE_OVERRIDES[id];
	const head = description.split(/[:(]/)[0].trim();
	return head.length > 0 && head.length <= 40
		? head
		: (id.split('.').pop() ?? id);
}

const tools = [];
for (const id of blockRegistry.keys().sort()) {
	if (EXCLUDE.has(id)) continue;
	// só blocos ImagR (têm prefixo conhecido)
	const block = blockRegistry.get(id);
	if (!block) continue;
	// biome-ignore lint/suspicious/noExplicitAny: shape
	const shape = (block.paramsSchema as any).shape;
	if (!shape) continue;
	const params: Param[] = [];
	for (const [name, f] of Object.entries(shape)) {
		if (name === 'image' || name === 'from') continue;
		params.push(introspectParam(name, f));
	}
	tools.push({
		id,
		title: titleOf(block.description, id),
		description: block.description,
		category: categoryOf(id),
		output: outputOf(id),
		hasImage: hasImageInput(id),
		params,
	});
}

const out = JSON.stringify(tools, null, 2);
const dest =
	'/Users/joaocruz/Desktop/nextlayerdev/api-upvox/scripts/imagr-manifest.json';
fs.writeFileSync(dest, out);
fs.writeFileSync('/tmp/imagr-manifest.json', out);
console.log(`manifesto: ${tools.length} tools → ${dest}`);
const byCat: Record<string, number> = {};
for (const t of tools) byCat[t.category] = (byCat[t.category] ?? 0) + 1;
console.log('por categoria:', JSON.stringify(byCat));
