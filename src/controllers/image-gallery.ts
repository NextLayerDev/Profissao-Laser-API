import type { FastifyReply, FastifyRequest } from 'fastify';
import { redrawAsNanquim } from '../lib/ai-lineart.js';
import {
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { parseVectorizeParams } from '../lib/vectorize.js';
import {
	type CollectionEntry,
	toolCollectionRepository,
} from '../repositories/tool-collection.js';
import { vectorRepository } from '../repositories/vector.js';
import { vectorizeService } from '../services/vectorize.js';

/**
 * A PONTE ENTRE O ESTÚDIO DE IMAGENS E A VETORIZAÇÃO — é ela que fecha o ciclo
 * do produto: imagem → vetor → corte.
 *
 * POR QUE SERVER-SIDE, e não "baixa no browser e joga no dropzone": a imagem já
 * está no Bunny. Trazer 4 MB para a máquina do aluno só para reenviar os mesmos
 * 4 MB gasta a banda dele duas vezes, e o upload de volta chegaria como um
 * arquivo qualquer — sem `vector_ready`, sem dono conhecido, sem o billing
 * unificado da vetorização. Aqui o servidor lê o registro, valida o dono e
 * entra no MESMO caminho provado do `aiLineartController`.
 */

/** Tool e coleção padrão (o Estúdio). O corpo pode apontar outra tool. */
const DEFAULT_TOOL = 'estudio_imagens';
const DEFAULT_COLLECTION = 'galeria';

/** Teto do download. Espelha o teto de saída do `image-gen` (20 MB). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * A URL vem de `data.url` de um registro de coleção — e a `galeria` aceita
 * submissão de ALUNO (`submissions.who:'student'`). Ou seja: um aluno pode
 * criar à mão um registro com a URL que quiser e, sem esta checagem, o nosso
 * servidor faria a requisição por ele — SSRF clássico, com acesso à rede
 * interna e ao metadata da nuvem. Só o host do nosso CDN passa.
 *
 * Lê a env em tempo de chamada (e não no topo do módulo) para o teste poder
 * definir o host sem reimportar o módulo.
 */
export function isStorageUrl(raw: string): boolean {
	const cdn = process.env.BUNNY_CDN_HOSTNAME ?? '';
	// Sem CDN configurado NADA foi enviado ao Bunny — deixar passar aqui seria
	// abrir o SSRF justamente no ambiente mais frouxo.
	if (!cdn) return false;
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return false;
	}
	return u.protocol === 'https:' && u.hostname === cdn;
}

/** Nome de arquivo seguro a partir do título do registro. */
function safeName(entry: CollectionEntry): string {
	const base = (entry.title || 'estudio')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9._-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
	return `${base || 'estudio'}.png`;
}

async function downloadImage(url: string): Promise<Buffer> {
	const res = await fetch(url, {
		signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`O storage respondeu ${res.status} ao buscar a imagem.`);
	}
	// Checa o cabeçalho ANTES de materializar o corpo (aborta cedo o que é
	// grande demais); o buffer é re-checado porque `content-length` é opcional.
	const declared = Number(res.headers.get('content-length') ?? '0');
	if (declared > MAX_IMAGE_BYTES) {
		throw new Error('A imagem é grande demais para vetorizar.');
	}
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength === 0) throw new Error('A imagem do storage está vazia.');
	if (buf.byteLength > MAX_IMAGE_BYTES) {
		throw new Error('A imagem é grande demais para vetorizar.');
	}
	return buf;
}

export interface ImageGalleryDeps {
	findEntry(
		id: string,
		toolKey: string,
		collection: string,
	): Promise<CollectionEntry | null>;
	download(url: string): Promise<Buffer>;
	resolveBilling: typeof resolveToolBilling;
	settle: typeof settleInvocation;
	refund: typeof refundInvocation;
	redraw(png: Buffer): Promise<Buffer>;
	vectorize: typeof vectorizeService.vectorize;
	setPaidFormats(
		id: string,
		customerId: string,
		formats: string[],
	): Promise<string[]>;
}

const defaultDeps: ImageGalleryDeps = {
	findEntry: (id, toolKey, collection) =>
		toolCollectionRepository.findById(id, toolKey, collection),
	download: downloadImage,
	resolveBilling: resolveToolBilling,
	settle: settleInvocation,
	refund: refundInvocation,
	redraw: redrawAsNanquim,
	vectorize: (customerId, input) =>
		vectorizeService.vectorize(customerId, input),
	setPaidFormats: (id, customerId, formats) =>
		vectorRepository.setPaidFormats(id, customerId, formats),
};

interface ToVectorBody {
	invocation_id?: string;
	tool_key?: string;
	collection?: string;
}

