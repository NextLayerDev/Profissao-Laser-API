import sharp from 'sharp';
import { z } from 'zod';
import {
	avaliarExtensao,
	avaliarRecorte,
	type BordasDaArte,
	extensaoCentrada,
	KIT_FORMATO_KEYS,
	KIT_FORMATOS,
	type KitFormato,
	LADO_MINIMO,
	mapearConteudo,
	medirBordas,
	pareceTraco,
	recorteCentrado,
} from '../lib/enquadramento.js';
import type { ToolBlock } from '../types.js';
import { aplicarLogo, resolverLogo } from './brandmark.js';

/**
 * `image.kit_crops` — O KIT DO ATELIÊ: uma geração, vários formatos.
 *
 * ┌─ A REGRA DURA QUE DESENHOU ESTE BLOCO ──────────────────────────────────┐
 * │ ELE NÃO GERA IMAGEM. Nenhuma. Recebe a peça pronta e devolve recortes    │
 * │ feitos em sharp, localmente. Isso não é uma limitação — é a única forma  │
 * │ do kit fechar a conta hoje: gerar N artes exigiria `variation_count`, e  │
 * │ o `ai.image_studio` DESCARTA essa chave no Zod. O aluno pagaria três e   │
 * │ receberia uma. Medido: 1 geração = US$ 0,1356 · 3 gerações = US$ 0,4069. │
 * │                                                                          │
 * │ Consequência prática: este bloco NÃO tem caminho de cobrança. Ele custa  │
 * │ CPU e nada mais, e por isso pode rodar no preview e no run pago sem que  │
 * │ o preço da tool mude uma vírgula.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ELE RECUSA, E RECUSAR É A FUNÇÃO ──────────────────────────────────────┐
 * │ Derivar 9:16 de um 1:1 joga fora 43,8% da largura. Nas seis derivações   │
 * │ feitas a partir de artes reais com o enquadramento antigo, ZERO saíram   │
 * │ limpas — o título saía "ua lembranç", "RAVADO CO", ou sumia inteiro.     │
 * │ Um kit que entrega isso é pior do que um kit menor.                      │
 * │                                                                          │
 * │ Então cada formato passa por um portão (`avaliarRecorte`) e, reprovando, │
 * │ NÃO É ENTREGUE — e a tela DIZ por quê, em `recusados`. Degradar em       │
 * │ silêncio seria a única saída pior que não entregar.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ "TODOS OS TAMANHOS": DUAS OPERAÇÕES, ESCOLHIDAS PEÇA A PEÇA ───────────┐
 * │ Recusar certo continua sendo a função — mas com o recorte SOZINHO o kit  │
 * │ entregava 1 de 4, e o pedido do dono é literal: "tem q ter uma opcao de  │
 * │ todos tamanhos e ele de a arte em todas dimensoes pra pessoa".           │
 * │                                                                          │
 * │ Com `estender: true` cada formato tenta, NESTA ORDEM:                    │
 * │   ① RECORTAR, se o portão aprova — é a operação melhor, porque cada      │
 * │     pixel entregue é pixel que o time compôs;                            │
 * │   ② ESTENDER, quando o recorte destruiria — `sharp.extend({ extendWith:  │
 * │     'copy' })` cresce o quadro e a arte fica INTEIRA e centrada;         │
 * │   ③ RECUSAR com o motivo, quando nem uma nem outra serve.                │
 * │                                                                          │
 * │ O que autoriza ② é medição, não otimismo: as bordas das artes do Ateliê  │
 * │ são chapadas por construção, e `avaliarExtensao` mede a lisura DOS LADOS │
 * │ QUE VÃO CRESCER antes de inventar faixa. Borda agitada continua recusada │
 * │ — trocar "recorte com o texto pela metade" por "faixa com rastro" não    │
 * │ seria progresso nenhum.                                                  │
 * │                                                                          │
 * │ Sem `estender` (o default) o bloco se comporta exatamente como antes.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ONDE ELE ENTRA NO PIPELINE, E POR QUE ELE MESMO CARIMBA O LOGO ────────┐
 * │   ai.art_team → ai.image_studio → image.kit_crops → output.save_gallery  │
 * │                                                                          │
 * │ A ASSINATURA DA MARCA É APLICADA AQUI, peça por peça, chamando o         │
 * │ `aplicarLogo` do `image.brandmark` (a MESMA função do bloco: não há uma  │
 * │ segunda cópia da regra). Não é acúmulo de responsabilidade — é a única   │
 * │ ordem que funciona, e o motor não deixa alternativa:                     │
 * │                                                                          │
 * │  · carimbar ANTES do recorte entrega logo pela metade (medido: no 1024²  │
 * │    a caixa cai em x 829…983; o 9:16 guarda x 224…800 e o 4:5 corta o     │
 * │    logo ao meio) e ainda faz o portão abaixo RECUSAR os recortes, porque │
 * │    um logo carimbado vira "objeto inteiro" que o recorte joga fora;      │
 * │  · um nó `image.brandmark` DEPOIS daqui carimbaria uma imagem só — o     │
 * │    pipeline é linear, não existe laço.                                   │
 * │                                                                          │
 * │ Cada peça devolvida traz o seu `recorte` em coordenadas da origem e o    │
 * │ seu `logo_aplicado`/`logo_motivo`: onde o recorte não deixou área limpa, │
 * │ a peça sai sem assinatura E DIZ ISSO, em vez de colar sobre a arte.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * O motor injeta `null` num input de imagem não preenchido (`coerceInputs`);
 * aqui a imagem é obrigatória, então o schema recusa o `null` com uma frase que
 * o aluno entende em vez do "Expected Buffer" do Zod.
 */
