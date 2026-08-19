import sharp from 'sharp';
import {
	anexarArtes,
	atualizarTamanhoDoLote,
	emitirLote,
	listarLote,
} from '../repositories/licensed-art.js';
import { urlPublicaDaPeca } from './license-code.js';
import { carimbarPeca } from './license-stamp.js';
import { deleteByUrl, fetchToolOutput, uploadToolOutput } from './storage.js';
import type { ToolDefinitionDoc } from './tool-definitions.js';

/**
 * O cliente do upvox é carregado SOB DEMANDA porque ele valida
 * `EXTERNAL_API_URL` já no import. Importá-lo aqui de cima faria a rota da
 * biblioteca — que só precisa dele para ampliar tiragem — derrubar qualquer
 * teste que apenas monte as rotas. Mesmo padrão de `tool-blocks/brand-asset`.
 */
const upvox = () => import('./upvox-tools.js');

/**
 * A PEÇA LICENCIADA: carimbar, subir e fazer o lote crescer.
 *
 * Mora aqui, e não no controller do motor, porque nada disto é geração — é
 * emissão e entrega. E porque a rota da biblioteca precisa de `ampliarLote`
 * sem arrastar o motor inteiro (e o `EXTERNAL_API_URL` que ele exige) junto.
 */

/**
 * Teto de peças por lote. 50 peças de ~3 MB são ~150 MB de egress e alguns
 * segundos de CPU a quatro em voo — acima disso a rodada começa a competir com
 * os picos de memória do encoder de vídeo no mesmo processo.
 */
export const MAX_TIRAGEM = Number(process.env.TOOL_MAX_PRINT_RUN) || 50;

/**
 * Carimba a arte e sobe a peça. É o ponto onde a licença deixa de ser um dado
 * ao lado do arquivo e passa a ser parte dele.
 *
 * O master vem da BAG, não do `output`: `definition.output` é allow-list e, numa
 * tool licenciada, ele de propósito não expõe o buffer da arte. `licensing.master`
 * aponta a chave (`gen.png`), e a ausência dela derruba o run em vez de deixar
 * passar — mexer na definition passa a ser uma queda barulhenta, não um
 * vazamento silencioso.
 */
