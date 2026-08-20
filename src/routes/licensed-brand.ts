import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isStaffRole } from '../lib/external-auth.js';
import { uploadToolOutput } from '../lib/storage.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { volumePorMarca } from '../repositories/licensed-art.js';
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
	// Opcional no schema para a API continuar de pé antes da migration da coluna.
	accent_color: z.string().nullable().optional(),
	active: z.boolean(),
	notes: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});

const CHAVE = /^[a-z0-9]+:[a-z0-9-]+$/;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A cor oficial do clube, usada como fundo do campo do escudo na tela de
 * geração. Vazio é legítimo (nem toda marca tem uma cor chapada que funcione),
 * e valor fora do formato vira nulo em vez de derrubar o cadastro — cor é
 * decoração, não pode impedir o staff de salvar a marca.
 */
function corDeMarca(valor: string | undefined): string | null {
	const v = valor?.trim();
	if (!v) return null;
	return HEX.test(v) ? v.toLowerCase() : null;
}

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
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista as marcas licenciadas. Aluno vê só as ativas; staff vê tudo.',
				querystring: z.object({ activeOnly: z.string().optional() }),
				response: { 200: z.array(marcaSchema), 500: ErrorSchema },
				tags: ['Licensed Brands'],
			},
		},
		async (request, reply) => {
			const q = request.query as { activeOnly?: string };
			const staff = isStaffRole(request.currentRole);
			// Marca inativa é contrato que caiu: some da tela de quem gera, mas
			// continua no cadastro do staff. Mesmo padrão do banco de prompts.
			const marcas = await licensedBrandRepository.list({
				activeOnly: staff ? q.activeOnly === 'true' : true,
			});
			if (staff) return reply.send(marcas);
			// `notes` é anotação interna do contrato (valor, prazo, contato). Não
			// vai para o aluno.
			return reply.send(marcas.map((m) => ({ ...m, notes: null })));
		},
	);

	/**
	 * VOLUMETRIA por marca e por mês — quantas peças o escudo de cada clube
	 * gerou. É o número que se leva para a mesa do licenciante.
	 *
	 * Staff-only: é o consumo de todos os alunos junto, e não é assunto de
	 * aluno nenhum.
	 */
	server.get(
		'/api/licensed-brands/volume',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Peças licenciadas por marca e por mês (staff).',
				querystring: z.object({
					featureKey: z.string().optional(),
					/** `YYYY-MM-01` — o primeiro mês a contar. */
					desde: z.string().optional(),
				}),
				response: {
					200: z.array(
						z.object({
							feature_key: z.string(),
							display_name: z.string().nullable(),
							marca_ativa: z.boolean().nullable(),
							mes: z.string(),
							pecas: z.number(),
							pecas_validas: z.number(),
							pecas_revogadas: z.number(),
							rodadas: z.number(),
							lotes: z.number(),
							alunos: z.number(),
							primeira: z.string(),
							ultima: z.string(),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Licensed Brands'],
			},
		},
		async (request, reply) => {
			const q = request.query as { featureKey?: string; desde?: string };
			return reply.send(
				await volumePorMarca({ featureKey: q.featureKey, desde: q.desde }),
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
						accent_color: corDeMarca(campos.accent_color),
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
					...(campos.accent_color !== undefined && {
						accent_color: corDeMarca(campos.accent_color),
					}),
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
