import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { vectorLibraryService } from '../services/vector-library.js';
import {
	createFolderSchema,
	updateFileSchema,
	updateFolderSchema,
} from '../types/vector-library.js';

async function requireAdmin(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<boolean> {
	const user = request.currentUser;
	if (!user) {
		reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Not authenticated',
		});
		return false;
	}

	const { data: platformUser } = await supabase
		.from('Users')
		.select('id')
		.or(`id.eq.${user.id},email.eq.${user.email}`)
		.maybeSingle();

	if (!platformUser) {
		reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Admin access required',
		});
		return false;
	}

	return true;
}

export const getContentsController = async (
	request: FastifyRequest<{ Querystring: { parentId?: string } }>,
	reply: FastifyReply,
) => {
	const parentId = request.query.parentId ?? null;
	const { data: contents, error } =
		await vectorLibraryService.getContents(parentId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(contents);
};

export const getBreadcrumbsController = async (
	request: FastifyRequest<{ Querystring: { folderId?: string } }>,
	reply: FastifyReply,
) => {
	const folderId = request.query.folderId ?? null;
	const { data: breadcrumbs, error } =
		await vectorLibraryService.getBreadcrumbs(folderId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(breadcrumbs);
};

export const createFolderController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const data = createFolderSchema.parse(request.body);
		const { data: folder, error } =
			await vectorLibraryService.createFolder(data);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.status(201).send(folder);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateFolderController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { id } = request.params;
		const { name } = updateFolderSchema.parse(request.body);
		const { data: folder, error } = await vectorLibraryService.updateFolder(
			id,
			name,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		if (!folder) return reply.status(404).send({ message: 'Folder not found' });
		return reply.send(folder);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteFolderController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	const { id } = request.params;
	const { error } = await vectorLibraryService.deleteFolder(id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};

export const uploadFileController = async (
	request: FastifyRequest<{ Querystring: { folderId?: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const folderId = request.query.folderId ?? null;
		const parts = request.parts();
		let fileBuffer: Buffer | undefined;
		let filename = 'file';
		let mimetype = 'application/octet-stream';
		let size: number | null = null;
		let customName: string | undefined;

		for await (const part of parts) {
			if (part.type === 'field' && part.fieldname === 'name') {
				customName = part.value as string;
			} else if (part.type === 'file' && part.fieldname === 'file') {
				fileBuffer = await part.toBuffer();
				filename = part.filename ?? 'file';
				mimetype = part.mimetype;
				size = fileBuffer.byteLength;
			}
		}

		if (!fileBuffer) {
			return reply.status(400).send({ message: 'File is required' });
		}

		const { data: file, error } = await vectorLibraryService.createFile(
			folderId,
			fileBuffer,
			filename,
			mimetype,
			size,
			customName,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		return reply.status(201).send(file);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateFileController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const { id } = request.params;
		const { name } = updateFileSchema.parse(request.body);
		const { data: file, error } = await vectorLibraryService.updateFile(
			id,
			name,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(400).send({ message });
		}
		if (!file) return reply.status(404).send({ message: 'File not found' });
		return reply.send(file);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteFileController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	const { id } = request.params;
	const { error } = await vectorLibraryService.deleteFile(id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};
