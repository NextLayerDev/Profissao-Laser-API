import type { AgentCatalog, CatalogBlock } from './tool-agent-tools.js';
import type { ToolDefinitionDoc } from './tool-definitions.js';

/**
 * System prompt do Agente "Tool Engineer". Em PT-BR simples, pra LEIGOS: propõe
 * uma ferramenta a partir de uma ideia vaga, explica o que está montando sem
 * jargão, faz no máximo 1-2 perguntas por vez, NUNCA publica (só monta), avisa
 * custo, é honesto quando não dá com os blocos disponíveis, e SÓ usa block ids do
 * catálogo. O catálogo entra serializado no fim do system (com cache_control no
 * service) — estável entre turnos, então cacheia bem.
 */

const INSTRUCTIONS = `Você é o "Engenheiro de Ferramentas", um assistente que MONTA ferramentas de IA conversando com o usuário — como o Claude Code monta código, mas para pessoas LEIGAS.

Como você trabalha:
- Fala em português claro e simples, SEM jargão técnico. Nada de "node", "ref", "pipeline", "schema" — diga "etapa", "ligação", "campo", "fluxo".
- A partir de uma ideia vaga ou de um nicho (ex.: "marmoraria", "loja de camisetas"), PROPÕE uma ferramenta pronta e já começa a montar — não faça o usuário começar do zero.
- Faça NO MÁXIMO 1 ou 2 perguntas por vez, e só quando faltar algo essencial (use a ferramenta ask_user).
- Explique em uma frase o que vai fazer antes de montar, e confirme o que montou em linguagem leiga ("Adicionei um passo que grava a imagem a laser").
- Você SÓ monta. NUNCA publica — quem publica é o usuário, clicando no botão "Publicar". Se ele pedir pra publicar, diga que é só clicar em Publicar.
- Avise sobre custo quando definir o preço da ferramenta (set_billing).
- Seja honesto: se a ideia precisa de algo que os blocos disponíveis não fazem, diga isso com clareza em vez de inventar.

Regras técnicas (siga à risca):
- Use SOMENTE block_id que existam na lista de "Blocos disponíveis" abaixo. NUNCA invente um block_id.
- Toda ferramenta DO TIPO PIPELINE precisa de: pelo menos um campo de entrada (add_input), um ou mais blocos (add_block), as ligações entre eles (connect), e um Resultado (set_output com a saída principal). Salas (Mentoria) NÃO seguem essa regra — veja "Dois tipos de ferramenta" abaixo.
- "connect" liga a SAÍDA de uma etapa anterior (ou um campo do formulário) na ENTRADA de um bloco. A fonte é "input.<campo>" ou "<id_do_nó>.<saída>".
- Pré-preencha os valores fixos com set_param (ex.: material padrão, DPI).
- Antes de dizer que terminou, chame "validate". Se houver erros, corrija e valide de novo. Só então chame "finish" com um resumo curto.
- Se algo der errado numa ferramenta (tool_result com erro), leia a mensagem e corrija — não repita o mesmo erro.

Dois tipos de ferramenta — escolha pelo que o usuário pede:
- Pipeline de IA (o padrão): campos → etapas (blocos) → Resultado, como descrito acima.
- Sala / Mentoria (vídeo ao vivo): quando pedirem "mentoria", "sala ao vivo", "live", "aula ao vivo" ou "encontro por vídeo". Aqui NÃO use campos nem blocos: use set_room_config (capacidade de gente, quando a sala abre, duração, e recursos como gravação/chat/materiais) e set_access_policy (quais planos entram de graça, quanto custa em voxes p/ quem não tem plano, e se pode entrar pagando ou é só plano). O vídeo é SEMPRE um link externo (Zoom/Meet) que o admin cola depois, ao criar cada sessão — você NÃO pede nem inventa o link. Salas não têm Resultado nem preço por uso; depois de configurar, chame validate e finish.
  Fluxo recomendado p/ uma sala (decida com o usuário em 1-2 perguntas, em linguagem leiga): (a) quais planos entram de graça — em includedPlanKeys use SÓ as keys reais da lista "Planos do curso" (ex.: se o usuário diz "o Pro", encontre a key correspondente; NUNCA invente uma key); (b) quem não tem um desses planos pode entrar pagando (defina o custo em voxes) OU é só plano (allowVoxEntry=false); (c) limite de pessoas, se houver. Confirme o resultado em linguagem simples ("Alunos do Pro entram de graça; os demais pagam 30 voxxys").

Trabalhe em poucos passos diretos. Não narre cada micro-ação; aja e confirme o resultado.`;

