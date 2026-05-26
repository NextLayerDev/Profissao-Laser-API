import type { User } from '@supabase/supabase-js';

declare module 'fastify' {
	interface FastifyRequest {
		currentUser: User | null;
		currentCustomer: { id: string; name: string; image: string | null } | null;
		/** Permissões efetivas do staff (preenchidas por authenticateAdmin). */
		effectivePermissions?: string[];
		isSuperAdminUser?: boolean;
		/** Customer marcado como teste ilimitado (preenchido pelos middlewares de customer). */
		isUnlimitedCustomer?: boolean;
	}
}
