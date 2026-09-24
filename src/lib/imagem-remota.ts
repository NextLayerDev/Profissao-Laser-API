import sharp from 'sharp';
import { ToolEngineError } from './tool-errors.js';

/**
 * BAIXAR UMA IMAGEM QUE JÁ É NOSSA — o único jeito de um bloco transformar uma
 * URL em bytes.
 *
 * Por que este arquivo existe: até a F4 nenhum bloco baixava imagem nenhuma. A
 * imagem sempre CHEGAVA (upload multipart) ou era GERADA (modelo). Os Ajustes
 * quebram isso: a arte que o aluno quer ampliar já está na CDN, e mandá-la de
 * volta pelo navegador só para o servidor recebê-la seria pagar duas vezes a
 * mesma banda — a dele, subindo, e a nossa, descendo.
 *
 * ┌─ E POR QUE UM ARQUIVO INTEIRO PARA UM `fetch` ──────────────────────────┐
 * │ Porque "o servidor busca uma URL que veio do banco" é a definição de     │
 * │ SSRF. A coleção `galeria` aceita SUBMISSÃO DE ALUNO                      │
 * │ (`submissions.who:'student'`), e o campo `url` é dado que ELE escreve.   │
 * │ Um `fetch(entry.data.url)` cru deixaria qualquer aluno apontar o nosso   │
 * │ servidor para `http://169.254.169.254/…` (metadados da nuvem) ou para    │
 * │ um serviço interno, e ainda receber o corpo da resposta de volta         │
 * │ renderizado como imagem.                                                 │
 * │                                                                          │
 * │ A defesa NÃO é uma blacklist de IPs privados (o DNS pode mudar entre a   │
 * │ checagem e a conexão): é ALLOWLIST DE HOST. Só a nossa CDN. Um host      │
 * │ fora da lista nem chega a virar conexão.                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Mora em `lib/` e não dentro do bloco porque o Ateliê tem um segundo cliente
 * óbvio para ele: a composição do LOGO da marca sobre a arte (F4) precisa
 * exatamente disto — `marca.logo_url` → Buffer — e com o mesmo cuidado, já que
 * o logo também é upload de aluno.
 */

/** Teto de bytes de UMA imagem baixada. Espelha o teto de upload do aluno (5 MB) com folga para a arte gerada em 4K. */
export const MAX_BYTES_IMAGEM_REMOTA = 25 * 1024 * 1024;

/** Teto de pixels na DECODIFICAÇÃO — um PNG de 2 KB pode declarar 30000×30000. */
const MAX_PIXELS = 60 * 1_000_000;

/** Quanto esperamos pela CDN antes de desistir. Um ajuste travado é pior que um ajuste que falha. */
const TIMEOUT_MS = 15_000;

export interface ImagemRemota {
	/** Sempre PNG: o decode-e-reescreve é o que garante que os bytes são imagem. */
	png: Buffer;
	width: number;
	height: number;
	/** Bytes ORIGINAIS baixados (não os do PNG reescrito) — para log e teto. */
	bytes: number;
}

/**
 * Hosts de onde aceitamos baixar. `BUNNY_CDN_HOSTNAME` é a mesma env que
 * `lib/storage.ts` usa para MONTAR a URL na hora de subir — então a lista se
 * mantém correta sozinha: mudou a CDN, mudou o upload e mudou o download.
 *
 * `IMAGEM_REMOTA_HOSTS_EXTRA` existe só para ambiente de desenvolvimento (um
 * mock local, um bucket de teste). Vazia em produção.
 */
export function hostsPermitidos(): Set<string> {
	const lista = [
		process.env.BUNNY_CDN_HOSTNAME ?? '',
		...(process.env.IMAGEM_REMOTA_HOSTS_EXTRA ?? '').split(','),
	];
	return new Set(
		lista.map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0),
	);
}

/**
 * `true` se esta URL pode ser baixada pelo servidor.
 *
 * Exportada para teste: é a função que carrega a garantia de segurança deste
 * arquivo, e uma garantia que só é exercitada por acidente não é garantia.
 */
