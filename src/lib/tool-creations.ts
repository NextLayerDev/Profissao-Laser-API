import type { Creation, ToolDefinitionDoc } from './tool-definitions.js';
import { ToolEngineError } from './tool-errors.js';

/**
 * Resolve o "Tipo de Criação" (Passo 1) escolhido pelo cliente a partir do
 * campo multipart `creation_id`, contra a allowlist `definition.creations`.
 *
 * - Tool sem `creations` (legado) → devolve `undefined` em ambos (cai em
 *   `image_width/height` legado ou saída nativa do modelo).
 * - Tool com `creations` + `creation_id` válido e ativo → devolve `{width,height}`.
 * - Tool com `creations` mas sem `creation_id` → 400 "Escolha um tipo de criação."
 *   (antes do billing — não cobra).
 * - `creation_id` inexistente ou `active:false` → 400 "Tipo de criação inválido."
 *
 * Exportado puro (sem deps de controller) pra ser testado isoladamente.
 */
export function resolveCreation(
	doc: Pick<ToolDefinitionDoc, 'creations'>,
	creationId: string | undefined,
): { width?: number; height?: number } {
	const creations = doc.creations ?? [];
	if (creations.length === 0) return { width: undefined, height: undefined };
	if (!creationId) {
		throw new ToolEngineError(400, 'Escolha um tipo de criação.');
	}
	const c = creations.find(
		(x: Creation) => x.id === creationId && x.active !== false,
	);
	if (!c) {
		throw new ToolEngineError(400, 'Tipo de criação inválido.');
	}
	return { width: c.width, height: c.height };
}

/**
 * Valida `variation_count` (Passo 3, campo multipart string) contra o allowlist
 * `definition.return_variations`.
 *
 * ┌─ O DEFAULT É 1 PORQUE O DEFAULT DO UPVOX É 1 ───────────────────────────┐
 * │ Era `allowed[0]`, e isso era uma mina: o `/invoke` do upvox cobra       │
 * │ `vox_cost × (variation_count ?? 1)` — quando o cliente NÃO manda o      │
 * │ campo, ele paga por UMA. Com `return_variations: [2,4]` (a Fábrica      │
 * │ deixa salvar; `return-variations-control.tsx` só impede esvaziar), o    │
 * │ mesmo cliente sem o campo pagava 1 e o motor resolvia 2 → a             │
 * │ reconciliação recusava 100% dos runs, e recarregar a página não         │
 * │ resolveria nada.                                                        │
 * │                                                                          │
 * │ Os dois lados agora derivam o mesmo número da mesma ausência.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Lança `ToolEngineError(400)` se vier valor fora do permitido.
 */
export function resolveVariationCount(
	raw: string | undefined,
	allowed: number[],
): number {
	// Espelha `variation_count ?? 1` do `/invoke` (api-upvox tools/controller.ts).
	const def = 1;
	if (!raw) return def;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || !allowed.includes(n)) {
		throw new ToolEngineError(400, 'Quantidade de variações inválida.');
	}
	return n;
}

/** Espelha o arredondamento do ledger do upvox (`service.ts`: 2 casas). */
const round2 = (n: number): number =>
	Math.round((n + Number.EPSILON) * 100) / 100;

/** O que a invocação do upvox diz que este run já pagou. */
export interface PagamentoDoRun {
	/** `voxes_spent` da invocação — já é `vox_cost × N` decidido no `/invoke`. */
	voxesSpent: number;
	/** `quota_consumed` da invocação (cota grátis do plano). */
	quotaConsumed: number;
	/**
	 * Preço unitário AUTORITATIVO da tool: a coluna `vox_cost` da tabela `tools`
	 * do upvox (lida via `/v1/me/entitlements`), que é a mesma que
	 * `authorizeAndCharge` usou para debitar. `undefined` = não sabemos.
	 */
	voxCost: number | undefined;
}

/**
 * QUANTAS VARIAÇÕES ESTE RUN JÁ PAGOU — ou `null` quando não dá para saber.
 *
 * ┌─ O FURO QUE ISTO FECHA ─────────────────────────────────────────────────┐
 * │ O `/invoke` (upvox) debita `vox_cost × variation_count` e devolve um id. │
 * │ O run (`POST /api/tool-run/:key`) validava `variation_count` SÓ contra   │
 * │ `definition.return_variations` — nunca contra o que foi pago. Bastava    │
 * │ pedir 1 no `/invoke` e 4 no run: o motor aceitava, gerava as quatro      │
 * │ imagens e liquidava a invocação de uma. Medido ao vivo nos Prompts       │
 * │ Mágicos (publicado): US$ 1,20 de fornecedor por clique, repetível.       │
 * │                                                                          │
 * │ A conta que fecha o furo já estava toda na mesa — `voxes_spent` vinha na │
 * │ invocação e era jogado fora pelo gate.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * DEVOLVER `null` É A REGRA DE OURO EM AÇÃO: um falso positivo aqui vira 403
 * em aluno pagante, o que é pior que a fraude. Então só afirmamos um número
 * quando a aritmética fecha sem ambiguidade, e nos três casos abaixo
 * preferimos não saber a chutar:
 *
 *  - **cota grátis do plano** (`quota_consumed > 0`): o upvox cobra 1 unidade
 *    de cota por `/invoke` INDEPENDENTE de N, de propósito (ver o comentário
 *    de `authorizeAndCharge`). Não há número de variações embutido para ler;
 *    recusar aqui quebraria quem legitimamente escolheu 4 na tela.
 *  - **`voxes_spent === 0`** sem cota: conta `is_test_unlimited` (invocação
 *    0/0) ou tool de custo zero. Nada foi pago, nada há para reconciliar.
 *  - **o valor pago não é múltiplo do preço atual**: o admin mexeu no
 *    `vox_cost` entre o `/invoke` e o run. É deriva de preço, não fraude —
 *    e a diferença de um centavo não pode custar o trabalho do aluno.
 *
 * Fora esses casos o número é exato: comparamos em CENTAVOS contra o mesmo
 * `round2` do upvox, então nenhum preço quebrado (0,3 · 0,015 · 0,07) escorrega.
 */
