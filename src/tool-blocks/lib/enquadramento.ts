import sharp from 'sharp';

/**
 * ENQUADRAMENTO — a matemática do KIT do Ateliê, separada do bloco.
 *
 * ┌─ O PROBLEMA, E POR QUE ELE NÃO SE RESOLVE GERANDO MAIS IMAGENS ─────────┐
 * │ "Kit completo" convida a gerar N artes, uma por formato. NÃO DÁ: o      │
 * │ `ai.image_studio` descarta `variation_count` (o Zod tira a chave        │
 * │ desconhecida), então declarar variação faria o aluno PAGAR TRÊS E       │
 * │ RECEBER UMA. Medido: 1 geração = US$ 0,1356; 3 gerações = US$ 0,4069.   │
 * │                                                                          │
 * │ O kit é, então, UMA geração + recortes derivados por sharp — custo       │
 * │ local, zero centavo a mais, zero caminho de cobrança novo.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O PREÇO DO RECORTE, MEDIDO ────────────────────────────────────────────┐
 * │ Recortar 1024×1024 para 9:16 mantém 56,3% do quadro; para 16:9, idem.   │
 * │ Nas seis derivações feitas a partir de artes reais com o enquadramento  │
 * │ ANTIGO, ZERO saíram limpas: o que quebra é sempre a mesma coisa — texto │
 * │ de sobreposição encostado na borda. Com o enquadramento de folga (a     │
 * │ edição de dado no roster), 6 de 6 sobreviveram.                          │
 * │                                                                          │
 * │ Ou seja: o enquadramento é o motor, este portão é o cinto de segurança. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ E QUANDO O RECORTE NÃO SERVE, ESTENDE — a segunda operação ─────────────┐
 * │ Recortar era a única ferramenta, e por isso o kit entregava 1 de 4: o    │
 * │ portão acima recusa quase todo 9:16 tirado de um 1:1, e recusa CERTO.    │
 * │ O pedido do dono ("todos os tamanhos") não se atende afrouxando o        │
 * │ portão — se atende com a operação inversa: CRESCER O QUADRO em vez de    │
 * │ encolher a arte (`extensaoCentrada` + `avaliarExtensao`).                │
 * │                                                                          │
 * │ As duas convivem e a escolha é PEÇA A PEÇA: recorta quando é seguro (de  │
 * │ 4:5 para 1:1, por exemplo, o corte é pequeno e o portão aprova), estende │
 * │ quando o recorte destruiria, e recusa — dizendo por quê — quando nenhuma │
 * │ das duas serve. O que a extensão nunca faz é reamostrar a arte: ela      │
 * │ acrescenta faixa, e a arte fica inteira e do tamanho que já era.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA DO PORTÃO, E POR QUE ELA NÃO É "QUANTA COISA SE PERDE" ────────┐
 * │ A primeira tentativa foi medir energia visual descartada — e ela        │
 * │ REPROVOU nos números reais: o recorte que decepou "Sua lembrança" ao    │
 * │ meio descarta só 8% da energia (as faixas laterais são parede branca),  │
 * │ enquanto um recorte perfeitamente bom descarta 29% (fundo texturizado). │
 * │ Perder MUITO fundo é inofensivo; perder UM PEDACINHO de letra não é.    │
 * │                                                                          │
 * │ A regra que funciona é ESTRUTURAL, não quantitativa:                     │
 * │                                                                          │
 * │   Um recorte destrói a composição quando ele PARTE — ou joga fora —      │
 * │   um objeto que estava INTEIRO no quadro original.                       │
 * │                                                                          │
 * │ O "estava inteiro" é o que separa o título (que começa e termina dentro │
 * │ do quadro) da bancada (que já entrava cortada pelos dois lados). Cortar │
 * │ mais bancada não é perda nova; cortar o título é. Por isso objetos que  │
 * │ JÁ ENCOSTAVAM na borda do original são ignorados — eles nunca estiveram │
 * │ inteiros.                                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/* ─────────────────────── formatos do kit ─────────────────────── */

/**
 * Os formatos derivados. A peça principal é gerada em 1:1 e os outros saem
 * dela — e isso é escolha medida, não conveniência:
 *
 * O 4:3 (1.536×1.152) tem a MAIOR área que o Estúdio oferece e mesmo assim é o
 * PIOR ponto de partida: derivar 9:16 dele guarda 42,2% do quadro, contra
 * 56,3% saindo do quadrado. Em log-proporção o 1:1 fica exatamente equidistante
 * do 9:16 e do 16:9 (0,575 para cada lado) — é o ótimo geométrico. Gerar
 * quadrado, não gerar grande.
 */
