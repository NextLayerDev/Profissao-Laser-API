const BASE_URL = process.env.LASERIA_API_URL ?? '';
const API_KEY = process.env.LASERIA_API_KEY ?? '';
const MODEL = process.env.LASERIA_API_MODEL ?? 'laserpro';

export interface AdvancedVectorizeResult {
	svgContent: string;
}

/** Vetorização pelo modelo avançado (em teste). */
export async function vectorizeAdvanced(
	buffer: Buffer,
	filename: string,
	mimetype: string,
): Promise<AdvancedVectorizeResult> {
	if (!BASE_URL || !API_KEY) {
		throw new Error('Recurso indisponível no momento.');
	}

	const form = new FormData();
	form.append(
		'file',
		new Blob([buffer], { type: mimetype || 'application/octet-stream' }),
		filename || 'image',
	);
	form.append('model', MODEL);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 120_000);
	try {
		const res = await fetch(`${BASE_URL}/api/v1/vectorize`, {
			method: 'POST',
			headers: { 'X-API-Key': API_KEY },
			body: form,
			signal: controller.signal,
		});
		if (!res.ok) {
			throw new Error(
				res.status === 429
					? 'Serviço ocupado, tente novamente em instantes.'
					: 'Não foi possível processar a imagem.',
			);
		}
		const data = (await res.json()) as { svg_content?: unknown };
		if (typeof data.svg_content !== 'string' || data.svg_content.length === 0) {
			throw new Error('Resposta inválida.');
		}
		return { svgContent: data.svg_content };
	} finally {
		clearTimeout(timer);
	}
}
