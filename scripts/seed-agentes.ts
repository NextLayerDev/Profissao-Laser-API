/**
 * Semeia o TIME DE ESPECIALISTAS da Central de Inteligência.
 *
 * Cada especialista é um registro em `agentes`, com `visibility:'staff'` — é o
 * que impede `GET /c/agentes` de entregar estes system prompts (que são o
 * produto) para qualquer aluno logado.
 *
 * DUAS DECISÕES DE PRODUTO ESTÃO CODIFICADAS AQUI:
 *
 * 1. São PROFISSIONAIS, não "agentes". Os nomes são cargos que existem numa
 *    consultoria de verdade (Analista de Precificação, Especialista em
 *    Marketplaces) e a frase que o aluno lê enquanto esperam é o que essa
 *    pessoa estaria fazendo. "Agente 3 processando" não vende nada;
 *    "Comparando comissão de Shopee, Mercado Livre e Amazon" vende.
 *    A palavra também é proibida na PROSA que o modelo escreve — ela chegava à
 *    tela por lá, dentro do plano de 7 dias. Ver `COMO_CHAMAR_O_TIME`.
 *
 * 2. `escopo` separa duas perguntas que exigem times diferentes:
 *      produto — "tenho esta peça: vale a pena?"
 *      mercado — "quero vender neste ramo: o que faço e onde?"
 *    Quem levanta o preço de UMA peça não é quem descobre O QUE vender num ramo.
 *
 * O time é EDITÁVEL PELA TELA: trocar modelo, apertar buscas, reescrever o
 * papel ou desligar quem traz lixo é edição de admin, sem deploy.
 *
 * ┌─ O TAMANHO DO TIME É PROMESSA DE TELA: 5 NO RÁPIDO, 22 NO PROFUNDO ──────┐
 * │ A sala de guerra mostra o time inteiro trabalhando, e o combinado com o  │
 * │ dono do produto é EXATO: 5 cartões no rápido e 22 no profundo, nos DOIS  │
 * │ escopos. `selecionarAgentes` tem o teto, mas o teto é rede de segurança: │
 * │ quem faz a conta fechar é este arquivo. Hoje cada combinação cai         │
 * │ exatamente no número, e ninguém é cortado em silêncio.                   │
 * │                                                                          │
 * │ O RÁPIDO NÃO MUDOU e não deve mudar: "o modo rápido já está entregando   │
 * │ bom resultado" foi o veredito do dono do produto. Quem cresceu foi o     │
 * │ PROFUNDO — "quero que eleve o nível ali do profundo", "lance mais        │
 * │ agentes, mais coisas, cobre mais boxes, pode demorar mais tempo".        │
 * │                                                                          │
 * │ produto+rápido  ( 5): preco_mercado, demanda, margem, concorrencia,      │
 * │                       estrategista                                       │
 * │ produto+profundo(22): + marketplaces, tendencias, publico, sazonalidade  │
 * │                       (onda 1) + os DEZ da onda 2 + riscos, redator,     │
 * │                       auditor                                            │
 * │ mercado+rápido  ( 5): radar_oportunidades, brechas, margem, curadoria,   │
 * │                       estrategista                                       │
 * │ mercado+profundo(22): + marketplaces, tendencias, publico, sazonalidade  │
 * │                       (onda 1) + os DEZ da onda 2 + riscos, redator,     │
 * │                       auditor                                            │
 * │                                                                          │
 * │ Ou seja: MEXER EM `modo` OU `escopo` DE UM ESPECIALISTA MUDA A CONTA.    │
 * │ Quem trocar um dos dois tem que refazer as quatro linhas acima — senão   │
 * │ a tela promete 22 profissionais e entrega 21, ou o teto corta alguém     │
 * │ pela `ordem` sem avisar ninguém. `conferirTamanhoDoTime()` roda ANTES da │
 * │ rede e imprime a conta das quatro combinações, agora quebrada por onda.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ TRÊS ONDAS, E A DO MEIO É A QUE FALTAVA ────────────────────────────────┐
 * │ `fase` diz em que onda o especialista trabalha:                          │
 * │                                                                          │
 * │  descoberta      varre o ramo/produto sabendo só o que o aluno mandou.   │
 * │  aprofundamento  RECEBE o digest da onda 1 e PESQUISA DE NOVO, já        │
 * │                  sabendo QUAIS produtos e QUAIS lojas investigar.        │
 * │  sintese         recebe o digest das ondas 1 e 2 e escreve o dossiê.     │
 * │                                                                          │
 * │ A onda 2 existe por um defeito MEDIDO em "brindes corporativos": o       │
 * │ Analista de Margem procurava insumo de COPO TÉRMICO enquanto o Radar     │
 * │ achava ACRÍLICO e MDF — os dois corriam juntos e nenhum via o que o      │
 * │ outro tinha achado, e todo card de "Comece por estes produtos" saía com  │
 * │ "não apurado". Investigar CONCORRENTE, PORTFÓLIO, RECLAMAÇÃO, FOTO ou    │
 * │ CUSTO exige saber ANTES quem e o quê: é dependência de dado, não é       │
 * │ paralelizável.                                                           │
 * │                                                                          │
 * │ CONSEQUÊNCIA PARA QUEM ESCREVE `pergunta` AQUI: o da onda 2 é DIFERENTE  │
 * │ do da onda 1 — a pergunta dele tem que mandar olhar o material com todas │
 * │ as letras ("Dos produtos listados no MATERIAL DO TIME abaixo…"). Sem     │
 * │ isso a onda 2 é a onda 1 repetida, mais cara e uma vez a mais.           │
 * │                                                                          │
 * │ E é "ABAIXO", não "acima": `rodarAgente` monta o prompt como             │
 * │ `pergunta` + "=== MATERIAL DO TIME ===" + digest + formato de saída. O   │
 * │ material vem DEPOIS da pergunta.                                         │
 * │                                                                          │
 * │ `'pesquisa'` é o valor ANTIGO gravado no banco e continua válido:        │
 * │ `normalizarFase` (agents.ts) mapeia para `descoberta`. Nenhuma linha de  │
 * │ banco precisou ser migrada.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ E MUDA MAIS DO QUE A CONTA: MUDA O QUE SOBRA NA TELA ───────────────────┐
 * │ O dossiê lê o time por CHAVE (`jsonDe('marketplaces')`, `BLOCOS_DO_TIME`)│
 * │ e o GATE DE CADA SEÇÃO É PRESENÇA DE RESPOSTA: se aquela chave voltou    │
 * │ com json, a seção é montada; se não voltou, ela some. NÃO é o modo e NÃO │
 * │ é o escopo — os dois gates existiram, os dois apagaram especialista pago │
 * │ (`modo === 'profundo'` matava `demanda` e `concorrencia` no caminho      │
 * │ padrão; `tipo === 'mercado'` matava `marketplaces` em produto+profundo,  │
 * │ que é `escopo: 'ambos'`) e os dois foram removidos. Tirar um             │
 * │ especialista de uma combinação continua apagando em silêncio a seção que │
 * │ ele alimentava: nada quebra, nada loga, a seção não é montada.           │
 * │                                                                          │
 * │ QUEM ALIMENTA O QUÊ — PARTE 1, o que já estava em dossie.tsx antes desta │
 * │ rodada (conferido lá, uma linha por vez):                                │
 * │  preco_mercado, radar → "Preço de mercado", "Anúncios encontrados" e a   │
 * │        célula "Faixa de mercado". NÃO sai do json deles: sai de          │
 * │        `price_stats`/`observacoes`, que o BLOCO calcula das CITAÇÕES     │
 * │        (`price-stats.ts`) — por isso não têm chave em `BLOCOS_DO_TIME`.  │
 * │  radar_oportunidades → "O que está vendendo neste ramo" (`RamoECanais`)  │
 * │  brechas         → "Onde ainda falta gente vendendo bem" (`Brechas`)     │
 * │  marketplaces    → "Onde vender" (barras de comissão, dentro de          │
 * │        `RamoECanais`) E a célula "Comece por" do painel do topo          │
 * │        (`canalDeEntrada`, que cai em `estrategista.onde_comecar.canal`   │
 * │        quando ele não está no time)                                      │
 * │  margem          → "Quanto custa o material" (`CustoDoMaterial`) e, por  │
 * │        dentro, a "Sobra para você" dos cards: `custoComFonte` amarra o   │
 * │        `custo_peca_brl` à página citada antes de virar margem            │
 * │  curadoria       → "Comece por estes produtos", via                      │
 * │        `output.produtos_para_comecar` — calculado e ordenado em          │
 * │        TypeScript no bloco, não copiado do json                          │
 * │  concorrencia, tendencias, producao, riscos, demanda → `BLOCOS_DO_TIME`, │
 * │        na etapa "O que o time apurou" (um cartão por chave que voltou)   │
 * │  estrategista    → o herói (nota, veredito, `resumo_simples`), "Por que  │
 * │        esta nota", "Por quanto vender" e os "Próximos 7 dias"            │
 * │  redator         → "Anúncio pronto para publicar" (`CopyPronto`)         │
 * │  auditor         → "Ressalvas" (confiança geral e o que ficou sem fonte) │
 * │                                                                          │
 * │ QUEM ALIMENTA O QUÊ — PARTE 2, as seções que ESTA rodada abre. Cada      │
 * │ especialista novo entrou com um box combinado, um a um — e os nomes dos  │
 * │ CAMPOS de `saida` de cada um são contrato com o leitor dele em           │
 * │ dossie.tsx (`lerPublico`, `lerConcorrentes`, `lerCampeoes`, `lerGaleria`,│
 * │ `lerSazonalidade`, `lerTermos`, `lerReclamacoes`, `lerFrete`,            │
 * │ `lerFornecedores`, `CustoDoMaterial`), conferidos um a um. Campo com     │
 * │ outro nome não dá erro: some do card, e o especialista pago aparece com  │
 * │ metade da ficha em branco:                                               │
 * │  publico              → "Para quem vender"                               │
 * │  sazonalidade         → "O calendário do ano"                            │
 * │  concorrente_perfil   → "Quem são seus concorrentes" (loja, reputação,   │
 * │        nº de anúncios, nota, link)                                       │
 * │  concorrente_portfolio→ "O que eles mais vendem" (campeões por loja,     │
 * │        com preço e link)                                                 │
 * │  referencias_visuais  → "Galeria de referências" (junto com as fotos que │
 * │        o radar e o curador já traziam)                                   │
 * │  reclamacoes          → "Do que reclamam"                                │
 * │  palavras_chave       → "Como as pessoas procuram"                       │
 * │  frete_logistica      → "Quanto o frete come"                            │
 * │  fornecedores         → "Onde comprar a peça em branco"                  │
 * │  venda_direta         → "Quem compra em quantidade" — ⚠ ÚNICO BOX AINDA  │
 * │        NÃO MONTADO em dossie.tsx (grep pela chave lá: zero). É o 11º     │
 * │        especialista, o que fecha a conta de 22, e nasceu depois do       │
 * │        contrato da tela; enquanto o box não existir ele é pago e não é   │
 * │        lido. O leitor precisa de `compradores[]`. Ver o registro dele.   │
 * │  custo_dos_produtos   → "Quanto custa o material", O MESMO box do        │
 * │        `margem`: a saída dele tem a MESMA forma (`insumos[]` com `item`, │
 * │        `unidade_compra`, `preco_brl`, `rende_pecas`, `url`) porque quem  │
 * │        a lê é `custosDeInsumos` (oportunidade.ts), que divide em         │
 * │        TypeScript e só quando a página declara a contagem                │
 * │  producao             → "Como fazer" (já existia em `BLOCOS_DO_TIME`;    │
 * │        o que mudou é a onda, ver remanejamento 4)                        │
 * │                                                                          │
 * │ Ou seja: TODO ESPECIALISTA DAS QUATRO COMBINAÇÕES TEM ONDE APARECER —    │
 * │ e é ESTA lista que prova. O gate de cada seção do dossiê é PRESENÇA DE   │
 * │ RESPOSTA (`jsonDe('<chave>')`), nunca o modo e nunca o escopo: os dois   │
 * │ gates existiram, os dois apagaram especialista pago, os dois foram       │
 * │ removidos. Quem entrar com um especialista novo abre o ponto de render   │
 * │ dele JUNTO; a forma de conferir é grepar a chave em dossie.tsx. Sem      │
 * │ box, ele roda, é cobrado, anima na sala de guerra e não é lido — foi o   │
 * │ defeito que reprovou três rodadas seguidas.                              │
 * │                                                                          │
 * │ OS QUATRO REMANEJAMENTOS EM VIGOR (nenhum especialista foi apagado):     │
 * │ (1) `marketplaces` é `modo: 'profundo'` (era `ambos`) — não pelo custo   │
 * │     de busca (desde que a reserva é por CHAMADA ele custa uma como       │
 * │     qualquer outro), mas pelo tamanho do time: repô-lo no rápido daria 6 │
 * │     e quebraria a promessa de 5. A pergunta dele ("em qual canal eu      │
 * │     começo?") o Estrategista responde em `onde_comecar` nas quatro.      │
 * │ (2) `concorrencia` é `escopo: 'produto'` (era `ambos`) — no escopo       │
 * │     mercado quem faz esse trabalho é o `brechas`, que procura a mesma    │
 * │     coisa (anúncio fraco, reclamação recorrente) e já devolve a vaga     │
 * │     aberta em vez do panorama. Manter os dois era pagar duas buscas pela │
 * │     mesma resposta.                                                      │
 * │ (3) `tendencias` voltou a ser `escopo: 'ambos'` (estava `mercado`) e     │
 * │     `producao` passou a ser `escopo: 'ambos'` (estava `produto`). O      │
 * │     motivo do corte de cada um era DISPUTA DE VAGA num time de 10 — e    │
 * │     essa disputa acabou em 22. Não é enfeite de conta: os dois são os    │
 * │     ÚNICOS dois remanejamentos possíveis (todo o resto do roster ou já é │
 * │     `ambos`, ou é um dos cinco do rápido, que é intocável), e sem eles a │
 * │     conta de 22×2 exigiria inventar DOIS especialistas sem box em vez de │
 * │     um. "O que está subindo" serve a quem já tem a peça (é para onde ele │
 * │     pivota), e "como se fabrica" serve a quem escolheu o ramo — ainda    │
 * │     mais na onda 2, onde `producao` responde sobre os produtos que a     │
 * │     onda 1 de fato achou, em vez de sobre um ramo em abstrato.           │
 * │ (4) `producao` e `riscos` mudaram de ONDA (`aprofundamento` e `sintese`, │
 * │     os dois eram onda 1). Nenhum dos dois pesquisa: rodar na onda 1 era  │
 * │     desperdiçar o único trunfo deles, que é LER o que os outros acharam. │
 * │     `riscos` na síntese passa a poder falar de margem depois do frete    │
 * │     COM o número que `frete_logistica` trouxe — que é literalmente o que │
 * │     o papel dele sempre mandou considerar e ele nunca teve.              │
 * │                                                                          │
 * │ E A PROMESSA QUE O ALUNO LÊ MORA EM OUTRO LUGAR: `ui.modos` na           │
 * │ definition (banco da upvox) escreve no cartão o que cada modo entrega —  │
 * │ "Comparação dos canais: comissão, público e por onde começar" é uma      │
 * │ frase de lá. O cartão não sabe nada deste roster: se um especialista sai │
 * │ de uma combinação, a frase continua prometendo.                          │
 * │                                                                          │
 * │ REGRA daqui para a frente: mudou `modo`/`escopo`/`fase` de alguém, rode  │
 * │ o seed e leia o relatório de `conferirTamanhoDoTime()` — ele imprime,    │
 * │ por combinação, quem entrou e em que onda —, confira a lista acima e     │
 * │ releia o cartão do modo na definition.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A MARCA DO ALUNO ENTRA POR `{marca}` NA PERGUNTA ───────────────────────┐
 * │ Hoje só o REDATOR DE ANÚNCIOS a usa. A identidade da empresa (nome, tom  │
 * │ de voz, público, o que ela nunca usa) é cadastrada UMA vez na coleção    │
 * │ `marca` do Estúdio de Imagens, lida pelo pipeline da Central             │
 * │ (`collection.query` em `estudio_imagens/marca`, `mine` + `optional`) e   │
 * │ fundida pelo bloco no mesmo saco de variáveis de `{produto}`.            │
 * │                                                                          │
 * │ Colocar `{marca}` na `pergunta` de mais alguém é uma edição de DADO — e  │
 * │ tem duas condições que `conferirMarca()` cobra antes da rede:            │
 * │ `compartilhavel: false` (o cache de 7 dias é compartilhado entre alunos) │
 * │ e `motor_busca: 'nenhum'` (a pergunta de quem pesquisa vira consulta).   │
 * │ Aluno sem marca não muda nada: o token some da pergunta.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 *   SEED_STAFF_ID=<id> npx tsx scripts/seed-agentes.ts
 */
import 'dotenv/config';
/**
 * O teto de busca de cada modo vem do MOTOR, não de uma cópia aqui.
 *
 * O roster e o orçamento são dois arquivos que precisam concordar e não têm
 * nada que os obrigue a isso: o roster define QUANTOS especialistas pesquisam
 * em cada combinação, o orçamento diz quantas chamadas com busca cabem. Na
 * rodada passada eles discordaram — na unidade de então, "vagas" (Σ
 * `max_buscas`): 6 declaradas contra 5 permitidas — e o resultado foi um
 * especialista rodando cego em 100% das execuções `mercado+rápido`, sem uma
 * linha de erro. Importar a constante é o que faz o seed conseguir CONFERIR em
 * vez de supor; conferir na unidade CERTA é o que o faz acertar o alvo (ver
 * `quemRodaCego`).
 */
import {
	type FaseAgente,
	MAX_TOKENS_TETO,
	ORDEM_DAS_ONDAS,
	TETO_POR_MODO,
} from '../src/lib/research/agents.js';
import { LIMITES_PADRAO } from '../src/lib/research/budget.js';

/**
 * O MESMO argumento vale para a promessa de tela e para a ordem das ondas.
 *
 * `TETO_POR_MODO` é o teto que o MOTOR aplica (`montarTime`); `TAMANHO_DO_TIME`
 * é o que este arquivo promete. Eram dois números iguais em dois arquivos, sem
 * nada que os obrigasse a continuar iguais — e teto menor que roster não
 * quebra nada: corta o último da `ordem` em silêncio, que é como a tela um dia
 * anunciou "1/3 PROFISSIONAIS". Agora divergir é erro fatal do seed.
 *
 * `ORDEM_DAS_ONDAS` é a ordem em que o bloco despacha as fases. `quemRodaCego`
 * simula a reserva de busca NA ORDEM DO DESPACHO para acertar QUEM fica sem
 * busca quando o teto estoura — reproduzir essa ordem de cabeça é como a
 * simulação anterior acusou um inocente.
 */
const TOOL = 'central_inteligencia';
const BASE = process.env.SEED_API_URL ?? 'http://localhost:3333';
const STAFF_ID = process.env.SEED_STAFF_ID ?? '';
const BEARER = process.env.SEED_BEARER ?? '';

/** Os quatro canais que o público de fato usa hoje no Brasil. */
const MARKETPLACES =
	'mercadolivre.com.br, shopee.com.br, amazon.com.br, tiktok.com';

/**
 * Preâmbulo de todo especialista que vai à web.
 *
 * A regra anti-invenção NÃO é gentileza de prompt: o bloco DESCARTA no código
 * toda observação de preço sem URL. O texto existe para o modelo não gastar
 * token produzindo o que vai ser jogado fora de qualquer jeito.
 */
