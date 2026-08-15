/**
 * A MARCA DO ALUNO — o cadastro que atravessa as ferramentas.
 *
 * A identidade da empresa é cadastrada UMA vez, na coleção `marca` do contêiner
 * `perfil` (`visibility:'owner'`, `submissions.who:'student'`), pela seção
 * "Minha marca" da página de perfil. Este arquivo é o que as FERRAMENTAS usam
 * para consumi-la — hoje o time do Ateliê (`ai.art_team`), o time da Central de
 * Inteligência (`ai.research_team`) e o link público do Orçamento
 * (`controllers/public-quote.ts`).
 *
 * ┌─ POR QUE UM ARQUIVO E NÃO DOIS TRECHOS PARECIDOS ────────────────────────┐
 * │ Os dois consumidores leem a MESMA coleção por caminhos diferentes: o     │
 * │ bloco recebe o resultado achatado de `collection.query`                  │
 * │ (`{id, title, score, ...data}`), o link lê `CollectionEntry` cru pelo    │
 * │ repositório (`{..., data:{...}}`). Se cada um escolhesse a marca à sua   │
 * │ maneira, o aluno com duas marcas veria uma no anúncio e outra na página  │
 * │ pública — e ninguém saberia dizer qual das duas está errada. A REGRA DE  │
 * │ ESCOLHA mora aqui, em função pura, e é a mesma para todo mundo.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA: A MARCA MAIS RECENTE, E NENHUMA PERGUNTA ──────────────────────┐
 * │ O aluno PODE ter mais de uma marca (quem revende para clientes, quem tem │
 * │ duas lojas). Perguntar "qual marca?" em cada ferramenta devolveria       │
 * │ exatamente a pergunta que o cadastro único existe para eliminar — e a    │
 * │ pergunta apareceria antes de a resposta importar, no meio de um          │
 * │ formulário sobre outra coisa.                                            │
 * │                                                                          │
 * │ Escolhemos A ÚLTIMA CRIADA (`created_at` desc, que é o `sort:'recent'`   │
 * │ do repositório) por três motivos:                                        │
 * │  1. é a que ele acabou de cadastrar — a que está na cabeça dele. Qualquer│
 * │     outra regra (a primeira, a de nome alfabético) escolhe pela história,│
 * │     não pela intenção;                                                   │
 * │  2. o custo do erro é baixo e VISÍVEL: o anúncio sai no tom da outra     │
 * │     marca, ele lê e refaz. Não é preço, não é irreversível, não é        │
 * │     silencioso;                                                          │
 * │  3. é `created_at` e não `updated_at` de propósito: corrigir um erro de  │
 * │     digitação numa marca antiga não pode roubar o posto da atual.        │
 * │                                                                          │
 * │ ONDE A ESCOLHA PRECISA SER DELE — o link público, que fica no ar para os │
 * │ clientes dele — a regra é OUTRA: lá é opt-in explícito (`usar_marca` no  │
 * │ registro do link). Ver `controllers/public-quote.ts`.                    │
 * │                                                                          │
 * │ E SEM MARCA NENHUMA NÃO ACONTECE NADA: toda função aqui devolve vazio, e │
 * │ vazio é um caminho de primeira classe em todos os consumidores. Uma      │
 * │ ferramenta que falhasse por falta de marca cobraria o aluno para dizer   │
 * │ que ele não preencheu um cadastro de outra tela.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * O CONTÊINER da coleção — e ele deixou de ser uma ferramenta de propósito.
 *
 * A marca morava em `estudio_imagens`, e por isso herdava o ciclo de vida do
 * Ateliê: com aquela tool em `draft`, `loadPublishedToolDefinition` devolvia
 * 404 e TODO endpoint de coleção morria antes de tocar o banco — só a allowlist
 * de preview conseguia cadastrar marca. Arquivar ou renomear o Ateliê levaria
 * junto o cadastro de identidade de todo mundo.
 *
 * Agora o dono é `perfil`: uma definition `native_v1` sem pipeline e sem
 * `billing`, cuja única razão de existir é hospedar esta coleção (upvox,
 * `scripts/seed-perfil.ts`; a declaração dos campos está em
 * `scripts/colecao-marca.ts`). A tela dela é uma seção de `/course/perfil`.
 *
 * ┌─ COMO OUTRA FERRAMENTA LÊ A MARCA — não copie campo nenhum ─────────────┐
 * │ NO PIPELINE (definition, upvox): use o helper `noDaMarca()` de           │
 * │ `scripts/colecao-marca.ts`, que já monta                                 │
 * │   { block:'collection.query', params:{ tool:'perfil', collection:'marca',│
 * │     mine:true, optional:true, sort:'recent', limit:50 } }                │
 * │ e passe `marca: '<no>.json'` ao bloco que consome.                       │
 * │                                                                          │
 * │ NO SERVIDOR (main API): `escolherMarca()` + `varsDaMarca()` /            │
 * │ `visualDaMarca()`, deste arquivo. É aqui que mora a REGRA de qual marca  │
 * │ vale (o campo `principal`, e sem ele a mais recente) — nunca reimplemente │
 * │ a escolha no consumidor.                                                 │
 * │                                                                          │
 * │ SEM PASSAR PELA DEFINITION (link público, cron, qualquer coisa que rode  │
 * │ sem a definition carregada): vá direto ao repositório com `CONFIG_VAZIA`,│
 * │ como `repositories/public-quote.ts findMarca` faz. Esse caminho nunca    │
 * │ dependeu do status da tool.                                              │
 * │                                                                          │
 * │ NA TELA: `useMarcaAtiva()` / `useMarcaDisponivel()`                      │
 * │ (`profissao_laser/src/modules/tools/hooks/use-marca.ts`).                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * As duas constantes precisam casar com `MARCA_TOOL_KEY`/`MARCA_COLLECTION` do
 * front e com as do seed no upvox. São TRÊS lugares, um por repositório, e
 * nenhum deles adivinha o outro: mudar um só faz o cadastro parar de responder
 * sem erro nenhum.
 */
