import sharp from 'sharp';
import { z } from 'zod';
import { baixarImagemRemota } from '../../lib/imagem-remota.js';
import type { Raster } from '../lib/pixels.js';
import {
	borderStats,
	chromaKeyAlpha,
	loadRaster,
	luma,
	rasterToPng,
} from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * `image.brandmark` — O LOGO DO ALUNO, COLADO NA ARTE POR CÓDIGO.
 *
 * ┌─ POR QUE ISTO É UM BLOCO E NÃO UMA FRASE NO PROMPT ──────────────────────┐
 * │ O pedido do dono é literal: "que ele monte essa arte cem por cento com a │
 * │ personalidade da empresa, então ele tem que subir logo, cores e tudo     │
 * │ mais". Cor e tom já saem da marca cadastrada. O LOGO não saía de lugar   │
 * │ nenhum — e não tem como sair: o gerador de imagem NUNCA vê o arquivo do  │
 * │ logo do aluno, e todo pedido de "coloque a logo" devolve um símbolo      │
 * │ inventado com letra torta (é o que o `O_LOGO_NAO_SE_DESENHA` do roster   │
 * │ existe para impedir).                                                    │
 * │                                                                          │
 * │ Então a marca entra DEPOIS da geração, por este bloco: sharp, aritmética │
 * │ e nada mais. Sem modelo, sem token, sem variação entre dois runs com a   │
 * │ mesma entrada.                                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE ESTE BLOCO NÃO DEPENDE MAIS DE "ÁREA RESERVADA" ────────────────┐
 * │ A primeira versão foi calibrada em cima do RETÂNGULO BRANCO OPACO que o  │
 * │ gerador desenhava quando o prompt pedia área limpa — 13,7% a 16,8% do    │
 * │ lado menor, a 35–41 px da borda, desvio ≈ 0,45. Daí saíam `scale 0.15`,  │
 * │ `margin 0.04` e a exigência de achar um canto CHAPADO.                   │
 * │                                                                          │
 * │ Medido depois, na queixa do dono: aquele retângulo NÃO era limpeza, era  │
 * │ o defeito. O gerador não sabe deixar vazio, ele DESENHA o vazio — e o    │
 * │ logo aplicado no meio dele virava adesivo colado na foto. A instrução de │
 * │ reservar área saiu do roster; então aqui não sobra canto chapado nenhum  │
 * │ para procurar, e exigir um significaria nunca mais assinar arte alguma.  │
 * │                                                                          │
 * │ O que ficou no lugar: o canto é ESCOLHIDO medindo os quatro (legibilidade│
 * │ da tinta + quão calmo é o fundo), o tamanho caiu para assinatura de      │
 * │ designer (`scale 0.09`, `margin 0.055`) e o contraste é garantido por    │
 * │ um halo suave quando — e só quando — a tinta realmente sumiria.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ REGRA DE OURO: NUNCA DERRUBAR UM RUN JÁ PAGO ──────────────────────────┐
 * │ Este bloco roda DEPOIS da geração, que é a parte cara. Logo ausente,     │
 * │ logo que não baixa, arquivo ilegível, arte pequena demais, logo todo     │
 * │ transparente, Diretor dizendo que não cabe assinatura: nada disso lança. │
 * │ Devolve a arte intacta com `logo_aplicado:false` e um `motivo` em        │
 * │ português para a tela DIZER o que aconteceu. Arte sem logo é um          │
 * │ resultado; 502 depois de pagar a geração é um prejuízo.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ATENÇÃO ao publicar: `output` da definition é ALLOW-LIST. As chaves emitidas
 * aqui (`png`, `pngBase64`, `logo_aplicado`, `canto`, `canto_origem`,
 * `tratamento`, `motivo`, `width`, `height`) precisam estar listadas lá, ou são
 * calculadas e jogadas fora em silêncio.
 *
 * ┌─ ESTE ARQUIVO EXPORTA UMA FUNÇÃO ALÉM DO BLOCO, E O MOTIVO É GEOMÉTRICO ─┐
 * │ `aplicarLogo` existe porque o KIT precisa carimbar CADA PEÇA, e o motor  │
 * │ é linear: não há laço dentro de um pipeline, então um nó `image.brandmark│
 * │ ` depois do kit carimbaria uma imagem só.                                │
 * │                                                                          │
 * │ E carimbar ANTES do recorte é pior do que parecer: medido no 1024×1024   │
 * │ com os defaults deste bloco, a caixa da assinatura cai em x 876…968. O   │
 * │ recorte 9:16 guarda x 224…800 (o logo sai INTEIRO do quadro), o 16:9     │
 * │ guarda y 224…800 (idem) e o 4:5 guarda x 102…921 — que corta o logo AO   │
 * │ MEIO. Pior ainda: um logo carimbado vira "objeto inteiro" para o         │
 * │ `avaliarRecorte`, e perder um objeto inteiro é exatamente o que faz o    │
 * │ portão do kit RECUSAR — a arte passaria a reprovar os próprios recortes  │
 * │ por causa da assinatura que nós mesmos colamos.                          │
 * │                                                                          │
 * │ Ordem certa, então: recorta primeiro (sobre a arte limpa, que é o que o  │
 * │ portão tem de julgar), carimba depois, peça por peça.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/* ─────────────────────────── o canto ─────────────────────────── */

/** Os quatro cantos onde uma assinatura de marca cabe. */
export const CANTOS = [
	'superior_esquerdo',
	'superior_direito',
	'inferior_esquerdo',
	'inferior_direito',
] as const;

export type Canto = (typeof CANTOS)[number];

/**
 * O que o Diretor de Arte pode declarar. `nenhum` existe porque sem ele o
 * Diretor não tem como dizer "não cabe assinatura nesta composição" — e um
 * modelo obrigado a escolher entre quatro cantos escolhe um.
 */
export type CantoDeclarado = Canto | 'nenhum';

/** De onde veio o canto que foi usado — a tela e o log agradecem. */
export type CantoOrigem = 'campo' | 'prosa' | 'medido' | 'nenhum';

const semAcento = (s: string): string =>
	s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Lê um canto de qualquer string — o campo enum do Diretor OU a prosa dele.
 *
 * A prosa das 4 saídas reais medidas COMEÇA pelo canto ("Canto inferior
 * direito, bloco de 80x80 pixels, fundo branco…"), e 9 de 9 amostras (4 runs +
 * 5 prompts da galeria) diziam "inferior direito". Por isso a mesma função
 * serve aos dois degraus: o que muda é a fonte, não a leitura.
 *
 * AMBIGUIDADE VIRA `null`, DE PROPÓSITO. O Leitor da Marca já respondeu, num
 * run real, "canto superior direito OU inferior direito" — ali não há decisão,
 * há duas. Chutar a primeira colaria o logo num canto que ninguém escolheu;
 * deixar a MEDIÇÃO decidir acerta.
 */
