import { anthropic } from './anthropic.js';

/**
 * Tema inteligente do fórum: dado o título + mensagem de uma thread, escolhe o
 * tema existente que melhor encaixa ou propõe um nome novo curto em pt-BR.
 * Claude (Haiku) faz a classificação; se a IA estiver indisponível, cai numa
 * heurística por palavras-chave — a sugestão NUNCA falha.
 */

const SUGGEST_MODEL =
	process.env.FORUM_SUGGEST_MODEL || 'claude-haiku-4-5-20251001';

export interface ThemeSuggestion {
	existingId: string | null;
	newName: string | null;
}

interface CategoryOption {
	id: string;
	name: string;
}

/** Paleta de cores p/ temas criados automaticamente (determinística por nome). */
const THEME_COLORS = [
	'#8b5cf6',
	'#06b6d4',
	'#10b981',
	'#f59e0b',
	'#ef4444',
	'#ec4899',
	'#3b82f6',
	'#84cc16',
	'#f97316',
	'#14b8a6',
];

export function colorForThemeName(name: string): string {
	let h = 0;
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return THEME_COLORS[h % THEME_COLORS.length];
}

/* ── Heurística fallback (palavras-chave do domínio laser) ────────────────── */

const KEYWORD_THEMES: Array<{ pattern: RegExp; name: string }> = [
	{
		pattern: /(copo|caneca|tumbler|garrafa|squeeze|t[eé]rmico)/i,
		name: 'Copos e Canecas',
	},
	{
		pattern: /(inox|a[çc]o|metal|alum[ií]nio|lat[aã]o|anodizado|fibra)/i,
		name: 'Gravação em Metal',
	},
	{ pattern: /(madeira|mdf|bambu|compensado)/i, name: 'Madeira e MDF' },
	{ pattern: /(acr[ií]lico|ps|policarbonato)/i, name: 'Acrílico' },
	{ pattern: /(couro|tecido|feltro)/i, name: 'Couro e Tecido' },
	{ pattern: /(vidro|cristal|ta[çc]a)/i, name: 'Vidro e Cristal' },
	{
		pattern: /(vetor|lightburn|ezcad|corel|arquivo|svg|dxf|softwares?)/i,
		name: 'Arquivos e Softwares',
	},
	{
		pattern:
			/(m[aá]quina|laser|lente|foco|galvo|co2|diodo|manuten[çc][aã]o|pot[eê]ncia|par[aâ]metro)/i,
		name: 'Máquinas e Parâmetros',
	},
	{
		pattern: /(pre[çc]o|venda|cliente|or[çc]amento|neg[oó]cio|divulga)/i,
		name: 'Negócios e Vendas',
	},
];

function suggestByKeywords(
	text: string,
	categories: CategoryOption[],
): ThemeSuggestion {
	for (const { pattern, name } of KEYWORD_THEMES) {
		if (pattern.test(text)) {
			const existing = categories.find(
				(c) => c.name.trim().toLowerCase() === name.toLowerCase(),
			);
			return existing
				? { existingId: existing.id, newName: null }
				: { existingId: null, newName: name };
		}
	}
	// Sem match: melhor não inventar — usa um tema genérico.
	const general = categories.find((c) => /geral|d[uú]vidas/i.test(c.name));
	return general
		? { existingId: general.id, newName: null }
		: { existingId: null, newName: 'Dúvidas Gerais' };
}

/* ── Classificação via Claude ─────────────────────────────────────────────── */

async function suggestByClaude(
	title: string,
	content: string,
	categories: CategoryOption[],
): Promise<ThemeSuggestion | null> {
	if (
		!process.env.ANTHROPIC_API_KEY ||
		process.env.ANTHROPIC_API_KEY === 'not-configured'
	) {
		return null;
	}

	const list =
		categories.length > 0
			? categories.map((c) => `- ${c.id} :: ${c.name}`).join('\n')
			: '(nenhum tema existe ainda)';

	const response = await anthropic.messages.create(
		{
			model: SUGGEST_MODEL,
			max_tokens: 150,
			system:
				'Você classifica threads de um fórum brasileiro sobre gravação a laser (máquinas, materiais, técnicas, negócios). Responda APENAS com JSON válido, nada mais.',
			messages: [
				{
					role: 'user',
					content: `Thread nova:
Título: ${title || '(sem título)'}
Mensagem: ${content.slice(0, 1500)}

Temas existentes (id :: nome):
${list}

Escolha o tema existente que melhor encaixa. Se NENHUM encaixar bem, proponha um nome novo curto em pt-BR (2 a 4 palavras, específico do assunto, ex: "Gravação em Metal").

Responda só com: {"existing_id": "<id ou null>", "new_name": "<nome ou null>"} — exatamente um dos dois não-nulo.`,
				},
			],
		},
		{ timeout: 10000 },
	);

	const text = response.content
		.filter((b) => b.type === 'text')
		.map((b) => ('text' in b ? b.text : ''))
		.join('');
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) return null;

	const parsed = JSON.parse(match[0]) as {
		existing_id?: string | null;
		new_name?: string | null;
	};

	if (
		parsed.existing_id &&
		categories.some((c) => c.id === parsed.existing_id)
	) {
		return { existingId: parsed.existing_id, newName: null };
	}
	const newName = parsed.new_name?.trim();
	if (newName && newName.length >= 3 && newName.length <= 60) {
		return { existingId: null, newName };
	}
	return null;
}

/** Sugere o tema da thread — IA primeiro, heurística como rede de segurança. */
export async function suggestForumTheme(
	title: string,
	content: string,
	categories: CategoryOption[],
): Promise<ThemeSuggestion> {
	try {
		const ai = await suggestByClaude(title, content, categories);
		if (ai) return ai;
	} catch (err) {
		console.error('forum theme suggest: claude failed, using keywords', err);
	}
	return suggestByKeywords(`${title} ${content}`, categories);
}
