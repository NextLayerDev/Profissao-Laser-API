import QRCode from 'qrcode';
import sharp from 'sharp';

/**
 * O carimbo de autenticidade — o QR gravado DENTRO do pixel da arte.
 *
 * Por que dentro e não ao lado: o arquivo que a plataforma entrega vai parar num
 * pendrive, num grupo de WhatsApp, na pasta compartilhada da oficina. O código
 * viajando num JSON ao lado da imagem não sobrevive a nada disso. Dentro do
 * pixel, a arte e a licença dela são o mesmo objeto — e "arte genérica em alta
 * resolução" deixa de existir como coisa baixável, que é o buraco inteiro do
 * controle de volumetria.
 *
 * ┌─ O QUE SAIU DAQUI, E O QUE ISSO CUSTOU ─────────────────────────────────┐
 * │ Havia uma chapa branca com o código escrito por extenso ao lado do QR.   │
 * │ Ocupava 349×158 px num canto da arte e, no chaveiro "escudo e nome" —    │
 * │ o modelo mais usado —, brigava com o desenho.                            │
 * │                                                                          │
 * │ Agora é só o QR, sem fundo. A área caiu ~72% e o carimbo some no canto.  │
 * │                                                                          │
 * │ O preço: quem tem a peça física com o QR riscado não lê mais o código a  │
 * │ olho. Ele continua no nome do arquivo e na biblioteca do aluno, mas o    │
 * │ objeto sozinho deixa de ser identificável sem leitor. Foi uma escolha.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** A cor do QR sobre arte clara. */
const TINTA = '#111111';
/** A cor do QR sobre arte escura — ver `escolherSelo`. */
const TINTA_INVERSA = '#ffffff';

/**
 * Abaixo desta luminância média (0–255) o canto é escuro e o QR inverte.
 *
 * 128 é o meio da escala de propósito: a pergunta é literalmente "este pedaço é
 * mais claro ou mais escuro?", e qualquer limiar mais esperto seria calibrado
 * numa arte e errado na seguinte.
 */
const LIMIAR_ESCURO = 128;

/** A decisão do selo para uma arte: onde pousa e de que cor sai. */
export interface Selo {
	/** Canto superior esquerdo do selo, em pixels da arte. */
	left: number;
	top: number;
	/**
	 * O canto é escuro? Então o QR sai BRANCO.
	 *
	 * Sem chapa, o contraste tem de vir da própria arte. Sobre um campo
	 * queimado, módulos claros em fundo escuro leem tão bem quanto o contrário —
	 * leitor de celular moderno lê QR invertido. E na peça gravada isso é
	 * coerente por construção: branco é "não queime aqui", então o QR aparece
	 * como o material cru dentro do campo queimado.
	 */
	escuro: boolean;
}

export interface CarimboOpts {
	/** O código em claro, como sai de `gerarCodigoLicenca`. */
	code: string;
	/** A URL pública que o QR carrega (a página `/a/:code`). */
	url: string;
	/**
	 * O selo já decidido. Ausente = a função mede esta arte e decide sozinha.
	 *
	 * `carimbarLote` SEMPRE passa este campo, resolvido uma vez para o lote
	 * todo: é o que mantém as trinta peças de um pedido com o mesmo selo, no
	 * mesmo canto, mesmo quando cada peça é uma geração diferente.
	 */
	selo?: Selo;
}

/** Onde o carimbo caiu, em pixels da arte. */
export interface AreaDoCarimbo {
	left: number;
	top: number;
	width: number;
	height: number;
	/** O QR ocupa a área inteira agora — repetido para quem lia este campo. */
	qr: { left: number; top: number; size: number };
}

export interface CarimboResult {
	png: Buffer;
	/**
	 * Onde o carimbo ficou. Devolvido, e não só usado internamente, porque a
	 * geometria é um FATO da peça: quem grava precisa saber onde o código caiu,
	 * e um teste que recalcula a conta à mão testa a cópia, não o carimbo.
	 */
	area: AreaDoCarimbo;
	/** A cor em que o QR saiu — o lote inteiro usa a mesma. */
	selo: Selo;
}

/** Lado da grade em que a arte é lida para escolher o lugar do selo. */
const GRADE = 96;

interface MapaDaArte {
	/** `true` onde há tinta (pixel opaco e escuro) — o que a máquina queima. */
	tinta: boolean[];
	/** Luminância média de cada célula, 0–255. Transparente conta como claro. */
	luz: number[];
	/**
	 * `true` onde a célula está DENTRO da peça.
	 *
	 * Dentro quer dizer cercada: existe tinta acima, abaixo, à esquerda e à
	 * direita dela. É um teste barato e surpreendentemente certeiro para
	 * silhueta recortada — e é o que separa o vazio de dentro do chaveiro do
	 * vazio que vira sucata depois do corte.
	 */
	dentro: boolean[];
}

