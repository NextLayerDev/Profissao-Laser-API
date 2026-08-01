/**
 * Chamadas MÁQUINA-A-MÁQUINA ao upvox autenticadas por SEGREDO COMPARTILHADO
 * (`x-internal-secret`), sem nenhuma identidade de usuário na requisição.
 *
 * Existe por causa do LINK PÚBLICO DE ORÇAMENTO: quem dispara o trabalho é um
 * visitante SEM CONTA, mas quem paga é o profissional DONO DO LINK — que não
 * está na requisição e portanto não tem Bearer para repassar. `upvox-tools.ts`
 * (o caminho normal) depende justamente desse Bearer; aqui ele não existe e
 * nunca vai existir.
 *
 * O outro lado é `POST /v1/internal/tool-charge` (api-upvox), que só é
 * REGISTRADO quando há segredo com 32+ caracteres e compara em tempo constante.
 */

/**
 * ARMADILHA DE DEPLOY: `EXTERNAL_API_URL` costuma apontar para o GATEWAY, que
 * sanitiza headers de identidade (`x-user-*`) e pode não repassar
 * `x-internal-secret`. Por isso a rota interna tem URL própria, com fallback
 * para a de sempre — em ambiente onde o gateway repassa o header, funciona sem
 * configurar nada; onde não repassa, aponte `UPVOX_INTERNAL_URL` direto no
 * upvox (rede interna), que é o desenho correto para tráfego server-to-server.
 */
function baseUrl(): string {
	return (
		process.env.UPVOX_INTERNAL_URL ?? (process.env.EXTERNAL_API_URL as string)
	);
}

export interface ToolChargeInput {
	customerId: string;
	courseSlug: string;
	toolKey: string;
	idempotencyKey: string;
}

export interface ToolChargeOk {
	ok: true;
	invocationId: string;
	voxesSpent: number;
	balance: number;
	/** `true` = a chave de idempotência já tinha sido cobrada (duplo-clique). */
	replayed: boolean;
}

/**
 * `semSaldo` distingue "o dono não pode pagar" (402/403 — assinatura inativa,
 * saldo insuficiente, cota estourada) de "deu ruim aqui" (rede, 500, segredo
 * errado). A DIFERENÇA NÃO VAI PARA O VISITANTE — ele recebe a mesma mensagem
 * neutra nos dois casos — mas decide se mandamos e-mail ao dono.
 */
export interface ToolChargeErro {
	ok: false;
	semSaldo: boolean;
	status: number;
	detalhe: string;
}

export type ToolChargeResult = ToolChargeOk | ToolChargeErro;

/**
 * Guarda explícita em vez de `if (!r.ok)`: o `tsconfig` deste repo não liga
 * `strict`, e sem `strictNullChecks` o TypeScript não estreita união
 * discriminada por booleano literal.
 */
export function cobrancaFalhou(r: ToolChargeResult): r is ToolChargeErro {
	return r.ok !== true;
}

/**
 * Debita + liquida os voxxys do DONO, atômico, delegando ao `withToolBilling`
 * que já existe no upvox. Zero lógica de billing nova deste lado: o único
 * cálculo que este arquivo faz é traduzir status HTTP em decisão de produto.
 */
export async function chargeToolOwner(
	input: ToolChargeInput,
): Promise<ToolChargeResult> {
	const secret = process.env.INTERNAL_API_SECRET;
	if (!secret || secret.length < 32) {
		// Falha FECHADO: sem segredo não há como cobrar, e rodar o orçamento de
		// graça sairia do bolso da casa em cada visitante do mundo.
		return {
			ok: false,
			semSaldo: false,
			status: 503,
			detalhe: 'INTERNAL_API_SECRET ausente ou curto demais',
		};
	}

	let res: Response;
	try {
		res = await fetch(`${baseUrl()}/v1/internal/tool-charge`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-internal-secret': secret,
			},
			body: JSON.stringify({
				customer_id: input.customerId,
				course_slug: input.courseSlug,
				tool_key: input.toolKey,
				idempotency_key: input.idempotencyKey,
			}),
			// O visitante está esperando: melhor devolver "indisponível" rápido do
			// que segurar a conexão até o timeout do sistema operacional.
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		return {
			ok: false,
			semSaldo: false,
			status: 503,
			detalhe: err instanceof Error ? err.message : 'falha de rede',
		};
	}

	if (!res.ok) {
		// 403 = assinatura ausente/inativa; 402 = sem saldo ou cota estourada.
		// Para o produto os dois são a mesma coisa: o dono não pode pagar agora.
		const semSaldo = res.status === 402 || res.status === 403;
		let detalhe = `HTTP ${res.status}`;
		try {
			detalhe = `${detalhe} ${(await res.text()).slice(0, 300)}`;
		} catch {
			// corpo ilegível não muda a decisão
		}
		return { ok: false, semSaldo, status: res.status, detalhe };
	}

	const body = (await res.json()) as {
		invocation_id?: string;
		voxes_spent?: number | string;
		balance?: number | string;
		replayed?: boolean;
	};
	return {
		ok: true,
		invocationId: body.invocation_id ?? '',
		voxesSpent: Number(body.voxes_spent ?? 0),
		balance: Number(body.balance ?? 0),
		replayed: Boolean(body.replayed),
	};
}
