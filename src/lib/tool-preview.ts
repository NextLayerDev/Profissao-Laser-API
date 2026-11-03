/**
 * Allowlist de PREVIEW de ferramenta em rascunho (espelho do arquivo de mesmo
 * nome no upvox — a lista precisa ser a MESMA nos dois, senão a definition
 * carrega de um lado e não do outro).
 *
 * Por que existe: `ai_tool_definitions` é compartilhado entre dev e produção.
 * Publicar uma tool só para testá-la a entrega a todos os alunos, com a API de
 * produção ainda sem o código que ela precisa. E promover o testador a admin
 * daria billing, usuários e publicação — muito além do necessário.
 *
 * Concede UMA coisa: carregar a definition de uma tool em `draft`. Nada mais.
 * Some com a remoção da env.
 *
 * `TOOL_PREVIEW_USERS` — ids e/ou e-mails separados por vírgula. Vazia (padrão)
 * = ninguém, comportamento idêntico ao de antes.
 *
 * `TOOL_PREVIEW_KEYS` — QUAIS tools estão em preview. Sem essa lista, um
 * testador conseguiria abrir o rascunho de qualquer tool da Fábrica, inclusive
 * o de uma que o admin está no meio de reescrever. As duas envs precisam ser as
 * mesmas aqui e no upvox.
 */

function parseList(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? '')
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	);
}

export function isToolPreviewUser(
	userId?: string | null,
	email?: string | null,
): boolean {
	const list = parseList(process.env.TOOL_PREVIEW_USERS);
	if (list.size === 0) return false;
	if (userId && list.has(userId.toLowerCase())) return true;
	if (email && list.has(email.toLowerCase())) return true;
	return false;
}

export function isPreviewOnlyTool(key: string): boolean {
	const keys = parseList(process.env.TOOL_PREVIEW_KEYS);
	return keys.size > 0 && keys.has(key.toLowerCase());
}
