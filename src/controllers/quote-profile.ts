import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import {
	CLASSE_OUTRA,
	derivarPerfilCurto,
	GANHO_MENSAL_PADRAO,
	HORAS_UTEIS_PADRAO,
	IMPOSTO_POR_REGIME,
	LABEL_REGIME,
	MACHINE_CLASSES,
	MARKUP_PADRAO_PCT,
	type MachineClass,
	machineFromCollectionData,
	PEDIDO_MINIMO_PADRAO,
	REGIME_PADRAO,
	REGIMES_FISCAIS,
	type RegimeFiscal,
} from '../lib/quote/machines.js';
import {
	profileFromCollectionData,
	taxaHoraMaquina,
} from '../lib/quote/pricing.js';
import { resolveCollection } from '../lib/tool-collections.js';
import { loadPublishedToolDefinition } from '../lib/tool-definitions.js';
import { ToolEngineError } from '../lib/tool-errors.js';
import { toolCollectionRepository } from '../repositories/tool-collection.js';

/**
 * O PERFIL CURTO como endpoint — seis respostas entram, o cadastro inteiro sai.
 *
 * POR QUE UMA ROTA, e não um nó no pipeline do orçamento: o perfil é cadastro,
 * não orçamento. Enfiar `quote.perfil_padrao` no pipeline faria toda cotação
 * pagar por um cálculo que não é dela, e `output` é allow-list — a chave sairia
 * calculada, cobrada e descartada. O precedente é `/api/tools/smart-tema`:
 * quando a coisa não depende de rodar a tool, ela é rota própria.
 *
 * NÃO COBRA e NÃO GRAVA. Devolve o `data` pronto; quem salva é a tela, pelo
 * endpoint genérico de coleção, com a validação e o `visibility:'owner'` de
 * sempre. Uma segunda porta de gravação na coleção do aluno, com regras
 * próprias, é exatamente o tipo de atalho que depois ninguém audita.
 *
 * E, como todo o resto do dinheiro nesta ferramenta: **nenhum número aqui passa
 * por modelo**. A única ida à rede é ler a tabela de máquinas.
 */

interface Body {
	tool?: string;
	maquinas_collection?: string;
	maquina_classe?: string;
	horas_uteis_dia?: number;
	ganho_mensal?: number;
	markup_pct?: number;
	regime_fiscal?: string;
	pedido_minimo?: number;
	overrides?: Record<string, string | number>;
}

/** Catálogo de máquinas para a tela desenhar os cards do passo 1. */
export const listMachineClassesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	return reply.send({
		machines: MACHINE_CLASSES.map((m) => ({
			id: m.id,
			label: m.label,
			laser: m.laser,
			potencia_w: m.potenciaW,
		})),
		outra: CLASSE_OUTRA,
		// O RÓTULO vem daqui, não da tela. Um `sem_nota` renderizado como
		// "sem_nota" foi exatamente o que a revisão encontrou na tela do perfil, e
		// a razão é sempre a mesma: o front inventa o texto quando o back manda só
		// o id. Aqui o back manda os dois, e a regra fiscal fica num lugar só.
		regimes: REGIMES_FISCAIS.map((r) => ({
			id: r,
			label: LABEL_REGIME[r],
			imposto_pct: IMPOSTO_POR_REGIME[r],
		})),
		/** Os padrões das seis perguntas, para a tela abrir já respondida. */
		padroes: {
			horas_uteis_dia: HORAS_UTEIS_PADRAO,
			ganho_mensal: GANHO_MENSAL_PADRAO,
			markup_pct: MARKUP_PADRAO_PCT,
			regime_fiscal: REGIME_PADRAO,
			pedido_minimo: PEDIDO_MINIMO_PADRAO,
		},
	});
};