export const MARCA_TOOL = 'perfil';
export const MARCA_COLECAO = 'marca';

/**
 * Tetos de tamanho. O conteúdo é texto LIVRE do aluno e vai para dentro de um
 * prompt pago: sem teto, um `nao_usar` colado de um documento de 40 KB entra
 * inteiro no pedido do Redator e come o `max_tokens` dele antes da primeira
 * chave do JSON — o mesmo modo de falha que já derrubou especialista aqui.
 */
const MAX_CAMPO = 220;
const MAX_RESUMO = 700;

/** Um registro de marca já achatado (sem o envelope do repositório). */
export type Marca = Record<string, unknown>;

function txt(v: unknown, max = MAX_CAMPO): string {
	if (typeof v === 'number') return String(v);
	if (typeof v !== 'string') return '';
	// Uma linha só: o texto entra em `pergunta`, e `interpolar` (agents.ts)
	// colapsa espaço de qualquer jeito. Fazer isso aqui deixa o teto de
	// caracteres significar o que ele parece significar.
	const limpo = v.replace(/\s+/g, ' ').trim();
	return limpo.length > max ? `${limpo.slice(0, max - 1).trimEnd()}…` : limpo;
}

/**
 * Aceita as DUAS formas em que um registro chega:
 *  • achatado, como `collection.query` devolve (`{id, title, ...data}`);
 *  • cru, como o repositório devolve (`CollectionEntry`, com `data` dentro).
 *
 * `created_at` é preservado quando existe — é o desempate da regra de escolha.
 * (No caminho achatado ele não vem, e aí a ordem da consulta é quem manda.)
 */
function achatar(item: unknown): Marca | null {
	if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
	const o = item as Record<string, unknown>;
	const interno = o.data;
	const campos =
		interno && typeof interno === 'object' && !Array.isArray(interno)
			? (interno as Record<string, unknown>)
			: o;
	return typeof o.created_at === 'string'
		? { ...campos, created_at: o.created_at }
		: { ...campos };
}