const kitSchema = z.object({
	image: z.instanceof(Buffer, {
		message: 'O kit precisa da arte pronta para recortar.',
	}),
	/**
	 * Quais formatos tentar. Todos, por padrão — quem decide o que sai não é
	 * esta lista e sim o portão: pedir um formato não é prometê-lo.
	 */
	formats: z
		.array(z.enum(KIT_FORMATO_KEYS))
		.min(1)
		.max(KIT_FORMATO_KEYS.length)
		.default([...KIT_FORMATO_KEYS]),

	/* ── a assinatura da marca (ver a caixa "onde ele entra no pipeline") ── */
	/** `logo_url` da coleção `marca`, um Buffer ou `data:`. Ausente = sem logo. */
	logo: z
		.union([z.instanceof(Buffer), z.string(), z.null(), z.undefined()])
		.optional(),
	/** O objeto inteiro do Diretor de Arte — o motor não resolve ref aninhada. */
	direcao_arte: z.unknown().optional(),
	/**
	 * Arte de traço (`gravar`): o logo vira tinta preta pura ou não entra.
	 *
	 * `z.coerce.boolean()` seria armadilha (`Boolean('false') === true`), e este
	 * valor chega do multipart como texto quando a tela o manda.
	 */
	line_art: z
		.preprocess(
			(v) => v === true || v === 'true' || v === 1 || v === '1',
			z.boolean(),
		)
		.default(false),

	/**
	 * "TODOS OS TAMANHOS" — autoriza ESTENDER o que o recorte não conseguir.
	 *
	 * `false` por padrão, e o default importa: sem ele, toda tool que já usa
	 * este bloco passaria a inventar faixa sem ninguém ter pedido. Quem liga é
	 * a definition, a partir de uma escolha explícita do aluno na tela.
	 *
	 * Mesmo preprocess do `line_art`, pelo mesmo motivo: o valor chega do
	 * multipart como TEXTO, e `z.coerce.boolean()` é armadilha
	 * (`Boolean('false') === true`).
	 */
	estender: z
		.preprocess(
			(v) => v === true || v === 'true' || v === 1 || v === '1',
			z.boolean(),
		)
		.default(false),
});

export type KitParams = z.infer<typeof kitSchema>;

