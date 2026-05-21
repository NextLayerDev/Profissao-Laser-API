import { withCapture } from '@/lib/sentry.js';
import { stripe } from '../lib/stripe.js';
import { planRepository } from '../repositories/plan.js';
import type { PlanCreate, PlanUpdate } from '../types/plan.js';

export const planService = {
	async listPlans() {
		return withCapture(() => planRepository.listAll());
	},

	async getPlanById(id: string) {
		return withCapture(() => planRepository.findById(id));
	},

	async createPlan(data: PlanCreate) {
		return withCapture(async () => {
			const stripeProduct = await stripe.products.create({
				name: data.name,
				description: data.description || undefined,
			});

			const stripePrice = await stripe.prices.create({
				product: stripeProduct.id,
				unit_amount: Math.round(data.price * 100),
				currency: 'brl',
				recurring:
					data.interval !== 'one_time'
						? { interval: data.interval as 'month' | 'year' }
						: undefined,
			});

			return planRepository.create({
				name: data.name,
				description: data.description,
				status: data.status,
				price: data.price,
				stripeProductId: stripeProduct.id,
				stripePriceId: stripePrice.id,
				previas: data.previas,
				canva: data.canva,
				vetorizacao: data.vetorizacao,
				parametros: data.parametros,
				fornecedores: data.fornecedores,
				aulas: data.aulas,
				suporte: data.suporte,
				biblioteca: data.biblioteca,
				comunidade: data.comunidade,
			});
		});
	},

	async updatePlan(id: string, data: PlanUpdate) {
		return withCapture(async () => {
			const existing = await planRepository.findById(id);

			if (data.name && existing.stripeProductId) {
				await stripe.products.update(existing.stripeProductId as string, {
					name: data.name,
					...(data.description !== undefined && {
						description: data.description,
					}),
				});
			}

			let stripePriceId: string | undefined;
			if (
				data.price !== undefined &&
				existing.stripePriceId &&
				existing.stripeProductId
			) {
				await stripe.prices.update(existing.stripePriceId as string, {
					active: false,
				});
				const newPrice = await stripe.prices.create({
					product: existing.stripeProductId as string,
					unit_amount: Math.round(data.price * 100),
					currency: 'brl',
				});
				stripePriceId = newPrice.id;
			}

			const { interval: _interval, ...rest } = data as PlanUpdate & {
				interval?: string;
			};
			return planRepository.update(id, { ...rest, stripePriceId });
		});
	},

	async deletePlan(id: string) {
		return withCapture(() => planRepository.delete(id));
	},

	async addCurso(planId: string, cursoId: string) {
		return withCapture(() => planRepository.addCurso(planId, cursoId));
	},

	async removeCurso(planId: string, cursoId: string) {
		return withCapture(() => planRepository.removeCurso(planId, cursoId));
	},
};
