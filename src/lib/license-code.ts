import crypto from 'node:crypto';

/**
 * Código de autenticidade da arte licenciada.
 *
 * Vai GRAVADO A LASER na peça e é lido por gente e por câmera de celular, o que
 * dita cada escolha aqui.
 */

/**
 * Alfabeto sem `I`, `L`, `O`, `U`.
 *
 * `I`/`L`/`1` e `O`/`0` se confundem numa gravação a laser fotografada de lado;
 * `U` sai para não formar palavra sem querer. Sobram 32 símbolos — potência de
 * dois, então cada byte sorteado vira um símbolo sem viés de módulo.
 */
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GRUPOS = 4;
const TAMANHO_GRUPO = 5;

/**
 * `PL-XXXXX-XXXXX-XXXXX-XXXXX` — 20 símbolos, ~100 bits.
 *
 * `randomBytes` e não `Math.random`: o código é credencial de exibição, e um
 * PRNG previsível permitiria enumerar as peças emitidas.
 */
export function gerarCodigoLicenca(prefixo = 'PL'): string {
	const total = GRUPOS * TAMANHO_GRUPO;
	const bytes = crypto.randomBytes(total);
	let saida = '';
	for (let i = 0; i < total; i += 1) {
		saida += ALFABETO[bytes[i] % ALFABETO.length];
	}
	const grupos: string[] = [];
	for (let i = 0; i < GRUPOS; i += 1) {
		grupos.push(saida.slice(i * TAMANHO_GRUPO, (i + 1) * TAMANHO_GRUPO));
	}
	return `${prefixo}-${grupos.join('-')}`;
}

/**
 * Quem digita o código do QR erra caixa e espaço. Normalizar antes de comparar
 * é o que faz "pl cpn2p cy9a3..." encontrar a mesma peça.
 */
export function normalizarCodigo(codigo: string): string {
	return codigo.trim().toUpperCase().replace(/\s+/g, '');
}

/** O banco guarda só o hash; o claro fica na peça e com o dono. */
export function hashCodigo(codigo: string): string {
	return crypto
		.createHash('sha256')
		.update(normalizarCodigo(codigo))
		.digest('hex');
}

/**
 * A URL que o QR da peça carrega — a página pública `/a/:code`, que resolve sem
 * login porque quem escaneia um chaveiro comprado numa feira não tem conta.
 *
 * Mora aqui, junto do código, e não no controller: a URL é gravada DENTRO da
 * peça física. Uma vez queimada no acrílico, ela não muda mais — então o
 * endereço tem uma fonte só, e mudá-lo é uma decisão consciente e única.
 */
export function urlPublicaDaPeca(code: string): string {
	const base = (
		process.env.NEXT_PUBLIC_SITE_URL || 'https://profissaolaser.com.br'
	).replace(/\/+$/, '');
	return `${base}/a/${encodeURIComponent(code)}`;
}
