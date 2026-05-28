import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	CreditConfirmationRequiredError,
	InsufficientCreditsError,
} from '../lib/credit-errors.js';
import { FreeTierQuotaError } from '../lib/free-tier-quota.js';
import { creditService } from '../services/credit.js';
import {
	adjustCreditsSchema,
	createCheckoutSchema,
	createPackageSchema,
	updateCostSchema,
	updatePackageSchema,
	updatePackageStatusSchema,
} from '../types/credit.js';

export function mapCreditError(err: unknown, reply: FastifyReply) {
	if (err instanceof FreeTierQuotaError) {
		return reply.status(429).send({
			message: `Limite gratuito de ${err.limit} usos atingido. Compre voxxys para continuar.`,
			code: 'FREE_TIER_LIMIT_REACHED',
			feature: err.feature,
			limit: err.limit,
			used: err.used,
			remaining: 0,
			period: err.period,
			resetsAt: err.resetsAt,
			balance: err.balance,
		});
	}
	if (err instanceof CreditConfirmationRequiredError) {
		return reply.status(402).send({
			message: err.message,
			reason: 'confirmation_required',
			feature: err.feature,
			cost: err.cost,
			balance: err.balance,
		});
	}
	if (err instanceof InsufficientCreditsError) {
		return reply.status(402).send({
			message: err.message,
			reason: 'insufficient_balance',
			feature: err.feature,
			cost: err.cost,
			balance: err.balance,
		});
	}
	const message = err instanceof Error ? err.message : 'Unknown error';
	const status = message.includes('not found') ? 404 : 500;
	return reply.status(status).send({ message });
}

export const getBalanceController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId)
		return reply.status(403).send({ message: 'Customer not found' });
	try {
		return reply.send(await creditService.getBalance(customerId));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const getQuotasController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId)
		return reply.status(403).send({ message: 'Customer not found' });
	try {
		return reply.send(await creditService.getQuotas(customerId));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const listCostsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		return reply.send(await creditService.listCosts());
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const listPackagesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		return reply.send(await creditService.listPackages(true));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const createCheckoutController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId)
		return reply.status(403).send({ message: 'Customer not found' });
	try {
		const { packageId } = createCheckoutSchema.parse(request.body);
		return reply.send(
			await creditService.createCheckout(customerId, packageId),
		);
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const historyController = async (
	request: FastifyRequest<{ Querystring: { page?: number; limit?: number } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId)
		return reply.status(403).send({ message: 'Customer not found' });
	try {
		const page = request.query.page ?? 1;
		const limit = request.query.limit ?? 20;
		return reply.send(await creditService.listHistory(customerId, page, limit));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

// ── Admin ────────────────────────────────────────────────────────────────
export const listAllPackagesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		return reply.send(await creditService.listPackages(false));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const createPackageController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createPackageSchema.parse(request.body);
		return reply.status(201).send(await creditService.createPackage(data));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const updatePackageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updatePackageSchema.parse(request.body);
		return reply.send(
			await creditService.updatePackage(request.params.id, data),
		);
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const updatePackageStatusController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { active } = updatePackageStatusSchema.parse(request.body);
		return reply.send(
			await creditService.setPackageStatus(request.params.id, active),
		);
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const updateCostController = async (
	request: FastifyRequest<{ Params: { feature: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { cost } = updateCostSchema.parse(request.body);
		return reply.send(
			await creditService.setFeatureCost(request.params.feature, cost),
		);
	} catch (err) {
		return mapCreditError(err, reply);
	}
};

export const adjustController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { customerId, amount, reason } = adjustCreditsSchema.parse(
			request.body,
		);
		return reply.send(await creditService.adjust(customerId, amount, reason));
	} catch (err) {
		return mapCreditError(err, reply);
	}
};