/**
 * Lê a arte inteira numa grade pequena, de uma vez.
 *
 * `GRADE × GRADE` é grosseiro de propósito: a pergunta é "cabe aqui?", e ler
 * milhões de pixels para respondê-la seria pagar caro por uma resposta que cabe
 * em nove mil células. Transparente conta como CLARO porque, na arte de laser,
 * transparente é o material cru — e material cru é claro.
 */
async function lerArte(master: Buffer): Promise<MapaDaArte> {
	const { data, info } = await sharp(master)
		.ensureAlpha()
		.resize(GRADE, GRADE, { fit: 'fill' })
		.raw()
		.toBuffer({ resolveWithObject: true });

	const n = GRADE * GRADE;
	const tinta: boolean[] = new Array(n);
	const luz: number[] = new Array(n);
	for (let i = 0; i < n; i++) {
		const p = i * info.channels;
		const alfa = info.channels === 4 ? data[p + 3] : 255;
		const l = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
		if (alfa < 32) {
			tinta[i] = false;
			luz[i] = 255;
		} else {
			tinta[i] = l < 200;
			luz[i] = l;
		}
	}

	// Para cada linha e coluna, onde começa e termina a tinta. Com isso, "cercada
	// nas quatro direções" sai em O(1) por célula.
	const primeiroNaLinha = new Array(GRADE).fill(-1);
	const ultimoNaLinha = new Array(GRADE).fill(-1);
	const primeiroNaColuna = new Array(GRADE).fill(-1);
	const ultimoNaColuna = new Array(GRADE).fill(-1);
	for (let y = 0; y < GRADE; y++) {
		for (let x = 0; x < GRADE; x++) {
			if (!tinta[y * GRADE + x]) continue;
			if (primeiroNaLinha[y] < 0) primeiroNaLinha[y] = x;
			ultimoNaLinha[y] = x;
			if (primeiroNaColuna[x] < 0) primeiroNaColuna[x] = y;
			ultimoNaColuna[x] = y;
		}
	}

	const dentro: boolean[] = new Array(n);
	for (let y = 0; y < GRADE; y++) {
		for (let x = 0; x < GRADE; x++) {
			dentro[y * GRADE + x] =
				primeiroNaLinha[y] >= 0 &&
				primeiroNaColuna[x] >= 0 &&
				x > primeiroNaLinha[y] &&
				x < ultimoNaLinha[y] &&
				y > primeiroNaColuna[x] &&
				y < ultimoNaColuna[x];
		}
	}

	return { tinta, luz, dentro };
}

/**
 * A luminância média de um recorte, no pixel real.
 *
 * Serve só para decidir a COR do QR, e por isso não passa pela grade: uma
 * célula da grade da caneca tem 30 px de largura, e a vizinhança contaminaria a
 * polaridade do selo.
 */
