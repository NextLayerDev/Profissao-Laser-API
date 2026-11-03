/**
 * Extração de JSON da resposta de um LLM.
 *
 * Módulo PURO de propósito: importar `blocks/ai-text.ts` num teste arrastaria o
 * cliente OpenRouter (que valida env no import) junto. Já são três consumidores
 * — `ai.text`, `ai.vision` e o time de pesquisa —, então isto para de ser
 * duplicação e passa a ser contrato.
 */

function tryParse(raw: string): unknown | undefined {
	try {
		return JSON.parse(raw.trim());
	} catch {
		return undefined;
	}
}

/**
 * Modelos teimam em embrulhar o objeto em cerca de markdown mesmo quando o
 * `response_format` foi aceito, e alguns antepõem uma frase ("Claro, aqui está:").
 * Tentamos, em ordem: parse direto → bloco cercado ```json → o primeiro
 * `{...}`/`[...]` do texto.
 */
export function extractJson(text: string): unknown | undefined {
	const direct = tryParse(text);
	if (direct !== undefined) return direct;

	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) {
		const parsed = tryParse(fenced[1]);
		if (parsed !== undefined) return parsed;
	}

	const start = text.search(/[[{]/);
	if (start === -1) return undefined;
	const open = text[start];
	const close = open === '{' ? '}' : ']';
	const end = text.lastIndexOf(close);
	if (end <= start) return undefined;
	return tryParse(text.slice(start, end + 1));
}