export const KIT_FORMATOS = {
	feed_1x1: { proporcao: 1 / 1, rotulo: 'Feed quadrado' },
	retrato_4x5: { proporcao: 4 / 5, rotulo: 'Feed retrato' },
	story_9x16: { proporcao: 9 / 16, rotulo: 'Story e Reels' },
	capa_16x9: { proporcao: 16 / 9, rotulo: 'Capa e YouTube' },
} as const;

export type KitFormato = keyof typeof KIT_FORMATOS;

export const KIT_FORMATO_KEYS = Object.keys(KIT_FORMATOS) as [
	KitFormato,
	...KitFormato[],
];

/** Um retângulo em coordenadas da imagem de origem. */
export interface Recorte {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * O maior retângulo CENTRADO com a proporção pedida que cabe em `W×H`.
 *
 * Centrado, e não "inteligente por saliência": recorte que persegue o objeto
 * move o enquadramento que o Diretor de Arte decidiu, e o resultado é uma peça
 * que não é mais a peça aprovada. O time compõe no miolo; o corte é simétrico.
 */
export function recorteCentrado(
	W: number,
	H: number,
	proporcao: number,
): Recorte {
	let width = W;
	let height = Math.round(W / proporcao);
	if (height > H) {
		height = H;
		width = Math.round(H * proporcao);
	}
	return {
		left: Math.round((W - width) / 2),
		top: Math.round((H - height) / 2),
		width,
		height,
	};
}

/**
 * A MOLDURA que leva `W×H` até a proporção pedida SEM JOGAR NADA FORA.
 *
 * É a operação inversa do `recorteCentrado`, e ela existe porque o pedido do
 * dono ("uma opção de todos tamanhos e ele dê a arte em todas as dimensões") é
 * incompatível com recorte puro: derivar 9:16 de um 1:1 descarta 43,8% da
 * largura, e o portão do recorte — corretamente — recusa quase sempre. Cortar
 * menos não é opção; a saída é CRESCER O QUADRO em vez de encolher a arte.
 *
 * A arte fica CENTRADA e INTEIRA: nenhum pixel dela é descartado, nenhum é
 * reamostrado. O que entra é faixa nova, e quem decide se essa faixa pode
 * existir é o `avaliarExtensao` — aqui só se faz a conta.
 */
export interface Extensao {
	/** Quanto de faixa nova entra de cada lado. */
	left: number;
	top: number;
	right: number;
	bottom: number;
	/** O quadro final. */
	width: number;
	height: number;
}

export function extensaoCentrada(
	W: number,
	H: number,
	proporcao: number,
): Extensao {
	let width = W;
	let height = H;
	if (W / H < proporcao) width = Math.round(H * proporcao);
	else if (W / H > proporcao) height = Math.round(W / proporcao);

	// `max(0, …)` não é paranoia: o `round` acima pode devolver o mesmo lado
	// quando a proporção já bate, e faixa negativa viraria recorte disfarçado.
	const sobraX = Math.max(0, width - W);
	const sobraY = Math.max(0, height - H);
	const left = Math.round(sobraX / 2);
	const top = Math.round(sobraY / 2);
	return {
		left,
		top,
		right: sobraX - left,
		bottom: sobraY - top,
		width: W + sobraX,
		height: H + sobraY,
	};
}

/* ─────────────────── a lisura da borda ─────────────────── */

/**
 * A EXTENSÃO É FEITA COM `sharp.extend({ extendWith: 'copy' })`, e isso decide
 * o que precisa ser medido.
 *
 * `copy` replica a LINHA EXTREMA para fora — a faixa inteira é uma única linha
 * de pixels esticada. Então a pergunta não é "a arte é bonita", é: **essa linha
 * aguenta virar faixa?**
 *
 * ⚠ `extendWith: 'mirror'` foi testado e está ERRADO para este uso: ele espelha
 * a imagem inteira, e o produto reaparece de cabeça para baixo no rodapé da
 * peça. Não é uma questão de calibragem — é o modo errado.
 *
 * Duas coisas estragam a faixa, e elas são independentes:
 *
 *  ① ASPEREZA — estrutura ATRAVESSANDO a borda (um produto encostado, uma
 *    listra, uma letra). Replicar isso desenha um RASTRO: a coisa vira listra
 *    até o fim da peça. Medida como a diferença média de vizinho a vizinho AO
 *    LONGO da linha; um degradê natural (que estica lindamente) tem vizinhos
 *    quase iguais e passa, uma letra tem degraus e reprova. Foi por isso que o
 *    desvio-padrão simples da linha não serviu: ele confunde degradê com
 *    estrutura, e degradê é justamente o caso que a extensão resolve bem.
 *
 *  ② DEGRADÊ PERPENDICULAR — a arte ainda estava MUDANDO quando chegou na
 *    borda (vinheta, luz caindo). `copy` congela: a faixa nova é chapada
 *    colada num degradê, e o olho vê a emenda. Medido como o desvio das médias
 *    das linhas da faixa — que é a medição que já tinha sido feita à mão nas
 *    artes reais (0,0 a 2,5).
 */
export interface LisuraDaBorda {
	/** ① estrutura ao longo da linha extrema. */
	aspereza: number;
	/** ② quanto a arte ainda muda ao chegar na borda. */
	degrade: number;
}

/** Os quatro lados, no nome que a `Extensao` usa. */
export type LadoDaBorda = 'top' | 'bottom' | 'left' | 'right';

export type BordasDaArte = Record<LadoDaBorda, LisuraDaBorda>;

/**
 * Lado em que a lisura é medida, e quantas linhas formam a faixa.
 *
 * 256 pelo mesmo motivo do `LADO_DA_ANALISE`: em resolução cheia, grão de
 * sensor e textura de madeira viram "aspereza" e toda extensão reprovaria. A
 * pergunta é sobre FORMA na beirada, não sobre textura — e os limiares abaixo
 * foram medidos NESTA escala, então trocá-la sem remedir invalida os dois.
 */
const LADO_DA_LISURA = 256;
const FAIXA_DA_LISURA = 8;

/**
 * Teto da aspereza PARA UMA FAIXA GRANDE. MEDIDO, e a separação está registrada
 * porque a margem é o que decide entre entregar peça com rastro e recusar peça
 * boa:
 *
 *  · 25 artes reais do Ateliê, quatro bordas cada: 0,00 a 5,63;
 *  · as duas bordas que produziram RASTRO VISÍVEL na prova (a caneta esticada
 *    virando faixa) mediram 4,30 e 5,63;
 *  · as bordas que saíram limpas mediram 0,00 a 2,71 — inclusive a madeira da
 *    bancada, que estica como madeira;
 *  · uma borda listrada de alto contraste (o pior caso sintético) mede 14,65.
 *
 * A faixa de separação real é [2,71 … 4,30] e o teto fica no meio dela.
 *
 * ⚠ Este número sozinho ERRAVA, e o erro tinha nome: ele foi calibrado no 9:16
 * (a faixa mais violenta que existe aqui) e depois aplicado a TODOS os formatos.
 * Ver `tetoDaAspereza` logo abaixo — a aspereza que uma faixa aguenta depende de
 * QUANTA FAIXA se está inventando.
 */
const ASPEREZA_NA_FAIXA_GRANDE = 3;

/**
 * ┌─ A MESMA BORDA, DUAS RESPOSTAS — e é por isso que o teto é uma FUNÇÃO ───┐
 * │ Medido nas artes reais, com as imagens salvas e olhadas uma a uma:        │
 * │                                                                          │
 * │   arte             borda que cresce   faixa   resultado visual           │
 * │   copo (cena)      3,64 / 5,78        20%     LIMPO, publicável          │
 * │   post (bancada)   5,63               20%     LIMPO, publicável          │
 * │   copo (cena)      3,64 / 5,78        44%     pente visível na emenda    │
 * │   post (bancada)   5,63               44%     RASTRO (a perna da mesa    │
 * │                                               vira coluna até o rodapé)  │
 * │   6 artes de estúdio  0,00–2,40       44%     INVISÍVEL                  │
 * │                                                                          │
 * │ A borda é a MESMA nas duas linhas de cada arte: o que muda é o tamanho   │
 * │ da faixa. `copy` repete a linha extrema, então o defeito não é a linha —  │
 * │ é POR QUANTOS PIXELS ela é arrastada. 128 px de madeira esticada lê-se   │
 * │ como profundidade de campo; 398 px lê-se como pente.                     │
 * │                                                                          │
 * │ Com o teto fixo em 3, uma arte de cena entregava 1 de 4 — o 4:5 acima,   │
 * │ que sai LIMPO, era recusado junto com o 9:16, que de fato não sai. Era o │
 * │ pedido do dono ("todos os tamanhos") sendo negado por uma medição feita  │
 * │ no pior caso e cobrada de todos.                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A lei é inversa e sai dos dois pontos medidos: o teto vale 3 quando a faixa é
 * 44% do quadro final (o 9:16 e o 16:9 tirados de um quadrado) e cresce na mesma
 * proporção em que a faixa encolhe — 6,6 nos 20% do 4:5, que é exatamente onde
 * as duas artes de cena passaram limpas.
 *
 * O TETO TEM TETO: acima de 8 já não se está falando de textura e sim de
 * estrutura dura atravessando a borda (a listra sintética mede 14,65), e essa
 * vira rastro em qualquer tamanho de faixa. Uma faixa minúscula não compra o
 * direito de esticar uma letra.
 */
const ASPEREZA_x_FAIXA = ASPEREZA_NA_FAIXA_GRANDE * 0.4374;
const ASPEREZA_TETO_ABSOLUTO = 8;

function tetoDaAspereza(fracaoDaFaixa: number): number {
	if (fracaoDaFaixa <= 0) return ASPEREZA_TETO_ABSOLUTO;
	return Math.min(ASPEREZA_TETO_ABSOLUTO, ASPEREZA_x_FAIXA / fracaoDaFaixa);
}

/**
 * Teto do degradê perpendicular. As 25 artes reais mediram 0,0 a 8,5 e nenhuma
 * delas emendou mal por causa disso; uma arte AMPLIADA com vinheta forte mede
 * 46,5, e essa congela visivelmente. O teto separa os dois grupos com folga —
 * ele é rede de segurança para o caso raro, não o portão principal.
 */
const DEGRADE_MAXIMO = 12;

const desvio = (v: number[]): number => {
	const m = v.reduce((a, b) => a + b, 0) / v.length;
	return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};

/** Diferença média de vizinho a vizinho — ver ① acima. */
const asperezaDaLinha = (v: number[]): number => {
	if (v.length < 2) return 0;
	let s = 0;
	for (let i = 1; i < v.length; i++) s += Math.abs(v[i] - v[i - 1]);
	return s / (v.length - 1);
};

/**
 * Mede as quatro bordas de uma vez. Uma decodificação, reusada pelos formatos
 * todos — a lisura é propriedade da ARTE, não do formato pedido.
 */
export async function medirBordas(png: Buffer): Promise<BordasDaArte> {
	const { data, info } = await sharp(png)
		.resize(LADO_DA_LISURA, LADO_DA_LISURA, { fit: 'fill' })
		// Mesmo motivo do mapa: PNG com alfa devolveria preto no transparente e
		// inventaria uma borda cheia de estrutura que não existe na arte.
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;

	const linha = (y: number): number[] => {
		const v: number[] = [];
		for (let x = 0; x < W; x++) v.push(data[y * W + x]);
		return v;
	};
	const coluna = (x: number): number[] => {
		const v: number[] = [];
		for (let y = 0; y < H; y++) v.push(data[y * W + x]);
		return v;
	};
	const faixa = (pegar: (i: number) => number[]): LisuraDaBorda => {
		const linhas: number[][] = [];
		for (let i = 0; i < FAIXA_DA_LISURA; i++) linhas.push(pegar(i));
		return {
			aspereza:
				linhas.map(asperezaDaLinha).reduce((a, b) => a + b, 0) / linhas.length,
			degrade: desvio(
				linhas.map((l) => l.reduce((a, b) => a + b, 0) / l.length),
			),
		};
	};

	return {
		top: faixa((i) => linha(i)),
		bottom: faixa((i) => linha(H - 1 - i)),
		left: faixa((i) => coluna(i)),
		right: faixa((i) => coluna(W - 1 - i)),
	};
}

export interface VeredictoDeExtensao {
	entrega: boolean;
	/** Em PT-BR, para a tela — nunca jargão, nunca número de pixel. */
	motivo: string;
}

/**
 * A extensão sai limpa?
 *
 * SÓ OS LADOS QUE VÃO CRESCER SÃO JULGADOS, e essa é a parte que faz a regra
 * valer a pena: de 1:1 para 9:16 entram faixas em CIMA e EMBAIXO — se a arte
 * tem uma bancada agitada nas laterais, isso não importa, aquelas bordas não
 * viram faixa nenhuma. Julgar as quatro recusaria peça boa por um defeito que
 * não seria usado.
 */
export function avaliarExtensao(
	bordas: BordasDaArte,
	ext: Extensao,
): VeredictoDeExtensao {
	const lados: LadoDaBorda[] = ['top', 'bottom', 'left', 'right'];
	const crescem = lados.filter((l) => ext[l] > 0);

	// Nada cresce = não há faixa inventada, logo não há o que julgar.
	if (crescem.length === 0) return { entrega: true, motivo: '' };

	/**
	 * QUANTO DO QUADRO FINAL É FAIXA INVENTADA — a variável que decide o teto.
	 * 20% no 4:5 tirado de um quadrado, 44% no 9:16 e no 16:9. Ver
	 * `tetoDaAspereza`: a mesma borda de madeira sai limpa na primeira e vira
	 * pente na segunda, e por isso o teto não pode ser um número só.
	 */
	const W = ext.width - ext.left - ext.right;
	const H = ext.height - ext.top - ext.bottom;
	const areaFinal = ext.width * ext.height;
	const fracaoDaFaixa = areaFinal > 0 ? 1 - (W * H) / areaFinal : 0;
	const teto = tetoDaAspereza(fracaoDaFaixa);

	if (crescem.some((l) => bordas[l].aspereza > teto)) {
		return {
			entrega: false,
			motivo:
				'Neste formato o recorte cortaria a arte, e completar as bordas deixaria um rastro visível — a arte tem detalhe até a beirada.',
		};
	}
	if (crescem.some((l) => bordas[l].degrade > DEGRADE_MAXIMO)) {
		return {
			entrega: false,
			motivo:
				'Neste formato o recorte cortaria a arte, e completar as bordas deixaria uma emenda à vista — a luz da arte ainda está mudando na beirada.',
		};
	}
	return { entrega: true, motivo: '' };
}

/* ─────────────────── o mapa de conteúdo ─────────────────── */

/**
 * Lado do mapa reduzido em que a análise roda.
 *
 * 384 não é economia: é FILTRO. Em resolução cheia, grão de madeira e ruído de
 * sensor viram "conteúdo" e todo recorte reprova. Reduzir apaga a textura e
 * deixa de pé o que tem forma — letra, silhueta, bloco de cor.
 */
const LADO_DA_ANALISE = 384;

/**
 * Contraste local (máx − mín numa janela 3×3) a partir do qual o pixel conta
 * como conteúdo. 96 de 255 é alto de propósito: pega letra e borda de objeto,
 * ignora degradê de fundo e sombra suave.
 */
const CONTRASTE_MINIMO = 96;

/**
 * Raio da dilatação antes de rotular — ANISOTRÓPICO, e a assimetria é o
 * conserto de um ponto cego que entregou arte quebrada ao aluno.
 *
 * O raio 2 isotrópico colava as letras de UMA PALAVRA, nunca as palavras de uma
 * LINHA: espaço entre palavras é um vão horizontal grande. Medido na arte real
 * `00daccdd` (que está na galeria), a manchete "Feito à mão para você" quebrava
 * em TRÊS blocos de 1,06% / 0,90% / 0,95% do quadro — cada um abaixo do piso de
 * 2%, logo o portão via ZERO objeto e aprovava os quatro recortes. O Story saiu
 * com "to à mão para vo", entregue sob a frase "todos a partir da mesma arte".
 * É exatamente o defeito que o cabeçalho do `kit.ts` diz existir para impedir.
 *
 * Texto se lê na horizontal, então o vão a transpor é horizontal: 6 na largura
 * cola a linha inteira num objeto só. O vertical FICA EM 2 de propósito — subir
 * os dois juntos funde a manchete com a peça logo abaixo, e aí o portão passa a
 * julgar "título + produto" como uma coisa só. Varredura nas três artes reais:
 * 6×2 é o menor par que enxerga a manchete sem fundir nada.
 */
const RAIO_DE_COLA_X = 6;
const RAIO_DE_COLA_Y = 2;

/**
 * Piso de área para um objeto ser levado a sério, em % do quadro.
 *
 * CALIBRADO CONTRA AS ARTES REAIS, e a margem é estreita — está registrada
 * aqui para quem for mexer saber o que está apertando: nos recortes que
 * destruíram a arte, o objeto partido tinha 2,71% / 3,16% / 3,36% do quadro;
 * nos recortes bons, o maior objeto tocado tinha 1,17%.
 *
 * ┌─ POR QUE 1,5 E NÃO 2 (baixado depois de um contraexemplo medido) ────────┐
 * │ Com 2% a arte `placa` ("PORTA DA MATERNIDADE") entregava o kit 4/4 em    │
 * │ VERDE, e DUAS das quatro peças saíam decapitadas: o 4:5 virava           │
 * │ "ORTA DA / ATERNIDADE" e o 9:16 virava "D A / NIDADE". A máscara de      │
 * │ contraste ENXERGA a manchete — quem a matava era este piso: a mancha     │
 * │ colada mede 2843 px num mapa 384×384, ou seja 1,93%, e perdia do piso    │
 * │ de 2% por 106 px (3,6%). Sem objeto na lista, `avaliarRecorte` aprovava  │
 * │ os quatro cortes POR VACUIDADE.                                          │
 * │                                                                          │
 * │ É o mesmo defeito que `RAIO_DE_COLA_X` resolveu para manchete PARTIDA    │
 * │ em blocos; aqui a manchete já vinha colada num objeto só — e ainda       │
 * │ assim não alcançava o piso. Cola não resolve piso.                       │
 * │                                                                          │
 * │ A faixa de separação real passa a ser [1,17% … 1,93%] e o piso volta a   │
 * │ ficar no meio dela. Varredura em 5 artes reais (copo, tábua, troféu,     │
 * │ placa, estúdio) × 4 formatos, com o piso em 2 · 1,8 · 1,5 · 1,3 · 1,2 ·  │
 * │ 1,0 · 0,8: descer de 2 para 1,5 vira EXATAMENTE DOIS vereditos, os dois  │
 * │ da placa, os dois de entrega-errada para recusa-certa. NENHUM recorte    │
 * │ bom foi perdido — o 16:9 da placa, que é o único recorte derivado limpo  │
 * │ do lote, continua entregando em todos os pisos testados.                 │
 * │                                                                          │
 * │ Não descer mais: 1,17% é um recorte BOM medido na calibragem original.   │
 * │ Piso abaixo disso passa a recusar peça que presta.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const AREA_MINIMA_PCT = 1.5;

/** Quantos pixels do mapa reduzido contam como "encostando na borda". */
const FOLGA_DA_BORDA = 2;

/** Um objeto encontrado no quadro. Coordenadas do mapa reduzido. */
export interface Objeto {
	area: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface MapaDeConteudo {
	/** Objetos que estavam INTEIROS no quadro original (não encostam na borda). */
	inteiros: Objeto[];
	/** Lado do mapa reduzido. */
	w: number;
	h: number;
	/** Dimensão real da imagem. */
	W: number;
	H: number;
	/** Fração de pixels em preto ou branco puro — ver `pareceTraco`. */
	fracaoBitonal: number;
}

/** Máscara de contraste local (3×3) acima do limiar. */
function mascaraDeContraste(
	g: Uint8Array | Buffer,
	w: number,
	h: number,
): Uint8Array {
	const m = new Uint8Array(w * h);
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			let mn = 255;
			let mx = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const v = g[(y + dy) * w + (x + dx)];
					if (v < mn) mn = v;
					if (v > mx) mx = v;
				}
			}
			if (mx - mn >= CONTRASTE_MINIMO) m[y * w + x] = 1;
		}
	}
	return m;
}