export function lerCanto(valor: unknown): CantoDeclarado | null {
	if (typeof valor !== 'string') return null;
	// Underscore é `\w`, então `\binferior\b` NÃO casa em "inferior_direito".
	// Trocar toda pontuação por espaço antes é o que faz a mesma função ler o
	// campo enum e a frase escrita à mão.
	const t = ` ${semAcento(valor.toLowerCase()).replace(/[^a-z0-9]+/g, ' ')} `;

	const temSuperior = / (superior|topo|alto|acima|cima) /.test(t);
	const temInferior = / (inferior|baixo|embaixo|base|rodape|abaixo) /.test(t);
	const temEsquerda = / (esquerdo|esquerda) /.test(t);
	const temDireita = / (direito|direita) /.test(t);

	// Os dois lados do mesmo eixo = o Diretor não decidiu. Ver o comentário acima.
	if (temSuperior !== temInferior && temEsquerda !== temDireita) {
		return `${temSuperior ? 'superior' : 'inferior'}_${
			temEsquerda ? 'esquerdo' : 'direito'
		}` as Canto;
	}

	/**
	 * `nenhum` só DEPOIS de procurar canto, e só em frase curta ou explícita.
	 *
	 * Uma saída real do Diretor diz "fundo branco SEM NENHUM detalhe" — casar
	 * "nenhum" solto no meio da prosa jogaria fora um "Canto inferior direito"
	 * escrito duas palavras antes. Aqui a negativa só vence quando não há canto
	 * nenhum na frase E ela é o campo curto (o enum) ou diz literalmente que
	 * assinatura não cabe.
	 */
	const enxuto = t.trim();
	if (/^(nenhum|nenhuma|none|nao|sem)$/.test(enxuto)) return 'nenhum';
	if (/(sem|nao (tem|cabe|ha))( area d[ae])? assinatura/.test(t)) {
		return 'nenhum';
	}
	return null;
}

/**
 * Cava o canto de dentro do objeto `direcao_arte`.
 *
 * O `resolveRefs` do motor é RASO: `time.direcao_arte.canto_da_assinatura` não
 * resolve (a bag só tem `time.direcao_arte`) e chegaria aqui como a string
 * literal do caminho. Então a definition passa o OBJETO inteiro e quem cava é
 * este bloco — que é também o motivo de o campo novo do roster não custar nada:
 * `direcao_arte` já viaja completo e já está na allow-list dos dois lados.
 */
export function cantoDaDirecao(direcao: unknown): {
	canto: CantoDeclarado | null;
	origem: CantoOrigem | null;
} {
	if (!direcao || typeof direcao !== 'object') {
		return { canto: null, origem: null };
	}
	const d = direcao as Record<string, unknown>;
	const doCampo = lerCanto(d.canto_da_assinatura);
	if (doCampo) return { canto: doCampo, origem: 'campo' };
	const daProsa = lerCanto(d.area_da_assinatura);
	if (daProsa) return { canto: daProsa, origem: 'prosa' };
	return { canto: null, origem: null };
}

/* ─────────────────────────── geometria ─────────────────────────── */

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Onde a caixa `w×h` encosta em cada canto, respeitando a folga. */
function rectDoCanto(
	canto: Canto,
	arteW: number,
	arteH: number,
	w: number,
	h: number,
	folga: number,
): Rect {
	const esquerda = canto.endsWith('esquerdo');
	const acima = canto.startsWith('superior');
	const left = esquerda ? folga : arteW - folga - w;
	const top = acima ? folga : arteH - folga - h;
	return {
		left: Math.max(0, Math.min(arteW - w, Math.round(left))),
		top: Math.max(0, Math.min(arteH - h, Math.round(top))),
		width: w,
		height: h,
	};
}

interface EstatRegiao {
	/** Luminância média (Rec.709) da região. */
	luma: number;
	/** Maior desvio-padrão entre R, G e B — "quão chapada" a região é. */
	dev: number;
}

/**
 * Estatística de um retângulo da arte: média de luminância e "quão chapado".
 *
 * A conta é feita à mão, sobre o raster que este bloco mesmo decodificou, e
 * isso é por uma ARMADILHA CARA DO SHARP: o `.stats()` é uma operação de
 * LEITURA da imagem de ENTRADA — ele IGNORA o `.extract()` encadeado antes e
 * devolve a estatística do quadro inteiro. Com
 * `sharp(arte).extract(canto).stats()` os quatro cantos deste bloco davam
 * exatamente o mesmo desvio (36,04) e a comparação entre cantos só PARECIA
 * funcionar. Somar os bytes é explícito e não tem esse fundo falso.
 *
 * (O raster chega em RGBA sempre — `loadRaster` faz `ensureAlpha` —, então não
 * há mais o caso "cinza+alfa" onde o canal 1 era o ALFA e a luminância virava
 * uma média entre tom e opacidade.)
 */
function estatDaRegiao(arte: Raster, r: Rect): EstatRegiao {
	const soma = [0, 0, 0];
	const soma2 = [0, 0, 0];
	let n = 0;
	const y1 = Math.min(arte.height, r.top + r.height);
	const x1 = Math.min(arte.width, r.left + r.width);
	for (let y = Math.max(0, r.top); y < y1; y++) {
		for (let x = Math.max(0, r.left); x < x1; x++) {
			const p = (y * arte.width + x) * 4;
			n++;
			for (let k = 0; k < 3; k++) {
				const v = arte.data[p + k];
				soma[k] += v;
				soma2[k] += v * v;
			}
		}
	}
	if (n === 0) return { luma: 0, dev: 0 };
	const media = soma.map((s) => s / n);
	const dev = soma2.map((s2, k) =>
		Math.sqrt(Math.max(0, s2 / n - media[k] * media[k])),
	);
	return {
		luma: luma(media[0], media[1], media[2]),
		dev: Math.max(dev[0], dev[1], dev[2]),
	};
}

/**
 * O MIOLO do retângulo (70% central), que é o que se mede para saber se um
 * canto está calmo.
 *
 * Medir o retângulo inteiro seria medir a borda, não o fundo do logo: a caixa
 * do logo encosta na folga, e alguns pixels de diferença bastam para a beirada
 * pegar a quina da bancada e o desvio explodir. O miolo tolera esse
 * deslocamento e continua respondendo a pergunta certa: "atrás do desenho tem
 * detalhe?".
 */
function miolo(r: Rect): Rect {
	const w = Math.max(8, Math.round(r.width * 0.7));
	const h = Math.max(8, Math.round(r.height * 0.7));
	return {
		left: r.left + Math.floor((r.width - w) / 2),
		top: r.top + Math.floor((r.height - h) / 2),
		width: Math.min(w, r.width),
		height: Math.min(h, r.height),
	};
}

/**
 * Desvio-padrão a partir do qual um canto conta como AGITADO.
 *
 * Não é mais um portão (ver o cabeçalho: exigir canto chapado hoje significaria
 * nunca assinar arte nenhuma), é a régua que transforma "quão calmo é este
 * canto" num número de 0 a 1 para a escolha do canto. Medido: o cartão branco
 * que o gerador desenhava dava ≈ 0,45; madeira rústica, 40–70; uma parede
 * desfocada de fundo, 13–25. Em 60 a conta satura, e daí para cima tanto faz —
 * todo canto muito ocupado é igualmente ruim.
 */
