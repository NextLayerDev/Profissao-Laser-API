import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashCodigo, normalizarCodigo } from '../lib/license-code.js';
import { ampliarLoteLicenciado } from '../lib/licensed-piece.js';
import { authenticateCustomer } from '../middleware/auth.js';
import {
	arquivarDoCliente,
	buscarPorCodigo,
	listarDoCliente,
} from '../repositories/licensed-art.js';
import { licensedBrandRepository } from '../repositories/licensed-brand.js';
import { ErrorSchema } from '../types/error.js';

const codigoParams = z.object({ code: z.string().min(6).max(64) });

const verificacaoSchema = z.object({
	code: z.string(),
	valid: z.boolean(),
	status: z.enum(['active', 'revoked']),
	/** O que foi licenciado, em linguagem de gente. */
	content: z.string(),
	featureKey: z.string(),
	licensorName: z.string().nullable(),
	/** O cadastro atual da marca — o escudo é o que identifica o licenciante. */
	brandName: z.string().nullable(),
	crestUrl: z.string().nullable(),
	accentColor: z.string().nullable(),
	previewUrl: z.string().nullable(),
	issuedAt: z.string(),
	checkedAt: z.string(),
});

const hashDeCodigoSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TEMPO_LIMITE_VERIFICADOR_LEGADO_MS = 5_000;

type VerificacaoPublica = z.infer<typeof verificacaoSchema>;

/**
 * QR gravado não pode ser refeito. Por um período de migração, alguns códigos
 * históricos continuam apontando para produção, embora a licença tenha ficado
 * no ambiente dev. A ponte é deliberadamente fechada: só hashes explicitamente
 * configurados podem consultar o verificador público de dev.
 *
 * Não aceitamos URL com caminho, query, credencial ou protocolo não seguro. A
 * env é uma origem, não uma URL livre que um código possa transformar em SSRF.
 */
function configuracaoDoVerificadorLegado(): {
	origin: string;
	hashesPermitidos: Set<string>;
} | null {
	const origemBruta = process.env.LICENSED_ART_LEGACY_ORIGIN?.trim();
	const hashesBrutos = process.env.LICENSED_ART_LEGACY_CODE_HASHES?.trim();
	if (!origemBruta || !hashesBrutos) return null;

	let origem: URL;
	try {
		origem = new URL(origemBruta);
	} catch {
		return null;
	}
	if (
		origem.protocol !== 'https:' ||
		origem.username ||
		origem.password ||
		origem.pathname !== '/' ||
		origem.search ||
		origem.hash
	) {
		return null;
	}

	const hashes = hashesBrutos.split(/[\s,]+/).filter(Boolean);
	if (
		hashes.length === 0 ||
		hashes.some((hash) => !hashDeCodigoSchema.safeParse(hash).success)
	) {
		return null;
	}

	return { origin: origem.origin, hashesPermitidos: new Set(hashes) };
}

/**
 * Consulta o endpoint público legado sem repassar cabeçalhos da requisição que
 * chegou à produção. Assim um token, cookie ou `x-forwarded-*` do visitante
 * nunca cruza ambientes. `redirect: manual` também impede que a env configurada
 * nos leve para outro host por redirecionamento.
 */
async function buscarVerificacaoLegada(
	origin: string,
	code: string,
): Promise<VerificacaoPublica | null> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		TEMPO_LIMITE_VERIFICADOR_LEGADO_MS,
	);
	let response: Response;
	try {
		response = await fetch(
			`${origin}/api/licensed-art/${encodeURIComponent(code)}`,
			{
				method: 'GET',
				redirect: 'manual',
				signal: controller.signal,
				headers: { accept: 'application/json' },
			},
		);
	} finally {
		clearTimeout(timeout);
	}

	// Um 404 no dev mantém o significado normal de "não encontrado". Todo o
	// resto (inclusive redirect manual) é indisponibilidade do verificador.
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`verificador legado respondeu HTTP ${response.status}`);
	}

	let corpo: unknown;
	try {
		corpo = await response.json();
	} catch {
		throw new Error('verificador legado respondeu JSON inválido');
	}
	const verificacao = verificacaoSchema.safeParse(corpo);
	if (!verificacao.success) {
		throw new Error('verificador legado respondeu um payload inválido');
	}
	// O dev tem de atestar EXATAMENTE a peça pedida, e os dois campos que
	// descrevem o veredito não podem se contradizer.
	if (
		normalizarCodigo(verificacao.data.code) !== normalizarCodigo(code) ||
		verificacao.data.valid !== (verificacao.data.status === 'active')
	) {
		throw new Error('verificador legado respondeu uma licença inconsistente');
	}

	// `safeParse` remove chaves desconhecidas: a produção nunca espelha campos
	// internos que um servidor remoto possa adicionar por acidente.
	return verificacao.data;
}