/**
 * Dilatação binária separável (duas passadas 1D — O(n·r), não O(n·r²)), com
 * raios independentes por eixo. Ver `RAIO_DE_COLA_X`/`_Y`.
 */
function dilatar(
	m: Uint8Array,
	w: number,
	h: number,
	rx: number,
	ry: number,
): Uint8Array {
	if (rx <= 0 && ry <= 0) return m;
	const a = new Uint8Array(w * h);
	const b = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let on = 0;
			for (let d = -rx; d <= rx && !on; d++) {
				const xx = x + d;
				if (xx >= 0 && xx < w && m[y * w + xx]) on = 1;
			}
			a[y * w + x] = on;
		}
	}
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let on = 0;
			for (let d = -ry; d <= ry && !on; d++) {
				const yy = y + d;
				if (yy >= 0 && yy < h && a[yy * w + x]) on = 1;
			}
			b[y * w + x] = on;
		}
	}
	return b;
}

/**
 * Preenche buracos: tudo que o alagamento vindo das bordas NÃO alcança no
 * complemento está cercado, logo é miolo de objeto.
 *
 * ISTO CONSERTA UM PONTO CEGO REAL, e não é enfeite. O mapa de contraste marca
 * BORDA, não massa: uma peça de cor chapada sobre fundo chapado aparece como um
 * ANEL, e a área do anel é o PERÍMETRO dela, não o tamanho dela. Um retângulo de
 * 260×200 num quadro de 1024² ocupa 5% do quadro e o anel dele fica em 1,2% —
 * abaixo do piso, invisível para o portão, e o recorte passava cortando a peça
 * ao meio. Com o buraco preenchido, área volta a significar tamanho.
 *
 * Conferido nas artes reais: com e sem preenchimento o veredito é o MESMO em
 * 16 de 16 casos — ele não move a calibragem, só fecha o buraco.
 */
