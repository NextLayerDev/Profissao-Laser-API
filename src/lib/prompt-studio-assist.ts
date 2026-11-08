import { templateProblem } from './creation-template.js';
import type { CreationTemplate } from './tool-definitions.js';

/**
 * IA DE BOLSO DO ESTÚDIO DE PROMPTS — o admin escreve uma frase, a IA preenche
 * o formulário.
 *
 * Quem alimenta os Prompts Mágicos é expert de laser e sublimação, não
 * engenheiro de prompt: pedir "prompt com {tema}", "largura em mm" e "zona da
 * câmera em X/Y" travava o cadastro. Aqui ficam os PROMPTS e a NORMALIZAÇÃO
 * (puros, testáveis); a chamada ao modelo fica no controller.
 *
 * Regra de ouro: a IA SUGERE, o admin confirma. Nada daqui grava nada — volta
 * para o formulário, que o admin revisa e salva como sempre.
 */

export type CardMode = 'texto' | 'imagem' | 'texto_imagem';

export interface CardSuggestion {
	title: string;
	category: string;
	description: string;
	mode: CardMode;
	prompt_script: string;
	formats: string[];
	example_temas: string[];
}

export interface PhoneSuggestion {
	label: string;
	brand: string;
	template: CreationTemplate;
	/** Frase curta para o admin: de onde veio a medida ou o que conferir. */
	note: string;
	sources: string[];
}

const MODES: CardMode[] = ['texto', 'imagem', 'texto_imagem'];

const str = (v: unknown, max: number): string =>
	typeof v === 'string' ? v.trim().slice(0, max) : '';

const num = (v: unknown): number | null => {
	const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
	return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Card ────────────────────────────────────────────────────────────────────

export function cardSystemPrompt(): string {
	return `Você ajuda um especialista em personalizados (laser, sublimação, UV) a cadastrar "cards" numa ferramenta onde o ALUNO escolhe um card, digita um tema curto e a IA de imagem gera a arte para um produto (capinha de celular, caneca, copo, chaveiro, quadro).

Responda SOMENTE um objeto JSON com estas chaves:
- "title": nome curto e vendável do card, em português (até 40 caracteres).
- "category": UMA categoria simples (ex.: Datas comemorativas, Pets, Fé, Família, Signos, Profissões, Infantil, Esportes, Amor, Humor). Prefira uma das categorias existentes quando servir.
- "description": uma frase que o aluno entende (até 120 caracteres), sem termos técnicos.
- "mode": "texto" (o aluno só digita), "imagem" (o aluno só manda foto) ou "texto_imagem" (digita e manda foto). Use foto só quando a ideia depende de um rosto/pet/objeto real.
- "prompt_script": o prompt para a IA de imagem, em português, rico e específico (estilo, paleta, composição, iluminação, acabamento), pensado para impressão em produto: fundo limpo, contraste bom, nada de texto pequeno ilegível, nada de marca d'água. Use o marcador literal {tema} exatamente onde entra o que o aluno digitar (obrigatório, a não ser que o mode seja "imagem"). Não descreva o formato do produto: o sistema já acrescenta medidas e áreas livres sozinho.
- "formats": lista com os ids dos formatos onde a arte faz sentido, escolhidos SÓ entre os ids fornecidos. Lista vazia = serve em todos.
- "example_temas": 3 exemplos curtos do que o aluno digitaria (ex.: nomes, datas, frases).`;
}

export function cardUserPrompt(o: {
	idea: string;
	formats: { id: string; label: string }[];
	categories: string[];
}): string {
	const formats = o.formats.length
		? o.formats.map((f) => `${f.id} (${f.label})`).join(', ')
		: '(nenhum cadastrado)';
	const cats = o.categories.length
		? o.categories.join(', ')
		: '(nenhuma ainda)';
	return `Ideia do especialista: ${o.idea}

Formatos disponíveis (id e nome): ${formats}
Categorias existentes: ${cats}`;
}

export function normalizeCardSuggestion(
	raw: unknown,
	allowedFormats: string[],
): CardSuggestion | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;

	const title = str(r.title, 60);
	let prompt = str(r.prompt_script, 8000);
	if (!title || !prompt) return null;

	const mode = MODES.includes(r.mode as CardMode)
		? (r.mode as CardMode)
		: 'texto';
	// Variações que o modelo inventa ({TEMA}, { tema }, [tema]) viram o marcador.
	prompt = prompt.replace(/\{\s*tema\s*\}|\[\s*tema\s*\]/gi, '{tema}');
	if (mode !== 'imagem' && !prompt.includes('{tema}')) {
		prompt = `${prompt.trimEnd()}\n\nTema: {tema}`;
	}

	const allowed = new Set(allowedFormats);
	const formats = Array.isArray(r.formats)
		? [
				...new Set(r.formats.filter((f): f is string => typeof f === 'string')),
			].filter((f) => allowed.has(f))
		: [];
	// Todos marcados = nenhum filtro; guardar a lista inteira só amarraria o
	// card aos formatos de hoje.
	const formatsFinal = formats.length === allowed.size ? [] : formats;

	const example_temas = Array.isArray(r.example_temas)
		? r.example_temas
				.map((t) => str(t, 60))
				.filter(Boolean)
				.slice(0, 3)
		: [];

	return {
		title,
		category: str(r.category, 40),
		description: str(r.description, 160),
		mode,
		prompt_script: prompt,
		formats: formatsFinal,
		example_temas,
	};
}

