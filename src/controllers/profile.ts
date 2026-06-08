import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadCustomerAvatar } from '../lib/storage.js';
import { profileService } from '../services/profile.js';
import {
	changeMyPasswordSchema,
	updateProfileSchema,
} from '../types/customer.js';

const ALLOWED_IMAGE_MIMETYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

class ProfileController {
	async getMyProfile(request: FastifyRequest, reply: FastifyReply) {
		const id = request.currentCustomer?.id;
		if (!id) return reply.status(401).send({ message: 'Unauthorized' });
		const { data, error } = await profileService.getMyProfile(
			id,
			request.currentUser?.name ?? null,
			request.currentUser?.email ?? '',
		);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		return reply.status(200).send(data);
	}

	async updateMyProfile(request: FastifyRequest, reply: FastifyReply) {
		const id = request.currentCustomer?.id;
		if (!id) return reply.status(401).send({ message: 'Unauthorized' });
		const body = updateProfileSchema.parse(request.body);
		const token = (request.headers.authorization ?? '').replace(
			/^Bearer\s+/i,
			'',
		);
		const { data, error } = await profileService.updateMyProfile(id, body, {
			token: token || undefined,
			fallbackName: request.currentUser?.name ?? null,
			fallbackEmail: request.currentUser?.email ?? null,
		});
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		return reply.status(200).send(data);
	}

	async uploadAvatar(request: FastifyRequest, reply: FastifyReply) {
		const id = request.currentCustomer?.id;
		if (!id) return reply.status(401).send({ message: 'Unauthorized' });

		const file = await request.file();
		if (!file) return reply.status(400).send({ message: 'No file provided' });
		if (!ALLOWED_IMAGE_MIMETYPES.includes(file.mimetype)) {
			return reply
				.status(400)
				.send({ message: 'Invalid file type. Allowed: jpeg, png, webp, gif' });
		}
		const buffer = await file.toBuffer();
		if (buffer.byteLength > MAX_IMAGE_SIZE) {
			return reply
				.status(400)
				.send({ message: 'File too large. Maximum size is 5MB' });
		}

		const ext = file.mimetype.split('/')[1];
		const url = await uploadCustomerAvatar(
			buffer,
			`${id}-${crypto.randomUUID()}.${ext}`,
			file.mimetype,
		);
		const { data, error } = await profileService.setMyAvatar(id, url);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		return reply.status(200).send(data);
	}

	async removeAvatar(request: FastifyRequest, reply: FastifyReply) {
		const id = request.currentCustomer?.id;
		if (!id) return reply.status(401).send({ message: 'Unauthorized' });
		const { data, error } = await profileService.removeMyAvatar(id);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		return reply.status(200).send(data);
	}

	async changeMyPassword(request: FastifyRequest, reply: FastifyReply) {
		const id = request.currentCustomer?.id;
		const email = request.currentUser?.email;
		if (!id || !email) {
			return reply.status(401).send({ message: 'Unauthorized' });
		}
		const body = changeMyPasswordSchema.parse(request.body);
		const { error } = await profileService.changeMyPassword(
			id,
			email,
			body.currentPassword,
			body.newPassword,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			const status = message === 'Senha atual incorreta' ? 400 : 500;
			return reply.status(status).send({ message });
		}
		return reply.status(200).send({ message: 'Senha atualizada' });
	}
}

export const profileController = new ProfileController();