function preencherBuracos(m: Uint8Array, w: number, h: number): Uint8Array {
	const fora = new Uint8Array(w * h);
	const pilha = new Int32Array(w * h);
	let sp = 0;
	const semear = (i: number) => {
		if (!m[i] && !fora[i]) {
			fora[i] = 1;
			pilha[sp++] = i;
		}
	};
	for (let x = 0; x < w; x++) {
		semear(x);
		semear((h - 1) * w + x);
	}
	for (let y = 0; y < h; y++) {
		semear(y * w);
		semear(y * w + w - 1);
	}
	while (sp > 0) {
		const p = pilha[--sp];
		const x = p % w;
		const y = (p - x) / w;
		if (x > 0) semear(p - 1);
		if (x < w - 1) semear(p + 1);
		if (y > 0) semear(p - w);
		if (y < h - 1) semear(p + w);
	}
	const cheio = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) cheio[i] = fora[i] ? 0 : 1;
	return cheio;
}

/**
 * Rotulagem 8-conexa, iterativa (pilha própria: recursão estoura em 384²).
 *
 * DUAS MÁSCARAS, E A SEPARAÇÃO É O QUE IMPEDE UMA RECUSA FALSA. A `colada` (com
 * a dilatação) decide QUEM É UM OBJETO SÓ — é ela que junta as palavras de uma
 * manchete. A `real` (sem dilatação) decide ONDE ESSE OBJETO COMEÇA E ACABA.
 *
 * Misturar as duas custava caro nos dois sentidos: medindo tudo na colada, a
 * caixa do objeto vinha inflada em `RAIO_DE_COLA_X` px de cada lado (≈16 px reais
 * num 1024) e o portão recusava recorte que não encostava em nada — a manchete
 * de `00daccdd` sobrava 7 px dentro do 4:5 e era reprovada assim. Medindo tudo na
 * real, a ÁREA encolhe e o piso de 2% (que foi calibrado sobre a massa colada)
 * passa a cortar objeto legítimo — `740a4e63` perdia a manchete inteira.
 *
 * Então: área da colada (preserva a calibragem do piso), caixa da real (extensão
 * verdadeira). A folga que o portão quer ter na hora de cortar é explícita e mora
 * em `MARGEM_DE_SEGURANCA`, não num efeito colateral do raio.
 */
