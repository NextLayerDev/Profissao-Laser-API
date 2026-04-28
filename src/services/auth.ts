import { withCapture } from '@/lib/sentry.js';
import { encrypt } from '../lib/crypto.js';
import { sendPasswordResetEmail } from '../lib/mailer.js';
import { supabase } from '../lib/supabase.js';
import { customerRepository } from '../repositories/customer.js';
import { usersRepository } from '../repositories/user.js';
import type { CustomerRegister, Login, UserRegister } from '../types/auth.js';

export const authService = {
	async registerUser(userData: UserRegister) {
		return withCapture(async () => {
			const { data: permissionData, error: permissionError } =
				await usersRepository.getPermissionByRole(userData.role);

			if (permissionError || !permissionData)
				throw new Error(`No permission found for role: ${userData.role}`);

			const { data: authData, error: authError } =
				await supabase.auth.admin.createUser({
					email: userData.email,
					password: userData.password,
					email_confirm: true,
					user_metadata: {
						name: userData.name,
						role: userData.role,
					},
				});

			if (authError) throw new Error(authError.message);
			if (!authData.user) throw new Error('Failed to create user in Auth');

			const { password, Permissions, ...rest } = userData;

			const userToCreate = {
				...rest,
				id: authData.user.id,
				Permissions: permissionData.id,
			};

			await usersRepository.createUser(userToCreate);
			return { message: 'User created', userId: authData.user.id };
		});
	},

	async registerCustomer(customerData: CustomerRegister) {
		return withCapture(async () => {
			const { data: authData, error: authError } =
				await supabase.auth.admin.createUser({
					email: customerData.email,
					password: customerData.password,
					email_confirm: true,
					user_metadata: {
						name: customerData.name,
						role: 'customer',
					},
				});

			if (authError) throw new Error(authError.message);
			if (!authData.user) throw new Error('Failed to create customer in Auth');

			// biome-ignore lint/suspicious/noExplicitAny: Temporary fix for type mismatch
			const customerToCreate: any = { ...customerData };
			customerToCreate.password_encrypted = encrypt(customerData.password);
			delete customerToCreate.password;
			customerToCreate.id = authData.user.id;

			await customerRepository.createCustomer(customerToCreate);
			return { message: 'Customer created', userId: authData.user.id };
		});
	},

	async loginUser(userData: Login) {
		return withCapture(async () => {
			if (!userData.password) {
				throw Error('Not password provided!');
			}

			const { data, error } = await supabase.auth.signInWithPassword({
				email: userData.email,
				password: userData.password,
			});

			if (error) throw new Error(error.message);

			// Busca dados do user na tabela Users para enriquecer a resposta.
			// Mantém retro-compat: campos opcionais e tolera ausência.
			const { data: userRow } = await supabase
				.from('Users')
				.select('id, email, name, role')
				.or(`id.eq.${data.user?.id},email.eq.${data.user?.email}`)
				.maybeSingle();

			return {
				token: data.session.access_token,
				refresh_token: data.session.refresh_token,
				expires_at: data.session.expires_at ?? null,
				user: {
					id: data.user?.id ?? userRow?.id ?? '',
					email: data.user?.email ?? userRow?.email ?? '',
					name: userRow?.name ?? data.user?.user_metadata?.name ?? '',
					role: userRow?.role ?? data.user?.user_metadata?.role ?? 'admin',
				},
			};
		});
	},

	async loginCustomer(customerData: Login) {
		return withCapture(async () => {
			if (!customerData.password) {
				throw Error('Password not provided!');
			}

			const { data, error } = await supabase.auth.signInWithPassword({
				email: customerData.email,
				password: customerData.password,
			});

			if (error) throw new Error(error.message);

			const { data: customerRow } = await supabase
				.from('Customers')
				.select('id, email, name, phone')
				.or(`id.eq.${data.user?.id},email.eq.${data.user?.email}`)
				.maybeSingle();

			return {
				token: data.session.access_token,
				refresh_token: data.session.refresh_token,
				expires_at: data.session.expires_at ?? null,
				customer: {
					id: data.user?.id ?? customerRow?.id ?? '',
					email: data.user?.email ?? customerRow?.email ?? '',
					name: customerRow?.name ?? data.user?.user_metadata?.name ?? '',
					phone: customerRow?.phone ?? null,
				},
			};
		});
	},

	async refreshSession(refreshToken: string) {
		return withCapture(async () => {
			if (!refreshToken) {
				throw new Error('refresh_token not provided');
			}
			const { data, error } = await supabase.auth.refreshSession({
				refresh_token: refreshToken,
			});
			if (error) throw new Error(error.message);
			if (!data.session) throw new Error('No session returned by refresh');
			return {
				token: data.session.access_token,
				refresh_token: data.session.refresh_token,
				expires_at: data.session.expires_at ?? null,
			};
		});
	},

	/**
	 * Resolve o user/customer do token. Distingue entre:
	 * - user (tabela Users — staff/admin)
	 * - customer (tabela Customers — aluno do curso)
	 * Para uso em GET /me.
	 */
	async getMeFromToken(accessToken: string) {
		return withCapture(async () => {
			const {
				data: { user },
				error,
			} = await supabase.auth.getUser(accessToken);

			if (error || !user) throw new Error('Invalid or expired token');

			// Tenta primeiro como user (staff)
			const { data: userRow } = await supabase
				.from('Users')
				.select('id, email, name, role')
				.or(`id.eq.${user.id},email.eq.${user.email}`)
				.maybeSingle();

			if (userRow) {
				return {
					type: 'user' as const,
					id: userRow.id,
					email: userRow.email,
					name: userRow.name,
					role: userRow.role ?? 'admin',
				};
			}

			// Senão, tenta como customer
			const { data: customerRow } = await supabase
				.from('Customers')
				.select('id, email, name, phone')
				.or(`id.eq.${user.id},email.eq.${user.email}`)
				.maybeSingle();

			if (customerRow) {
				return {
					type: 'customer' as const,
					id: customerRow.id,
					email: customerRow.email,
					name: customerRow.name,
					phone: customerRow.phone ?? null,
				};
			}

			throw new Error(
				'Authenticated identity not found in Users nor Customers',
			);
		});
	},

	async forgotPassword(email: string) {
		return withCapture(async () => {
			const { data, error } = await supabase.auth.admin.generateLink({
				type: 'recovery',
				email,
			});

			if (error) throw new Error(error.message);

			await sendPasswordResetEmail(email, data.properties.action_link);
			return { message: 'Email de recuperação enviado' };
		});
	},
};