/** Uma peça entregue no kit. */
interface PecaDoKit {
	formato: KitFormato;
	rotulo: string;
	largura: number;
	altura: number;
	/**
	 * OS BYTES, e eles NÃO SAEM DO BLOCO — ver `montarSaida`. Ficam aqui só para
	 * a peça principal poder virar o `png` que o `output.save_gallery` grava sem
	 * decodificar o base64 de volta.
	 */
	png: Buffer;
	pngBase64: string;
	/**
	 * O pedaço da origem que virou esta peça — em coordenadas da origem.
	 *
	 * Numa peça ESTENDIDA ele é a origem inteira, e isso é literal: a extensão
	 * não descarta um pixel sequer.
	 */
	recorte: { left: number; top: number; width: number; height: number };
	/**
	 * COMO esta peça foi feita. A tela precisa disso para não prometer a mesma
	 * coisa nos três casos: uma peça `extensao` tem faixa que o time não
	 * compôs, e dizer isso é mais honesto do que entregar calado.
	 */
	origem_da_peca: 'principal' | 'recorte' | 'extensao';
	/** Quanta faixa nova entrou de cada lado. Só existe em peça estendida. */
	extensao?: { left: number; top: number; right: number; bottom: number };
	/** `true` quando o formato já era o da origem (a peça principal, intacta). */
	e_a_principal: boolean;
	/** A marca entrou nesta peça? */
	logo_aplicado: boolean;
	/** Por que entrou (ou por que não) — em português, para a tela. */
	logo_motivo: string;
}

interface RecusaDoKit {
	formato: KitFormato;
	rotulo: string;
	motivo: string;
}

