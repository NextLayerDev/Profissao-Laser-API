import { withCapture } from '@/lib/sentry.js';
import { stripe } from '../lib/stripe.js';
import { cursoRepository } from '../repositories/curso.js';
import type { CursoCreate, CursoUpdate } from '../types/curso.js';

function generateSlug(name: string, id: string, customSlug?: string): string {
	const base =
		customSlug ??
		name
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '');
	return `${base}-${id.split('-')[0]}`;
}

export const cursoService = {
	async listCursos() {
		return withCapture(() => cursoRepository.listAll());
	},

	async getCursoById(id: string) {
		return withCapture(() => cursoRepository.findById(id));
	},

	async createCurso(data: CursoCreate) {
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

			const id = crypto.randomUUID();
			const slug = generateSlug(data.name, id, data.slug);

			return cursoRepository.create({
				id,
				name: data.name,
				description: data.description,
				image: data.image,
				price: data.price,
				status: 'ativo',
				slug,
				stripeProductId: stripeProduct.id,
				stripePriceId: stripePrice.id,
				aulas: data.aulas,
				suporte: data.suporte,
				biblioteca: data.biblioteca,
			});
		});
	},

	async updateCurso(id: string, data: CursoUpdate) {
		return withCapture(async () => {
			const existing = await cursoRepository.findById(id);

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

			return cursoRepository.update(id, { ...data, stripePriceId });
		});
	},

	async updateCursoStatus(id: string, active: boolean) {
		return withCapture(() => cursoRepository.updateStatus(id, active));
	},

	async deleteCurso(id: string) {
		return withCapture(() => cursoRepository.delete(id));
	},

	async updateCursoImage(id: string, imageUrl: string) {
		return withCapture(() => cursoRepository.updateImage(id, imageUrl));
	},
};
