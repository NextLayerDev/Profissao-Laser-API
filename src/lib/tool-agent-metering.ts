/**
 * Metering PURO do Agente: converte os tokens gastos num turno (input, output,
 * cache write/read) em CUSTO EM VOXES com markup de lucro. Sem efeitos colaterais
 * (só lê env) — separado do service pra ser testável em isolamento.
 *
 * voxes = arredondaPraCima( (USD_dos_tokens / VOX_USD) * MARKUP , GRAN )
 * Defaults = preços reais do Sonnet 4.6 (USD por token).
 */

/** Tokens acumulados no turno (todas as iterações de tool-use). */
export interface Usage {
	in: number;
	out: number;
	cw: number; // cache_creation_input_tokens
	cr: number; // cache_read_input_tokens
}

/** Lê um env numérico ≥ 0 (senão default). */
const num = (k: string, d: number) => {
	const v = Number(process.env[k]);
	return Number.isFinite(v) && v >= 0 ? v : d;
};
/** Igual a `num`, mas exige ESTRITAMENTE positivo (divisores: VOX_USD, GRAN). */
const pos = (k: string, d: number) => {
	const v = Number(process.env[k]);
	return Number.isFinite(v) && v > 0 ? v : d;
};

/** Preços do Claude por TOKEN (USD), env-configuráveis (defaults Sonnet 4.6). */
const PRICE = {
	in: num('TOOL_AGENT_PRICE_IN', 3 / 1_000_000),
	out: num('TOOL_AGENT_PRICE_OUT', 15 / 1_000_000),
	cacheWrite: num('TOOL_AGENT_PRICE_CACHE_WRITE', 3.75 / 1_000_000),
	cacheRead: num('TOOL_AGENT_PRICE_CACHE_READ', 0.3 / 1_000_000),
};
const VOX_USD = pos('TOOL_AGENT_VOX_USD', 0.1); // valor de 1 vox em USD (>0)
const MARKUP = num('TOOL_AGENT_MARKUP', 3); // margem (proporcional ao uso + lucro)
const GRAN = pos('TOOL_AGENT_VOX_GRANULARITY', 0.05); // passo de arredondamento (>0)

/** Custo do turno em voxes: USD dos tokens → voxes com markup, arredondado pra cima. */
export function voxesFromUsage(u: Usage): number {
	const usd =
		u.in * PRICE.in +
		u.out * PRICE.out +
		u.cw * PRICE.cacheWrite +
		u.cr * PRICE.cacheRead;
	const raw = (usd / VOX_USD) * MARKUP;
	const stepped = Math.ceil(raw / GRAN) * GRAN;
	return Math.max(0, Math.round(stepped * 100) / 100);
}