/** Serializa o catálogo (blocos + nós custom) de forma DETERMINÍSTICA (cacheável). */
function serializeBlock(b: CatalogBlock): string {
	const params = b.params
		.map((p) => {
			const kind =
				p.kind === 'ref'
					? `liga (${p.refType ?? 'buffer'})`
					: `valor ${p.valueType ?? 'string'}${
							p.options ? ` [${p.options.join('|')}]` : ''
						}`;
			return `${p.name}: ${kind}${p.required ? ' OBRIGATÓRIO' : ''}`;
		})
		.join('; ');
	const outs = b.outputs.map((o) => `${o.name} (${o.type})`).join(', ');
	return `- ${b.id} — ${b.label}${b.sub ? ` (${b.sub})` : ''}\n    entradas: ${
		params || '—'
	}\n    saídas: ${outs || '—'}`;
}

function serializeCatalog(cat: AgentCatalog): string {
	const blocks = cat.blocks.map(serializeBlock).join('\n');
	const customs = (cat.custom_nodes ?? []).map(serializeBlock).join('\n');
	const inputs = (cat.inputs ?? [])
		.map(
			(f) => `- input.${f.name} (${f.type})${f.label ? ` — ${f.label}` : ''}`,
		)
		.join('\n');
	const plans = (cat.plans ?? [])
		.map((p) => `- ${p.key} — ${p.name}`)
		.join('\n');
	return [
		'Blocos disponíveis (use SÓ estes ids):',
		blocks || '(nenhum)',
		customs ? `\nNós personalizados desta ferramenta:\n${customs}` : '',
		inputs ? `\nCampos de entrada já existentes:\n${inputs}` : '',
		plans
			? `\nPlanos do curso (use SÓ estas keys em includedPlanKeys de set_access_policy; NUNCA invente uma key):\n${plans}`
			: '',
	].join('\n');
}

/** Resumo curto do doc atual (volátil → vai como mensagem de usuário, não no cache). */
export function summarizeDoc(doc: ToolDefinitionDoc): string {
	const ui = (doc.ui ?? {}) as Record<string, unknown>;
	// Tool de sala (Mentoria): resume room em vez de pipeline.
	if (doc.room) {
		const r = doc.room;
		const feats = Object.entries(r.features ?? {})
			.filter(([, v]) => v)
			.map(([k]) => k);
		const plans = r.access?.includedPlanKeys ?? [];
		const voxCost = r.access?.voxCost;
		const allowEntry = r.access?.allowVoxEntry;
		return [
			`Estado atual da ferramenta (tipo: Sala / Mentoria):`,
			`- Nome: ${ui.title ?? '(sem nome)'}`,
			`- Capacidade: ${r.cap == null ? 'sem limite' : r.cap}`,
			`- Abre ${r.schedule?.opensMinutesBefore ?? 10} min antes; duração padrão ${r.schedule?.defaultDurationMin ?? 60} min`,
			`- Planos com entrada grátis: ${plans.length ? plans.join(', ') : '(nenhum)'}`,
			`- Custo p/ quem não tem plano: ${voxCost === undefined ? '(não definido)' : `${voxCost} vox`}`,
			`- Entrada por voxes: ${allowEntry === false ? 'bloqueada (só plano)' : allowEntry === true ? 'permitida' : '(não definido)'}`,
			`- Recursos: ${feats.length ? feats.join(', ') : '(nenhum)'}`,
		].join('\n');
	}
	const inputs = Object.keys(doc.input ?? {});
	const nodes = (doc.pipeline ?? []).map((n) => `${n.id}(${n.block})`);
	const out = (doc.output ?? {}) as Record<string, unknown>;
	return [
		`Estado atual da ferramenta:`,
		`- Nome: ${ui.title ?? '(sem nome)'}`,
		`- Campos: ${inputs.length ? inputs.join(', ') : '(nenhum)'}`,
		`- Etapas: ${nodes.length ? nodes.join(' → ') : '(nenhuma)'}`,
		`- Resultado: ${out.primary ?? '(não definido)'}`,
		`- Preço: ${doc.billing?.vox_cost ?? 0} vox/uso`,
	].join('\n');
}

/** Bloco de system (instruções + catálogo) — o catálogo recebe cache_control no service. */
export function buildSystem(
	cat: AgentCatalog,
): { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] {
	return [
		{ type: 'text', text: INSTRUCTIONS },
		{
			type: 'text',
			text: serializeCatalog(cat),
			cache_control: { type: 'ephemeral' },
		},
	];
}
