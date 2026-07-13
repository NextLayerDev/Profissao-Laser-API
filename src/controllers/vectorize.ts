import type { FastifyReply, FastifyRequest } from 'fastify';
import { redrawAsColorVector, redrawAsNanquim } from '../lib/ai-lineart.js';
import {
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { parseVectorizeParams } from '../lib/vectorize.js';
import { vectorRepository } from '../repositories/vector.js';
import { vectorizeService } from '../services/vectorize.js';

export const vectorizeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	// Geração NÃO cobrada: a cobrança de voxxys acontece no DOWNLOAD, por formato
	// (POST /api/vectorize/:id/download/:format). Aqui só validamos acesso,
	// vetorizamos e gravamos — o cliente vê o resultado final de graça e só paga
	// ao baixar (SVG/PNG/DXF). Preview e análise seguem grátis, como já eram.
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		let fileBuffer: Buffer | null = null;
		let filename = 'image';
		let mimetype = 'application/octet-stream';
		const fields: Record<string, string> = {};

		for await (const part of request.parts()) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
				filename = part.filename ?? 'image';
				mimetype = part.mimetype;
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		if (!fileBuffer) {
			return reply.status(400).send({ message: 'File is required' });
		}

		const params = parseVectorizeParams(fields);
		const { data: result, error } = await vectorizeService.vectorize(
			customerId,
			{ buffer: fileBuffer, filename, mimetype, params },
		);

		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}
		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

/**
 * Cobrança POR FORMATO no download. O front, ao clicar em baixar um formato ainda
 * não pago deste vetor, invoca a tool no upvox (debita) e chama esta rota com o
 * `invocation_id`. Validamos → gravamos o formato como pago ANTES de liquidar →
 * liquidamos. Assim não há janela "cobrado-mas-não-registrado". Formato já pago
 * (inclusive re-download da biblioteca, cross-session) NÃO cobra de novo.
 */