// ─── Celular ─────────────────────────────────────────────────────────────────

export function phoneSystemPrompt(): string {
	return `Você pesquisa medidas físicas de celulares para fabricar capinhas personalizadas.

Responda SOMENTE um objeto JSON:
{
  "found": true|false,
  "label": "nome comercial oficial, sem a marca quando for iPhone (ex.: iPhone 16 Pro) e com Galaxy para Samsung (ex.: Galaxy A56 5G)",
  "brand": "Apple" | "Samsung" | "Motorola" | "Xiaomi" | outra marca,
  "height_mm": altura do aparelho,
  "width_mm": largura do aparelho,
  "corner_radius_mm": raio aproximado dos cantos,
  "cameras": [
    { "label": "câmera", "shape": "rect" | "ellipse", "x_mm": ..., "y_mm": ..., "w_mm": ..., "h_mm": ..., "corner_radius_mm": ... }
  ],
  "note": "uma frase curta: de onde vieram as medidas e o que é estimado",
  "sources": ["urls consultadas"]
}

Regras:
- Altura e largura vêm da ficha técnica oficial (fabricante ou GSMArena). Use o modelo exato pedido.
- Coordenadas do bloco de câmeras olhando o aparelho POR TRÁS, em pé, com origem no canto superior esquerdo: x da esquerda para a direita, y de cima para baixo, em milímetros. Nessa vista a câmera de iPhone e da maioria dos Android fica no alto à esquerda.
- O retângulo deve cobrir o RESSALTO inteiro do conjunto de câmeras e flash, mais ~1,5 mm de folga em volta (é o furo da capinha). Câmeras soltas em linha (ex.: Galaxy S/A recentes) viram UM retângulo cobrindo todas.
- Se não achar o modelo, devolva "found": false e explique em "note".`;
}

export function phoneUserPrompt(name: string): string {
	return `Modelo: ${name}`;
}

