import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseServiceKey) {
	throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined in .env');
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
	auth: { persistSession: false },
});
