import { supabase } from '@/lib/supabase';
import {
	createCustomer,
	getCustomerByEmail,
} from '@/repositories/customer.repository';
import { createUser, getUserByEmail } from '@/repositories/user.repository';
import type { CustomerParams } from '@/types/Interfaces/ICustomerParams';
import type { UserParams } from '@/types/Interfaces/IUserParams';

export class AuthService {
	async registerUser(userData: UserParams) {
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

		await createUser(userToCreate);
		return { message: 'User created', userId: authData.user.id };
	}

	async registerCustomer(customerData: CustomerParams) {
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

		const customerToCreate = { ...customerData };
		delete customerToCreate.password;
		customerToCreate.id = authData.user.id;

		await createCustomer(customerToCreate);
		return { message: 'Customer created', userId: authData.user.id };
	}

	async loginUser(userData: UserParams) {
		if (!userData.password) {
			throw Error('Not password provided!');
		}

		const { data, error } = await supabase.auth.signInWithPassword({
			email: userData.email,
			password: userData.password,
		});

		if (error) throw new Error(error.message);

		const userProfile = await getUserByEmail(userData.email);
		if (!userProfile) {
			await supabase.auth.signOut();
			throw new Error('Unauthorized: User profile not found');
		}

		return { token: data.session.access_token };
	}

	async loginCustomer(customerData: CustomerParams) {
		if (!customerData.password) {
			throw Error('Password not provided!');
		}

		const { data, error } = await supabase.auth.signInWithPassword({
			email: customerData.email,
			password: customerData.password,
		});

		if (error) throw new Error(error.message);

		const customerProfile = await getCustomerByEmail(customerData.email);
		if (!customerProfile) {
			await supabase.auth.signOut();
			throw new Error('Unauthorized: Customer profile not found');
		}

		return { token: data.session.access_token };
	}
}

export const authService = new AuthService();
