import { supabase } from '../lib/supabase';
import { customerRepository } from '../repositories/customer';
import { usersRepository } from '../repositories/user';
import type { CustomerRegister, Login, UserRegister } from '../types/auth';
import type { Customer } from '../types/customer';

export class AuthService {
	async registerUser(userData: UserRegister) {
		let permissionId = 1; // Default to Super Admin or handle error
		if (userData.role === 'Financial') permissionId = 2;
		if (userData.role === 'Super Admin') permissionId = 1;

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
			Permissions: permissionId,
		};

		await usersRepository.createUser(userToCreate);
		return { message: 'User created', userId: authData.user.id };
	}

	async registerCustomer(customerData: CustomerRegister) {
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
		delete customerToCreate.password;
		customerToCreate.id = authData.user.id;

		await customerRepository.createCustomer(customerToCreate);
		return { message: 'Customer created', userId: authData.user.id };
	}

	async loginUser(userData: Login) {
		if (!userData.password) {
			throw Error('Not password provided!');
		}

		const { data, error } = await supabase.auth.signInWithPassword({
			email: userData.email,
			password: userData.password,
		});

		if (error) throw new Error(error.message);

		return { token: data.session.access_token };
	}

	async loginCustomer(customerData: Login) {
		if (!customerData.password) {
			throw Error('Password not provided!');
		}

		const { data, error } = await supabase.auth.signInWithPassword({
			email: customerData.email,
			password: customerData.password,
		});

		if (error) throw new Error(error.message);

		return { token: data.session.access_token };
	}
}

export const authService = new AuthService();
