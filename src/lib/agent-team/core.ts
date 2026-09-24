/**
 * O NÚCLEO DE UM TIME DE AGENTES — o que vale para QUALQUER time, e nada além.
 *
 * ┌─ POR QUE ESTE ARQUIVO EXISTE (e por que ele nasceu de um recorte, não de   ┐
 * │ uma cópia)                                                                 │
 * │ A Central de Inteligência (`lib/research/agents.ts`) foi o primeiro time.  │
 * │ O Ateliê (`lib/atelie/agents.ts`) é o segundo, e resolve outro problema:   │
 * │ ninguém pesquisa a web, não existe cache de mercado, não existe escopo     │
 * │ `produto`/`mercado` nem modo `rápido`/`profundo`. Copiar `agents.ts`       │
 * │ inteiro daria um arquivo em que metade dos campos (`motor_busca`,          │
 * │ `max_buscas`, `dominios_*`, `filtrar_por_tema`, `compartilhavel`, `escopo`)│
 * │ nasceria morta — e, pior, daria DUAS versões da mesma regra sutil (a       │
 * │ ordem de sacrifício do teto, o piso de sucesso, a interpolação que apaga a │
 * │ preposição órfã) para divergirem em silêncio na primeira correção.         │
 * │                                                                            │
 * │ Então o recorte é este: aqui fica o que NÃO sabe o que o time faz — ondas, │
 * │ política de teto, quem não pode ser cortado, piso de entrega, template.    │
 * │ Lá fica a POLÍTICA de cada produto: quais campos o roster tem, quantos     │
 * │ profissionais o aluno vê, o que o cache cobre.                             │
 * │                                                                            │
 * │ A Central importa daqui e NÃO mudou de comportamento: o que saiu de lá     │
 * │ chegou aqui verbatim, e os testes que já cobriam a ordem de sacrifício, o  │
 * │ piso com 22 e a interpolação continuam apontando para `lib/research`.      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Módulo puro: só normalização e aritmética, nenhum I/O.
 */

/**
 * Em que ONDA o especialista trabalha.
 *
 * `descoberta`      — trabalha só com o que o aluno mandou. Roda em paralelo
 *                     com os outros da onda.
 * `aprofundamento`  — recebe o digest da onda 1 e trabalha EM CIMA dele.
 * `sintese`         — recebe o digest das ondas 1 e 2 e escreve a entrega.
 *
 * ┌─ POR QUE A ONDA DO MEIO PRECISOU EXISTIR ───────────────────────────────┐
 * │ Medido num run real da Central ("brindes corporativos"): o Analista de   │
 * │ Margem procurava insumo de COPO TÉRMICO enquanto o Radar achava ACRÍLICO │
 * │ e MDF, porque os dois corriam ao mesmo tempo e nenhum via o que o outro  │
 * │ tinha encontrado. Não é paralelizável: é dependência de dado, e a única  │
 * │ forma de respeitá-la é uma barreira entre as ondas.                      │
 * │                                                                          │
 * │ No Ateliê a mesma forma aparece com outro nome: o Diretor de Arte não    │
 * │ tem o que dirigir antes de alguém ter olhado a foto do produto.          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export type FaseAgente = 'descoberta' | 'aprofundamento' | 'sintese';

/**
 * A ordem em que as ondas rodam. É barreira: a seguinte só começa quando a
 * anterior fecha, porque é do digest dela que ela vive.
 */
export const ORDEM_DAS_ONDAS: readonly FaseAgente[] = [
	'descoberta',
	'aprofundamento',
	'sintese',
];

/**
 * O valor ANTIGO gravado no banco (`fase: 'pesquisa'`) e o que ele significa
 * hoje.
 *
 * A coleção de agentes é DADO: existem registros gravados com `'pesquisa'` e
 * ninguém pode ser obrigado a migrar linha de banco por causa de um rename.
 * `'pesquisa'` era exatamente "vai atrás de informação sem depender de
 * ninguém", que é a onda 1 — então mapeia para `descoberta`, e um roster
 * antigo continua rodando como sempre rodou (duas ondas: 1 e 3).
 */
export function normalizarFase(v: unknown): FaseAgente {
	const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
	if (s === 'sintese') return 'sintese';
	if (s === 'aprofundamento') return 'aprofundamento';
	// 'pesquisa' (valor antigo), vazio ou lixo caem na onda 1: é o único lugar
	// onde um especialista roda sem depender de material de ninguém, ou seja, o
	// único padrão que não pode quebrar.
	return 'descoberta';
}