function rotular(
	colada: Uint8Array,
	real: Uint8Array,
	w: number,
	h: number,
): Objeto[] {
	const visto = new Uint8Array(w * h);
	const pilha = new Int32Array(w * h);
	const objetos: Objeto[] = [];
	for (let i = 0; i < w * h; i++) {
		if (!colada[i] || visto[i]) continue;
		let sp = 0;
		pilha[sp++] = i;
		visto[i] = 1;
		let area = 0;
		let x0 = w;
		let y0 = h;
		let x1 = -1;
		let y1 = -1;
		while (sp > 0) {
			const p = pilha[--sp];
			const x = p % w;
			const y = (p - x) / w;
			area++;
			if (real[p]) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx;
					const yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
					const q = yy * w + xx;
					if (colada[q] && !visto[q]) {
						visto[q] = 1;
						pilha[sp++] = q;
					}
				}
			}
		}
		// `x1 < 0` = a mancha colada não cobre nenhum pixel real (só pode acontecer
		// se a dilatação criar massa onde não havia contraste). Sem extensão real
		// não há objeto a proteger.
		if (x1 >= 0) objetos.push({ area, x0, y0, x1, y1 });
	}
	return objetos;
}

/**
 * Lê a imagem uma única vez e devolve os objetos que estavam INTEIROS nela.
 *
 * O que sai daqui é reusado por TODOS os formatos do kit — a análise é a parte
 * cara (uma decodificação + duas varreduras), e ela não depende do recorte.
 */
