const externalApiUrl = process.env.EXTERNAL_API_URL as string;

if (!externalApiUrl) {
	throw new Error('EXTERNAL_API_URL is not defined in .env');
}

/**
 * Cobrança server-to-server do Agente "Tool Engineer" (PR-2). Debita voxes por
 * turno de build chamando `POST /v1/me/agent/spend` no upvox. Mesmo padrão de
 * auth do `upvox-tools.ts`: `x-user-id` (confiado direto no upvox) + Bearer
 * original (exigido pelo gateway). 402 = saldo insuficiente; o upvox bypassa a
 * conta ilimitada (debita 0).
 */
export interface AgentSpendResult {
	voxes_spent: number;
	balance: number;
	unlimited: boolean;
}

function asCustomer(
	customerId: string,
	authHeader?: string,
): Record<string, string> {
	const headers: Record<string, string> = {
		'x-user-id': customerId,
		'x-user-role': 'customer',
		'content-type': 'application/json',
	};
	if (authHeader) headers.authorization = authHeader;
	return headers;
}

/**
 * Debita o cliente por um turno do agente. Devolve o resultado, `{insufficient}`
 * em 402, ou `null` em erro de rede/HTTP (distinguível pra decidir o que mostrar).
 */
export async function spendAgent(
	customerId: string,
	args: { ref_id: string; vox_cost: number },
	authHeader?: string,
): Promise<AgentSpendResult | { insufficient: true } | null> {
	try {
		const res = await fetch(`${externalApiUrl}/v1/me/agent/spend`, {
			method: 'POST',
			headers: asCustomer(customerId, authHeader),
			body: JSON.stringify(args),
		});
		if (res.status === 402) return { insufficient: true };
		if (!res.ok) {
			console.error(
				`[upvox-agent] spend → HTTP ${res.status} (EXTERNAL_API_URL=${externalApiUrl})`,
			);
			return null;
		}
		return (await res.json()) as AgentSpendResult;
	} catch (err) {
		console.error('[upvox-agent] spend falhou:', err);
		return null;
	}
}