export const downloadVectorFormatController = async (
	request: FastifyRequest<{
		Params: { id: string; format: 'svg' | 'png' | 'dxf' };
		Body: { invocation_id?: string };
	}>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
	const { id, format } = request.params;
	const invocationId = request.body?.invocation_id ?? null;

	try {
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		const vector = await vectorRepository.findByIdForExport(id, customerId);
		const alreadyPaid: string[] = vector.paid_formats ?? [];

		// Já pago → libera de graça. Se o front mesmo assim invocou (debitou), estorna.
		if (alreadyPaid.includes(format)) {
			if (invocationId)
				await refundInvocation(customerId, invocationId, authHeader);
			return reply.status(200).send({ paidFormats: alreadyPaid });
		}

		const gate = await resolveToolBilling(
			customerId,
			'vectorize',
			invocationId,
			authHeader,
		);
		if (gate.mode === 'reject') {
			// Rejeição com invocation_id presente = o front já debitou no invoke, mas
			// não vamos entregar → estorna p/ não deixar débito órfão (idempotente,
			// escopado ao dono; no-op se a invocation não for nossa).
			if (invocationId)
				await refundInvocation(customerId, invocationId, authHeader);
			return reply.status(gate.status).send({ message: gate.message });
		}

		let paidFormats: string[];
		try {
			// Grava o formato como pago ANTES de liquidar (fecha a janela de risco).
			paidFormats = await vectorRepository.markFormatPaid(
				id,
				customerId,
				format,
			);
		} catch (persistErr) {
			if (gate.mode === 'paid')
				await refundInvocation(customerId, gate.invocationId, authHeader);
			const message =
				persistErr instanceof Error ? persistErr.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		if (gate.mode === 'paid')
			await settleInvocation(customerId, gate.invocationId, authHeader);
		return reply.status(200).send({ paidFormats });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Vector not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

/**
 * LINE-ART com IA (foto → gravura "nanquim" via Gemini → vetor Potrace). Cobrada
 * NA GERAÇÃO (a IA tem custo por chamada): o front invoca (debita) e manda o
 * `invocation_id`; validamos → rodamos a IA + vetorizamos → liquidamos (ou
 * estornamos em falha). O resultado já sai com TODOS os formatos PAGOS (a geração
 * pagou tudo → download não recobra). É o único caminho que atinge o nível "print 2".
 */
export const aiLineartController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
	let invocationId: string | null = null;

	try {
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		let fileBuffer: Buffer | null = null;
		let filename = 'image';
		const fields: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
				filename = part.filename ?? 'image';
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}
		if (!fileBuffer) {
			return reply.status(400).send({ message: 'File is required' });
		}

		// Cobrança NA GERAÇÃO (reusa a tool `vectorize`): exige invocation_id.
		const gate = await resolveToolBilling(
			customerId,
			'vectorize',
			fields.invocation_id ?? null,
			authHeader,
		);
		if (gate.mode === 'reject') {
			return reply.status(gate.status).send({ message: gate.message });
		}
		invocationId = gate.mode === 'paid' ? gate.invocationId : null;

		// 1) IA redesenha: gravura P&B ("nanquim") OU vetor de cores chapadas (UV).
		// Pode lançar ToolEngineError → o catch estorna a cobrança.
		const variant = fields.variant === 'color' ? 'color' : 'lineart';
		const cleanImg =
			variant === 'color'
				? await redrawAsColorVector(fileBuffer)
				: await redrawAsNanquim(fileBuffer);

		// 2) Vetoriza o resultado limpo (trace p/ P&B; cor em alta def p/ UV).
		const params = parseVectorizeParams({
			...fields,
			mode: variant === 'color' ? 'color' : 'trace',
			edgeDetection: 'none',
			maxColors: fields.maxColors ?? '14',
			turdSize: fields.turdSize ?? '3',
		});
		const { data: result, error } = await vectorizeService.vectorize(
			customerId,
			{ buffer: cleanImg, filename, mimetype: 'image/png', params },
		);
		if (error) {
			if (invocationId)
				await refundInvocation(customerId, invocationId, authHeader);
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		// Geração pagou tudo → marca os 3 formatos como pagos (download não recobra).
		let paidFormats = ['svg', 'png', 'dxf'];
		try {
			paidFormats = await vectorRepository.setPaidFormats(
				result.id,
				customerId,
				paidFormats,
			);
		} catch {
			// best-effort: se falhar, o cliente re-baixa e no máximo revalida grátis
		}

		if (invocationId)
			await settleInvocation(customerId, invocationId, authHeader);
		return reply.status(201).send({ ...result, paidFormats });
	} catch (err) {
		if (invocationId && customerId)
			await refundInvocation(customerId, invocationId, authHeader);
		const status = (err as { status?: number })?.status;
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply
			.status(status && status >= 400 && status < 600 ? status : 500)
			.send({ message });
	}
};

export const vectorizePreviewController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	// Preview NÃO cobrado e sem storage: serve o feedback ao vivo dos sliders.
	// Continua exigindo acesso à vetorização (authenticateVectorizacao), só não
	// debita voxes nem grava nada.
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		let fileBuffer: Buffer | null = null;
		const fields: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		if (!fileBuffer) {
			return reply.status(400).send({ message: 'File is required' });
		}

		const params = parseVectorizeParams(fields);
		const { data, error } = await vectorizeService.preview({
			buffer: fileBuffer,
			params,
		});
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}
		return reply.status(200).send(data);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const vectorizeAnalyzeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	// Análise NÃO cobrada e sem storage: alimenta o modo Automático no front.
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		let fileBuffer: Buffer | null = null;
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
				break;
			}
		}

		if (!fileBuffer) {
			return reply.status(400).send({ message: 'File is required' });
		}

		const { data, error } = await vectorizeService.analyze(fileBuffer);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}
		return reply.status(200).send(data);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const vectorizeBatchController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		const fileParts: Array<{
			buffer: Buffer;
			filename: string;
			mimetype: string;
		}> = [];
		const fields: Record<string, string> = {};

		for await (const part of request.parts()) {
			if (part.type === 'file') {
				const buffer = await part.toBuffer();
				fileParts.push({
					buffer,
					filename: part.filename ?? 'image',
					mimetype: part.mimetype,
				});
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		if (fileParts.length === 0) {
			return reply
				.status(400)
				.send({ message: 'At least one file is required' });
		}

		const params = parseVectorizeParams(fields);
		const inputs = fileParts.map((f) => ({ ...f, params }));

		const { data: result, error } = await vectorizeService.vectorizeBatch(
			customerId,
			inputs,
		);

		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const exportVectorController = async (
	request: FastifyRequest<{
		Params: { format: string };
		Querystring: { id: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? null;
		const { format } = request.params;
		const { id } = request.query;

		if (!id) {
			return reply.status(400).send({ message: 'id query param is required' });
		}
		if (format !== 'dxf' && format !== 'png') {
			return reply.status(400).send({ message: 'format must be dxf or png' });
		}

		const { data: result, error } = await vectorizeService.exportVector(
			id,
			customerId,
			format,
		);

		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			const status = message === 'Vector not found' ? 404 : 500;
			return reply.status(status).send({ message });
		}

		if (result?.type === 'redirect') {
			return reply.redirect(result.url);
		}

		return reply
			.header(
				'Content-Disposition',
				`attachment; filename="${result?.filename}"`,
			)
			.header('Content-Type', result?.mimetype)
			.send(result?.content);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
