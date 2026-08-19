import crypto from 'node:crypto';
import axios from 'axios';

const BUNNY_STORAGE_API_KEY = process.env.BUNNY_STORAGE_API_KEY ?? '';
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE ?? '';
const BUNNY_STORAGE_HOSTNAME = process.env.BUNNY_STORAGE_HOSTNAME ?? '';
const BUNNY_CDN_HOSTNAME = process.env.BUNNY_CDN_HOSTNAME ?? '';
const BUNNY_STREAM_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID ?? '';
const BUNNY_STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY ?? '';

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

/**
 * Apaga um arquivo do storage pela URL pública que `upload` devolveu.
 *
 * Exportado porque a entrega de um LOTE é tudo-ou-nada: se a peça 37 falhar,
 * as 36 que já subiram viram lixo com código que ninguém pagou.
 */
export async function deleteByUrl(url: string): Promise<void> {
	const prefix = `https://${BUNNY_CDN_HOSTNAME}/`;
	if (!url.startsWith(prefix)) return;
	const filePath = url.slice(prefix.length);
	try {
		await axios.delete(
			`https://${BUNNY_STORAGE_HOSTNAME}/${BUNNY_STORAGE_ZONE}/${filePath}`,
			{ headers: { AccessKey: BUNNY_STORAGE_API_KEY } },
		);
	} catch (err) {
		// Arquivo já ausente no storage (404) = estado desejado; remover algo que
		// não existe é no-op idempotente. Re-lança qualquer outro erro.
		if (axios.isAxiosError(err) && err.response?.status === 404) return;
		throw err;
	}
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

export async function uploadCustomerAvatar(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('customer-avatars', buffer, path, mimetype);
}

export async function uploadCustomerBanner(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('customer-banners', buffer, path, mimetype);
}

export async function uploadParameterImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('parameter-images', buffer, path, mimetype);
}

export async function uploadDoubtFile(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('doubt-files', buffer, path, mimetype);
}

export async function uploadVectorSupportFile(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('vector-support-files', buffer, path, mimetype);
}

export async function uploadFaqImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('faq-images', buffer, path, mimetype);
}

export async function uploadVectorLibraryFile(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('vector-library', buffer, path, mimetype);
}

export async function uploadPreviaImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('previas', buffer, path, mimetype);
}

export async function deletePreviaImageByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function uploadTemplateImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('templates', buffer, path, mimetype);
}

export async function deleteTemplateImageByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function uploadDesignThumbnail(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('designs', buffer, path, mimetype);
}

export async function deleteDesignThumbnailByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function uploadLaserProductImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('laser-products', buffer, path, mimetype);
}

export async function deleteLaserProductImageByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function uploadWatermarkImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('watermarks', buffer, path, mimetype);
}

export async function deleteWatermarkImageByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function uploadLaserLineTypeImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('laser-line-types', buffer, path, mimetype);
}

export async function deleteLaserLineTypeImageByUrl(
	url: string,
): Promise<void> {
	return deleteByUrl(url);
}

export async function deleteVectorLibraryFileByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function deleteSvgByUrl(url: string): Promise<void> {
	return deleteByUrl(url);
}

export async function uploadVectorOriginalImage(
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	return upload('vectors-original', buffer, path, mimetype);
}

export async function uploadVectorPng(
	buffer: Buffer,
	path: string,
): Promise<string> {
	return upload('vectors-preview', buffer, path, 'image/png');
}

export async function uploadLaserPrepPng(
	buffer: Buffer,
	path: string,
): Promise<string> {
	return upload('laser-prep', buffer, path, 'image/png');
}

/**
 * Upload genérico para saídas da Fábrica de Tools (motor genérico). O `folder`
 * vem da ToolDefinition (autorada por admin) — ainda assim é higienizado pra um
 * conjunto seguro de caracteres antes de compor o path no Bunny.
 */
export async function uploadToolOutput(
	folder: string,
	buffer: Buffer,
	path: string,
	mimetype: string,
): Promise<string> {
	const safeFolder =
		folder
			.replace(/[^a-zA-Z0-9._/-]/g, '_')
			.replace(/\.\.+/g, '.')
			.replace(/^\/+|\/+$/g, '')
			.slice(0, 80) || 'tool-output';
	return upload(safeFolder, buffer, path, mimetype);
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