async function medirRegiao(
	master: Buffer,
	box: { left: number; top: number; width: number; height: number },
): Promise<{ luz: number }> {
	if (box.width <= 0 || box.height <= 0) return { luz: 255 };
	const { data, info } = await sharp(master)
		.extract(box)
		.ensureAlpha()
		.resize(48, 48, { fit: 'fill' })
		.raw()
		.toBuffer({ resolveWithObject: true });
	const total = info.width * info.height;
	let soma = 0;
	for (let i = 0; i < total; i++) {
		const p = i * info.channels;
		const alfa = info.channels === 4 ? data[p + 3] : 255;
		// Transparente é o material cru da peça, que é CLARO.
		soma +=
			alfa < 32
				? 255
				: (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
	}
	return { luz: soma / total };
}

/**
 * QUANTOS PIXELS CADA MÓDULO DO QR OCUPA.
 *
 * ┌─ ESTE NÚMERO FOI MEDIDO, NÃO ESCOLHIDO ─────────────────────────────────┐
 * │ Gerando o QR e tentando decodificá-lo em 24 condições (borrão do         │
 * │ queimado × ângulo da foto × distância), a taxa de leitura é:             │
 * │                                                                          │
 * │     2 px/módulo  →  82 px  →  75% das tentativas                         │
 * │   2,5 px/módulo  → 103 px  →  79%                                        │
 * │     3 px/módulo  → 123 px  → 100%                                        │
 * │                                                                          │
 * │ Duas coisas saltam daí. A primeira: 3 px/módulo é um DEGRAU, não uma     │
 * │ rampa — abaixo dele a leitura despenca. A segunda: o selo anterior tinha │
 * │ 120 px fixos, que dão 2,93 px/módulo e caíam logo ABAIXO do degrau,      │
 * │ lendo em 83%. Três pixels a mais o teriam levado a 100%.                 │
 * │                                                                          │
 * │ Ficou em 2 porque o pedido foi um selo ~1/3 menor, e o custo medido são  │
 * │ 8 pontos contra um patamar que já não era 100%. Subir para 3 é trocar    │
 * │ tamanho por leitura — a conta está aqui para essa decisão ser possível.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const PX_POR_MODULO = 2;

/**
 * O LADO DO SELO — sempre múltiplo INTEIRO do número de módulos.
 *
 * O múltiplo inteiro não é capricho. Com tamanho quebrado o renderizador
 * reamostra e as bordas dos módulos borram: medido, 110 px (2,68 px/módulo) lê
 * em 13% das tentativas, enquanto 100 px e 120 px, vizinhos dos dois lados,
 * leem em ~80%. É um buraco que aparece e some conforme o tamanho da arte — o
 * pior tipo de defeito, intermitente e invisível até a peça estar gravada.
 *
 * Depende da URL porque é ela que define quantos módulos o QR tem.
 */
function ladoDoSelo(url: string): number {
	return (
		QRCode.create(url, { errorCorrectionLevel: 'H' }).modules.size *
		PX_POR_MODULO
	);
}

/** As medidas do selo para uma arte deste tamanho. */
function geometriaDoSelo(
	W: number,
	H: number,
	url: string,
): { lado: number; margemX: number; margemY: number } {
	const menor = Math.min(W, H);
	return {
		lado: ladoDoSelo(url),
		// No wrap 360° os 8% externos de cada lado são zona de emenda da caneca.
		margemX: W / H >= 2 ? Math.round(W * 0.1) : Math.round(menor * 0.012),
		margemY: Math.round(menor * 0.012),
	};
}

/**
 * O SELO DO LOTE: ONDE o QR pousa e de que COR ele sai.
 *
 * ┌─ POR QUE NÃO É "UM DOS QUATRO CANTOS" ──────────────────────────────────┐
 * │ Era. O canto mais vazio do ARQUIVO, o que funcionava bem na caneca, que  │
 * │ é um retângulo cheio. No chaveiro quebrou de um jeito pior que cobrir o  │
 * │ desenho: o canto mais vazio de um recorte é o lado de FORA da silhueta,  │
 * │ e ali o QR ia parar na sucata do corte. Código que não fica na peça é    │
 * │ pior que código em cima do nome.                                         │
 * │                                                                          │
 * │ Agora a busca é por posição, não por canto, e só valem posições DENTRO   │
 * │ da peça (`MapaDaArte.dentro`). Entre as válidas, ganha a mais baixa e    │
 * │ mais à direita — que é o "mais no canto" que foi pedido, medido no canto │
 * │ da PEÇA e não no do arquivo.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Exportada porque `carimbarLote` a chama UMA vez por lote: é isso que mantém
 * as trinta peças de um pedido com o selo idêntico.
 */
export async function escolherSelo(
	master: Buffer,
	/** A URL que o QR vai carregar — é ela que define o tamanho do selo. */
	url: string,
): Promise<Selo> {
	const meta = await sharp(master).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	const g = geometriaDoSelo(W, H, url);
	/** O canto de baixo à direita do arquivo — o desfecho quando nada serve. */
	const ultimoRecurso = (): Selo => ({
		left: Math.max(0, W - g.lado - g.margemX),
		top: Math.max(0, H - g.lado - g.margemY),
		escuro: false,
	});
	if (!W || !H) return { left: 0, top: 0, escuro: false };

	const mapa = await lerArte(master);
	const porX = GRADE / W;
	const porY = GRADE / H;
	// O selo em células da grade, arredondado para cima: melhor exigir espaço a
	// mais do que descobrir na peça que faltou.
	const larguraEmCelulas = Math.max(1, Math.ceil(g.lado * porX));
	const alturaEmCelulas = Math.max(1, Math.ceil(g.lado * porY));

	const minX = Math.floor(g.margemX * porX);
	const maxX = Math.floor((W - g.lado - g.margemX) * porX);
	const minY = Math.floor(g.margemY * porY);
	const maxY = Math.floor((H - g.lado - g.margemY) * porY);
	if (maxX < minX || maxY < minY) return ultimoRecurso();

	/** Fração de tinta de um bloco, ou `null` se ele sai da peça. */
	const tintaDoBloco = (x: number, y: number): number | null => {
		if (x < minX || y < minY || x > maxX || y > maxY) return null;
		let comTinta = 0;
		let celulas = 0;
		for (let dy = 0; dy < alturaEmCelulas; dy++) {
			for (let dx = 0; dx < larguraEmCelulas; dx++) {
				const i = (y + dy) * GRADE + (x + dx);
				if (!mapa.dentro[i]) return null;
				if (mapa.tinta[i]) comTinta++;
				celulas++;
			}
		}
		return celulas === 0 ? null : comTinta / celulas;
	};

	/**
	 * O RETÂNGULO DA PEÇA, que não é o do arquivo.
	 *
	 * Numa arte recortada — o chaveiro — a silhueta ocupa o meio e sobra papel
	 * em volta. O canto do ARQUIVO ali é o lado de fora do corte. O canto que
	 * interessa é o da tinta.
	 */
	let pMinX = GRADE;
	let pMinY = GRADE;
	let pMaxX = -1;
	let pMaxY = -1;
	for (let y = 0; y < GRADE; y++) {
		for (let x = 0; x < GRADE; x++) {
			if (!mapa.tinta[y * GRADE + x]) continue;
			if (x < pMinX) pMinX = x;
			if (x > pMaxX) pMaxX = x;
			if (y < pMinY) pMinY = y;
			if (y > pMaxY) pMaxY = y;
		}
	}
	if (pMaxX < 0) return ultimoRecurso();

	/**
	 * DE UM CANTO DA PEÇA, O MELHOR LUGAR PERTO DELE.
	 *
	 * A caminhada é pela diagonal para dentro e CURTA — um quinto da peça. É o
	 * que concilia as duas metades do pedido:
	 *
	 *  · "mais no canto" — a busca nunca se afasta muito da quina, então o selo
	 *    não vai parar no meio da arte;
	 *  · "sem atrapalhar" — entre os poucos lugares dessa caminhada, ganha o
	 *    mais vazio, então ele desvia do nome em vez de pousar em cima dele.
	 *
	 * Parar no PRIMEIRO ponto que cabe seria o defeito de volta: no chaveiro, o
	 * primeiro ponto dentro da peça vindo de baixo é exatamente onde o nome
	 * está. E varrer o quadrante inteiro seria o outro extremo — na caneca, que
	 * é foto e não tem vazio nenhum, o "mais quieto" fica no meio da arte.
	 */
	const perto = (
		quinaX: number,
		quinaY: number,
		passoX: number,
		passoY: number,
	): { x: number; y: number; tinta: number } | null => {
		/**
		 * O alcance é medido em PIXELS DA ARTE, não em células da grade.
		 *
		 * A grade é 96×96 seja qual for a proporção, então numa caneca 360°
		 * (2905×1122) cada célula tem 30 px de largura e 12 de altura. Contar
		 * passos de célula fazia a caminhada horizontal andar duas vezes e meia
		 * mais que a vertical — e o selo, que devia ficar no canto, ia parar no
		 * meio da arte.
		 */
		const limitePx = Math.min(W, H) * 0.15;
		let melhor: { x: number; y: number; tinta: number } | null = null;
		/*
		 * Três caminhos a partir da quina, não um: a diagonal e as DUAS BORDAS.
		 *
		 * Só a diagonal não bastava. No chaveiro, a diagonal do canto de baixo
		 * atravessa o nome inteiro antes de achar branco, e o selo pousava em
		 * cima das letras. Subindo pela borda direita, ele acha o vão ao lado da
		 * âncora em dois passos — que é onde uma pessoa poria.
		 */
		for (const [px, py] of [
			[passoX, passoY],
			[passoX, 0],
			[0, passoY],
		]) {
			/*
			 * Duas fases, e a ordem importa.
			 *
			 * ENTRAR não tem limite de passos: num losango — ou em qualquer
			 * silhueta bem recortada — a quina da caixa fica longe da peça, e
			 * parar cedo devolveria "não achei" e mandaria o selo para o canto do
			 * arquivo, que é sucata depois do corte.
			 *
			 * ESCOLHER, sim, é curto: uma vez dentro, só os próximos passos
			 * contam. É o que segura o selo perto da quina em vez de deixá-lo
			 * passear até o meio da arte atrás do ponto mais vazio.
			 */
			/** Quanto este passo anda na arte, em pixels. */
			const passoPx = Math.hypot(px / porX, py / porY);
			let entrou = -1;
			for (let k = 0; k < GRADE; k++) {
				if (tintaDoBloco(quinaX + px * k, quinaY + py * k) !== null) {
					entrou = k;
					break;
				}
			}
			if (entrou < 0) continue;
			for (let k = entrou; (k - entrou) * passoPx <= limitePx; k++) {
				const x = quinaX + px * k;
				const y = quinaY + py * k;
				const t = tintaDoBloco(x, y);
				if (t === null) continue;
				// `<` e não `<=`: empate fica com o mais perto da quina, que veio antes.
				if (!melhor || t < melhor.tinta) melhor = { x, y, tinta: t };
			}
		}
		return melhor;
	};

	const dir = pMaxX - larguraEmCelulas + 1;
	const baixo = pMaxY - alturaEmCelulas + 1;
	// Ordem = desempate: embaixo antes de em cima, direita antes de esquerda.
	const candidatos = [
		perto(dir, baixo, -1, -1),
		perto(pMinX, baixo, 1, -1),
		perto(dir, pMinY, -1, 1),
		perto(pMinX, pMinY, 1, 1),
	].filter((c): c is { x: number; y: number; tinta: number } => c !== null);

	if (candidatos.length === 0) return ultimoRecurso();

	/**
	 * Trocar de canto exige ser MESMO mais quieto, não quieto por um fio.
	 *
	 * Sem esta folga, meio por cento de tinta mandava o selo do canto de baixo
	 * para o de cima — e a preferência declarada é embaixo, o mais no canto
	 * possível. A ordem dos candidatos é o desempate; a folga é o que faz o
	 * desempate valer na prática.
	 */
	const FOLGA = 0.04;
	let escolhido = candidatos[0];
	for (const c of candidatos) {
		if (c.tinta < escolhido.tinta - FOLGA) escolhido = c;
	}

	const left = Math.max(
		0,
		Math.min(W - g.lado, Math.round(escolhido.x / porX)),
	);
	const top = Math.max(0, Math.min(H - g.lado, Math.round(escolhido.y / porY)));
	// A COR se mede no recorte exato, não na grade: a grade é grossa demais (uma
	// célula da caneca tem 30 px de largura) e erraria a polaridade do QR por
	// causa da vizinhança.
	const { luz } = await medirRegiao(master, {
		left,
		top,
		width: g.lado,
		height: g.lado,
	});
	return { left, top, escuro: luz < LIMIAR_ESCURO };
}

/**
 * Aplica o carimbo e devolve o PNG da peça.
 *
 * O QR é composto como PNG, não por SVG: pixel exato, sem passar por
 * renderizador. Nível H (30% de redundância) porque ele vai gravado em acrílico
 * ou metal e fotografado de lado, com risco e reflexo.
 *
 * Os módulos claros saem TRANSPARENTES — é isso que quer dizer "sem fundo". O
 * contraste vem da própria arte, e por isso `escolherSelo` decide a cor.
 */
export async function carimbarPeca(
	master: Buffer,
	opts: CarimboOpts,
): Promise<CarimboResult> {
	const meta = await sharp(master).metadata();
	const W = meta.width ?? 0;
	const H = meta.height ?? 0;
	if (!W || !H) throw new Error('carimbarPeca: master sem dimensões');

	const selo = opts.selo ?? (await escolherSelo(master, opts.url));
	const g = geometriaDoSelo(W, H, opts.url);
	const caixa = {
		left: Math.max(0, Math.min(W - g.lado, selo.left)),
		top: Math.max(0, Math.min(H - g.lado, selo.top)),
		width: Math.min(g.lado, W),
		height: Math.min(g.lado, H),
	};

	const qrPng = await QRCode.toBuffer(opts.url, {
		errorCorrectionLevel: 'H',
		type: 'png',
		// `scale`, e não `width`: pede o QR com um número INTEIRO de pixels por
		// módulo, sem reamostragem. Ver `ladoDoSelo`.
		scale: PX_POR_MODULO,
		margin: 0,
		color: {
			dark: selo.escuro ? TINTA_INVERSA : TINTA,
			light: '#00000000',
		},
	});

	const png = await sharp(master)
		.ensureAlpha()
		.composite([{ input: qrPng, left: caixa.left, top: caixa.top }])
		.png()
		.toBuffer();

	return {
		png,
		area: {
			left: caixa.left,
			top: caixa.top,
			width: caixa.width,
			height: caixa.height,
			qr: { left: caixa.left, top: caixa.top, size: caixa.width },
		},
		selo,
	};
}