export async function mapearConteudo(png: Buffer): Promise<MapaDeConteudo> {
	const meta = await sharp(png).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	const escala = LADO_DA_ANALISE / Math.max(W, H, 1);
	const w = Math.max(8, Math.round(W * escala));
	const h = Math.max(8, Math.round(H * escala));
	const { data } = await sharp(png)
		.resize(w, h, { fit: 'fill' })
		// `flatten` antes do cinza: PNG com alfa devolveria preto no transparente
		// e inventaria uma borda de contraste que não existe na arte.
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	/**
	 * A CONTA DO BITONAL SAI DE UMA LEITURA SEPARADA, COM `nearest`, E ISSO É UM
	 * BUG JÁ PAGO: medida no mapa acima, uma arte de traço com exatamente dois
	 * níveis {0,255} deu 0,9399 de pixels extremos em vez de 1,0 — a redução
	 * bilinear INVENTA cinza na diagonal de cada traço. Passava do limiar e a
	 * peça de corte era recortada como se fosse foto. Com `nearest` (que só
	 * escolhe pixels existentes) o traço dá 1,0000 e as fotos dão 0,017–0,175:
	 * separação larga, sem limiar delicado. 128 de lado basta — a pergunta é
	 * sobre a PALETA, não sobre a forma.
	 */
	const amostra = await sharp(png)
		.resize(128, 128, { fit: 'fill', kernel: 'nearest' })
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer();
	let extremos = 0;
	for (let i = 0; i < amostra.length; i++) {
		if (amostra[i] <= 8 || amostra[i] >= 247) extremos++;
	}

	const bruta = mascaraDeContraste(data, w, h);
	const colada = preencherBuracos(
		dilatar(bruta, w, h, RAIO_DE_COLA_X, RAIO_DE_COLA_Y),
		w,
		h,
	);
	// A massa SEM cola, para a caixa de cada objeto sair na extensão verdadeira.
	const real = preencherBuracos(bruta, w, h);
	const pisoArea = (w * h * AREA_MINIMA_PCT) / 100;
	const inteiros = rotular(colada, real, w, h).filter(
		(o) =>
			o.area >= pisoArea &&
			o.x0 > FOLGA_DA_BORDA &&
			o.y0 > FOLGA_DA_BORDA &&
			o.x1 < w - 1 - FOLGA_DA_BORDA &&
			o.y1 < h - 1 - FOLGA_DA_BORDA,
	);

	return {
		inteiros,
		w,
		h,
		W,
		H,
		fracaoBitonal: amostra.length ? extremos / amostra.length : 0,
	};
}

