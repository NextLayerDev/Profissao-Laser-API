import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uploadToolOutput } from '../lib/storage.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { licensedBrandRepository } from '../repositories/licensed-brand.js';
import { ErrorSchema } from '../types/error.js';

const MAX = 5 * 1024 * 1024;
const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const marcaSchema = z.object({
	id: z.string(),
	feature_key: z.string(),
	display_name: z.string(),
	crest_url: z.string().nullable(),
	mascot_url: z.string().nullable(),
	active: z.boolean(),
	notes: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});

const CHAVE = /^[a-z0-9]+:[a-z0-9-]+$/;

/**
 * Marcas licenciadas — o cadastro do escudo, do mascote e do nome público.
 *
 * Existe separado do Banco do Admin porque a arte pertence à MARCA e não ao
 * prompt: um clube com caneca, capinha e chaveiro precisa de um upload só, e
 * trocar a arte oficial tem de atualizar tudo de uma vez.
 *
 * Leitura é aberta a qualquer autenticado (a tela de geração precisa do nome e
 * do escudo); escrita é só staff.
 */
export async function licensedBrandRoute(server: FastifyInstance) {
	server.get(
		'/api/licensed-brands',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Lista as marcas licenciadas cadastradas (staff).',
				querystring: z.object({ activeOnly: z.string().optional() }),
				response: { 200: z.array(marcaSchema), 500: ErrorSchema },
				tags: ['Licensed Brands'],
			},
		},
		async (request, reply) => {
			const q = request.query as { activeOnly?: string };
			return reply.send(
				await licensedBrandRepository.list({
					activeOnly: q.activeOnly === 'true',
				}),
			);
		},
	);

	/** Multipart: campos de texto + `crest`/`mascot` como arquivo. */
	async function lerMultipart(request: FastifyRequest) {
		const campos: Record<string, string> = {};
		const imagens: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				if (!MIMES.includes(part.mimetype)) {
					throw new Error('Tipo de imagem inválido (png/jpg/webp/svg).');
				}
				const buf = await part.toBuffer();
				if (buf.byteLength > MAX)
					throw new Error('Imagem grande demais (máx 5MB).');
				const ext = part.mimetype.split('/')[1].replace('+xml', '');
				imagens[part.fieldname] = await uploadToolOutput(
					'licensed-brands',
					buf,
					`${crypto.randomUUID()}.${ext}`,
					part.mimetype,
				);
			} else {
				campos[part.fieldname] = part.value as string;
			}
		}
		return { campos, imagens };
	}

	server.post(
		'/api/licensed-brands',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Cria uma marca licenciada (staff, multipart).',
				consumes: ['multipart/form-data'],
				response: { 201: marcaSchema, 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Licensed Brands'],
			},
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			try {
				const { campos, imagens } = await lerMultipart(request);
				const chave = (campos.feature_key ?? '').trim().toLowerCase();
				if (!CHAVE.test(chave)) {
					throw new Error(
						'Chave inválida. Use o formato `tipo:nome`, ex.: clube:corinthians.',
					);
				}
				if (!campos.display_name?.trim()) {
					throw new Error('O nome público é obrigatório.');
				}
				const marca = await licensedBrandRepository.create(
					{
						feature_key: chave,
						display_name: campos.display_name.trim(),
						crest_url: imagens.crest ?? null,
						mascot_url: imagens.mascot ?? null,
						active: campos.active !== 'false',
						notes: campos.notes?.trim() || null,
					},
					request.currentUser?.id ?? null,
				);
				return reply.status(201).send(marca);
			} catch (err) {
				return reply
					.status(400)
					.send({ message: err instanceof Error ? err.message : 'Erro' });
			}
		},
	);

	server.patch(
		'/api/licensed-brands/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Edita uma marca licenciada (staff, multipart).',
				consumes: ['multipart/form-data'],
				params: z.object({ id: z.string() }),
				response: { 200: marcaSchema, 400: ErrorSchema, 404: ErrorSchema },
				tags: ['Licensed Brands'],
			},
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			try {
				const { id } = request.params as { id: string };
				const atual = await licensedBrandRepository.findById(id);
				if (!atual)
					return reply.status(404).send({ message: 'Marca não encontrada.' });

				const { campos, imagens } = await lerMultipart(request);
				const chave = campos.feature_key?.trim().toLowerCase();
				if (chave && !CHAVE.test(chave)) {
					throw new Error('Chave inválida. Use `tipo:nome`.');
				}
				const marca = await licensedBrandRepository.update(id, {
					...(chave && { feature_key: chave }),
					...(campos.display_name?.trim() && {
						display_name: campos.display_name.trim(),
					}),
					// Imagem não reenviada preserva a que já estava: salvar para trocar
					// o nome não pode apagar o escudo.
					...(imagens.crest !== undefined && { crest_url: imagens.crest }),
					...(imagens.mascot !== undefined && { mascot_url: imagens.mascot }),
					...(campos.removeMascot === 'true' && { mascot_url: null }),
					...(campos.active !== undefined && {
						active: campos.active !== 'false',
					}),
					...(campos.notes !== undefined && {
						notes: campos.notes.trim() || null,
					}),
				});
				return reply.send(marca);
			} catch (err) {
				return reply
					.status(400)
					.send({ message: err instanceof Error ? err.message : 'Erro' });
			}
		},
	);

	server.delete(
		'/api/licensed-brands/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove uma marca licenciada (staff).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 403: ErrorSchema },
				tags: ['Licensed Brands'],
			},
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			const { id } = request.params as { id: string };
			await licensedBrandRepository.remove(id);
			return reply.status(204).send();
		},
	);
}