/** Os campos que fazem um registro ser uma marca de verdade, e não uma linha em branco. */
const CAMPOS_UTEIS = [
	'nome',
	'tom_de_voz',
	'publico',
	'nao_usar',
	'cor_primaria',
	'cor_secundaria',
	'cor_fundo',
	'fonte',
	'logo_url',
] as const;

function temConteudo(m: Marca): boolean {
	return CAMPOS_UTEIS.some((c) => txt(m[c]).length > 0);
}

/**
 * A marca a usar, ou `null`.
 *
 * Aceita o array de `collection.query` (ou a string JSON equivalente, porque o
 * motor às vezes entrega uma e às vezes a outra — a mesma tolerância que
 * `categorias` já precisou ter em `ai.research_team`).
 *
 * Registro em branco é DESCARTADO antes da escolha: um cadastro aberto e
 * abandonado não pode virar "a marca mais recente" e apagar a que está pronta.
 */
export function escolherMarca(entrada: unknown): Marca | null {
	const bruto: unknown[] = Array.isArray(entrada)
		? entrada
		: typeof entrada === 'string' && entrada.trim()
			? (() => {
					try {
						const p = JSON.parse(entrada);
						return Array.isArray(p) ? p : [p];
					} catch {
						return [];
					}
				})()
			: entrada && typeof entrada === 'object'
				? [entrada]
				: [];

	const marcas = bruto
		.map(achatar)
		.filter((m): m is Marca => m !== null && temConteudo(m));
	if (marcas.length === 0) return null;
	if (marcas.length === 1) return marcas[0] as Marca;

	/**
	 * A MARCADA COMO PRINCIPAL GANHA — e ela existe por causa de uma mentira.
	 *
	 * A tela de "Minha marca" mostra um selo "EM USO" na marca que o aluno
	 * escolheu, e essa escolha morava só no `localStorage` do navegador. O
	 * servidor nunca a enxergava: lia sempre a mais recente. Um aluno com duas
	 * marcas escolhia a antiga, via o selo, e recebia a arte com a outra —
	 * sem erro, sem log e sem como desconfiar.
	 *
	 * `principal` é um campo da própria coleção, então a escolha atravessa para
	 * qualquer consumidor: o time da Central, o link público do Orçamento e o
	 * que vier depois. Empate (nenhuma marcada, ou mais de uma por corrida de
	 * edição) cai na regra antiga — a mais recente.
	 */
	const principais = marcas.filter((m) => ehPrincipal(m));
	const candidatas = principais.length > 0 ? principais : marcas;

	/**
	 * Ordena por `created_at` desc QUANDO ele existe. Quando não existe (caminho
	 * achatado do `collection.query`), `sort` estável do V8 preserva a ordem que
	 * a consulta pediu — que é `recent`. Nos dois casos o primeiro é o mais novo.
	 */
	return (
		[...candidatas].sort((a, b) =>
			String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
		)[0] ?? null
	);
}

/**
 * O booleano do jsonb, que chega como `true`, `'true'` ou `1` dependendo de
 * quem gravou (tela, seed ou `collection.save`). `Boolean('false')` é `true`,
 * então a comparação é explícita.
 */
