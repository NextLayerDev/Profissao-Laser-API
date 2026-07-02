import { supabase } from '../lib/supabase.js';
import type { OmniBusinessConfigFields } from '../services/omni/prompts.js';

const TABLE = 'pl_omni_business_config';

/** Config do negócio (jsonb) — pl_omni_business_config, 1 linha por instância. */
class OmniConfigRepository {
	async get(instanceId: string): Promise<OmniBusinessConfigFields | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('config')
			.eq('instance_id', instanceId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data?.config as OmniBusinessConfigFields) ?? null;
	}

	async upsert(
		instanceId: string,
		config: OmniBusinessConfigFields,
	): Promise<OmniBusinessConfigFields> {
		const { data, error } = await supabase
			.from(TABLE)
			.upsert(
				{
					instance_id: instanceId,
					config,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: 'instance_id' },
			)
			.select('config')
			.single();
		if (error) throw new Error(error.message);
		return data.config as OmniBusinessConfigFields;
	}
}

export const omniConfigRepository = new OmniConfigRepository();
