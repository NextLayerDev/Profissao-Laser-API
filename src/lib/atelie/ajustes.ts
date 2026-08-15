import type { StudioMode } from '../../tool-blocks/blocks/image-studio.js';

/**
 * OS AJUSTES — o que se pode fazer EM CIMA de uma arte pronta.
 *
 * Os sete modos do `ai.image_studio` nasceram como sete botões no começo do
 * fluxo ("o que você quer gerar?"), e era o lugar errado: ninguém decide
 * "remover fundo" antes de existir um fundo. Na F4 eles viram AJUSTES sobre o
 * resultado — ampliar, remover fundo, vetorizar, variar —, que é onde a
 * pergunta faz sentido.
 *
 * ┌─ ESTE ARQUIVO É SÓ REGRA, DE PROPÓSITO ─────────────────────────────────┐
 * │ Import só de TIPO do `image-studio` (apagado na compilação): nada aqui   │
 * │ puxa sharp, OpenRouter ou banco. É o que permite ao controller de        │
 * │ preview — que decide GRÁTIS ou COBRADO — perguntar "este nó pode rodar   │
 * │ de graça?" sem arrastar o motor de imagem inteiro, e permite testar a    │
 * │ regra de cobrança sem dublê nenhum.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** O que um ajuste custa. `local` é sharp na nossa CPU; `modelo` é chamada paga ao fornecedor. */
export type CustoDoAjuste = 'local' | 'modelo';

export interface Ajuste {
	/** O `mode` do `ai.image_studio`. */
	id: StudioMode;
	rotulo: string;
	/**
	 * DE ONDE SAI O CUSTO — medido, não estimado (ver o cabeçalho de
	 * `AJUSTES_LOCAIS`). É este campo que decide por qual rota o ajuste roda.
	 */
	custo: CustoDoAjuste;
	/** `true` = o aluno precisa escrever o que quer (o `superRefine` do bloco exige). */
	pedeTexto: boolean;
	/** Uma linha, em português de gente, para a tela explicar o botão. */
	oQueFaz: string;
}

/**
 * ┌─ A CONTA DE CADA UM, MEDIDA NO CÓDIGO ──────────────────────────────────┐
 * │ `ampliar`       → `upscaleBlock` (ai-extra.ts) = sharp Lanczos3 local.   │
 * │                   Não sai da máquina. Custo de fornecedor: ZERO.         │
 * │ `remover_fundo` → `removeBgBlock` é HÍBRIDO: resolve no chroma-key       │
 * │                   quando o fundo é liso e cai no `generateToolImage`     │
 * │                   quando não é. PODE chamar o modelo ⇒ conta como pago.  │
 * │ `variacao`      → `generateToolImage`. Chama o modelo, sempre.           │
 * │ `vetorizavel`   → `generateToolImage` + threshold. Chama o modelo.       │
 * │                                                                          │
 * │ A regra de produto: um ajuste LOCAL não pode debitar voxxy do aluno, e   │
 * │ um ajuste que chama o modelo não pode sair de graça. `remover_fundo`     │
 * │ fica no lado pago porque a dúvida é nossa, não dele: cobrar "às vezes"   │
 * │ produziria um preço que muda sem explicação visível.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const AJUSTES: readonly Ajuste[] = [
	{
		id: 'ampliar',
		rotulo: 'Ampliar',
		custo: 'local',
		pedeTexto: false,
		oQueFaz: 'Aumenta o tamanho da arte para imprimir ou gravar maior.',
	},
	{
		id: 'remover_fundo',
		rotulo: 'Remover o fundo',
		custo: 'modelo',
		pedeTexto: false,
		oQueFaz: 'Deixa só a peça, com fundo transparente.',
	},
	{
		id: 'vetorizavel',
		rotulo: 'Deixar pronta para gravar',
		custo: 'modelo',
		pedeTexto: true,
		oQueFaz: 'Redesenha em preto e branco puro, sem cinza, para a máquina.',
	},
	{
		id: 'variacao',
		rotulo: 'Criar uma variação',
		custo: 'modelo',
		pedeTexto: true,
		oQueFaz: 'Gera outra versão a partir desta, mudando o que você pedir.',
	},
] as const;

/**
 * Os modos que rodam INTEIROS na nossa CPU. Derivado de `AJUSTES` (e não
 * escrito de novo) para não existir a possibilidade de as duas listas
 * discordarem: um modo que mude de lado no catálogo muda de rota junto.
 */
export const AJUSTES_LOCAIS: ReadonlySet<string> = new Set(
	AJUSTES.filter((a) => a.custo === 'local').map((a) => a.id),
);

/** `true` se este modo do Estúdio não chama fornecedor nenhum — e portanto não pode ser cobrado. */
export function ajusteEhLocal(mode: string | null | undefined): boolean {
	return !!mode && AJUSTES_LOCAIS.has(mode);
}