export function urlDeImagemPermitida(url: string): boolean {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return false;
	}
	// Só HTTPS: `http://` a um host nosso ainda seria um downgrade que um
	// intermediário pode redirecionar.
	if (u.protocol !== 'https:') return false;
	// `https://user:senha@cdn.nosso.com@evil.com/` — credencial embutida é o
	// truque clássico para confundir parser de URL. Recusa direta.
	if (u.username || u.password) return false;
	return hostsPermitidos().has(u.hostname.toLowerCase());
}

/**
 * Baixa uma imagem de um host permitido e devolve o PNG normalizado.
 *
 * Lança `ToolEngineError` — nunca `Error` cru — porque quem chama é um bloco
 * dentro de um run que pode já ter sido cobrado: o controller precisa do status
 * certo (400 do aluno / 502 da CDN) para decidir estorno e mensagem.
 */
export async function baixarImagemRemota(
	url: string,
	opts: { maxBytes?: number; signal?: AbortSignal } = {},
): Promise<ImagemRemota> {
	if (!urlDeImagemPermitida(url)) {
		// Mensagem sem a URL: ela pode ser o que o aluno escreveu, e ecoá-la de
		// volta na tela é o começo de um XSS refletido em qualquer front descuidado.
		throw new ToolEngineError(
			400,
			'Essa imagem não está hospedada aqui — só consigo trabalhar com arquivos da própria plataforma.',
		);
	}
	const maxBytes = opts.maxBytes ?? MAX_BYTES_IMAGEM_REMOTA;

	const relogio = AbortSignal.timeout(TIMEOUT_MS);
	const signal = opts.signal
		? AbortSignal.any([opts.signal, relogio])
		: relogio;

	let res: Response;
	try {
		res = await fetch(url, {
			signal,
			// `error` e não `follow`: um 302 é a saída dos fundos da allowlist —
			// o host checado seria o nosso e o host BAIXADO seria o do atacante.
			redirect: 'error',
		});
	} catch (err) {
		const causa = err instanceof Error ? err.message : 'falha de rede';
		throw new ToolEngineError(502, `Não consegui buscar a imagem: ${causa}`);
	}
	if (!res.ok) {
		throw new ToolEngineError(
			res.status === 404 ? 404 : 502,
			res.status === 404
				? 'O arquivo dessa imagem não está mais no servidor.'
				: `Não consegui buscar a imagem (HTTP ${res.status}).`,
		);
	}

	// O `content-length` é uma DICA (o servidor pode mentir ou omitir), então
	// serve só para recusar cedo o que já se sabe grande demais. O teto de
	// verdade é a contagem byte a byte abaixo.
	const declarado = Number(res.headers.get('content-length') ?? '');
	if (Number.isFinite(declarado) && declarado > maxBytes) {
		throw new ToolEngineError(413, 'Essa imagem é grande demais para ajustar.');
	}

	const bruto = await lerComTeto(res, maxBytes);

	try {
		// DECODIFICA E REESCREVE — o mesmo princípio de `lib/collection-upload.ts`:
		// o que prova que são bytes de imagem é o decoder aceitar, não a extensão
		// nem o `content-type`.
		const img = sharp(bruto, { limitInputPixels: MAX_PIXELS });
		const meta = await img.metadata();
		const png = await img.png().toBuffer();
		return {
			png,
			width: meta.width ?? 0,
			height: meta.height ?? 0,
			bytes: bruto.byteLength,
		};
	} catch {
		throw new ToolEngineError(
			422,
			'O arquivo dessa imagem está corrompido ou não é uma imagem.',
		);
	}
}

/** Lê o corpo contando bytes e aborta ao passar do teto (sem bufferizar o excesso). */
async function lerComTeto(res: Response, maxBytes: number): Promise<Buffer> {
	if (!res.body) {
		throw new ToolEngineError(502, 'A imagem veio vazia do servidor.');
	}
	const pedacos: Buffer[] = [];
	let total = 0;
	const reader = res.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			// Cancela o download no meio: sem isto, um servidor hostil (ou um
			// arquivo gigante nosso mesmo) continuaria chegando à memória depois de
			// o teto ter estourado.
			await reader.cancel().catch(() => {});
			throw new ToolEngineError(
				413,
				'Essa imagem é grande demais para ajustar.',
			);
		}
		pedacos.push(Buffer.from(value));
	}
	if (total === 0) {
		throw new ToolEngineError(502, 'A imagem veio vazia do servidor.');
	}
	return Buffer.concat(pedacos);
}