/**
 * A arte é de TRAÇO (o modo `gravar`/`vetorizável`)?
 *
 * Peça de corte é bitonal por construção — o `ai.image_studio` limiariza a
 * saída, e uma medição nos bytes de uma arte real deu exatamente dois níveis
 * {0, 255}. Isso importa aqui por um motivo de produto, não de pixel: kit de
 * divulgação é peça de rede social; um arquivo que vai para a MÁQUINA não se
 * recorta para caber no Story — recortar um contorno de corte entrega um
 * caminho aberto, que a máquina corta pela metade.
 */
export function pareceTraco(mapa: MapaDeConteudo): boolean {
	return mapa.fracaoBitonal >= 0.98;
}

/* ─────────────────── o portão ─────────────────── */

export interface VeredictoDeRecorte {
	entrega: boolean;
	/** Em PT-BR, para a tela — nunca jargão, nunca número de pixel. */
	motivo: string;
	/** Quantos objetos inteiros o recorte partiria ou jogaria fora. */
	objetosPartidos: number;
}

/**
 * Lado curto mínimo de um recorte entregue. Abaixo disso a peça já não serve
 * para publicar, e entregar um arquivo pequeno demais é o mesmo tipo de lixo
 * que entregar um texto pela metade.
 */
export const LADO_MINIMO = 320;