/** O ajuste pelo id do modo, ou `undefined` se o modo não é um ajuste (ex.: `texto_imagem`). */
export function acharAjuste(mode: string): Ajuste | undefined {
	return AJUSTES.find((a) => a.id === mode);
}

/**
 * Descobre o `mode` com que um nó do pipeline VAI rodar, ANTES de rodar.
 *
 * É a peça que falta para o preview poder decidir grátis/pago: no pipeline o
 * modo raramente é literal — o Ateliê escreve `mode: 'input.modo_geracao'`, e o
 * valor real só existe no multipart do request. Aqui a gente resolve a mesma
 * referência que o motor resolveria (`input.<campo>` → `fields[campo]`), mas
 * sem executar nada.
 *
 * Devolve `null` quando não dá para SABER: referência à saída de outro nó
 * (`algum_no.modo`), campo ausente, qualquer coisa fora do esperado. `null`
 * significa "não posso afirmar que é grátis" — e quem chama trata isso como
 * pago. A dúvida sempre pende para o lado de cobrar, nunca para o de dar de
 * graça uma chamada ao fornecedor.
 */
export function resolverModoDoNo(
	params: Record<string, unknown> | undefined,
	fields: Record<string, string>,
): string | null {
	const bruto = params?.mode;
	if (typeof bruto !== 'string' || bruto.length === 0) return null;

	const ponto = bruto.indexOf('.');
	// Sem ponto = literal (é assim que o motor lê), então o modo é o próprio valor.
	if (ponto <= 0) return bruto;

	const cabeca = bruto.slice(0, ponto);
	if (cabeca !== 'input') return null; // saída de outro nó: só se sabe rodando.

	const campo = bruto.slice(ponto + 1);
	const valor = fields[campo];
	return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/**
 * `true` se este nó do pipeline pode rodar no PREVIEW (a rota não cobrada).
 *
 * Só existe um caso: o `ai.image_studio` num modo local. Todo o resto da
 * família `ai.*` continua fora do preview, como sempre esteve — este é um
 * furo de agulha, não uma porta.
 */
export function aiRodaDeGraca(
	block: string,
	params: Record<string, unknown> | undefined,
	fields: Record<string, string>,
): boolean {
	if (block !== 'ai.image_studio') return false;
	return ajusteEhLocal(resolverModoDoNo(params, fields));
}

/**
 * `true` quando este run NÃO TEM O QUE PAGAR — e por isso não pode ser cobrado.
 *
 * ┌─ O ESPELHO QUE FALTAVA ─────────────────────────────────────────────────┐
 * │ `skipInPreview` usa `aiRodaDeGraca` para não cobrar DE MENOS: um modo    │
 * │ que chama o fornecedor nunca entra na rota grátis. O lado cobrado não    │
 * │ tinha o espelho, então nada impedia o contrário — cobrar DE MAIS.        │
 * │                                                                          │
 * │ Um `POST /api/tool-run/estudio_imagens` com `flow=ajustar&modo=ampliar`  │
 * │ passava pelo `resolveToolBilling`, debitava 1 voxxy (R$ 1,20) e entregava │
 * │ um `resize` Lanczos que não sai da nossa CPU. Só a TELA escolhia a rota; │
 * │ qualquer retry, regressão de front ou cliente alternativo cobrava por    │
 * │ nada. A regra "um ajuste local não pode debitar voxxy" estava escrita em │
 * │ três comentários e implementada em zero lugares do lado que cobra.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * O ESCOPO É ESTREITO DE PROPÓSITO, e é o que impede esta guarda de quebrar
 * tool alheia: ela só fala de pipeline que TEM `ai.image_studio`. Uma tool que
 * não chama fornecedor nenhum — o Estúdio CAD, que é sharp e geometria — é
 * cobrada pelo trabalho de CPU de caso pensado, e continua exatamente como
 * está. Aqui a pergunta é outra: "esta tool, que normalmente paga o
 * fornecedor, foi chamada para fazer só trabalho local?".
 */
export function nadaAPagarNesteRun(
	nodes: readonly { block: string; params?: Record<string, unknown> }[],
	fields: Record<string, string>,
): boolean {
	let temEstudio = false;
	for (const n of nodes) {
		if (n.block === 'ai.image_studio') temEstudio = true;
		// Qualquer outra chamada a fornecedor (o time, uma geração, o removedor
		// híbrido) já justifica a cobrança — e a dúvida pende para cobrar.
		if (n.block === 'image.removeBackground') return false;
		if (n.block.startsWith('ai.') && !aiRodaDeGraca(n.block, n.params, fields)) {
			return false;
		}
	}
	return temEstudio;
}
