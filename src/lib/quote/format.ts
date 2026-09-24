/**
 * FORMATAÇÃO PT-BR do orçamento — um lugar só, para o número na tela ser o
 * mesmo número da frase que o explica.
 *
 * Por que à mão e não `Intl.NumberFormat`: este módulo é usado dentro do
 * precificador, que é PURO e roda igual em teste, em request e em script. O
 * `Intl` depende do ICU embarcado no runtime — a mesma conta formataria
 * "R$ 1,234.56" numa imagem com ICU reduzido e ninguém perceberia até um aluno
 * mandar o orçamento para o cliente dele. Aqui o resultado não depende do
 * ambiente.
 *
 * A regra de dinheiro do diretório continua valendo: entra CENTAVO INTEIRO, sai
 * texto. Nada aqui volta a virar número.
 */

/** Número no padrão brasileiro: milhar com ponto, decimal com vírgula. */
export function numeroBR(valor: number, casas = 2): string {
	if (!Number.isFinite(valor)) return '—';
	const negativo = valor < 0;
	const fixo = Math.abs(valor).toFixed(casas);
	const [inteiro, decimal] = fixo.split('.');
	// Agrupa de 3 em 3 da direita para a esquerda.
	const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `${negativo ? '-' : ''}${comMilhar}${decimal ? `,${decimal}` : ''}`;
}

/**
 * Dinheiro. O sinal vem ANTES do "R$" ("-R$ 144,76") porque é assim que se lê
 * prejuízo em português — e prejuízo é justamente o número que esta ferramenta
 * precisa deixar impossível de ler errado.
 */
export function brl(cents: number): string {
	const negativo = cents < 0;
	return `${negativo ? '-' : ''}R$ ${numeroBR(Math.abs(cents) / 100, 2)}`;
}

/** Fração (0,35) → percentual de gente ("35%"). */
export function pctBR(fracao: number, casas = 0): string {
	return `${numeroBR(fracao * 100, casas)}%`;
}

/** Diferença de percentual em PONTOS ("9 pontos"), que é como se fala. */
export function pontosBR(diferencaFracao: number, casas = 0): string {
	const p = Math.abs(diferencaFracao) * 100;
	const n = numeroBR(p, casas);
	return `${n} ${n === '1' ? 'ponto' : 'pontos'}`;
}

/**
 * Duração em texto curto. Ninguém decide preço lendo "409,64 s": abaixo de um
 * minuto o segundo importa, acima disso o que importa é o minuto, e a partir de
 * duas horas o que importa é a hora.
 */
export function duracaoBR(segundos: number): string {
	if (!Number.isFinite(segundos) || segundos < 0) return '—';
	if (segundos < 60) return `${numeroBR(segundos, segundos < 10 ? 1 : 0)} s`;
	if (segundos < 7200) return `${numeroBR(segundos / 60, 1)} min`;
	const horas = Math.floor(segundos / 3600);
	const min = Math.round((segundos - horas * 3600) / 60);
	return min === 0 ? `${horas} h` : `${horas} h ${min} min`;
}

/** Plural simples do português para as frases do orçamento. */
export function plural(n: number, singular: string, pluralS?: string): string {
	return n === 1 ? singular : (pluralS ?? `${singular}s`);
}

/** Área em m² com 4 casas — a escala em que 1 peça pequena ainda aparece. */
export function m2BR(areaMm2: number): string {
	return `${numeroBR(areaMm2 / 1e6, 4)} m²`;
}