export const imageKitCropsBlock: ToolBlock<KitParams> = {
	id: 'image.kit_crops',
	category: 'image',
	description:
		'Kit de formatos a partir de UMA arte: recorta feed, retrato, story e capa por sharp, aplica o logo da marca em cada peça e recusa o recorte que destruiria a composição.',
	paramsSchema: kitSchema,
	async run(ctx, p) {
		/**
		 * O MAPA SAI DA ARTE LIMPA, ANTES DE QUALQUER CARIMBO — e essa ordem é o
		 * portão inteiro. Medido no mapa: um logo de 15% do lado ocupa ~2,25% do
		 * quadro depois do preenchimento de buracos, acima do piso de 2%; se ele
		 * estivesse na imagem analisada, todo recorte que o deixasse de fora
		 * (9:16 e 16:9 saindo de um quadrado deixam os dois) reprovaria por
		 * "jogou fora um objeto inteiro". A arte reprovaria os próprios recortes
		 * por causa da assinatura que nós mesmos colamos.
		 */
		const mapa = await mapearConteudo(p.image);

		/**
		 * O logo é resolvido UMA vez para as quatro peças. `logo_url` é uma URL de
		 * CDN: resolver dentro do laço seriam quatro downloads do mesmo PNG de
		 * 5 KB. Falhar aqui não é erro — `resolverLogo` devolve `null` e o kit sai
		 * sem assinatura, com o motivo em cada peça (a arte já foi paga).
		 */
		const logo = await resolverLogo(p.logo, ctx.signal);

		const pecas: PecaDoKit[] = [];
		const recusados: RecusaDoKit[] = [];

		/**
		 * ARTE DE TRAÇO NÃO SE RECORTA. Peça do modo `gravar` é arquivo de
		 * máquina, não post: cortar um contorno fechado entrega um caminho aberto,
		 * e o laser corta a peça pela metade.
		 *
		 * Repare que isto NÃO derruba o kit inteiro — o formato cuja proporção já
		 * é a da arte não recorta nada, é a própria peça, e continua saindo. Só o
		 * que de fato cortaria é recusado.
		 */
		const eDeTraco = pareceTraco(mapa);

		/**
		 * A LISURA DAS BORDAS É PROPRIEDADE DA ARTE, não do formato — uma
		 * decodificação a 256² serve os quatro formatos. E ela só é paga quando
		 * `estender` está ligado: no caminho de sempre o kit não gasta nem isso.
		 *
		 * Medida na arte LIMPA, antes de qualquer carimbo, pelo mesmo motivo do
		 * mapa logo acima — e aqui com um agravante: o logo entra a 5,5% do lado,
		 * e a faixa medida são os 3,1% extremos. Ele não encosta na medição hoje,
		 * mas depender disso seria depender de dois números que ninguém prometeu
		 * manter alinhados.
		 */
		let bordas: BordasDaArte | null = null;
		const lisura = async (): Promise<BordasDaArte> => {
			bordas ??= await medirBordas(p.image);
			return bordas;
		};

		/**
		 * A ARTE ASSINADA INTEIRA — calculada UMA vez, e reusada por três donos:
		 * a peça principal, TODA peça estendida e o fallback da galeria.
		 *
		 * Peça estendida usa esta e não um carimbo próprio por uma razão que é o
		 * requisito ④ da fase: o `aplicarLogo` MEDE o canto do quadro que recebe,
		 * e no quadro estendido os quatro cantos caem dentro da faixa inventada —
		 * a assinatura iria parar em pixel que ninguém compôs. Carimbando ANTES de
		 * estender, o logo fica onde sempre esteve: dentro da arte de verdade.
		 *
		 * E `direcao_arte` vale aqui, ao contrário do que acontece num recorte: o
		 * canto que o Diretor reservou é coordenada do quadro original, e a
		 * extensão preserva o quadro original inteiro e centrado. O recorte é que
		 * muda o mapa; a moldura, não.
		 */
		let assinadaInteira: Awaited<ReturnType<typeof aplicarLogo>> | null = null;
		const arteAssinada = async () => {
			assinadaInteira ??= await aplicarLogo(p.image, {
				logo,
				direcao_arte: p.direcao_arte,
				line_art: p.line_art,
			});
			return assinadaInteira;
		};

		for (const formato of p.formats) {
			const rotulo = KIT_FORMATOS[formato].rotulo;
			const recorte = recorteCentrado(
				mapa.W,
				mapa.H,
				KIT_FORMATOS[formato].proporcao,
			);
			const eAPrincipal = recorte.width === mapa.W && recorte.height === mapa.H;

			/**
			 * A ARTE JÁ É DESTE FORMATO — não recorta, não estende, não mede nada.
			 * Sai a peça inteira e assinada, que é literalmente a mesma coisa que a
			 * principal. Este atalho tem de vir antes de tudo, inclusive do portão
			 * do traço: uma peça de corte continua saindo no formato dela.
			 */
			if (eAPrincipal) {
				const inteira = await arteAssinada();
				pecas.push({
					formato,
					rotulo,
					largura: mapa.W,
					altura: mapa.H,
					png: inteira.png,
					pngBase64: inteira.pngBase64,
					recorte,
					origem_da_peca: 'principal',
					e_a_principal: true,
					logo_aplicado: inteira.logo_aplicado,
					logo_motivo: inteira.motivo,
				});
				continue;
			}

			if (eDeTraco) {
				/**
				 * ARTE DE TRAÇO NÃO SE RECORTA — e também NÃO SE ESTENDE. A extensão
				 * não abriria contorno nenhum (ela só acrescenta faixa), mas mudar o
				 * quadro de um arquivo que vai para a MÁQUINA é decisão de quem vai
				 * gravar, não do kit de divulgação. E há um furo concreto: uma linha
				 * preta encostada na borda mede aspereza baixa (é um degrau só) e
				 * passaria pelo portão da lisura, saindo esticada como uma barra
				 * preta atravessando a peça inteira.
				 */
				recusados.push({
					formato,
					rotulo,
					motivo:
						'Esta é uma arte de traço, para a máquina cortar. Recortá-la abriria os contornos e a peça sairia pela metade — o kit de divulgação vale para as artes de foto e de cena.',
				});
				continue;
			}

			/**
			 * ① RECORTAR, se o portão aprova. É a operação PREFERIDA e a ordem não é
			 * gosto: todo pixel de um recorte foi composto pelo time, enquanto a
			 * faixa de uma extensão é área inventada. Quando o corte é pequeno (de
			 * 4:5 para 1:1, por exemplo) recortar é simplesmente melhor.
			 */
			const veredicto = avaliarRecorte(mapa, recorte);
			if (veredicto.entrega) {
				/**
				 * NUNCA AMPLIA. O recorte 9:16 de um 1024×1024 sai 576×1024, e esticá-lo
				 * até os 864×1536 do catálogo de formatos não acrescenta um pixel de
				 * informação — só peso de arquivo e a impressão falsa de que a peça foi
				 * gerada naquele tamanho. Sai o que existe.
				 */
				const cru = await sharp(p.image).extract(recorte).png().toBuffer();

				/**
				 * A ASSINATURA, PEÇA A PEÇA.
				 *
				 * `direcao_arte` NÃO vale para um recorte: o canto que o Diretor
				 * reservou é uma coordenada do quadro inteiro, e num recorte aquele
				 * canto ou já não existe ou virou outro lugar da composição. Aqui o
				 * canto sai só da MEDIÇÃO do `aplicarLogo`, que é determinística e não
				 * depende de prosa nenhuma — e quando nenhum canto está limpo, a peça
				 * sai sem logo dizendo por quê, em vez de carimbar por cima da arte.
				 */
				const assinada = await aplicarLogo(cru, {
					logo,
					line_art: p.line_art,
				});

				pecas.push({
					formato,
					rotulo,
					largura: recorte.width,
					altura: recorte.height,
					png: assinada.png,
					pngBase64: assinada.pngBase64,
					recorte,
					origem_da_peca: 'recorte',
					e_a_principal: false,
					logo_aplicado: assinada.logo_aplicado,
					logo_motivo: assinada.motivo,
				});
				continue;
			}

			// O recorte não serve e ninguém pediu para completar: recusa como sempre.
			if (!p.estender) {
				recusados.push({ formato, rotulo, motivo: veredicto.motivo });
				continue;
			}

			/**
			 * ② ESTENDER. O lado menor não muda (a moldura só cresce um eixo), então
			 * o piso de publicação é o mesmo `LADO_MINIMO` do recorte — e uma arte
			 * pequena demais continua pequena demais depois da moldura.
			 */
			const ext = extensaoCentrada(
				mapa.W,
				mapa.H,
				KIT_FORMATOS[formato].proporcao,
			);
			if (Math.min(ext.width, ext.height) < LADO_MINIMO) {
				recusados.push({
					formato,
					rotulo,
					motivo:
						'Neste formato a peça sairia pequena demais para publicar com qualidade.',
				});
				continue;
			}

			const podeEsticar = avaliarExtensao(await lisura(), ext);
			if (!podeEsticar.entrega) {
				// ③ Nem recorte nem moldura: recusa, e o motivo é o da MOLDURA — é a
				// última porta que fechou, e é a que explica por que sobrou nada.
				recusados.push({ formato, rotulo, motivo: podeEsticar.motivo });
				continue;
			}

			/**
			 * A arte assinada entra INTEIRA no meio da moldura — ver `arteAssinada`
			 * sobre por que o carimbo vem antes e não depois.
			 *
			 * `extendWith: 'copy'` replica a linha extrema. ⚠ `'mirror'` está ERRADO
			 * aqui e foi testado: ele espelha a imagem inteira e o produto reaparece
			 * de cabeça para baixo no rodapé da peça.
			 */
			const inteira = await arteAssinada();
			const esticada = await sharp(inteira.png)
				.extend({
					top: ext.top,
					bottom: ext.bottom,
					left: ext.left,
					right: ext.right,
					extendWith: 'copy',
				})
				.png()
				.toBuffer();

			pecas.push({
				formato,
				rotulo,
				largura: ext.width,
				altura: ext.height,
				png: esticada,
				pngBase64: `data:image/png;base64,${esticada.toString('base64')}`,
				// A origem inteira — a extensão não descarta um pixel sequer.
				recorte: { left: 0, top: 0, width: mapa.W, height: mapa.H },
				origem_da_peca: 'extensao',
				extensao: {
					left: ext.left,
					top: ext.top,
					right: ext.right,
					bottom: ext.bottom,
				},
				e_a_principal: false,
				logo_aplicado: inteira.logo_aplicado,
				logo_motivo: inteira.motivo,
			});
		}

		/**
		 * A PEÇA QUE VAI PARA A GALERIA — e ela existe mesmo quando nenhum formato
		 * pedido bate com a proporção da arte.
		 *
		 * `save_gallery` precisa de UM buffer, e o kit é uma lista. A principal é a
		 * peça cuja proporção já era a da origem; não havendo nenhuma (arte 4:3 com
		 * um kit só de story, por exemplo), a arte INTEIRA e assinada é o que se
		 * guarda — jamais um recorte NEM uma peça estendida, que arquivariam menos
		 * arte ou mais faixa do que o aluno pagou.
		 *
		 * Repare que `arteAssinada()` é a MESMA chamada que a peça principal já
		 * fez: memoizada, ela custa zero na segunda vez e garante que a imagem da
		 * galeria e a peça na tela sejam byte a byte a mesma coisa.
		 */
		const a = await arteAssinada();
		const principal = {
			png: a.png,
			pngBase64: a.pngBase64,
			logo_aplicado: a.logo_aplicado,
			logo_motivo: a.motivo,
		};

		return montarSaida(pecas, recusados, mapa.W, mapa.H, principal);
	},
};

