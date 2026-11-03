import { z } from 'zod';
import {
	CLASSE_OUTRA,
	derivarPerfilCurto,
	type MachineClass,
	machineClassIds,
	machineFromCollectionData,
	REGIMES_FISCAIS,
	type RegimeFiscal,
} from '../../lib/quote/machines.js';
import { profileFromCollectionData } from '../../lib/quote/pricing.js';
import type { ToolBlock } from '../types.js';

/**
 * `quote.perfil_padrao` — SEIS PERGUNTAS VIRAM O PERFIL DE CUSTO INTEIRO.
 *
 * Este bloco existe porque a coleção `perfis` pedia 31 campos e o banco
 * respondeu com ZERO perfis criados. Ele recebe o que o dono da oficina sabe de
 * cabeça, resolve a máquina na tabela de referência e devolve um registro
 * COMPLETO da coleção — pronto para o POST — mais a lista do que foi assumido,
 * campo a campo, com a origem em português.
 *
 * TRÊS COISAS QUE ELE NÃO FAZ, e cada uma é deliberada:
 *
 *  1. **Não calcula preço.** Ele monta um perfil; quem precifica é
 *     `quote.price`, e nada aqui toca em `computeQuote`.
 *  2. **Não grava nada.** Devolve o `data` e quem salva é a tela, pelo endpoint
 *     genérico de coleção, com a validação e a visibilidade de sempre. Um bloco
 *     que escrevesse na coleção do aluno seria uma segunda porta de gravação,
 *     com regras próprias, ao lado da que já existe.
 *  3. **Não chama modelo nenhum.** É a regra da ferramenta: número que alguém
 *     vai cobrar de um cliente não sai de LLM. Aqui não sai nem de HTTP — a
 *     única ida ao banco é ler a tabela de máquinas.
 *
 * ONDE MORA CADA METADE: a TABELA de mercado (preço da máquina, kW, R$/h de
 * tubo) é a coleção `maquinas`, que o admin edita sem deploy; a CONTA (vida
 * útil, hora do dono, margem a partir do markup) é código puro em
 * `lib/quote/machines.ts`. A coleção vence o código campo a campo — e o código
 * é o lastro, porque hoje a coleção está vazia e coleção vazia não pode
 * significar "sem padrão".
 */

async function loadDeps() {
	const [
		{ loadPublishedToolDefinition },
		{ resolveCollection },
		{ toolCollectionRepository },
	] = await Promise.all([
		import('../../lib/tool-definitions.js'),
		import('../../lib/tool-collections.js'),
		import('../../repositories/tool-collection.js'),
	]);
	return {
		loadPublishedToolDefinition,
		resolveCollection,
		toolCollectionRepository,
	};
}

/** `''`/`null` (campo em branco no multipart) contam como ausente, não como 0. */
function vazioComoAusente(v: unknown): unknown {
	return v === '' || v === null ? undefined : v;
}

function numOpcional(min: number, max: number) {
	return z.preprocess(
		vazioComoAusente,
		z.coerce.number().min(min).max(max).optional(),
	);
}

const perfilSchema = z.object({
	/** Tool dona das coleções. Outra tool é permitido: coleção é dado compartilhado. */
	tool: z.string().min(1).max(60).default('central_custos'),
	/** Nome da coleção com a tabela de máquinas (admin). */
	maquinas_collection: z.string().min(1).max(40).default('maquinas'),

	/* ── as seis perguntas ─────────────────────────────────────────────────── */
	maquina_classe: z
		.preprocess(vazioComoAusente, z.string().min(1).max(40).optional())
		.default(CLASSE_OUTRA),
	horas_uteis_dia: numOpcional(0.5, 24),
	ganho_mensal: numOpcional(0, 1_000_000),
	markup_pct: numOpcional(0, 5000),
	regime_fiscal: z.preprocess(
		vazioComoAusente,
		z.enum(REGIMES_FISCAIS as [RegimeFiscal, ...RegimeFiscal[]]).optional(),
	),
	pedido_minimo: numOpcional(0, 1_000_000),

	/**
	 * O aluno DISCORDOU de um derivado. Chega como `{campo: valor}` já na escala
	 * da coleção (percentual em 0–100, minuto em minuto), porque é o que a tela
	 * mostra e o que o registro guarda — converter aqui e de novo lá seria a
	 * chance de dividir por 100 duas vezes.
	 *
	 * Sobrescrever é o ponto: o padrão é um chute bom, não uma verdade. Quem
	 * mediu o consumo com alicate amperímetro tem que poder mandar o número dele
	 * sem voltar ao paredão de 31 campos.
	 */
	overrides: z
		.preprocess(
			(v) => (typeof v === 'string' && v.trim() !== '' ? JSON.parse(v) : v),
			z
				.record(z.string().max(40), z.union([z.string(), z.number()]))
				.optional(),
		)
		.optional(),
});

type PerfilParams = z.infer<typeof perfilSchema>;

