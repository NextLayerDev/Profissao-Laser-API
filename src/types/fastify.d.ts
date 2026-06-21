import type { ExternalUser } from '../lib/external-auth.js';

declare module 'fastify' {
	interface FastifyRequest {
		currentUser?: ExternalUser | null;
		currentRole?: string | null;
		currentCustomer?: {
			id: string;
			name: string;
			image: string | null;
		} | null;
		isUnlimitedCustomer?: boolean;
		/** Key do plano ativo do customer (ex.: 'basic'|'pro'|'max'), resolvida no upvox. */
		currentPlanKey?: string | null;
		effectivePermissions?: string[];
		isSuperAdminUser?: boolean;
	}
}
