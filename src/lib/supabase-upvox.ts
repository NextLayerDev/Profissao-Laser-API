import { createClient } from '@supabase/supabase-js';

// Banco do upvox-api (novo). Diferente do `supabase` legado (lib/supabase.ts):
// aqui os ids batem com `public.users(id)` do upvox, então tabelas cujo
// `customer_id` referencia o usuário do upvox (ex.: customer_vectors) vivem
// neste projeto, não no legado `Customers`.
const supabaseUrl = process.env.UPVOX_SUPABASE_URL as string;
const supabaseServiceKey = process.env
	.UPVOX_SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl) {
	throw new Error('UPVOX_SUPABASE_URL is not defined in .env');
}
if (!supabaseServiceKey) {
	throw new Error('UPVOX_SUPABASE_SERVICE_ROLE_KEY is not defined in .env');
}

export const supabaseUpvox = createClient(supabaseUrl, supabaseServiceKey, {
	auth: { persistSession: false },
});
