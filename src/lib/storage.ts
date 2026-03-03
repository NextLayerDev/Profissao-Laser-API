import type { Readable } from 'node:stream';
import { supabase } from './supabase.js';

async function upload(
	bucket: string,
	body: Buffer | Readable,
	path: string,
	mimetype: string,
): Promise<string> {
	const { error } = await supabase.storage
		.from(bucket)
		.upload(path, body, { contentType: mimetype, upsert: false });

	if (error) throw new Error(error.message);

	const { data } = supabase.storage.from(bucket).getPublicUrl(path);
	return data.publicUrl;
}

export async function uploadMaterialFile(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('lesson-materials', buffer, path, mimetype);
}

export async function uploadLessonVideo(
	stream: Readable,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('lesson-materials', stream, path, mimetype);
}

export async function uploadCourseImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('courses-images', buffer, path, mimetype);
}
