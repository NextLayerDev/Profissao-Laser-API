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

/** Nome bonito (PT-BR) de cada tool — no padrão das tools existentes. */
const NICE_NAMES: Record<string, string> = {
	// Ajustes
	'adjust.brightness': 'Brilho',
	'adjust.contrast': 'Contraste',
	'adjust.exposure': 'Exposição',
	'adjust.gamma': 'Gama',
	'adjust.levels': 'Níveis',
	'adjust.bwLevels': 'Níveis P&B',
	'adjust.autoLevels': 'Níveis Automáticos',
	'adjust.autoContrast': 'Contraste Automático',
	'adjust.histogramStretch': 'Equalizar Histograma',
	'adjust.autoRefine': 'Refino Automático',
	'adjust.threshold': 'Limiar',
	'adjust.adaptiveThreshold': 'Limiar Adaptativo',
	'adjust.toneCurve': 'Curva de Tons',
	'adjust.highlightsShadows': 'Luzes e Sombras',
	'adjust.dehaze': 'Remover Névoa',
	'adjust.curves': 'Curvas',
	'adjust.hue': 'Matiz',
	'adjust.hsl': 'Matiz, Saturação e Luz',
	'adjust.saturation': 'Saturação',
	'adjust.vibrance': 'Vibração',
	'adjust.temperature': 'Temperatura de Cor',
	'adjust.tint': 'Tonalidade',
	'adjust.channelMixer': 'Mixer de Canais',
	'adjust.gradientMap': 'Mapa de Gradiente',
	'adjust.monochrome': 'Monocromático',
	'adjust.posterize': 'Posterizar',
	'adjust.texture': 'Textura',
	'adjust.grayscale': 'Escala de Cinza',
	// Dithering
	'dither.floydSteinberg': 'Dither Floyd–Steinberg',
	'dither.atkinson': 'Dither Atkinson',
	'dither.jarvis': 'Dither Jarvis',
	'dither.stucki': 'Dither Stucki',
	'dither.sierra': 'Dither Sierra',
	'dither.sierra2': 'Dither Sierra-2',
	'dither.sierraLite': 'Dither Sierra Lite',
	'dither.burkes': 'Dither Burkes',
	'dither.bayer8': 'Dither Bayer 8×8',
	'dither.bayer4': 'Dither Bayer 4×4',
	'dither.halftone': 'Meio-tom',
	'dither.blueNoise': 'Dither Blue Noise',
	'dither.errorDiffusion': 'Dither Multinível',
	// Filtros (borda/desfoque/máscara)
	'edge.sobel': 'Bordas Sobel',
	'edge.outline': 'Contorno',
	'edge.highPass': 'Passa-Alta',
	'edge.edgeDetect': 'Detectar Bordas',
	'edge.canny': 'Bordas Canny',
	'blur.box': 'Desfoque Box',
	'blur.gaussian': 'Desfoque Gaussiano',
	'blur.motion': 'Desfoque de Movimento',
	'blur.radial': 'Desfoque Radial',
	'blur.surface': 'Desfoque de Superfície',
	'detail.unsharpMask': 'Máscara de Nitidez',
	'detail.sharpen': 'Nitidez',
	'detail.denoise': 'Reduzir Ruído',
	'fx.noise': 'Ruído',
	'fx.filmGrain': 'Granulado de Filme',
	'fx.emboss': 'Relevo',
	'fx.morphology': 'Morfologia',
	'fx.lensDistortion': 'Distorção de Lente',
	'fx.invert': 'Inverter Cores',
	'mask.alphaThreshold': 'Limiar de Transparência',
	'mask.alphaFeather': 'Suavizar Borda',
	// Estilizar
	'stylize.halftone': 'Pontos de Jornal',
	'stylize.bloom': 'Brilho Suave',
	'stylize.glitch': 'Glitch',
	'stylize.oilPaint': 'Pintura a Óleo',
	'stylize.pixelate': 'Pixelizar',
	'stylize.sketch': 'Desenho a Lápis',
	'stylize.sepia': 'Sépia',
	'stylize.duotone': 'Duotone',
	'stylize.crossProcess': 'Cross Process',
	'stylize.vignette': 'Vinheta',
	'stylize.splitToning': 'Split Toning',
	'stylize.comic': 'Quadrinhos',
	'stylize.stipple': 'Pontilhismo',
	'stylize.lightLeak': 'Vazamento de Luz',
	// Geometria
	'geo.crop': 'Recortar',
	'geo.resize': 'Redimensionar',
	'geo.scale': 'Escalar',
	'geo.rotate': 'Girar',
	'geo.flip': 'Espelhar',
	'geo.tile': 'Ladrilhar',
	'geo.border': 'Borda',
	'geo.edgeFade': 'Bordas Esmaecidas',
	'geo.perspective': 'Perspectiva',
	'geo.skew': 'Inclinar',
	'geo.addText': 'Adicionar Texto',
	// Produção / laser
	'laser.oneClick': 'Gravação 1-Clique',
	'laser.materialPreset': 'Preset por Material',
	'laser.oneTouch': 'Ajuste Rápido',
	'laser.crystalEngraving': 'Gravação em Cristal 3D',
	'util.dpiTest': 'Teste de DPI',
	// IA
	'image.upscale': 'Ampliar Imagem',
	'ai.backgroundRemoval': 'Remover Fundo (IA)',
	'ai.colorize': 'Colorir Foto (IA)',
	'ai.restoration': 'Restaurar Foto (IA)',
	// Vetor
	'vector.contour': 'Contorno Vetorial',
};

/** Nome bonito da tool; fallback: parte da description antes de ':' ou '('. */
function titleOf(description: string, id: string): string {
	if (NICE_NAMES[id]) return NICE_NAMES[id];
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
