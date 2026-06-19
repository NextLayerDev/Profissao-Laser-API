import { supabase } from '../lib/supabase.js';

export interface CommunityProfileRow {
	nickname: string | null;
	bio: string | null;
	image: string | null;
	banner: string | null;
}

/** Banner padrão (Banner 3 — moeda Voxxys) gravado em toda linha nova. */
const DEFAULT_BANNER = '/banners/banner-3.png';

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
			.select('nickname, bio, image, banner')
			.eq('customerId', customerId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as CommunityProfileRow | null) ?? null;
	}

	/** Upsert por customerId (sem depender de unique constraint): select → update | insert. */
	async upsertByCustomerId(
		customerId: string,
		fields: Partial<CommunityProfileRow> & { lastSeenAt?: string },
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
			// Linha nova já nasce com o banner padrão gravado (a menos que a própria
			// operação esteja definindo um banner) → novos clientes herdam o padrão.
			const seed =
				fields.banner === undefined ? { banner: DEFAULT_BANNER } : {};
			const { error } = await supabase
				.from('pl_community_profile')
				.insert({ customerId, ...seed, ...fields });
			if (error) throw new Error(error.message);
		}
	}
}

export const profileRepository = new ProfileRepository();