export const quotePerfilPadraoBlock: ToolBlock<PerfilParams> = {
	id: 'quote.perfil_padrao',
	category: 'quote',
	description:
		'Monta o perfil de custo inteiro (31 campos) a partir de seis perguntas que o dono da oficina responde de cabeça: máquina, horas por dia, quanto quer ganhar por mês, lucro sobre o custo, nota fiscal e pedido mínimo. Devolve o registro pronto para a coleção `perfis` e a lista do que foi assumido, com a origem de cada número. Não grava, não precifica e não passa por IA.',
	paramsSchema: perfilSchema,
	async run(ctx, p) {
		/* ── 1. a máquina: coleção primeiro, código como lastro ──────────────── */
		let maquina: MachineClass | null = null;
		if (p.maquina_classe !== CLASSE_OUTRA) {
			maquina = await maquinaDaColecao(ctx, p);
		}

		/* ── 2. a derivação (pura, testável, sem banco) ──────────────────────── */
		const derivado = derivarPerfilCurto(
			{
				maquinaClasse: p.maquina_classe,
				...(p.horas_uteis_dia !== undefined
					? { horasUteisDia: p.horas_uteis_dia }
					: {}),
				...(p.ganho_mensal !== undefined
					? { ganhoMensal: p.ganho_mensal }
					: {}),
				...(p.markup_pct !== undefined ? { markupPct: p.markup_pct } : {}),
				...(p.regime_fiscal !== undefined
					? { regimeFiscal: p.regime_fiscal }
					: {}),
				...(p.pedido_minimo !== undefined
					? { pedidoMinimo: p.pedido_minimo }
					: {}),
			},
			maquina,
		);

		/* ── 3. o que o aluno corrigiu vence o que assumimos ─────────────────── */
		const corrigidos: string[] = [];
		for (const [campo, valor] of Object.entries(p.overrides ?? {})) {
			if (!(campo in derivado.data)) {
				// Campo não declarado na coleção seria descartado em silêncio na
				// gravação — e o aluno acharia que corrigiu. Melhor recusar aqui.
				throw new Error(`'${campo}' não é um campo do perfil de custo`);
			}
			derivado.data[campo] = valor;
			corrigidos.push(campo);
		}
		// Um campo corrigido deixa de ser "assumido": a tela não deve continuar
		// dizendo "padrão para CO2 100 W" embaixo de um número que a pessoa
		// digitou por cima.
		const assumidos = derivado.assumidos.filter(
			(a) => !corrigidos.includes(a.campo),
		);

		/**
		 * PROVA DE QUE O REGISTRO FECHA. `profileFromCollectionData` é o mesmo
		 * caminho que `quote.price` percorre para precificar — se o que acabamos
		 * de montar não passar por ele, o aluno só descobriria na hora de orçar.
		 * O perfil devolvido aqui não é usado para nada além desta conferência.
		 */
		const perfil = profileFromCollectionData(derivado.data);

		return {
			/** Registro pronto para o POST da coleção `perfis`. */
			data: derivado.data,
			json: JSON.stringify(derivado.data),
			/** O que assumimos, campo a campo, com a origem em português. */
			assumidos,
			assumidos_json: JSON.stringify(assumidos),
			/** Quantos campos o aluno não precisou responder. */
			assumidos_count: assumidos.length,
			maquina: derivado.maquina?.label ?? 'Outra máquina',
			maquina_classe: derivado.maquina?.id ?? CLASSE_OUTRA,
			/** Taxa-hora que este perfil produz — o número que o aluno reconhece. */
			taxa_hora:
				perfil.energiaKw * perfil.precoKwh +
				perfil.gasM3h * perfil.precoGasM3 +
				perfil.consumiveisHora +
				perfil.manutencaoHora +
				perfil.valorMaquina / perfil.vidaUtilH,
			custo_hora_operador: perfil.custoHoraOperador,
		};
	},
};

/**
 * A linha da coleção `maquinas`, quando existe, sobrepõe o lastro em código.
 *
 * Falhar aqui NÃO pode derrubar o cadastro do perfil: a coleção está vazia
 * hoje, pode não existir na definition de uma tool que só copiou o pipeline, e
 * o admin pode ter cadastrado uma linha torta. Em qualquer um desses casos o
 * lastro em código responde — que é exatamente o motivo de ele existir.
 */
async function maquinaDaColecao(
	ctx: Parameters<ToolBlock<PerfilParams>['run']>[0],
	p: PerfilParams,
): Promise<MachineClass | null> {
	if (!machineClassIds().includes(p.maquina_classe)) {
		// Classe que não está no código PRECISA estar na coleção — aí o erro de
		// leitura não pode ser engolido, ou o aluno recebe o perfil de outra
		// máquina achando que é o dele.
		return await lerMaquina(ctx, p, true);
	}
	try {
		return await lerMaquina(ctx, p, false);
	} catch {
		return null;
	}
}

async function lerMaquina(
	ctx: Parameters<ToolBlock<PerfilParams>['run']>[0],
	p: PerfilParams,
	obrigatoria: boolean,
): Promise<MachineClass | null> {
	const {
		loadPublishedToolDefinition,
		resolveCollection,
		toolCollectionRepository: repo,
	} = await loadDeps();
	const doc =
		(ctx.toolDoc as Parameters<typeof resolveCollection>[0] | undefined) ??
		(await loadPublishedToolDefinition(p.tool, ctx.customerId, ctx.authHeader))
			.definition;
	const cfg = resolveCollection(doc, p.maquinas_collection);
	const achados = await repo.list(p.tool, p.maquinas_collection, cfg, {
		// `isStaff: false` porque bloco roda em nome do ALUNO — e a tabela de
		// máquinas é `visibility: 'public'`, então ele a enxerga inteira. Quem
		// depende de ler o rascunho é a rota `/api/quote/profile`, e lá o flag de
		// staff é repassado: sem ele o upvox devolve 401 na definition draft e a
		// coleção some sem ninguém perceber (aconteceu na primeira medição).
		viewer: { customerId: ctx.customerId, isStaff: false },
		filters: { classe_id: { kind: 'eq', value: p.maquina_classe } },
		pageSize: 1,
		page: 1,
	});
	const linha = achados.items[0];
	if (!linha) {
		if (obrigatoria) {
			throw new Error(
				`máquina '${p.maquina_classe}' não está na tabela de máquinas`,
			);
		}
		return null;
	}
	return machineFromCollectionData(linha.data, linha.title);
}