/* ── leitura de registro de coleção ──────────────────────────────────────── */

/**
 * Os três coadores de `data` (jsonb) → spec.
 *
 * Ficam aqui porque os dois rosters os usam nos MESMOS campos, e o `bool` em
 * particular é a defesa contra uma armadilha que já custou rodada: o jsonb
 * devolve `true`, `'true'` ou `1` conforme quem gravou (tela, seed ou
 * `collection.save`), e `Boolean('false')` é `true`. Comparar explicitamente é
 * a única leitura que não liga um agente que o admin desligou.
 */
export function str(v: unknown, alt = ''): string {
	return typeof v === 'string' && v.trim() ? v.trim() : alt;
}
export function num(v: unknown, alt: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : alt;
}
export function bool(v: unknown): boolean {
	return v === true || v === 'true' || v === 1;
}

/* ── seleção do time ─────────────────────────────────────────────────────── */

/** O mínimo que o núcleo precisa saber de um agente para montar o time. */
export interface AgenteBase {
	chave: string;
	fase: FaseAgente;
	/** Se falhar, o run não é cobrado. */
	essencial: boolean;
}

/**
 * Quem o teto NÃO pode cortar.
 *
 * `sintese` é quem LÊ o time e escreve a entrega: cortá-lo seria o primeiro
 * efeito de um `slice` por ordem crescente (ele tem a ordem mais alta), e o
 * aluno receberia N levantamentos e nenhuma conclusão. `essencial` é quem,
 * faltando, derruba o run no piso de sucesso — cortá-lo não economiza nada, só
 * troca "caro" por "falhou".
 */
export function protegido(a: AgenteBase): boolean {
	return a.fase === 'sintese' || a.essencial;
}

/**
 * Limite duro: corta até caber, na ORDEM DE SACRIFÍCIO.
 *
 * A fila abaixo é de QUEM FICA. Sai primeiro o aprofundamento comum, depois a
 * descoberta comum, depois o essencial de onda de trabalho, e a onda de síntese
 * só se não sobrar mais ninguém. Diferente da política, aqui essencial PODE
 * cair — este teto é freio de emergência contra roster mal semeado, não decisão
 * de produto.
 *
 * ┌─ POR QUE A ONDA 2 É SACRIFICADA ANTES DA ONDA 1 ────────────────────────┐
 * │ Com uma fila só de "quem trabalha" (a versão de duas ondas), o corte     │
 * │ caía por `ordem` e podia levar a descoberta inteira deixando o           │
 * │ aprofundamento de pé — e o aprofundamento VIVE do digest da descoberta.  │
 * │ O sobrevivente rodaria em cima de uma onda 1 vazia: chamada paga,        │
 * │ resposta sem insumo. Cortar primeiro quem depende é o único corte que    │
 * │ não desperdiça o que ficou.                                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function aplicarLimiteDuro<A extends AgenteBase>(
	time: A[],
	limite: number,
): A[] {
	if (time.length <= limite) return time;
	const comum = (a: A) => a.fase !== 'sintese' && !a.essencial;
	const fila = [
		...time.filter((a) => a.fase === 'sintese'),
		...time.filter((a) => a.fase !== 'sintese' && a.essencial),
		...time.filter((a) => comum(a) && a.fase === 'descoberta'),
		...time.filter((a) => comum(a) && a.fase === 'aprofundamento'),
	];
	const fica = new Set(fila.slice(0, limite));
	return time.filter((a) => fica.has(a));
}

/** O time desta execução, já com a política aplicada. */
export interface TimeMontado<A> {
	/**
	 * TODOS os profissionais do modo, na ordem de exibição.
	 *
	 * Inclui quem não vai rodar por já estar coberto — é o que impede a tela de
	 * anunciar "1 de 3 PROFISSIONAIS" num cache quente e desmentir a promessa que
	 * o aluno acabou de ler no botão.
	 */
	time: A[];
	/** Quem de fato vai trabalhar agora. */
	paraRodar: A[];
	/** Quem já veio pronto (cache). Vazio em time que não tem cache. */
	aproveitados: A[];
}