const DEV_AGITADO = 60;

/**
 * Quanto a legibilidade pesa na nota do canto (o resto é a calma do fundo).
 * Logo ilegível não é assinatura; logo sobre fundo agitado ainda é.
 */
const PESO_LEGIBILIDADE = 0.7;

/**
 * De quanto o canto declarado pelo Diretor precisa perder para ser trocado.
 * Empate técnico mantém a escolha dele — ver o comentário em `aplicarLogo`.
 *
 * ┌─ 0,15 FAZIA A MEDIÇÃO NUNCA DECIDIR NADA — e isso foi medido ────────────┐
 * │ A nota é `legibilidade × 0,7 + calma × 0,3`. Com logo colorido a          │
 * │ legibilidade dá 1,0 nos QUATRO cantos (medido: 20 de 20 casos com o logo  │
 * │ real), então quem decide de fato é só a `calma` — e a calma move a nota   │
 * │ no máximo 0,30, de ponta a ponta. Uma margem de 0,15 é METADE dessa       │
 * │ faixa: no caso comum o canto declarado é inderrotável, e a promessa "o    │
 * │ Diretor sugere, a medição decide" era letra morta.                        │
 * │                                                                          │
 * │ O flagrante, numa peça real de troféu: o gerador pôs a manchete no alto à │
 * │ esquerda, que era justamente o canto que o Diretor tinha declarado (ele   │
 * │ nunca vê a imagem). Notas medidas naquela arte —                          │
 * │   superior_esquerdo (com a manchete) .. dev 34,9 · calma 0,418 · 0,825    │
 * │   inferior_esquerdo (linho calmo) ..... dev 14,8 · calma 0,753 · 0,926    │
 * │ Diferença 0,101: a medição VIU o problema e não teve força para trocar.   │
 * │ O logo pousou em cima da primeira letra do título.                        │
 * │                                                                          │
 * │ 0,05 continua sendo empate técnico e não faz duas peças do mesmo kit      │
 * │ assinarem em lugares diferentes por ruído: equivale a ~10 de desvio       │
 * │ (60 × 0,05 / 0,30), que é exatamente a distância entre uma parede         │
 * │ desfocada (13 a 25) e um canto ocupado por texto ou por quina (35+).      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const MARGEM_PARA_TROCAR_CANTO = 0.05;

/** Menor caixa que ainda dá para reconhecer um logo. Abaixo disso, não vale. */
const MIN_BOX_PX = 24;

/**
 * Teto do LADO LONGO do logo, sobre o lado menor da arte — ver a caixa do
 * dimensionamento em `aplicarLogo`.
 *
 * É o dobro de `scale` (0,09) mais um pouco. A régua importa porque um lockup
 * horizontal 5:1 (o formato de 9 em cada 10 logos de oficina) dimensionado pelo
 * QUADRADO da `scale` recebe uma faixa de dois pixels de altura: com `scale`
 * 0,09 num 1024² seriam 92×18, e "LASER ART MARCENARIA" ali é um borrão. Com o
 * teto do lado longo em 0,20 o mesmo lockup sai 205×41 — assinatura pequena,
 * mas com altura de letra que se lê.
 *
 * Um logo QUADRADO não muda de tamanho por causa disto: `fit:'inside'` num
 * 205×92 devolve 92×92, que é exatamente a caixa da `scale`.
 */
const SCALE_LADO_LONGO = 0.2;

/* ─────────────────────────── o logo ─────────────────────────── */

/** Quanto do logo é opaco, e como ele é feito de cor. */
interface PerfilLogo {
	/** Luminância média dos pixels opacos. */
	luma: number;
	/** Quantos pixels opacos (alpha ≥ 128). */
	opacos: number;
	/** Maior amplitude de canal entre os opacos — logo de tinta única fica baixo. */
	spread: number;
}

const ALPHA_OPACO = 128;

function perfilDoLogo(r: Raster): PerfilLogo {
	const d = r.data;
	let soma = 0;
	let n = 0;
	let minR = 255;
	let maxR = 0;
	let minG = 255;
	let maxG = 0;
	let minB = 255;
	let maxB = 0;
	for (let p = 0; p < d.length; p += 4) {
		if (d[p + 3] < ALPHA_OPACO) continue;
		n++;
		soma += luma(d[p], d[p + 1], d[p + 2]);
		if (d[p] < minR) minR = d[p];
		if (d[p] > maxR) maxR = d[p];
		if (d[p + 1] < minG) minG = d[p + 1];
		if (d[p + 1] > maxG) maxG = d[p + 1];
		if (d[p + 2] < minB) minB = d[p + 2];
		if (d[p + 2] > maxB) maxB = d[p + 2];
	}
	return {
		luma: n ? soma / n : 0,
		opacos: n,
		spread: n ? Math.max(maxR - minR, maxG - minG, maxB - minB) : 0,
	};
}

/** Abaixo disso o logo é de TINTA ÚNICA e inverter a tinta é seguro. */
const SPREAD_MONOCROMATICO = 48;

/** Inverte a tinta preservando o alpha (só faz sentido em logo monocromático). */
function inverterTinta(r: Raster): void {
	const d = r.data;
	for (let p = 0; p < d.length; p += 4) {
		if (d[p + 3] < ALPHA_OPACO) continue;
		d[p] = 255 - d[p];
		d[p + 1] = 255 - d[p + 1];
		d[p + 2] = 255 - d[p + 2];
	}
}

/* ─────────── legibilidade: por PIXEL, e enxergando COR ─────────── */

/**
 * Distância RGB a partir da qual dois pixels se separam por COR, mesmo com a
 * mesma luminância. 80 numa escala que vai até 441 (√3 × 255): é a distância
 * entre o vermelho da marca e o marrom de uma tábua, e fica bem abaixo dos 148
 * que o pior dos 20 casos medidos apresentou.
 */
const DELTA_COR = 80;

/**
 * DUAS MÉDIAS NÃO DIZEM SE UM LOGO SE LÊ — e essa era a conta antiga.
 *
 * A versão anterior comparava `média de luma do logo` com `média de luma do
 * canto` e, abaixo de 40 de diferença, desenhava uma PASTILHA OPACA atrás do
 * logo. O dono viu o resultado e chamou pelo nome: "sem fundo na logo".
 *
 * A conta era enganosa nos dois lados. O logo real do aluno é feito de vermelho
 * (luma 57), azul (76) e amarelo (178): a média dá 82,8, que não é a luminância
 * de NENHUMA das três regiões. A madeira de uma bancada varia de 30 a 190 e a
 * média dá ~83. Duas médias iguais, e mesmo assim o logo se lê perfeitamente —
 * porque primária saturada sobre marrom dessaturado é diferença de COR, que a
 * luminância não vê. Medido nos 20 casos da investigação: o ΔE nunca ficou
 * abaixo de 148 e a placa disparava em 8 deles. Prova extrema: fundo cinza
 * chapado de luma 83 (diferença de luma literalmente ZERO) — o logo se lê, e a
 * régua antiga mandava tapar.
 *
 * A conta certa é por PIXEL e com cor: cada pixel de tinta contra o pixel da
 * arte que está exatamente atrás dele. Ele se separa se o TOM difere
 * (`Δluma ≥ min_contrast`) OU se a COR difere (`ΔE ≥ 80` na distância RGB).
 * Medido com esta régua: 0 disparos em 20 com o logo real (contra 8), e ela
 * continua NÃO sendo vazia — com um logo de controle quase branco sobre arte
 * clara acusa 0% e 19% de tinta legível, e nos dois casos honestos (arte
 * pintada no vermelho e no azul da própria marca) acusa 54% e 62%.
 *
 * Devolve a FRAÇÃO da tinta que se lê. Sem tinta nenhuma devolve 1 — quem trata
 * logo vazio é o degrau anterior, e devolver 0 aqui faria o halo disparar em
 * cima de nada.
 */
