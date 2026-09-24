import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	type NanquimSubject,
	redrawAsColorVector,
	redrawAsNanquim,
} from '../lib/ai-lineart.js';
import { classifyImage } from '../lib/image-classify.js';
import {
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { parseVectorizeParams } from '../lib/vectorize.js';
import { analyzeImage, type ImageProfile } from '../lib/vectorize-analyze.js';
import { vectorRepository } from '../repositories/vector.js';
import {
	INVERT_UNSUPPORTED,
	type InvertMode,
	vectorInvertService,
} from '../services/vector-invert.js';
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

		// Grava `subject` também no caminho SEM IA — sem isso, todo vetor criado
		// aqui (a maioria: "Vetorizar" direto, sem custo de IA) fica com
		// `subject: null`, e a inversão ("Invertido") cai na heurística de pixel
		// `chooseInvertMode()`, que erra em conteúdo hachurado de baixa cobertura
		// de tinta (ver comentário em `svg-negative.ts`). `analyzeImage` já roda
		// local (sharp, sem custo de IA) — mesma classe usada pro router
		// Automático, aqui só decide foto (tom contínuo) vs logo (arte chapada).
		// Vetor colorido segue marcado como 'color' (mesma convenção do caminho de
		// IA) — não teria por que dizer foto/logo, e a inversão geométrica já
		// recusa multicor de qualquer forma.
		let subject: 'photo' | 'logo' | 'color' = 'color';
		if (fields.mode !== 'color') {
			const profile = await analyzeImage(fileBuffer);
			subject =
				profile.class === 'photo' || profile.class === 'grayscale_tonal'
					? 'photo'
					: 'logo';
		}
		const params = parseVectorizeParams({ ...fields, subject });
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
 * Roda a vetorização tradicional (sem IA) a partir de um `ImageProfile` já
 * calculado. Usado tanto quando a IA nem chega a ser chamada (imagem já é
 * P&B chapado) quanto quando ela falha na verificação — mesmo formato de
 * resposta nos dois casos: `paidFormats: []`, já que a geração não cobrou
 * nada de IA (baixar um formato cobra normalmente, como em "Vetorizar").
 */
async function runVectorizeWithoutAi(
	reply: FastifyReply,
	customerId: string,
	fileBuffer: Buffer,
	filename: string,
	fields: Record<string, string>,
	wantsColor: boolean,
	subject: NanquimSubject,
	profile: ImageProfile,
	extra: Record<string, unknown>,
) {
	// Descarta null/undefined ANTES de virar string (mesma convenção do front
	// ao montar o FormData). `String(null)` daria "null", que é truthy no
	// parser: `parseFloat("null")` = NaN e o clamp devolve NaN (NaN falha as
	// duas comparações) → sharp receberia blur(NaN).
	const recommended = Object.fromEntries(
		Object.entries(profile.recommendedParams)
			.filter(([, v]) => v !== null && v !== undefined)
			.map(([k, v]) => [k, String(v)]),
	);
	const fallbackParams = parseVectorizeParams({
		...fields,
		...recommended,
		...(wantsColor ? { mode: 'color' } : {}),
		// Sem isso o vetor fica com `subject: null` e a inversão cai na
		// heurística de pixel (chooseInvertMode), que erra em foto hachurada de
		// baixa cobertura de tinta e entrega o retângulo geométrico em vez da
		// silhueta.
		subject: wantsColor ? 'color' : subject,
	});
	const { data: fbResult, error: fbError } = await vectorizeService.vectorize(
		customerId,
		{
			buffer: fileBuffer,
			filename,
			mimetype: 'image/png',
			params: fallbackParams,
		},
	);
	if (fbError) {
		const message =
			fbError instanceof Error ? fbError.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send({ ...fbResult, paidFormats: [], ...extra });
}

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

		const wantsColor = fields.variant === 'color';

		// 0) Já é P&B chapado (halftone denso, arte de linha, logo) → pula a IA.
		// Mandar isso pro redesenho reinterpreta a textura fina — um halftone
		// vira blob grosseiro — e o resultado sai PIOR que a vetorização direta.
		// Só se aplica à variante P&B: ilustração colorida chapada é outro
		// problema (cores, não bimodalidade) e não está coberta aqui.
		if (!wantsColor) {
			const profile = await analyzeImage(fileBuffer);
			const alreadyFlatBW =
				profile.class === 'text' ||
				profile.class === 'line_art' ||
				profile.class === 'logo';
			if (alreadyFlatBW) {
				if (invocationId) {
					await refundInvocation(customerId, invocationId, authHeader);
					invocationId = null;
				}
				return runVectorizeWithoutAi(
					reply,
					customerId,
					fileBuffer,
					filename,
					fields,
					wantsColor,
					'logo',
					profile,
					{ aiSkipped: true, aiSkipReason: `already_${profile.class}` },
				);
			}
		}

		// 1) IA redesenha: gravura P&B ("nanquim") OU vetor de cores chapadas (UV).
		// Pode lançar ToolEngineError → o catch estorna a cobrança.
		//
		// A escolha do PROMPT (foto vs logo) é SERVER-SIDE e autoritativa: o front
		// não manda essa decisão e nada disso aparece na UI. Mandar logo no prompt
		// de foto era o bug que fazia um logo virar 4 retratos em grade.
		let subject: NanquimSubject = 'photo';
		if (!wantsColor) {
			const detected = await classifyImage(fileBuffer);
			subject = detected.kind;
			if (process.env.DEBUG_IMAGE_GEN) {
				console.debug('[ai-lineart] tipo detectado', {
					kind: detected.kind,
					confidence: detected.confidence,
					source: detected.source,
				});
			}
		}
		const outcome = wantsColor
			? await redrawAsColorVector(fileBuffer)
			: await redrawAsNanquim(fileBuffer, subject);

		// 1b) A IA não passou na verificação nas 2 tentativas. Estorna (o cliente
		// pagou por um redesenho de IA e não recebeu um) e entrega a vetorização
		// NORMAL, que nunca alucina. Devolver `paidFormats: []` o deixa no estado
		// idêntico ao de quem clicou "Vetorizar" — sem caso especial no download.
		if (!outcome.png) {
			if (invocationId) {
				await refundInvocation(customerId, invocationId, authHeader);
				invocationId = null;
			}
			const profile = await analyzeImage(fileBuffer);
			return runVectorizeWithoutAi(
				reply,
				customerId,
				fileBuffer,
				filename,
				fields,
				wantsColor,
				subject,
				profile,
				{ aiFallback: true, aiFallbackReason: outcome.failures.join(',') },
			);
		}

		// 2) Vetoriza o resultado limpo (trace p/ P&B; cor em alta def p/ UV).
		const params = parseVectorizeParams({
			...fields,
			mode: wantsColor ? 'color' : 'trace',
			edgeDetection: 'none',
			maxColors: fields.maxColors ?? '14',
			turdSize: fields.turdSize ?? '3',
			// Só na gravura de FOTO: ali um vazio cercado de preto é sempre defeito
			// da geração. Em logo/texto seria destrutivo (contraforma de letra).
			healHoles: String(!wantsColor && subject === 'photo'),
			// Gravado no vetor: a INVERSÃO precisa saber se é foto (silhueta) ou
			// logo (complemento geométrico). Adivinhar isso depois, a partir dos
			// pixels do SVG, errava e entregava retângulo preto em retrato.
			subject: wantsColor ? 'color' : subject,
		});
		const { data: result, error } = await vectorizeService.vectorize(
			customerId,
			{ buffer: outcome.png, filename, mimetype: 'image/png', params },
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

/**
 * VETOR INVERTIDO (delimitado pela silhueta, nunca retângulo). Transformação
 * pura de um vetor já gerado: **não cobra**, não pede `invocation_id` e não
 * mexe em `paid_formats` — quem já pagou um formato baixa a versão invertida
 * sem custo novo.
 */
export const invertVectorController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: { mode?: InvertMode; persist?: boolean };
	}>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		const { data, error } = await vectorInvertService.invert(
			customerId,
			request.params.id,
			request.body?.mode ?? 'auto',
			request.body?.persist ?? false,
		);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			// Recusa da inversão geométrica (multi-cor, transform…) → 422: o vetor
			// existe, mas essa arte não tem negativo geométrico confiável.
			const unsupported = Object.values(INVERT_UNSUPPORTED) as string[];
			if (unsupported.includes(message)) {
				return reply.status(422).send({ message });
			}
			const status = message === 'Vector not found' ? 404 : 500;
			return reply.status(status).send({ message });
		}
		return reply.status(200).send(data);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Vector not found' ? 404 : 500;
		return reply.status(status).send({ message });
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
