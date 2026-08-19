import sharp from 'sharp';
import {
	anexarArtes,
	apagarLoteSemArte,
	atualizarTamanhoDoLote,
	emitirLote,
	listarLote,
} from '../repositories/licensed-art.js';
import { urlPublicaDaPeca } from './license-code.js';
import { cantoMaisQuieto, carimbarPeca } from './license-stamp.js';
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

/** Uma linha da lista de dados variáveis. */
export interface PecaVariavel {
	/** O que muda nesta peça: o nome, a frase. Vazio = só a foto muda. */
	tema: string | null;
}

/** Limite do rótulo. Nome de pessoa não passa disso; prompt inteiro, sim. */
const MAX_ROTULO = 120;

/**
 * Lê a lista de DADOS VARIÁVEIS do corpo do run.
 *
 * Formato: `[{"tema": "Marina"}, {"tema": "João"}]` — uma linha por peça, na
 * ordem em que as peças serão numeradas. A foto de cada linha, quando existe,
 * vem como arquivo `piece_image_<i>` (i base 0), fora do JSON.
 *
 * Ausente devolve `null`, e `null` é o lote uniforme de sempre: N cópias da
 * mesma arte. Só quem manda a lista muda de caminho.
 *
 * Lança em vez de devolver erro estruturado porque o único chamador é o
 * controller, que já traduz exceção em 400 com estorno.
 */
export function lerDadosVariaveis(
	bruto: string | undefined | null,
): PecaVariavel[] | null {
	if (!bruto || !bruto.trim()) return null;

	let cru: unknown;
	try {
		cru = JSON.parse(bruto);
	} catch {
		throw new Error('A lista de peças não é um JSON válido.');
	}
	if (!Array.isArray(cru) || cru.length === 0) {
		throw new Error('A lista de peças está vazia.');
	}
	if (cru.length > MAX_TIRAGEM) {
		throw new Error(`A tiragem de um lote vai até ${MAX_TIRAGEM} peças.`);
	}

	return cru.map((linha, i) => {
		if (typeof linha !== 'object' || linha === null) {
			throw new Error(`A peça ${i + 1} da lista não é um objeto.`);
		}
		const tema = (linha as { tema?: unknown }).tema;
		if (tema !== undefined && tema !== null && typeof tema !== 'string') {
			throw new Error(`O texto da peça ${i + 1} não é um texto.`);
		}
		const limpo = typeof tema === 'string' ? tema.trim() : '';
		if (limpo.length > MAX_ROTULO) {
			throw new Error(
				`O texto da peça ${i + 1} passa de ${MAX_ROTULO} caracteres.`,
			);
		}
		return { tema: limpo || null };
	});
}

/** Troca `{var}` pelos campos; deixa o placeholder quando a var não existe. */
function trocarVariaveis(molde: string, ctx: Record<string, string>): string {
	return molde.replace(/\{(\w+)\}/g, (_m, k: string) =>
		ctx[k] !== undefined ? ctx[k] : `{${k}}`,
	);
}

