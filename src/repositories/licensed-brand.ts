import { supabase } from '../lib/supabase.js';

const TABELA = 'pl_licensed_brand';

export interface LicensedBrand {
	id: string;
	feature_key: string;
	display_name: string;
	crest_url: string | null;
	mascot_url: string | null;
	accent_color: string | null;
	active: boolean;
	notes: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface SalvarMarcaInput {
	feature_key?: string;
	display_name?: string;
	crest_url?: string | null;
	mascot_url?: string | null;
	accent_color?: string | null;
	active?: boolean;
	notes?: string | null;
}

export const licensedBrandRepository = {
	async list(opts: { activeOnly?: boolean } = {}): Promise<LicensedBrand[]> {
		let q = supabase.from(TABELA).select('*').order('display_name');
		if (opts.activeOnly) q = q.eq('active', true);
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return (data as LicensedBrand[]) ?? [];
	},

	/** O caminho quente: o pipeline resolve a marca por aqui a cada geração. */
	async findByFeatureKey(featureKey: string): Promise<LicensedBrand | null> {
		const { data, error } = await supabase
			.from(TABELA)
			.select('*')
			.eq('feature_key', featureKey)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as LicensedBrand) ?? null;
	},

	async findById(id: string): Promise<LicensedBrand | null> {
		const { data, error } = await supabase
			.from(TABELA)
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as LicensedBrand) ?? null;
	},

	async create(
		input: SalvarMarcaInput,
		createdBy: string | null,
	): Promise<LicensedBrand> {
		const { data, error } = await supabase
			.from(TABELA)
			.insert({ ...input, created_by: createdBy })
			.select('*')
			.single();
		// 23505 = a chave já existe. Mensagem em português, porque quem vê é o
		// staff cadastrando — não um desenvolvedor lendo log.
		if (error?.code === '23505') {
			throw new Error(
				`Já existe uma marca com a chave "${input.feature_key}".`,
			);
		}
		if (error) throw new Error(error.message);
		return data as LicensedBrand;
	},

	async update(id: string, input: SalvarMarcaInput): Promise<LicensedBrand> {
		const { data, error } = await supabase
			.from(TABELA)
			.update({ ...input, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select('*')
			.single();
		if (error?.code === '23505') {
			throw new Error(
				`Já existe uma marca com a chave "${input.feature_key}".`,
			);
		}
		if (error) throw new Error(error.message);
		return data as LicensedBrand;
	},

	async remove(id: string): Promise<void> {
		const { error } = await supabase.from(TABELA).delete().eq('id', id);
		if (error) throw new Error(error.message);
	},
};