export function legibilidadeDaTinta(
	logo: Raster,
	arte: Raster,
	left: number,
	top: number,
	deltaLuma: number,
): number {
	let tinta = 0;
	let legivel = 0;
	for (let y = 0; y < logo.height; y++) {
		const ay = top + y;
		if (ay < 0 || ay >= arte.height) continue;
		for (let x = 0; x < logo.width; x++) {
			const p = (y * logo.width + x) * 4;
			if (logo.data[p + 3] < ALPHA_OPACO) continue;
			const ax = left + x;
			if (ax < 0 || ax >= arte.width) continue;
			const q = (ay * arte.width + ax) * 4;
			tinta++;
			const dl = Math.abs(
				luma(logo.data[p], logo.data[p + 1], logo.data[p + 2]) -
					luma(arte.data[q], arte.data[q + 1], arte.data[q + 2]),
			);
			const dr = logo.data[p] - arte.data[q];
			const dg = logo.data[p + 1] - arte.data[q + 1];
			const db = logo.data[p + 2] - arte.data[q + 2];
			if (
				dl >= deltaLuma ||
				Math.sqrt(dr * dr + dg * dg + db * db) >= DELTA_COR
			) {
				legivel++;
			}
		}
	}
	return tinta ? legivel / tinta : 1;
}

/**
 * Fração da tinta que precisa se separar para o logo entrar SEM tratamento.
 *
 * Não é 100% de propósito: a borda anti-aliasada de qualquer logo tem sempre
 * alguns pixels quase iguais ao fundo, e exigir a perfeição faria o tratamento
 * disparar sempre.
 *
 * 0,85 saiu de uma varredura de 5 artes × 4 cantos × 4 logos:
 *  · logo REAL do aluno: 100% de tinta legível nos 20 casos. Qualquer piso
 *    entre 0,75 e 0,90 dá o mesmo — ZERO disparo. Não é a régua que decide o
 *    caso comum, e é isso que se quer;
 *  · wordmark preto sobre madeira escura: 77% e 79% em dois cantos. Com piso
 *    0,75 isso passava raspando e a assinatura saía escura sobre escuro, quase
 *    ilegível (olhado, não deduzido); com 0,85 ela é INVERTIDA e vira branca —
 *    grátis, porque tinta única inverte sem inventar cor;
 *  · logo pintado na cor da própria marca sobre fundo da mesma cor: 54% e 62%,
 *    bem abaixo de qualquer piso — é o caso que precisa de halo.
 */
const TINTA_LEGIVEL_MIN = 0.85;

/* ─────────── o resgate: halo suave, nunca pastilha ─────────── */

/** Quanto da caixa do logo o halo transborda para fora da tinta. */
const HALO_PAD_REL = 0.16;
/** Raio do borrão que faz o halo ser halo, e não contorno de adesivo. */
const HALO_BLUR_REL = 0.055;
/** Ganho no alfa borrado: sem ele o halo fica fraco demais para resgatar. */
const HALO_GANHO = 2.2;
/** Teto de opacidade do halo. Em 1,0 ele vira a pastilha que acabou de sair. */
const HALO_ALPHA_MAX = 0.62;

/**
 * A máscara alfa do logo, com moldura, borrada — o desenho do halo.
 *
 * A moldura é construída À MÃO e não com `.extend`, e isso custou uma rodada:
 * `.extend({background:{…alpha…}})` sobre um PNG de 1 canal PROMOVE a imagem
 * para 2 canais (cinza+alfa). Ler o raw depois assumindo 1 canal desloca o
 * stride e desenha LISTRAS no lugar do halo.
 */
async function haloDaTinta(
	logo: Raster,
	pad: number,
	blur: number,
	cor: { r: number; g: number; b: number },
): Promise<Buffer> {
	const w = logo.width + pad * 2;
	const h = logo.height + pad * 2;
	const g = Buffer.alloc(w * h, 0);
	for (let y = 0; y < logo.height; y++) {
		for (let x = 0; x < logo.width; x++) {
			g[(y + pad) * w + (x + pad)] = logo.data[(y * logo.width + x) * 4 + 3];
		}
	}
	const alpha = await sharp(g, { raw: { width: w, height: h, channels: 1 } })
		.blur(Math.max(0.3, blur))
		.linear(HALO_GANHO, 0)
		.blur(Math.max(0.3, blur * 0.5))
		.raw()
		.toBuffer({ resolveWithObject: true });

	const ch = alpha.info.channels;
	const out = Buffer.alloc(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		out[i * 4] = cor.r;
		out[i * 4 + 1] = cor.g;
		out[i * 4 + 2] = cor.b;
		out[i * 4 + 3] = Math.round(alpha.data[i * ch] * HALO_ALPHA_MAX);
	}
	return sharp(out, { raw: { width: w, height: h, channels: 4 } })
		.png()
		.toBuffer();
}

/* ───────────────────── o caminho `gravar` (line art) ───────────────────── */

/**
 * Acima desta luminância o pixel do logo NÃO vira tinta.
 *
 * 230 e não 128: num logo o que separa "desenho" de "papel" é o branco do
 * fundo, não o meio da escala. Com 128, todo tom médio (o amarelo de uma marca,
 * um cinza de fundo) sumiria — e um logo pela metade é pior do que logo nenhum.
 */
const LIMIAR_TINTA = 230;

/** Cobertura de tinta aceitável na caixa: pouca = sumiu; muita = queima longa. */
const TINTA_MIN = 0.02;
const TINTA_MAX = 0.6;

/** Diferença de cor entre vizinhos que conta como "fronteira de cor". */
const DIST_COR_FRONTEIRA = 90;
/** Fronteiras suficientes para a proporção querer dizer alguma coisa. */
const FRONTEIRAS_MIN = 24;
/** Acima desta fração de fronteiras que somem, o logo vira mancha. */
const FRONTEIRAS_PERDIDAS_MAX = 0.5;

interface LaudoLineArt {
	/** Fração da caixa que vira tinta preta. */
	tinta: number;
	/** Fronteiras de cor internas do logo. */
	fronteiras: number;
	/** Quantas delas desaparecem quando tudo vira preto. */
	perdidas: number;
}