/**
 * A saída, com o resumo já escrito.
 *
 * NÃO SAI BUFFER DAQUI. O `projectOutput` serializa para JSON o que a
 * definition listar, e um Buffer dentro de um array viraria
 * `{"type":"Buffer","data":[…]}` — megabytes de números na resposta. As peças
 * viajam como data URL, que é o que a tela usa tanto no `<img>` quanto no
 * download.
 */
function montarSaida(
	pecas: PecaDoKit[],
	recusados: RecusaDoKit[],
	W: number,
	H: number,
	principal: {
		png: Buffer;
		pngBase64: string;
		logo_aplicado: boolean;
		logo_motivo: string;
	},
): Record<string, unknown> {
	return {
		/**
		 * A ARTE ASSINADA, EM BYTES — é o que o `output.save_gallery` sobe e o que
		 * a tela mostra grande. Sai FORA de `pecas` de propósito: um Buffer dentro
		 * de um array vira `{"type":"Buffer","data":[…]}` no JSON da resposta, e
		 * essa chave sozinha traria megabytes de números para o navegador.
		 */
		png: principal.png,
		pngBase64: principal.pngBase64,
		logo_aplicado: principal.logo_aplicado,
		logo_motivo: principal.logo_motivo,

		// `png` some de cada peça pelo mesmo motivo: para a tela, data URL basta.
		pecas: pecas.map(({ png: _bytes, ...resto }) => resto),
		recusados,
		total: pecas.length,
		origem: { largura: W, altura: H },
		/**
		 * Uma frase pronta para a tela. Existe porque a recusa PRECISA aparecer:
		 * um kit que volta com duas peças em vez de quatro, sem explicação, lê-se
		 * como defeito. Com a frase, lê-se como critério.
		 */
		resumo: resumoDoKit(pecas, recusados),
	};
}

