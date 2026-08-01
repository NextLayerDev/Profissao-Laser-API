import type { OmniInstance, OmniProviderKind } from '../../../types/omni.js';
import { decrypt } from '../../crypto.js';
import { evolutionProvider } from './evolution.js';
import { metaProvider } from './meta.js';
import type { OmniProvider, ProviderCtx } from './types.js';
import { zapiProvider } from './zapi.js';

const REGISTRY: Record<OmniProviderKind, OmniProvider> = {
	zapi: zapiProvider,
	evolution: evolutionProvider,
	meta: metaProvider,
};

export function getProvider(kind: OmniProviderKind): OmniProvider {
	const p = REGISTRY[kind];
	if (!p) throw new Error(`provedor desconhecido: ${kind}`);
	return p;
}

function safeDecrypt(value: string | null): string {
	if (!value) return '';
	try {
		return decrypt(value);
	} catch {
		// valor legado/não criptografado — usa como está
		return value;
	}
}

/** Monta o ProviderCtx da instância DECRIPTANDO os tokens. */
export function buildProviderCtx(instance: OmniInstance): ProviderCtx {
	const ctx: ProviderCtx = { instanceId: instance.id };
	if (instance.provider === 'zapi') {
		ctx.zapi = {
			instanceId: instance.zapi_instance_id ?? '',
			instanceToken: safeDecrypt(instance.zapi_instance_token),
			clientToken:
				process.env.ZAPI_SECURITY_TOKEN || process.env.ZAPI_CLIENT_TOKEN || '',
		};
	} else if (instance.provider === 'evolution') {
		ctx.evolution = {
			baseUrl: process.env.EVOLUTION_API_BASE_URL ?? '',
			apiKey: process.env.EVOLUTION_API_KEY ?? '',
			instanceName: instance.evolution_instance ?? '',
		};
	} else if (instance.provider === 'meta') {
		ctx.meta = {
			phoneNumberId: instance.meta_phone_number_id ?? '',
			wabaToken: safeDecrypt(instance.meta_waba_token),
		};
	}
	return ctx;
}

export { resolveMetaMediaUrl } from './meta.js';
export type { OmniProvider, ProviderCtx } from './types.js';
