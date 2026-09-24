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
	/**
	 * Rótulo humano de cada opção: `{ co2_100: 'CO2 100 W (1300×900)' }`.
	 *
	 * O valor gravado continua sendo o id — é ele que o motor lê, e trocar id por
	 * rótulo quebraria todo registro existente. Isto é só a tela. Sem este campo,
	 * a pergunta mais importante do perfil de custo ("Que máquina você tem?")
	 * aparecia para o dono da marcenaria como `fibra_20 · co2_100 · psico_9 ·
	 * simples_servicos` — id de banco de dados oferecido como resposta.
	 *
	 * O back IGNORA, como `hint` e `group`: opção fora de `options` continua
	 * sendo recusada na validação, tenha rótulo ou não.
	 */
	optionLabels?: Record<string, string>;
	required?: boolean;
	facet?: CollectionFacet;
	/** Unidade só de exibição (mm, W, bar). O valor guardado é o número puro. */
	unit?: string;
	min?: number;
	max?: number;
	placeholder?: string;
	/**
	 * Linha de ajuda embaixo do campo, e `group` é a seção do formulário. O back
	 * IGNORA os dois — são enfeite de tela, e já é assim que a tela os lê
	 * (`collection-form.ts` no front). Estão declarados aqui porque a declaração
	 * de campo é gerada em código (`profileFieldsSpec`, `machineFieldsSpec`) e um
	 * campo sem tipo para o `hint` obrigava a montar a spec como `unknown` —
	 * exatamente o buraco por onde um nome de campo errado passa em silêncio.
	 */
	hint?: string;
	group?: string;
	/**
	 * Aplicabilidade condicional: `{ operacao: 'corte' }` faz o campo só existir
	 * (e só ser exigido) quando `data.operacao === 'corte'`. Aceita array para
	 * "um destes". Espelha o que `parameter-field-rules.ts` já faz na tela de
	 * Parâmetros, mas declarado como dado em vez de hardcoded.
	 */
	showIf?: Record<string, string | number | boolean | (string | number)[]>;
}

/**
 * Perguntas sobre UM registro, respondidas a partir do próprio registro.
 *
 * Declarar isto é o que transforma um registro parado numa conversa: hoje o
 * dossiê da Central de Inteligência, amanhã o que for. Nenhum código sabe o que
 * é dossiê — a coleção diz quais campos viram contexto e o resto é genérico.
 *
 * `maxPerguntas` existe porque cada pergunta é uma chamada de modelo que NÃO é
 * cobrada de novo: o aluno pagou pela análise, e a conversa vem inclusa. Sem
 * teto, um registro vira chat ilimitado a custo nosso.
 */
export interface CollectionChatConfig {
	enabled: boolean;
	/**
	 * Campos de `data` que viram contexto, NA ORDEM DE IMPORTÂNCIA: o teto de
	 * caracteres corta o fim, então o resumo vem antes do dossiê cru.
	 */
	contextoDe?: string[];
	maxPerguntas?: number;
	/** Id do catálogo de texto. Ausente = o padrão de quem chama. */
	modelo?: string;
	/** Persona (o "quem é você"). As regras anti-invenção NÃO moram aqui. */
	papel?: string;
}

/**
 * Quem enxerga um registro. `public` = qualquer aluno logado; `owner` = só quem
 * criou (e a equipe); `staff` = só a equipe, nem o dono (o repositório filtra
 * `.neq('visibility','staff')` para todo não-staff).
 */
export type CollectionVisibility = 'public' | 'owner' | 'staff';

