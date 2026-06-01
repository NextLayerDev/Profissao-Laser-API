import { withCapture } from '@/lib/sentry.js';
import { encrypt } from '../lib/crypto.js';
import { updateExternalUser } from '../lib/external-auth.js';
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
	async getMyProfile(
		customerId: string,
		fallbackName: string | null,
		fallbackEmail: string,
	) {
		return withCapture(async (): Promise<MyProfile> => {
			// name/email são do upvox (fonte de verdade pós-migração); nickname/bio/
			// avatar vêm do pl_community_profile. Tolera ausência de linha legada em
			// `Customers` (clientes nativos do upvox não têm → `.single()` daria erro).
			const { data: customer } =
				await customerRepository.getCustomerById(customerId);
			const prof = await profileRepository.getByCustomerId(customerId);
			return {
				id: customerId,
				name: customer?.name ?? fallbackName ?? null,
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
		ctx: {
			token?: string;
			fallbackName?: string | null;
			fallbackEmail?: string | null;
		} = {},
	) {
		return withCapture(async (): Promise<MyProfile> => {
			const { data: customer } =
				await customerRepository.getCustomerById(customerId);

			if (input.name !== undefined) {
				// Nome = fonte de verdade no upvox pós-migração. Encaminha p/ o upvox
				// (PATCH /v1/me) repassando o Bearer — clientes nativos do upvox não
				// têm linha em `Customers`, então gravar só na tabela legada não valia.
				if (ctx.token) {
					await updateExternalUser(ctx.token, { name: input.name });
				}
				// Mantém `Customers.name` em sincronia quando a linha existe (migrados):
				// joins de comunidade/membros ainda leem o nome da tabela legada.
				if (customer && input.name !== customer.name) {
					const { error: updError } = await customerRepository.updateCustomer(
						customerId,
						{ name: input.name },
					);
					if (updError) throw new Error(updError.message);
				}
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
				name: input.name ?? customer?.name ?? ctx.fallbackName ?? null,
				email: customer?.email ?? ctx.fallbackEmail ?? null,
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

	async removeMyAvatar(customerId: string) {
		return withCapture(async () => {
			await profileRepository.upsertByCustomerId(customerId, { image: null });
			return { avatar: null };
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