const minhaArteSchema = z.object({
	id: z.string(),
	code: z.string(),
	featureKey: z.string(),
	licensorName: z.string().nullable(),
	previewUrl: z.string().nullable(),
	promptTitle: z.string().nullable(),
	revoked: z.boolean(),
	archived: z.boolean(),
	/** O lote a que a peça pertence, e a posição dela nele. */
	batchId: z.string().nullable(),
	pieceIndex: z.number(),
	batchSize: z.number(),
	/**
	 * O dado variável desta peça — o nome, a frase — quando o lote é
	 * personalizado. É o que deixa o aluno achar "a caneca da Marina" sem abrir
	 * trinta arquivos. Nulo em lote uniforme.
	 */
	pieceLabel: z.string().nullable(),
	/** A tiragem deste lote pode crescer? (só se a arte-mãe foi guardada) */
	canGrow: z.boolean(),
	issuedAt: z.string(),
});

/**
 * Autenticidade da arte licenciada.
 *
 * A verificação é PÚBLICA e sem login, de propósito: quem escaneia o QR gravado
 * num chaveiro comprado numa feira não tem conta na plataforma. Um QR que só
 * funciona para quem já é cliente não serve para nada.
 */
export async function licensedArtRoute(server: FastifyInstance) {
	server.get(
		'/api/licensed-art/:code',
		{
			schema: {
				description:
					'Verificação pública do QR gravado na peça. Sem autenticação.',
				params: codigoParams,
				response: {
					200: verificacaoSchema,
					404: ErrorSchema,
					502: ErrorSchema,
				},
				tags: ['Licensed Art'],
			},
		},
		async (request, reply) => {
			const { code } = request.params as z.infer<typeof codigoParams>;
			const art = await buscarPorCodigo(code);

			// Código inexistente é 404, NÃO uma resposta com `valid:false`.
			// "não existe" e "existe mas foi revogada" são coisas diferentes, e
			// juntar as duas esconderia uma falsificação atrás de uma revogação.
			if (!art) {
				const legado = configuracaoDoVerificadorLegado();
				if (legado?.hashesPermitidos.has(hashCodigo(code))) {
					try {
						const verificacao = await buscarVerificacaoLegada(
							legado.origin,
							code,
						);
						if (verificacao) {
							reply.header('Cache-Control', 'public, max-age=60');
							return reply.send(verificacao);
						}
					} catch (err) {
						request.log.error({ err }, 'verificador legado indisponível');
						return reply.status(502).send({
							message: 'Não foi possível verificar esta licença agora.',
							code: 'legacy_verifier_unavailable',
						});
					}
				}
				return reply
					.status(404)
					.send({ message: 'Código não encontrado.', code: 'not_found' });
			}

			// O escudo e a cor da marca vêm do cadastro ATUAL, e o nome congelado na
			// licença fica de reserva: se a marca saiu do cadastro depois de a peça
			// existir, o QR gravado tem de continuar dizendo quem licenciou.
			//
			// Marca inativa (contrato encerrado) NÃO some daqui: o veredito da peça
			// é `revoked_at`, não o estado do contrato de hoje.
			//
			// Falha na busca da marca não derruba a verificação — a resposta à
			// pergunta "isto é oficial?" não depende de decoração.
			let marca: Awaited<
				ReturnType<typeof licensedBrandRepository.findByFeatureKey>
			> = null;
			try {
				marca = await licensedBrandRepository.findByFeatureKey(art.feature_key);
			} catch (err) {
				request.log.warn({ err }, 'marca da peça não pôde ser lida');
			}

			// Cacheável por CDN: a resposta é a mesma para todo mundo e não carrega
			// nada do comprador. Curto porque revogação precisa aparecer rápido.
			reply.header('Cache-Control', 'public, max-age=60');

			return reply.send({
				code: art.code,
				valid: !art.revoked_at,
				status: art.revoked_at ? ('revoked' as const) : ('active' as const),
				// `feature_key` é o último recurso, e é uma chave técnica: quem
				// escaneia um chaveiro não deve ler "clube:corinthians".
				content: art.prompt_title ?? art.licensor_name ?? art.feature_key,
				featureKey: art.feature_key,
				licensorName: art.licensor_name,
				brandName: marca?.display_name ?? art.licensor_name,
				crestUrl: marca?.crest_url ?? null,
				accentColor: marca?.accent_color ?? null,
				previewUrl: art.preview_url,
				issuedAt: art.created_at,
				checkedAt: new Date().toISOString(),
			});
		},
	);

	/**
	 * `currentCustomer` é populado pelo authenticateCustomer para aluno; para
	 * staff o middleware retorna cedo e só `currentUser` existe. As três rotas
	 * da biblioteca leem o dono pelo MESMO caminho — se divergirem, alguém
	 * consegue listar a própria peça e levar 404 ao arquivar.
	 */
	function donoDaBiblioteca(request: FastifyRequest): string | undefined {
		return request.currentCustomer?.id ?? request.currentUser?.id;
	}

	server.get(
		'/api/me/licensed-art',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'As peças que eu gerei. `archived=true` traz as que eu arquivei.',
				querystring: z.object({ archived: z.string().optional() }),
				response: {
					200: z.array(minhaArteSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Licensed Art'],
			},
		},
		async (request, reply) => {
			const customerId = donoDaBiblioteca(request);
			if (!customerId) {
				return reply
					.status(401)
					.send({ message: 'Não autenticado.', code: 'unauthorized' });
			}

			const q = request.query as { archived?: string };
			const artes = await listarDoCliente(customerId, {
				arquivadas: q.archived === 'true',
			});
			return reply.send(
				artes.map((a) => ({
					id: a.id,
					code: a.code,
					featureKey: a.feature_key,
					licensorName: a.licensor_name,
					previewUrl: a.preview_url,
					promptTitle: a.prompt_title,
					revoked: Boolean(a.revoked_at),
					archived: Boolean(a.archived_at),
					batchId: a.batch_id,
					pieceIndex: a.piece_index,
					batchSize: a.batch_size,
					pieceLabel: a.piece_label,
					canGrow: Boolean(a.batch_id && a.master_path),
					issuedAt: a.created_at,
				})),
			);
		},
	);

	/**
	 * Arquivar e desarquivar são a mesma coisa no mesmo caminho: POST guarda,
	 * DELETE traz de volta. Em lugar nenhum da API isto se chama "apagar",
	 * porque não é o que acontece — a licença e o QR seguem valendo.
	 */
	for (const [metodo, arquivar] of [
		['post', true],
		['delete', false],
	] as const) {
		server[metodo](
			'/api/me/licensed-art/:id/archive',
			{
				preHandler: [authenticateCustomer],
				schema: {
					description: arquivar
						? 'Tira a peça da minha biblioteca. A licença continua válida.'
						: 'Traz a peça de volta para a minha biblioteca.',
					params: z.object({ id: z.string().uuid() }),
					response: {
						200: minhaArteSchema,
						401: ErrorSchema,
						404: ErrorSchema,
						500: ErrorSchema,
					},
					tags: ['Licensed Art'],
				},
			},
			async (request, reply) => {
				const customerId = donoDaBiblioteca(request);
				if (!customerId) {
					return reply
						.status(401)
						.send({ message: 'Não autenticado.', code: 'unauthorized' });
				}

				const { id } = request.params as { id: string };
				const art = await arquivarDoCliente(id, customerId, arquivar);
				// Peça de outra pessoa e peça inexistente dão a MESMA resposta: um
				// 403 aqui confirmaria a existência de um id que não é de quem
				// pergunta.
				if (!art) {
					return reply
						.status(404)
						.send({ message: 'Peça não encontrada.', code: 'not_found' });
				}

				return reply.send({
					id: art.id,
					code: art.code,
					featureKey: art.feature_key,
					licensorName: art.licensor_name,
					previewUrl: art.preview_url,
					promptTitle: art.prompt_title,
					revoked: Boolean(art.revoked_at),
					archived: Boolean(art.archived_at),
					batchId: art.batch_id,
					pieceIndex: art.piece_index,
					batchSize: art.batch_size,
					pieceLabel: art.piece_label,
					canGrow: Boolean(art.batch_id && art.master_path),
					issuedAt: art.created_at,
				});
			},
		);
	}

	/**
	 * Ampliar a tiragem de um lote que já existe: mais peças da MESMA arte, sem
	 * rodar o modelo de novo.
	 *
	 * Não é um `tool-run`: nada é gerado. Por isso mora aqui, na rota das
	 * licenças, e não no motor — o que acontece é emissão, carimbo e entrega.
	 * A quantidade vem da invocação (`license_units`), como em toda cobrança
	 * desta ferramenta: o motor nunca acredita no número que o cliente manda.
	 */
	server.post(
		'/api/me/licensed-art/batches/:batchId/pieces',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Emite mais peças de um lote existente, com a arte original.',
				params: z.object({ batchId: z.string().uuid() }),
				body: z.object({
					invocation_id: z.string(),
					tool_key: z.string().default('arte_licenciada'),
				}),
				response: {
					200: z.object({
						pieces: z.array(
							z.object({
								index: z.number(),
								code: z.string(),
								url: z.string(),
							}),
						),
					}),
					400: ErrorSchema,
					401: ErrorSchema,
					402: ErrorSchema,
					// 403 = portão do vendedor. Sem ele DECLARADO, o Fastify não
					// serializa a recusa e o aluno leva um erro sem mensagem.
					403: ErrorSchema,
					404: ErrorSchema,
					409: ErrorSchema,
					503: ErrorSchema,
				},
				tags: ['Licensed Art'],
			},
		},
		async (request, reply) => {
			const customerId = donoDaBiblioteca(request);
			if (!customerId) {
				return reply
					.status(401)
					.send({ message: 'Não autenticado.', code: 'unauthorized' });
			}
			const { batchId } = request.params as { batchId: string };
			const body = request.body as {
				invocation_id: string;
				tool_key: string;
			};

			const r = await ampliarLoteLicenciado({
				customerId,
				batchId,
				invocationId: body.invocation_id,
				toolKey: body.tool_key,
				authHeader: request.headers.authorization,
			});
			if (!r.ok) {
				return reply.status(r.status ?? 503).send({
					message: r.message ?? 'Não foi possível ampliar a tiragem.',
				});
			}
			return reply.send({ pieces: r.pecas ?? [] });
		},
	);
}