/**
 * A frase da tela.
 *
 * Ela existe porque a recusa PRECISA aparecer: um kit que volta com duas peças
 * em vez de quatro, sem explicação, lê-se como defeito. Com a frase, lê-se como
 * critério.
 *
 * E quando houve EXTENSÃO ela diz isso também — em português de gente, sem a
 * palavra "extensão". O aluno vai olhar uma peça cuja beirada o time não
 * compôs; descobrir sozinho seria pior do que ser avisado.
 */
function resumoDoKit(pecas: PecaDoKit[], recusados: RecusaDoKit[]): string {
	if (pecas.length === 0) {
		return 'Nenhum formato extra saiu deste kit — o recorte estragaria a arte.';
	}
	const esticadas = pecas.filter((x) => x.origem_da_peca === 'extensao').length;
	const quantas = `${pecas.length} ${pecas.length === 1 ? 'formato' : 'formatos'}`;
	const comoSairam = esticadas
		? `Kit com ${quantas}, todos a partir da mesma arte — em ${esticadas === 1 ? '1 delas' : `${esticadas} delas`} as bordas foram completadas para caber no formato, sem cortar nada.`
		: `Kit com ${quantas}, todos a partir da mesma arte.`;
	if (recusados.length === 0) return comoSairam;
	return `${comoSairam} ${recusados.length} ${recusados.length === 1 ? 'ficou de fora' : 'ficaram de fora'} para não entregar a arte cortada.`;
}

export const kitBlocks: ToolBlock[] = [imageKitCropsBlock];
