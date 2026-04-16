/**
 * Extrai só o origin (scheme + host + porta) de uma URL de tenant armazenada
 * em `pl_tenant.vercel_url`. O campo é guardado como `<domain>/login` pelo
 * worker de provisionamento (link direto de login em e-mails pós-compra),
 * mas todos os consumidores de infraestrutura (proxy OAuth, proxy webhook)
 * precisam da raiz do deploy para concatenar rotas de API.
 */
export function normalizeVercelUrl(url: string): string {
	const trimmed = url.trim();
	const withScheme = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	try {
		return new URL(withScheme).origin;
	} catch {
		return withScheme.replace(/\/$/, '');
	}
}
