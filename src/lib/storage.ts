import { supabase } from './supabase.js';

async function upload(
	bucket: string,
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	const { error } = await supabase.storage
		.from(bucket)
		.upload(path, buffer, { contentType: mimetype, upsert: false });

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
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('lesson-materials', buffer, path, mimetype);
}

export async function uploadCourseImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('courses-images', buffer, path, mimetype);
}
