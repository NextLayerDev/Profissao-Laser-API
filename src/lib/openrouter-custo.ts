/**
 * O QUE AJUDA A MEDIR E A BAIXAR O CUSTO DAS CHAMADAS AO OPENROUTER.
 *
 * Funções puras, fora de `openrouter.ts` de propósito: aquele módulo é o
 * cliente, e os testes o substituem por um dublê inteiro. Aqui não há cliente
 * nenhum, só o que entra no corpo e nos headers da requisição.
 */

/**
 * QUEM GASTOU — para o painel do OpenRouter separar o custo por ferramenta.
 *
 * Todos os sistemas usam a mesma chave, então sem isto o painel só mostra o
 * total. `toolKey` vai no `X-Title` (o "app" do painel) e `tenantId` no campo
 * `user` do corpo. NUNCA o e-mail ou o id do aluno: o tenant basta para achar
 * a escola que gastou, e o OpenRouter não precisa saber quem é a pessoa.
 */
export interface AtribuicaoOpenRouter {
	toolKey?: string;
	tenantId?: string;
}

/** O `X-Title` do OpenRouter: a ferramenta, quando conhecida. */
export function tituloOpenRouter(
	toolKey: string | undefined,
	fallback: string,
): string {
	const empresa = process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser';
	return `${empresa} - ${toolKey?.trim() || fallback}`;
}

/** O campo `user` do corpo (só o tenant), ou nada. */
export function usuarioOpenRouter(
	tenantId: string | undefined,
): { user: string } | Record<string, never> {
	const t = tenantId?.trim();
	return t ? { user: `tenant:${t}` } : {};
}

/**
 * O SYSTEM PROMPT COM PROMPT CACHING, para modelo Claude.
 *
 * A Anthropic só cacheia o que vem marcado com `cache_control` (o OpenRouter
 * repassa o campo); Gemini e DeepSeek cacheiam sozinhos um prefixo estável e
 * não precisam de nada. O system é a parte FIXA da chamada — o que muda de
 * uma chamada para outra (o pedido do aluno, o material) vai na mensagem do
 * usuário, DEPOIS, e é isso que faz o prefixo cacheado servir de novo.
 *
 * Abaixo do mínimo da Anthropic (~1.024 tokens) a marca é ignorada sem erro,
 * então marcar sempre é seguro. Modelo que não é Claude recebe a string de
 * sempre — o corpo da requisição não muda para ele.
 */
export function systemComCache(
	modelId: string,
	system: string,
):
	| string
	| Array<{
			type: 'text';
			text: string;
			cache_control: { type: 'ephemeral' };
	  }> {
	if (!modelId.startsWith('anthropic/')) return system;
	return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}
