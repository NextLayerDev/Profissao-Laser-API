import axios from 'axios';
import crypto from 'crypto';

const BUNNY_STORAGE_API_KEY = process.env.BUNNY_STORAGE_API_KEY!;
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE!;
const BUNNY_STORAGE_HOSTNAME = process.env.BUNNY_STORAGE_HOSTNAME!;
const BUNNY_CDN_HOSTNAME = process.env.BUNNY_CDN_HOSTNAME!;
const BUNNY_STREAM_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID!;
const BUNNY_STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY!;

async function upload(
	folder: string,
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	const fullPath = `${folder}/${path}`;
	const url = `https://${BUNNY_STORAGE_HOSTNAME}/${BUNNY_STORAGE_ZONE}/${fullPath}`;
	await axios.put(url, buffer, {
		headers: { AccessKey: BUNNY_STORAGE_API_KEY, 'Content-Type': mimetype },
	});
	return `https://${BUNNY_CDN_HOSTNAME}/${fullPath}`;
}

async function deleteByUrl(url: string): Promise<void> {
	const prefix = `https://${BUNNY_CDN_HOSTNAME}/`;
	if (!url.startsWith(prefix)) return;
	const filePath = url.slice(prefix.length);
	await axios.delete(
		`https://${BUNNY_STORAGE_HOSTNAME}/${BUNNY_STORAGE_ZONE}/${filePath}`,
		{ headers: { AccessKey: BUNNY_STORAGE_API_KEY } },
	);
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

export async function uploadCommunityFile(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('community-files', buffer, path, mimetype);
}

export async function uploadVectorLibraryFile(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('vector-library', buffer, path, mimetype);
}

export async function deleteVectorLibraryFileByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function deleteSvgByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function createBunnyStreamUpload(title: string): Promise<{
	videoId: string;
	tusEndpoint: string;
	authSignature: string;
	authExpire: number;
}> {
	const response = await axios.post(
		`https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos`,
		{ title },
		{
			headers: {
				AccessKey: BUNNY_STREAM_API_KEY,
				'Content-Type': 'application/json',
			},
		},
	);
	const videoId: string = response.data.guid;

	const authExpire = Math.floor(Date.now() / 1000) + 3600;
	const authSignature = crypto
		.createHash('sha256')
		.update(
			`${BUNNY_STREAM_LIBRARY_ID}${BUNNY_STREAM_API_KEY}${authExpire}${videoId}`,
		)
		.digest('hex');

	return {
		videoId,
		tusEndpoint: 'https://video.bunnycdn.com/tusupload',
		authSignature,
		authExpire,
	};
}

export function getBunnyVideoUrl(videoId: string): string {
	return `https://iframe.mediadelivery.net/play/${BUNNY_STREAM_LIBRARY_ID}/${videoId}`;
}
