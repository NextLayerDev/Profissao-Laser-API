import { withCapture } from '@/lib/sentry.js';
import { encrypt } from '../lib/crypto.js';
import { supabase } from '../lib/supabase.js';
import { customerRepository } from '../repositories/customer.js';
import { profileRepository } from '../repositories/profile.js';

export interface MyProfile {
	id: string;
	name: string | null;
	email: string | null;
	nickname: string | null;
	bio: string | null;
	avatar: string | null;
}

export const profileService = {
	async getMyProfile(customerId: string, fallbackEmail: string) {
		return withCapture(async (): Promise<MyProfile> => {
			const { data: customer, error } =
				await customerRepository.getCustomerById(customerId);
			if (error) throw new Error(error.message);
			const prof = await profileRepository.getByCustomerId(customerId);
			return {
				id: customerId,
				name: customer?.name ?? null,
				email: customer?.email ?? fallbackEmail ?? null,
				nickname: prof?.nickname ?? null,
				bio: prof?.bio ?? null,
				avatar: prof?.image ?? null,
			};
		});
	},

	async updateMyProfile(
		customerId: string,
		input: { name?: string; nickname?: string | null; bio?: string | null },
	) {
		return withCapture(async (): Promise<MyProfile> => {
			const { data: customer, error } =
				await customerRepository.getCustomerById(customerId);
			if (error) throw new Error(error.message);

			if (input.name !== undefined && input.name !== customer?.name) {
				const { error: updError } = await customerRepository.updateCustomer(
					customerId,
					{ name: input.name },
				);
				if (updError) throw new Error(updError.message);
			}

			const profFields: Partial<{
				nickname: string | null;
				bio: string | null;
			}> = {};
			if (input.nickname !== undefined) profFields.nickname = input.nickname;
			if (input.bio !== undefined) profFields.bio = input.bio;
			if (Object.keys(profFields).length > 0) {
				await profileRepository.upsertByCustomerId(customerId, profFields);
			}

			const prof = await profileRepository.getByCustomerId(customerId);
			return {
				id: customerId,
				name: input.name ?? customer?.name ?? null,
				email: customer?.email ?? null,
				nickname: prof?.nickname ?? null,
				bio: prof?.bio ?? null,
				avatar: prof?.image ?? null,
			};
		});
	},

	async setMyAvatar(customerId: string, url: string) {
		return withCapture(async () => {
			await profileRepository.upsertByCustomerId(customerId, { image: url });
			return { avatar: url };
		});
	},

	async changeMyPassword(
		customerId: string,
		email: string,
		currentPassword: string,
		newPassword: string,
	) {
		return withCapture(async () => {
			// Valida a senha atual antes de trocar.
			const { error: signInError } = await supabase.auth.signInWithPassword({
				email,
				password: currentPassword,
			});
			if (signInError) throw new Error('Senha atual incorreta');

			const { error: authError } = await supabase.auth.admin.updateUserById(
				customerId,
				{ password: newPassword },
			);
			if (authError) throw new Error(authError.message);

			await customerRepository.updateCustomer(customerId, {
				password_encrypted: encrypt(newPassword),
			});
			return { message: 'Senha atualizada' };
		});
	},
};
