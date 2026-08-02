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
	// `incr` fixo em 1: o teto de 30/h é do Redis de produção, não do smoke.
	const { enhancePromptController } = makeImageStudioControllers({
		incr: async () => 1,
		loadDefinition: (async () => ({
			definition: {},
		})) as never,
		runText: (await import('../src/tool-blocks/blocks/ai-text.js')).aiTextBlock
			.run,
	});

	console.log('modo             ms     bruto?  final\n' + '─'.repeat(78));

	for (const caso of CASOS) {
		const { reply, state } = fakeReply();
		const t0 = Date.now();
		await enhancePromptController(
			{
				currentCustomer: { id: 'smoke' },
				headers: {},
				body: caso,
			} as never,
			reply as never,
		);
		const ms = Date.now() - t0;
		const body = state.body as {
			enhanced: string;
			suggestions: string[];
		};

		const sujo = temProibido(body.enhanced) ? 'SIM' : 'não';
		console.log(
			`${caso.mode.padEnd(15)} ${String(ms).padStart(5)}  ${sujo.padEnd(6)} ${body.enhanced.slice(0, 90)}`,
		);
		for (const s of body.suggestions) {
			console.log(`${' '.repeat(30)}└─ ${s}`);
		}
		if (caso.mode === 'vetorizavel' && temProibido(body.enhanced)) {
			console.log(
				`${' '.repeat(30)}!! termo proibido SOBROU depois do filtro — investigar`,
			);
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