export interface MontagemOpts<A> {
	/**
	 * QUANTOS PROFISSIONAIS O ALUNO VÊ TRABALHANDO — promessa de tela, não
	 * número de engenharia. Quem define é o produto (`TETO_POR_MODO` na Central,
	 * `TETO_DO_ATELIE` no Ateliê).
	 */
	politica: number;
	/**
	 * Limite DURO de segurança — não é a política.
	 *
	 * Existe só para o caso de alguém semear registros demais: a coleção de
	 * agentes é dado editável por tela, e nada impede um roster absurdo.
	 */
	limiteDuro: number;
	/** Este agente já veio pronto do cache? Ausente = ninguém vem pronto. */
	aproveitar?: (a: A) => boolean;
}

/**
 * Monta o time a partir dos ELEGÍVEIS (o chamador já filtrou e ordenou) e diz
 * quem trabalha agora e quem já veio do cache.
 *
 * A ORDEM IMPORTA: o teto é aplicado ao time INTEIRO (ignorando cache) e só
 * DEPOIS o cache separa quem roda. Filtrar o cache primeiro liberaria vaga para
 * outros — o time mudaria de tamanho conforme a idade do cache, e era isso que
 * fazia a tela encolher.
 *
 * A política corta as ONDAS DE TRABALHO (descoberta e aprofundamento), na ordem
 * em que o chamador entregou, e nunca toca em quem é `protegido`. Consequência
 * assumida: um roster com mais protegidos que o teto entrega um time MAIOR que
 * a política. É melhor que a alternativa — uma entrega sem conclusão, ou um run
 * que falha no piso por ter cortado justamente quem não podia faltar.
 */
export function montarTimeBase<A extends AgenteBase>(
	elegiveis: A[],
	opts: MontagemOpts<A>,
): TimeMontado<A> {
	const protegidos = elegiveis.filter(protegido);
	const cortaveis = elegiveis.filter((a) => !protegido(a));
	const vagas = Math.max(0, opts.politica - protegidos.length);
	const escolhidos = new Set([...protegidos, ...cortaveis.slice(0, vagas)]);

	const time = aplicarLimiteDuro(
		elegiveis.filter((a) => escolhidos.has(a)),
		Math.max(1, opts.limiteDuro),
	);

	const aproveitados = opts.aproveitar
		? time.filter((a) => opts.aproveitar?.(a) === true)
		: [];
	const paraRodar = time.filter((a) => !aproveitados.includes(a));

	return { time, paraRodar, aproveitados };
}

/**
 * A FRAÇÃO do time que precisa entregar para o resultado valer o que foi
 * cobrado.
 *
 * Um terço, e o número tem origem: com o time de 5 da Central esta regra é
 * inerte (os dois essenciais do rápido já são ⌈5/3⌉ = 2). Com 22, ela é a única
 * coisa que ainda significa alguma coisa — ver `pisoDeSucesso`.
 */
const FRACAO_MINIMA_DE_ENTREGA = 1 / 3;

/**
 * Quantos precisam entregar para o run valer. Zero essencial ⇒ basta um.
 *
 * Recebe QUEM VAI RODAR, nunca o time inteiro: com cache quente os aproveitados
 * não rodam, e contá-los no piso faria um run legítimo "falhar" por não entregar
 * quem nem foi chamado para trabalhar.
 *
 * ┌─ POR QUE O PISO DEIXOU DE SER SÓ "OS ESSENCIAIS" ───────────────────────┐
 * │ Com 5 especialistas, "os 2 essenciais entregaram" é 40% do time: uma     │
 * │ entrega que passa nesse piso ainda tem corpo. Com 22, os mesmos 2 são 9% │
 * │ — e o piso passava a autorizar a cobrança de 6 voxxys por uma tela com   │
 * │ nota, veredito e mais NADA. O piso existe exatamente para isso não ser   │
 * │ cobrado.                                                                 │
 * │                                                                          │
 * │ O `max` mantém a regra antiga onde ela era mais dura (roster com muitos  │
 * │ essenciais) e a proporcional entra onde ela virou letra morta. Os        │
 * │ essenciais continuam sendo conferidos NOMINALMENTE por quem chama —      │
 * │ este número é contagem, e contagem não sabe QUEM caiu.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function pisoDeSucesso(paraRodar: { essencial: boolean }[]): number {
	if (paraRodar.length === 0) return 0;
	const essenciais = paraRodar.filter((a) => a.essencial).length;
	const proporcional = Math.ceil(paraRodar.length * FRACAO_MINIMA_DE_ENTREGA);
	// Nunca pede mais entregas do que existem especialistas rodando, e nunca
	// menos que uma: sem isso um time de 1 sem essencial passaria com zero.
	return Math.min(paraRodar.length, Math.max(1, essenciais, proporcional));
}

/**
 * Troca `{chave}` pelo valor no template.
 *
 * Variável VAZIA some, junto com a preposição que a introduzia — não fica como
 * `{material}` literal.
 *
 * Medido num run real de escopo `mercado`: o Analista de Margem disparou a
 * busca "Quanto custa a matéria-prima para fabricar Brinde corporativo em
 * {material}?" porque no ramo inteiro não existe um material único. Quem
 * formula os termos a partir dessa frase é o buscador, e uma chave de template
 * crua no meio da pergunta é ruído que ele leva a sério. Deixar o token
 * verbatim foi a escolha original (melhor ver o buraco do que uma frase
 * truncada), mas isso vale para prompt lido por humano — não para texto que
 * vira consulta de busca paga, nem para texto que vira prompt de imagem.
 */