/**
 * Mede o que o limiar vai FAZER com o logo, antes de colar.
 *
 * Medido nos bytes: colar o logo colorido do aluno direto sobre uma arte de
 * traço (1024×1024 bitonal, exatamente 2 níveis {0,255}, 0 pixels coloridos)
 * produziu 11.042 pixels coloridos e 4 níveis — 1% da peça vira cor e a máquina
 * não corta. Limiarizar para preto puro devolveu 2 níveis e 0 cor. Então o
 * caminho é sempre limiarizar; a pergunta que sobra é se o logo SOBREVIVE.
 *
 * E às vezes não sobrevive: no logo real medido, o retângulo vermelho e o
 * círculo azul se tocam e têm luminância quase igual (70 e 67) — viram um blob
 * só de 24.791 px. É isto que `fronteiras/perdidas` conta: pares de vizinhos
 * opacos com cores BEM diferentes que caem do MESMO lado do limiar. Um logo
 * preto sobre transparente não tem nenhuma; um logo que se lê por contraste de
 * cor tem quase todas.
 */
export function laudoLineArt(r: Raster): LaudoLineArt {
	const { data: d, width: w, height: h } = r;
	let tinta = 0;
	let fronteiras = 0;
	let perdidas = 0;
	const ehTinta = (p: number) =>
		d[p + 3] >= ALPHA_OPACO && luma(d[p], d[p + 1], d[p + 2]) < LIMIAR_TINTA;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const p = (y * w + x) * 4;
			if (ehTinta(p)) tinta++;
			if (d[p + 3] < ALPHA_OPACO) continue;
			// Só os vizinhos da direita e de baixo: cada par é contado uma vez.
			for (const q of [
				x < w - 1 ? p + 4 : -1,
				y < h - 1 ? p + w * 4 : -1,
			] as const) {
				if (q < 0 || d[q + 3] < ALPHA_OPACO) continue;
				const dr = d[p] - d[q];
				const dg = d[p + 1] - d[q + 1];
				const db = d[p + 2] - d[q + 2];
				if (Math.sqrt(dr * dr + dg * dg + db * db) <= DIST_COR_FRONTEIRA) {
					continue;
				}
				fronteiras++;
				if (ehTinta(p) === ehTinta(q)) perdidas++;
			}
		}
	}
	return { tinta: w * h ? tinta / (w * h) : 0, fronteiras, perdidas };
}

/** Aplica o limiar: tinta vira PRETO OPACO, o resto vira transparente puro. */
function limiarizarParaTinta(r: Raster): void {
	const d = r.data;
	for (let p = 0; p < d.length; p += 4) {
		const escuro = luma(d[p], d[p + 1], d[p + 2]) < LIMIAR_TINTA;
		if (d[p + 3] >= ALPHA_OPACO && escuro) {
			d[p] = 0;
			d[p + 1] = 0;
			d[p + 2] = 0;
			d[p + 3] = 255;
		} else {
			d[p] = 255;
			d[p + 1] = 255;
			d[p + 2] = 255;
			d[p + 3] = 0;
		}
	}
}

/* ─────────────────────────── baixar o logo ─────────────────────────── */

/** Teto do arquivo de logo. Um PNG de marca real tem alguns KB; 8 MB é folga. */
const MAX_LOGO_BYTES = 8 * 1024 * 1024;

/**
 * O logo pode chegar como Buffer (upload no run) ou como STRING — que é o caso
 * normal: a coleção `marca` guarda `logo_url` (campo `type:'image'`, o arquivo
 * mora na CDN).
 *
 * O download é do `lib/imagem-remota` e NÃO de um `fetch` daqui. Não é
 * preciosismo: `logo_url` é dado que o ALUNO escreve, e "o servidor busca uma
 * URL vinda do banco" é a definição de SSRF. Aquele módulo tem a allowlist de
 * host, recusa redirect e teto de bytes; um `fetch` local teria de repetir os
 * três — e repetir defesa é como se perde uma delas.
 *
 * Falha aqui NUNCA sobe: ver a regra de ouro no cabeçalho. O `baixarImagemRemota`
 * lança `ToolEngineError` de propósito (quem o chama nos Ajustes precisa do
 * status para decidir estorno); aqui a arte já existe e já foi paga, então o
 * erro vira "arte sem assinatura" com motivo na tela.
 */