export interface CollectionConfig {
	label?: string;
	fields: CollectionFieldSpec[];
	/**
	 * Visibilidade IMPOSTA aos registros desta coleção.
	 *
	 * O seed da Central de Custos já declarava isto (`perfis`, `links`, `leads`
	 * são todos `'owner'`) — mas a declaração era só documentação: o tipo não
	 * conhecia o campo e o back nunca a lia, então quem decidia a visibilidade
	 * era o CLIENTE, no corpo do POST. Numa coleção de perfil de custo (salário,
	 * preço de compra, margem) ou de identidade de marca, uma tela que esquecesse
	 * de mandar `visibility:'owner'` criava o registro do aluno PÚBLICO, sem erro
	 * e sem log. Ver `resolveVisibility`.
	 */
	visibility?: CollectionVisibility;
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
	/** Conversa sobre um registro (ver `CollectionChatConfig`). */
	chat?: CollectionChatConfig;
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

/* ────────────────────── Conversa sobre um registro ────────────────────── */

/** Uma pergunta já feita, como fica gravada em `data.perguntas`. */
export interface PerguntaRegistrada {
	p: string;
	r: string;
	em: string;
}

/** Perguntas inclusas quando a coleção não diz outro número. */
export const DEFAULT_MAX_PERGUNTAS = 8;

/**
 * Teto do contexto mandado ao modelo. Um dossiê completo passa de 50 KB, e
 * mandar tudo custa token em TODA pergunta — a conversa é inclusa no preço da
 * análise, então o custo dela é nosso.
 */
const MAX_CONTEXTO_CHARS = 24_000;

/**
 * Teto do histórico gravado, em caracteres do JSON serializado.
 *
 * Vale menos que o teto do campo (`textarea` = 20 000 em `fieldSchema`) e a
 * folga é de propósito. O histórico mora DENTRO do registro, e o registro é
 * revalidado inteiro a cada PATCH quando a coleção é `ownerEditable` — deixar
 * ele passar do teto do campo não perderia a conversa, travaria a EDIÇÃO do
 * dossiê inteiro, com um erro de validação em inglês sobre um campo que
 * ninguém tentou mexer.
 */
const MAX_PERGUNTAS_CHARS = 16_000;

/**
 * Corta os turnos MAIS ANTIGOS até o histórico caber no campo.
 *
 * Perder o começo é o mal menor: só os últimos turnos voltam ao modelo
 * (`MAX_TURNOS_HISTORICO`), e o contador que sustenta o teto de perguntas mora
 * em outro campo justamente porque este aqui encolhe.
 */
export function podarPerguntas(
	lista: PerguntaRegistrada[],
	maxChars: number = MAX_PERGUNTAS_CHARS,
): PerguntaRegistrada[] {
	const podada = [...lista];
	while (podada.length > 1 && JSON.stringify(podada).length > maxChars) {
		podada.shift();
	}
	// Um único turno gigante ainda estouraria o campo: a resposta é cortada, não
	// descartada — o aluno acabou de ler ela na tela.
	if (podada.length === 1 && JSON.stringify(podada).length > maxChars) {
		const unico = podada[0];
		if (unico) {
			const sobra = maxChars - JSON.stringify([{ ...unico, r: '' }]).length;
			podada[0] = { ...unico, r: unico.r.slice(0, Math.max(0, sobra - 20)) };
		}
	}
	return podada;
}

/**
 * O histórico gravado no registro.
 *
 * Aceita string (o formato do contrato: JSON serializado dentro de um campo
 * `textarea`) e array já desserializado — o jsonb devolve o que foi escrito, e
 * um registro antigo gravado de outro jeito não pode derrubar a pergunta. Lixo
 * vira lista vazia: perder o histórico é ruim, recusar a pergunta é pior.
 */
export function lerPerguntasChat(
	data: Record<string, unknown>,
): PerguntaRegistrada[] {
	const bruto = data.perguntas;
	let lista: unknown = bruto;

	if (typeof bruto === 'string') {
		if (!bruto.trim()) return [];
		try {
			lista = JSON.parse(bruto);
		} catch {
			return [];
		}
	}

	if (!Array.isArray(lista)) return [];
	return lista
		.filter(
			(item): item is Record<string, unknown> =>
				!!item && typeof item === 'object',
		)
		.map((item) => ({
			p: String(item.p ?? ''),
			r: String(item.r ?? ''),
			em: String(item.em ?? ''),
		}))
		.filter((item) => item.p !== '');
}

/**
 * Monta o contexto que o modelo vai ler, a partir dos campos declarados em
 * `chat.contextoDe`.
 *
 * Cada campo entra rotulado: sem o rótulo o modelo recebe dois blocos de texto
 * colados e não sabe qual é o resumo e qual é o dossiê cru. O corte é do FIM
 * para o começo (por isso a ordem de `contextoDe` importa) e nunca no meio de
 * um rótulo — um cabeçalho pela metade confunde mais do que o campo ausente.
 *
 * Sem `contextoDe`, cai em todos os campos declarados: coleção que liga o chat
 * sem escolher os campos ainda responde, só que com o registro inteiro.
 */
export function montarContextoChat(
	config: CollectionConfig,
	data: Record<string, unknown>,
	maxChars: number = MAX_CONTEXTO_CHARS,
): string {
	/**
	 * O histórico NUNCA entra no contexto, nem no fallback.
	 *
	 * Ele já volta ao modelo como turnos user/assistant. Se entrasse aqui também,
	 * a resposta anterior viraria "material" — ou seja, fonte autorizada da
	 * próxima —, e o modelo passaria a citar o que ele mesmo escreveu como se
	 * estivesse no dossiê. Numa coleção que liga o chat sem escolher os campos,
	 * isso aconteceria sozinho.
	 */
	const nomes = (
		config.chat?.contextoDe?.length
			? config.chat.contextoDe
			: config.fields.map((f) => f.name)
	).filter((n) => n !== 'perguntas' && n !== 'perguntas_feitas');

	const partes: string[] = [];
	let restante = maxChars;

	for (const nome of nomes) {
		const bruto = data[nome];
		if (bruto === undefined || bruto === null || bruto === '') continue;

		const texto = typeof bruto === 'string' ? bruto : JSON.stringify(bruto);
		if (!texto.trim()) continue;

		const spec = config.fields.find((f) => f.name === nome);
		const cabecalho = `## ${spec?.label ?? nome}\n`;
		// O `\n\n` que o `join` vai colocar também ocupa espaço.
		const disponivel = restante - (partes.length ? 2 : 0);
		// Menos que isto entraria só o rótulo, sem conteúdo nenhum embaixo.
		if (disponivel <= cabecalho.length + 1) break;

		const bloco = cabecalho + texto;
		if (bloco.length <= disponivel) {
			partes.push(bloco);
			restante = disponivel - bloco.length;
			continue;
		}

		partes.push(
			`${cabecalho}${texto.slice(0, disponivel - cabecalho.length - 1)}…`,
		);
		break;
	}

	return partes.join('\n\n');
}

/** Quanto mais alto, mais fechado. Usado para escolher a opção mais restritiva. */
const GRAU_DE_FECHAMENTO: Record<CollectionVisibility, number> = {
	public: 0,
	owner: 1,
	staff: 2,
};

/**
 * Visibilidade de um registro: o que a COLEÇÃO declara e o que quem escreve TEM
 * DIREITO de pedir.
 *
 * `'staff'` é a que faltava, e a falta era um vazamento: `scoped()` no
 * repositório já filtra `visibility='staff'` para quem não é staff na LEITURA,
 * mas a escrita não deixava ninguém criar um registro assim — todo registro
 * nascia `public` ou `owner`. Enquanto as coleções guardavam catálogo (materiais,
 * receitas), isso não incomodava. Passou a incomodar quando uma coleção virou
 * CONFIGURAÇÃO INTERNA: os system prompts dos agentes de pesquisa, que são o
 * produto. Sem isto, `GET /api/tools/:key/c/agentes` entregaria os prompts para
 * qualquer aluno logado.
 *
 * O `declarada` fecha o furo do outro lado: até aqui quem escolhia a
 * visibilidade era SÓ o corpo do POST, então uma tela que esquecesse de mandar
 * `visibility:'owner'` criava o perfil de custo (ou a marca) do aluno em
 * `public` — sem erro e sem log, num dado que é salário, preço de compra e
 * margem. Agora, para ALUNO, vale sempre a opção MAIS FECHADA entre o que a
 * coleção declara e o que ele pediu: esquecer o campo passa a ser seguro, e
 * quem quiser mais privacidade que o declarado continua conseguindo.
 *
 * Para STAFF nada do que já funcionava mudou: um pedido explícito
 * (`public`/`owner`/`staff`) é obedecido como sempre foi — é assim que o roster
 * de agentes nasce `'staff'`. O que muda é só o SILÊNCIO: sem pedido, staff
 * herda o que a coleção declara em vez de cair em `public` — porque um registro
 * de staff numa coleção declarada `'owner'` (um lead, um link de orçamento)
 * nascer público é o mesmo bug, só que com outro autor.
 *
 * Aluno nunca recebe `'staff'`, nem que a coleção declare: o repositório
 * esconde `'staff'` até do próprio dono, e o aluno perderia o acesso ao registro
 * que ele acabou de criar. Nesse caso o teto dele é `'owner'`.
 *
 * Mora aqui, e não no controller, porque é decisão PURA — e porque importar o
 * controller num teste arrasta o cliente Supabase junto.
 */
export function resolveVisibility(
	pedido: unknown,
	isStaff: boolean,
	declarada?: CollectionVisibility,
): CollectionVisibility {
	if (isStaff) {
		if (pedido === 'staff') return 'staff';
		if (pedido === 'owner') return 'owner';
		if (pedido === 'public') return 'public';
		return declarada ?? 'public';
	}

	const pedidaPeloAluno: CollectionVisibility =
		pedido === 'owner' ? 'owner' : 'public';
	const daColecao: CollectionVisibility =
		declarada === 'staff' ? 'owner' : (declarada ?? 'public');

	return GRAU_DE_FECHAMENTO[daColecao] >= GRAU_DE_FECHAMENTO[pedidaPeloAluno]
		? daColecao
		: pedidaPeloAluno;
}
