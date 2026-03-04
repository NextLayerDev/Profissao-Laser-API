import { supabase } from './supabase.js';

const LESSON_MATERIALS_BUCKET = 'lesson-materials';

export async function createSignedUploadUrl(
	path: string,
): Promise<{ path: string; token: string }> {
	const { data, error } = await supabase.storage
		.from(LESSON_MATERIALS_BUCKET)
		.createSignedUploadUrl(path);

	if (error) throw new Error(error.message);
	if (!data?.path || !data?.token)
		throw new Error('Invalid signed upload URL response');
	return { path: data.path, token: data.token };
}

export function getLessonVideoPublicUrl(path: string): string {
	const { data } = supabase.storage
		.from(LESSON_MATERIALS_BUCKET)
		.getPublicUrl(path);
	return data.publicUrl;
}

async function upload(
	bucket: string,
	body: Buffer,
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

export async function uploadSvgFile(
	svgContent: string,
	path: string,
): Promise<string> {
	const buffer = Buffer.from(svgContent, 'utf-8');
	return upload('vectors', buffer, path, 'image/svg+xml');
}

export async function deleteSvgByUrl(url: string): Promise<void> {
	const marker = '/object/public/vectors/';
	const idx = url.indexOf(marker);
	if (idx === -1) return;
	const filePath = url.slice(idx + marker.length);
	const { error } = await supabase.storage.from('vectors').remove([filePath]);
	if (error) throw new Error(error.message);
}