export async function resolverLogo(
	logo: unknown,
	signal?: AbortSignal,
): Promise<Buffer | null> {
	if (Buffer.isBuffer(logo)) return logo.byteLength > 0 ? logo : null;
	if (typeof logo !== 'string' || !logo.trim()) return null;
	const s = logo.trim();

	// `data:` não vai à rede — decodifica aqui mesmo (é o formato que um teste,
	// um seed ou um upload já convertido usam).
	if (s.startsWith('data:')) {
		const virgula = s.indexOf(',');
		if (virgula < 0) return null;
		const buf = Buffer.from(s.slice(virgula + 1), 'base64');
		return buf.byteLength > 0 && buf.byteLength <= MAX_LOGO_BYTES ? buf : null;
	}
	if (!/^https?:\/\//i.test(s)) return null;

	try {
		const img = await baixarImagemRemota(s, {
			maxBytes: MAX_LOGO_BYTES,
			signal,
		});
		return img.png;
	} catch {
		return null;
	}
}

/* ─────────────────────────── schema ─────────────────────────── */

/**
 * `z.coerce.boolean()` é armadilha (`Boolean('false') === true`). Ausente vale
 * `false`: o caminho normal do Ateliê é arte colorida, e o line art é a exceção
 * (modo `gravar`/`vetorizavel`).
 */
const boolDoMotor = z.preprocess(
	(v) => v === true || v === 'true' || v === 1 || v === '1',
	z.boolean(),
);

const brandmarkSchema = z.object({
	/** A arte pronta (saída do `ai.image_studio`). */
	image: z.instanceof(Buffer),
	/** Buffer, data URL ou `logo_url` da coleção `marca`. Ausente = sem logo. */
	logo: z
		.union([z.instanceof(Buffer), z.string(), z.null(), z.undefined()])
		.optional(),
	/** O objeto inteiro do Diretor de Arte (o motor não resolve ref aninhada). */
	direcao_arte: z.unknown().optional(),
	/** Override explícito do canto (vence a direção de arte). */
	canto: z.string().optional(),
	/** Prosa alternativa para o fallback, quando não vier a direção inteira. */
	canto_texto: z.string().optional(),
	/** Arte de traço: o logo vira tinta preta pura ou não entra. */
	line_art: boolDoMotor.default(false),
	/**
	 * Lado da caixa da assinatura, sobre o lado MENOR da arte.
	 *
	 * 0,09 e não 0,15. Medido na arte que o dono reclamou: 15% dá 154 px num
	 * 1024 (2,3% da área) e no canto superior direito o logo vira um SEGUNDO
	 * ponto focal, competindo com o produto. Em 12% ainda pesa; em 9% (92 px) lê
	 * como assinatura de designer e continua legível; em 7% já é discreto demais
	 * para um 1024 (certo só em 2K/4K).
	 */
	scale: z.coerce.number().min(0.05).max(0.4).default(0.09),
	/** Folga da borda, sobre o lado menor da arte. Anda junto com a `scale`. */
	margin: z.coerce.number().min(0).max(0.2).default(0.055),
	/**
	 * Δ de LUMINÂNCIA, POR PIXEL, a partir do qual a tinta se separa do fundo.
	 *
	 * MUDOU DE SIGNIFICADO junto com a régua (ver `legibilidadeDaTinta`): era a
	 * diferença entre duas MÉDIAS, e por isso precisava ser alta (40) para não
	 * disparar à toa; agora é por pixel e tem a diferença de COR ao lado, então
	 * 25 é exigente sem ser cego. Quem passa este parâmetro de fora não existe
	 * hoje — a definition do Ateliê não o envia.
	 */
	min_contrast: z.coerce.number().min(0).max(255).default(25),
});

export type BrandmarkParams = z.infer<typeof brandmarkSchema>;

/** O que o bloco devolve (e o que a definition precisa listar no `output`). */
export interface BrandmarkResult extends Record<string, unknown> {
	png: Buffer;
	pngBase64: string;
	logo_aplicado: boolean;
	canto: CantoDeclarado | null;
	canto_origem: CantoOrigem | null;
	tratamento: string | null;
	motivo: string;
	width: number;
	height: number;
}

const b64 = (png: Buffer): string =>
	`data:image/png;base64,${png.toString('base64')}`;

async function semLogo(
	arte: Buffer,
	motivo: string,
	extra: Partial<BrandmarkResult> = {},
): Promise<BrandmarkResult> {
	const meta = await sharp(arte).metadata();
	return {
		png: arte,
		pngBase64: b64(arte),
		logo_aplicado: false,
		canto: null,
		canto_origem: null,
		tratamento: null,
		motivo,
		width: meta.width ?? 0,
		height: meta.height ?? 0,
		...extra,
	};
}

/* ────────────────────── a composição, reusável ────────────────────── */

/**
 * O que `aplicarLogo` precisa saber. Tudo opcional menos o logo — os defaults
 * são os MESMOS do schema do bloco, e vêm das cinco medições da galeria.
 */
export interface OpcoesDaAssinatura {
	/** O logo JÁ EM BYTES. `null` = não há logo (a arte volta intacta). */
	logo: Buffer | null;
	/** O objeto inteiro do Diretor de Arte, para o degrau 1 do canto. */
	direcao_arte?: unknown;
	/** Override explícito (vence a direção de arte). */
	canto?: string;
	/** Prosa alternativa, quando não vier a direção inteira. */
	canto_texto?: string;
	line_art?: boolean;
	scale?: number;
	margin?: number;
	min_contrast?: number;
}

/**
 * COMPÕE O LOGO NUMA IMAGEM. Sharp puro, sem rede, sem modelo.
 *
 * Separada do `run` para o `image.kit_crops` poder chamá-la peça a peça — ver a
 * caixa da geometria no topo do arquivo. Quem chama de fora resolve o logo UMA
 * vez (`resolverLogo`) e passa o mesmo Buffer para todas as peças: baixar o
 * mesmo arquivo quatro vezes seria pagar quatro idas à CDN por um PNG de 5 KB.
 *
 * NUNCA LANÇA — a regra de ouro do cabeçalho vale para os dois chamadores.
 */
export async function aplicarLogo(
	arte: Buffer,
	o: OpcoesDaAssinatura,
): Promise<BrandmarkResult> {
	const p = {
		scale: o.scale ?? 0.09,
		margin: o.margin ?? 0.055,
		min_contrast: o.min_contrast ?? 25,
		line_art: o.line_art === true,
	};

	const meta = await sharp(arte).metadata();
	const arteW = meta.width ?? 0;
	const arteH = meta.height ?? 0;
	if (arteW < 2 || arteH < 2) {
		return semLogo(arte, 'A arte é pequena demais para levar assinatura.');
	}

	/* 1. o logo existe? */
	const logoBuf = o.logo;
	if (!logoBuf || logoBuf.byteLength === 0) {
		return semLogo(
			arte,
			'Sua arte saiu sem assinatura. Cadastre o logo em Minha marca para ele entrar aplicado nas próximas.',
		);
	}

	/* 2. tamanho da caixa e da folga, sobre o lado MENOR (é o que a proporção
		      não distorce: 9% do lado menor é o mesmo tamanho aparente no 1:1 e
		      no 9:16, enquanto 9% da largura viraria um selo minúsculo no story). */
	const lado = Math.min(arteW, arteH);
	const boxSide = Math.round(lado * p.scale);
	const folga = Math.round(lado * p.margin);
	if (boxSide < MIN_BOX_PX) {
		return semLogo(
			arte,
			'A arte é pequena demais para o logo ficar legível — ela saiu sem assinatura.',
		);
	}

	/* 3. preparar o logo: transparência, tamanho. */
	let logoRaster: Raster;
	try {
		logoRaster = await loadRaster(logoBuf);
	} catch {
		return semLogo(
			arte,
			'Não consegui ler o arquivo do seu logo — a arte saiu sem assinatura.',
		);
	}

	/**
	 * LOGO SEM TRANSPARÊNCIA é o caso mais comum de quem cadastra às pressas
	 * (JPG, ou PNG achatado sobre branco). Colar isso por cima da arte cola um
	 * adesivo retangular. O chroma-key que já existe (o mesmo do
	 * `image.removeBackground`) resolve quando o fundo é liso — que é o fundo
	 * de praticamente todo arquivo de logo. Fundo bagunçado a gente não força:
	 * segue opaco e o `tratamento` conta.
	 */
	let tratamento = 'direto';
	const temAlpha = (() => {
		const d = logoRaster.data;
		for (let q = 3; q < d.length; q += 4) if (d[q] < 250) return true;
		return false;
	})();
	if (!temAlpha) {
		const st = borderStats(logoRaster);
		const marcados =
			st.samples >= 8 && st.dev <= 40
				? chromaKeyAlpha(logoRaster, st.br, st.bgC, st.bb, 0.12, 0.5)
				: 0;
		tratamento = marcados > 0 ? 'fundo_removido' : 'sem_transparencia';
	}

	/**
	 * O LOGO NÃO CABE NUM QUADRADO — e insistir nisso apagava a marca de quase
	 * todo mundo.
	 *
	 * `resize(boxSide, boxSide, {fit:'inside'})` dimensiona pelo QUADRADO: um
	 * lockup horizontal 5:1 (o formato de 9 em cada 10 logos de oficina) recebia
	 * `154×31 px` num 1024². Medido nos bytes: 583 px de tinta, 0,056% do quadro,
	 * altura de caixa de 16 px — "LASER ART" saía como um borrão e a assinatura
	 * de baixo virava duas linhas de dois pixels. A prova de que "o logo aparece"
	 * tinha sido feita com um logo 1,5:1, que é o caso mais gentil possível.
	 *
	 * A régua certa não é o quadrado, é O LADO LONGO DO LOGO: o lado curto
	 * continua limitado a `scale` (é ele que define o peso visual da assinatura),
	 * e o lado longo ganha até `SCALE_LADO_LONGO`. Um logo QUADRADO é dimensionado
	 * só pela `scale` — `fit:'inside'` num 205×92 devolve 92×92.
	 */
	const deitado = logoRaster.width >= logoRaster.height;
	const ladoLongo = Math.round(lado * SCALE_LADO_LONGO);
	const logoPng = await sharp(await rasterToPng(logoRaster))
		.resize(deitado ? ladoLongo : boxSide, deitado ? boxSide : ladoLongo, {
			fit: 'inside',
			kernel: 'lanczos3',
		})
		.png()
		.toBuffer();
	const logoFinal = await loadRaster(logoPng);
	const lw = logoFinal.width;
	const lh = logoFinal.height;

	/**
	 * A ARTE EM MEMÓRIA, UMA VEZ SÓ. Daqui para baixo tudo é conta de pixel —
	 * legibilidade da tinta em quatro cantos e o quanto cada canto é agitado — e
	 * decodificar a arte a cada pergunta seriam oito `sharp(...).extract()` num
	 * 1024². `loadRaster` LANÇA acima de 60 MP (é o teto do módulo de pixels);
	 * aqui isso não pode virar 502, então vira arte sem assinatura.
	 */
	let arteRaster: Raster;
	try {
		arteRaster = await loadRaster(arte);
	} catch {
		return semLogo(
			arte,
			'Não consegui abrir esta arte para aplicar o logo — ela saiu sem assinatura.',
		);
	}

	/* 4. o canto: o Diretor SUGERE, a medição DECIDE. */
	let declarado: CantoDeclarado | null = null;
	let origem: CantoOrigem | null = null;

	const doOverride = lerCanto(o.canto);
	if (doOverride) {
		declarado = doOverride;
		origem = 'campo';
	} else {
		const daDirecao = cantoDaDirecao(o.direcao_arte);
		if (daDirecao.canto) {
			declarado = daDirecao.canto;
			origem = daDirecao.origem;
		} else {
			const daProsa = lerCanto(o.canto_texto);
			if (daProsa) {
				declarado = daProsa;
				origem = 'prosa';
			}
		}
	}

	if (declarado === 'nenhum') {
		return semLogo(
			arte,
			'Nesta composição não sobrou lugar para a assinatura, então o logo não entrou.',
			{ canto: 'nenhum', canto_origem: origem },
		);
	}

	/**
	 * OS QUATRO CANTOS SÃO MEDIDOS SEMPRE — inclusive quando o Diretor declarou
	 * um.
	 *
	 * Antes, um canto declarado era ordem e só a ausência dele fazia medir. Duas
	 * coisas quebraram isso. Primeira: o canto declarado é PROSA de um modelo que
	 * não vê a imagem gerada — medido, o "inferior esquerdo" caía em cima da
	 * quina da tábua em 1 das artes de teste. Segunda, e maior: o degrau de
	 * medição antigo procurava um canto CHAPADO (desvio ≤ 18), que só existia
	 * porque o prompt mandava o gerador reservar área — e essa instrução saiu do
	 * roster justamente por ser o defeito que o dono viu. Sem ela, nenhum canto é
	 * chapado, e "não achei área limpa" viraria "nenhuma arte é assinada".
	 *
	 * A nota de cada canto junta as duas perguntas que importam:
	 *  · o logo SE LÊ ali? (fração da tinta que se separa do fundo, por pixel);
	 *  · o canto está CALMO? (o desvio do miolo: pouso sobre parede desfocada é
	 *    melhor que pouso sobre a quina da bancada, mesmo que os dois "leiam").
	 *
	 * A legibilidade pesa mais porque logo ilegível não é assinatura nenhuma,
	 * enquanto logo sobre fundo movimentado ainda é uma marca — só menos elegante.
	 */
	const notas = CANTOS.map((c) => {
		const r = rectDoCanto(c, arteW, arteH, lw, lh, folga);
		const leg = legibilidadeDaTinta(
			logoFinal,
			arteRaster,
			r.left,
			r.top,
			p.min_contrast,
		);
		// Miolo: nas beiradas do retângulo o logo é quase todo folga, e é o que
		// está ATRÁS do desenho que decide.
		const st = estatDaRegiao(arteRaster, miolo(r));
		const calma = 1 - Math.min(1, st.dev / DEV_AGITADO);
		return {
			canto: c,
			rect: r,
			nota: leg * PESO_LEGIBILIDADE + calma * (1 - PESO_LEGIBILIDADE),
		};
	});
	const melhor = notas.reduce((a, b) => (b.nota > a.nota ? b : a));

	/**
	 * O canto declarado só cede quando perde FEIO. Um empate técnico mantém a
	 * escolha do Diretor: ele viu a composição que pediu, nós vemos só o
	 * resultado, e trocar de canto a cada 0,01 de nota faria duas peças do mesmo
	 * kit assinarem em lugares diferentes sem motivo visível para o aluno.
	 */
	const doDeclarado = declarado
		? notas.find((n) => n.canto === declarado)
		: undefined;
	const escolhido =
		doDeclarado && melhor.nota - doDeclarado.nota <= MARGEM_PARA_TROCAR_CANTO
			? doDeclarado
			: melhor;
	if (escolhido !== doDeclarado) origem = 'medido';
	const canto: Canto = escolhido.canto;
	const rect = escolhido.rect;

	/* 5. o caminho `gravar`: preto puro ou não entra. */
	if (p.line_art) {
		const laudo = laudoLineArt(logoFinal);
		if (
			laudo.fronteiras >= FRONTEIRAS_MIN &&
			laudo.perdidas / laudo.fronteiras > FRONTEIRAS_PERDIDAS_MAX
		) {
			return semLogo(
				arte,
				'Seu logo se lê por contraste de cores, e numa peça de corte tudo vira preto e branco: ele viraria uma mancha só. Não apliquei o logo nesta arte.',
				{ canto, canto_origem: origem, tratamento: 'recusado_cor' },
			);
		}
		if (laudo.tinta < TINTA_MIN) {
			return semLogo(
				arte,
				'Seu logo é claro demais e sumiria no preto e branco da peça de corte — ele não entrou nesta arte.',
				{ canto, canto_origem: origem, tratamento: 'recusado_claro' },
			);
		}
		if (laudo.tinta > TINTA_MAX) {
			return semLogo(
				arte,
				'Seu logo é quase todo preenchido e viraria um bloco chapado na gravação — ele não entrou nesta arte.',
				{ canto, canto_origem: origem, tratamento: 'recusado_chapado' },
			);
		}
		limiarizarParaTinta(logoFinal);
		const tintaPng = await rasterToPng(logoFinal);
		const composta = await sharp(arte)
			.composite([{ input: tintaPng, left: rect.left, top: rect.top }])
			.png()
			.toBuffer();
		/**
		 * O SEGUNDO LIMIAR NÃO É REDUNDANTE. O `composite` do sharp mistura na
		 * borda quando a base tem alfa, e a arte de traço vinda da galeria pode
		 * ter vindo com alfa. `flatten → grayscale → threshold(128)` devolve a
		 * peça a dois níveis SEM canal alfa — a mesma disciplina do modo
		 * `vetorizavel`, que é o que a máquina precisa para cortar. O `flatten`
		 * antes importa: sem ele o transparente viraria TRAÇO em vez de fundo, e
		 * a saída sairia com alfa que nenhum arquivo de corte usa.
		 */
		const png = await sharp(composta)
			.flatten({ background: '#ffffff' })
			.grayscale()
			.threshold(128)
			.png()
			.toBuffer();
		return {
			png,
			pngBase64: b64(png),
			logo_aplicado: true,
			canto,
			canto_origem: origem,
			tratamento: 'tinta_preta',
			motivo: 'Logo aplicado como traço preto, pronto para gravar.',
			width: arteW,
			height: arteH,
		};
	}

	/**
	 * 6. CONTRASTE — a parte que o dono chamou de "fundo na logo".
	 *
	 * A escada tem três degraus e o primeiro é NÃO FAZER NADA. Medido no logo
	 * real do aluno em 20 combinações de arte × canto: a régua nova manda "não
	 * fazer nada" em 20; a régua velha mandava tapar em 8.
	 *
	 *  ① a tinta se lê (≥ 75% dos pixels) → o logo entra DIRETO, sem enfeite;
	 *  ② não se lê e o logo é de TINTA ÚNICA → inverter, que é a correção que um
	 *     humano faria (logo preto vira branco sobre fundo escuro) e não inventa
	 *     cor nenhuma. Se depois disso a tinta se lê, entra direto;
	 *  ③ não se lê e o logo é COLORIDO → HALO. Inverter várias cores devolve um
	 *     negativo, que não é a marca de ninguém; e a pastilha opaca que ficava
	 *     aqui é justamente o adesivo que o dono reclamou. O halo é um brilho
	 *     suave do tom oposto ao da tinta, com teto de opacidade — ele devolve a
	 *     silhueta sem tapar a arte, e some no meio da peça em vez de recortar um
	 *     retângulo nela.
	 *
	 * Onde o degrau ③ realmente acontece (e é a razão de ele existir): quando a
	 * arte é pintada NA COR DA PRÓPRIA MARCA. Medido, o vermelho do logo sobre um
	 * fundo vermelho da marca deixa 54% da tinta legível — ali o quadrado
	 * vermelho some de verdade, e sem resgate a assinatura vira meia marca.
	 */
	const camadas: sharp.OverlayOptions[] = [];
	let perfil = perfilDoLogo(logoFinal);
	if (perfil.opacos === 0) {
		return semLogo(
			arte,
			'O arquivo do seu logo está todo transparente — a arte saiu sem assinatura.',
			{ canto, canto_origem: origem },
		);
	}

	const leParaValer = () =>
		legibilidadeDaTinta(
			logoFinal,
			arteRaster,
			rect.left,
			rect.top,
			p.min_contrast,
		) >= TINTA_LEGIVEL_MIN;

	if (!leParaValer()) {
		if (perfil.spread <= SPREAD_MONOCROMATICO) {
			inverterTinta(logoFinal);
			perfil = perfilDoLogo(logoFinal);
			tratamento = 'invertido';
		}
		if (!leParaValer()) {
			/**
			 * O tom do halo sai da TINTA, não do fundo — e neste degrau dá no mesmo,
			 * porque o degrau só existe quando tinta e fundo se confundem. Sair da
			 * tinta é o mais seguro dos dois: um logo escuro nunca ganha halo escuro
			 * (que não resgataria nada) por causa de um punhado de pixels claros do
			 * fundo puxando a média.
			 */
			const claro = perfil.luma < 128;
			const pad = Math.max(3, Math.round(boxSide * HALO_PAD_REL));
			const halo = await haloDaTinta(
				logoFinal,
				pad,
				boxSide * HALO_BLUR_REL,
				claro ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 },
			);
			/**
			 * O halo transborda a caixa do logo, e o `composite` do sharp RECUSA
			 * offset negativo (lança "Expected positive integer"). Com `margin: 0` —
			 * que o schema permite — o transbordo cairia para fora da arte e o
			 * resgate viraria uma exceção no meio de um run já pago. Aparar a camada
			 * antes é o que faz o halo funcionar coladinho na borda também.
			 */
			const hx = rect.left - pad;
			const hy = rect.top - pad;
			const corte = {
				left: Math.max(0, -hx),
				top: Math.max(0, -hy),
				width: 0,
				height: 0,
			};
			corte.width = Math.min(
				lw + pad * 2 - corte.left,
				arteW - Math.max(0, hx),
			);
			corte.height = Math.min(
				lh + pad * 2 - corte.top,
				arteH - Math.max(0, hy),
			);
			if (corte.width > 0 && corte.height > 0) {
				camadas.push({
					input:
						corte.left ||
						corte.top ||
						corte.width !== lw + pad * 2 ||
						corte.height !== lh + pad * 2
							? await sharp(halo).extract(corte).png().toBuffer()
							: halo,
					left: Math.max(0, hx),
					top: Math.max(0, hy),
				});
			}
			tratamento = tratamento === 'invertido' ? 'invertido_halo' : 'halo';
		}
	}

	camadas.push({
		input: await rasterToPng(logoFinal),
		left: rect.left,
		top: rect.top,
	});
	const png = await sharp(arte).composite(camadas).png().toBuffer();
	return {
		png,
		pngBase64: b64(png),
		logo_aplicado: true,
		canto,
		canto_origem: origem,
		tratamento,
		motivo: 'Logo aplicado como assinatura da sua marca.',
		width: arteW,
		height: arteH,
	};
}

