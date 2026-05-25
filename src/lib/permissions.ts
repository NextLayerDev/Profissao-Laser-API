/**
 * Catálogo de permissões (fonte de verdade) + resolução de permissões efetivas.
 *
 * Chave = `"<module>.<action>"`. Ações: view | edit | delete | price.
 * Um cargo (`Permissions`) tem `grants` (string[]) + `isSuperAdmin`.
 * Um usuário (`Users`) tem `overrides {granted, revoked}` que ajustam o cargo.
 * Efetivo = isSuperAdmin ? TODAS : (grants ∪ overrides.granted) \ overrides.revoked.
 */

export type PermissionAction = 'view' | 'edit' | 'delete' | 'price';

export interface PermissionModule {
	module: string;
	label: string;
	actions: PermissionAction[];
}

export const PERMISSION_CATALOG: PermissionModule[] = [
	{ module: 'home', label: 'Início', actions: ['view'] },
	{
		module: 'produtos',
		label: 'Produtos',
		actions: ['view', 'edit', 'delete', 'price'],
	},
	{ module: 'vendas', label: 'Vendas', actions: ['view'] },
	{ module: 'relatorios', label: 'Relatórios', actions: ['view'] },
	{ module: 'links', label: 'Links', actions: ['view', 'edit', 'delete'] },
	{
		module: 'comunidade.canais',
		label: 'Comunidade · Canais',
		actions: ['view', 'edit', 'delete'],
	},
	{
		module: 'comunidade.eventos',
		label: 'Comunidade · Eventos',
		actions: ['view', 'edit', 'delete'],
	},
	{
		module: 'comunidade.projetos',
		label: 'Comunidade · Projetos',
		actions: ['view', 'edit', 'delete'],
	},
	{
		module: 'comunidade.biblioteca',
		label: 'Comunidade · Biblioteca',
		actions: ['view', 'edit', 'delete'],
	},
	{ module: 'forum', label: 'Fórum', actions: ['view', 'edit', 'delete'] },
	{
		module: 'agendamentos',
		label: 'Agendamentos',
		actions: ['view', 'edit', 'delete'],
	},
	{ module: 'suporte', label: 'Suporte', actions: ['view', 'edit', 'delete'] },
	{
		module: 'parametros',
		label: 'Parâmetros',
		actions: ['view', 'edit', 'delete'],
	},
	{ module: 'acessos', label: 'Acessos', actions: ['view', 'edit', 'delete'] },
	{ module: 'alunos', label: 'Alunos', actions: ['view', 'edit', 'delete'] },
	{
		module: 'previas',
		label: 'Prévias IA',
		actions: ['view', 'edit', 'delete'],
	},
	{
		module: 'vetorizacao',
		label: 'Vetorização',
		actions: ['view', 'edit', 'delete'],
	},
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.flatMap((m) =>
	m.actions.map((a) => `${m.module}.${a}`),
);

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

export function isValidPermissionKey(key: string): boolean {
	return PERMISSION_KEY_SET.has(key);
}

export interface RolePermissionRow {
	grants: string[] | null;
	isSuperAdmin: boolean | null;
}

export interface UserOverrides {
	granted: string[];
	revoked: string[];
}

/** Calcula a lista final de permissões de um usuário. */
export function getEffectivePermissions(
	role: RolePermissionRow | null | undefined,
	overrides?: UserOverrides | null,
): string[] {
	if (role?.isSuperAdmin) return [...ALL_PERMISSION_KEYS];
	const set = new Set<string>(role?.grants ?? []);
	for (const k of overrides?.granted ?? []) set.add(k);
	for (const k of overrides?.revoked ?? []) set.delete(k);
	return [...set];
}

export function hasPermission(effective: string[], key: string): boolean {
	return effective.includes(key);
}
