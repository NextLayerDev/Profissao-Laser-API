import { makeImageStudioControllers } from '../src/controllers/image-studio.js';

/**
 * Smoke do ENHANCER de prompt com chamada REAL ao OpenRouter.
 *
 * O que este script prova, e os testes unitários não podem: que o modelo de
 * verdade devolve JSON no formato pedido, que ele obedece (ou não) a proibição
 * do modo vetorizável, e que o filtro de string realmente pega o que escapa.
 * A última coluna é a que interessa — "o modelo desobedeceu?" é informação
 * operacional, não teórica.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/_smoke-enhance.ts
 */

const CASOS: { prompt: string; mode: string }[] = [
	{ prompt: 'coruja', mode: 'texto_imagem' },
	{ prompt: 'coruja geométrica pra cortar em MDF', mode: 'vetorizavel' },
	{ prompt: 'madeira de carvalho', mode: 'textura' },
	{ prompt: 'um leão realista com muita sombra', mode: 'vetorizavel' },
	{ prompt: 'logo de uma barbearia', mode: 'vetorizavel' },
];

const PROIBIDOS = ['gradiente', 'sombra', 'fotorrealista', 'degrad'];

function temProibido(s: string): boolean {
	const f = s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
	return PROIBIDOS.some((t) => f.includes(t));
}

/** `reply` mínimo: só precisamos do corpo que o controller enviaria. */
function fakeReply() {
	const state: { status: number; body: unknown } = { status: 0, body: null };
	const reply = {
		status(code: number) {
			state.status = code;
			return reply;
		},
		send(body: unknown) {
			state.body = body;
			return reply;
		},
	};
	return { reply, state };
}

async function main() {
	const { aiTextBlock } = await import('../src/tool-blocks/blocks/ai-text.js');

	/**
	 * Guarda a saída CRUA do modelo antes de o controller filtrar. É a única
	 * forma de responder à pergunta que importa: o modelo obedeceu à proibição,
	 * ou foi o filtro que salvou?
	 */
	const bruto = { enhanced: '', suggestions: [] as string[] };

	// `incr` fixo em 1: o teto de 30/h é do Redis de produção, não do smoke.
	const { enhancePromptController } = makeImageStudioControllers({
		incr: async () => 1,
		loadDefinition: (async () => ({ definition: {} })) as never,
		runText: (async (ctx: never, params: never) => {
			const out = await aiTextBlock.run(ctx, params);
			const j = (out.json ?? {}) as {
				enhanced?: string;
				suggestions?: string[];
			};
			bruto.enhanced = j.enhanced ?? '';
			bruto.suggestions = Array.isArray(j.suggestions) ? j.suggestions : [];
			return out;
		}) as never,
	});

	let vetorizaveis = 0;
	let desobedeceu = 0;
	let sobrou = 0;

	for (const caso of CASOS) {
		const { reply, state } = fakeReply();
		const t0 = Date.now();
		await enhancePromptController(
			{ currentCustomer: { id: 'smoke' }, headers: {}, body: caso } as never,
			reply as never,
		);
		const ms = Date.now() - t0;
		const body = state.body as { enhanced: string; suggestions: string[] };
		const vetor = caso.mode === 'vetorizavel';
		const modeloSujo = temProibido(bruto.enhanced);
		const finalSujo = temProibido(body.enhanced);

		if (vetor) {
			vetorizaveis++;
			if (modeloSujo) desobedeceu++;
			if (finalSujo) sobrou++;
		}

		console.log(
			`\n[${caso.mode}] "${caso.prompt}" — ${ms} ms${
				vetor
					? `  · modelo citou proibido: ${modeloSujo ? 'SIM' : 'não'}` +
						`  · sobrou após filtro: ${finalSujo ? 'SIM' : 'não'}`
					: ''
			}`,
		);
		if (vetor && modeloSujo) console.log(`  cru:   ${bruto.enhanced}`);
		console.log(`  final: ${body.enhanced}`);
		console.log(
			`  ideias (${bruto.suggestions.length} → ${body.suggestions.length}): ${
				body.suggestions.join(' | ') || '—'
			}`,
		);
	}

	console.log(
		`\nvetorizável: ${vetorizaveis} casos · modelo desobedeceu em ${desobedeceu} · sobrou proibido em ${sobrou}`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