export function variacoesPagas({
	voxesSpent,
	quotaConsumed,
	voxCost,
}: PagamentoDoRun): number | null {
	if (quotaConsumed > 0) return null;
	if (!Number.isFinite(voxesSpent) || voxesSpent <= 0) return null;
	if (!voxCost || !Number.isFinite(voxCost) || voxCost <= 0) return null;

	const n = Math.round(voxesSpent / voxCost);
	if (n < 1) return null;
	// Em centavos: `round2(vox_cost × n)` é literalmente o que o upvox debitou.
	const cents = (v: number) => Math.round(v * 100);
	if (cents(round2(voxCost * n)) !== cents(voxesSpent)) return null;
	return n;
}

/**
 * QUANTAS VARIAÇÕES ESTE RUN VAI ENTREGAR: nunca mais do que foi pago.
 *
 * ┌─ POR QUE ISTO NÃO É UM 409 ─────────────────────────────────────────────┐
 * │ A primeira versão do conserto recusava o run (409 + estorno) quando o    │
 * │ pedido passava do pago. Fechava a fraude — e criou a falha do outro      │
 * │ lado: um cliente REAL, com a aba aberta desde antes do deploy, mandou    │
 * │ `/invoke` de 1 e run de 2 e tomou 409 na cara. Toda deriva entre as duas │
 * │ chamadas (bundle velho, segunda aba, retry, um `return_variations` que   │
 * │ não começa em 1) virava erro num run legítimo e já cobrado.              │
 * │                                                                          │
 * │ Entregar o que foi pago não tem esse lado ruim, e fecha a fraude do      │
 * │ mesmo jeito: quem paga 1 e pede 4 recebe 1 — exatamente o negócio que    │
 * │ ele contratou. A recusa protegia o caixa; a redução protege o caixa E o  │
 * │ aluno. A regra de ouro ("nunca transformar um run legítimo em erro")     │
 * │ decide o empate.                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `pagas === null` (indeterminado: cota do plano, conta ilimitada, upvox fora
 * do ar, preço mexido no meio) devolve o pedido INTACTO — "não sei" nunca
 * reduz entrega. Ver `variacoesPagas`.
 *
 * O teto cai para o MAIOR valor do allowlist que ainda cabe no que foi pago
 * (e nunca abaixo de 1): reduzir para um número fora de `return_variations`
 * mandaria o motor entregar uma quantidade que a tool declara não oferecer.
 */
export function variacoesAEntregar(
	pedido: number,
	pagas: number | null,
	allowed: readonly number[],
): number {
	if (pagas === null || pedido <= pagas) return pedido;
	const cabe = allowed.filter((n) => n >= 1 && n <= pagas);
	return cabe.length > 0 ? Math.max(...cabe) : 1;
}

/**
 * QUANTAS UNIDADES ESTA INVOCAÇÃO COMPROU.
 *
 * Desde que o upvox passou a GUARDAR o número (`tool_invocations.units`), a
 * pergunta tem resposta direta e a inferência vira caminho legado.
 *
 * A diferença não é de precisão, é de natureza: `variacoesPagas` reconstrói o
 * número dividindo `voxes_spent / vox_cost` — arqueologia sobre um dado que
 * ninguém tinha guardado — e por isso devolve "não sei" sempre que a divisão
 * não fecha (cota do plano, conta ilimitada, preço mexido no meio). Nenhum
 * desses casos é de quantidade desconhecível; são casos em que a conta não
 * fecha. Com o número guardado, some a categoria inteira do "não sei".
 *
 * Invocação anterior à coluna cai no caminho antigo, com o comportamento
 * leniente preservado inteiro — inclusive o `null`.
 */
export function unidadesDaInvocacao(
	inv: PagamentoDoRun & { units?: number | null },
): number | null {
	if (typeof inv.units === 'number' && inv.units >= 1) return inv.units;
	return variacoesPagas(inv);
}