/* ─────────────────────────── bloco ─────────────────────────── */

/**
 * O bloco é uma casca de duas linhas em cima de `aplicarLogo`: ele só resolve o
 * logo (que pode ser URL, e aí vai à rede) e delega. Toda a decisão — canto,
 * contraste, limiar do traço, recusa — mora na função, e é por isso que o kit
 * carimba exatamente igual ao pipeline principal, sem uma segunda cópia da
 * regra para as duas discordarem.
 */
export const imageBrandmarkBlock: ToolBlock<BrandmarkParams> = {
	id: 'image.brandmark',
	category: 'image',
	description:
		'Assina a arte com o logo do aluno (sharp puro, sem IA). Mede os quatro cantos (legibilidade da tinta + quão calmo é o fundo) e usa o canto do Diretor de Arte como sugestão; garante contraste por inversão ou halo suave — nunca pastilha opaca — e, em arte de traço, limiariza para preto puro ou recusa dizendo por quê.',
	paramsSchema: brandmarkSchema,
	async run(ctx, p) {
		const logo = await resolverLogo(p.logo, ctx.signal);
		return aplicarLogo(p.image, {
			logo,
			direcao_arte: p.direcao_arte,
			canto: p.canto,
			canto_texto: p.canto_texto,
			line_art: p.line_art,
			scale: p.scale,
			margin: p.margin,
			min_contrast: p.min_contrast,
		});
	},
};

export const brandmarkBlocks: ToolBlock[] = [imageBrandmarkBlock];