function ehPrincipal(m: Marca): boolean {
	const v = (m as Record<string, unknown>).principal;
	return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * O briefing que o modelo lê — UMA LINHA, em português, sem nome de campo.
 *
 * Não é JSON de propósito: quem consome é um redator, e `PROSA_PARA_GENTE`
 * (seed-agentes.ts) proíbe o modelo de falar em campo e chave justamente
 * porque essa linguagem vaza para o texto que o aluno lê. Mandar o briefing
 * como `{"tom_de_voz":"divertido"}` é convidar a resposta a citar
 * `tom_de_voz`.
 *
 * Devolve `''` quando não há marca — e `''` some do template sem deixar
 * buraco (ver `interpolar`).
 */
export function resumoDaMarca(m: Marca | null): string {
	if (!m) return '';
	const partes: string[] = [];
	const nome = txt(m.nome);
	if (nome) partes.push(`empresa "${nome}"`);
	// Hoje a enum guarda a frase pronta ("Divertido e descontraído") e o
	// `replace` não faz nada. Ele existe para o dia em que ela virar slug: é a
	// única normalização que serve a QUALQUER lista de opções. Um MAPA de
	// rótulos aqui seria cópia da enum da outra tool — e cópia que ninguém
	// confere apodrece em silêncio.
	const tom = txt(m.tom_de_voz).replace(/_/g, ' ');
	if (tom) partes.push(`tom de voz ${tom}`);
	const publico = txt(m.publico);
	if (publico) partes.push(`fala com ${publico}`);
	const cores = [m.cor_primaria, m.cor_secundaria, m.cor_fundo]
		.map((c) => txt(c, 32))
		.filter(Boolean);
	if (cores.length) partes.push(`cores da marca ${cores.join(', ')}`);
	const fonte = txt(m.fonte, 60);
	if (fonte) partes.push(`fonte ${fonte}`);
	/**
	 * `nao_usar` é o ÚLTIMO e é o que mais segura o modelo: dizer o que a marca
	 * NÃO é corta mais espaço de resposta do que qualquer adjetivo positivo.
	 * Vai em caixa alta porque é a única parte do briefing que é proibição.
	 */
	const naoUsar = txt(m.nao_usar);
	if (naoUsar) partes.push(`NUNCA use: ${naoUsar}`);

	if (partes.length === 0) return '';
	return `A MARCA DE QUEM VAI PUBLICAR — ${partes.join('; ')}.`.slice(
		0,
		MAX_RESUMO,
	);
}

/**
 * As variáveis de template do time de agentes.
 *
 * Chaves TODAS prefixadas por `marca`: `interpolar` troca `{chave}` por
 * `vars[chave]`, e o mesmo objeto carrega `produto`, `categoria`, `material` e
 * `uf` vindos da visão. Prefixo é o que garante que nada aqui possa sombrear
 * uma variável de pesquisa.
 *
 * Sem marca devolve `{}` — e aí `{marca}` no template some junto com a
 * preposição que o introduzia, sem deixar `{marca}` cru no prompt.
 */
export function varsDaMarca(m: Marca | null): Record<string, string> {
	if (!m) return {};
	const out: Record<string, string> = {};
	const resumo = resumoDaMarca(m);
	if (resumo) out.marca = resumo;
	const nome = txt(m.nome);
	if (nome) out.marca_nome = nome;
	const tom = txt(m.tom_de_voz).replace(/_/g, ' ');
	if (tom) out.marca_tom = tom;
	const publico = txt(m.publico);
	if (publico) out.marca_publico = publico;
	const naoUsar = txt(m.nao_usar);
	if (naoUsar) out.marca_nao_usar = naoUsar;
	return out;
}

/**
 * A parte VISUAL da marca — o que uma página renderiza, não o que um modelo lê.
 *
 * `cor` é a PRIMÁRIA: no link público o campo se chama "cor de destaque", que é
 * o papel da cor primária de uma identidade. Secundária e fundo não têm onde
 * entrar hoje na página pública, e inventar um lugar para elas mudaria o
 * desenho de um link que já está no ar.
 *
 * Devolve strings CRUAS. Quem renderiza é que higieniza (`saneiaUrl`,
 * `saneiaTexto` em `lib/public-quote.ts`): a marca é escrita pelo dono do link,
 * mas quem a lê é o cliente final dele, numa página no nosso domínio.
 */
export function visualDaMarca(m: Marca | null): {
	logo_url: string;
	cor: string;
	nome: string;
} {
	if (!m) return { logo_url: '', cor: '', nome: '' };
	return {
		logo_url: txt(m.logo_url, 2000),
		cor: txt(m.cor_primaria, 32),
		// O NOME é o terceiro pedaço da identidade, e sem ele uma proposta é um
		// papel sem remetente: o cliente final recebe um preço e não sabe de quem.
		// Logo é opcional (nem toda oficina tem um), nome não — quem cadastrou
		// marca cadastrou nome.
		nome: txt(m.nome, 120),
	};
}