export async function carimbarLote(args: {
	doc: ToolDefinitionDoc;
	bag: Record<string, unknown>;
	customerId: string;
	batchId: string;
	pecas: { id: string; code: string; piece_index: number }[];
}): Promise<{
	entregues: { id: string; index: number; code: string; url: string }[];
	thumb: string;
	/** A arte-mãe SEM carimbo, para o lote poder crescer depois. */
	master: Buffer;
	aviso?: string;
}> {
	const chave = args.doc.licensing?.master;
	if (!chave) {
		throw new Error(
			'definition licenciada sem `licensing.master` — o motor não sabe qual buffer carimbar',
		);
	}
	const master = args.bag[chave];
	if (!Buffer.isBuffer(master)) {
		throw new Error(
			`\`licensing.master\` aponta para '${chave}', que não é um buffer de imagem`,
		);
	}

	// Decodifica o PNG UMA vez e reusa os pixels crus em todas as peças. Sem
	// isto, um lote de 50 paga 50 decodificações do mesmo master — segundos de
	// CPU jogados fora, e o master é grande.
	const cru = await sharp(master).ensureAlpha().raw().toBuffer({
		resolveWithObject: true,
	});
	const base = () =>
		sharp(cru.data, {
			raw: {
				width: cru.info.width,
				height: cru.info.height,
				channels: cru.info.channels,
			},
		})
			.png()
			.toBuffer();

	const entregues: {
		id: string;
		index: number;
		code: string;
		url: string;
	}[] = [];
	let aviso: string | undefined;
	let primeiroPng: Buffer | undefined;

	// Quatro em voo: o suficiente para o lote não ficar serial, longe o bastante
	// do pico de RAM que o encoder de vídeo já mostrou ser real neste processo.
	const FILA = 4;
	let proxima = 0;
	async function trabalhador() {
		for (;;) {
			const i = proxima++;
			if (i >= args.pecas.length) return;
			const peca = args.pecas[i];
			const { png, aviso: a } = await carimbarPeca(await base(), {
				code: peca.code,
				url: urlPublicaDaPeca(peca.code),
			});
			if (a && !aviso) aviso = a;
			if (peca.piece_index === 1) primeiroPng = png;
			// O NOME DO ARQUIVO É O CÓDIGO, e o lote vive numa pasta só: é o que o
			// operador precisa no chão de fábrica para achar a peça 23 de 50 e
			// conferir o código gravado sem abrir o arquivo.
			/**
			 * O LOTE vai no `path`, não no `folder`.
			 *
			 * `uploadToolOutput` corta o folder em 80 caracteres, e
			 * `arte-licenciada/<uuid do cliente>/<uuid do lote>` dá 90: o id do lote
			 * saía truncado no meio, e a pasta deixava de ser o lote. O `path` não
			 * é cortado.
			 *
			 * O nome do arquivo continua sendo o código, e o número na frente
			 * ordena: é assim que o operador acha a peça 23 sem abrir nada.
			 */
			const url = await uploadToolOutput(
				`arte-licenciada/${args.customerId}`,
				png,
				`${args.batchId}/${String(peca.piece_index).padStart(3, '0')}-${peca.code}.png`,
				'image/png',
			);
			entregues.push({
				id: peca.id,
				index: peca.piece_index,
				code: peca.code,
				url,
			});
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(FILA, args.pecas.length) }, trabalhador),
	);
	entregues.sort((a, b) => a.index - b.index);

	// A prévia da tela é reduzida e é da peça JÁ CARIMBADA. Devolver o master em
	// base64 — o que a definition fazia — era a segunda porta por onde a arte
	// limpa saía em alta resolução.
	// A prévia é achatada sobre branco DE PROPÓSITO: a peça entregue tem fundo
	// transparente (na máquina, "não queime aqui"), e sobre a tela escura do app
	// o carimbo preto sumiria. O arquivo continua com alfa — quem muda é só a
	// miniatura.
	const thumbBuf = await sharp(primeiroPng ?? (await base()))
		.flatten({ background: '#ffffff' })
		.resize(512, 512, { fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 82 })
		.toBuffer();

	return {
		entregues,
		thumb: `data:image/webp;base64,${thumbBuf.toString('base64')}`,
		master,
		aviso,
	};
}

/**
 * O desfecho de uma ampliação: as peças novas, ou o motivo da recusa.
 *
 * Forma única em vez de união discriminada porque o `tsconfig` deste serviço
 * não liga `strict`, e sem `strictNullChecks` o `if (!r.ok)` não estreita —
 * o chamador acabaria com erro de tipo em cima de um código correto.
 */
export interface AmpliacaoResult {
	ok: boolean;
	/** Os mesmos códigos declarados no schema da rota. */
	status?: 400 | 401 | 402 | 404 | 409 | 503;
	message?: string;
	pecas?: { index: number; code: string; url: string }[];
}

/**
 * AMPLIAR A TIRAGEM de um lote que já existe, sem rodar o modelo de novo.
 *
 * A tiragem é escolhida ANTES de a arte existir — ninguém encomenda 50 peças no
 * escuro. Aqui o aluno viu o resultado, vendeu bem, e pede mais: são só carimbo
 * e licença sobre a MESMA arte-mãe. É a decomposição do preço (geração ≠ peça)
 * cobrando só o que de fato acontece N vezes.
 *
 * O mesmo tudo-ou-nada da emissão original: as peças novas sobem primeiro, e só
 * então as linhas ficam com arquivo. Falhou no meio, apaga o que subiu, estorna
 * e nada é cobrado.
 */
