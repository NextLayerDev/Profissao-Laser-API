import { embed } from '../../lib/omni/embeddings.js';
import { deleteOmniMediaByUrl, uploadOmniMedia } from '../../lib/storage.js';
import { omniKbRepository } from '../../repositories/omni-kb.js';
import type { OmniKbFile } from '../../types/omni.js';

/**
 * Ingest da base de conhecimento (RAG): upload → extração de texto
 * (PDF/DOCX/TXT/MD) → chunking (~800 tokens, overlap) → embeddings (plugável)
 * → pl_omni_kb_chunk. Processamento assíncrono: a rota responde 202 com o
 * arquivo em 'processing' e a UI polla a lista.
 */

const MAX_EXTRACT_CHARS = 300_000;
const MAX_FILES_PER_INSTANCE = 40;
const CHUNK_TARGET_CHARS = 3200; // ~800 tokens
const CHUNK_OVERLAP_CHARS = 800; // ~200 tokens

export class OmniKbError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
	}
}

async function extractText(buffer: Buffer, mime: string): Promise<string> {
	const m = mime.toLowerCase();
	if (m.includes('pdf')) {
		const { PDFParse } = await import('pdf-parse');
		const parser = new PDFParse({ data: new Uint8Array(buffer) });
		try {
			const result = await parser.getText();
			return result.text ?? '';
		} finally {
			await parser.destroy().catch(() => {});
		}
	}
	if (m.includes('wordprocessingml') || m.includes('msword')) {
		const mammoth = await import('mammoth');
		const result = await mammoth.extractRawText({ buffer });
		return result.value ?? '';
	}
	// txt / md / csv / qualquer texto
	return buffer.toString('utf-8');
}

/** Chunking com preferência por fronteira de parágrafo, depois sentença. */
export function chunkText(text: string): string[] {
	const clean = text
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.trim();
	if (!clean) return [];
	const chunks: string[] = [];
	let start = 0;
	while (start < clean.length) {
		let end = Math.min(start + CHUNK_TARGET_CHARS, clean.length);
		if (end < clean.length) {
			// tenta cortar num \n\n dentro dos últimos 40% do chunk
			const windowStart = start + Math.floor(CHUNK_TARGET_CHARS * 0.6);
			const para = clean.lastIndexOf('\n\n', end);
			if (para > windowStart) end = para;
			else {
				const sentence = clean.lastIndexOf('. ', end);
				if (sentence > windowStart) end = sentence + 1;
			}
		}
		const piece = clean.slice(start, end).trim();
		if (piece) chunks.push(piece);
		if (end >= clean.length) break;
		start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
	}
	return chunks;
}

async function processFile(file: OmniKbFile, buffer: Buffer): Promise<void> {
	try {
		let text = await extractText(buffer, file.mime);
		if (text.length > MAX_EXTRACT_CHARS) {
			text = `${text.slice(0, MAX_EXTRACT_CHARS)}\n\n[conteúdo truncado]`;
		}
		const chunks = chunkText(text);
		if (chunks.length === 0) {
			await omniKbRepository.setFileStatus(file.id, {
				status: 'error',
				error: 'Não foi possível extrair texto do arquivo.',
			});
			return;
		}
		// Embeddings (null = sem provedor → busca keyword)
		let vectors: number[][] | null = null;
		try {
			vectors = await embed(chunks);
		} catch (err) {
			console.error('[omni-kb] embeddings falharam (segue keyword):', err);
			vectors = null;
		}
		await omniKbRepository.insertChunks(
			chunks.map((content, i) => ({
				instance_id: file.instance_id,
				file_id: file.id,
				seq: i,
				content,
				tokens: Math.ceil(content.length / 4),
				embedding: vectors ? vectors[i] : null,
			})),
		);
		await omniKbRepository.setFileStatus(file.id, {
			status: 'ready',
			chunk_count: chunks.length,
			error: null,
		});
	} catch (err) {
		console.error('[omni-kb] processamento falhou:', err);
		await omniKbRepository
			.setFileStatus(file.id, {
				status: 'error',
				error: String(err).slice(0, 500),
			})
			.catch(() => {});
	}
}

class OmniKbService {
	/** Sobe pro Bunny + registra + processa async. Devolve o row 'processing'. */
	async ingest(
		instanceId: string,
		buffer: Buffer,
		fileName: string,
		mime: string,
	): Promise<OmniKbFile> {
		const count = await omniKbRepository.countFiles(instanceId);
		if (count >= MAX_FILES_PER_INSTANCE) {
			throw new OmniKbError(
				`Limite de ${MAX_FILES_PER_INSTANCE} arquivos por instância.`,
			);
		}
		const url = await uploadOmniMedia(
			instanceId,
			buffer,
			`kb-${fileName}`,
			mime,
		);
		const file = await omniKbRepository.insertFile({
			instance_id: instanceId,
			name: fileName,
			url,
			mime,
			size_bytes: buffer.length,
		});
		setImmediate(() => void processFile(file, buffer));
		return file;
	}

	async remove(fileId: string): Promise<void> {
		const file = await omniKbRepository.findFileById(fileId);
		if (!file) return;
		await omniKbRepository.removeFile(fileId); // chunks caem em cascade
		await deleteOmniMediaByUrl(file.url).catch(() => {});
	}
}

export const omniKbService = new OmniKbService();
