/**
 * One-off script to sync Supabase database password with what's stored in the provisioning job.
 * Usage: npx tsx --env-file=.env scripts/fix-db-password.ts <jobId>
 */
import { decrypt } from '../src/lib/crypto.js';
import { supabase } from '../src/lib/supabase.js';
import { updateDatabasePassword } from '../src/lib/supabase-management.js';

const jobId = process.argv[2];
if (!jobId) {
	console.error(
		'Usage: npx tsx --env-file=.env scripts/fix-db-password.ts <jobId>',
	);
	process.exit(1);
}

async function main() {
	const { data: job, error } = await supabase
		.from('pl_provisioning_job')
		.select('id, slug, supabase_project_ref, supabase_db_pass_encrypted')
		.eq('id', jobId)
		.single();

	if (error || !job) {
		console.error('Job not found:', error?.message);
		process.exit(1);
	}

	if (!job.supabase_project_ref || !job.supabase_db_pass_encrypted) {
		console.error(
			'Job is missing supabase_project_ref or supabase_db_pass_encrypted',
		);
		process.exit(1);
	}

	const dbPass = decrypt(job.supabase_db_pass_encrypted);
	console.log(`Job: ${job.id} (slug: ${job.slug})`);
	console.log(`Project ref: ${job.supabase_project_ref}`);
	console.log(`Decrypted password length: ${dbPass.length} chars`);
	console.log('Updating database password...');

	await updateDatabasePassword(job.supabase_project_ref, dbPass);

	console.log('✅ Database password synced successfully!');
	console.log(
		'The deployed system should now be able to connect to the database.',
	);
}

main().catch((err) => {
	console.error('Failed:', err.message);
	process.exit(1);
});
