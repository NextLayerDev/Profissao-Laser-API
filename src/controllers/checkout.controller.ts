import type { User } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { checkoutService } from '@/services/checkout.service';
import type { CreateCheckoutBody } from '@/types/Schemas/checkout.schema';

export const createCheckoutSessionController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { priceId, successUrl, cancelUrl } =
			request.body as CreateCheckoutBody;
		const user = request.user as User;

		if (!user || !user.email) {
			return reply.status(401).send({ message: 'User email not found' });
		}

		const result = await checkoutService.createCheckoutSession(
			priceId,
			user.email,
			user.id,
			successUrl,
			cancelUrl,
		);

		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