/**
 * Folga, em pixels do mapa reduzido, entre a linha de corte e o objeto mais
 * próximo. Encostar não é sobreviver.
 *
 * Ela existe SEPARADA porque antes vinha de graça, por acidente: a caixa dos
 * objetos era medida na massa dilatada, então todo objeto carregava um colchão
 * de `RAIO_DE_COLA` px. Ao medir a caixa na extensão verdadeira (ver `rotular`)
 * esse colchão sumiu — e com ele sumiu uma recusa CERTA: o Story de `740a4e63`
 * passou a "caber" por 1 px de mapa, entregando "Lembrança" com o L raspando a
 * borda do quadro. Com a folga explícita, aquela recusa volta.
 *
 * 2 px de mapa ≈ 5 px reais num 1024. Medido nas três artes reais: 0 deixa
 * passar o L raspado; 4 começa a recusar recorte bom (o 4:5 de `00daccdd`, que
 * sobra 7 px reais). 2 é o único valor que acerta os doze vereditos.
 */
const MARGEM_DE_SEGURANCA = 2;

/**
 * O recorte sobrevive? Aritmética pura sobre o mapa — nada de modelo, nada de
 * rede, milissegundos.
 *
 * O VIÉS É DELIBERADO: na dúvida, NÃO ENTREGA. Recusar custa zero ao aluno
 * (ele continua com a peça principal na mão); entregar um recorte quebrado
 * custa a confiança na ferramenta inteira.
 */
export function avaliarRecorte(
	mapa: MapaDeConteudo,
	recorte: Recorte,
): VeredictoDeRecorte {
	if (Math.min(recorte.width, recorte.height) < LADO_MINIMO) {
		return {
			entrega: false,
			motivo:
				'Neste formato o recorte sairia pequeno demais para publicar com qualidade.',
			objetosPartidos: 0,
		};
	}

	// Recorte que não corta nada é a própria peça — não há o que avaliar.
	if (
		recorte.width >= mapa.W &&
		recorte.height >= mapa.H &&
		recorte.left === 0 &&
		recorte.top === 0
	) {
		return { entrega: true, motivo: '', objetosPartidos: 0 };
	}

	// Recorte para as coordenadas do mapa reduzido. `floor`/`ceil` invertidos de
	// propósito (a janela ANALISADA encolhe): arredondar para fora perdoaria um
	// objeto que encosta na linha de corte, que é justo o caso que se quer pegar.
	const ex = mapa.w / Math.max(1, mapa.W);
	const ey = mapa.h / Math.max(1, mapa.H);
	const L = Math.ceil(recorte.left * ex);
	const T = Math.ceil(recorte.top * ey);
	const R = Math.floor((recorte.left + recorte.width) * ex);
	const B = Math.floor((recorte.top + recorte.height) * ey);

	const M = MARGEM_DE_SEGURANCA;
	const partidos = mapa.inteiros.filter(
		(o) => o.x0 < L + M || o.y0 < T + M || o.x1 >= R - M || o.y1 >= B - M,
	);

	if (partidos.length === 0) {
		return { entrega: true, motivo: '', objetosPartidos: 0 };
	}
	return {
		entrega: false,
		motivo:
			partidos.length === 1
				? 'Neste formato o recorte cortaria um elemento da arte ao meio — a peça ou o texto ficaria pela metade.'
				: 'Neste formato o recorte cortaria partes essenciais da arte — elementos ficariam pela metade.',
		objetosPartidos: partidos.length,
	};
}
