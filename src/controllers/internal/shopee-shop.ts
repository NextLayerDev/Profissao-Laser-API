import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { supabase } from '../../lib/supabase.js';
import { provisioningRepository } from '../../repositories/provisioning.js';

/**
 * Registro central de `shop_id → tenant_slug` pro proxy de webhook Shopee.
 *
 * Chamado pelos deploys de tenant (system_porteira) logo após trocar o OAuth
 * code por access_token e descobrir o `shop_id`. Sem este mapping o proxy de
 * webhook da API central não saberia pra qual deploy forwardar o evento da
 * Shopee.
 *
 * Autenticação: header `X-Internal-Secret` bate com env INTERNAL_REGISTER_SECRET
 * (mesma usada pelo register de seller ML).
 */

const bodySchema = z.object({
	shop_id: z.string().min(1),
	tenant_slug: z.string().min(1),
	store_id: z.string().min(1),
	company_id: z.string().optional(),
	region: z.string().optional(),
});

type RegisterBody = z.infer<typeof bodySchema>;

export const handleRegisterShopeeShop = async (
	request: FastifyRequest<{ Body: RegisterBody }>,
	reply: FastifyReply,
) => {
	const expected = process.env.INTERNAL_REGISTER_SECRET;
	if (!expected) {
		request.log.error('INTERNAL_REGISTER_SECRET não configurada');
		return reply.status(500).send({
			message: 'INTERNAL_REGISTER_SECRET não configurada no servidor',
		});
	}

	const provided = request.headers['x-internal-secret'];
	if (typeof provided !== 'string' || provided !== expected) {
		return reply.status(401).send({ message: 'Unauthorized' });
	}

	const { shop_id, tenant_slug, store_id, company_id, region } = request.body;

	const tenant = await provisioningRepository.findTenantBySlug(tenant_slug);
	if (!tenant) {
		return reply.status(404).send({
			message: `Tenant not found for slug: ${tenant_slug}`,
		});
	}

	const { error } = await supabase.from('pl_tenant_shopee_shop').upsert(
		{
			shop_id,
			tenant_slug,
			store_id,
			company_id: company_id ?? null,
			region: region ?? 'BR',
			updated_at: new Date().toISOString(),
		},
		{ onConflict: 'shop_id' },
	);

	if (error) {
		request.log.error({ error }, 'Falha ao upsert pl_tenant_shopee_shop');
		return reply.status(500).send({ message: error.message });
	}

	return reply.status(200).send({ ok: true });
};
