import '@fastify/jwt';
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
		effectivePermissions?: string[];
		isSuperAdminUser?: boolean;
	}
}
