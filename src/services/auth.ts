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

			return { token: data.session.access_token };
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

			return { token: data.session.access_token };
		});
	},

	async forgotPassword(email: string) {
		return withCapture(async () => {
			const { data: customer } = await supabase
				.from('Customers')
				.select('id')
				.eq('email', email)
				.maybeSingle();

			if (!customer) throw new Error('Email não encontrado');

			const token = crypto.randomUUID();
			const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

			await supabase
				.from('pl_password_reset_tokens')
				.delete()
				.eq('user_id', customer.id);

			const { error: insertError } = await supabase
				.from('pl_password_reset_tokens')
				.insert({ token, user_id: customer.id, email, expires_at: expiresAt });

			if (insertError) throw new Error(insertError.message);

			const appUrl = process.env.APP_URL ?? '';
			const resetLink = `${appUrl}/reset-password?token=${token}`;
			await sendPasswordResetEmail(email, resetLink);
			return { message: 'Email de recuperação enviado' };
		});
	},

	async resetPassword(token: string, newPassword: string) {
		return withCapture(async () => {
			const { data: tokenRow } = await supabase
				.from('pl_password_reset_tokens')
				.select('user_id, expires_at')
				.eq('token', token)
				.maybeSingle();

			if (!tokenRow) throw new Error('Token inválido');
			if (new Date(tokenRow.expires_at) < new Date())
				throw new Error('Token expirado');

			const { error: authError } = await supabase.auth.admin.updateUserById(
				tokenRow.user_id,
				{ password: newPassword },
			);
			if (authError) throw new Error(authError.message);

			await supabase
				.from('Customers')
				.update({ password_encrypted: encrypt(newPassword) })
				.eq('id', tokenRow.user_id);

			await supabase
				.from('pl_password_reset_tokens')
				.delete()
				.eq('token', token);

			return { message: 'Senha redefinida com sucesso' };
		});
	},
};