export function normalizePhoneSuggestion(raw: unknown):
	| PhoneSuggestion
	| {
			error: string;
	  } {
	if (!raw || typeof raw !== 'object') {
		return { error: 'A pesquisa não trouxe dados desse modelo.' };
	}
	const r = raw as Record<string, unknown>;
	if (r.found === false) {
		return {
			error: str(r.note, 200) || 'Não encontrei esse modelo. Confira o nome.',
		};
	}

	const label = str(r.label, 60);
	const width = num(r.width_mm);
	const height = num(r.height_mm);
	if (!label || !width || !height) {
		return { error: 'A pesquisa não trouxe as medidas desse modelo.' };
	}
	// Celular em pé: se vier deitado, desvira.
	const [w, h] = width > height ? [height, width] : [width, height];
	if (w < 40 || w > 120 || h < 90 || h > 200) {
		return {
			error: `Medidas fora do esperado para um celular (${round1(w)} × ${round1(h)} mm). Confira o nome do modelo.`,
		};
	}

	const corner = num(r.corner_radius_mm);
	const cameras = Array.isArray(r.cameras) ? r.cameras : [];
	const zones: NonNullable<CreationTemplate['zones']> = [];
	for (const c of cameras.slice(0, 3)) {
		if (!c || typeof c !== 'object') continue;
		const z = c as Record<string, unknown>;
		const x = num(z.x_mm);
		const y = num(z.y_mm);
		const zw = num(z.w_mm);
		const zh = num(z.h_mm);
		if (x == null || y == null || !zw || !zh) continue;
		// Encosta na borda em vez de reprovar: o ressalto que "vaza" 0,5 mm
		// é arredondamento da IA, não erro de cadastro.
		const cx = Math.max(0, Math.min(x, w - 1));
		const cy = Math.max(0, Math.min(y, h - 1));
		const cw = Math.min(zw, w - cx);
		const ch = Math.min(zh, h - cy);
		if (cw < 3 || ch < 3) continue;
		const zr = num(z.corner_radius_mm);
		zones.push({
			label: str(z.label, 30) || 'câmera',
			shape: z.shape === 'ellipse' ? 'ellipse' : 'rect',
			x: round1(cx),
			y: round1(cy),
			w: round1(cw),
			h: round1(ch),
			...(zr && zr > 0 ? { r: round1(Math.min(zr, cw / 2, ch / 2)) } : {}),
		});
	}
	if (zones.length === 0) {
		return {
			error:
				'Achei o aparelho, mas não a posição da câmera. Cadastre e desenhe a câmera à mão.',
		};
	}

	const template: CreationTemplate = {
		width_mm: round1(w),
		height_mm: round1(h),
		outline: 'rect',
		corner_radius_mm: round1(
			Math.min(Math.max(corner ?? 9, 2), Math.min(w, h) / 2),
		),
		zones,
	};
	const problem = templateProblem(template);
	if (problem) return { error: `Medidas incoerentes: ${problem}.` };

	const sources = Array.isArray(r.sources)
		? r.sources
				.filter(
					(s): s is string => typeof s === 'string' && /^https?:\/\//.test(s),
				)
				.slice(0, 3)
		: [];

	return {
		label,
		brand: str(r.brand, 30) || guessBrand(label),
		template,
		note: str(r.note, 200),
		sources,
	};
}

export function guessBrand(label: string): string {
	const l = label.toLowerCase();
	if (l.includes('iphone')) return 'Apple';
	if (l.includes('galaxy')) return 'Samsung';
	if (/moto|edge/.test(l)) return 'Motorola';
	if (/redmi|xiaomi|poco/.test(l)) return 'Xiaomi';
	return '';
}

// ─── Lista de populares ──────────────────────────────────────────────────────

export function popularSystemPrompt(): string {
	return `Você conhece o mercado brasileiro de celulares. Responda SOMENTE um objeto JSON {"models": ["..."]} com até 10 nomes comerciais de celulares MAIS VENDIDOS no Brasil hoje (Apple, Samsung, Motorola, Xiaomi), do mais vendido para o menos, no formato "iPhone 16", "Galaxy A56 5G", "Moto G85". Não repita os que já estão na lista do usuário.`;
}

export function popularUserPrompt(existing: string[]): string {
	return `Já cadastrados: ${existing.length ? existing.join(', ') : '(nenhum)'}`;
}

export function normalizePopular(raw: unknown, existing: string[]): string[] {
	const list = (raw as { models?: unknown } | null)?.models;
	if (!Array.isArray(list)) return [];
	const have = new Set(existing.map((e) => e.toLowerCase().trim()));
	const out: string[] = [];
	for (const m of list) {
		const name = str(m, 60);
		const key = name.toLowerCase();
		if (!name || have.has(key) || out.some((o) => o.toLowerCase() === key))
			continue;
		out.push(name);
	}
	return out.slice(0, 10);
}