export function interpolar(
	template: string,
	vars: Record<string, unknown>,
): string {
	return template
		.replace(
			/(\s+(?:em|de|do|da|com|para|no|na)\b)?\s*\{(\w+)\}/gi,
			(_todo, prep: string | undefined, chave: string) => {
				const v = vars[chave];
				if (v === undefined || v === null || v === '') return '';
				const valor = typeof v === 'string' ? v : JSON.stringify(v);
				return `${prep ?? ' '}${prep ? ' ' : ''}${valor}`.replace(/^ +/, ' ');
			},
		)
		.replace(/\s{2,}/g, ' ')
		.replace(/\s+([?.!,;])/g, '$1')
		.trim();
}

/* ── digest: o material que uma onda entrega à seguinte ──────────────────── */

/**
 * Divide um teto de caracteres entre N textos SEM deixar ninguém de fora.
 *
 * Enchimento por nível ("water filling"): quem é curto leva o que precisa e
 * devolve a sobra para os demais; quem é longo divide o que restou em partes
 * iguais. É a alternativa honesta ao `slice` no fim, e a diferença aparece
 * exatamente onde o time cresce.
 */
export function repartirChars(tamanhos: number[], teto: number): number[] {
	const cotas = new Array<number>(tamanhos.length).fill(0);
	let restante = Math.max(0, teto);
	// Índices do menor para o maior: quem cabe na parte igual é servido primeiro
	// e a sobra dele engorda a parte de quem não coube.
	const ordem = tamanhos
		.map((t, i) => ({ t: Math.max(0, t), i }))
		.sort((a, b) => a.t - b.t);

	let faltam = ordem.length;
	for (const { t, i } of ordem) {
		const parte = Math.floor(restante / faltam);
		const cota = Math.min(t, parte);
		cotas[i] = cota;
		restante -= cota;
		faltam--;
	}
	return cotas;
}

/**
 * Markdown pronto para quem vai ler o time — evita um template com N slots.
 *
 * ┌─ O TETO É REPARTIDO, NÃO CORTADO NO FIM ────────────────────────────────┐
 * │ Antes o digest era montado sem limite e quem cortava era um `slice` lá   │
 * │ no fim. Com 6 especialistas isso nunca mordia. Com 17, o corte cego      │
 * │ apagava os DOZE ÚLTIMOS — inclusive a onda 2 inteira — e nada quebrava:  │
 * │ a entrega saía bonita e vazia.                                           │
 * │                                                                          │
 * │ Com a repartição, cada especialista tem cota e quem escreveu pouco       │
 * │ devolve a sobra. Um especialista pode ficar com o texto encurtado; o que │
 * │ não pode é sumir do material sem ninguém saber.                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export function montarDigest(
	blocos: { nome: string; corpo: string }[],
	teto: number,
): string {
	// O cabeçalho de cada bloco é obrigatório: sem o nome, o material vira um
	// texto só e a síntese não sabe quem apurou o quê. Por isso ele sai do teto
	// ANTES da repartição, em vez de disputar cota com o conteúdo.
	const cabecalhos = blocos.map((b) => `## ${b.nome}\n`);
	const paraCorpo = Math.max(
		0,
		teto - cabecalhos.reduce((t, c) => t + c.length + 2, 0),
	);
	const cotas = repartirChars(
		blocos.map((b) => b.corpo.length),
		paraCorpo,
	);
	return blocos
		.map((b, i) => `${cabecalhos[i]}${b.corpo.slice(0, cotas[i])}`)
		.join('\n\n');
}
