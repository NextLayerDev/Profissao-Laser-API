import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY as string;

if (!process.env.SUPABASE_SERVICE_KEY) {
	console.warn(
		'Supabase service key not found. Some backend operations may fail due to RLS policies.',
	);
}

export const supabase = createClient(supabaseUrl, supabaseKey);
