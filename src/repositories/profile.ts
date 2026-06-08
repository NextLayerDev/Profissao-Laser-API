import { supabase } from '../lib/supabase.js';

export interface CommunityProfileRow {
	nickname: string | null;
	bio: string | null;
	image: string | null;
}

/**
 * Perfil do customer guardado em pl_community_profile (PK = customerId).
 * Reusa o mesmo `image` mostrado na comunidade como avatar do perfil.
 */
class ProfileRepository {
	async getByCustomerId(
		customerId: string,
	): Promise<CommunityProfileRow | null> {
		const { data, error } = await supabase
			.from('pl_community_profile')
			.select('nickname, bio, image')
			.eq('customerId', customerId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as CommunityProfileRow | null) ?? null;
	}

	/** Upsert por customerId (sem depender de unique constraint): select → update | insert. */
	async upsertByCustomerId(
		customerId: string,
		fields: Partial<CommunityProfileRow>,
	): Promise<void> {
		const { data: existing, error: selError } = await supabase
			.from('pl_community_profile')
			.select('customerId')
			.eq('customerId', customerId)
			.maybeSingle();
		if (selError) throw new Error(selError.message);

		if (existing) {
			const { error } = await supabase
				.from('pl_community_profile')
				.update(fields)
				.eq('customerId', customerId);
			if (error) throw new Error(error.message);
		} else {
			const { error } = await supabase
				.from('pl_community_profile')
				.insert({ customerId, ...fields });
			if (error) throw new Error(error.message);
		}
	}
}

export const profileRepository = new ProfileRepository();