export async function ampliarLoteLicenciado(args: {
	customerId: string;
	batchId: string;
	invocationId: string;
	authHeader?: string;
	toolKey: string;
}): Promise<AmpliacaoResult> {
	const { resolveToolBilling, refundInvocation, settleInvocation } =
		await upvox();
	const gate = await resolveToolBilling(
		args.customerId,
		args.toolKey,
		args.invocationId,
		args.authHeader,
	);
	if (gate.mode !== 'paid') {
		return {
			ok: false,
			status: 402,
			message: 'Ampliar a tiragem precisa de uma rodada cobrada.',
		};
	}
	// Aqui NÃO existe a "primeira peça grátis": a rodada não gera arte nenhuma,
	// só emite licenças. Cada peça pedida é uma peça paga.
	const quantidade = gate.licenseUnits ?? 0;
	if (quantidade < 1) {
		return {
			ok: false,
			status: 400,
			message: 'Nenhuma peça a mais foi comprada nesta rodada.',
		};
	}

	const lote = await listarLote(args.batchId, args.customerId);
	if (lote.length === 0) {
		// Lote inexistente e lote de outra pessoa dão a MESMA resposta.
		await refundInvocation(args.customerId, args.invocationId, args.authHeader);
		return { ok: false, status: 404, message: 'Lote não encontrado.' };
	}
	const masterUrl = lote.find((p) => p.master_path)?.master_path;
	if (!masterUrl) {
		await refundInvocation(args.customerId, args.invocationId, args.authHeader);
		return {
			ok: false,
			status: 409,
			message:
				'Este lote é anterior à ampliação de tiragem — a arte original não foi guardada. Gere de novo para ampliar.',
		};
	}

	const jaTem = Math.max(...lote.map((p) => p.piece_index));
	const total = jaTem + quantidade;
	if (total > MAX_TIRAGEM) {
		await refundInvocation(args.customerId, args.invocationId, args.authHeader);
		return {
			ok: false,
			status: 400,
			message: `A tiragem de um lote vai até ${MAX_TIRAGEM} peças.`,
		};
	}

	let subidas: string[] = [];
	try {
		const master = await fetchToolOutput(masterUrl);
		const novas = await emitirLote({
			customerId: args.customerId,
			featureKey: lote[0].feature_key,
			licensorName: lote[0].licensor_name,
			toolKey: args.toolKey,
			invocationId: args.invocationId,
			promptTitle: lote[0].prompt_title,
			batchId: args.batchId,
			tamanho: quantidade,
			inicio: jaTem + 1,
			masterPath: masterUrl,
		});

		const carimbadas = await carimbarLote({
			// A arte-mãe entra pela bag como se tivesse acabado de sair do motor —
			// assim o caminho do carimbo é literalmente o mesmo da geração.
			doc: { licensing: { master: 'master.png' } } as ToolDefinitionDoc,
			bag: { 'master.png': master },
			customerId: args.customerId,
			batchId: args.batchId,
			pecas: novas.map((a) => ({
				id: a.id,
				code: a.code,
				piece_index: a.piece_index,
			})),
		});
		subidas = carimbadas.entregues.map((e) => e.url);
		await anexarArtes(
			carimbadas.entregues.map((e) => ({ id: e.id, previewUrl: e.url })),
		);
		await atualizarTamanhoDoLote(args.batchId, total);
		await settleInvocation(args.customerId, args.invocationId, args.authHeader);

		return {
			ok: true,
			pecas: carimbadas.entregues.map((e) => ({
				index: e.index,
				code: e.code,
				url: e.url,
			})),
		};
	} catch (err) {
		console.error('[tool-run] ampliação de lote falhou:', err);
		await Promise.all(subidas.map((u) => deleteByUrl(u).catch(() => {})));
		await refundInvocation(args.customerId, args.invocationId, args.authHeader);
		return {
			ok: false,
			status: 503,
			message:
				'Não foi possível emitir as peças novas. Nada foi cobrado — tente de novo.',
		};
	}
}