export function makeImageGalleryControllers(
	deps: ImageGalleryDeps = defaultDeps,
) {
	/**
	 * `POST /api/image-gallery/:id/to-vector` — manda uma imagem da galeria para
	 * a Vetorização sem passar pelo browser.
	 */
	const toVectorController = async (
		request: FastifyRequest<{ Params: { id: string }; Body?: ToVectorBody }>,
		reply: FastifyReply,
	) => {
		const customerId = request.currentCustomer?.id;
		const authHeader = request.headers.authorization;
		let invocationId: string | null = null;

		try {
			if (!customerId) {
				return reply.status(403).send({ message: 'Customer not found' });
			}

			const body = request.body ?? {};
			const toolKey = body.tool_key || DEFAULT_TOOL;
			const collection = body.collection || DEFAULT_COLLECTION;

			const entry = await deps.findEntry(
				request.params.id,
				toolKey,
				collection,
			);

			/**
			 * IDOR: imagem de outra pessoa responde 404, NÃO 403. Um 403 confirmaria
			 * que aquele id existe — que é metade do que um enumerador quer saber.
			 * Inexistente e alheia são indistinguíveis daqui de fora, de propósito.
			 */
			if (!entry || entry.owner_id !== customerId) {
				return reply.status(404).send({ message: 'Imagem não encontrada.' });
			}

			const data = (entry.data ?? {}) as Record<string, unknown>;
			const url = typeof data.url === 'string' ? data.url : '';
			if (!isStorageUrl(url)) {
				return reply
					.status(400)
					.send({ message: 'Esta imagem não tem arquivo no nosso storage.' });
			}

			// Gate ANTES do download: rejeitar depois de puxar a imagem gastaria
			// banda por uma execução que nunca ia acontecer.
			const gate = await deps.resolveBilling(
				customerId,
				'vectorize',
				body.invocation_id ?? null,
				authHeader,
			);
			if (gate.mode === 'reject') {
				/**
				 * Rejeição COM `invocation_id` = o front já debitou no invoke e nós não
				 * vamos entregar nada. Estorna, senão fica um débito órfão (pending
				 * para sempre). O estorno é idempotente e escopado ao dono: se a
				 * invocação não for dele, vira no-op.
				 *
				 * O `aiLineartController` não faz isso; aqui faz de propósito, porque
				 * esta rota é bem mais fácil de chamar com a invocação da tool ERRADA
				 * (o composer do Estúdio cobra `estudio_imagens`, a ponte cobra
				 * `vectorize`) — e cada erro desses viraria voxxy preso.
				 */
				if (body.invocation_id) {
					await deps.refund(customerId, body.invocation_id, authHeader);
				}
				return reply.status(gate.status).send({ message: gate.message });
			}
			invocationId = gate.mode === 'paid' ? gate.invocationId : null;

			const png = await deps.download(url);

			/**
			 * ATALHO DO MODO `vetorizavel`: aquela imagem JÁ saiu binária do bloco
			 * (`grayscale → normalize → threshold(128)`), então mandá-la ao redesenho
			 * por IA seria pagar uma chamada de modelo para reconstruir uma imagem
			 * que já está pronta — e ainda arriscar que o modelo introduza cinza.
			 * Vai direto ao Potrace: mais rápido, mais barato, mais fiel.
			 */
			const vectorReady = data.vector_ready === true;
			const source = vectorReady ? png : await deps.redraw(png);

			const params = parseVectorizeParams({
				mode: 'trace',
				edgeDetection: 'none',
				// A imagem binária não precisa de nenhum ajuste de nível: 128 é
				// exatamente o corte que o bloco já aplicou.
				...(vectorReady ? { threshold: '128' } : {}),
				turdSize: '3',
			});

			const { data: result, error } = await deps.vectorize(customerId, {
				buffer: source,
				filename: safeName(entry),
				mimetype: 'image/png',
				params,
			});
			if (error || !result) {
				if (invocationId) {
					await deps.refund(customerId, invocationId, authHeader);
				}
				const message =
					error instanceof Error ? error.message : 'Falha ao vetorizar.';
				return reply.status(500).send({ message });
			}

			// A geração pagou tudo → os três formatos já saem pagos (o download não
			// recobra), exatamente como no `aiLineartController`.
			let paidFormats = ['svg', 'png', 'dxf'];
			try {
				paidFormats = await deps.setPaidFormats(
					result.id,
					customerId,
					paidFormats,
				);
			} catch {
				// best-effort: no pior caso o aluno revalida no download, de graça.
			}

			if (invocationId) {
				await deps.settle(customerId, invocationId, authHeader);
			}
			return reply
				.status(201)
				.send({ vectorId: result.id, paidFormats, vectorReady });
		} catch (err) {
			if (invocationId && customerId) {
				await deps.refund(customerId, invocationId, authHeader);
			}
			const status = (err as { status?: number })?.status;
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply
				.status(status && status >= 400 && status < 600 ? status : 500)
				.send({ message });
		}
	};

	return { toVectorController };
}

export const { toVectorController } = makeImageGalleryControllers();