/**
 * OS CAMPOS DE UMA PEÇA do lote com dados variáveis.
 *
 * ┌─ O BUG QUE ESTA FUNÇÃO EXISTE PARA IMPEDIR ─────────────────────────────┐
 * │ A injeção do banco troca `{tema}` UMA vez, no começo do run, e depois    │
 * │ `fields.prompt` já é texto pronto. Mudar `fields.tema` por peça, dali em │
 * │ diante, não muda mais nada — o `{tema}` não existe mais no prompt.       │
 * │                                                                          │
 * │ O resultado era silencioso e caro: a lista era lida, cobrada como N      │
 * │ gerações, gravada no rótulo de cada peça… e as N artes saíam sem o nome  │
 * │ de ninguém. Medido em produção com MARINA e JOAO: duas peças, dois       │
 * │ códigos, dois arquivos diferentes e nenhum nome.                         │
 * │                                                                          │
 * │ Por isso o MOLDE cru é guardado antes da troca, e a peça refaz a troca   │
 * │ com o texto dela.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function camposDaPeca(
	fields: Record<string, string>,
	/** Os campos injetados com `substitute: true`, ainda com `{var}` dentro. */
	moldes: Record<string, string>,
	linha: PecaVariavel,
): Record<string, string> {
	const campos = { ...fields };
	if (linha.tema) campos.tema = linha.tema;
	for (const [nome, molde] of Object.entries(moldes)) {
		campos[nome] = trocarVariaveis(molde, campos);
	}
	return campos;
}

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
	/** Lote UNIFORME: a arte-mãe sai daqui, da bag do run. */
	doc?: ToolDefinitionDoc;
	bag?: Record<string, unknown>;
	/**
	 * Lote com DADOS VARIÁVEIS: a arte própria de cada peça, por `piece_index`.
	 *
	 * Quando vem, `doc`/`bag` nem são olhados e não existe arte-mãe — não há o
	 * que clonar, porque nenhuma peça é cópia de outra. É a diferença entre 50
	 * copos iguais e 50 canecas com 50 nomes.
	 */
	artes?: Map<number, Buffer>;
	customerId: string;
	batchId: string;
	pecas: { id: string; code: string; piece_index: number }[];
	/**
	 * Diário das URLs já subidas, preenchido À MEDIDA que cada peça sobe.
	 *
	 * Existe porque a limpeza precisa saber o que apagar QUANDO DÁ ERRADO — e aí
	 * não há valor de retorno. Uma peça que falha no meio derruba o lote, mas as
	 * que já subiram continuam no CDN: sem este diário elas viravam órfãs, com
	 * código gravado e ninguém dono. Com dados variáveis o risco deixa de ser
	 * teórico: são N chamadas ao modelo, não uma.
	 */
	subidas?: string[];
}): Promise<{
	entregues: { id: string; index: number; code: string; url: string }[];
	thumb: string;
	/**
	 * A arte-mãe SEM carimbo, para o lote poder crescer depois. NULA no lote com
	 * dados variáveis: ampliar ali significaria repetir o nome de alguém.
	 */
	master: Buffer | null;
	aviso?: string;
}> {
	let master: Buffer | null = null;
	let base: () => Promise<Buffer>;

	if (args.artes) {
		// Cada peça traz a sua — nada a decodificar em comum, nada a reusar.
		base = async () => {
			throw new Error('lote com dados variáveis não tem arte-mãe');
		};
	} else {
		const chave = args.doc?.licensing?.master;
		if (!chave) {
			throw new Error(
				'definition licenciada sem `licensing.master` — o motor não sabe qual buffer carimbar',
			);
		}
		const daBag = args.bag?.[chave];
		if (!Buffer.isBuffer(daBag)) {
			throw new Error(
				`\`licensing.master\` aponta para '${chave}', que não é um buffer de imagem`,
			);
		}
		master = daBag;

		// Decodifica o PNG UMA vez e reusa os pixels crus em todas as peças. Sem
		// isto, um lote de 50 paga 50 decodificações do mesmo master — segundos de
		// CPU jogados fora, e o master é grande.
		const cru = await sharp(master).ensureAlpha().raw().toBuffer({
			resolveWithObject: true,
		});
		base = () =>
			sharp(cru.data, {
				raw: {
					width: cru.info.width,
					height: cru.info.height,
					channels: cru.info.channels,
				},
			})
				.png()
				.toBuffer();
	}

	/**
	 * O CANTO É DECIDIDO UMA VEZ, PARA O LOTE INTEIRO.
	 *
	 * `carimbarPeca` sabe achar o canto mais quieto de uma arte sozinha, mas
	 * deixá-la escolher peça a peça faria o selo pular de lado no meio de um
	 * pedido de trinta canecas — cada uma é uma geração diferente, e o "canto
	 * mais quieto" de cada uma pode ser outro. Quem grava precisa que o lote
	 * seja uniforme.
	 *
	 * A referência é a arte-mãe no lote uniforme, e a primeira peça no lote com
	 * dados variáveis: a composição é a mesma em todas, o que muda é o nome.
	 */
	const referencia =
		master ??
		args.artes?.get(Math.min(...args.pecas.map((p) => p.piece_index)));
	const canto = referencia ? await cantoMaisQuieto(referencia) : undefined;

	const entregues: {
		id: string;
		index: number;
		code: string;
		url: string;
	}[] = [];
	let aviso: string | undefined;
	// A miniatura é a da MENOR peça deste lote — não necessariamente a de índice
	// 1. Numa ampliação que começa na peça 11, exigir a peça 1 deixava a
	// miniatura cair na arte-mãe SEM carimbo; num lote com dados variáveis, cair
	// na arte-mãe é impossível, porque não existe nenhuma.
	let primeiroPng: Buffer | undefined;
	let primeiroIndex = Number.POSITIVE_INFINITY;

	// Quatro em voo: o suficiente para o lote não ficar serial, longe o bastante
	// do pico de RAM que o encoder de vídeo já mostrou ser real neste processo.
	const FILA = 4;
	let proxima = 0;
	// Uma peça que falha derruba o lote inteiro, então as outras param de pegar
	// trabalho novo — mas a que já está na mão termina. É o que torna o diário
	// de subidas COMPLETO no momento do erro; ver `Promise.allSettled` abaixo.
	let abortada = false;
	async function trabalhador() {
		for (;;) {
			if (abortada) return;
			const i = proxima++;
			if (i >= args.pecas.length) return;
			const peca = args.pecas[i];
			const propria = args.artes?.get(peca.piece_index);
			if (args.artes && !propria) {
				throw new Error(
					`lote com dados variáveis sem arte para a peça ${peca.piece_index}`,
				);
			}
			const { png, aviso: a } = await carimbarPeca(propria ?? (await base()), {
				code: peca.code,
				url: urlPublicaDaPeca(peca.code),
				canto,
			});
			if (a && !aviso) aviso = a;
			if (peca.piece_index < primeiroIndex) {
				primeiroIndex = peca.piece_index;
				primeiroPng = png;
			}
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
			args.subidas?.push(url);
			entregues.push({
				id: peca.id,
				index: peca.piece_index,
				code: peca.code,
				url,
			});
		}
	}
	/**
	 * `allSettled`, NÃO `all`.
	 *
	 * `Promise.all` rejeita no primeiro erro e devolve o controle enquanto os
	 * outros trabalhadores ainda estão subindo arquivo. A limpeza do chamador
	 * então lia um diário incompleto, e a subida atrasada virava órfã no CDN —
	 * peça com código gravado e sem dono. Esperar todos assentarem custa um
	 * upload e fecha o buraco.
	 */
	const desfechos = await Promise.allSettled(
		Array.from({ length: Math.min(FILA, args.pecas.length) }, async () => {
			try {
				await trabalhador();
			} catch (err) {
				abortada = true;
				throw err;
			}
		}),
	);
	const falhou = desfechos.find((d) => d.status === 'rejected');
	if (falhou && falhou.status === 'rejected') throw falhou.reason;
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

	// Ver `carimbarLote.subidas`: o diário é preenchido durante o carimbo, porque
	// é no erro — quando não há valor de retorno — que a limpeza precisa dele.
	const subidas: string[] = [];
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
			subidas,
		});
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
		// As peças NOVAS somem; as antigas ficam, porque já têm arquivo — e o QR
		// delas pode estar gravado numa peça que já foi vendida.
		await apagarLoteSemArte(args.batchId, args.customerId).catch((e) =>
			console.error('[tool-run] ampliação falha não pôde ser limpa:', e),
		);
		await refundInvocation(args.customerId, args.invocationId, args.authHeader);
		return {
			ok: false,
			status: 503,
			message:
				'Não foi possível emitir as peças novas. Nada foi cobrado — tente de novo.',
		};
	}
}