export const buildQuoteProfileController = async (
	request: FastifyRequest<{ Body: Body }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id ?? request.currentUser?.id;
	if (!customerId)
		return reply.status(401).send({ message: 'não autenticado' });
	// Staff lê a coleção de uma tool ainda em RASCUNHO — é o mesmo `includeDraft`
	// de `loadConfig` (tool-collection.ts). Sem ele, a tabela de máquinas de uma
	// tool draft responde 401 e o perfil sai inteiro do lastro em código, sem que
	// ninguém perceba que a coleção existe. Foi exatamente o que aconteceu aqui.
	const isStaff = isStaffRole(request.currentRole);

	const b = request.body ?? {};
	const tool = b.tool?.trim() || 'central_custos';
	const colecao = b.maquinas_collection?.trim() || 'maquinas';
	const classe = b.maquina_classe?.trim() || CLASSE_OUTRA;

	if (
		b.regime_fiscal &&
		!REGIMES_FISCAIS.includes(b.regime_fiscal as RegimeFiscal)
	) {
		return reply.status(400).send({
			message: `regime fiscal inválido: '${b.regime_fiscal}' (aceito: ${REGIMES_FISCAIS.join(', ')})`,
		});
	}

	try {
		// A tabela de mercado, quando o admin já a cadastrou. Falhar em lê-la NÃO
		// pode derrubar o cadastro do perfil: a coleção está vazia hoje e o lastro
		// em código existe justamente para este caso.
		let maquina: MachineClass | null = null;
		if (classe !== CLASSE_OUTRA) {
			maquina = await maquinaDaColecao(
				tool,
				colecao,
				classe,
				customerId,
				isStaff,
				request,
			);
		}

		const derivado = derivarPerfilCurto(
			{
				maquinaClasse: classe,
				...(b.horas_uteis_dia !== undefined
					? { horasUteisDia: Number(b.horas_uteis_dia) }
					: {}),
				...(b.ganho_mensal !== undefined
					? { ganhoMensal: Number(b.ganho_mensal) }
					: {}),
				...(b.markup_pct !== undefined
					? { markupPct: Number(b.markup_pct) }
					: {}),
				...(b.regime_fiscal
					? { regimeFiscal: b.regime_fiscal as RegimeFiscal }
					: {}),
				...(b.pedido_minimo !== undefined
					? { pedidoMinimo: Number(b.pedido_minimo) }
					: {}),
			},
			maquina,
		);

		// O aluno discordou de um derivado. Campo fora do perfil é recusado aqui em
		// vez de ser descartado em silêncio na gravação — ele acharia que corrigiu.
		const corrigidos: string[] = [];
		for (const [campo, valor] of Object.entries(b.overrides ?? {})) {
			if (!(campo in derivado.data)) {
				return reply
					.status(400)
					.send({ message: `'${campo}' não é um campo do perfil de custo` });
			}
			derivado.data[campo] = valor;
			corrigidos.push(campo);
		}

		// Passar pelo MESMO caminho que `quote.price` percorre é a conferência que
		// impede o aluno de descobrir um perfil torto só na hora de orçar.
		const perfil = profileFromCollectionData(derivado.data);

		return reply.send({
			data: derivado.data,
			assumidos: derivado.assumidos.filter(
				(a) => !corrigidos.includes(a.campo),
			),
			maquina: derivado.maquina?.label ?? 'Outra máquina',
			maquina_classe: derivado.maquina?.id ?? CLASSE_OUTRA,
			// Os dois números que o dono da oficina reconhece e sabe contestar.
			taxa_hora: taxaHoraMaquina(perfil),
			custo_hora_operador: perfil.custoHoraOperador,
		});
	} catch (e) {
		if (e instanceof ToolEngineError) {
			return reply.status(e.status).send({ message: e.message });
		}
		request.log.error({ err: e }, '[quote-profile] falha ao derivar perfil');
		return reply
			.status(500)
			.send({ message: 'não foi possível montar o perfil' });
	}
};

async function maquinaDaColecao(
	tool: string,
	colecao: string,
	classe: string,
	customerId: string,
	isStaff: boolean,
	request: FastifyRequest,
): Promise<MachineClass | null> {
	try {
		const { definition } = await loadPublishedToolDefinition(
			tool,
			customerId,
			request.headers.authorization,
			isStaff,
		);
		const cfg = resolveCollection(definition, colecao);
		const achados = await toolCollectionRepository.list(tool, colecao, cfg, {
			viewer: { customerId, isStaff },
			filters: { classe_id: { kind: 'eq', value: classe } },
			pageSize: 1,
			page: 1,
		});
		const linha = achados.items[0];
		return linha ? machineFromCollectionData(linha.data, linha.title) : null;
	} catch (e) {
		request.log.warn(
			{ err: e, tool, colecao, classe },
			'[quote-profile] tabela de máquinas indisponível — usando o lastro em código',
		);
		return null;
	}
}