/**
 * ┌─ O CAMPO É CONTRATO; A FRASE É PARA UMA PESSOA ──────────────────────────┐
 * │ `ANTI_INVENCAO` manda devolver `null` quando não achou, e isso está       │
 * │ CERTO: `null` é o contrato, e é o que impede a tela de transformar        │
 * │ ausência em zero. O defeito é o modelo levar essa palavra para o TEXTO    │
 * │ CORRIDO, que a tela imprime verbatim.                                     │
 * │                                                                          │
 * │ REPRODUZIDO no HTML renderizado de 3 de 6 runs profundos e 1 rápido:      │
 * │   "Por isso, `custo_estimado_brl` está `null` em todos os produtos"       │
 * │   "Onde o valor não estava explícito, foi retornado null."                │
 * │ O aluno comprou um time de profissionais e leu o nome de uma coluna de    │
 * │ banco e um literal de programação no meio do dossiê que pagou.            │
 * │                                                                          │
 * │ A TELA NÃO TEM COMO CONSERTAR ISSO. Ela já normaliza o token quando ele   │
 * │ chega em CAMPO (`ausencia`/`SEM_DADO` em dossie.tsx); reescrever PROSA    │
 * │ seria adivinhar o que a frase queria dizer. O único lugar onde isso se    │
 * │ conserta é aqui — mesmo argumento, e mesmo remédio, de                    │
 * │ `COMO_CHAMAR_O_TIME`.                                                     │
 * │                                                                          │
 * │ Vai para os 25: quem tem `ANTI_INVENCAO` recebe por dentro dele; os seis  │
 * │ da síntese, que não têm, citam esta constante direto no `papel`.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const PROSA_PARA_GENTE = [
	'Todo texto corrido que você escrever (`observacao`, `nota_final`, e qualquer campo que seja frase) é lido por uma PESSOA na tela, não por um programa.',
	'Nele é PROIBIDO citar nome de campo, escrever "null", "JSON", "array", "campo", "chave" ou falar do formato da resposta.',
	/**
	 * A VERSÃO TRADUZIDA ESCAPAVA, e é ela que sobrou nos runs medidos.
	 *
	 * Com "null" e "campo" proibidos em inglês, o modelo obedece a letra e
	 * contorna o espírito: "por isso o campo consta como nulo" (Analista de
	 * Venda Direta, run `produto-profundo-B`). Para quem lê é a MESMA frase de
	 * máquina. Proibir a palavra não basta — o que se proíbe é falar do
	 * preenchimento da resposta, em qualquer idioma.
	 */
	'Isso vale igual em português: nada de "nulo", "nula", "não preenchido", "consta vazio", "não foi informado no formato" nem de explicar o que ficou sem preencher.',
	'Diga a mesma coisa em português: em vez de "custo_estimado_brl está null", escreva "não encontrei o preço da peça em branco em nenhuma página que eu pudesse citar".',
	'E em vez de "o campo consta como nulo", escreva "não achei esse número em nenhuma página que eu pudesse citar".',
].join(' ');

/**
 * ┌─ O MODELO NÃO DESOBEDECE: ELE COMPLETA O PADRÃO ─────────────────────────┐
 * │ `ANTI_INVENCAO` fala de NÚMERO ("só afirme um número que apareça          │
 * │ literalmente"). O ENDEREÇO passava por fora, e o endereço é o campo mais  │
 * │ fácil de completar por padrão que existe: pedir "o link do anúncio" a     │
 * │ quem só alcançou uma página de listagem produz                            │
 * │ `shopee.com.br/…-i.34567890.1234567890` e `MLB-1234567890` — id em        │
 * │ sequência, forma impecável, 404 garantido.                                │
 * │                                                                          │
 * │ MEDIDO no último run frio de mercado ("brindes corporativos"): o Curador  │
 * │ de Imagens tinha 109 citações reais na mão e devolveu seis páginas, das   │
 * │ quais UMA existia. O Analista de Vitrine devolveu quatro, duas delas      │
 * │ apontando para a mesma página de LISTA do Mercado Livre.                  │
 * │                                                                          │
 * │ O motor já derruba isso (`semLinkInventado` confere contra as citações do │
 * │ run), e é o mecanismo que garante. Esta constante é o conserto na ORIGEM: │
 * │ sem ela o modelo continua gastando token para produzir o que vai ser      │
 * │ jogado fora, e as seções chegam à tela pela metade sem ninguém entender   │
 * │ por quê. Dizer que VAZIO É A RESPOSTA CERTA é o que muda o comportamento  │
 * │ — o Radar, que já recebe essa ordem, devolveu 6 de 7 produtos com o campo │
 * │ vazio em vez de 6 endereços fabricados.                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const LINK_SO_DE_PAGINA_ABERTA = [
	'ENDEREÇO SÓ DE PÁGINA QUE VOCÊ ABRIU: só escreva um link que esteja EXATAMENTE como apareceu nos resultados da sua busca ou no material do time.',
	'NUNCA monte um endereço a partir de um código de anúncio, de um id ou do nome do produto — um link que você deduziu abre em erro, e quem lê clica nele.',
	'DEIXAR O CAMPO VAZIO É A RESPOSTA CERTA quando você não alcançou a página: o item com nome e sem link vale mais que um link inventado.',
].join(' ');

/**
 * O preâmbulo que todo especialista recebe. `LINK_SO_DE_PAGINA_ABERTA` entra
 * AQUI, e não especialista a especialista, pelo mesmo motivo que a regra do
 * número entrou: ela vale para os 25, e enumerar quem a recebe é combinar de
 * esquecer o próximo. Vale inclusive para quem não pesquisa — ter material do
 * time não faz do que ele digita uma citação.
 */
const ANTI_INVENCAO = [
	'REGRA INEGOCIÁVEL: só afirme um número que apareça LITERALMENTE numa das páginas que você citou.',
	'Se não achou, devolva null NO CAMPO e explique em `observacao` o que faltou.',
	'Quem lê vai precificar um trabalho de verdade em cima disso — prefira "não achei" a um número plausível.',
	LINK_SO_DE_PAGINA_ABERTA,
	PROSA_PARA_GENTE,
	'Escreva em português do Brasil, direto, sem jargão de consultoria. Responda só JSON.',
].join(' ');

/**
 * A PALAVRA "AGENTE" É BANIDA DA TELA DO ALUNO — e o prompt é o único lugar
 * onde isso se conserta.
 *
 * O aluno compra "um time de profissionais", e a decisão nº 1 lá em cima diz
 * isso com todas as letras. Mas a proibição valia só para o que o CÓDIGO
 * escreve: a prosa que o modelo devolve vai para a tela como veio. Reproduzido
 * numa saída real, no dia 2 do `plano_7_dias` do Estrategista — a seção mais
 * acionável do dossiê: "Pedir a faixa de preço de mercado já calculada pelo
 * agente responsável". Nenhum dos papéis proibia a palavra.
 *
 * Sanitizar no front foi descartado com razão: trocar "agente" por outra
 * palavra na prosa corromperia "agente desmoldante" e "agente de limpeza", que
 * são produto de bancada e aparecem legitimamente num dossiê de laser. Por isso
 * a regra vive aqui, onde é DADO editável pela tela de coleção, sem deploy.
 *
 * Vai para quem tem motivo de falar dos colegas: TODO ESPECIALISTA QUE RECEBE O
 * MATERIAL DO TIME no prompt — hoje as ondas `aprofundamento` e `sintese`, não
 * mais só a síntese. Foi o que mudou com a onda 2: ela lê o digest e escreve
 * `observacao` em prosa, que chega à tela igualzinho ao plano de 7 dias onde a
 * palavra escapou. Quem é da onda 1 não vê o trabalho de ninguém e não gasta
 * token com uma proibição que não tem como violar.
 */
const COMO_CHAMAR_O_TIME = [
	'Quem levantou as informações são PROFISSIONAIS de um time — nunca escreva "agente", "IA", "bot" ou "sistema" para se referir a eles.',
	'Cite pelo cargo ("o Analista de Precificação levantou…") ou fale de "o time"; se preferir, escreva a informação direto, sem dizer quem trouxe.',
	'A palavra "agente" só é permitida no sentido químico do produto — "agente desmoldante", "agente de limpeza" —, nunca para pessoa ou etapa deste trabalho.',
].join(' ');

/** Como falar com o público: dono de máquina que quer vender, não analista. */
const TOM = [
	'Quem vai ler é um pequeno produtor que tem uma máquina a laser e quer VENDER.',
	'Fale como quem dá conselho prático, não como quem entrega relatório.',
	'Nada de "sinergia", "player" ou "ecossistema". Diga o que fazer.',
].join(' ');

/**
 * ┌─ QUANDO O PEDIDO TRAZ A IDENTIDADE DA EMPRESA DO ALUNO ──────────────────┐
 * │ A marca é cadastrada UMA vez (coleção `marca` do Estúdio de Imagens) e   │
 * │ chega aqui pela variável `{marca}` da `pergunta` — ver `varsDaMarca` em  │
 * │ src/lib/marca.ts. Sem ela, o especialista escrevia um anúncio para uma   │
 * │ empresa genérica: correto, publicável e igual ao de qualquer outro aluno.│
 * │                                                                          │
 * │ TRÊS ORDENS, E CADA UMA CONSERTA UM JEITO DIFERENTE DE ERRAR:            │
 * │                                                                          │
 * │ 1. A IDENTIDADE MANDA NO TOM. Sem dizer isso, o modelo lê o briefing     │
 * │    como contexto de fundo e continua escrevendo do jeito dele — a        │
 * │    informação chega e não muda nada, que é o pior resultado possível:    │
 * │    custa token e parece que funcionou.                                   │
 * │                                                                          │
 * │ 2. COR E FONTE NÃO SÃO ASSUNTO DO ANÚNCIO. Elas vão no briefing porque   │
 * │    orientam QUE FOTO TIRAR (fundo, prop, acabamento). Sem esta linha, o  │
 * │    modelo escreve "na cor #ff5500 da nossa marca" dentro da legenda do   │
 * │    Instagram — é o mesmo defeito de `PROSA_PARA_GENTE`, com hexadecimal  │
 * │    no lugar de `null`.                                                   │
 * │                                                                          │
 * │ 3. SEM IDENTIDADE, NÃO INVENTE UMA. É o caminho de quem ainda não        │
 * │    cadastrou marca — a maioria, no primeiro dia. Um modelo que recebe    │
 * │    "escreva o anúncio DESTA empresa" e não recebe empresa nenhuma        │
 * │    inventa um nome e um slogan, e o aluno publica o anúncio de uma       │
 * │    empresa que não existe.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const USANDO_A_MARCA = [
	'Quando o pedido trouxer A MARCA DE QUEM VAI PUBLICAR, ela MANDA: escreva no tom de voz dela, fale com o público dela e não escreva nada que esteja na lista do que ela nunca usa.',
	'Se o tom da marca e o seu jeito habitual discordarem, vence o da marca.',
	'As cores e a fonte da marca NÃO entram no texto do anúncio — elas servem só para dizer que fotos tirar (fundo, cenário, acabamento). Nunca escreva código de cor nem nome de fonte no que a pessoa vai publicar.',
	'Se o pedido NÃO trouxer marca nenhuma, escreva no tom neutro de sempre e NUNCA invente nome de empresa, slogan, cor ou assinatura.',
].join(' ');

interface Especialista {
	chave: string;
	nome: string;
	papel: string;
	pergunta: string;
	saida: string;
	modelo: string;
	motor_busca: 'nenhum' | 'exa' | 'perplexity';
	max_buscas: number;
	dominios_incluir?: string;
	modo: 'rapido' | 'profundo' | 'ambos';
	escopo: 'produto' | 'mercado' | 'ambos';
	compartilhavel: boolean;
	essencial: boolean;
	icone: string;
	cor: string;
	frase_trabalhando: string;
	ordem: number;
	/**
	 * Ausente = `descoberta` (onda 1), que é o padrão de `normalizarFase` — e
	 * mesmo assim TODOS os 25 registros declaram a fase, de propósito.
	 *
	 * Confirmado relendo a coleção depois de semear: `fase` é FACETA na tela de
	 * coleção, e o banco tinha a mesma onda escrita de três jeitos — três
	 * registros com o nome antigo (`'pesquisa'`), sete sem nada e o resto com o
	 * nome novo. Nenhum quebrava (o motor normaliza os três), mas "me mostre a
	 * onda 1" não tinha resposta pelo filtro, que é justamente o que o admin
	 * precisa perguntar num time de 22.
	 *
	 * O tipo vem do MOTOR (`FaseAgente`), não de uma cópia: escrever aqui uma
	 * fase que o motor não conhece cairia em `descoberta` sem uma linha de erro,
	 * e um especialista de onda 2 rodando na onda 1 é exatamente o defeito que a
	 * onda 2 existe para consertar — ele pesquisaria sem o material.
	 */
	fase?: FaseAgente;
	max_tokens?: number;
	timeout_s?: number;
	/**
	 * `false` para quem procura DE PROPÓSITO algo que não é o produto — comissão
	 * de marketplace, regra de canal, tendência. Sem isso o filtro de tema, que
	 * usa as palavras-chave do PRODUTO, descarta tudo que esse especialista
	 * achou: o Especialista em Marketplaces vinha com 0 fontes.
	 */
	filtrar_por_tema?: boolean;
}

/** Mais barato do catálogo que FUNCIONA com busca web (ver text-models-catalog). */
const M_BUSCA = 'google/gemini-3.1-flash-lite';
/** Quem escreve para o aluno ler: qualidade de texto vale mais que centavos. */
const M_ESCRITA = 'anthropic/claude-sonnet-5';
const M_REVISOR = 'anthropic/claude-haiku-4.5';
/** Quem responde do próprio conhecimento, sem busca. */
const M_INTERNO = 'google/gemini-3-flash-preview';

