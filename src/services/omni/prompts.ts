/**
 * Montagem de prompts do OmniResposta. A config do negócio (16 campos, jsonb)
 * vira um bloco PT legível injetado no system prompt do agente ROTEADOR; os
 * especialistas recebem o mesmo bloco + o prompt próprio. Sem dependência de
 * repositórios (funções puras) — o pipeline injeta os dados.
 */

export interface OmniBusinessConfigFields {
	company_description?: string;
	product_categories?: string;
	greeting_message?: string;
	payment_method?: string;
	payment_terms?: string;
	local_pickup_city?: string;
	delivery_policy?: string;
	business_location?: string;
	business_hours?: string;
	issues_invoice?: boolean;
	marketplace_url?: string;
	exchange_policy?: string;
	engraving_included?: boolean;
	accepted_formats?: string;
	human_transfer_priority?: string;
	tone_of_voice?: string;
}

const CONFIG_LABELS: Array<[keyof OmniBusinessConfigFields, string]> = [
	['company_description', 'Sobre a empresa'],
	['product_categories', 'Categorias de produtos'],
	['greeting_message', 'Saudação padrão'],
	['payment_method', 'Formas de pagamento'],
	['payment_terms', 'Condições de pagamento'],
	['local_pickup_city', 'Retirada local'],
	['delivery_policy', 'Política de entrega/frete'],
	['business_location', 'Localização'],
	['business_hours', 'Horário de atendimento'],
	['marketplace_url', 'Loja/marketplace'],
	['exchange_policy', 'Política de trocas'],
	['accepted_formats', 'Formatos de arquivo aceitos'],
	[
		'human_transfer_priority',
		'Quando transferir para humano (regra da empresa)',
	],
	['tone_of_voice', 'Tom de voz'],
];

/** Config do negócio → bloco PT pro system prompt. Campos vazios são omitidos. */
export function renderBusinessConfig(
	config: OmniBusinessConfigFields | null | undefined,
): string {
	if (!config) return '';
	const lines: string[] = [];
	for (const [key, label] of CONFIG_LABELS) {
		const value = config[key];
		if (typeof value === 'string' && value.trim()) {
			lines.push(`- ${label}: ${value.trim()}`);
		}
	}
	if (typeof config.issues_invoice === 'boolean') {
		lines.push(`- Emite nota fiscal: ${config.issues_invoice ? 'sim' : 'não'}`);
	}
	if (typeof config.engraving_included === 'boolean') {
		lines.push(
			`- Gravação inclusa no preço: ${config.engraving_included ? 'sim' : 'não'}`,
		);
	}
	if (lines.length === 0) return '';
	return `## Sobre a empresa\n${lines.join('\n')}`;
}

/**
 * Prompt default do agente ROTEADOR (criado junto com a instância). Mesma
 * semântica do MainRouter do n8n: cumprimenta/resolve o simples, roteia pros
 * especialistas via tools, escala pra humano quando precisa, nunca inventa.
 */
export const DEFAULT_ROUTER_PROMPT = `Você é o atendente virtual da empresa no WhatsApp. Seu papel:
1. Cumprimente e responda diretamente conversas simples (saudações, agradecimentos, dúvidas rápidas cobertas pelas informações da empresa).
2. Para dúvidas específicas, use as ferramentas disponíveis: consulte a base de conhecimento (buscar_conhecimento) antes de responder qualquer coisa factual sobre produtos, preços, prazos ou políticas; acione um agente especialista quando o assunto for da área dele.
3. Se o cliente pedir um atendente humano, estiver irritado, com um problema grave (reclamação formal, reembolso, jurídico) ou você não conseguir resolver, use transferir_para_humano.
4. NUNCA invente preço, prazo, estoque ou política. Se a informação não estiver no contexto nem na base de conhecimento, diga que vai verificar e transfira para um humano.
5. Estilo WhatsApp: respostas curtas (1-4 frases), claras, sem formatação markdown pesada, no tom de voz da empresa. Uma pergunta por vez.
6. Responda SEMPRE em português brasileiro.`;

/** Monta o system prompt final do roteador. */
export function buildRouterSystemPrompt(args: {
	routerPrompt: string;
	config: OmniBusinessConfigFields | null;
	specialists: Array<{ slug: string; name: string; tool_description: string }>;
}): string {
	const parts: string[] = [args.routerPrompt.trim() || DEFAULT_ROUTER_PROMPT];
	const cfg = renderBusinessConfig(args.config);
	if (cfg) parts.push(cfg);
	if (args.specialists.length > 0) {
		const list = args.specialists
			.map(
				(s) =>
					`- ${s.slug} (${s.name}): ${s.tool_description || 'especialista'}`,
			)
			.join('\n');
		parts.push(
			`## Especialistas disponíveis (chame como ferramenta quando o assunto for deles)\n${list}`,
		);
	}
	parts.push(
		'## Data e hora atuais\n' +
			new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
	);
	return parts.join('\n\n');
}

/** System prompt de um especialista (sub-chamada a partir do roteador). */
export function buildSpecialistSystemPrompt(args: {
	specialistPrompt: string;
	name: string;
	config: OmniBusinessConfigFields | null;
}): string {
	const parts: string[] = [
		`Você é "${args.name}", um agente especialista do atendimento WhatsApp da empresa. Responda a instrução recebida do agente roteador com o TEXTO FINAL que deve ser enviado ao cliente (curto, estilo WhatsApp, português brasileiro). Não invente fatos.`,
	];
	if (args.specialistPrompt.trim()) parts.push(args.specialistPrompt.trim());
	const cfg = renderBusinessConfig(args.config);
	if (cfg) parts.push(cfg);
	return parts.join('\n\n');
}
