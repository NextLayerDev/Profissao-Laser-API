import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerController } from '../controllers/customer.js';
import { profileController } from '../controllers/profile.js';
import { fetchEntitlements } from '../lib/external-auth.js';
import { authenticateCustomer, requireModule } from '../middleware/auth.js';
import {
	changeMyPasswordSchema,
	customerProfileSchema,
	customerSchema,
	updateProfileSchema,
} from '../types/customer.js';
import { ErrorSchema } from '../types/error.js';

export async function customerRoute(server: FastifyInstance) {
	server.get(
		'/customers',
		{
			// preHandler: [authenticate],
			schema: {
				description: 'Get all customers.',
				response: {
					200: z.array(
						customerSchema.omit({ password: true }).extend({
							stripe: z.string().nullable(),
							access: z.string().nullable(),
							banned: z.boolean(),
							subscription: z
								.object({
									status: z.string(),
									currentPeriodEnd: z.string().nullable(),
									cancelAtPeriodEnd: z.boolean(),
								})
								.nullable(),
						}),
					),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getAllCustomers,
	);

	server.get(
		'/customer/:id',
		{
			schema: {
				description: 'Get a customer by ID',
				params: z.object({ id: z.string() }),
				response: {
					200: customerSchema.omit({ password: true }).extend({
						stripe: z.string().nullable(),
						access: z.string().nullable(),
						banned: z.boolean(),
					}),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getCustomerById,
	);

	server.delete(
		'/customer',
		{
			preHandler: [requireModule('alunos')],
			schema: {
				description: 'Delete a customer by ID',
				body: z.object({ id: z.string() }),
				response: {
					200: z.object({ message: z.string() }),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.deleteCustomer,
	);

	server.patch(
		'/customer/:id/block',
		{
			preHandler: [requireModule('alunos')],
			schema: {
				description: 'Block or unblock a customer',
				params: z.object({ id: z.string() }),
				body: z.object({ blocked: z.boolean() }),
				response: {
					200: z.object({ message: z.string() }),
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.blockCustomer,
	);

	server.patch(
		'/customer/:id/password',
		{
			preHandler: [requireModule('alunos')],
			schema: {
				description: 'Change the password of a customer',
				params: z.object({ id: z.string() }),
				body: z.object({ password: z.string().min(6) }),
				response: {
					200: z.object({ message: z.string() }),
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.changePassword,
	);

	server.patch(
		'/customer/:id/test-unlimited',
		{
			preHandler: [requireModule('alunos')],
			schema: {
				description:
					'Marca/desmarca um customer como conta de teste ilimitada.',
				params: z.object({ id: z.string() }),
				body: z.object({ unlimited: z.boolean() }),
				response: {
					200: z.object({
						message: z.string(),
						isTestUnlimited: z.boolean(),
					}),
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.setTestUnlimited,
	);

	server.get(
		'/me/subscription',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Get the authenticated customer subscription details',
				response: {
					200: z.object({
						id: z.string(),
						status: z.string(),
						product_name: z.string(),
						amount: z.number(),
						currency: z.string(),
						interval: z.string().nullable(),
						currentPeriodEnd: z.string().nullable(),
						cancelAtPeriodEnd: z.boolean(),
					}),
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getMySubscription,
	);

	server.get(
		'/me/unlimited',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Whether the authenticated customer is an unlimited test account.',
				response: {
					200: z.object({ unlimited: z.boolean() }),
					401: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		// `authenticateCustomer` nunca atribui `isUnlimitedCustomer` (só
		// `authenticateCommunity` atribuía), então esta rota respondia `false`
		// para TODO mundo — inclusive contas de teste reais. Resolvemos aqui, na
		// fonte de verdade, sem trocar o guard: `authenticateCommunity` exigiria
		// assinatura ativa, e o objetivo desta rota é justamente reportar quem
		// não precisa de uma. Cobre também a staff em Visão Aluno.
		async (request) => {
			if (request.isUnlimitedCustomer === true) return { unlimited: true };
			const token = (request.headers.authorization ?? '').replace(
				/^Bearer\s+/i,
				'',
			);
			const ent = token ? await fetchEntitlements(token) : null;
			return { unlimited: ent?.is_test_unlimited === true };
		},
	);

	server.get(
		'/me/profile',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Get the authenticated customer profile.',
				response: {
					200: customerProfileSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		profileController.getMyProfile,
	);

	server.patch(
		'/me/profile',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Update the authenticated customer profile (name, nickname, bio, avatar, banner).',
				body: updateProfileSchema,
				response: {
					200: customerProfileSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		profileController.updateMyProfile,
	);

	server.post(
		'/me/avatar',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Upload the authenticated customer avatar (multipart/form-data, field "file").',
				response: {
					200: z.object({ avatar: z.string() }),
					400: ErrorSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		profileController.uploadAvatar,
	);

	server.delete(
		'/me/avatar',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Remove the authenticated customer avatar (reverts to default initials).',
				response: {
					200: z.object({ avatar: z.string().nullable() }),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		profileController.removeAvatar,
	);

	server.post(
		'/me/banner',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Upload the authenticated customer profile banner (multipart/form-data, field "file").',
				response: {
					200: z.object({ banner: z.string() }),
					400: ErrorSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		profileController.uploadBanner,
	);

	server.delete(
		'/me/banner',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Remove the authenticated customer profile banner (reverts to default banner).',
				response: {
					200: z.object({ banner: z.string().nullable() }),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		profileController.removeBanner,
	);

	server.patch(
		'/me/password',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Change the authenticated customer password (validates the current one).',
				body: changeMyPasswordSchema,
				response: {
					200: z.object({ message: z.string() }),
					400: ErrorSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		profileController.changeMyPassword,
	);

	server.post(
		'/me/subscription/cancel',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Cancel the authenticated customer subscription at period end',
				response: {
					200: z.object({
						message: z.string(),
						cancelAtPeriodEnd: z.boolean(),
						currentPeriodEnd: z.string().nullable(),
					}),
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.cancelMySubscription,
	);

	server.post(
		'/customer/subscription/cancel',
		{
			preHandler: [requireModule('alunos')],
			schema: {
				description:
					'Cancel a customer subscription at period end by email and subscription ID (Admin).',
				body: z.object({
					email: z.email(),
					subscriptionId: z.string(),
				}),
				response: {
					200: z.object({
						id: z.string(),
						message: z.string(),
						cancelAtPeriodEnd: z.boolean(),
						currentPeriodEnd: z.string().nullable(),
					}),
					400: ErrorSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
				security: [{ bearerAuth: [] }],
			},
		},
		customerController.cancelCustomerSubscription,
	);

	server.get(
		'/customer/plans/:email',
		{
			schema: {
				description: 'Get the user plans',
				params: z.object({ email: z.email() }),
				response: {
					200: z.array(
						z.object({
							id: z.string(),
							status: z.string(),
							product_name: z.string(),
							slug: z.string().nullable(),
							currentPeriodEnd: z.string().nullable(),
							cancelAtPeriodEnd: z.boolean(),
						}),
					),
					404: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getCustomerPlans,
	);
}