/**
 * ┌─ O MAIOR QUE CADA UM JÁ ESCREVEU, EM TOKENS DE SAÍDA MEDIDOS ────────────┐
 * │ Esta tabela é o único jeito de o `max_tokens` lá embaixo parar de ser     │
 * │ palpite. A rodada anterior declarou o teto nos 25 registros — o que era   │
 * │ verdade — mas calibrou pelo tamanho que a saída PARECIA ter, e dois       │
 * │ profissionais PAGOS morreram por JSON cortado em 2 de 3 runs frios de     │
 * │ `produto+profundo`: `publico` (teto 1.800) e `producao` (teto 1.400).     │
 * │                                                                          │
 * │ COMO CADA NÚMERO FOI OBTIDO, sem exceção:                                │
 * │  · 4 runs frios com CADA chamada atribuída ao dono dela (o `system`       │
 * │    começa verbatim com o `papel`), lendo `usage.completion_tokens`;       │
 * │  · mais os 8 runs frios gravados antes, onde o que existe é o JSON        │
 * │    ENTREGUE — convertido a 2,5 caracteres por token, o pior ratio         │
 * │    medido nos modelos de busca (a régua de 4 é para inglês; em JSON       │
 * │    português com acento e pontuação de estrutura ela mente para menos);   │
 * │  · e, nos dois que foram CORTADOS, o próprio teto em que morreram — um    │
 * │    teto batido é piso do que faltava, nunca do que bastava.               │
 * │                                                                          │
 * │ A REGRA É `teto = 2 × pico`, arredondado para cima em 200, e ela custa    │
 * │ ZERO: medido em 152 chamadas, Gemini Flash Lite e Flash não escrevem para │
 * │ preencher teto (usaram 13% a 68% do que tinham). Quem paga teto grande é  │
 * │ modelo que raciocina antes de escrever, e para esse a folga é justamente  │
 * │ o que compra o dossiê: o raciocínio é cobrado como saída e come o teto    │
 * │ ANTES da primeira chave do JSON.                                          │
 * │                                                                          │
 * │ `conferirTetos()` roda antes da rede e QUEBRA o seed se alguém baixar um  │
 * │ teto abaixo dessa conta — é mecanismo, não recado.                        │
 * │                                                                          │
 * │ MEDIU DE NOVO? Atualize o pico aqui e o teto lá embaixo na mesma edição.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const PICOS_MEDIDOS: Record<string, number> = {
	estrategista: 7278, // 4 runs: 3.105 · 3.509 · 4.590 · 7.278 (91% do teto de 8.000)
	curadoria: 2704, // JSON de 6.759 chars num mercado+profundo
	redator: 1836, // 4 runs: 1.188 a 1.836
	publico: 1800, // CORTADO no teto de 1.800 (3.540 chars de JSON quebrado)
	producao: 1684, // CORTADO no teto de 1.400, `finish_reason: length`, 4.208 chars
	radar_oportunidades: 1631,
	venda_direta: 1341,
	frete_logistica: 1330,
	referencias_visuais: 1227,
	concorrente_perfil: 1212,
	auditor: 1191,
	custo_dos_produtos: 1139,
	marketplaces: 1084,
	riscos: 971,
	concorrente_portfolio: 968,
	sazonalidade: 967,
	tendencias: 937,
	palavras_chave: 875,
	reclamacoes: 867,
	fornecedores: 806,
	brechas: 726,
	concorrencia: 703,
	preco_mercado: 650,
	demanda: 575,
	margem: 561,
};

const TIME: Especialista[] = [
	/* ═══ ONDA 1 — DESCOBERTA · quem só entra quando a pergunta é PRODUTO ═══ */
	{
		chave: 'preco_mercado',
		nome: 'Analista de Precificação',
		papel: `Você levanta por quanto o produto é vendido hoje no Brasil, em anúncios reais. ${ANTI_INVENCAO}`,
		pergunta:
			'Por quanto vendem hoje no Brasil: {produto} ({material})? Procure anúncios reais com preço em reais, em lojas e marketplaces brasileiros. Liste o máximo que encontrar. De CADA anúncio traga: título exato, preço, loja e o link da página daquele anúncio.',
		saida:
			'{"anuncios":[{"titulo":"","preco_brl":0,"loja":"","url":""}],"observacao":""}',
		modelo: M_BUSCA,
		motor_busca: 'exa',
		max_buscas: 1,
		modo: 'ambos',
		escopo: 'produto',
		compartilhavel: true,
		essencial: true,
		icone: 'tag',
		cor: '#f59e0b',
		frase_trabalhando: 'Levantando por quanto os concorrentes estão vendendo…',
		fase: 'descoberta',
		ordem: 10,
		/**
		 * DECLARADO, e o número saiu de medição: ele é quem chega mais perto do
		 * teto entre os que herdavam o padrão de 1.200 — 856 tokens num run frio
		 * de `produto+profundo` (71% do teto), porque a saída dele é a mais
		 * pesada de URL do roster: a pergunta manda listar "o máximo que
		 * encontrar" e cada anúncio carrega o endereço da página inteiro. (Ele
		 * trazia DOIS endereços por anúncio — a página e a foto —, e a foto saiu:
		 * ver "A FOTO NÃO SE PEDE" no topo. O teto ficou onde estava, com folga
		 * maior ainda.)
		 *
		 * E ele é `essencial`: JSON cortado aqui não é uma seção a menos, é 502 +
		 * estorno. 1.800 é o dobro do maior valor medido e custa ZERO — medido
		 * em 24 chamadas, o Gemini Flash Lite não escreve para preencher teto
		 * (mediana de 617 tokens com tetos de 1.200 a 2.400). Quem paga teto
		 * grande em modelo que enche é o Sonnet, não ele.
		 */
		max_tokens: 1800,
	},
	{
		chave: 'demanda',
		nome: 'Analista de Demanda',
		papel: `Você mede demanda por EVIDÊNCIA. Só afirme volume se o número aparecer literalmente ("+500 vendidos", "230 avaliações"). ${ANTI_INVENCAO}`,
		pergunta:
			'{produto} vende bem no Brasil? Procure em Mercado Livre, Shopee, Amazon e TikTok Shop anúncios deste produto e registre quantas unidades cada um mostra como vendidas, quantas avaliações e a nota. Diga também se há época do ano que puxa a venda.',
		saida:
			'{"evidencias":[{"titulo":"","marketplace":"","vendidos":null,"avaliacoes":null,"nota":null,"url":""}],"sinal":"forte|medio|fraco|indisponivel","epoca_forte":"","observacao":""}',
		modelo: M_BUSCA,
		// `perplexity` é busca de verdade e acerta marketplace; `exa` é semântica
		// e, restrita a domínio, devolveu cooler de PC numa busca por placa de PIX.
		motor_busca: 'perplexity',
		max_buscas: 1,
		dominios_incluir: MARKETPLACES,
		modo: 'ambos',
		escopo: 'produto',
		compartilhavel: true,
		essencial: false,
		icone: 'trending-up',
		cor: '#10b981',
		frase_trabalhando: 'Conferindo quanto isso vende nos marketplaces…',
		fase: 'descoberta',
		ordem: 20,
		// Declarado em vez de herdado, como todo o roster: `evidencias[]` também
		// carrega uma URL por linha. Medido em 786 tokens; o Flash Lite não
		// escreve para preencher teto, então a folga não custa.
		max_tokens: 1800,
	},
	{
		chave: 'concorrencia',
		nome: 'Analista de Concorrência',
		papel: `Você estuda quem já vende: como se posicionam, o que prometem e do que os clientes reclamam. A reclamação alheia é a brecha de quem entra. ${ANTI_INVENCAO}`,
		pergunta:
			'Quem vende {produto} no Brasil? Liste vendedores e lojas, como cada um se posiciona (preço baixo, premium, prazo, personalização) e as reclamações que aparecem nas avaliações.',
		saida:
			'{"vendedores":[{"nome":"","posicionamento":"","url":""}],"reclamacoes_comuns":[],"brechas":[],"observacao":""}',
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		max_buscas: 1,
		// Subiu para o rápido e passou a ser só de PRODUTO. Duas razões:
		// (1) quando a pergunta é "tenho esta peça, vale a pena?", saber quem já
		//     vende e do que o cliente reclama muda a decisão de entrar — é caro
		//     demais para ficar só no profundo;
		// (2) no escopo mercado quem faz este trabalho agora é o Caçador de
		//     Brechas, que procura a MESMA coisa (anúncio fraco, reclamação
		//     recorrente) mas já devolve a vaga aberta em vez do panorama.
		//     Manter os dois no mesmo dossiê era pagar duas buscas pela mesma
		//     resposta.
		modo: 'ambos',
		escopo: 'produto',
		compartilhavel: true,
		essencial: false,
		icone: 'users',
		cor: '#8b5cf6',
		frase_trabalhando: 'Estudando quem já vende e do que reclamam…',
		fase: 'descoberta',
		ordem: 30,
		// Três listas na mesma resposta (vendedores, reclamações, brechas).
		// Medido em 759 tokens.
		max_tokens: 1800,
	},
	{
		/**
		 * O especialista que responde a pergunta que decide tudo: SOBRA DINHEIRO?
		 *
		 * Ele existe porque o dossiê sabia dizer por quanto se vende e não sabia
		 * dizer quanto custa fazer — e vender caro um produto que consome meia
		 * chapa de acrílico não é negócio. Entra nos DOIS escopos e nos DOIS
		 * modos: é o insumo do Curador de Oportunidades ("margem essencial de
		 * lucro" foi o pedido literal) e do Estrategista.
		 *
		 * NO PROFUNDO ELE DEIXOU DE SER SOZINHO: o `custo_dos_produtos` refaz esta
		 * mesma pesquisa na onda 2, já sabendo QUAIS produtos o time achou. Não é
		 * duplicata, é a primeira e a segunda passada — este aqui roda na onda 1,
		 * quando ainda não existe lista de produto nenhuma, e no escopo mercado
		 * isso significa procurar insumo do RAMO (foi ele quem procurou copo
		 * térmico enquanto o radar achava acrílico e MDF). Os dois devolvem
		 * `insumos[]` com a MESMA forma de propósito: quem os lê é
		 * `custosDeInsumos`, que exige `unidade_compra`, `rende_pecas` e `url`
		 * para poder dividir em TypeScript.
		 */
		chave: 'margem',
		nome: 'Analista de Margem',
		papel: [
			'Você descobre quanto CUSTA fazer, para o time saber quanto sobra.',
			'Procure o preço da matéria-prima em fornecedor ou loja do Brasil: chapa (MDF, acrílico, compensado), peça em branco (caneca, copo, tábua, chaveiro), tinta, verniz, cola, ímã e embalagem.',
			'De cada insumo traga NÚMERO E LINK, a unidade em que ele é vendido e quantas peças rendem.',
			'NÃO DIVIDA, NÃO MULTIPLIQUE E NÃO CALCULE PORCENTAGEM: quem faz conta é o sistema, com os números que você trouxe com fonte. Um custo por peça só entra em `custo_peca_brl` se a PÁGINA vender a peça avulsa.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Quanto custa hoje no Brasil comprar a PEÇA EM BRANCO pronta para gravar de {produto} em {material}? Procure em fornecedor ou loja brasileira o item que um pequeno produtor com máquina a laser compra para personalizar e revender: caneca, copo térmico, squeeze, tábua, chaveiro, ecobag, chapa de MDF ou de acrílico, mais a embalagem. NÃO traga commodity bruta cotada por quilo ou por metro quadrado (aço a R$/kg, MDF a R$/m²) — isso não é insumo de quem grava, é de quem lamina. De CADA insumo traga: nome exato, a unidade em que a página vende (unidade avulsa, "caixa com 36 unidades", "pacote com 100 folhas", chapa 2,75 × 1,85 m), o preço em reais, a loja e o link. Quando a página vender em caixa ou pacote, REPITA em `rende_pecas` exatamente o número de unidades que a página declara — é ele que deixa o sistema calcular o custo unitário. Diga também o que mais encarece a produção.',
		saida:
			'{"insumos":[{"item":"","unidade_compra":"","preco_brl":0,"rende_pecas":null,"loja":"","url":""}],"custo_peca_brl":null,"faixa_custo":"baixo|medio|alto|nao_apurado","o_que_encarece":"","observacao":""}',
		modelo: M_BUSCA,
		// Preço de chapa e de peça em branco está em loja e marketplace, não em
		// conteúdo editorial — o mesmo motivo que fez o Analista de Demanda usar
		// `perplexity`. Sem `dominios_incluir`: fornecedor de MDF e de acrílico
		// quase nunca é um dos quatro marketplaces.
		motor_busca: 'perplexity',
		max_buscas: 1,
		// MESMA ARMADILHA do Especialista em Marketplaces, e por isso mesmo:
		// ele procura CHAPA DE MDF, não "placa PIX". A página do fornecedor não
		// tem nenhuma palavra-chave da categoria do produto, e o filtro de tema
		// jogaria fora 100% do que ele achou.
		filtrar_por_tema: false,
		modo: 'ambos',
		escopo: 'ambos',
		// Preço de insumo é retrato do mercado, não do aluno: entra no cache.
		compartilhavel: true,
		essencial: false,
		icone: 'percent',
		cor: '#84cc16',
		frase_trabalhando: 'Levantando o custo do insumo com fornecedor…',
		fase: 'descoberta',
		ordem: 25,
		max_tokens: 1800,
	},
	/* ═══ ONDA 1 — DESCOBERTA · o escopo MERCADO e os de panorama (`ambos`) ═══
	 *
	 * A partir de `marketplaces` são todos `escopo: 'ambos'`: canal, tendência,
	 * público e calendário valem igual para quem tem uma peça e para quem
	 * escolheu um ramo. Eles moram aqui porque a leitura de cima para baixo é a
	 * das ondas — quem manda de verdade é `fase` + `escopo` de cada um.
	 */
	{
		chave: 'radar_oportunidades',
		nome: 'Pesquisador de Oportunidades',
		papel: `Você descobre O QUE está vendendo num ramo. Trabalha por evidência de venda real — "+500 vendidos", número de avaliações, posição em "mais vendidos" —, nunca por opinião. ${ANTI_INVENCAO}`,
		pergunta:
			'Liste PELO MENOS 8 produtos do ramo de {produto} que estão vendendo mais hoje no Brasil. Procure em Mercado Livre, Shopee, Amazon e TikTok Shop os itens com mais unidades vendidas e mais avaliações. De CADA um traga: nome exato do anúncio, marketplace, preço, quantos vendidos, avaliações e o LINK DO ANÚNCIO INDIVIDUAL (a página daquele produto específico). Copie também o TÍTULO do anúncio exatamente como está escrito: é dele que se aprende a escrever anúncio que vende. IMPORTANTE: se você só alcançou a página de LISTA e não o anúncio individual, TRAGA O PRODUTO MESMO ASSIM, deixando o endereço vazio e `vendidos`/`avaliacoes` sem valor — nomear o que está vendendo já é resposta, e uma lista vazia não ajuda ninguém. Nunca ponha link de busca ou de categoria no campo do endereço. Priorize o que um pequeno produtor com máquina a laser consegue fabricar.',
		saida:
			'{"produtos":[{"nome":"","titulo_anuncio":"","marketplace":"","preco_brl":0,"vendidos":null,"avaliacoes":null,"por_que_vende":"","da_para_fazer_a_laser":true,"url":""}],"observacao":""}',
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		// Três buscas: uma passada só devolveu um único produto no teste, e o
		// ranking é o CORPO do modo mercado — sem ele a tela não tem conteúdo.
		max_buscas: 3,
		dominios_incluir: MARKETPLACES,
		modo: 'ambos',
		escopo: 'mercado',
		compartilhavel: true,
		essencial: true,
		icone: 'radar',
		cor: '#f59e0b',
		frase_trabalhando: 'Vasculhando os mais vendidos do ramo…',
		fase: 'descoberta',
		ordem: 10,
		// Teto = 2 × o pico medido (1631 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 3400,
	},
	{
		/**
		 * O contrapeso do Pesquisador de Oportunidades.
		 *
		 * O radar acha o que vende MAIS — que é, por definição, onde há mais
		 * gente vendendo. Sozinho ele manda o aluno para a briga mais difícil do
		 * ramo. Este aqui procura o contrário: onde falta gente boa. Foi pedido
		 * com essas palavras — "produtos que estão no mercado sem
		 * competitividade, e a pessoa vai poder ganhar".
		 */
		chave: 'brechas',
		nome: 'Caçador de Brechas',
		papel: [
			'Você procura VAGA ABERTA: onde há pouca gente vendendo bem.',
			'Conta como brecha: produto com poucos vendedores oferecendo; anúncio com foto ruim, título mal escrito ou descrição vazia; nota baixa por um motivo que um produtor caprichoso resolve (gravação que apaga, embalagem que chega quebrada, prazo longo); produto sem versão personalizada à venda; variação que aparece na busca e quase ninguém oferece.',
			'Cada brecha precisa do link do anúncio ou da busca que a PROVA, e da frase do que está faltando.',
			'Se o mercado estiver bem servido, DIGA QUE ESTÁ e marque `mercado_bem_servido`. "Não achei brecha" é resposta útil: evita que a pessoa compre material para brigar de igual para igual com quem já está lá há dois anos.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'No ramo de {produto}, onde há POUCA gente vendendo bem hoje no Brasil? Procure em Mercado Livre, Shopee, Amazon e TikTok Shop: (1) produtos do ramo com poucos vendedores oferecendo; (2) anúncios com nota baixa ou reclamação recorrente que um produtor caprichoso resolveria; (3) produtos que ninguém oferece em versão personalizada ou gravada; (4) variações que aparecem na busca e quase ninguém vende. De CADA brecha traga o link que a comprova, o preço que você viu e o que está faltando ali.',
		saida:
			'{"brechas":[{"produto":"","o_que_falta":"","por_que_da_para_ganhar":"","sinal":"poucos_vendedores|anuncio_fraco|nota_baixa|sem_personalizado|variacao_orfa","forca":"forte|media|fraca","preco_visto_brl":null,"url":""}],"mercado_bem_servido":false,"observacao":""}',
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		// Duas passadas: uma busca só devolve os mesmos campeões do radar. A
		// segunda é o que faz aparecer a cauda — a variação órfã e o anúncio
		// fraco, que é onde mora a brecha.
		//
		// ATENÇÃO ao teto de buscas do modo (`LIMITES_PADRAO` em budget.ts): a
		// reserva é TUDO OU NADA (`podeBuscar(a.maxBuscas)`), então se sobrar
		// só 1 busca no orçamento ele roda com ZERO e vira um especialista
		// cego. mercado+rápido precisa de 6 buscas inteiras: 3 do radar + 1 do
		// margem + 2 daqui.
		max_buscas: 2,
		dominios_incluir: MARKETPLACES,
		// Ele procura AUSÊNCIA — anúncio que não existe, versão que ninguém faz.
		// Filtrar pelas palavras-chave do produto descartaria exatamente a prova
		// da falta. Mesma razão do Especialista em Marketplaces.
		filtrar_por_tema: false,
		modo: 'ambos',
		escopo: 'mercado',
		compartilhavel: true,
		essencial: false,
		icone: 'door-open',
		cor: '#22c55e',
		frase_trabalhando: 'Garimpando onde tem pouca gente vendendo bem…',
		fase: 'descoberta',
		ordem: 15,
		max_tokens: 1800,
		timeout_s: 75,
	},
	{
		chave: 'marketplaces',
		nome: 'Especialista em Marketplaces',
		papel: `Você compara os canais de venda brasileiros — Mercado Livre, Shopee, Amazon e TikTok Shop — para quem produz personalizado. Fale de comissão real, público, o que funciona e o que trava em cada um. ${ANTI_INVENCAO} ${TOM}`,
		pergunta:
			'Para vender {produto} no Brasil, compare Mercado Livre, Shopee, Amazon e TikTok Shop. Para CADA um: a comissão cobrada hoje, que público compra lá, que faixa de preço funciona, o que é exigido do vendedor (nota fiscal, prazo, frete) e o que costuma dar errado. Diga por onde um pequeno produtor deveria COMEÇAR e por quê.',
		saida:
			'{"canais":[{"canal":"Mercado Livre|Shopee|Amazon|TikTok Shop|Instagram|B2B local","comissao_pct":null,"publico":"","faixa_preco":"","exige":"","funciona_bem_para":"","cuidado":"","esforco":"baixo|medio|alto","url":""}],"comecar_por":"","por_que":"","observacao":""}',
		modelo: M_BUSCA,
		motor_busca: 'exa',
		max_buscas: 2,
		// Ele procura REGRA DE CANAL (comissão, exigência), não o produto. O
		// filtro por palavra-chave do produto descartaria 100% do que ele acha.
		filtrar_por_tema: false,
		// Saiu do RÁPIDO e o slot foi para o Analista de Margem. Ele é o mais
		// caro em busca do time no rápido (2 de 5 buscas do teto), e a pergunta
		// que ele responde — "em qual canal eu começo?" — o Estrategista já
		// responde em `onde_comecar`. Saber se SOBRA DINHEIRO muda mais a
		// decisão de quem tem 70 segundos do que saber a comissão exata da
		// Shopee. No profundo ele continua, com a comparação inteira.
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'store',
		cor: '#0ea5e9',
		frase_trabalhando:
			'Comparando Mercado Livre, Shopee, Amazon e TikTok Shop…',
		// 40 era o começo da faixa da onda 1 quando havia duas ondas. Com três, a
		// faixa 40–69 passou a ser a da onda 2, e a `ordem` é o que ordena os
		// cartões DENTRO do grupo da onda na sala de guerra: deixá-lo em 40 o
		// jogaria para o fim da onda 1, longe dos outros dois de canal.
		fase: 'descoberta',
		ordem: 32,
		max_tokens: 2400,
	},
	{
		chave: 'tendencias',
		nome: 'Pesquisador de Tendências',
		papel: `Você procura o que está SUBINDO: variações, públicos e datas que puxam venda, com menos gente disputando. ${ANTI_INVENCAO}`,
		pergunta:
			'Em {produto}, o que está em alta no Brasil e tem menos concorrência? Pense em públicos específicos (profissão, data comemorativa, religião, pet, time), formatos novos e o que viralizou recentemente. Diga o que sustenta cada ideia.',
		saida:
			'{"tendencias":[{"nome":"","publico":"","por_que":"","quando_vende_mais":"","evidencia_url":""}],"observacao":""}',
		modelo: M_BUSCA,
		motor_busca: 'exa',
		max_buscas: 1,
		// Procura o que está SUBINDO — nicho vizinho, público novo, formato novo.
		// Por definição não são as palavras-chave do produto de partida.
		filtrar_por_tema: false,
		modo: 'profundo',
		// VOLTOU A SER `ambos`. Ele foi cortado do escopo produto quando o time
		// tinha 10 vagas e o slot dele foi para o Analista de Margem — "quem já
		// tem a peça na mão precisa primeiro saber se ela paga o material" —, e
		// era uma escolha entre dois, não um julgamento sobre ele. Em 22 não há
		// mais escolha a fazer, e a pergunta dele é boa para quem tem a peça:
		// para onde pivotar (que público, que variação, que data) é a decisão
		// seguinte de quem descobriu que o produto vende.
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'compass',
		cor: '#ec4899',
		frase_trabalhando: 'Procurando o que está subindo com menos briga…',
		// 34: onda 1, ao lado dos outros dois de panorama de canal/mercado.
		fase: 'descoberta',
		ordem: 34,
		/**
		 * ELE FALHAVA NAS DUAS TENTATIVAS, e o teto era o suspeito certo.
		 *
		 * Medido num run frio de `produto+profundo`: única falha do run, "a
		 * resposta não veio em JSON válido (2820 caracteres, teto 1200 tokens)",
		 * e o retry em outro modelo não salvou. Ele não declarava `max_tokens` e
		 * caía no padrão de 1.200 — o mesmo teto que já tinha derrubado o
		 * Consultor de Produção.
		 *
		 * 2.820 caracteres PARECEM caber em 1.200 tokens pela régua de 4 chars por
		 * token, e é por isso que o diagnóstico do bloco escreveu "não veio em
		 * JSON válido" em vez de "bateu no limite": a régua de 4 é boa para inglês
		 * e otimista para JSON em português, onde cada acento custa um token
		 * inteiro e a pontuação de estrutura custa outro — a razão real fica perto
		 * de 2,4 caracteres por token, e 2.820 / 2,4 ≈ 1.175, encostado no teto.
		 * O teto hoje é 2 × o pico medido (937 tokens), pela regra de
		 * `PICOS_MEDIDOS` — e comporta com folga as 5 a 8 tendências que a
		 * pergunta pede, cada uma com nome, público, por quê, quando vende e link
		 * de evidência (as URLs sozinhas são ~100 caracteres cada).
		 */
		max_tokens: 2000,
	},
	{
		/**
		 * PARA QUEM VENDER — a pergunta que o dossiê nunca respondia.
		 *
		 * O time inteiro sabia dizer O QUE vende, POR QUANTO e ONDE, e ninguém
		 * dizia PARA QUEM. Sem isso o anúncio do Redator fala com todo mundo (que
		 * é falar com ninguém) e o Estrategista recomenda preço sem saber que
		 * bolso paga. Entra na onda 1 porque não depende de produto nenhum: é
		 * sobre o comprador do ramo.
		 */
		chave: 'publico',
		nome: 'Analista de Público',
		papel: [
			'Você descobre PARA QUEM vender: quem é a pessoa que compra, em que ocasião ela compra, quanto costuma pagar e o que a faz escolher um vendedor em vez do outro.',
			'Vale como evidência: matéria de e-commerce, pesquisa de consumo, dado de marketplace e o próprio anúncio que declara para quem serve.',
			'Ticket só entra se o número estiver na página. Perfil sem fonte é chute com cara de pesquisa.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Quem compra {produto} no Brasil? Traga de 3 a 5 perfis de comprador. De CADA um: quem é (o que faz, momento de vida, faixa de renda), a OCASIÃO da compra (presente, festa, casamento, empresa, uso próprio), o quanto costuma pagar, o que faz essa pessoa decidir (preço, prazo, personalização, embalagem) e onde ela procura o produto. Traga o link da página que sustenta cada perfil.',
		// `perfis[]` com `quem`, `ocasiao`, `ticket_brl`, `o_que_decide`,
		// `onde_encontrar` e `url` — os nomes que `lerPublico` lê. O ticket só
		// vira número na tela com página citada: é dinheiro.
		saida:
			'{"perfis":[{"quem":"","ocasiao":"","ticket_brl":null,"o_que_decide":"","onde_encontrar":"","url":""}],"observacao":""}',
		modelo: M_BUSCA,
		// `exa` (semântico) e não `perplexity`: quem compra e por quê está em
		// matéria, pesquisa de consumo e blog de e-commerce, não em anúncio.
		motor_busca: 'exa',
		max_buscas: 2,
		// Ele procura O COMPRADOR, não o produto: a página que descreve "quem
		// compra presente personalizado" fala de gente, e pode não repetir uma
		// palavra sequer da categoria. É a mesma armadilha que deixou o
		// Especialista em Marketplaces com 0 fontes.
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		// Retrato do mercado, não do aluno: entra no cache de 7 dias.
		compartilhavel: true,
		essencial: false,
		icone: 'contact-round',
		cor: '#d946ef',
		frase_trabalhando: 'Traçando o perfil de quem compra e por quê…',
		fase: 'descoberta',
		ordem: 36,
		/**
		 * ELE MORREU NO TETO DE 1.800, DUAS VEZES NO MESMO RUN.
		 *
		 * Run frio `produto+profundo` ("Caneca de porcelana branca 325ml"): a
		 * primeira chamada e o retry em outro modelo fecharam com "a resposta não
		 * veio em JSON válido (3.540 caracteres, teto 1.800 tokens)". O aluno
		 * pagou 6 voxxys por 22 profissionais, viu o cartão do Analista de Público
		 * trabalhar na sala de guerra, gastou uma busca e um retry — e recebeu 21,
		 * com "Para quem vender" sem um perfil sequer.
		 *
		 * O 782 que estava escrito aqui era a MEDIANA, e mediana não dimensiona
		 * teto: os perfis dele são cinco frases cada, e quando ele acha cinco
		 * perfis em vez de três a saída dobra. O teto que morreu (1.800) virou o
		 * pico em `PICOS_MEDIDOS` — teto batido é piso do que faltava — e a regra
		 * de 2× dá 3.600. Custa zero: o Flash Lite não escreve para preencher teto.
		 */
		max_tokens: 3600,
	},
	{
		/**
		 * O CALENDÁRIO — o dado que decide QUANDO comprar material.
		 *
		 * Quem produz a laser vende por data: Dia das Mães, formatura, Natal,
		 * casamento. Errar a antecedência não é perder margem, é perder a data
		 * inteira — o lote fica pronto quando a procura já passou. `tendencias`
		 * cita "quando vende mais" de passagem; aqui o calendário é o trabalho.
		 */
		chave: 'sazonalidade',
		nome: 'Analista de Sazonalidade',
		papel: [
			'Você monta o CALENDÁRIO do ano: que datas puxam a venda deste ramo, em que mês elas caem e com quanta antecedência o vendedor precisa estar anunciando e produzindo.',
			'A antecedência é o dado mais útil que você traz: escreva em semanas ("comece 6 semanas antes"), e só se a página sustentar.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Que datas do ano puxam a venda de {produto} no Brasil? Considere Dia das Mães, Dia dos Namorados, Dia dos Pais, Dia das Crianças, Natal, Black Friday, Páscoa, festa junina, volta às aulas, formatura, casamento e as datas próprias deste ramo. De CADA data: em que mês ela cai, com quanta antecedência o vendedor precisa estar produzindo e anunciando, o que mais vende nela e se ela é forte, média ou fraca para este ramo. Traga o link que sustenta cada uma.',
		// `datas[]` com `data`, `mes`, `antecedencia`, `o_que_vende`, `forca` e
		// `url`: são os nomes de `lerSazonalidade`, que ORDENA o calendário pelo
		// `mes` (por isso ele é campo próprio, e não uma frase solta) e mostra a
		// antecedência como TEXTO — daí "6 semanas antes" em vez de um número.
		saida:
			'{"datas":[{"data":"","mes":"","antecedencia":"","o_que_vende":"","forca":"forte|media|fraca","url":""}],"observacao":""}',
		modelo: M_BUSCA,
		// Calendário comercial mora em matéria e em blog de e-commerce: `exa`.
		motor_busca: 'exa',
		max_buscas: 1,
		// Ele procura DATA ("quando vender no Dia das Mães"), e a página que
		// explica o calendário do varejo não fala do produto do aluno.
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'calendar-days',
		cor: '#06b6d4',
		frase_trabalhando: 'Montando o calendário: que data puxa esta venda…',
		fase: 'descoberta',
		ordem: 38,
		// O calendário inteiro do ano: até 12 datas com mês, antecedência, o que
		// vende e link. Pico medido de 967 tokens; teto = 2 × pico, ver
		// `PICOS_MEDIDOS`.
		max_tokens: 2000,
	},
	/* ═══════ ONDA 2 — APROFUNDAMENTO (leem o digest e pesquisam de novo) ═══════
	 *
	 * TODOS os daqui são `fase: 'aprofundamento'`, `modo: 'profundo'` e
	 * `escopo: 'ambos'` — e os três valores são a mesma decisão de produto:
	 *
	 *  • `aprofundamento` porque a pergunta deles só existe DEPOIS de saber quais
	 *    produtos e quais lojas o time achou. Na onda 1 eles pesquisariam o ramo
	 *    em abstrato, que é o que a onda 1 já faz — mais caro e uma vez a mais.
	 *  • `profundo` porque o rápido continua com 5 e não muda.
	 *  • `ambos` porque a segunda passada vale igual nas duas perguntas: quem
	 *    mandou UMA peça também quer saber quem já vende ela, do que reclamam,
	 *    quanto o frete come e de quem comprar o insumo. É também o que faz a
	 *    conta fechar em 22 nos dois escopos sem inventar especialista.
	 *
	 * `filtrar_por_tema: false` em todos, e por um motivo que NÃO é o de sempre:
	 * o filtro compara o resultado com as palavras-chave da CATEGORIA, e a onda 2
	 * não procura a categoria — procura os PRODUTOS e as LOJAS que a onda 1
	 * nomeou. Num ramo amplo os dois vocabulários não se encontram: a página do
	 * anúncio de um copo térmico não diz "brindes corporativos" em lugar nenhum, e
	 * o filtro jogaria fora 100% do que estes nove acharam — o mesmo estrago que
	 * deixou o Especialista em Marketplaces com 0 fontes. A proteção que o filtro
	 * daria eles já têm de graça: a pergunta vem ancorada no material, então o
	 * buscador não tem para onde derivar.
	 *
	 * Modelo barato (`M_BUSCA`) em todos: a tarefa é EXTRAIR o que está na página
	 * (nome da loja, nota, preço, peso, prazo), não julgar. Julgar é a onda 3, e
	 * lá o modelo é caro. Vinte e dois especialistas com modelo de julgamento
	 * estouram a margem sozinhos.
	 */
	{
		/**
		 * "MAIS QUEM SÃO MEUS CONCORRENTES" — pedido literal do dono do produto.
		 *
		 * O `concorrencia` da onda 1 responde "que tipo de gente vende isso": um
		 * panorama, e no escopo mercado ele nem roda. Este aqui abre a PÁGINA DA
		 * LOJA de cada vendedor que apareceu e traz o que dá para conferir:
		 * reputação, tempo de casa, quantidade de anúncios, nota. É a diferença
		 * entre "há vendedores estabelecidos" e "a Loja X está há 6 anos, tem
		 * 4.800 vendas e nota 4,8 — é com ela que você vai brigar".
		 */
		chave: 'concorrente_perfil',
		nome: 'Investigador de Concorrentes',
		papel: [
			'Você levanta a FICHA de cada concorrente: nome da loja, canal, reputação, tempo de mercado, quantidade de anúncios no ar, nota e cidade.',
			COMO_CHAMAR_O_TIME,
			'Cada número vem da página da loja que você abriu — nota, avaliações e vendas são o que a página declara, nunca a sua impressão.',
			'Se a página não mostrar um dado, deixe null. Reputação inventada faz a pessoa desistir de um mercado vazio, ou entrar num mercado dominado.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Dos vendedores e anúncios que aparecem no MATERIAL DO TIME abaixo, investigue QUEM são os concorrentes de verdade em {produto} no Brasil. Abra a página de cada loja e traga: nome da loja, em que canal vende, a nota e o número de avaliações como a página mostra, a reputação declarada (o selo do canal: "MercadoLíder Platinum", "Loja Oficial", "Preferido"), há quanto tempo vende, quantos anúncios tem no ar, como se posiciona (preço baixo, premium, prazo, personalização) e o link da loja. Traga de 4 a 8 lojas. Se algum vendedor do material não tiver página aberta, complete com outros do mesmo ramo — mas prefira os que o time já encontrou.',
		/**
		 * OS NOMES DOS CAMPOS SÃO CONTRATO COM A TELA, não estilo.
		 *
		 * `lerConcorrentes` (dossie.tsx) monta o card lendo `concorrentes[]` e,
		 * de cada um, `loja`/`canal`/`nota`/`avaliacoes`/`reputacao`/
		 * `tempo_de_mercado`/`anuncios`/`posicionamento`/`url`. Campo com outro
		 * nome não quebra nada: some do card, e o especialista pago aparece na
		 * tela com metade da ficha em branco. Foi por isso que `anuncios_no_ar`
		 * virou `anuncios` e que `cidade` e `vendas_declaradas` saíram — ninguém
		 * os lê, e token gasto em campo que a tela ignora é margem queimada.
		 */
		saida: [
			'{"concorrentes":[{"loja":"","canal":"","nota":null,"avaliacoes":null,',
			'"reputacao":"","tempo_de_mercado":"","anuncios":null,',
			'"posicionamento":"","url":""}],"observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		// `perplexity`: página de loja e reputação moram em marketplace, que é onde
		// ele acerta e o `exa` erra. Sem `dominios_incluir` de propósito — o
		// concorrente sério de personalizado também está no Elo7, na Etsy e em loja
		// própria, e a lista dos quatro canais deixaria todos eles de fora.
		motor_busca: 'perplexity',
		max_buscas: 2,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'building-2',
		cor: '#3b82f6',
		frase_trabalhando:
			'Abrindo a ficha de cada concorrente: nota, tempo de casa, anúncios…',
		fase: 'aprofundamento',
		ordem: 42,
		// Teto = 2 × o pico medido (1212 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 2600,
		timeout_s: 75,
	},
	{
		/**
		 * "QUAL QUE É OS PRODUTOS QUE ELES MAIS VENDEM" — pedido literal.
		 *
		 * Separado do `concorrente_perfil` de propósito: um traz QUEM, o outro traz
		 * O QUE. Juntos num especialista só, o JSON teria loja e vitrine aninhadas
		 * num teto de saída que não fecha — e JSON truncado aqui é falha explícita,
		 * não meia resposta. Separados, cada um cabe e cada um tem seu box.
		 */
		chave: 'concorrente_portfolio',
		nome: 'Analista de Vitrine',
		papel: [
			'Você abre a vitrine de cada loja concorrente e descobre o que ela MAIS VENDE.',
			COMO_CHAMAR_O_TIME,
			'Campeão de venda é o que a página prova: mais vendidos, mais avaliações, "mais de X vendidos". Ordem de exibição não é prova de nada.',
			'Traga o link do ANÚNCIO de cada campeão: é da própria página que a foto dele é buscada depois.',
			// Medido no run frio de mercado: dois dos quatro campeões vieram com
			// `lista.mercadolivre.com.br/brindes-personalizados-empresas` — a MESMA
			// página de resultados nos dois. Ela abre, e a imagem dela é o logotipo
			// do marketplace; o produto do campeão não está lá.
			'Página de LISTA, de categoria ou de busca da loja não é o anúncio do campeão: se você só chegou até ela, traga o campeão sem endereço.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Para CADA loja concorrente citada no MATERIAL DO TIME abaixo, descubra o que ela mais vende em {produto}. Abra a vitrine da loja e traga de 2 a 4 produtos campeões por loja, TODOS numa lista única, cada um dizendo de qual loja é: nome do produto, o título do anúncio como está escrito, o canal, o preço, quantos a página declara vendidos e o link do anúncio. Diga em `observacao` a faixa de preço em que cada loja trabalha e o que ela oferece que as outras não oferecem (kit, personalização, prazo, frete grátis, embalagem).',
		/**
		 * LISTA ÚNICA E CHATA, não aninhada por loja — e isso é contrato, não gosto.
		 *
		 * `lerCampeoes` (dossie.tsx) lê `campeoes[]` na RAIZ e agrupa por `loja`
		 * em TypeScript (`agruparPorLoja`), e `lerGaleria` varre a mesma lista
		 * atrás de `imagem_url` — campo que o MOTOR preenche com a foto da
		 * página, não este JSON. Uma saída `lojas[].campeoes[]` cai no fallback
		 * do leitor, que pega a maior lista da raiz — as LOJAS — e descarta tudo
		 * por não achar `produto` nelas: a seção "O que eles mais vendem", que é
		 * pedido literal do dono do produto, sairia vazia com os dois
		 * especialistas de concorrente pagos.
		 */
		saida: [
			'{"campeoes":[{"loja":"","produto":"","titulo_anuncio":"","canal":"",',
			'"preco_brl":null,"vendidos":null,"url":""}],"observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		max_buscas: 2,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'shopping-bag',
		cor: '#e11d48',
		frase_trabalhando:
			'Vasculhando a vitrine dos concorrentes: o que mais sai…',
		fase: 'aprofundamento',
		ordem: 44,
		// O JSON mais aninhado da onda 2 (loja → campeões). 1.800 fechava no meio
		// da terceira loja; 2.400 comporta cinco lojas com quatro campeões.
		max_tokens: 2400,
		timeout_s: 75,
	},
	{
		/**
		 * "MAIS IMAGENS" — pedido literal, e o único especialista cujo produto é a
		 * FOTO.
		 *
		 * ARMADILHA MEDIDA, e é ela que escreve o papel: a `og:image` de uma página
		 * de LISTAGEM de marketplace é o logotipo do marketplace, não o produto.
		 * Uma galeria com oito logos da Shopee é pior que galeria nenhuma. Por isso
		 * ele só pode trazer página de ANÚNCIO INDIVIDUAL, e é melhor voltar com
		 * seis imagens boas do que com doze em que metade é logo.
		 *
		 * (O Radar tem a instrução OPOSTA — trazer o produto mesmo sem link
		 * individual — e não há contradição: lá o produto é o NOME do que vende,
		 * que serve sem foto; aqui o produto é a foto, que sem a página não existe.)
		 *
		 * ┌─ ELE ACHA A PÁGINA. A FOTO QUEM BUSCA SOMOS NÓS ────────────────────┐
		 * │ Ele pedia a URL da imagem, e devolvia uma: no run gravado, as quatro │
		 * │ do Mercado Livre apontavam para o MESMO arquivo — o GIF "imagem      │
		 * │ indisponível" do próprio ML — e as duas da Shopee davam 404. Os ids  │
		 * │ denunciavam a fabricação (`MLB75432109876`, 13 dígitos). Não é       │
		 * │ desobediência: a busca entrega o TEXTO da página, e o endereço da    │
		 * │ foto não está no texto (`og-image.ts` abre com essa medição: 0 de 8).│
		 * │ Pedir um dado que nunca chega é contratar invenção.                  │
		 * │                                                                      │
		 * │ Pior: a URL inventada VENCIA a real, porque o motor lia campo        │
		 * │ preenchido como "este já tem foto" e não abria a página. Somando os  │
		 * │ três runs profundos de mercado deram 0 fotos de produto em 4         │
		 * │ imagens, e num dos casos a `og:image` verdadeira estava a um fetch   │
		 * │ de distância, na página que ele mesmo citou certo.                   │
		 * │                                                                      │
		 * │ Então o trabalho dele mudou de nome, não de valor: ele é quem ACHA A │
		 * │ PÁGINA CERTA — anúncio individual, com variedade — e a foto sai da   │
		 * │ `og:image` dela. O que ele faz bem continua sendo o gargalo da        │
		 * │ galeria; o que ele fazia mal saiu do contrato.                        │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		chave: 'referencias_visuais',
		nome: 'Curador de Imagens',
		papel: [
			'Você acha as PÁGINAS de onde saem as fotos: anúncios reais dos produtos que o time encontrou, um por imagem que a galeria vai mostrar.',
			COMO_CHAMAR_O_TIME,
			'Você NÃO escreve o endereço da imagem — ela é buscada na própria página depois. Seu trabalho é acertar a PÁGINA e descrever o que ela mostra.',
			'Só vale página de ANÚNCIO INDIVIDUAL ou de produto. NUNCA use link de busca, de categoria ou de listagem: a imagem dessas páginas é o logotipo do marketplace, não o produto.',
			/**
			 * ┌─ ONDE A FOTO DE VERDADE MORA — MEDIDO, ABRINDO AS PÁGINAS ───────┐
			 * │ As 31 fotos de produto capturadas nos runs gravados vieram de     │
			 * │ LOJA BRASILEIRA (`nakalubrindes`, `lojapersonaliza`, `amouh`,     │
			 * │ `suaartepersonalizada`, `iniciativabrindes`, `personizi`,         │
			 * │ `inovapersonalizados`). ZERO vieram dos quatro marketplaces, e não │
			 * │ por acaso:                                                        │
			 * │                                                                   │
			 * │   produto.mercadolivre.com.br/MLB-…  → HTTP 302 para              │
			 * │     `/gz/account-verification`. Não abre para robô nenhum.        │
			 * │   shopee.com.br/…-i.X.Y             → HTTP 200 com 177 KB de HTML │
			 * │     e ZERO metatags `og:` (a página monta no navegador).          │
			 * │                                                                   │
			 * │ Ou seja: mandá-lo caçar anúncio nos quatro canais é mandá-lo aos  │
			 * │ únicos endereços que, por construção, nunca vão render uma foto —  │
			 * │ e é de lá que vinham os ids fabricados. A loja própria é o alvo.   │
			 * └───────────────────────────────────────────────────────────────────┘
			 */
			'A foto sai da LOJA, não do marketplace: página de produto de loja brasileira (`.com.br`, `/produto/`, `/products/`) é a que abre e entrega imagem. Mercado Livre e Shopee bloqueiam quem não é navegador, e a foto deles nunca chega — prefira a loja.',
			'Se de um produto você só alcançou a listagem, deixe ele de fora e diga isso em `observacao`. Seis páginas certas valem mais que doze com logotipo no meio.',
			'Prefira variedade: modelos, materiais e acabamentos diferentes, para quem lê ver o que dá para copiar e o que dá para melhorar.',
			ANTI_INVENCAO,
		].join(' '),
		/**
		 * ┌─ A PERGUNTA PEDIA "FOTOS" E A BUSCA ENTENDIA "FOTOGRAFIA" ───────────┐
		 * │ Medido num run frio de mercado, com as 10 citações dele na mão: NÃO  │
		 * │ VEIO UM ANÚNCIO. Vieram `mercadolivre.com.br/ajuda/Como-tirar-boas-  │
		 * │ fotos-dos-seus-produtos`, `venda.amazon.com.br/sellerblog/fotos-     │
		 * │ para-e-commerce-10-dicas`, `ads.shopee.com.br/learn/faq/…` e         │
		 * │ `vendedores.mercadolivre.com.br/nota/requisitos-de-fotos-para-       │
		 * │ vender-packs`. Dez de dez sobre COMO FOTOGRAFAR produto.             │
		 * │                                                                      │
		 * │ E `dominios_incluir` não protege disto: `vendedores.` e `ads.` são    │
		 * │ subdomínios dos mesmos marketplaces, então a restrição de domínio     │
		 * │ estava satisfeita o tempo todo. Filtro nenhum conserta isso — nada    │
		 * │ do que a busca trouxe era anúncio, e não há como escolher bem dentro  │
		 * │ de uma lista onde a resposta certa não está.                          │
		 * │                                                                      │
		 * │ Por isso a pergunta parou de pedir FOTO e passou a pedir O ANÚNCIO    │
		 * │ DAQUELE PRODUTO À VENDA, com a exclusão dita com todas as letras. A   │
		 * │ foto continua sendo o produto do trabalho dele — ela só não é mais a  │
		 * │ palavra com que se procura.                                           │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		pergunta:
			'Para CADA produto listado no MATERIAL DO TIME abaixo (ramo de {produto}), ache a PÁGINA DE PRODUTO onde ele está à venda hoje no Brasil, com preço e botão de comprar. Procure primeiro na LOJA que vende (fabricante de brinde, gráfica, ateliê, loja virtual `.com.br` com `/produto/` ou `/products/` no endereço) — é a página que abre e mostra a foto. NÃO traga página de ajuda, de blog, de dicas de fotografia, de central do vendedor, de "como vender", de categoria nem de resultado de busca: elas mostram o site, não o produto. De cada página diga que produto é e o que a foto dela mostra (o ângulo, o acabamento, a embalagem, a peça em uso), e traga o endereço EXATO daquela página, copiado do resultado da busca. Pelo menos 6 produtos diferentes, uma página de cada — e é melhor voltar com três páginas que abrem do que com seis endereços montados.',
		// `lerGaleria` (dossie.tsx) lê `referencias[]` e, de cada item,
		// `imagem_url` + `url` + a legenda em `o_que_e`. O `imagem_url` NÃO está
		// nesta saída de propósito: quem o preenche é o motor, com a `og:image`
		// da página que este especialista trouxe em `url`. Loja e preço não têm
		// lugar na grade de imagens — pedir os dois seria pagar token por dado
		// que a tela joga fora, e o preço já vem do Analista de Precificação.
		saida:
			'{"referencias":[{"produto":"","o_que_e":"","url":""}],"observacao":""}',
		modelo: M_BUSCA,
		/**
		 * ┌─ A LISTA DE DOMÍNIOS SAIU, E DESTA VEZ COM O MOTIVO CERTO ───────────┐
		 * │ Ela já tinha sido tirada uma vez e reposta: "num run frio de mercado  │
		 * │ SEM a lista as 10 citações continuaram institucionais                 │
		 * │ (`seller.tiktok.com`, `ads.tiktok.com/help`,                          │
		 * │ `developers.mercadolivre.com.br`), a galeria continuou em zero". O    │
		 * │ teste estava certo e a conclusão, errada: a PERGUNTA daquela vez      │
		 * │ ainda mandava procurar "no Mercado Livre, Shopee, Amazon ou TikTok    │
		 * │ Shop", com os quatro escritos por extenso. Tirar a lista e manter a   │
		 * │ pergunta é medir a lista contra ela mesma.                            │
		 * │                                                                      │
		 * │ O que mudou agora é o alvo, e ele saiu de uma medição nova: as 31     │
		 * │ fotos capturadas nos runs vieram de LOJA `.com.br`, e os quatro       │
		 * │ canais não entregam foto por construção — ML devolve 302 para         │
		 * │ `account-verification` e a Shopee serve HTML sem uma tag `og:`. Com a │
		 * │ lista de pé, o especialista da galeria fica preso justamente nos      │
		 * │ quatro domínios de onde nenhuma foto pode sair.                       │
		 * │                                                                      │
		 * │ Se voltar a zerar, a lista volta — mas volta com a pergunta atual, e  │
		 * │ aí o teste terá medido a lista.                                       │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		motor_busca: 'perplexity',
		max_buscas: 2,
		// VAZIO EXPLÍCITO, e não ausente: o seed atualiza com PATCH, então tirar a
		// chave do objeto deixa no banco o valor da rodada passada — a lista
		// continuaria de pé e o teste desta mudança mediria o arquivo, não o time.
		dominios_incluir: '',
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'images',
		cor: '#eab308',
		frase_trabalhando: 'Garimpando os anúncios dos produtos encontrados…',
		fase: 'aprofundamento',
		ordem: 46,
		// Teto = 2 × o pico medido (1227 tokens). Ver `PICOS_MEDIDOS`.
		/**
		 * 2600 → 4000: MEDIDO, ele bateu o teto e o JSON veio cortado.
		 *
		 * "a resposta não veio em JSON válido (2621 caracteres, teto 2600 tokens)"
		 * num run frio de produto+profundo — e o retry em outro modelo também não
		 * salvou, porque o problema não era o modelo, era o espaço. Cada referência
		 * dele carrega produto, descrição do que olhar, link e imagem; com 6
		 * referências isso não cabia em 2600.
		 */
		max_tokens: 4000,
		timeout_s: 75,
	},
	{
		/**
		 * A BRECHA DE QUALIDADE, dita pelo cliente do concorrente.
		 *
		 * "A reclamação alheia é a brecha de quem entra" já era a tese do
		 * `concorrencia`, que a respondia de passagem e só no escopo produto. Aqui
		 * ela é o trabalho inteiro, e sobre os produtos que a onda 1 achou — o que
		 * torna a resposta acionável: o Redator transforma cada queixa numa promessa
		 * ao contrário ("a nossa gravação não apaga na primeira lavagem").
		 */
		chave: 'reclamacoes',
		nome: 'Analista de Reclamações',
		papel: [
			'Você lê o que dá errado na entrega dos outros: avaliações de 1 e 2 estrelas, perguntas de comprador e reclamação pública.',
			COMO_CHAMAR_O_TIME,
			'Cada queixa vem com o link do anúncio ou da página onde ela está escrita, e com a palavra do cliente — não com a sua paráfrase de vendedor.',
			'Diga quantas vezes a mesma queixa aparece; queixa isolada e queixa repetida valem coisas diferentes para quem vai entrar.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Do que os clientes RECLAMAM nos produtos listados no MATERIAL DO TIME abaixo, no ramo de {produto}? Procure as avaliações ruins e as perguntas dos compradores nesses anúncios. De CADA queixa traga: o que deu errado na palavra do cliente, em que produto, se aparece muito ou pouco, o link da página e — em `o_que_prometer` — a promessa que um produtor caprichoso pode fazer no anúncio justamente porque não comete esse erro.',
		// `o_que_prometer` e não "o que fazer diferente": `lerReclamacoes` lê esse
		// nome, e o Redator usa o campo como promessa do anúncio. A queixa vira
		// argumento de venda — que é o motivo de este especialista existir.
		saida: [
			'{"queixas":[{"queixa":"","produto":"","frequencia":"muito|as_vezes|pontual",',
			'"o_que_prometer":"","url":""}],"observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		max_buscas: 2,
		dominios_incluir: MARKETPLACES,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'message-square-warning',
		cor: '#dc2626',
		frase_trabalhando: 'Lendo as avaliações ruins dos concorrentes…',
		fase: 'aprofundamento',
		ordem: 48,
		// Teto = 2 × o pico medido (867 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 1800,
	},
	{
		/**
		 * COMO AS PESSOAS PROCURAM — o insumo direto do Redator.
		 *
		 * O `papel` do Redator já dizia "você recebe os títulos dos anúncios que
		 * MAIS VENDEM", e o que ele recebia era o que o Radar copiava de passagem.
		 * Aqui os títulos e os termos de busca são o trabalho: é a diferença entre
		 * um anúncio bonito e um anúncio que aparece na busca.
		 */
		chave: 'palavras_chave',
		nome: 'Especialista em Busca e Títulos',
		papel: [
			'Você descobre COM QUAIS PALAVRAS as pessoas procuram, e como são escritos os títulos que vendem.',
			COMO_CHAMAR_O_TIME,
			'Copie títulos REAIS, verbatim, com o link — é deles que se aprende a ordem das palavras que o marketplace premia.',
			'Traga também a variação e a cauda longa (o jeito específico de procurar: medida, ocasião, para quem é), que é onde há menos briga.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Como as pessoas PROCURAM no Brasil os produtos listados no MATERIAL DO TIME abaixo, no ramo de {produto}? Traga: os termos de busca (o principal, as variações e as buscas mais específicas), com o link da página onde você viu cada um e — só se a página mostrar o número — o volume de buscas e o quanto o termo é disputado. Traga também 5 títulos reais de anúncios que vendem, em `exemplos_titulo`, copiados exatamente como estão escritos, e em `padrao_titulo` o padrão que eles seguem (o que vem primeiro, onde entram medida, material e para quem serve).',
		// `termos[]`, `exemplos_titulo[]` (lista de FRASES) e `padrao_titulo` são
		// os nomes que `lerTermos` procura. `exemplos_titulo` é lido por
		// `apenasTextos`: uma lista de objetos ali é descartada inteira, então o
		// título vai cru mesmo — o link que o sustenta é o do termo.
		saida: [
			'{"termos":[{"termo":"","volume":"","concorrencia":"","url":""}],',
			'"exemplos_titulo":[],"padrao_titulo":"","observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		max_buscas: 1,
		dominios_incluir: MARKETPLACES,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'text-search',
		cor: '#0d9488',
		frase_trabalhando: 'Anotando como as pessoas escrevem a busca…',
		fase: 'aprofundamento',
		ordem: 50,
		// Teto = 2 × o pico medido (875 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 1800,
	},
	{
		/**
		 * O CONSERTO DO FURO QUE FEZ A ONDA 2 EXISTIR.
		 *
		 * Medido em "brindes corporativos": o Analista de Margem procurava insumo
		 * de COPO TÉRMICO enquanto o Radar achava ACRÍLICO e MDF, porque os dois
		 * corriam ao mesmo tempo. O custo existia, com página, e era de outra
		 * coisa — e todo card de "Comece por estes produtos" saía com "não apurado"
		 * na única célula que decide a compra de material.
		 *
		 * A saída tem a MESMA FORMA da do Analista de Margem (`insumos[]` com
		 * `item`, `unidade_compra`, `preco_brl`, `rende_pecas`, `loja`, `url`)
		 * porque quem a lê é `custosDeInsumos` (oportunidade.ts): ele exige que a
		 * contagem de peças apareça DENTRO da descrição da unidade de compra para
		 * poder dividir. Mudar um nome de campo aqui apaga a "Sobra para você" de
		 * todos os cards, em silêncio.
		 */
		chave: 'custo_dos_produtos',
		nome: 'Analista de Custo dos Produtos',
		papel: [
			'Você descobre quanto CUSTA a peça em branco DOS PRODUTOS QUE O TIME ACHOU — não do ramo em geral.',
			COMO_CHAMAR_O_TIME,
			'Procure em fornecedor ou loja do Brasil o item pronto para gravar que um pequeno produtor compra para personalizar e revender.',
			'De cada insumo traga NÚMERO E LINK, a unidade em que a página vende e, quando a página vender em caixa ou pacote, REPITA em `rende_pecas` exatamente a contagem que ela declara.',
			'NÃO DIVIDA, NÃO MULTIPLIQUE E NÃO CALCULE PORCENTAGEM: quem faz conta é o sistema, com os números que você trouxe com fonte.',
			'NÃO traga commodity bruta cotada por quilo ou por metro quadrado — isso é insumo de quem lamina, não de quem grava.',
			'Um valor só entra em `custo_peca_brl` se a PÁGINA vender a peça avulsa por aquele preço.',
			ANTI_INVENCAO,
		].join(' '),
		/**
		 * ┌─ A PERGUNTA NÃO TINHA `{produto}`, E ERA ISSO QUE O CEGAVA ───────────┐
		 * │ MEDIDO: em 2 de 2 runs frios ele não produziu UM custo conferido —     │
		 * │ 1 url / 0 conferidas em mercado, 0 urls em produto —, enquanto o       │
		 * │ Analista de Margem da onda 1, com metade das buscas, fez 2/2 e 1/1.    │
		 * │ Nos dois dossiês o box dele imprimia "Material por peça não apurado".  │
		 * │                                                                        │
		 * │ A causa não é o teto nem a amarração de `custosDeInsumos`: é a         │
		 * │ CONSULTA. O plugin de busca do OpenRouter formula a consulta a partir  │
		 * │ da ÚLTIMA MENSAGEM DE USUÁRIO, e para quem pesquisa a mensagem de      │
		 * │ usuário é ESTA pergunta sozinha — o material vai no system (ver o      │
		 * │ comentário em `rodarAgente`). A pergunta anterior começava em "Para    │
		 * │ CADA produto listado no MATERIAL DO TIME abaixo" e não citava          │
		 * │ `{produto}` em lugar nenhum: a consulta que saía era "quanto custa a   │
		 * │ peça em branco pronta para gravar", sem ramo, sem produto, sem         │
		 * │ material. Ele voltava com página genérica sobre gravação a laser, não  │
		 * │ achava preço nenhum com fonte, e então copiava do material links que   │
		 * │ ELE não abriu — que `custosDeInsumos` recusa, e com razão (a conferência│
		 * │ é contra as citações DELE quando ele rodou agora).                     │
		 * │                                                                        │
		 * │ Os outros nove da onda 2 têm `{produto}` na pergunta e trouxeram de 5  │
		 * │ a 10 fontes cada — é a diferença entre eles e ele.                      │
		 * │                                                                        │
		 * │ Duas correções, as duas nesta pergunta: (1) `{produto}` e `{material}` │
		 * │ entram, para a consulta nascer ancorada como a do Analista de Margem;  │
		 * │ (2) a última frase exige que o link seja de uma página que ELE abriu   │
		 * │ nesta pesquisa — o que o código já cobra em silêncio, dito no prompt   │
		 * │ para ele parar de gastar token produzindo o que vai ser descartado.    │
		 * └────────────────────────────────────────────────────────────────────────┘
		 */
		pergunta:
			'Quanto custa hoje no Brasil comprar a PEÇA EM BRANCO pronta para gravar dos produtos do ramo de {produto} em {material}? Cubra os produtos listados no MATERIAL DO TIME abaixo, um a um, e diga em `produto` a qual deles aquele insumo corresponde. Procure em fornecedor, distribuidor ou loja brasileira. De CADA insumo traga: nome exato, a unidade em que a página vende (unidade avulsa, "caixa com 36 unidades", "pacote com 100 folhas"), o preço em reais, a loja e o link. Quando a página vender em caixa ou pacote, REPITA em `rende_pecas` exatamente a contagem que ela declara. Inclua a embalagem quando ela aparecer, e diga o que mais encarece a produção. O LINK DE CADA INSUMO TEM QUE SER UMA PÁGINA QUE VOCÊ ABRIU NESTA PESQUISA E QUE MOSTRA AQUELE PREÇO: link copiado do material do time é descartado pelo sistema, e o insumo vai junto.',
		// MESMO CONTRATO DE SAÍDA DO `margem`, campo por campo — a tela usa o
		// MESMO componente (`CustoDoMaterial`) para os dois, com outro cabeçalho,
		// e o mesmo `custosDeInsumos` faz a conta. Divergir um nome aqui não
		// quebraria nada visível: sairia um bloco a menos de custo, e a "Sobra
		// para você" dos cards continuaria dizendo "não apurado".
		saida: [
			'{"insumos":[{"item":"","produto":"","unidade_compra":"","preco_brl":0,',
			'"rende_pecas":null,"loja":"","url":""}],"custo_peca_brl":null,',
			'"o_que_encarece":"","observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		// Mesma escolha do Analista de Margem: preço de peça em branco está em loja
		// e em marketplace, não em conteúdo editorial. Sem `dominios_incluir` —
		// fornecedor de MDF e de acrílico quase nunca é um dos quatro canais.
		motor_busca: 'perplexity',
		max_buscas: 2,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		// Preço de insumo é retrato do mercado, não do aluno: entra no cache.
		compartilhavel: true,
		essencial: false,
		icone: 'receipt',
		cor: '#b45309',
		frase_trabalhando: 'Cotando a peça em branco de cada produto encontrado…',
		fase: 'aprofundamento',
		ordem: 52,
		// Teto = 2 × o pico medido (1139 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 2400,
		timeout_s: 75,
	},
	{
		/**
		 * DE QUEM COMPRAR — a pergunta seguinte a "quanto custa".
		 *
		 * O `custo_dos_produtos` traz o preço com link, mas um link de marketplace
		 * não é um fornecedor: quem vai produzir em série precisa de quem venda em
		 * caixa, atenda pessoa física e entregue no prazo. Sem isso o dossiê diz
		 * quanto custa e não diz onde comprar.
		 */
		chave: 'fornecedores',
		nome: 'Comprador de Insumos',
		papel: [
			'Você descobre DE QUEM COMPRAR a peça em branco: fornecedor, distribuidor e loja do Brasil que atendem pequeno produtor.',
			COMO_CHAMAR_O_TIME,
			'De cada um: o que vende, se atende pessoa física, pedido mínimo, prazo, de onde envia e o link. Só o que a página declarar.',
			'Prefira quem vende avulso ou em caixa pequena — pedido mínimo de mil peças não serve para quem está começando, e dizer isso é parte da resposta.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'ONDE comprar as peças em branco dos produtos listados no MATERIAL DO TIME abaixo, no ramo de {produto}? Procure fornecedores, distribuidores e lojas do Brasil que vendam para pequeno produtor. De CADA um traga: nome, o que vende, se atende pessoa física, pedido mínimo, prazo de entrega, de que estado envia, o link e — quando a página mostrar — o preço e a unidade em que ele é vendido. Traga de 4 a 8, priorizando quem vende avulso ou em caixa pequena.',
		// Nomes lidos por `lerFornecedores`: `fornecedores[]` com `nome`,
		// `o_que_vende`, `atende_pf`, `pedido_minimo`, `prazo`, `estado`, `url`,
		// mais `preco_brl`/`unidade_compra` — os dois só viram número na tela se
		// houver página citada, a mesma regra do custo.
		saida: [
			'{"fornecedores":[{"nome":"","o_que_vende":"","atende_pf":null,',
			'"pedido_minimo":"","prazo":"","estado":"","preco_brl":null,',
			'"unidade_compra":"","url":""}],"observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		max_buscas: 2,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'factory',
		cor: '#7c3aed',
		frase_trabalhando: 'Procurando de quem comprar a peça em branco…',
		fase: 'aprofundamento',
		ordem: 54,
		// Teto = 2 × o pico medido (806 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 1800,
	},
	{
		/**
		 * QUANTO O FRETE COME — o custo que some da conta e derruba a margem.
		 *
		 * O papel do Analista de Riscos sempre citou "margem que não fecha depois
		 * do frete e da comissão", e o frete nunca tinha sido apurado por ninguém:
		 * era risco no papel e número nenhum. Peso e volume decidem a faixa de
		 * frete, e num produto de R$ 40 a faixa errada come a margem inteira.
		 */
		chave: 'frete_logistica',
		nome: 'Analista de Frete',
		papel: [
			'Você calcula o que o FRETE tira de cada venda: peso, volume, fragilidade e a regra de cada canal.',
			COMO_CHAMAR_O_TIME,
			'Valor de frete só entra se estiver na página (tabela do canal, calculadora, regra de frete grátis). Nada de estimativa por experiência.',
			'Diga também a partir de que preço o frete grátis passa a ser obrigação do vendedor — é a regra que mais surpreende quem está começando.',
			ANTI_INVENCAO,
		].join(' '),
		// `{produto}` na pergunta NÃO é enfeite: para quem pesquisa, a pergunta
		// interpolada É a consulta que o plugin de busca formula (o material vai
		// no system). Sem ela, este especialista perguntava "quanto o frete come
		// da margem dos produtos listados no material" para um buscador que não
		// tem material nenhum — a mesma cegueira medida no Analista de Custo dos
		// Produtos. Ver o comentário da `pergunta` dele.
		pergunta:
			'Quanto o FRETE come da margem dos produtos do ramo de {produto} no Brasil? Cubra os produtos listados no MATERIAL DO TIME abaixo. Uma linha por produto e canal: o peso em quilos e as dimensões da embalagem como a página declara, o canal, quanto ele cobra hoje nessa faixa de peso e o risco de quebra no transporte (em `fragilidade`, junto com o cuidado de embalagem que o evita). Traga o link da tabela ou da regra que sustenta cada valor. Em `observacao`, diga a partir de que preço o frete grátis passa a ser obrigação do vendedor em cada canal.',
		/**
		 * Nomes lidos por `lerFrete`: `itens[]` com `produto`, `peso_kg`,
		 * `dimensoes`, `fragilidade`, `canal`, `frete_brl`, `url`.
		 *
		 * ┌─ `come_pct` NÃO EXISTE E NÃO VAI EXISTIR — decisão, não esquecimento ─┐
		 * │ `lerFrete` (dossie.tsx) lê um campo `come_pct` e a intro do box        │
		 * │ promete a porcentagem que o frete come. Nenhum `saida` do roster       │
		 * │ produz esse campo, e nos dois runs frios medidos nenhuma porcentagem   │
		 * │ apareceu — porque ninguém foi mandado trazê-la.                        │
		 * │                                                                        │
		 * │ ESCOLHA FEITA, entre as duas que existiam: o contrato NÃO passa a      │
		 * │ pedir o número. A porcentagem é uma DIVISÃO (frete ÷ preço de venda),  │
		 * │ e número dividido por modelo é o que a regra nº 3 proíbe. Fazer a      │
		 * │ conta em TypeScript também não resolve: o numerador é o frete DESTE    │
		 * │ item (com página), e o denominador teria que ser o preço DAQUELE       │
		 * │ produto com página — que o frete não traz, e casar por nome de produto │
		 * │ com a faixa de preço de outro especialista é justamente o casamento    │
		 * │ frouxo que `custoDoProduto` recusa quando é ambíguo.                   │
		 * │                                                                        │
		 * │ ⇒ QUEM CUIDA DE dossie.tsx PRECISA SABER: `come_pct` é leitor de um    │
		 * │   campo que nunca chega, e a frase do box promete um número que o      │
		 * │   produto não entrega. O lado do motor está alinhado aqui; o que falta │
		 * │   é a tela parar de prometê-lo.                                        │
		 * └────────────────────────────────────────────────────────────────────────┘
		 */
		saida: [
			'{"itens":[{"produto":"","peso_kg":null,"dimensoes":"","fragilidade":"",',
			'"canal":"","frete_brl":null,"url":""}],"observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		// Regra e tabela de frete moram na central de ajuda do canal, não em
		// anúncio: sem `dominios_incluir`.
		motor_busca: 'perplexity',
		max_buscas: 2,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'truck',
		cor: '#0369a1',
		frase_trabalhando: 'Conferindo o que o frete tira de cada venda…',
		fase: 'aprofundamento',
		ordem: 56,
		// Teto = 2 × o pico medido (1330 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 2800,
	},
	{
		/**
		 * ┌─ O 11º ESPECIALISTA: POR QUE ELE EXISTE ────────────────────────────┐
		 * │ O contrato desta rodada listou DEZ especialistas novos, e dez não    │
		 * │ fecham 22 nos dois escopos. A conta, com os cinco do rápido          │
		 * │ intocáveis: cada escopo já tem 10 no profundo, `tendencias` e        │
		 * │ `producao` são os únicos remanejamentos possíveis (+1 de cada lado), │
		 * │ e 11 + 11 = 22. Faltava exatamente UM, e a alternativa era deixar    │
		 * │ 21 — quebrando a promessa de tela — ou inventar dois em vez de um.   │
		 * │                                                                      │
		 * │ Escolhido pelo que o dossiê ainda não respondia, e não por preencher │
		 * │ vaga: o time inteiro fala de marketplace, e no ramo que o próprio    │
		 * │ dono do produto citou — brindes corporativos — o dinheiro está no    │
		 * │ pedido de 200 peças de uma empresa, não em venda unitária na Shopee. │
		 * │ Ele responde "quem compra em quantidade e como se chega até ele".    │
		 * │                                                                      │
		 * │ Não é o `publico` com outro nome: aquele traz o CONSUMIDOR FINAL e a │
		 * │ ocasião de compra; este traz o COMPRADOR EM VOLUME (empresa,         │
		 * │ papelaria, buffet, cerimonial, pet shop) e o caminho até ele.        │
		 * │                                                                      │
		 * │ ELE NASCEU SEM PONTO DE RENDER E JÁ TEM O DELE: o box "Quem compra   │
		 * │ em quantidade" existe em dossie.tsx e lê `compradores[]` com `tipo`, │
		 * │ `por_que_compra`, `pedido_tipico`, `exige`, `como_chegar` e `url` —  │
		 * │ conferido por RENDER nas quatro combinações e nos runs frios, com    │
		 * │ 118 de 118 campos dele aparecendo no HTML. O aviso que ficou aqui    │
		 * │ dizendo o contrário sobreviveu ao conserto por uma rodada inteira, e │
		 * │ um aviso falso sobre a regra que já reprovou quatro rodadas é caro:  │
		 * │ quem o lê "conserta" o que está certo, ou desliga o especialista.    │
		 * │                                                                      │
		 * │ MEXEU NO `saida` DELE? Os seis campos acima são o contrato do box.   │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		chave: 'venda_direta',
		nome: 'Analista de Venda Direta',
		papel: [
			'Você acha quem compra EM QUANTIDADE fora dos marketplaces: empresa, papelaria, loja de presente, floricultura, buffet, cerimonial, escola, igreja, pet shop, imobiliária, agência de brindes.',
			COMO_CHAMAR_O_TIME,
			'De cada tipo de comprador: por que compra, tamanho típico do pedido, o que exige (nota fiscal, prazo, amostra, exclusividade) e como se chega até ele.',
			'Cada caso precisa de uma página que o sustente — edital, matéria, catálogo de fornecedor, pedido publicado. Sem página, não afirme.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Fora dos marketplaces, QUEM compra em quantidade os produtos listados no MATERIAL DO TIME abaixo, no ramo de {produto}? Traga de 3 a 6 tipos de comprador brasileiros. De CADA um: por que compra, o tamanho típico do pedido, o que exige do fornecedor (nota fiscal, prazo, amostra), como um pequeno produtor chega até ele e o link que sustenta o caso.',
		saida: [
			'{"compradores":[{"tipo":"","por_que_compra":"","pedido_tipico":"",',
			'"exige":"","como_chegar":"","url":""}],"observacao":""}',
		].join(''),
		modelo: M_BUSCA,
		motor_busca: 'perplexity',
		max_buscas: 1,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: true,
		essencial: false,
		icone: 'handshake',
		cor: '#15803d',
		frase_trabalhando:
			'Procurando quem compra em quantidade fora do marketplace…',
		fase: 'aprofundamento',
		ordem: 58,
		// Teto = 2 × o pico medido (1341 tokens). Ver `PICOS_MEDIDOS`.
		max_tokens: 2800,
	},

	{
		/**
		 * MUDOU DE ONDA E DE ESCOPO, e as duas mudanças são a mesma decisão.
		 *
		 * Ele não pesquisa (`motor_busca: 'nenhum'`), então rodar na onda 1 era
		 * gastar a única coisa que ele tem de especial: a capacidade de LER o que
		 * os outros acharam. Na onda 2 ele responde sobre OS PRODUTOS QUE A ONDA 1
		 * ACHOU — e é isso que o faz valer no escopo mercado, onde "como produzir
		 * {produto}" sozinho viraria uma aula sobre um ramo em abstrato ("como
		 * produzir brindes corporativos"), que não ajuda ninguém.
		 *
		 * Custo de trazê-lo para o escopo mercado: zero busca. Ele só lê.
		 */
		chave: 'producao',
		nome: 'Consultor de Produção',
		papel: [
			'Você é instrutor de corte e gravação a laser. Explique COMO fazer: material, processo, ordem das operações, tempo aproximado e as armadilhas que fazem a peça sair errada.',
			'Procure a página do FABRICANTE da máquina, do fornecedor do material ou um tutorial técnico que sustente o parâmetro que você indicar — potência, velocidade, número de passes, tipo de lente. Parâmetro errado queima a peça e o material do aluno, então o que tem página vale mais que o que você lembra.',
			'Onde não achar página, responda pelo seu conhecimento técnico e diga que é experiência de oficina, não número de catálogo.',
			COMO_CHAMAR_O_TIME,
			ANTI_INVENCAO,
			TOM,
			PROSA_PARA_GENTE,
			'Responda só JSON.',
		].join(' '),
		pergunta:
			'Como produzir {produto} em {material}? Se o MATERIAL DO TIME abaixo listar produtos específicos, cubra ESSES produtos — um passo a passo por produto, começando pelos que mais aparecem. Diga o passo a passo, o que costuma dar errado e o que checar antes de cortar o lote inteiro.',
		saida:
			'{"passos":[],"materiais_necessarios":[],"armadilhas":[],"tempo_estimado_min":null,"acabamento":[],"observacao":""}',
		modelo: M_BUSCA,
		/**
		 * PASSOU A PESQUISAR — pedido do dono do produto ("tem alguns que não estão
		 * buscando, precisa todos trazerem").
		 *
		 * Ele respondia só pelo conhecimento do modelo, e o cartão dele saía com
		 * "0 fontes" no meio de um time em que todo mundo mostra de onde tirou. Só
		 * que passo a passo de gravação a laser TEM fonte: fabricante de máquina,
		 * fórum de laser, tutorial de loja de insumo. Com busca, o que ele afirma
		 * passa a ter link como o resto do time — e é a mesma regra que já vale
		 * para os outros: sem fonte, `null`.
		 *
		 * `filtrar_por_tema` desligado pela mesma razão do Analista de Margem: ele
		 * procura "parâmetro de corte para acrílico 3mm", não o nome do produto, e
		 * a página do fabricante não cita a categoria do aluno.
		 */
		motor_busca: 'perplexity',
		max_buscas: 1,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		// Depende do material que o ALUNO usa: não entra no cache compartilhado.
		compartilhavel: false,
		essencial: false,
		icone: 'wrench',
		cor: '#64748b',
		frase_trabalhando: 'Montando o passo a passo de produção…',
		fase: 'aprofundamento',
		ordem: 60,
		/**
		 * O SEGUNDO QUE MORREU NO TETO — e o único com a prova crua na mão.
		 *
		 * Run frio `produto+profundo`: as duas tentativas falharam, e a segunda
		 * fechou com `finish_reason: "length"` e `completion_tokens: 1400` EXATOS
		 * — o teto — cuspindo 4.208 caracteres de JSON cortado. O bloco "Como
		 * fazer" simplesmente não foi montado num dossiê de 6 voxxys.
		 *
		 * A causa está na própria pergunta: ela manda um passo a passo POR PRODUTO
		 * do material do time, e o material da onda 2 traz de 3 a 5 produtos. O
		 * 1.400 foi calibrado quando ele escrevia um só. O teto batido virou o
		 * pico em `PICOS_MEDIDOS` (4.208 chars ÷ 2,5) e a regra de 2× dá 3.400.
		 */
		max_tokens: 3400,
	},

	/* ══════════════ ONDA 3 — SÍNTESE (lê as ondas 1 e 2) ══════════════ */
	{
		/**
		 * MUDOU DE ONDA: era onda 1, virou SÍNTESE.
		 *
		 * O papel dele sempre mandou considerar "o que sobra de margem depois da
		 * comissão de marketplace e do frete" — e ele rodava ANTES de existir
		 * qualquer número de comissão ou de frete, então essa parte do trabalho
		 * dele era necessariamente opinião. Na síntese ele lê o que o
		 * `marketplaces`, o `frete_logistica` e o `custo_dos_produtos` trouxeram
		 * com página, e o mesmo prompt passa a ter do que falar.
		 *
		 * Efeito de borda deliberado: `fase: 'sintese'` é `protegido` em
		 * `agents.ts` e em `rodarAgente` — ele deixa de poder ser cortado pelo
		 * freio de orçamento. Custa pouco (não pesquisa, teto de 1.200 tokens) e
		 * um dossiê que promete honestidade sem a seção de risco é pior negócio.
		 */
		chave: 'riscos',
		nome: 'Analista de Riscos',
		papel: [
			'Você é o cético do time. Aponte o que pode dar errado: marca registrada e personagem licenciado, dependência de data comemorativa, concorrência de escala, margem que não fecha depois do frete e da comissão.',
			COMO_CHAMAR_O_TIME,
			'Use os números que o material trouxe (comissão do canal, frete, custo do insumo) em vez de falar de risco em geral. Não invente processo nem número.',
			'Quando o risco for regra de plataforma, marca registrada ou exigência legal, procure a PÁGINA que diz isso — regra de marketplace muda, e um risco com link o aluno consegue conferir antes de decidir não investir.',
			ANTI_INVENCAO,
			TOM,
			PROSA_PARA_GENTE,
			'Responda só JSON.',
		].join(' '),
		pergunta:
			'Com base no MATERIAL DO TIME abaixo, quais são os riscos reais de apostar em {produto}? Considere propriedade intelectual, dependência de data comemorativa, entrada de um grande vendedor e — usando a comissão, o frete e o custo de insumo que o time apurou — o que de fato sobra de margem. Diga o que fazer para reduzir cada risco.',
		saida:
			'{"riscos":[{"risco":"","gravidade":"alta|media|baixa","o_que_fazer":""}],"observacao":""}',
		modelo: M_BUSCA,
		/**
		 * PASSOU A PESQUISAR — mesmo pedido que ligou a busca do Consultor de
		 * Produção.
		 *
		 * Risco é a seção em que afirmar sem fonte custa mais caro: "marca
		 * registrada", "a Shopee mudou a regra", "esse nicho encheu" são coisas
		 * que o aluno vai usar para NÃO investir. Com busca, cada risco pode vir
		 * com a página que o sustenta — e o que ele não achar continua saindo como
		 * leitura dele, não como fato.
		 *
		 * Ele continua em `sintese`: a busca é um complemento ao material do time,
		 * não substitui a leitura dele (é do frete, da comissão e do custo que os
		 * outros apuraram que sai o risco de margem).
		 */
		motor_busca: 'perplexity',
		max_buscas: 1,
		filtrar_por_tema: false,
		modo: 'profundo',
		escopo: 'ambos',
		/**
		 * SAIU DO CACHE junto com a mudança de onda, pela MESMA razão que tirou o
		 * Curador de lá: a saída de um sintetizador é função do material DAQUELA
		 * execução, não retrato do mercado. Deixá-lo `true` teria duas
		 * consequências, e a segunda é visual: (1) ele serviria a análise de risco
		 * feita sobre OUTRO material, sem ter visto o frete nem o custo deste run;
		 * (2) `montarTime` só marca como `aproveitado` quem é `compartilhavel`, e
		 * um sintetizador aproveitado põe a sala de guerra desenhando um feixe de
		 * dados correndo para um cartão que já nasceu concluído.
		 */
		compartilhavel: false,
		essencial: false,
		icone: 'shield-alert',
		cor: '#ef4444',
		frase_trabalhando: 'Procurando o que pode dar errado…',
		fase: 'sintese',
		ordem: 70,
		/**
		 * DECLARADO, e não mais herdado do padrão de 1.200.
		 *
		 * Ele mudou de onda nesta rodada: era da onda 1 (onde falava de risco em
		 * abstrato) e virou síntese, que LÊ o digest de 17 especialistas e agora
		 * tem comissão, frete e custo de insumo para citar em cada risco. Mais
		 * material para ler é mais risco concreto para escrever, e o teto tinha
		 * ficado onde estava.
		 *
		 * São de 4 a 6 riscos, cada um com o risco, a gravidade e o que fazer para
		 * reduzi-lo — e o "o que fazer" é a parte que se alonga quando ele pode
		 * dizer "sua margem some se o frete passar de R$ X" em vez de "cuidado com
		 * o frete". Pico medido de 971 tokens, teto = 2 × pico (`PICOS_MEDIDOS`).
		 * Herdar do padrão tinha um segundo custo: qualquer mexida em
		 * `PADRAO.maxTokens` movia este especialista em silêncio.
		 */
		max_tokens: 2000,
	},

	{
		chave: 'redator',
		nome: 'Redator de Anúncios',
		papel: [
			'Você escreve o ANÚNCIO pronto para publicar — não conselhos sobre como escrever.',
			'Você recebe os títulos dos anúncios que MAIS VENDEM e as reclamações dos clientes.',
			COMO_CHAMAR_O_TIME,
			'Use os títulos como referência do que funciona naquele marketplace (palavra-chave no começo, medida, material, para quem serve).',
			'Use as reclamações ao contrário: se reclamam que a gravação apaga, prometa que a sua não apaga.',
			TOM,
			USANDO_A_MARCA,
			'NUNCA prometa o que não foi verificado (frete grátis, prazo, garantia) e NUNCA use marca registrada, personagem ou time.',
			'Seja CONCISO: bullets de até 90 caracteres, descrição de até 400, legenda de até 300. O JSON precisa fechar.',
			PROSA_PARA_GENTE,
			'Responda só JSON.',
		].join(' '),
		/**
		 * `{marca}` — a identidade da empresa de quem vai publicar.
		 *
		 * A variável vem de `varsDaMarca` (src/lib/marca.ts), que o bloco funde no
		 * mesmo saco de `{produto}`/`{material}`. Ela é a diferença entre um
		 * anúncio genérico e o anúncio DESTA empresa — e é o motivo de o aluno
		 * cadastrar a marca uma vez só, no Estúdio, em vez de repetir tom, público
		 * e proibições em cada ferramenta.
		 *
		 * QUEM NÃO TEM MARCA NÃO PERDE NADA: `interpolar` apaga o token vazio (e a
		 * preposição que o introduzia), e a pergunta volta a ser exatamente a de
		 * antes. Não existe caminho de erro por falta de marca.
		 *
		 * A posição também é escolhida: DEPOIS do produto e ANTES do pedido. Antes
		 * do produto, o modelo lê a identidade sem saber do que se trata; depois do
		 * pedido, ela chega quando ele já decidiu o tom.
		 */
		pergunta:
			'Escreva o anúncio para vender {produto}. {marca} Dê: 3 opções de título (até 60 caracteres, no estilo que funciona em marketplace), 5 bullets de descrição, um texto curto de descrição, as palavras-chave para busca, e uma legenda de Instagram com chamada. Diga também que fotos tirar.',
		saida: [
			'{"titulos":[],"bullets":[],"descricao":"","palavras_chave":[],',
			'"legenda_instagram":"","fotos_tirar":[],"observacao":""}',
		].join(''),
		modelo: M_ESCRITA,
		motor_busca: 'nenhum',
		max_buscas: 0,
		modo: 'profundo',
		escopo: 'ambos',
		// Depende de como ESTE aluno vai se posicionar: não entra no cache.
		compartilhavel: false,
		essencial: false,
		icone: 'pen-line',
		cor: '#a855f7',
		frase_trabalhando: 'Escrevendo o anúncio pronto para publicar…',
		fase: 'sintese',
		ordem: 85,
		/**
		 * Três títulos + cinco bullets + descrição + legenda + fotos não cabem em
		 * 2000: o JSON vinha truncado e a extração falhava em silêncio.
		 *
		 * O 4.000 anterior era o TETO DO SISTEMA, não uma medida dele: tanto o
		 * campo da coleção quanto `toAgentSpec` travavam ali, e o comentário desta
		 * linha registrava isso ("4000 é o teto real"). Com os dois tetos em 8.000
		 * (ver `MAX_TOKENS_TETO`), o número voltou a ser escolha — e a escolha
		 * medida foi para BAIXO.
		 *
		 * 5.000, e o número tem uma medição CONTRA ele que virou a favor: com o
		 * teto em 5.000 ele fechou em 1.736 tokens (`mercado+profundo`) e 1.763
		 * (`produto+profundo`) — 35% do teto —, o que sugeria baixar para 3.000 e
		 * devolver orçamento. Baixado para 3.000, o run seguinte do MESMO ramo
		 * derrubou o especialista nas DUAS tentativas e o box "Anúncio pronto
		 * para publicar" sumiu do dossiê.
		 *
		 * ┌─ POR QUE O TETO NÃO PODE SER MEDIDO PELO TAMANHO DO JSON ───────────┐
		 * │ `max_tokens` limita a SAÍDA INTEIRA da chamada, e num modelo híbrido  │
		 * │ como o Sonnet a saída inclui o raciocínio interno, que não aparece em │
		 * │ lugar nenhum do dossiê. Medido: a chamada dele fechou com 3.000       │
		 * │ tokens de saída e `content` VAZIO — o teto foi consumido antes de a   │
		 * │ primeira chave do JSON ser escrita. O JSON dele cabe em ~1.800; o que │
		 * │ ele precisa é de 1.800 MAIS o que o modelo gastar pensando, que varia │
		 * │ de run para run e chegou a 3 mil.                                     │
		 * │                                                                       │
		 * │ Ou seja: a folga aqui não é gordura, é a parte da conta que não dá    │
		 * │ para prever. Ela custa projeção de pior caso (US$ 0,05 no `maxUsd`) e │
		 * │ compra o box inteiro — que é o pedido "o anúncio pronto" do cartão.    │
		 * └───────────────────────────────────────────────────────────────────────┘
		 */
		max_tokens: 5000,
		timeout_s: 90,
	},

	{
		/**
		 * A RESPOSTA que o aluno veio buscar no escopo mercado.
		 *
		 * "Traga os produtos pra pessoa já começar — os que estão numa margem
		 * essencial de lucro ou os que estão no mercado sem competitividade."
		 * Foi o pedido, com essas palavras. O radar, o Caçador de Brechas e o
		 * Analista de Margem levantam os três lados; este aqui CRUZA e escolhe.
		 * No profundo ele passou a cruzar mais dois: o custo por produto e as
		 * reclamações, os dois apurados na onda 2 EM CIMA da lista que ele vai
		 * ranquear — que é a diferença entre escolher com o custo do ramo e
		 * escolher com o custo daquele produto.
		 *
		 * Não pesquisa de propósito (`motor_busca: 'nenhum'`): escolher entre o
		 * que já foi verificado é trabalho de leitura, e uma busca extra aqui só
		 * traria produto sem fonte para a lista mais visível do dossiê.
		 *
		 * Haiku, e não Sonnet: a tarefa é extrair e ranquear a partir do
		 * material — não redigir. Sonnet custa 2× na saída e este é o JSON mais
		 * longo da onda 2 depois do Estrategista; no rápido, que só cobra 2
		 * voxxys, essa diferença é a margem.
		 */
		chave: 'curadoria',
		nome: 'Curador de Oportunidades',
		papel: [
			'Você escolhe por quais produtos a pessoa deve COMEÇAR. Você não pesquisa: lê o material que o time trouxe e decide.',
			COMO_CHAMAR_O_TIME,
			'Prefira o que junta as duas coisas: SOBRA DINHEIRO (o preço de venda encontrado é bem maior que o custo de insumo levantado) e TEM POUCA GENTE VENDENDO BEM.',
			TOM,
			'SÓ ENTRA PRODUTO QUE APARECEU NO MATERIAL, com link. Lista inventada faz a pessoa comprar material errado e perder dinheiro de verdade — se o material não sustentar nenhum produto, devolva `produtos` vazio e explique em `observacao` o que faltou.',
			'`margem_faixa`, `concorrencia` e `esforco` são CLASSES, nunca porcentagem nem nota. A margem em % é calculada pelo sistema a partir dos números com fonte: não faça conta nenhuma.',
			'Em `preco_venda_brl` copie a faixa que apareceu nos anúncios (min e max). Em `custo_estimado_brl` use o custo por peça levantado pelo time — o do Analista de Custo dos Produtos, que apurou produto a produto, tem preferência sobre o do Analista de Margem, que apurou o insumo do ramo. Faltou? `null` — nunca chute.',
			'Preencha `por_que_pouca_concorrencia` só quando `concorrencia` for baixa; caso contrário, deixe vazio.',
			'`primeiro_passo` é o que a pessoa faz AMANHÃ ("compre meia chapa de MDF 3mm, corte 10 e anuncie na Shopee por R$ X"), não conselho genérico.',
			'Escolha de 3 a 5 produtos. Menos e melhor: esta lista é a primeira coisa que a pessoa vai ler.',
			PROSA_PARA_GENTE,
			'Responda só JSON.',
		].join(' '),
		pergunta:
			'Com base no material do time sobre o ramo de {produto}, escolha os produtos por onde esta pessoa deve começar hoje. De cada um diga: por que agora, para quem é, em que material se faz, onde vender, o primeiro passo concreto e o link do anúncio que serviu de exemplo.',
		saida: [
			'{"produtos":[{"nome":"","por_que_agora":"","publico":"",',
			'"preco_venda_brl":{"min":null,"max":null},"custo_estimado_brl":null,',
			'"margem_faixa":"alta|media|baixa|nao_apurado",',
			'"concorrencia":"baixa|media|alta|nao_apurado",',
			'"por_que_pouca_concorrencia":"","esforco":"facil|medio|dificil",',
			'"material":"","onde_vender":"","primeiro_passo":"",',
			// Sem `imagem_url`: ele roda com `motor_busca: 'nenhum'` e não abriu
			// página nenhuma, então nunca teve como ver a foto de nenhuma. O que
			// ele escrevia ali era um CDN plausível que o motor tomava por foto
			// pronta — `normalizarProdutos` já zerava o campo por isso.
			'"url_exemplo":""}],"observacao":""}',
		].join(''),
		modelo: M_REVISOR,
		motor_busca: 'nenhum',
		max_buscas: 0,
		modo: 'ambos',
		escopo: 'mercado',
		/**
		 * FORA DO CACHE DE 7 DIAS — e este é o único sintetizador que já esteve
		 * dentro dele.
		 *
		 * Estava `true` com o argumento "é retrato do mercado: dois alunos
		 * perguntando pelo mesmo ramo na mesma semana merecem a mesma lista".
		 * O argumento é bonito e está errado, porque confunde o INSUMO com o
		 * PRODUTO: o cache guarda o que os PESQUISADORES viram na web (isso sim é
		 * retrato do mercado, e continua cacheado); a saída do Curador é uma
		 * função do material DAQUELA execução — de quantos especialistas rodaram,
		 * de qual modo era, e de o Analista de Margem ter tido ou não orçamento
		 * de busca naquele run.
		 *
		 * A falha concreta, que sai de graça: alguém roda `mercado+rápido` em
		 * "brindes corporativos"; a curadoria é feita sobre 3 pesquisadores e vai
		 * para a chave de cache `mercado|<slug>|<uf>|v1`. Pelos 7 dias seguintes
		 * TODA execução `mercado+profundo` na mesma categoria (6 voxxys, R$ 7,20)
		 * acha `curadoria` em `cobertos`, marca o Curador como `aproveitado`, NÃO
		 * o roda — e devolve a lista do run barato, sem nunca ter enxergado o que
		 * `marketplaces`, `tendencias` e `riscos` trouxeram, com o "não apurado"
		 * herdado junto. O aluno pagou o triplo por uma lista de segunda mão.
		 *
		 * Efeito colateral que vale por si: `montarTime` só marca como
		 * `aproveitado` quem é `compartilhavel`. Com esta linha em `false`, NENHUM
		 * agente de `fase: 'sintese'` pode nascer aproveitado — que é a premissa
		 * de toda a sala de guerra (o cartão do aproveitado nasce concluído e não
		 * anima como quem trabalha; um sintetizador aproveitado punha um feixe de
		 * dados correndo para um cartão que não estava trabalhando).
		 *
		 * O que custa: o Curador (Haiku, teto de 2000 tokens ≈ US$ 0,016) roda em
		 * todo run de mercado, inclusive com cache quente — mas aí ele lê o digest
		 * montado a partir dos textos cacheados, então o gasto é só o dele.
		 * Barato perto de entregar a lista errada, que é a primeira coisa que a
		 * pessoa lê e a que decide qual material ela vai comprar.
		 *
		 * ATENÇÃO no bloco: `ai-research-team.ts` tem um fallback que procura o
		 * JSON do Curador dentro do `cachePayload`, justificado por escrito com
		 * "o Curador é `compartilhavel`". Com esta linha em `false` ele nunca mais
		 * é gravado no cache; o fallback vira código morto que só pode servir uma
		 * lista velha de OUTRA execução, e deve sair.
		 */
		compartilhavel: false,
		essencial: false,
		icone: 'package-check',
		cor: '#6366f1',
		frase_trabalhando: 'Escolhendo por quais produtos você deve começar…',
		fase: 'sintese',
		ordem: 80,
		/**
		 * A CONTA DE 2.000 ESTAVA ERRADA, e a medição mostrou onde.
		 *
		 * "Cinco produtos × catorze campos ≈ 1.300 tokens" subestimava o que ele
		 * escreve de fato: `por_que_agora`, `primeiro_passo` e
		 * `por_que_pouca_concorrencia` são frases, não valores, e a URL de exemplo
		 * sozinha come 100 caracteres. Medido num run frio de `mercado+profundo`:
		 * a chamada dele fechou em 2.000 tokens EXATOS — no teto —, o JSON veio
		 * cortado, o especialista foi refeito em outro modelo e o run pagou as
		 * DUAS chamadas (US$ 0,021 + US$ 0,008). Como ele é `sintese`, o freio de
		 * custo nem chega a olhar para o retry dele: o estouro passa direto.
		 *
		 * E OS 3.000 QUE VIERAM DEPOIS TAMBÉM FICARAM CURTOS — 50% de folga foi
		 * escolha, não medição, e a medição diz outra coisa: o pico dele é 2.704
		 * tokens (JSON de 6.759 caracteres num `mercado+profundo`), ou seja 85% de
		 * um teto de 3.000. Ele é o segundo maior gasto de saída do time depois do
		 * Estrategista e roda também no RÁPIDO, que cobra 2 voxxys — mas a conta
		 * de "quanto custa a folga" é a mesma do resto do roster: ela só é cobrada
		 * se for USADA, e o retry dele, que é `sintese` e passa direto pelo freio
		 * de custo, custa as duas chamadas. Teto = 2 × pico (`PICOS_MEDIDOS`).
		 */
		max_tokens: 5600,
		timeout_s: 90,
	},
	{
		chave: 'estrategista',
		nome: 'Estrategista de Negócio',
		papel: [
			'Você escreve o resultado final para quem vai VENDER — não um relatório, um conselho.',
			TOM,
			COMO_CHAMAR_O_TIME,
			'Comece pelo que a pessoa deve FAZER, não pelo que você analisou.',
			'NUNCA invente número: use só o que veio no material do time e escreva "não apurado" quando faltar.',
			'A faixa de preço de mercado JÁ VEM CALCULADA — não recalcule nem arredonde, apenas explique o que ela significa.',
			'Em `preco_sugerido`, diga por quanto ESTA pessoa deveria vender: um preço de entrada (para conquistar os primeiros clientes), um preço justo (o que você recomenda) e um premium (dizendo o que precisa entregar para cobrar isso).',
			'`resumo_simples` é para quem NUNCA vendeu: 3 a 4 frases, sem número solto, explicando a situação como você explicaria para um amigo.',
			PROSA_PARA_GENTE,
			'Responda só JSON.',
		].join(' '),
		pergunta:
			'Com base no material do time, escreva o resultado sobre {produto}. Dê uma nota de oportunidade de 0 a 100 e justifique numa frase que qualquer pessoa entenda. Depois: por quanto vender, onde vender primeiro, e o que fazer nos próximos 7 dias em passos concretos.',
		saida: [
			'{"nota":0,"veredito":"","por_que":"",',
			'"resumo_simples":"",',
			'"preco_sugerido":{"entrada_brl":null,"justo_brl":null,"premium_brl":null,"por_que":""},',
			'"onde_comecar":{"canal":"","por_que":""},',
			'"pontos_fortes":[],"pontos_fracos":[],',
			'"plano_7_dias":[{"dia":1,"acao":""}],"observacao":""}',
		].join(''),
		modelo: M_ESCRITA,
		motor_busca: 'nenhum',
		max_buscas: 0,
		modo: 'ambos',
		escopo: 'ambos',
		compartilhavel: false,
		essencial: true,
		icone: 'target',
		cor: '#f97316',
		frase_trabalhando: 'Escrevendo o que você deve fazer…',
		fase: 'sintese',
		ordem: 90,
		/**
		 * ┌─ 4.000 DERRUBAVA O RUN INTEIRO, E A CONTA É DO MATERIAL NOVO ─────────┐
		 * │ O maior JSON do time (nota + resumo + três preços + plano de 7 dias +  │
		 * │ duas listas) — e o único que, faltando, faz o bloco devolver 502 e o   │
		 * │ controller estornar: ele é `essencial`.                                │
		 * │                                                                        │
		 * │ MEDIDO em runs frios de `mercado+profundo`: a chamada dele fechava com │
		 * │ saída = 4.000 tokens EXATOS (o teto) e JSON cortado no meio; em 2 de 5 │
		 * │ tentativas nem o retry salvou, e o aluno que esperou ~100 s vendo os   │
		 * │ 22 entregarem recebeu erro. No escopo produto ele fechava em 2.104 e   │
		 * │ 3.292 tokens e passava — por isso o defeito só aparecia em mercado.    │
		 * │                                                                        │
		 * │ A CAUSA é desta rodada: a onda 3 passou a receber o digest de DUAS     │
		 * │ ondas (17 especialistas, teto de 28 mil caracteres ≈ 7 mil tokens de   │
		 * │ entrada, contra ~6 mil caracteres de uma onda só). Ele escreve o       │
		 * │ veredito SOBRE o que leu: mais material é mais ponto forte, mais ponto │
		 * │ fraco e um plano de 7 dias com passo concreto por dia.                 │
		 * │                                                                        │
		 * │ 8.000 SAIU DE MEDIÇÃO, e a medição tem duas partes. A primeira: com o  │
		 * │ teto em 6.000 ele fechou em 5.708 tokens POR VONTADE PRÓPRIA num run   │
		 * │ frio de `mercado+profundo` (parou antes do teto), e em 3.084 no escopo │
		 * │ produto — o tamanho natural da resposta neste material é ~5,7 mil,     │
		 * │ 43% ACIMA dos 4.000 em que ele batia. A segunda, que é a que manda:    │
		 * │ com o teto em 7.000, o run seguinte do MESMO ramo consumiu os 7.000    │
		 * │ inteiros e veio cortado. `max_tokens` limita a SAÍDA INTEIRA, e num    │
		 * │ modelo híbrido isso inclui o raciocínio interno, que não chega ao      │
		 * │ dossiê e varia de run para run — o mesmo efeito derrubou o Redator com │
		 * │ `content` vazio (ver o registro dele). O teto tem que caber o JSON     │
		 * │ MAIS o que o modelo gastar pensando.                                   │
		 * │                                                                        │
		 * │ E 8.000 TAMBÉM FICOU CURTO: num quinto run frio (`mercado+profundo`,   │
		 * │ "Brindes corporativos") ele fechou em 7.278 tokens — 91% do teto, com  │
		 * │ `finish_reason: stop` por sorte de um empurrão. Nos outros três do     │
		 * │ mesmo lote: 3.105 · 3.509 · 4.590. A oscilação é o raciocínio, não o   │
		 * │ dossiê, e um teto que o pico encosta é um estorno esperando a vez.     │
		 * │                                                                        │
		 * │ 9.000 é o TETO DE CÓDIGO (`MAX_TOKENS_TETO`), e ele existe por         │
		 * │ relógio: ao ritmo medido deste especialista (11,8 a 13,1 ms por token  │
		 * │ de saída em 4 runs; 7.278 tokens em 85,6 s), 9.000 tokens são ~115 s   │
		 * │ — dentro dos 120 s de `deadlineMs` do modo rápido e do maior           │
		 * │ `timeout_s` que o motor aceita. Acima disso ele morreria por TIMEOUT,  │
		 * │ que não é retriável e estorna o run. Ou seja: este especialista está   │
		 * │ configurado no máximo que o sistema comporta, e o que sobra de         │
		 * │ proteção é o retry. (O teto subiu de 8.000 para 9.000 quando a conta   │
		 * │ do `MAX_TOKENS_TETO` foi refeita contra o deadline REAL de 120 s — o   │
		 * │ comentário de lá justificava o número com 95 s, que não existe mais.)  │
		 * │                                                                        │
		 * │ ┌─ O QUE ISTO CUSTOU NO RÁPIDO, DITO POR INTEIRO ────────────────────┐ │
		 * │ │ Ele é o MESMO registro nos dois modos, então o teto novo vale para  │ │
		 * │ │ o rápido também — e lá ele encareceu. Medido em `mercado+rápido`,   │ │
		 * │ │ três runs frios: US$ 0,0816 · 0,0977 · 0,1084 (margem 81,3% ·       │ │
		 * │ │ 77,6% · 75,2% a 2 voxxys), contra US$ 0,0730 (83,3%) com o teto de  │ │
		 * │ │ 4.000. Os cinco runs de rápido ficaram acima do piso de 75%, mas o  │ │
		 * │ │ pior encostou nele.                                                 │ │
		 * │ │                                                                     │ │
		 * │ │ E é assim mesmo porque a alternativa é pior: no PRIMEIRO desses     │ │
		 * │ │ runs ele escreveu 4.028 tokens — ou seja, com o teto de 4.000 ESTE  │ │
		 * │ │ run de rápido teria vindo com o JSON cortado, pagado o retry (mais  │ │
		 * │ │ caro que a diferença) ou estornado. O que oscila não é o tamanho do │ │
		 * │ │ dossiê (o JSON dele fica em 4,3 a 5,6 mil caracteres nos seis runs) │ │
		 * │ │ e sim quanto o modelo gasta PENSANDO antes de escrever: 2,7 mil a   │ │
		 * │ │ 6,7 mil tokens de saída para a mesma quantidade de texto visível.   │ │
		 * │ │                                                                     │ │
		 * │ │ CAMINHO CONHECIDO, NÃO TOMADO: dá para pedir ao provedor um teto de │ │
		 * │ │ raciocínio (`reasoning`) e tornar esse gasto previsível. Mexe na    │ │
		 * │ │ chamada de TODOS os especialistas, inclusive nos que não são        │ │
		 * │ │ Anthropic, e trocaria uma oscilação medida por um risco não medido  │ │
		 * │ │ na qualidade do veredito — que é o texto que o aluno lê primeiro.   │ │
		 * │ └─────────────────────────────────────────────────────────────────────┘ │
		 * │                                                                        │
		 * │ O QUE ISSO CUSTA, dito por inteiro: a projeção de pior caso desta      │
		 * │ chamada sobe US$ 0,03 (3.000 tokens × US$ 10/M do Sonnet) e entra no   │
		 * │ pico que `LIMITES_PADRAO.maxUsd` precisa cobrir — nos DOIS modos, que  │
		 * │ é por isso que o teto do rápido subiu junto. O que ela ECONOMIZA é o   │
		 * │ retry, que acontecia em 100% dos runs de mercado e custava US$ 0,06 —  │
		 * │ mais os runs estornados, que custam o run inteiro e rendem zero.       │
		 * └────────────────────────────────────────────────────────────────────────┘
		 */
		max_tokens: 9000,
		timeout_s: 120,
	},
	{
		chave: 'auditor',
		nome: 'Revisor de Dados',
		papel: [
			'Você confere o trabalho do time antes de chegar ao aluno. Para cada afirmação NUMÉRICA do material, verifique se existe fonte citada que a sustente.',
			'Marque como não sustentada tudo que não tiver. Não conserte nada — só aponte.',
			COMO_CHAMAR_O_TIME,
			PROSA_PARA_GENTE,
			'Responda só JSON, em português do Brasil.',
		].join(' '),
		pergunta:
			'Confira o material sobre {produto}. Liste as afirmações numéricas sem fonte e diga o nível de confiança geral.',
		saida:
			'{"sem_fonte":[],"confianca_geral":"alta|media|baixa","o_que_falta":[],"observacao":""}',
		modelo: M_REVISOR,
		motor_busca: 'nenhum',
		max_buscas: 0,
		modo: 'profundo',
		escopo: 'ambos',
		compartilhavel: false,
		essencial: false,
		icone: 'scan-search',
		cor: '#14b8a6',
		frase_trabalhando: 'Conferindo se cada número tem fonte…',
		fase: 'sintese',
		ordem: 95,
		// Lê o material inteiro e lista cada afirmação sem fonte: no teto padrão
		// de 1200 o JSON vinha cortado no meio.
		max_tokens: 2500,
		timeout_s: 90,
	},
];

/**
 * Quantos cartões a sala de guerra promete em cada modo. Ver o cabeçalho.
 *
 * Escrito à mão de propósito, e conferido contra `TETO_POR_MODO` em
 * `conferirTamanhoDoTime`: o literal daqui é a PROMESSA (o que este arquivo se
 * compromete a entregar), a constante de lá é o TETO (o que o motor deixa
 * passar). Fazer `TAMANHO_DO_TIME = TETO_POR_MODO` esconderia a única
 * divergência que importa — teto menor que roster não quebra nada, apenas corta
 * o último da `ordem` em silêncio.
 */
const TAMANHO_DO_TIME = { rapido: 5, profundo: 22 } as const;

/**
 * Quem ficaria SEM BUSCA nesta combinação, e por quê.
 *
 * A UNIDADE É A CHAMADA, e essa é a correção mais importante desta função.
 * `rodarAgente` (ai-research-team.ts) reserva `podeBuscar(1)` / `reservar(1)`
 * por especialista porque é assim que o provedor cobra — `search.ts`
 * contabiliza `buscas = usaBusca ? 1 : 0`, não importa quantos resultados
 * foram pedidos. `max_buscas` NÃO é cota de orçamento: ele vira
 * `maxResults = max(3, max_buscas × 5)`, ou seja, dimensiona o que VOLTA de uma
 * única chamada; `0` é o jeito de dizer "este não pesquisa".
 *
 * Esta função simulava a reserva por VAGA (Σ `max_buscas`), unidade que o bloco
 * abandonou. Com ela o seed acusava `tendencias` de rodar cego em
 * `mercado+profundo` (9 "vagas" contra teto 8) enquanto ele pesquisava
 * normalmente, e o texto do aviso ainda mandava fazer uma troca que já estava
 * feita. Guarda que grita lobo é pior que guarda nenhum: o conserto natural de
 * quem acredita nele é subir `maxBuscas` — afrouxar o teto de CUSTO para
 * calar um defeito que não existe.
 *
 * A reserva NÃO se solta entre as ondas: o `Budget` é um só para a execução
 * inteira, e o que a onda 1 gastou a onda 2 não tem mais. Com três ondas isso
 * deixou de ser detalhe — são 17 chamadas com busca em `produto+profundo`, 8 na
 * onda 1 e 9 na onda 2, e é a ONDA 2 QUE FICA CEGA se o teto for curto: ela
 * pesquisa por último. Cegar a onda 2 é o pior caso possível, porque é ela que
 * traz concorrente, foto, reclamação e custo por produto — as seções novas
 * inteiras sairiam vazias com o run cobrado igual.
 *
 * Dentro de cada onda, os pesquisadores são despachados na mesma volta síncrona
 * (concorrência 6, e todos chamam `podeBuscar` antes de qualquer um registrar
 * gasto): o contador de cobrados é zero e só a RESERVA decide. Quem não couber
 * roda com ZERO busca — a pior coisa que pode acontecer neste produto, porque o
 * papel proíbe número sem página citada: ele devolve `null`, a tela mostra "não
 * apurado" na célula que decide a compra do material e a sala de guerra carimba
 * o cartão dele com "SEM BUSCA".
 */
function quemRodaCego(
	selecionados: Especialista[],
	teto: number,
): { cegos: string[]; chamadas: number; resultados: number } {
	// A ordem do despacho é a do motor: `ORDEM_DAS_ONDAS` (descoberta →
	// aprofundamento → síntese), `ordem` crescente dentro de cada onda, desempate
	// por chave. Sem reproduzi-la, a simulação escolhe a vítima errada — e a
	// posição da onda é o que mais pesa agora que a onda 2 pesquisa.
	const posicaoDaOnda = (a: Especialista) =>
		ORDEM_DAS_ONDAS.indexOf(a.fase ?? 'descoberta');

	const comBusca = selecionados
		.filter((a) => a.motor_busca !== 'nenhum' && a.max_buscas > 0)
		.sort(
			(a, b) =>
				posicaoDaOnda(a) - posicaoDaOnda(b) ||
				a.ordem - b.ordem ||
				a.chave.localeCompare(b.chave),
		);

	let reservadas = 0;
	const cegos: string[] = [];
	for (const a of comBusca) {
		// Espelha `podeBuscar(1)` + `reservar(1)`, uma vaga por CHAMADA.
		if (reservadas + 1 <= teto) reservadas += 1;
		else cegos.push(a.chave);
	}
	return {
		cegos,
		chamadas: comBusca.length,
		resultados: comBusca.reduce((t, a) => t + a.max_buscas, 0),
	};
}

/** Os selecionados de uma combinação, na ordem em que o motor os montaria. */
function timeDaCombinacao(
	modo: 'rapido' | 'profundo',
	escopo: 'produto' | 'mercado',
): Especialista[] {
	return TIME.filter(
		(a) =>
			(a.modo === 'ambos' || a.modo === modo) &&
			(a.escopo === 'ambos' || a.escopo === escopo),
	);
}

/**
 * Ícone ou cor repetidos DENTRO de uma combinação.
 *
 * Com 5 cartões a repetição passava despercebida; com 22 na tela ao mesmo tempo
 * dois cartões azuis com o mesmo ícone são dois cartões que o aluno não
 * consegue distinguir enquanto tenta acompanhar quem está trabalhando.
 *
 * A conferência é POR COMBINAÇÃO, e não global, porque é isso que a tela
 * mostra: `preco_mercado` e `radar_oportunidades` dividem o `#f59e0b` desde
 * sempre e nunca aparecem juntos — um é `escopo: 'produto'`, o outro
 * `'mercado'`. Proibir globalmente obrigaria a inventar uma cor a mais para um
 * conflito que não existe na tela de ninguém.
 */
function conferirIconesECores(selecionados: Especialista[]): string[] {
	const problemas: string[] = [];
	for (const campo of ['icone', 'cor'] as const) {
		const porValor = new Map<string, string[]>();
		for (const a of selecionados) {
			const lista = porValor.get(a[campo]) ?? [];
			lista.push(a.chave);
			porValor.set(a[campo], lista);
		}
		for (const [valor, chaves] of porValor) {
			if (chaves.length > 1) {
				problemas.push(`${campo} '${valor}' repetido em ${chaves.join(' + ')}`);
			}
		}
	}
	return problemas;
}

/**
 * Confere a promessa ANTES de gravar qualquer coisa.
 *
 * O tamanho do time é a única coisa deste arquivo que quebra em silêncio: mudar
 * o `escopo` de um especialista não dá erro de tipo, não derruba teste e só
 * aparece quando o aluno conta os cartões na tela e vê 21 onde foi prometido
 * 22. A conta é barata; deixar de fazê-la já custou "1/3 PROFISSIONAIS" numa
 * tela paga.
 *
 * Confere a seleção NATURAL (antes do teto de `selecionarAgentes`) de propósito:
 * se ela já bate no número, o teto nunca precisa cortar ninguém — e ninguém é
 * cortado sem que este arquivo saiba.
 */
function conferirTamanhoDoTime(): void {
	const problemas: string[] = [];
	const semBusca: string[] = [];

	/**
	 * A promessa deste arquivo contra o teto do motor.
	 *
	 * São dois números que precisam ser iguais em dois repositórios de decisão
	 * diferentes (roster = dado; `TETO_POR_MODO` = código). Teto MENOR que o
	 * roster não quebra nada de forma visível: `montarTime` corta os últimos da
	 * `ordem` que não são protegidos, o run roda, e a tela promete 22 e mostra o
	 * que couber.
	 */
	for (const modo of ['rapido', 'profundo'] as const) {
		if (TETO_POR_MODO[modo] !== TAMANHO_DO_TIME[modo]) {
			problemas.push(
				`${modo}: este arquivo promete ${TAMANHO_DO_TIME[modo]} e TETO_POR_MODO ` +
					`(src/lib/research/agents.ts) deixa passar ${TETO_POR_MODO[modo]} — ` +
					'o menor dos dois é o que o aluno vê.',
			);
		}
	}

	console.log('Time por combinação (modo × escopo):');
	for (const modo of ['rapido', 'profundo'] as const) {
		for (const escopo of ['produto', 'mercado'] as const) {
			const selecionados = timeDaCombinacao(modo, escopo);
			const esperado = TAMANHO_DO_TIME[modo];
			const teto = LIMITES_PADRAO[modo].maxBuscas;
			const { cegos, chamadas, resultados } = quemRodaCego(selecionados, teto);
			const ok = selecionados.length === esperado;
			if (!ok) {
				problemas.push(
					`${escopo}+${modo}: ${selecionados.length} especialistas, esperado ${esperado} (${selecionados.map((a) => a.chave).join(', ')})`,
				);
			}
			for (const p of conferirIconesECores(selecionados)) {
				problemas.push(`${escopo}+${modo}: ${p}`);
			}
			if (cegos.length > 0) {
				semBusca.push(
					`${escopo}+${modo}: ${chamadas} chamadas com busca contra maxBuscas=${teto}` +
						` → roda(m) SEM BUSCA: ${cegos.join(', ')}`,
				);
			}
			// `resultados` (Σ `max_buscas`) aparece só como informação de tamanho de
			// resposta — é `maxResults`, não cota. Fica separado do teto de propósito:
			// somar as duas colunas foi exatamente o erro que fez este guarda acusar
			// um inocente.
			console.log(
				`  ${ok ? '✓' : '✗'} ${`${escopo}+${modo}`.padEnd(18)} ${String(selecionados.length).padStart(2)} especialistas ·` +
					` busca: ${chamadas}/${teto} chamadas (${resultados} resultados pedidos)` +
					` ≈ US$ ${(chamadas * 0.005).toFixed(3)}${cegos.length > 0 ? `  ⚠ cego: ${cegos.join(', ')}` : ''}`,
			);
			// Quem entrou, ONDA POR ONDA — a quebra por onda é o que mostra na hora
			// se um especialista novo caiu na onda errada (pesquisar sem o material
			// da onda 1 é a diferença entre a onda 2 e uma cópia mais cara da 1).
			for (const onda of ORDEM_DAS_ONDAS) {
				const daOnda = selecionados.filter(
					(a) => (a.fase ?? 'descoberta') === onda,
				);
				if (daOnda.length === 0) continue;
				const buscam = daOnda.filter(
					(a) => a.motor_busca !== 'nenhum' && a.max_buscas > 0,
				).length;
				console.log(
					`      ${onda.padEnd(15)} ${String(daOnda.length).padStart(2)} (${buscam} com busca): ` +
						daOnda
							.slice()
							.sort((a, b) => a.ordem - b.ordem)
							.map((a) => a.chave)
							.join(', '),
				);
			}
		}
	}
	if (problemas.length > 0) {
		console.error(
			`\nO time não está do tamanho prometido (${TAMANHO_DO_TIME.rapido}/${TAMANHO_DO_TIME.profundo}) ou tem cartão indistinguível:\n  ${problemas.join('\n  ')}\n\nAjuste \`modo\`/\`escopo\`/\`icone\`/\`cor\` e refaça as quatro linhas do cabeçalho antes de semear.`,
		);
		process.exit(1);
	}
	/**
	 * AVISA, mas não trava — de propósito.
	 *
	 * O tamanho do time é promessa DESTE arquivo, então divergir dele é erro
	 * fatal. Já `maxBuscas` mora em src/lib/research/budget.ts e este script não
	 * manda nele: travar o seed por causa de uma constante de outro módulo
	 * deixaria o roster inteiro impossível de semear até alguém mexer lá. O que
	 * o seed pode fazer é dizer, com nome e sobrenome, quem vai rodar cego — que
	 * é exatamente a informação que faltou na rodada passada.
	 */
	if (semBusca.length > 0) {
		console.error(
			`\n⚠ TETO DE BUSCA ESTOURADO (src/lib/research/budget.ts, LIMITES_PADRAO):\n  ${semBusca.join('\n  ')}\n` +
				'  Um especialista sem busca não pode citar página nenhuma: o papel dele\n' +
				'  proíbe número sem fonte, então ele devolve null, a tela mostra "não\n' +
				'  apurado" e a sala de guerra carimba o cartão dele com "SEM BUSCA".\n' +
				'  São dois consertos possíveis, e os dois custam: tirar um pesquisador\n' +
				'  desta combinação, ou subir o `maxBuscas` do modo sabendo que cada\n' +
				'  chamada é ~US$ 0,005 e que a folga entre as chamadas do roster e o\n' +
				'  teto é o que paga o retry, que refaz a busca.\n',
		);
	}
	console.log('');
}

/**
 * O TETO DE CADA UM CONTRA O QUE ELE JÁ ESCREVEU. Trava, não avisa.
 *
 * Diferente do teto de buscas (que mora em outro módulo e por isso só avisa),
 * `max_tokens` é DESTE arquivo e o número de referência também: `PICOS_MEDIDOS`.
 * Um teto abaixo de 2 × o pico é um profissional pago que vai morrer com o JSON
 * cortado — foi assim que `publico` e `producao` sumiram de dossiês de 6 voxxys
 * em 2 de 3 runs frios, com a tela dizendo honestamente "não respondeu desta
 * vez" enquanto o time não entregava o que foi vendido.
 *
 * É a mesma classe de defeito que a rodada passada fechou pela metade: ela
 * declarou o `max_tokens` nos 25 registros (o que era o certo) mas calibrou dois
 * pelo palpite. Este portão é o que torna o critério verificável em vez de
 * lembrado.
 *
 * O teto de código (`MAX_TOKENS_TETO`) manda: quem precisa de mais do que o
 * relógio permite fica no máximo, e a proteção que sobra é o retry.
 */
function conferirTetos(): void {
	const problemas: string[] = [];
	for (const e of TIME) {
		const pico = PICOS_MEDIDOS[e.chave];
		if (!pico) continue;
		const exigido = Math.min(
			MAX_TOKENS_TETO,
			Math.ceil((2 * pico) / 200) * 200,
		);
		const teto = e.max_tokens ?? 0;
		if (teto < exigido) {
			problemas.push(
				`${e.chave}: max_tokens ${teto} < ${exigido} (2 × ${pico} tokens medidos)`,
			);
		}
		if (teto > MAX_TOKENS_TETO) {
			problemas.push(
				`${e.chave}: max_tokens ${teto} acima de MAX_TOKENS_TETO (${MAX_TOKENS_TETO}) — o motor apertaria em silêncio`,
			);
		}
	}
	if (problemas.length > 0) {
		throw new Error(
			`TETO DE SAÍDA ABAIXO DO QUE JÁ FOI MEDIDO:\n  ${problemas.join('\n  ')}\n` +
				'  Um teto que o pico encosta é JSON cortado: o especialista é cobrado,\n' +
				'  anima na sala de guerra e não entra no dossiê. Suba o teto, ou meça de\n' +
				'  novo e atualize `PICOS_MEDIDOS` na mesma edição.',
		);
	}
}

/**
 * ┌─ QUEM RECEBE A MARCA DO ALUNO NÃO PODE ENTRAR NO CACHE ──────────────────┐
 * │ `{marca}` na `pergunta` injeta a identidade da empresa DAQUELE aluno —   │
 * │ nome, tom de voz, público, o que ele não usa. Duas regras nascem disso,  │
 * │ e nenhuma das duas quebra nada quando é violada: as duas produzem        │
 * │ resultado errado em silêncio, que é por isso que este portão existe.     │
 * │                                                                          │
 * │ 1. `compartilhavel` TEM que ser `false`. O cache de 7 dias é             │
 * │    COMPARTILHADO ENTRE ALUNOS (a chave é escopo+categoria+UF, e o dono   │
 * │    não entra nela). Um especialista temperado pela identidade de um      │
 * │    aluno e marcado como compartilhável grava essa identidade no cache e  │
 * │    a serve, por uma semana, com o selo "pesquisa reaproveitada", à       │
 * │    pergunta de qualquer outro. Não é um bug de qualidade: é o anúncio de │
 * │    uma empresa aparecendo no dossiê de um concorrente.                   │
 * │                                                                          │
 * │ 2. `motor_busca` TEM que ser `'nenhum'`. Quem pesquisa tem a `pergunta`  │
 * │    transformada em CONSULTA pelo plugin de busca (é a última mensagem de │
 * │    usuário que ele lê — ver o cabeçalho de `rodarAgente`). Uma consulta  │
 * │    com "tom de voz divertido; NUNCA use emoji" no meio é ruído pago, e o │
 * │    precedente está medido: um `{material}` cru numa busca já fez o       │
 * │    Analista de Margem procurar "matéria-prima para fabricar Brinde       │
 * │    corporativo em {material}".                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function conferirMarca(): void {
	const usam = TIME.filter((e) => /\{marca(_\w+)?\}/.test(e.pergunta));
	const problemas: string[] = [];
	for (const e of usam) {
		if (e.compartilhavel) {
			problemas.push(
				`${e.chave}: usa {marca} e é \`compartilhavel: true\` — a identidade de um aluno iria para o cache de 7 dias e voltaria na pesquisa de outro`,
			);
		}
		if (e.motor_busca !== 'nenhum') {
			problemas.push(
				`${e.chave}: usa {marca} e pesquisa com '${e.motor_busca}' — a pergunta vira consulta de busca, e identidade de empresa dentro dela é ruído pago`,
			);
		}
	}
	if (problemas.length > 0) {
		throw new Error(
			`MARCA DO ALUNO EM ESPECIALISTA QUE NÃO PODE RECEBÊ-LA:\n  ${problemas.join('\n  ')}`,
		);
	}
	console.log(
		usam.length === 0
			? 'marca do aluno: nenhum especialista usa {marca} — a Central escreve para uma empresa genérica'
			: `marca do aluno: ${usam.map((e) => e.chave).join(', ')} (todos fora do cache e sem busca) ✓`,
	);
}

function headers(): Record<string, string> {
	const h: Record<string, string> = { 'content-type': 'application/json' };
	if (BEARER) h.authorization = `Bearer ${BEARER}`;
	if (STAFF_ID) {
		h['x-user-id'] = STAFF_ID;
		h['x-user-role'] = 'admin';
	}
	return h;
}

/**
 * Idempotente por `chave`: atualiza quem já existe e cria quem falta.
 *
 * A versão anterior só sabia criar e recusava rodar com a coleção populada —
 * o que obrigava a apagar tudo à mão para mudar uma frase de um especialista.
 */
async function main() {
	// Antes da rede: um time do tamanho errado não deve nem chegar ao banco.
	conferirTamanhoDoTime();
	// Nem um time cujo teto de saída já foi medido menor do que a resposta.
	conferirTetos();
	// Nem um especialista que leve a identidade de um aluno para o cache comum.
	conferirMarca();

	if (!STAFF_ID && !BEARER) {
		console.error('Defina SEED_STAFF_ID ou SEED_BEARER.');
		process.exit(1);
	}
	const url = `${BASE}/api/tools/${TOOL}/c/agentes`;

	const atual = await fetch(`${url}?page_size=50`, { headers: headers() });
	if (!atual.ok) {
		throw new Error(
			`não consegui ler a coleção (${atual.status}): ${(await atual.text()).slice(0, 300)}`,
		);
	}
	const { items } = (await atual.json()) as {
		items: { id: string; data: { chave?: string } }[];
	};
	const porChave = new Map(items.map((e) => [e.data?.chave, e.id]));

	console.log(`Semeando ${TIME.length} especialistas em ${TOOL}/agentes…\n`);
	for (const e of TIME) {
		const { chave, nome, ...resto } = e;
		const data = { chave, ativo: true, ...resto };
		const existente = porChave.get(chave);

		const res = existente
			? await fetch(`${url}/${existente}`, {
					method: 'PATCH',
					headers: headers(),
					body: JSON.stringify({ title: nome, data }),
				})
			: await fetch(url, {
					method: 'POST',
					headers: headers(),
					// `staff`: os prompts são o produto e não podem vazar para o aluno.
					body: JSON.stringify({ title: nome, visibility: 'staff', data }),
				});

		if (!res.ok) {
			throw new Error(
				`falhou em '${chave}' (${res.status}): ${(await res.text()).slice(0, 400)}`,
			);
		}
		console.log(
			`  ${existente ? '~' : '+'} ${nome.padEnd(32)} ${e.escopo.padEnd(8)} ${e.modo.padEnd(9)} ${(e.fase ?? 'descoberta').padEnd(15)} ${e.motor_busca.padEnd(11)}${e.essencial ? 'ESSENCIAL' : ''}`,
		);
	}

	// Quem sobrou da versão antiga (nomes de "agente") sai de cena sem sumir.
	const chaves = new Set(TIME.map((t) => t.chave));
	for (const [chave, id] of porChave) {
		if (chave && !chaves.has(chave)) {
			await fetch(`${url}/${id}`, {
				method: 'PATCH',
				headers: headers(),
				body: JSON.stringify({ data: { chave, ativo: false } }),
			});
			console.log(`  - ${chave} (desativado: saiu do time)`);
		}
	}

	console.log('\nO time é editável pela tela de coleção, sem deploy.');
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
