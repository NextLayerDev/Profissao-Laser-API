import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	collectionFacetsController,
	collectionFeedbackController,
	collectionNearestController,
	createCollectionEntryController,
	deleteCollectionEntryController,
	exportCollectionController,
	getCollectionEntryController,
	importCollectionController,
	listCollectionController,
	reviewCollectionEntryController,
	updateCollectionEntryController,
} from '../controllers/tool-collection.js';
import { authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

/**
 * COLEÇÕES de uma tool — a API genérica de dataset da Fábrica.
 *
 * Todas as rotas usam `authenticateCustomer`: quem pode fazer o quê NÃO é
 * decidido pelo middleware e sim pela `definition` da tool
 * (`collections.<nome>.submissions.who`) + o papel de quem chama. É isso que
 * permite uma coleção aceitar submissão de aluno com moderação e outra ser só
 * de leitura, sem rota nova nem middleware novo.
 *
 * Rotas estáticas (`/facets`, `/nearest`, `/import`, `/export`) são declaradas
 * ANTES de `/:id` — o Fastify prioriza estática sobre paramétrica, mas a ordem
 * explícita evita surpresa para quem for editar depois.
 */

const keyCollection = z.object({
	key: z.string().min(1).max(60),
	collection: z.string().min(1).max(40),
});
const keyCollectionId = keyCollection.extend({ id: z.string() });

export async function toolCollectionRoute(app: FastifyInstance) {
	const base = '/api/tools/:key/c/:collection';

	app.get(
		`${base}/facets`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Facetas da coleção com contagem por opção, limites das faixas e ordenações disponíveis.',
				params: keyCollection,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 500: ErrorSchema },
			},
		},
		collectionFacetsController,
	);

	app.get(
		`${base}/nearest`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Registro mais próximo por interpolação (só aprovados). Eixos e agrupamento vêm de `collection.nearest`.',
				params: keyCollection,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 400: ErrorSchema, 500: ErrorSchema },
			},
		},
		collectionNearestController,
	);

	app.get(
		`${base}/export`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Exporta a coleção em CSV (staff).',
				params: keyCollection,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 403: ErrorSchema, 500: ErrorSchema },
			},
		},
		exportCollectionController,
	);

	app.post(
		`${base}/import`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Importa em lote via `csv` (texto com cabeçalho) ou `rows` (array). Staff. Valida linha a linha e não insere nada se houver erro.',
				params: keyCollection,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 400: ErrorSchema, 403: ErrorSchema, 413: ErrorSchema },
			},
		},
		importCollectionController,
	);

	app.get(
		base,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista registros com facetas (`f.<campo>=valor` ou `f.<campo>=min..max`), busca (`q`), ordenação (`sort`) e paginação (`page`, `page_size`).',
				params: keyCollection,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 500: ErrorSchema },
			},
		},
		listCollectionController,
	);

	app.post(
		base,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Cria um registro. A permissão e o status inicial saem de `collection.submissions`.',
				params: keyCollection,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 400: ErrorSchema, 403: ErrorSchema },
			},
		},
		createCollectionEntryController,
	);

	app.get(
		`${base}/:id`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Detalhe de um registro.',
				params: keyCollectionId,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 404: ErrorSchema, 500: ErrorSchema },
			},
		},
		getCollectionEntryController,
	);

	app.patch(
		`${base}/:id`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Edita um registro. Staff sempre; o autor apenas se `submissions.ownerEditable` (e a edição devolve o registro à moderação).',
				params: keyCollectionId,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
			},
		},
		updateCollectionEntryController,
	);

	app.delete(
		`${base}/:id`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Apaga um registro (staff, ou o próprio autor).',
				params: keyCollectionId,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 403: ErrorSchema, 404: ErrorSchema },
			},
		},
		deleteCollectionEntryController,
	);

	app.post(
		`${base}/:id/review`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Modera um registro: `approved` ou `rejected` + nota (staff).',
				params: keyCollectionId,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 400: ErrorSchema, 403: ErrorSchema },
			},
		},
		reviewCollectionEntryController,
	);

	app.post(
		`${base}/:id/feedback`,
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'like / save / rating / result. `remove: true` desfaz. Devolve o registro com score e stats já recalculados.',
				params: keyCollectionId,
				tags: ['Coleções'],
				security: [{ bearerAuth: [] }],
				response: { 400: ErrorSchema, 404: ErrorSchema },
			},
		},
		collectionFeedbackController,
	);
}
