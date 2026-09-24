import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage.js', () => ({
	uploadCommunityFile: vi.fn(
		async (_b: Buffer, path: string) =>
			`https://cdn.test/community-files/${path}`,
	),
}));
vi.mock('@/lib/sentry.js', () => ({
	withCapture: (fn: () => unknown) => fn(),
}));
vi.mock('@/services/community.js', () => ({ communityService: {} }));
vi.mock('@/lib/external-auth.js', () => ({ isStaffRole: () => false }));

import {
	readPostMultipart,
	readProjectMultipart,
} from '@/controllers/community.js';

/** Request fake com só o que readPostMultipart usa: `parts()`. */
const fakeRequest = (parts: unknown[]) =>
	({
		parts: () => ({
			async *[Symbol.asyncIterator]() {
				for (const p of parts) yield p;
			},
		}),
	}) as never;

const field = (value: string, fieldname = 'content') => ({
	type: 'field',
	fieldname,
	value,
});

const file = (mimetype: string, filename: string, bytes = 10) => ({
	type: 'file',
	fieldname: 'file',
	mimetype,
	filename,
	toBuffer: async () => Buffer.alloc(bytes),
});

describe('readPostMultipart', () => {
	beforeEach(() => vi.clearAllMocks());

	it('vídeo vai para `video`, imagem para `image`', async () => {
		const comVideo = await readPostMultipart(
			fakeRequest([field('olha meu corte'), file('video/mp4', 'corte.mp4')]),
		);
		expect(comVideo.video).toMatch(/\.mp4$/);
		expect(comVideo.image).toBeUndefined();

		const comImagem = await readPostMultipart(
			fakeRequest([field('foto'), file('image/png', 'foto.png')]),
		);
		expect(comImagem.image).toMatch(/\.png$/);
		expect(comImagem.video).toBeUndefined();
	});

	it('recusa arquivo que não é imagem nem vídeo', async () => {
		await expect(
			readPostMultipart(
				fakeRequest([field('oi'), file('application/pdf', 'a.pdf')]),
			),
		).rejects.toThrow(/imagem ou um vídeo/);
	});

	it('recusa imagem acima de 10 MB', async () => {
		await expect(
			readPostMultipart(
				fakeRequest([
					field('oi'),
					file('image/png', 'grande.png', 11 * 1024 * 1024),
				]),
			),
		).rejects.toThrow(/grande demais/);
	});

	it('recusa post sem conteúdo', async () => {
		await expect(readPostMultipart(fakeRequest([field('')]))).rejects.toThrow();
	});
});

describe('readProjectMultipart', () => {
	it('publica projeto com vídeo e ignora campos opcionais vazios', async () => {
		const project = await readProjectMultipart(
			fakeRequest([
				field('Porta-copos', 'title'),
				field('Tobias', 'author'),
				field('', 'material'),
				file('video/quicktime', 'corte.mov'),
			]),
		);
		expect(project.video).toMatch(/\.mov$/);
		expect(project.img).toBeUndefined();
		expect(project.material).toBeUndefined();
	});

	it('recusa projeto sem título', async () => {
		await expect(
			readProjectMultipart(fakeRequest([field('Tobias', 'author')])),
		).rejects.toThrow();
	});
});
