/**
 * Semeia o TIME DO ATELIÊ — os seis especialistas que transformam
 * "foto do produto + marca + referências" no PROMPT da arte.
 *
 * Cada um é um registro na coleção `agentes` da tool `estudio_imagens`
 * (definition na upvox: `scripts/seed-estudio-imagens.ts`), com
 * `visibility:'staff'` — é o que impede `GET /c/agentes` de entregar estes
 * system prompts, que são o produto, para qualquer aluno logado.
 *
 * ┌─ O QUE ESTE ARQUIVO É, DE VERDADE ───────────────────────────────────────┐
 * │ Não é configuração: é o PRODUTO. Um `papel` bem escrito é a diferença    │
 * │ entre uma arte com a cara da empresa do aluno e mais uma imagem de IA —  │
 * │ e essa diferença se acerta escrevendo, olhando o resultado e             │
 * │ reescrevendo. Por isso o time é DADO e não código: cada rodada dessas é  │
 * │ uma edição de tela, não um deploy.                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ SEIS, EM TRÊS ONDAS — E A ONDA É DEPENDÊNCIA DE DADO, NÃO ESTILO ───────┐
 * │ descoberta      LÊ o que existe, em paralelo, sem depender de ninguém:   │
 * │                 a foto da peça, a marca cadastrada e os anúncios de      │
 * │                 referência.                                              │
 * │ aprofundamento  recebe as três leituras e DECIDE: o Diretor de Arte      │
 * │                 monta a imagem, o Redator escreve o texto.               │
 * │ sintese         recebe tudo e escreve o pedido final da arte.            │
 * │                                                                          │
 * │ Rodar tudo junto não é "mais rápido", é outra coisa: o Diretor de Arte   │
 * │ sem a leitura da peça inventa uma peça, e o Prompt Final sem a direção   │
 * │ de arte vira um pedido genérico. Foi assim que o Estrategista da Central │
 * │ respondeu "não foi fornecido material" no primeiro run completo dela.    │
 * │                                                                          │
 * │ Onda 1: leitor_produto · leitor_marca · leitor_referencias               │
 * │ Onda 2: diretor_arte · redator                                           │
 * │ Onda 3: prompt_final                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ `entrada`: O CAMPO QUE A CENTRAL NÃO PRECISAVA TER ─────────────────────┐
 * │ Lá todo especialista recebia as mesmas variáveis de texto. Aqui não: um  │
 * │ olha a FOTO DO PRODUTO, outro olha os ANÚNCIOS DE REFERÊNCIA e os outros │
 * │ quatro trabalham com texto. Sem declarar isso no registro, "quem olha a  │
 * │ foto" seria um `if` com a chave do agente escrita dentro do bloco — e o  │
 * │ time deixaria de ser dado no minuto seguinte.                            │
 * │                                                                          │
 * │   nenhuma       texto (mais o material do time, nas ondas 2 e 3)         │
 * │   foto_produto  a foto que o aluno subiu                                 │
 * │   referencias   os anúncios de referência (até 2)                        │
 * │                                                                          │
 * │ Declarar `foto_produto` sem o aluno ter mandado foto NÃO é erro: o       │
 * │ especialista responde do que a pessoa escreveu e diz o que uma foto      │
 * │ resolveria. Metade dos alunos vai começar sem foto.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ TODO ESPECIALISTA PAGO TEM ONDE APARECER (a regra que reprovou 4        │
 * │  rodadas na Central) ────────────────────────────────────────────────────┤
 * │ O ponto de render dos seis é a chave `agentes` do `output` da definition:│
 * │ cada item leva `chave`, `nome`, `icone`, `cor`, `ok`, `ms`, `erro` e o   │
 * │ `json` daquele especialista. A tela lê cada card PELA CHAVE — o mesmo    │
 * │ `jsonDe('<chave>')` do dossiê da Central.                                │
 * │                                                                          │
 * │   leitor_produto      → "O que eu vi na sua foto"                        │
 * │   leitor_marca        → "As regras visuais da sua marca"                 │
 * │   leitor_referencias  → "O que aprendi dos anúncios que você mandou"     │
 * │   diretor_arte        → "A direção de arte"                              │
 * │   redator             → "O texto pronto para copiar"                     │
 * │   prompt_final        → "O pedido que fizemos para a arte"               │
 * │                                                                          │
 * │ Os NOMES DOS CAMPOS de `saida` são contrato com esses cards: campo com   │
 * │ outro nome não dá erro — some do card, e o especialista pago aparece com │
 * │ metade da ficha em branco. `conferirRender()` cobra ícone, cor e frase   │
 * │ de todo mundo antes de a rede ser tocada.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AS VARIÁVEIS DA `pergunta` — E SÓ DA `pergunta` ────────────────────────┐
 * │ `interpolar` troca `{chave}` na PERGUNTA. O `papel` vai VERBATIM como    │
 * │ system prompt: uma chave de template escrita lá chega literal ao modelo. │
 * │ Por isso nenhum `papel` daqui tem `{}`.                                  │
 * │                                                                          │
 * │   {entrega}   a frase do caminho ("um post para redes sociais"), que vem │
 * │               do cartão em `ui.atelie.entregas[].frase`                   │
 * │   {formato}   a proporção pedida ("1:1", "9:16")                         │
 * │   {produto}   o que o aluno digitou, do `vars` que a tela monta           │
 * │   {marca}     o briefing de uma linha da marca (`resumoDaMarca`), mais   │
 * │               {marca_nome} {marca_tom} {marca_publico} {marca_nao_usar}  │
 * │   {paleta}    as cores lidas de uma imagem — existe no bloco, ninguém    │
 * │               usa hoje (a definition não passa `paleta`)                  │
 * │                                                                          │
 * │ VARIÁVEL VAZIA SOME da frase, junto com a preposição que a introduzia —  │
 * │ e é por isso que `{produto}` aparece como "a foto de {produto}" e nunca  │
 * │ como "a peça é {produto}": no primeiro caso a ausência apaga o "de" e a  │
 * │ frase continua correta; no segundo sobraria "a peça é.". `{marca}` é uma │
 * │ frase inteira e por isso fica sempre no FIM.                             │
 * │                                                                          │
 * │ ⚠ `{produto}` VEM DE `vars`, QUE É JSON. O bloco recebe `vars` como      │
 * │ string JSON (`{"produto":"…"}`) e `parseVars` devolve `{}` para qualquer │
 * │ coisa que não seja JSON — texto solto do aluno seria DESCARTADO EM       │
 * │ SILÊNCIO. Quem monta o JSON é a tela; ver `input.pedido` na definition.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 *   SEED_STAFF_ID=<id> npx tsx scripts/seed-agentes-arte.ts
 */
import 'dotenv/config';
/**
 * O teto de saída vem do MOTOR, não de uma cópia aqui.
 *
 * `toAgentSpec` aperta `max_tokens` em `MAX_TOKENS_TETO` antes de a chamada
 * sair, e o campo da coleção recusa acima disso com HTTP 400. Importar é o que
 * faz este seed CONFERIR em vez de supor — um teto maior daqui seria aceito na
 * tela e cortado em silêncio pelo motor, que é a pior forma de um número mentir.
 *
 * ┌─ E VINHA DO MOTOR ERRADO ───────────────────────────────────────────────┐
 * │ `MAX_TOKENS_TETO` era importado de `lib/research` — a CENTRAL, onde ele  │
 * │ vale 9.000. Quem apara o time do ATELIÊ é `lib/atelie`, onde vale 4.000. │
 * │ A trava conferia contra um teto que o motor desta tool nunca usa: um     │
 * │ especialista com 5.000 passava aqui e era cortado para 4.000 na hora da  │
 * │ chamada — exatamente o "cortado em silêncio" que este import existe para │
 * │ impedir. Só apareceu quando o Diretor subiu para o topo da faixa.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
import { estimarCustoUsd } from '../src/lib/agent-team/budget.js';
import {
	CHARS_POR_IMAGEM,
	LIMITES_ATELIE,
	MAX_TOKENS_TETO,
} from '../src/lib/atelie/agents.js';
import { findTextModel } from '../src/lib/text-models-catalog.js';
import {
	TETO_DIGEST_ONDA2,
	TETO_DIGEST_ONDA3,
} from '../src/tool-blocks/blocks/ai-art-team.js';

const TOOL = 'estudio_imagens';
const BASE = process.env.SEED_API_URL ?? 'http://localhost:3333';
const STAFF_ID = process.env.SEED_STAFF_ID ?? '';
const BEARER = process.env.SEED_BEARER ?? '';

/* ══════════════════════════ as regras comuns ══════════════════════════ */

/**
 * ┌─ O CAMPO É CONTRATO; A FRASE É PARA UMA PESSOA ──────────────────────────┐
 * │ Metade do que estes seis escrevem vai para a TELA do aluno verbatim: a   │
 * │ ficha da peça, as regras da marca, o porquê da arte. Modelo que fala de  │
 * │ preenchimento de resposta ("o campo consta como nulo") entrega ao aluno  │
 * │ o nome de uma coluna de banco no meio do que ele pagou — reproduzido em  │
 * │ 3 de 6 runs profundos da Central antes de esta regra existir.            │
 * │                                                                          │
 * │ A tela não conserta isso: reescrever PROSA é adivinhar o que a frase     │
 * │ queria dizer. O único lugar onde se conserta é aqui.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const PROSA_PARA_GENTE = [
	'Todo texto corrido que você escrever é lido por uma PESSOA na tela, não por um programa.',
	'Nele é PROIBIDO citar nome de campo, escrever "null", "JSON", "array", "campo", "chave" ou falar do formato da resposta.',
	'Isso vale igual em português: nada de "nulo", "não preenchido", "consta vazio", "não foi informado" nem de explicar o que ficou sem preencher.',
	'Diga a mesma coisa em português de gente: em vez de "cor_primaria está null", escreva "a marca não tem cor cadastrada".',
].join(' ');

/**
 * A REGRA QUE SEGURA TUDO — e ela é diferente da Central por um motivo.
 *
 * Lá o inimigo era o número inventado, e o remédio era exigir fonte. Aqui não
 * há o que citar: o inimigo é o DETALHE inventado. Um modelo que "melhora" a
 * peça — acrescenta um verniz que não existe, troca MDF por nogueira, inventa
 * um encaixe — produz uma arte linda de um produto que o aluno NÃO FABRICA. Ele
 * anuncia, o cliente pede, e a peça que chega é outra.
 *
 * O segundo inimigo é mais silencioso: contrariar a marca. Quem recebe o
 * briefing como "contexto de fundo" continua escrevendo do jeito dele — a
 * informação chega, não muda nada, e custa token parecendo que funcionou.
 */
const ANTI_INVENCAO = [
	'REGRA INEGOCIÁVEL: só afirme o que você está VENDO na imagem que veio no pedido, o que a pessoa escreveu ou o que está no material do time.',
	'NUNCA invente material, cor, medida, acabamento, uso, prêmio, preço, prazo ou garantia. O que não dá para saber, diga que não dá.',
	'Detalhe inventado não é enfeite: vira uma arte de um produto que a pessoa não fabrica, e ela vai anunciar isso.',
	'E o que a marca de quem vai publicar declarou MANDA em você: o que ela diz que nunca usa é proibição, não preferência.',
	PROSA_PARA_GENTE,
	'Escreva em português do Brasil, direto, sem jargão de agência. Responda só JSON.',
].join(' ');

/**
 * ┌─ QUANDO O PEDIDO TRAZ A IDENTIDADE DA EMPRESA DO ALUNO ──────────────────┐
 * │ A marca é cadastrada UMA vez (coleção `marca` do próprio Estúdio) e      │
 * │ chega por `{marca}` — ver `varsDaMarca` em src/lib/marca.ts. Sem ela, o  │
 * │ time entrega uma arte correta, publicável e igual à de todo mundo.       │
 * │                                                                          │
 * │ A terceira linha é a que mais importa e a menos óbvia: SEM MARCA, NÃO    │
 * │ INVENTE UMA. É o caminho da maioria no primeiro dia — e um modelo que    │
 * │ recebe "faça a arte DESTA empresa" sem receber empresa nenhuma inventa   │
 * │ um nome, um slogan e uma cor, e o aluno publica a arte de uma empresa    │
 * │ que não existe.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const A_MARCA_MANDA = [
	'Quando o pedido trouxer A MARCA DE QUEM VAI PUBLICAR, ela MANDA: as cores, a letra, o jeito de falar e o público são os dela, e a lista do que ela nunca usa é proibição.',
	'Se o seu gosto e o da marca discordarem, vence o da marca.',
	'Se o pedido NÃO trouxer marca nenhuma, trabalhe num caminho neutro e NUNCA invente nome de empresa, slogan, cor de marca ou assinatura — e diga em `observacao` que a arte ficaria com a cara da empresa se ela cadastrasse a marca.',
].join(' ');

/**
 * ┌─ O LOGOTIPO É A ARMADILHA MAIS CARA DESTA FERRAMENTA ────────────────────┐
 * │ "Arte com a cara da empresa" convida a pedir a logo na imagem. O modelo  │
 * │ de imagem NÃO TEM o arquivo do logo do aluno — ele nunca vai vê-lo —,    │
 * │ então todo pedido de "coloque a logo" devolve um símbolo inventado com   │
 * │ letras tortas que não é a marca de ninguém. O aluno recebe a arte da     │
 * │ empresa dele com a marca de uma empresa que não existe.                  │
 * │                                                                          │
 * │ ESSA metade da regra continua valendo palavra por palavra.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A OUTRA METADE ERA O DEFEITO, E FOI MEDIDA ─────────────────────────────┐
 * │ Até aqui esta regra mandava RESERVAR ÁREA LIMPA e prometia que o         │
 * │ `image.brandmark` "só consegue porque a área existe". As duas coisas     │
 * │ estavam erradas, e a queixa do dono ("sem fundo na logo") é a fatura:    │
 * │                                                                          │
 * │  · O GERADOR NÃO SABE DEIXAR VAZIO — ELE DESENHA O VAZIO. Na arte da     │
 * │    queixa o retângulo branco atrás do logo tem 181×178 colado no topo,   │
 * │    média 254,94 e desvio 0,253: não é `sharp` (que daria 255,00 e desvio │
 * │    0,000), é PINTURA do modelo obedecendo à frase "o canto superior      │
 * │    direito permanece com fundo branco liso, guardado para a marca entrar │
 * │    depois", que estava dentro do `prompt_final`. Tirando o logo do canto,│
 * │    o retângulo continua lá, vazio. As 5 artes da galeria têm o artefato; │
 * │    7 de 10 gerações a partir de prompt do time têm; 5 de 5 gerações com  │
 * │    a frase REMOVIDA não têm nenhuma.                                     │
 * │  · O `brandmark` NUNCA PRECISOU DA ÁREA. Ele mede a arte pronta e cola o │
 * │    logo por cima; com arte sem cartão o carimbo sai limpo (medido em 4   │
 * │    combinações, todas `tratamento: direto`). A área nunca foi dependência│
 * │    dele — era uma promessa escrita aqui.                                 │
 * │  · O PIOR EFEITO NÃO É O RETÂNGULO. Numa geração o modelo escreveu à mão │
 * │    a assinatura "Signature Micos" no canto que o pedido reservou "para a │
 * │    assinatura" — a empresa-que-não-existe que cinco frases deste arquivo │
 * │    tentam impedir, convidada pela própria reserva.                       │
 * │                                                                          │
 * │ Então a regra virou o contrário: NÃO SE RESERVA NADA. A assinatura passa │
 * │ a ser problema exclusivamente do código, DEPOIS da arte pronta.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const O_LOGO_NAO_SE_DESENHA = [
	'O LOGOTIPO NUNCA É DESENHADO PELO GERADOR DE IMAGEM: ele não tem o arquivo do logo, e todo pedido desses devolve um símbolo inventado com letra torta.',
	/**
	 * A frase que substitui "reserve área limpa". Ela não PEDE nada ao gerador —
	 * e é isso que a faz funcionar: o que não é mencionado não é desenhado.
	 */
	'E NÃO SE RESERVA ESPAÇO PARA ELE. A assinatura da marca é colada por um programa nosso DEPOIS que a arte fica pronta: ele mede a imagem, acha o canto mais calmo e aplica ali o logo real da empresa. Você não guarda lugar, não marca canto e não fala disso no pedido da imagem.',
	/**
	 * A PROIBIÇÃO É MAIS FORTE QUE O PEDIDO — vale para modelo de texto tanto
	 * quanto para modelo de imagem. Por isso a lista de PALAVRAS, e não só o
	 * conceito: a ideia de "deixe limpo" sobrevive a reescrita conceitual e volta
	 * como sinônimo; a palavra proibida uma a uma, não.
	 */
	'PROIBIDO escrever "área limpa", "área reservada", "espaço para o logo", "espaço para o texto", "guardado para a marca", "canto livre" ou qualquer variação disso. O gerador não sabe deixar vazio: ele DESENHA o vazio, e o que chega ao aluno é um cartão branco chapado colado por cima da foto — foi exatamente essa a reclamação que gerou esta regra.',
	'Vazio de verdade não se pede: ele SOBRA. Uma parte escura da cena, um fundo fora de foco, uma parede em meia-sombra — é aí que texto e assinatura cabem, e isso se consegue compondo a luz, nunca abrindo um retângulo.',
	'NÃO desenhe, em lugar nenhum e por motivo nenhum, cartão, plaquinha, etiqueta, adesivo, selo, moldura, retângulo, faixa, tarja ou qualquer forma de cor chapada aplicada por cima da fotografia.',
	/**
	 * A COTA. Confirmado numa arte real da galeria: o gerador desenhou um
	 * quadrado vazio contornado, rotulado "80x80px" por dentro e "16px" embaixo —
	 * um desenho técnico dentro da peça de divulgação. A frase do "NÃO:" cobre
	 * "letra inventada"; não cobria cota. Geometria citada no pedido vira
	 * geometria desenhada, o mesmo defeito que a folga do recorte já tinha.
	 */
	'NUNCA cite tamanho, medida, porcentagem ou distância — nem em pixels, nem em centímetros, nem em fração do quadro. Número escrito no pedido reaparece DESENHADO dentro da arte, como cota de desenho técnico, e a peça vai para o lixo.',
	'A mesma disciplina vale para texto: na arte só entra a frase curta que o Redator escreveu, e nada além dela — sem letra solta, sem palavra inventada, sem endereço, sem telefone, sem preço e sem carimbo de desconto.',
].join(' ');

/**
 * ┌─ O CAMPO QUE O CÓDIGO LÊ (F4 — o logo passa a ser COMPOSTO de verdade) ──┐
 * │ O `area_da_assinatura` é PROSA, e prosa não posiciona pixel. Ele fica    │
 * │ como está — é o que o gerador de imagem lê e é o que o cartão do Diretor │
 * │ mostra ao aluno. Ao lado dele entra `canto_da_assinatura`, que é a       │
 * │ MESMA decisão escrita para máquina, e é o que o `image.brandmark` usa    │
 * │ para colar o logo do aluno por cima da área reservada.                   │
 * │                                                                          │
 * │ Custa ZERO: `direcao_arte` já viaja como o objeto inteiro do Diretor     │
 * │ (`ai-art-team.ts` emite `doAgente(diretor)?.json`) e já está na          │
 * │ allow-list do `output` dos dois lados — campo novo dentro do `saida`     │
 * │ pega carona. Sem migração, sem deploy: é edição de dado.                 │
 * │                                                                          │
 * │ `nenhum` NÃO é enfeite. Sem essa opção, um modelo obrigado a escolher    │
 * │ entre quatro cantos escolhe um mesmo quando a composição não tem canto   │
 * │ limpo — e o logo do aluno vai parar em cima da peça. E o código sabe se  │
 * │ virar sem o campo (lê a prosa, e se ela também não servir MEDE os quatro │
 * │ cantos da arte), mas as duas saídas seguintes são chute perto disto.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const CANTO_LEGIVEL_POR_MAQUINA = [
	'Em `canto_da_assinatura` diga QUAL CANTO vai ficar mais calmo na composição que você decidiu — o canto onde não há peça, não há texto e a luz já é baixa —, usando EXATAMENTE uma destas cinco palavras e nada mais: superior_esquerdo, superior_direito, inferior_esquerdo, inferior_direito, nenhum.',
	'Esse campo é lido por máquina e serve para o logo real da empresa ser aplicado DEPOIS, na arte pronta. É PALPITE seu, não ordem: quem cola o logo mede a imagem e pode escolher outro canto. Não escreva frase, não escreva duas opções, não deixe em branco.',
	'Use `nenhum` quando a composição que VOCÊ decidiu não tiver canto calmo — é resposta legítima e melhor do que apontar um canto ocupado pela peça.',
	/**
	 * O CAMPO É PARA MÁQUINA; O PEDIDO DA IMAGEM NÃO PODE SABER QUE ELE EXISTE.
	 * Sem esta frase, a decisão do canto vaza do JSON do Diretor para a prosa do
	 * `prompt_final` — foi assim que "o canto superior direito permanece com
	 * fundo branco liso" chegou ao gerador e virou o cartão da queixa.
	 */
	'E ele NÃO entra na descrição da imagem: nada do que você escrever para o gerador pode mencionar canto de assinatura, logo ou marca. É um bilhete para o nosso programa, não para o modelo de imagem.',
].join(' ');

/**
 * ┌─ A FOLGA QUE FAZ O KIT EXISTIR (F4 — um formato gerado, vários entregues)┐
 * │ A mesma arte é RECORTADA depois para os outros formatos do kit, e o     │
 * │ recorte vem sempre das bordas para dentro: de um quadrado para o Story  │
 * │ sobram 56,3% do quadro. Isso não é opção de implementação — gerar uma   │
 * │ arte por formato exigiria `variation_count`, que o `ai.image_studio`    │
 * │ descarta, e o aluno pagaria três para receber uma.                       │
 * │                                                                          │
 * │ MEDIDO, e é por isso que esta frase existe: com o enquadramento antigo, │
 * │ ZERO de seis recortes saíram limpos — o título virava "ua lembranç",    │
 * │ "RAVADO CO", ou sumia inteiro. Com a disciplina de folga, seis de seis  │
 * │ sobreviveram. O portão em `lib/enquadramento.ts` recusa o recorte ruim, │
 * │ mas recusar entrega MENOS: quem faz o kit ficar cheio é esta folga.      │
 * │                                                                          │
 * │ A ÚLTIMA ORAÇÃO É A PARTE CARA. Numa rodada de teste a instrução citou  │
 * │ um "quadrado central de 56%" e o gerador DESENHOU o quadrado: quatro de │
 * │ seis peças voltaram com faixas de painel encaixadas nas bordas. É o     │
 * │ mesmo defeito da cota de "80x80px" aparecendo escrita dentro da arte —  │
 * │ geometria citada no pedido vira geometria desenhada. Descreva a         │
 * │ disciplina; nunca a medida.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const A_FOLGA_QUE_SOBREVIVE_AO_RECORTE = [
	'ESTA ARTE VAI SER RECORTADA para outros formatos, sempre das bordas para dentro: o vertical come as LATERAIS, o deitado come o ALTO E O PÉ. Então o que não pode ser perdido — a peça, a gravação e as palavras — fica longe das quatro bordas.',
	/**
	 * ┌─ A FRASE QUE ESTAVA FAZENDO A ARTE PARECER CATÁLOGO ─────────────────────┐
	 * │ Era "a peça e a frase ficam no MIOLO do quadro, com ar em volta". Está   │
	 * │ tecnicamente certa e visualmente desastrosa: lida junto com "fundo liso" │
	 * │ e "luz difusa", ela vira PEÇA PEQUENA E CENTRADA FLUTUANDO NO VAZIO —    │
	 * │ o enquadramento de foto de e-commerce, que é exatamente do que o dono    │
	 * │ reclamou. Nos 4 runs medidos, 3 pediram "peça centralizada com folga nas │
	 * │ 4 bordas" e as 3 artes saíram com o mesmo objeto miúdo no meio do nada.  │
	 * │                                                                          │
	 * │ Folga é DISTÂNCIA DA BORDA, não TAMANHO DO HERÓI. A peça pode ocupar     │
	 * │ meio quadro; o que a borda tem de conter é cena — mesa, sombra, fundo    │
	 * │ fora de foco —, e não vazio a mais.                                      │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	'FOLGA NÃO É PEÇA PEQUENA. A peça pode ser grande e ocupar boa parte do quadro; o que precisa sobrar perto das bordas é CENA CONTINUANDO — a mesa que segue, a sombra que se estende, o fundo fora de foco —, nunca um vazio a mais em volta de um objeto miúdo. Peça pequena e centrada no meio do nada é foto de catálogo, e é o que estamos tentando não entregar.',
	'Nenhuma palavra e nenhuma parte da peça pode terminar rente à borda — texto que encosta na borda é a primeira coisa que o recorte decepa.',
	'NÃO traduza essa folga em número, medida, porcentagem, retângulo, moldura ou área marcada, e não a mencione na descrição da imagem: ela é jeito de compor, não elemento a desenhar.',
].join(' ');

/**
 * ┌─ A REGRA QUE FALTAVA: TODA ARTE DAQUI É UMA FOTOGRAFIA COM AUTOR ────────┐
 * │ Este arquivo tinha, somadas, quatro regras de SEGURANÇA — cada uma       │
 * │ justificada sozinha — e nenhuma regra de QUALIDADE. O resultado medido é │
 * │ que os 4 runs do time produziram o MESMO quadro, com produtos            │
 * │ diferentes:                                                              │
 * │                                                                          │
 * │   fundo branco/creme liso ......... 4 de 4   ← veio de `nao_usar`        │
 * │   luz difusa, "sem sombra dura" ... 4 de 4   ← veio de `o_que_esconder`  │
 * │   peça centrada com folga ......... 3 de 4   ← veio da folga do recorte  │
 * │   área reservada p/ texto e logo .. 4 de 4   ← veio do logo              │
 * │   pano de linho + fita vermelha ... 4 de 4                               │
 * │                                                                          │
 * │ Isso não é acaso nem falta de talento do modelo: é a receita do banco de │
 * │ imagem, escrita por nós, uma cláusula defensiva de cada vez. O           │
 * │ `prompt_final` saía como FICHA TÉCNICA — nove requisitos na ordem fixa,  │
 * │ nenhum deles dizendo por que alguém compraria.                           │
 * │                                                                          │
 * │ MEDIDO no mesmo modelo, na mesma foto e com a mesma marca: trocando a    │
 * │ ficha técnica por um pedido escrito como fotografia (hora do dia, de     │
 * │ onde vem a luz, que lente, o que está fora de foco atrás), a mesma peça  │
 * │ virou arte publicável em 3 de 3 tentativas. E o `gemini-3.1-flash-image` │
 * │ empatou com o `pro` — a qualidade estava no pedido, não no preço.        │
 * │                                                                          │
 * │ A ARMADILHA A EVITAR AQUI é a de sempre nesta ferramenta: nada disto     │
 * │ pode virar número. "Lente de 85mm" e "hora dourada" são vocabulário de   │
 * │ fotógrafo e o gerador os entende como estilo; "80x80px" e "56% do        │
 * │ quadro" são geometria e ele os DESENHA. Milímetro de lente é a única     │
 * │ medida permitida, e só porque ela não descreve nada dentro do quadro.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const A_FOTOGRAFIA_TEM_AUTOR = [
	'ISTO É UMA FOTOGRAFIA COM AUTOR, não uma foto de catálogo. A diferença inteira está em quatro decisões, e você tem de tomar as quatro: a HORA, a LUZ, a CÂMERA e o QUE ESTÁ ATRÁS.',
	'A LUZ TEM DE ONDE VIR. Diga o lado, a altura e a hora — luz baixa de fim de tarde entrando por uma janela à esquerda, luz de manhã difusa de um lado só, luz dura de meio-dia. E diga QUE SOMBRA ela joga e para que lado.',
	/**
	 * A decisão mais anti-publicitária que o roster produzia, e ela vinha de uma
	 * frase honesta: o Leitor do Produto manda esconder "sombra dura de flash" e
	 * o Leitor da Marca traduz marca artesanal como "sem reflexo de estúdio". As
	 * duas juntas chegam ao gerador como LUZ CHAPADA — que é o acabamento de foto
	 * de marketplace. Sombra não é defeito: é o que dá volume.
	 */
	'PROIBIDO pedir "luz difusa e uniforme", "sem sombras", "iluminação de estúdio" ou "softbox": luz chapada é o acabamento da foto de marketplace, e ela sozinha derruba a peça inteira. O que se evita é o FLASH DIRETO (sombra dupla, recortada, com o fotógrafo refletido), não a sombra. Toda peça precisa de uma sombra que prove que ela está apoiada em algo.',
	'A GRAVAÇÃO É O PONTO MAIS LUMINOSO DA IMAGEM. É ela que está sendo vendida: componha a luz para que ela acenda — o inox exposto pelo laser pegando um filete de luz, o baixo-relevo na madeira ganhando sombra dentro do sulco, a borda do acrílico acendendo. Se a gravação não é a coisa que mais chama o olho, a arte falhou.',
	'A CÂMERA TEM POSIÇÃO. Diga de que altura se está olhando (na altura da mesa, um pouco acima, de cima), de que distância, com que lente (curta para caber o ambiente, longa para achatar o fundo) e quanta profundidade — o que está nítido e o que dissolve.',
	'ATRÁS DA PEÇA FICA O MUNDO DE QUEM COMPRA, fora de foco: a mesa da festa, a bancada da cozinha, a prateleira da loja. Fundo é CONTEXTO desfocado, não parede vazia. Se a marca exige fundo claro, então o fundo claro é uma superfície de verdade com luz caindo nela — uma parede, uma toalha, uma mesa clara —, nunca um vazio branco recortado.',
	'No fim, o ACABAMENTO: paleta contida (três famílias de cor no máximo), contraste alto, pretos com detalhe, grão fotográfico fino. Cor calibrada como capa de revista, não como banco de imagem.',
].join(' ');

/**
 * ┌─ O TEXTO É TIPOGRAFIA DA FOTOGRAFIA, NÃO LEGENDA COLADA POR CIMA ────────┐
 * │ Medido: o `prompt_final` entregava a frase do Redator como `aparece o    │
 * │ texto "X" em Montserrat bold` — sem tamanho relativo, sem posição, sem   │
 * │ hierarquia. O gerador fazia então a única coisa que essa frase permite:  │
 * │ LEGENDA PRETA GIGANTE CHAPADA POR CIMA da foto, em 4 de 4 artes com      │
 * │ texto (a da queixa inclusive, com "Sua marca gravada com precisão" em    │
 * │ duas linhas cobrindo o rodapé).                                          │
 * │                                                                          │
 * │ Com a MESMA frase descrita como parte da fotografia — duas linhas, uma   │
 * │ pequena em versalete e uma grande, cor tirada da luz da cena, pousadas   │
 * │ na sombra do alto do quadro — a mesma geração virou design. É a mudança  │
 * │ mais barata deste arquivo: nenhuma chamada nova, nenhum token a mais no  │
 * │ gerador, e o texto era metade do que o dono chamou de "arte ruim".       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const O_TEXTO_E_PARTE_DA_FOTOGRAFIA = [
	'QUANDO HOUVER TEXTO NA ARTE, ele é TIPOGRAFIA DENTRO DA FOTOGRAFIA, nunca uma legenda colada por cima. Descreva-o como um diretor de arte descreveria: em quantas linhas, qual é a linha pequena e qual é a grande, se é maiúscula espaçada ou caixa baixa grossa, de que cor (tirada da luz da cena — branco-quente, cor de aço, preto de sombra) e em que parte do quadro pousa.',
	'DUAS ALTURAS DE LETRA é o que transforma uma frase em design: uma palavra pequena, espaçada, discreta em cima, e a frase grande embaixo dela. Uma linha só, do mesmo tamanho, é legenda.',
	'O texto pousa numa parte da cena QUE JÁ É CALMA — a sombra, o fundo fora de foco, a parede em meia-sombra. Você escolhe uma que a luz já fez; você NÃO manda criar uma.',
	'NUNCA ponha faixa, tarja, caixa, retângulo ou cor chapada atrás do texto, e nunca o deixe do tamanho da peça: a fotografia passa por trás das letras. E ele nunca encosta na borda do quadro: texto rente à borda é a primeira coisa que o recorte dos outros formatos decepa.',
	/**
	 * ┌─ A COLISÃO ENTRE A FRASE DA ARTE E O QUE ESTÁ GRAVADO NA PEÇA ───────────┐
	 * │ Apareceu na primeira leva de peças novas e é filha de duas melhorias      │
	 * │ boas que se atropelaram: o Redator passou a tirar o `texto_na_arte` do    │
	 * │ que está LITERALMENTE gravado na peça ("Família Souza", "CAMPEONATO       │
	 * │ 2026") e a tipografia passou a ser descrita como parte da fotografia.     │
	 * │ Resultado, medido em 6 peças:                                             │
	 * │                                                                           │
	 * │  · tábua/post → o Prompt Final resolveu a colisão FUNDINDO os dois: "as   │
	 * │    palavras 'Família Souza' … GRAVADAS NA MADEIRA … não há nenhum outro   │
	 * │    texto sobreposto". A peça voltou sem manchete nenhuma e com a          │
	 * │    gravação ilegível, torta — o pior dos dois mundos.                     │
	 * │  · troféu/cena → resolveu DESENHANDO OS DOIS, e os dois discordaram:      │
	 * │    "CAMPEONATO 2026" gravado no acrílico e "CAMPEONATO 2024" tipografado  │
	 * │    embaixo, no mesmo quadro.                                              │
	 * │                                                                           │
	 * │ Nenhuma das duas é desobediência: era ambiguidade nossa. Aqui ela acaba.  │
	 * └───────────────────────────────────────────────────────────────────────────┘
	 */
	'A FRASE DA ARTE NUNCA É GRAVADA NA PEÇA. São duas coisas diferentes no mesmo quadro: o que está gravado no produto é do produto e você não muda nem repete; a frase do Redator é tipografia POUSADA SOBRE A FOTOGRAFIA, fora da peça.',
	/**
	 * ┌─ A VERSÃO ANTERIOR DESTA REGRA APAGOU A MANCHETE DE 4 PEÇAS EM 4 ────────┐
	 * │ Ela dizia: "se a frase repetir o que está gravado, NÃO escreva a frase".  │
	 * │ Ao mesmo tempo, o Redator estava sendo mandado tirar a frase justamente   │
	 * │ do que está gravado ("FAMÍLIA SOUZA", "CAMPEONATO 2026"). Duas frentes,   │
	 * │ duas regras, uma anulando a outra: medido no A/B de 4 produtos, o         │
	 * │ `prompt_final` escreveu, textual, "não deve haver nenhuma tipografia      │
	 * │ sobreposta à fotografia: nenhum texto, nenhuma letra e nenhum número" —   │
	 * │ e o post de rede social saiu sem manchete nenhuma, virando catálogo.      │
	 * │                                                                          │
	 * │ O conserto é dos DOIS lados e tem que ser lido junto: o Redator não       │
	 * │ escreve mais dado de ninguém na frase da arte — nem gravado nem           │
	 * │ inventado (ver o `papel` dele) —, e aqui a regra deixa de ser "apague" e  │
	 * │ passa a ser "as duas aparecem".                                           │
	 * │                                                                          │
	 * │ ⚠ E ELA NÃO PODE SER CONDICIONAL. A primeira tentativa de conserto        │
	 * │ mantinha a trava antiga como exceção ("se — e só se — a frase repetir o   │
	 * │ que está gravado, a gravação fica e a frase sai"). Isso obriga o modelo   │
	 * │ a COMPARAR a frase com a gravação antes de escrever, e esta constante é   │
	 * │ lida pelos DOIS Sonnet do time. Medido em 8 runs com a versão             │
	 * │ condicional: `prompt_final` refeito em 4, `diretor_arte` perdido em 3,    │
	 * │ só 2 runs limpos, custo médio US$ 0,178 contra US$ 0,150. O raciocínio    │
	 * │ é cobrado como saída e come o teto de 4.000 antes da primeira chave do    │
	 * │ JSON — a assinatura já documentada no Redator da Central.                 │
	 * │                                                                          │
	 * │ A trava contra "CAMPEONATO 2026 gravado × CAMPEONATO 2024 escrito" não    │
	 * │ some: ela mudou de lugar, e passou a ser o Redator (modelo barato, sem    │
	 * │ raciocínio) que a garante na origem, com uma regra sem "se".              │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	'AS DUAS APARECEM, sempre: a gravação está na peça (é dado do cliente — você não muda, não apaga e não repete) e a manchete é tipografia pousada sobre a fotografia, dizendo o que a foto não diz. Nunca apague a manchete por causa da gravação, e nunca escreva a manchete gravada na peça: peça de rede social sem manchete nenhuma vira catálogo.',
	'Se o Redator não escreveu frase nenhuma, a ordem é explícita: NENHUM texto, NENHUMA letra e NENHUM número aparecem na imagem além do que já está gravado no próprio produto.',
].join(' ');

/** Como falar com o público: dono de máquina que quer vender, não diretor de agência. */
const TOM = [
	'Quem vai usar isto é um pequeno produtor que tem uma máquina a laser e quer VENDER a peça dele.',
	'Fale como quem resolve, não como quem apresenta portfólio: nada de "conceito disruptivo", "storytelling" ou "identidade 360".',
].join(' ');

/**
 * A PALAVRA "AGENTE" É BANIDA DO QUE O ALUNO LÊ.
 *
 * Ele comprou um time de profissionais, e a prosa que o modelo devolve vai para
 * a tela como veio. Na Central a palavra escapou exatamente assim, dentro do
 * plano de 7 dias: "a faixa de preço já calculada pelo agente responsável".
 *
 * Vai só para quem TEM motivo de falar dos colegas — as ondas 2 e 3, que leem o
 * material do time. Quem é da onda 1 não vê o trabalho de ninguém e não gasta
 * token com uma proibição que não tem como violar.
 */
const COMO_CHAMAR_O_TIME = [
	'Quem levantou as informações são PROFISSIONAIS de um time — nunca escreva "agente", "IA", "bot" ou "sistema" para se referir a eles.',
	'Cite pelo cargo ("o Leitor do Produto viu que…"), fale de "o time", ou escreva a informação direto, sem dizer quem trouxe.',
	'A palavra "agente" só é permitida no sentido químico do produto — "agente desmoldante", "agente de limpeza" —, nunca para pessoa ou etapa deste trabalho.',
].join(' ');

/* ══════════════════════════ o time ══════════════════════════ */

interface Especialista {
	chave: string;
	nome: string;
	papel: string;
	pergunta: string;
	saida: string;
	/** O que ele ENXERGA. Ver a caixa do `entrada` no topo. */
	entrada: 'nenhuma' | 'foto_produto' | 'referencias';
	fase: 'descoberta' | 'aprofundamento' | 'sintese';
	/** Em quais dos quatro caminhos ele entra. Hoje todos são `todas`. */
	entrega: 'todas' | 'post' | 'anuncio' | 'cena' | 'gravar';
	modelo: string;
	/** C5: o time trabalha com o que o aluno deu. Ver `conferirBusca`. */
	motor_busca: 'nenhum' | 'exa' | 'perplexity';
	/**
	 * ⚠ ENQUANTO `motor_busca` FOR `nenhum`, ESTE CAMPO NÃO É GRAVADO — e está
	 * certo. O campo da coleção tem `showIf: { motor_busca: [exa, perplexity] }`,
	 * e `validateCollectionData` descarta o que não se aplica ao registro. Ao
	 * reler a coleção o `max_buscas` não aparece; `toAgentSpec` já zera o número
	 * de buscas de quem não pesquisa, então a ausência não muda nada. Ligar a
	 * busca em alguém faz o campo voltar sozinho.
	 */
	max_buscas: number;
	/** Se falhar, o run não é cobrado. */
	essencial: boolean;
	temperatura: number;
	max_tokens: number;
	/** Ver o campo `raciocinio` da coleção. Ausente = `padrao`. */
	raciocinio?: 'padrao' | 'baixo' | 'desligado';
	timeout_s: number;
	icone: string;
	cor: string;
	frase_trabalhando: string;
	ordem: number;
}

/**
 * Os modelos, e o critério: BARATO ONDE É EXTRAIR, CARO ONDE É JULGAR.
 *
 * ┌─ O TETO DE GASTO DO BLOCO É QUEM DECIDE O EMPATE ────────────────────────┐
 * │ `LIMITES_ATELIE.maxUsd` (0,05 por run) não é conselho: `podeGastar`      │
 * │ PROJETA o pior caso de cada chamada — `max_tokens` inteiros ao preço de  │
 * │ saída do modelo — e PULA quem não couber, avisando o aluno de que aquele │
 * │ profissional "não chegou a trabalhar nesta arte". Só quem escreve o      │
 * │ prompt final é protegido.                                                │
 * │                                                                          │
 * │ Ou seja: um roster caro demais não fica caro — ele fica MENOR, e o time  │
 * │ encolhe em silêncio para quem não lê o log. `conferirOrcamento()` faz a  │
 * │ conta deste roster com a fórmula do próprio bloco, ONDA A ONDA, e quebra │
 * │ o seed quando a projeção passa do teto.                                  │
 * │                                                                          │
 * │ A CONTA QUE ESCOLHEU O LEITOR DO PRODUTO: a saída do Gemini 3.1 Pro      │
 * │ custa US$ 12/M, e com teto de 1.800 tokens mais uma foto de 1.500 tokens │
 * │ na entrada ele sozinho projeta ~US$ 0,026 — a chamada mais cara do time, │
 * │ numa onda em que outros dois leitores correm ao mesmo tempo. Com o teto  │
 * │ do bloco em US$ 0,05 ele NÃO cabia (a onda 1 projetava 0,0475 e qualquer │
 * │ prompt que crescesse depois disso derrubaria um leitor); com o teto de   │
 * │ hoje ele cabe com folga, e é o que este arquivo usa.                     │
 * │                                                                          │
 * │ Ele vale o preço porque é a única chamada cujo erro CONTAMINA as outras  │
 * │ cinco: errado o material, o Diretor de Arte compõe para uma peça que não │
 * │ existe e o Prompt Final pede a arte de outro produto. Se um dia o teto   │
 * │ do bloco descer de novo, esta é a primeira troca a discutir —            │
 * │ `anthropic/claude-haiku-4.5` lê imagem com qualidade `high` por um terço │
 * │ do preço, e `conferirOrcamento()` avisa antes de qualquer aluno pagar.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Nenhum DeepSeek: com busca devolve resposta vazia e cobra a busca; sem busca,
 * gasta o orçamento de saída raciocinando. Ver o cabeçalho de
 * `text-models-catalog.ts`.
 */
/** Visão de topo: olhar uma peça e dizer o que ela é, sem errar o material. */
const M_OLHO = 'google/gemini-3.1-pro-preview';
/** Extrair e classificar sem imagem, onde modelo grande é desperdício. */
const M_EXTRACAO = 'anthropic/claude-haiku-4.5';
/** Julgar e decidir: composição, hierarquia, o pedido final. */
const M_DECISAO = 'anthropic/claude-sonnet-5';
/** Texto corrido em PT-BR por preço baixo. */
const M_COPY = 'google/gemini-3-flash-preview';

/**
 * ┌─ O TAMANHO ESPERADO DA RESPOSTA DE CADA UM, EM TOKENS ───────────────────┐
 * │ ⚠ ESTES NÚMEROS SÃO ESTIMATIVA, NÃO MEDIÇÃO — e a diferença importa.     │
 * │ Na Central, a rodada que calibrou `max_tokens` "pelo tamanho que a saída  │
 * │ parecia ter" matou DOIS profissionais pagos com o JSON cortado em 2 de 3  │
 * │ runs frios. Aqui eles saíram da contagem do `saida` de cada um, contando  │
 * │ 2,5 caracteres por token (o pior ratio medido em JSON português com       │
 * │ acento), mais o texto livre que cada campo comporta.                      │
 * │                                                                          │
 * │ A REGRA É `teto = 2 × esperado`, e ela custa ZERO nos modelos baratos     │
 * │ (medido na Central: Gemini Flash usa 13% a 68% do teto que tem). Quem     │
 * │ paga teto grande é modelo que RACIOCINA antes de escrever — e para esse a │
 * │ folga é o que compra a entrega: o Redator da Central fechou uma chamada   │
 * │ com 3.000 tokens de saída e `content` VAZIO, porque o raciocínio comeu o  │
 * │ teto antes da primeira chave do JSON. Por isso os dois Sonnet daqui têm o │
 * │ maior teto do time, e não porque escrevem mais.                           │
 * │                                                                          │
 * │ PORTÃO: o primeiro run frio da F2 mede `usage.completion_tokens` de cada  │
 * │ chamada e SUBSTITUI esta tabela por medição — na mesma edição em que      │
 * │ ajustar os tetos lá embaixo.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const SAIDA_ESTIMADA: Record<string, number> = {
	/**
	 * MEDIDO em 9 chamadas reais (3 produtos × 3 tetos, foto de verdade, modelo
	 * do roster): 1.836 / 1.840 / 1.934 / 1.940 / 2.190 / 2.205 tokens de saída.
	 * Estava 700 — a estimativa contava só o JSON, e o Gemini 3.1 Pro RACIOCINA
	 * antes de escrever, e o raciocínio é cobrado (e contado) como saída.
	 *
	 * ┌─ O QUE ESSE ERRO CUSTAVA, MEDIDO ────────────────────────────────────────┐
	 * │ Com teto de 1.800 a resposta batia no limite e vinha CORTADA em 2 de 3    │
	 * │ fotos (`out` fecha em 1.786 de 1.800 e o JSON não abre). Cada corte é     │
	 * │ US$ 0,025 gastos e jogados fora MAIS um retry em outro modelo — e o       │
	 * │ retry, no essencial, é o que fazia o run inteiro morrer em 502 quando     │
	 * │ ele também falhava. Rodadas anteriores mediram retry em 4 de 5, depois em │
	 * │ 8 de 8 runs.                                                              │
	 * │                                                                          │
	 * │ Com teto FOLGADO a saída real não cresce — é a prova de que o número      │
	 * │ acima é o tamanho do trabalho, não do teto:                               │
	 * │   teto 3.000 → 1.934 · 1.940 · 2.190 tokens (US$ 0,0270 a 0,0300)         │
	 * │   teto 4.000 → 1.836 · 1.840 · 2.205 tokens (US$ 0,0258 a 0,0302)         │
	 * │ Ou seja: a chamada que ANTES custava 0,025 e não entregava nada passa a   │
	 * │ custar 0,027 e entregar — e some o retry de ~US$ 0,025.                   │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 *
	 * CONFERIDO depois do teto novo já semeado, em mais 3 chamadas com o roster
	 * do banco: 1.818 · 1.910 · 2.289 tokens, JSON ok em 3 de 3. E a prova que
	 * vale mais que a bancada: em 4 peças de ponta a ponta o `leitor_produto`
	 * não pediu retry NENHUMA vez — o mesmo especialista que fazia retry em 8 de
	 * 8 runs e matava dois deles. 2.200 continua sendo o centro da distribuição
	 * (medida agora em 12 chamadas, de 1.818 a 2.289).
	 */
	leitor_produto: 2200,
	leitor_marca: 600,
	leitor_referencias: 750,
	/**
	 * MEDIDO (3 chamadas reais com digest de onda 1): 2.210 / 2.047 / 3.000⁺.
	 * Estava 900 — errado por 2,3×, e é o erro que deixava `conferirTetos`
	 * aprovar um teto de 3.000 que truncava 1 em 3. Com o número de verdade a
	 * trava passa a EXIGIR 4.000, que é o que o Diretor tem agora.
	 * Os outros cinco continuam estimados; quem medir, troca aqui.
	 */
	diretor_arte: 2100,
	/**
	 * MEDIDO em 41 chamadas reais (5 produtos × 4 variantes) e MANTIDO em 900 de
	 * propósito — a única linha desta tabela em que o número medido NÃO é o
	 * número escrito, e vale explicar por quê.
	 *
	 *   google/gemini-3-flash-preview .....   255 a   335 tokens de saída
	 *   anthropic/claude-sonnet-5 ......... 1.389 a 3.749 tokens, mesmos campos
	 *
	 * O modelo de hoje usa 13% do teto que tem. Baixar este número para 335
	 * seria descrever o modelo de hoje e desarmar `conferirTetos` para o de
	 * amanhã: quem trocar o Redator por um modelo que RACIOCINA (e é a troca que
	 * "o título está genérico" pede por reflexo) precisa que a trava cobre folga
	 * — 900 exige teto de 1.800, e é o que impede um JSON cortado passar batido
	 * numa edição de tela. O teto real do Redator é 2.400.
	 */
	redator: 900,
	/**
	 * MEDIDO, e o número dói: 3.186 · 3.680 · 4.437 · 4.793 tokens de saída em
	 * chamadas isoladas com o system e o digest REAIS (`scripts/_mm/medir-sintese.mts`,
	 * mesmo digest de onda 3 em todas, só o teto mudando). Estava 1.100 —
	 * errado por 3,5×, e pelo mesmo motivo de sempre neste arquivo: 1.100 é o
	 * tamanho do JSON, e o Sonnet RACIOCINA antes da primeira chave, e o
	 * raciocínio é cobrado (e contado) como saída.
	 *
	 * ┌─ O QUE ESSE ERRO CUSTA HOJE, MEDIDO ─────────────────────────────────────┐
	 * │ Com o teto de 4.000 a resposta bate no limite e vem CORTADA em 2 de 3     │
	 * │ chamadas (uma delas fechou em `out` 4.000 de 4.000, JSON aberto e sem     │
	 * │ fechar). Como este é o único essencial da onda 3, cada corte vira retry   │
	 * │ em outro modelo — e quando o retry também trunca, o run inteiro morre em  │
	 * │ 502 com as duas primeiras ondas já pagas. Medido em 4 peças de ponta a    │
	 * │ ponta: `prompt_final` refeito em 3 de 4 e run MORTO em 2 de 4.            │
	 * │ Com teto de 6.000 o JSON fechou em 2 de 2 (4.437 e 4.793 tokens).         │
	 * │                                                                          │
	 * │ ⚠ E NÃO DÁ PARA CONSERTAR AQUI. O teto de 6.000 é maior que o            │
	 * │ `MAX_TOKENS_TETO` do time (4.000, `lib/atelie/agents.ts`) e, mesmo que    │
	 * │ ele subisse, `conferirOrcamento()` recusaria o roster: a onda 3 passaria  │
	 * │ de US$ 0,0515 para ~US$ 0,0715 de pior caso e o run projetaria ~US$ 0,156 │
	 * │ contra os US$ 0,110 de `LIMITES_ATELIE.maxUsd`. Ou seja: a saída deste    │
	 * │ defeito passa por `maxUsd`, que é DECISÃO DE MARGEM DO DONO — por isso    │
	 * │ aqui só se mede e se registra. Não mexa em nenhum dos dois sem ele.       │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 *
	 * O número escrito é o MEDIDO de propósito, mesmo sabendo que `conferirTetos`
	 * não vai conseguir exigir os 7.800 que ele implica: a exigência é CLAMPADA
	 * em `MAX_TOKENS_TETO`. Escrever 2.000 aqui só para a trava "passar" seria
	 * descrever o teto em vez do trabalho — e é assim que o número volta a
	 * mentir. O aviso do clamp (ver `conferirTetos`) existe para que essa
	 * diferença apareça em toda rodada de seed, em vez de morar só neste
	 * comentário.
	 */
	prompt_final: 3900,
};

const TIME: Especialista[] = [
	/* ═════════════ ONDA 1 — DESCOBERTA: quem LÊ o que existe ═════════════ */
	{
		chave: 'leitor_produto',
		nome: 'Leitor do Produto',
		papel: [
			'Você olha a FOTO da peça que a pessoa fabricou e diz o que ela tem de melhor.',
			'Descreva o que ESTÁ na imagem: o que é, de que material parece ser, a cor, o acabamento (bruto, lixado, envernizado, escovado, espelhado, fosco), como foi feito (corte, gravação, pintura, encaixe, colagem) e o tamanho aparente comparado a algo conhecido.',
			'O QUE VALORIZA é o coração do seu trabalho: de 2 a 4 coisas que a arte PRECISA mostrar de perto — o veio da madeira, o brilho do inox, a transparência do acrílico, a profundidade da gravação, o encaixe justo, a espessura da chapa, a borda limpa do corte. De cada uma diga o que ela prova para quem vai comprar.',
			'O QUE ESCONDER é o resto: queimado da borda, cola aparente, risco, poeira, etiqueta, mão na frente da peça, fundo bagunçado da foto, sombra dura de flash e reflexo com o fotógrafo dentro.',
			'Diga também o ÂNGULO que valoriza a peça (de frente, três quartos, de cima, macro na gravação) e o que esse ângulo mostra que os outros escondem.',
			'Se a foto não deixa saber, diga que não dá para saber e baixe a confiança — NUNCA invente material, medida, acabamento ou uso.',
			'Sem foto nenhuma, trabalhe só com o que a pessoa escreveu, marque confiança baixa e diga o que uma foto resolveria. Isso não é erro: muita gente começa sem foto.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Olhe a foto de {produto} e diga o que a peça é, o que ela tem de melhor para aparecer numa arte de {entrega} e o que é melhor esconder.',
		saida: [
			'{"produto":"","material":"","cor_predominante":"","acabamento":"",',
			'"tamanho_aparente":"","como_foi_feito":"",',
			'"o_que_valoriza":[{"detalhe":"","por_que_vende":""}],',
			'"o_que_esconder":[""],"angulo_que_valoriza":"","o_que_o_angulo_mostra":"",',
			'"confianca":0,"observacao":""}',
		].join(''),
		/**
		 * A ÚNICA leitura que enxerga a peça. Sem `{marca}` de propósito: o que a
		 * peça É não muda com o tom de voz de quem vende, e temperar a leitura com
		 * a identidade faria o Leitor "achar" na foto o que a marca queria ver.
		 */
		entrada: 'foto_produto',
		fase: 'descoberta',
		entrega: 'todas',
		modelo: M_OLHO,
		motor_busca: 'nenhum',
		max_buscas: 0,
		/**
		 * ESSENCIAL. Ele é a base dos outros cinco: sem a leitura da peça, o
		 * Diretor de Arte inventa uma peça e o Prompt Final pede uma arte de outro
		 * produto. Uma arte assim não é "pior": é de outra coisa, e cobrar por ela
		 * seria vender o erro.
		 */
		essencial: true,
		temperatura: 0.1,
		/**
		 * 1.800 → 4.000, e o número saiu de MEDIÇÃO (ver `SAIDA_ESTIMADA`).
		 *
		 * Não é "dar mais espaço para ele escrever mais": com 4.000 ele escreve
		 * exatamente o mesmo que com 3.000 (1.836 a 2.205 tokens medidos). O que
		 * muda é que a resposta CABE — em 1.800 ela vinha cortada em 2 de 3 fotos,
		 * e um `essencial` cortado é retry pago e, quando o retry também falha,
		 * 502 com o run estornado.
		 *
		 * E é aqui que se conserta o Redator sumindo da arte: o freio de custo do
		 * bloco compara o gasto REAL das ondas anteriores com a projeção da onda
		 * seguinte, e a onda 1 gastava US$ 0,047 (corte + retry) em vez de
		 * US$ 0,030. Eram esses ~17 milésimos que faziam a 2ª marcha cortar o
		 * Redator depois que o Diretor de Arte reservava o pior caso dele.
		 */
		max_tokens: 4000,
		timeout_s: 60,
		icone: 'scan-eye',
		cor: '#f59e0b',
		frase_trabalhando: 'Olhando a foto da sua peça…',
		ordem: 10,
	},
	{
		chave: 'leitor_marca',
		nome: 'Leitor da Marca',
		papel: [
			'Você traduz a marca cadastrada em REGRAS VISUAIS — decisões que um diretor de arte consegue seguir.',
			'"Rústico e artesanal" não é instrução. Luz quente vinda de um lado só, madeira crua, tecido de algodão, sombra macia, letra com serifa, nada de degradê e nada de neon É instrução. Faça essa tradução em toda linha que escrever.',
			'A PALETA sai das cores cadastradas, e você diz ONDE cada uma entra: qual é o fundo, qual é o detalhe que chama o olho, qual é a do texto. A cor de fundo cadastrada é o fundo das peças — não invente outro.',
			'Se a marca não tem cor cadastrada, proponha uma paleta que combine com o jeito dela e DIGA que a proposta é sua.',
			'CONTRASTE É OBRIGAÇÃO: texto claro sobre fundo claro some no celular de quem vai ler, e peça escura sobre fundo escuro vira mancha.',
			/**
			 * ┌─ ERA DAQUI QUE SAÍA A LUZ CHAPADA — a decisão mais anti-publicitária ─┐
			 * │ Nos 4 runs medidos, a `luz` deste especialista voltou como "luz       │
			 * │ natural difusa, sem sombra dura" nas quatro vezes, e o `fundo` como   │
			 * │ "branco ou creme muito claro" nas quatro. As duas frases são          │
			 * │ traduções honestas de "rústico e artesanal" + `nao_usar: fundo        │
			 * │ escuro` — e juntas chegam ao gerador como a receita exata da foto de  │
			 * │ marketplace: objeto sobre vazio branco, sem sombra, sem volume.       │
			 * │                                                                       │
			 * │ Não dá para consertar isso no Diretor: ele obedece à marca, e faz     │
			 * │ bem. Conserta-se AQUI, onde a marca vira regra — obrigando toda luz   │
			 * │ a ter origem e toda superfície a ser uma superfície de verdade.       │
			 * └───────────────────────────────────────────────────────────────────────┘
			 */
			'LUZ SEM DIREÇÃO NÃO É REGRA DE MARCA, É AUSÊNCIA DE REGRA. "Luz natural difusa" e "sem sombra dura" chegam ao gerador como luz chapada de estúdio, que é o acabamento da foto de marketplace. Toda luz que você descrever tem de dizer DE QUE LADO vem e QUE SOMBRA deixa — mesmo a mais suave de todas. O que uma marca artesanal evita é o FLASH DIRETO (sombra recortada, reflexo com o fotógrafo dentro), nunca a sombra: é a sombra que prova que a peça está apoiada em algo.',
			'E FUNDO CLARO NÃO É FUNDO VAZIO: se a marca pede claro, o claro é uma superfície de verdade com luz caindo nela — uma parede, uma toalha de linho, uma mesa de madeira clara, um ambiente desfocado atrás. Nunca um branco liso recortado, que é onde o produto fica boiando sem lugar nenhum.',
			'O QUE EVITAR sai da lista do que a marca nunca usa, copiada sem suavizar, mais o que o jeito dela desmente — uma marca sóbria não leva confete, uma marca artesanal não leva reflexo de estúdio.',
			/**
			 * Este campo mandava "diga em que canto fica a área limpa reservada" e
			 * era, junto com o `O_LOGO_NAO_SE_DESENHA` antigo, a fonte da frase que
			 * o gerador transformou em cartão branco. Agora ele descreve um HÁBITO
			 * da marca, não uma instrução de desenho.
			 */
			'A ASSINATURA é o hábito da marca: diga em que canto ela costuma assinar. NÃO é para reservar espaço nenhum — quem aplica o logo é um programa nosso, depois, medindo a arte pronta. Nunca escreva "área limpa", "espaço reservado" nem nada parecido.',
			O_LOGO_NAO_SE_DESENHA,
			A_MARCA_MANDA,
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Traduza em regras visuais a marca de quem vai publicar, para uma arte de {entrega} no formato {formato}. {marca}',
		saida: [
			'{"paleta":[{"cor":"","onde_entra":""}],"luz":"","fundo":"","superficie":"",',
			'"clima":"","tipografia":"","peso_visual":"","assinatura":"","evitar":[""],',
			'"paleta_proposta_por_mim":false,"observacao":""}',
		].join(''),
		entrada: 'nenhuma',
		fase: 'descoberta',
		entrega: 'todas',
		modelo: M_EXTRACAO,
		motor_busca: 'nenhum',
		max_buscas: 0,
		// Não é essencial: sem marca cadastrada ele responde o caminho neutro, e é
		// isso que a maioria dos alunos vai receber no primeiro dia.
		essencial: false,
		temperatura: 0.2,
		max_tokens: 1600,
		timeout_s: 60,
		icone: 'palette',
		cor: '#8b5cf6',
		frase_trabalhando: 'Traduzindo a sua marca em regras de arte…',
		ordem: 20,
	},
	{
		chave: 'leitor_referencias',
		nome: 'Leitor das Referências',
		papel: [
			'Você olha os anúncios que a pessoa subiu como referência e explica POR QUE eles funcionam.',
			'De CADA um: como a imagem está montada (o produto ocupa quanto do quadro, está no centro ou de lado, quanto sobra de espaço vazio), ONDE fica o texto e quanto ele ocupa, o que se lê primeiro, o fundo, a luz e o contraste.',
			'REFERÊNCIA É ESTRUTURA, NUNCA IDENTIDADE. Copiar composição, ângulo e hierarquia é legítimo e é para isso que ela serve; copiar a marca dos outros é falsificação. Nunca traga para a nossa arte o logotipo, o nome, a fonte exclusiva, as cores de identidade nem as promessas do anúncio de referência — o que for desse tipo você lista como o que NÃO copiar.',
			'Termine dizendo o que essas referências têm em comum e o que vale a pena repetir na arte DESTA pessoa, lembrando que a marca dela pode ser bem diferente da do anúncio.',
			'Sem nenhuma referência, devolva a lista vazia e diga isso. NUNCA invente um anúncio que você não viu — e não é erro nenhum: a maioria das pessoas não sobe referência.',
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Estude os anúncios de referência que a pessoa mandou e diga o que faz cada um funcionar e o que vale repetir numa arte de {entrega} para {produto}.',
		saida: [
			'{"referencias":[{"resumo":"","composicao":"","onde_fica_o_texto":"",',
			'"o_que_se_le_primeiro":"","fundo":"","luz":"","o_que_funciona":"",',
			'"o_que_nao_copiar":""}],"padrao_comum":"","o_que_repetir":[""],"observacao":""}',
		].join(''),
		entrada: 'referencias',
		fase: 'descoberta',
		entrega: 'todas',
		modelo: M_EXTRACAO,
		motor_busca: 'nenhum',
		max_buscas: 0,
		essencial: false,
		temperatura: 0.2,
		max_tokens: 1800,
		timeout_s: 60,
		icone: 'images',
		cor: '#0ea5e9',
		frase_trabalhando: 'Estudando os anúncios que você mandou…',
		ordem: 30,
	},

	/* ═══════════ ONDA 2 — APROFUNDAMENTO: quem DECIDE a peça ═══════════ */
	{
		chave: 'diretor_arte',
		nome: 'Diretor de Arte',
		papel: [
			'Você decide a imagem: o que aparece, de que tamanho, onde, com que luz, e o que o olho encontra primeiro.',
			'Você recebe o material do time — a leitura da peça, as regras da marca e o estudo das referências — e o seu trabalho é fazer as três caberem numa imagem só. Onde a marca e a referência discordarem, vence a marca; onde a peça e a estética discordarem, vence a peça, porque é ela que está à venda.',
			'DECIDA, não descreva possibilidades: um enquadramento, um fundo, uma luz. "Pode ser A ou B" empurra a escolha para o gerador de imagem, e ele escolhe pior do que você.',
			'A PEÇA É A HEROÍNA: ela ocupa o centro da atenção, no ângulo que o Leitor do Produto disse valorizar, mostrando os detalhes que ele mandou mostrar. Você NÃO muda a peça — nem a cor, nem o material, nem o formato, nem o acabamento dela.',
			'O FUNDO existe para destacar a peça, não para competir: contraste de tom com ela, sem textura que dispute atenção, e respeitando o fundo que a marca declarou.',
			A_FOTOGRAFIA_TEM_AUTOR,
			'Essas quatro decisões têm campo próprio e nenhum deles pode sair genérico: `momento` é a hora e a situação ("fim de tarde, mesa da festa já posta"); `camera` é altura, distância, lente e profundidade; `luz` é de onde vem, que dureza tem e que sombra joga; `o_que_esta_atras` é o que aparece desfocado no fundo. Escrever "luz natural difusa" em `luz` é entregar a decisão ao gerador — e ele decide estúdio.',
			/**
			 * ┌─ A AUSÊNCIA VIROU ELEMENTO, E O GERADOR ESTAVA CERTO EM DESENHÁ-LA ──┐
			 * │ Medido no `direcao_arte` de um run real: o Diretor listou em         │
			 * │ `onde_o_olho_bate` → ["A gravação…", "O contraste…", "A ÁREA LIMPA   │
			 * │ RESERVADA PARA O TEXTO NA PARTE INFERIOR DO QUADRO"]. A partir dali  │
			 * │ o vazio estava PROMOVIDO A ELEMENTO VISUAL na hierarquia da arte —   │
			 * │ e o gerador, obedecendo à lista, pintou uma faixa creme sólida       │
			 * │ atravessando o rodapé. Não foi desobediência: foi obediência.        │
			 * └──────────────────────────────────────────────────────────────────────┘
			 */
			'ONDE O OLHO BATE é uma ordem de três, e os três são COISAS QUE EXISTEM na imagem — a gravação acesa, o brilho da borda metálica, a mão que sai do quadro. NUNCA liste uma ausência ("a área limpa", "o espaço vazio", "o fundo reservado"): ausência não é elemento, e tudo o que você listar aqui o gerador vai DESENHAR.',
			O_TEXTO_E_PARTE_DA_FOTOGRAFIA,
			CANTO_LEGIVEL_POR_MAQUINA,
			A_FOLGA_QUE_SOBREVIVE_AO_RECORTE,
			'O FORMATO PEDIDO manda na composição: o vertical pede peça alta e texto em cima ou embaixo; o quadrado pede peça um pouco fora do eixo, com o peso embaixo; o deitado abre espaço lateral para o texto.',
			'No máximo DOIS objetos de apoio EM FOCO, e só se pertencerem ao mundo de quem compra — uma bancada de madeira, um pano de linho, um café. Apoio demais vira bagunça e come a peça. O que estiver FORA DE FOCO atrás não conta como apoio: é ambiente, e é ele que tira a peça do limbo do estúdio.',
			'NÃO FAZER é lista curta e específica DESTA arte ("nada de flor seca, que já apareceu em todas as referências"), não regra geral.',
			O_LOGO_NAO_SE_DESENHA,
			A_MARCA_MANDA,
			COMO_CHAMAR_O_TIME,
			TOM,
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Monte a direção de arte de {entrega} no formato {formato}, usando a leitura da peça, as regras da marca e o estudo das referências que estão no material do time. {marca}',
		/**
		 * ┌─ OS TRÊS CAMPOS NOVOS SÃO A DIREÇÃO DE ARTE QUE FALTAVA ─────────────┐
		 * │ `momento`, `camera` e `o_que_esta_atras` não existiam, e a ausência   │
		 * │ deles é literalmente a queixa: sem hora do dia, sem posição de câmera │
		 * │ e sem contexto de fundo, o que sobra para o gerador decidir é o       │
		 * │ default dele — estúdio, luz chapada, fundo liso. Nos 4 runs medidos   │
		 * │ ele decidiu exatamente isso, 4 vezes.                                 │
		 * │                                                                       │
		 * │ Campo novo aqui NÃO custa migração nem deploy: `direcao_arte` viaja   │
		 * │ como o objeto inteiro do Diretor (`ai-art-team.ts` emite              │
		 * │ `doAgente(diretor)?.json`) e já está na allow-list do `output` dos    │
		 * │ dois lados — o que entra no `saida` pega carona. E o card da tela     │
		 * │ desenha por `Object.entries`, então campo novo aparece sozinho.       │
		 * │                                                                       │
		 * │ ⚠ `area_da_assinatura` MUDOU DE SENTIDO MAS NÃO DE NOME, de           │
		 * │ propósito: o `image.brandmark` lê essa chave como prosa de reserva    │
		 * │ (`lerCanto(d.area_da_assinatura)`) quando o `canto_da_assinatura`     │
		 * │ falta. Renomear mataria esse caminho em silêncio. Ela deixou de ser   │
		 * │ "a área que você reservou" e passou a ser "o canto que ficou calmo".  │
		 * │ `area_de_texto` virou `tipografia_na_arte` porque ninguém a lê e o    │
		 * │ nome antigo era metade do problema: quem preenche um campo chamado    │
		 * │ "área de texto" descreve uma ÁREA.                                    │
		 * └───────────────────────────────────────────────────────────────────────┘
		 */
		saida: [
			'{"conceito":"","momento":"","enquadramento":"","angulo":"","camera":"",',
			'"posicao_do_produto":"","fundo":"","o_que_esta_atras":"","superficie":"",',
			'"luz":"","paleta_da_cena":[""],"onde_o_olho_bate":["","",""],',
			'"tipografia_na_arte":"","area_da_assinatura":"","canto_da_assinatura":"",',
			'"props":[""],"nao_fazer":[""],"observacao":""}',
		].join(''),
		/**
		 * `nenhuma`, e não `foto_produto`: quem olhou a foto foi o Leitor do
		 * Produto, e a leitura dele chega aqui por escrito no material do time.
		 * Mandar a imagem de novo pagaria a visão duas vezes para obter a mesma
		 * informação — e abriria espaço para as duas leituras discordarem.
		 */
		entrada: 'nenhuma',
		fase: 'aprofundamento',
		entrega: 'todas',
		modelo: M_DECISAO,
		motor_busca: 'nenhum',
		max_buscas: 0,
		essencial: false,
		// Mais alta que a dos leitores: aqui a escolha é criativa. Mais baixa que
		// a do Redator: composição errada estraga a peça, adjetivo errado não.
		temperatura: 0.5,
		/**
		 * MEDIDO, NÃO ESTIMADO — e foi por isso que subiu de 3.000 para 4.000.
		 *
		 * O portão declarado na caixa de `SAIDA_ESTIMADA` ("o primeiro run frio
		 * mede `usage.completion_tokens` e SUBSTITUI esta tabela") foi cumprido
		 * aqui. Três chamadas ao provedor real, com um digest de onda 1 do tamanho
		 * de verdade (~8.400 chars de prompt):
		 *
		 *   #1  finish=stop     2.210 tokens de saída   JSON fechou
		 *   #2  finish=stop     2.047 tokens            JSON fechou
		 *   #3  finish=LENGTH   3.000 tokens (o teto)   JSON TRUNCADO  US$ 0,037
		 *
		 * Uma em três batia no teto. E a chamada truncada não é só perda: o bloco
		 * a descarta, paga de novo no modelo reserva, e o Diretor — que decide o
		 * enquadramento da peça inteira — entrega o resultado do segundo time.
		 *
		 * Subir o teto NÃO encarece o caso normal: cobra-se token PRODUZIDO, não
		 * teto reservado (#1 e #2 continuam custando o que custavam). O que ele
		 * compra é o desaparecimento da chamada jogada fora. 4.000 é o maior valor
		 * possível: `MAX_TOKENS_TETO` do time, e `toAgentSpec` apara qualquer
		 * coisa acima disso.
		 */
		max_tokens: 4000,
		/**
		 * DESLIGADO — pelo mesmo motivo do `prompt_final`, e medido junto com ele.
		 * Sonnet gasta o teto raciocinando e entrega JSON pela metade; sem o
		 * raciocínio a direção de arte sai igual, pela metade do preço e sem
		 * derrubar o run. Ver o campo `raciocinio` em `lib/atelie/agents.ts`.
		 */
		raciocinio: 'desligado',
		timeout_s: 75,
		icone: 'frame',
		cor: '#ec4899',
		frase_trabalhando: 'Montando o enquadramento e a luz…',
		ordem: 40,
	},
	{
		chave: 'redator',
		nome: 'Redator',
		/**
		 * ┌─ O TESTE DO TROCA-TROCA, E POR QUE ELE VIROU A PRIMEIRA LINHA ───────────┐
		 * │ O dono olhou uma peça e reprovou o texto: "Sua marca gravada com         │
		 * │ precisão". Reproduzido e MEDIDO, com este mesmo Redator, em cinco        │
		 * │ produtos diferentes (copo, tábua, plaquinha de bebê, chaveiro, troféu):  │
		 * │                                                                          │
		 * │   "Seu nome gravado com cuidado" ....... cabia em 4 dos 4 outros         │
		 * │   "Eternize este momento" .............. cabia em 4 dos 4                │
		 * │   "Excelência em cada detalhe" ......... cabia em 4 dos 4                │
		 * │   "CHURRASCO COM SEU NOME" ............. não cabia em nenhum             │
		 * │                                                                          │
		 * │ O único que não é intercambiável é o único que NOMEIA A COISA. Frase que │
		 * │ serve para qualquer peça não vende peça nenhuma — ela é a queixa do dono │
		 * │ escrita por extenso, e o teste do troca-troca é o portão que a barra.    │
		 * │                                                                          │
		 * │ ⚠ Não é o modelo. Medido no mesmo material, o Sonnet custa 12,6× mais,   │
		 * │ demora 6,9× e devolve JSON inutilizável em 19% das chamadas (o raciocínio│
		 * │ come o teto antes da primeira chave) — e ainda assim escreve título mais │
		 * │ genérico que este papel no modelo barato. Ver a caixa do `modelo`.       │
		 * └──────────────────────────────────────────────────────────────────────────┘
		 *
		 * ┌─ PROIBIR FUNCIONA MELHOR QUE PEDIR (achado da mesma medição) ────────────┐
		 * │ Das cinco marcas de teste, a ÚNICA que arrancou texto específico foi a   │
		 * │ que proibia TOM ("direto e sem frescura", `nao_usar` com a palavra       │
		 * │ "delicado"), não só elemento gráfico. Um pedido de especificidade ele    │
		 * │ elogia e ignora; uma lista de frases proibidas ele obedece. Por isso o   │
		 * │ miolo deste papel é uma lista negra de clichê, e não um convite a        │
		 * │ "ser criativo".                                                          │
		 * └──────────────────────────────────────────────────────────────────────────┘
		 *
		 * ┌─ ESPECÍFICO NÃO É INVENTADO — o preço de cobrar especificidade ──────────┐
		 * │ Quando a ficha da peça não chega (o Leitor do Produto trunca e às vezes  │
		 * │ morre), cobrar especificidade faz o modelo COMPRAR o específico          │
		 * │ inventando: em duas de três rodadas de teste sem ficha ele escreveu      │
		 * │ "para o seu pai" — palavra que o aluno nunca digitou. Por isso as duas   │
		 * │ linhas de aterramento abaixo, que mandam tirar o específico do OBJETO    │
		 * │ quando não se sabe de quem é. Sem elas este papel troca "genérico" por   │
		 * │ "mentiroso", que é pior.                                                 │
		 * │                                                                          │
		 * │ E DUAS DAS LINHAS DA FRASE DA ARTE NASCERAM DA MEDIÇÃO DESTE PAPEL, não  │
		 * │ de teoria. Na primeira rodada com ele, a frase saiu concreta em 3 de 5   │
		 * │ ("FAMÍLIA SOUZA", "Campeonato 2026" — as duas LIDAS da foto pelo Leitor  │
		 * │ do Produto) e errada nas outras duas, das duas maneiras que só aparecem  │
		 * │ quando se cobra concretude:                                              │
		 * │                                                                          │
		 * │   "Amigo Secreto 2024" .... ano inventado — e ERRADO; o aluno            │
		 * │                             publicaria a peça dele com o ano passado     │
		 * │                             estampado                                    │
		 * │   "Família SILVA" ......... na rodada SEM a ficha da peça, ele copiou o  │
		 * │                             formato de "Família Souza" e inventou o      │
		 * │                             sobrenome. Isso vai IMPRESSO na arte.        │
		 * │   "Nomes e data gravados" · "Café quente, nome gravado" ...... a frase   │
		 * │                             falando do PROCESSO em vez de ser a palavra  │
		 * │                             da peça                                      │
		 * │                                                                          │
		 * │ Concretude sem trava vira dado inventado, e dado inventado NA ARTE não   │
		 * │ tem conserto depois: sai impresso.                                       │
		 * └──────────────────────────────────────────────────────────────────────────┘
		 *
		 * ┌─ E POR QUE A FRASE DA ARTE DEIXOU DE COPIAR A GRAVAÇÃO ──────────────────┐
		 * │ Tirar a frase do que está gravado na peça ("FAMÍLIA SOUZA") resolvia o   │
		 * │ troca-troca e criava um defeito maior, medido no A/B de 4 produtos: a    │
		 * │ regra de arte proíbe dizer duas vezes a mesma coisa no mesmo quadro, e   │
		 * │ o `prompt_final`, obedecendo às duas, apagou a manchete em 4 peças de 4. │
		 * │                                                                          │
		 * │ O acerto é mais simples e fecha os dois furos com UMA regra: a frase da  │
		 * │ arte NUNCA leva dado de ninguém — nem gravado (já está na foto), nem     │
		 * │ inventado ("Família Silva", "Amigo Secreto 2024"). Ela leva a OCASIÃO, o │
		 * │ objeto ou o lugar, que é concreto, passa no troca-troca e acrescenta o   │
		 * │ que a foto não diz. O par desta regra mora em                            │
		 * │ `O_TEXTO_E_PARTE_DA_FOTOGRAFIA`, e as duas só funcionam juntas.          │
		 * └──────────────────────────────────────────────────────────────────────────┘
		 */
		papel: [
			'Você escreve o texto de venda de UMA peça específica, feita por um pequeno produtor que tem uma máquina a laser: o título, a chamada, a frase curta que vai DENTRO da arte e a legenda.',

			'O TESTE QUE O SEU TEXTO TEM DE PASSAR, e você aplica sozinho antes de responder: pegue o seu título e imagine-o na peça de OUTRO produtor, que fabrica outra coisa. Se ele couber lá sem trocar uma palavra, está errado e você reescreve. O mesmo vale para a chamada e para a frase da arte.',
			'Para passar, o texto precisa carregar pelo menos DUAS destas três coisas: a COISA que está na foto (o objeto pelo nome que o cliente usaria, o material, o acabamento ou o detalhe que o Leitor do Produto disse que vende), QUEM RECEBE a peça, e O DIA em que ela é comprada.',
			'Antes de escrever, responda para si mesmo: que objeto é este, na palavra que o cliente digitaria? quem paga por ele? em que dia da vida da pessoa ele é comprado? o que ela ganha encomendando em vez de comprar pronto na prateleira? As respostas aparecem espalhadas pelo título, pela chamada e pela legenda — como texto, nunca como lista.',

			'PROIBIDO no título, na chamada e na frase da arte, porque é isto que faz todo texto de laser ficar igual: "sua marca", "sua ideia", "sua história", "seu projeto", "com precisão", "com perfeição", "alta precisão", "qualidade", "exclusividade", "eternizar", "eternize", "transformamos", "damos vida", "único como você", "detalhes que fazem a diferença", "feito com carinho", "gravado com cuidado", "arte em madeira", "arte em acrílico".',
			'Também é proibido o ESQUELETO delas, que é o defeito de verdade: possessivo mais palavra abstrata mais "gravado" mais "com" mais outra palavra abstrata. "Sua marca gravada com precisão" e "Seu nome gravado com cuidado" são a mesma frase, e nenhuma das duas fala da peça.',
			'PROIBIDO o título que fala da GRAVAÇÃO em vez de falar da PEÇA. Ninguém compra gravação: compra a tábua, o copo, o troféu, a plaquinha, a lembrancinha.',

			'ESPECÍFICO NÃO É INVENTADO, e esta linha manda em todas as de cima: só se pode ser específico com o que está no material do time ou no que a pessoa escreveu.',
			'Quando a leitura da peça não vier, o específico sai do OBJETO e do que a pessoa digitou — nunca de gente que ninguém citou. Não escreva "para o seu pai", "para a sua mãe", "para o seu namorado", e não invente a ocasião. Um texto específico sobre a COISA passa no teste sem inventar ninguém.',
			'E não invente PARTE DA PEÇA para render um argumento: medida, material, cor, acabamento, canaleta para o suco, encaixe, furo, alça, tampa, revestimento e verniz só entram se alguém tiver visto ou escrito. É o detalhe que soa mais convincente e é o que faz a pessoa anunciar uma peça que ela não fabrica — o cliente pede, e chega outra coisa.',

			'COMECE PELOS TRÊS PRIMEIROS CAMPOS e escreva-os curtos: o objeto na palavra do cliente, quem paga pela peça, e o dia em que ela é comprada. A pessoa lê isso na tela junto com o texto. O que não der para saber pelo material fica VAZIO — chute ali reaparece como invenção no título.',
			'O TÍTULO tem no máximo 8 palavras, contando artigo e preposição, e nomeia o objeto ou o momento.',
			'OS TRÊS TÍTULOS SÃO TRÊS IDEIAS, não três sinônimos: o principal puxa pelo objeto; dos dois alternativos, um puxa pelo momento da compra e o outro por quem recebe. Reordenar as mesmas cinco palavras não é alternativa — é o mesmo título três vezes.',
			'A CHAMADA continua o título e entrega o argumento concreto: o que ESTA peça tem que a de prateleira não tem, ou para que ela serve no dia que você imaginou. Adjetivo sozinho não é argumento.',
			'A FRASE QUE VAI NA ARTE é curta: no máximo cinco palavras, e só se ela ganhar o lugar. Gerador de imagem erra letra em texto longo, e letra errada na peça perde a arte inteira. Se nada de bom couber em cinco palavras, deixe vazio — arte sem texto é melhor que arte com palavra torta.',
			'E nela prefira PALAVRA CONCRETA a adjetivo: o nome da ocasião em que ESTA peça é comprada, o objeto pelo nome que o cliente usa, ou o lugar onde ela vai ficar. É a frase que o cliente vê primeiro, e adjetivo curto é o que mais reprova no teste do troca-troca.',
			/**
			 * ┌─ O MODELO COPIA O EXEMPLO — medido, e sai IMPRESSO na arte ──────────────┐
			 * │ A primeira versão desta regra trazia três exemplos de ocasião entre      │
			 * │ aspas ("amigo secreto", "porta da maternidade", "churrasco de domingo"). │
			 * │ Em 4 runs reais o Redator devolveu "Churrasco de domingo" para um        │
			 * │ TROFÉU DE FUTEBOL e "Amigo secreto de domingo" para um copo — dois       │
			 * │ exemplos colados um no outro. Exemplo entre aspas neste papel é o        │
			 * │ material mais fácil de copiar que ele tem, e o campo copiado é           │
			 * │ justamente o que vai estampado na peça.                                  │
			 * └──────────────────────────────────────────────────────────────────────────┘
			 */
			'OS EXEMPLOS DESTE PAPEL SÃO DE PEÇAS DE OUTRAS PESSOAS, e nenhum deles é resposta. Se a frase que você ia escrever está escrita aqui neste texto, ela está errada — apague e escreva a da peça que está na sua frente.',
			'ELA NÃO REPETE O QUE JÁ ESTÁ GRAVADO NA PEÇA, e não leva DADO DE NINGUÉM. Nome, sobrenome, data, ano e número ficam de fora dessa frase, sempre — quando estão gravados, já aparecem na foto, e a mesma palavra duas vezes no mesmo quadro é erro de arte que perde a peça; quando não estão, escrevê-los é inventar, e invenção ali sai IMPRESSA (uma arte que estampa "Família Silva" na peça de quem se chama Almeida, ou o ano errado, não tem conserto depois). Se o Leitor do Produto leu um sobrenome gravado na tábua, a sua frase fala do DIA em que essa tábua é usada, nunca do sobrenome de novo.',
			'E essa frase NÃO É A DESCRIÇÃO DA PEÇA: quem olha a arte já está vendo a peça, e ler o que ela é embaixo dela é redundância. "Copo térmico com nome gravado" está ERRADO ali; "Amigo secreto" está certo. Dentro dessa frase são proibidas as palavras "gravado", "gravação", "personalizado", "feito a laser" e "corte a laser" — elas falam da oficina, e quem compra não comprou a oficina.',
			'ATENÇÃO: essa trava vale para DADO DE ALGUÉM (nome, sobrenome, data, ano, número), não para palavra concreta. O nome da ocasião, o objeto e o lugar onde a peça vai ficar continuam liberados e são o CAMINHO NORMAL, tenha a peça algo gravado ou não. Deixar vazio é o último recurso, para quando nem isso couber em cinco palavras — não o primeiro; uma peça de rede social sem manchete nenhuma vira catálogo.',
			'A LEGENDA tem no máximo 400 caracteres, fala com UMA pessoa (não com "vocês"), diz o que é a peça em português de gente e termina com um convite claro que combine com onde vai ser publicado.',

			'ANÚNCIO E POST NÃO SE ESCREVEM IGUAL, e isto é regra dura. No ANÚNCIO de marketplace o título começa pelo que a pessoa digita na busca — o que é, material, medida, para quem — e não leva emoji. No POST de rede social é PROIBIDO empilhar palavra-chave: "Chaveiro Coração MDF Personalizado Lembrança Casamento" é etiqueta de vitrine e faz a pessoa continuar rolando; no post o começo é o que faz parar a rolagem.',
			'Escreva no jeito de falar da marca e para o público dela. A lista do que a marca nunca usa é proibição — inclusive de palavra, de emoji e de tom.',
			'NUNCA prometa o que ninguém garantiu: frete grátis, prazo, garantia, desconto, "últimas unidades". Nunca escreva um preço que a pessoa não deu. Nunca use marca registrada, personagem, time ou música.',
			'Cor e fonte da marca NÃO entram no texto: elas mandam na arte, não na legenda. Nunca escreva código de cor nem nome de fonte no que a pessoa vai publicar.',
			A_MARCA_MANDA,
			COMO_CHAMAR_O_TIME,
			TOM,
			ANTI_INVENCAO,
		].join(' '),
		/**
		 * `{publico}` — o campo que a tela pergunta ("Para quem é?"), serializa,
		 * transmite, cobra junto e o time DESCARTAVA em silêncio: das seis
		 * perguntas do roster, `{produto}` aparecia oito vezes e `{publico}`
		 * nenhuma. O que sobrava era o `marca_publico` do cadastro — que é o
		 * público da EMPRESA, e a empresa tem um só: o mesmo marceneiro vende
		 * tábua para churrasqueiro e chaveiro para noiva.
		 *
		 * Ele entra como "para vender {produto} para {publico}" e não como "quem
		 * compra: {publico}." de propósito: `interpolar` apaga a variável vazia
		 * JUNTO com a preposição que a introduzia, então sem resposta a frase
		 * fecha em "para vender a tábua, usando o que o time levantou". Na forma
		 * com dois-pontos sobraria um "quem compra:." — um buraco visível no
		 * prompt de quem não preencheu o campo, que é opcional.
		 */
		pergunta:
			'Escreva o texto de {entrega} para vender {produto} para {publico}, usando o que o time levantou sobre a peça. {marca}',
		/**
		 * OS TRÊS PRIMEIROS CAMPOS SÃO O RACIOCÍNIO, MATERIALIZADO — e vêm antes
		 * do título por causa da ordem em que o JSON é escrito: o modelo se
		 * compromete com o OBJETO, com QUEM PAGA e com O DIA antes de ter a chance
		 * de abrir com um adjetivo. Pedir a mesma coisa só na prosa do `papel` é o
		 * que já não funcionava.
		 *
		 * Eles não são despesa escondida nem lixo de depuração: o cartão do
		 * Redator na mesa de criação desenha o JSON inteiro campo a campo, então
		 * "Objeto / Quem compra / Quando se compra" viram três linhas legíveis da
		 * ficha que o aluno abre. Por isso os nomes são frase de gente e não
		 * rótulo técnico.
		 */
		saida: [
			'{"objeto":"","quem_compra":"","quando_se_compra":"",',
			'"titulo":"","titulos_alternativos":["",""],"chamada":"","texto_na_arte":"",',
			'"legenda":"","hashtags":[""],"observacao":""}',
		].join(''),
		entrada: 'nenhuma',
		fase: 'aprofundamento',
		entrega: 'todas',
		/**
		 * O modelo barato de REDAÇÃO, e não o Sonnet do Redator da Central.
		 *
		 * Lá o Redator digeria 22 especialistas e devolvia 3 títulos, 5 bullets,
		 * descrição, palavras-chave e legenda. Aqui são quatro campos curtos sobre
		 * uma peça só, com a direção de arte já tomada — a tarefa é redigir em
		 * PT-BR no tom pedido, que é o que este modelo faz por um sexto do preço.
		 *
		 * ┌─ E A TROCA FOI MEDIDA, NÃO SUPOSTA ─────────────────────────────────────┐
		 * │ "O título está genérico" pede, por reflexo, um modelo melhor. Rodado    │
		 * │ contra o provedor real, com o MESMO material byte a byte (o digest da   │
		 * │ onda 1 reaproveitado, para que a única variável fosse o Redator):       │
		 * │                                                                         │
		 * │   flash + papel antigo .... US$ 0,00199/run ·  3,6 s · quebrou 0 de 5   │
		 * │   sonnet + papel antigo ... US$ 0,02518/run · 25,1 s · quebrou 0 de 5   │
		 * │   flash + papel NOVO ...... US$ 0,00206/run ·  4,0 s · quebrou 0 de 5   │
		 * │   sonnet + papel NOVO ..... US$ 0,02820/run · 27,4 s · quebrou 1 de 5   │
		 * │                                                                         │
		 * │ O Sonnet custa 12,6× a 14,2×, demora ~7× e devolve JSON inutilizável em │
		 * │ 19% das chamadas (4 de 21): o raciocínio é cobrado como saída e come o  │
		 * │ teto ANTES da primeira chave do JSON — a mesma assinatura documentada   │
		 * │ no Diretor de Arte. Subir o teto para 4.000 não resolve, só custa mais. │
		 * │ Números de produção: o flash gasta 255–335 tokens de saída nestes       │
		 * │ campos; o Sonnet gasta 1.389–3.749 para escrever a mesma coisa.         │
		 * │                                                                         │
		 * │ E o título dele saiu PIOR que o do papel reescrito aqui.                │
		 * │                                                                         │
		 * │ A CONTA DA ESCOLHA, medida no papel que está aqui (8.173 chars, contra  │
		 * │ 3.562 do antigo): US$ 0,00199 → US$ 0,00287 por run, +US$ 0,00088. São  │
		 * │ +44% em cima do Redator e +0,4% em cima da peça inteira (~US$ 0,21), e  │
		 * │ ele continua sendo ~1,4% do custo total. Trocar o modelo levaria o mesmo │
		 * │ Redator a 11% do total — 100× o preço desta reescrita, para entregar    │
		 * │ menos. NENHUM `vox_cost` foi tocado: a decisão de preço é do dono.      │
		 * └─────────────────────────────────────────────────────────────────────────┘
		 */
		modelo: M_COPY,
		motor_busca: 'nenhum',
		max_buscas: 0,
		essencial: false,
		temperatura: 0.7,
		max_tokens: 2400,
		timeout_s: 60,
		icone: 'pen-line',
		cor: '#a855f7',
		frase_trabalhando: 'Escrevendo o texto no tom da sua marca…',
		ordem: 50,
	},

	/* ═════════════ ONDA 3 — SÍNTESE: o pedido final da arte ═════════════ */
	{
		chave: 'prompt_final',
		nome: 'Prompt Final',
		papel: [
			'Você escreve o PEDIDO FINAL da imagem — o texto que o gerador vai obedecer. É a última palavra do time e é o que vira a arte que a pessoa recebe.',
			/**
			 * ┌─ SUBIU DE "120 a 220" PARA "180 a 320", E O NÚMERO SAIU DE MEDIÇÃO ──┐
			 * │ As três peças publicáveis produzidas na medição têm 300 a 370        │
			 * │ palavras; os 4 prompts do time, todos dentro das 220, saíram como    │
			 * │ ficha técnica. Não é que texto longo gere melhor — é que a hora do   │
			 * │ dia, a posição da câmera e o que está fora de foco atrás NÃO CABEM   │
			 * │ em 220 palavras junto com as nove cláusulas obrigatórias, e o que    │
			 * │ era cortado era sempre a parte que fazia a foto parecer foto.        │
			 * │ Custo: ~150 tokens de saída a mais no Sonnet ≈ US$ 0,002 por run.    │
			 * └──────────────────────────────────────────────────────────────────────┘
			 */
			'Escreva em português do Brasil, em prosa corrida, de 180 a 320 palavras, em três ou quatro parágrafos. Sem lista, sem marcador, sem título de seção e sem nome de campo: o gerador lê texto corrido, e a pessoa lê este mesmo texto na tela.',
			/**
			 * ┌─ A ORDEM MUDOU, E ELA É A METADE DA QUEIXA "A ARTE TÁ RUIM" ─────────┐
			 * │ A ordem antiga era a de uma FICHA TÉCNICA: tipo, peça, fundo, luz,   │
			 * │ composição, acabamento, formato, texto, proibições. Nove requisitos, │
			 * │ nenhum deles dizendo o que a foto É. Os 4 runs medidos entregaram o  │
			 * │ mesmo quadro nas quatro vezes.                                       │
			 * │                                                                      │
			 * │ A nova põe a CÂMERA e a LUZ antes do cenário e obriga a hora do dia  │
			 * │ na primeira frase — que é a ordem em que um fotógrafo decide, e a    │
			 * │ ordem em que os prompts que geraram peça publicável estavam escritos.│
			 * │ E o item (5) perdeu "dizendo onde ficam a área limpa do texto e a da │
			 * │ assinatura": era essa oração, e não o `image.brandmark`, que mandava │
			 * │ o gerador pintar o cartão branco de que o dono reclamou.             │
			 * └──────────────────────────────────────────────────────────────────────┘
			 */
			'A ORDEM é esta, e ela não muda: (1) que fotografia é esta e em que MOMENTO ela acontece — o tipo (foto de produto, cena de uso, ilustração de traço) e a hora do dia ou a situação; (2) A PEÇA, exatamente como o Leitor do Produto a viu — material, cor, acabamento e os detalhes que valorizam —, no ângulo que ele indicou, dizendo que a gravação é o ponto mais luminoso do quadro E ESCREVENDO, ENTRE ASPAS, O TEXTO QUE ESTÁ GRAVADO NELA (o Leitor do Produto leu na foto: o sobrenome, o nome, a data). Sem esse texto escrito no pedido, o gerador apaga a gravação do cliente e põe a manchete no lugar dela — perde a peça; (3) A CÂMERA: de que altura e distância se olha, que lente, o que está nítido e o que dissolve; (4) A LUZ: de onde vem, que dureza tem, que cor tem e que sombra joga, e para que lado; (5) o que está em volta e o que está desfocado atrás, e como a peça se planta no quadro; (6) o acabamento visual — paleta, contraste, grão —, coerente com a marca; (7) o formato pedido; (8) o texto que aparece na arte, entre aspas e exatamente como o Redator escreveu, descrito como TIPOGRAFIA DA FOTOGRAFIA — ou a ordem de não escrever texto nenhum; (9) a última frase, começando com "NÃO:", com tudo o que não pode aparecer.',
			'A PEÇA NÃO MUDA: nunca troque material, cor, formato ou acabamento do que foi lido na foto, e nunca acrescente detalhe que ninguém viu. Quando o pedido tiver a foto do produto como referência, mande manter a peça EXATAMENTE como na imagem de referência, mudando só o cenário, a luz e o enquadramento.',
			A_FOTOGRAFIA_TEM_AUTOR,
			O_TEXTO_E_PARTE_DA_FOTOGRAFIA,
			/**
			 * ┌─ O "NÃO:" GANHOU OS CLICHÊS DE CATÁLOGO, E ISSO FOI MEDIDO ──────────┐
			 * │ A lista antiga protegia contra defeito de geração (mão deformada,    │
			 * │ marca d'água) e não protegia contra o defeito de PRODUTO — a peça    │
			 * │ sair com cara de anúncio de marketplace. Nas gerações em que o "NÃO:"│
			 * │ trouxe "fundo branco de e-commerce" e "luz chapada de softbox"       │
			 * │ escritos assim, com todas as letras, o modelo obedeceu: 0 de 5       │
			 * │ artefatos de cartão e 0 de 5 fundos de catálogo, contra 7 de 10 sem. │
			 * │ Aqui, como no Redator, PROIBIR funciona melhor que PEDIR.            │
			 * └──────────────────────────────────────────────────────────────────────┘
			 */
			'A frase do "NÃO:" junta quatro coisas: o que a marca nunca usa; o que o Leitor do Produto mandou esconder; o que estraga qualquer arte — marca d\'água, letra inventada, texto ilegível, moldura, colagem, assinatura de artista, mão deformada e logotipo desenhado; e, SEMPRE, os clichês que fazem a peça parecer anúncio de marketplace: fundo branco de e-commerce, luz difusa e chapada de softbox, mesa de estúdio, recorte de catálogo, mockup, cartão branco, retângulo, faixa de cor atrás do texto, adesivo e área reservada. E, quando houver frase na arte, o "NÃO:" também proíbe repetir essa frase gravada na peça.',
			/**
			 * ┌─ SAIU: "NA ARTE PARA GRAVAR o pedido é outro…" ──────────────────────┐
			 * │ Era um GALHO MORTO. O caminho "Arte para gravar" foi removido da     │
			 * │ tela por decisão de produto (ver `EntregaAgente` em                  │
			 * │ `lib/atelie/agents.ts`): `entrega` só pode ser post, anúncio ou      │
			 * │ cena, então a condição nunca é verdadeira. Converter a arte pronta   │
			 * │ em traço continua existindo como AJUSTE, que não passa por aqui.     │
			 * │                                                                      │
			 * │ E galho morto não é neutro NESTE especialista. Ele é Sonnet, está no │
			 * │ teto de 4.000 (= `MAX_TOKENS_TETO`, sem folga) e o raciocínio é      │
			 * │ cobrado como saída: cada CONDIÇÃO no papel é uma decisão que ele     │
			 * │ toma antes da primeira chave do JSON. Medido nesta sessão: com uma   │
			 * │ cláusula a mais, `prompt_final` foi refeito em 3 de 3 runs (US$      │
			 * │ 0,19 a 0,22) e MORREU em um — 502 com o time inteiro já pago. Esta   │
			 * │ remoção é o que paga a linha nova do item (2).                        │
			 * └──────────────────────────────────────────────────────────────────────┘
			 */
			'Em `por_que_assim` explique em duas ou três linhas, para a pessoa, por que a arte vai ser assim, citando a peça dela e a marca dela. É o que ela lê enquanto a imagem é gerada.',
			// Precisa estar AQUI também, e não só no Diretor de Arte: quem escreve
			// o pedido que o gerador obedece é este, e a folga se perde na tradução
			// se ela não for repetida no texto que vai para o modelo de imagem.
			A_FOLGA_QUE_SOBREVIVE_AO_RECORTE,
			O_LOGO_NAO_SE_DESENHA,
			A_MARCA_MANDA,
			COMO_CHAMAR_O_TIME,
			ANTI_INVENCAO,
		].join(' '),
		pergunta:
			'Escreva o pedido final da arte de {entrega} no formato {formato}, obedecendo à direção de arte, à leitura da peça e às regras da marca que estão no material do time. {marca}',
		saida: [
			'{"prompt":"","texto_na_arte":"","o_que_nao_pode_aparecer":"","formato":"",',
			'"por_que_assim":"","confianca":0,"observacao":""}',
		].join(''),
		entrada: 'nenhuma',
		fase: 'sintese',
		entrega: 'todas',
		/** O que mais merece um bom modelo: é a saída que vira a arte. */
		modelo: M_DECISAO,
		motor_busca: 'nenhum',
		max_buscas: 0,
		/**
		 * ESSENCIAL por definição: sem o prompt não existe arte para entregar, e
		 * `ai.image_studio` receberia prompt vazio — o run morreria depois de
		 * cobrado, ou pior, geraria uma imagem qualquer.
		 */
		essencial: true,
		temperatura: 0.4,
		/**
		 * O MAIOR TETO DO TIME, e não porque ele escreve mais.
		 *
		 * O prompt dele tem 220 palavras no máximo (~350 tokens) e o JSON inteiro
		 * cabe em ~800. O resto é a folga de RACIOCÍNIO: ele lê o material das
		 * duas ondas e pensa antes de escrever, e num modelo híbrido esse
		 * raciocínio é cobrado como saída e consome o teto ANTES da primeira chave
		 * do JSON. Medido na Central: o Redator fechou uma chamada com 3.000
		 * tokens de saída e `content` vazio. Ele é essencial — cortar aqui é 502 e
		 * estorno, não uma seção a menos.
		 */
		max_tokens: 4000,
		/**
		 * DESLIGADO — e é ESTE campo que conserta o "A arte não saiu desta vez".
		 *
		 * Medido, 3 chamadas com o digest cheio: com raciocínio ele pedia
		 * 4.579–7.040 tokens e truncava em 3 de 3 (`finish_reason: 'length'`, JSON
		 * pela metade). Ele é ESSENCIAL: truncar aqui não é uma seção a menos, é o
		 * run inteiro perdido. Desligado: 1.740–1.787 tokens, US$ 0,030 no lugar de
		 * US$ 0,083, e o prompt sai equivalente (437 contra 495 palavras).
		 */
		raciocinio: 'desligado',
		timeout_s: 90,
		icone: 'wand-sparkles',
		cor: '#10b981',
		frase_trabalhando: 'Escrevendo o pedido final da arte…',
		ordem: 90,
	},
];

/* ══════════════════════════ portões ══════════════════════════ */

/**
 * A FORMA DO TIME: seis, três ondas, uma síntese só.
 *
 * Cada uma destas condições, violada, produz silêncio: onda vazia é uma etapa
 * que não acontece; duas sínteses são dois prompts finais competindo pela mesma
 * imagem (o bloco usa um e joga o outro fora, pago); chave repetida faz o
 * segundo registro sobrescrever o primeiro no upsert.
 */
function conferirForma(): void {
	const problemas: string[] = [];

	const chaves = TIME.map((e) => e.chave);
	const repetidas = chaves.filter((c, i) => chaves.indexOf(c) !== i);
	if (repetidas.length)
		problemas.push(`chave repetida: ${repetidas.join(', ')}`);

	const ordens = TIME.map((e) => e.ordem);
	if (new Set(ordens).size !== ordens.length) {
		problemas.push(
			'duas pessoas com a mesma `ordem` — a mesa de criação fica instável',
		);
	}

	for (const fase of ['descoberta', 'aprofundamento', 'sintese'] as const) {
		const n = TIME.filter((e) => e.fase === fase).length;
		if (n === 0) problemas.push(`onda \`${fase}\` vazia`);
	}
	const sinteses = TIME.filter((e) => e.fase === 'sintese');
	if (sinteses.length !== 1) {
		problemas.push(
			`${sinteses.length} especialistas em \`sintese\` — só um escreve o pedido final da arte`,
		);
	}

	/**
	 * O time tem que ENXERGAR. Sem ninguém com `foto_produto`, a foto que o aluno
	 * subiu é paga (upload, storage) e nunca é olhada por ninguém — a arte sai da
	 * descrição em texto, e a ferramenta inteira perde a razão de existir.
	 */
	if (!TIME.some((e) => e.entrada === 'foto_produto')) {
		problemas.push(
			'ninguém declara `entrada: foto_produto` — a foto do aluno não seria olhada',
		);
	}
	if (!TIME.some((e) => e.entrada === 'referencias')) {
		problemas.push(
			'ninguém declara `entrada: referencias` — os anúncios do aluno seriam ignorados',
		);
	}

	if (!TIME.some((e) => e.essencial)) {
		problemas.push(
			'nenhum essencial — um run sem entrega nenhuma seria cobrado assim mesmo',
		);
	}

	if (problemas.length) {
		throw new Error(`FORMA DO TIME:\n  ${problemas.join('\n  ')}`);
	}
}

/**
 * TODO ESPECIALISTA PAGO PRECISA DE PONTO DE RENDER — a regra que reprovou
 * quatro rodadas na Central.
 *
 * Ícone, cor e frase são o que a mesa de criação desenha enquanto ele trabalha;
 * `saida` é o contrato do card que mostra o que ele entregou. Faltando qualquer
 * um, ele roda, é cobrado, e o aluno não vê nem que ele existiu.
 */
function conferirRender(): void {
	const problemas: string[] = [];
	for (const e of TIME) {
		if (!e.icone) problemas.push(`${e.chave}: sem ícone`);
		if (!/^#[0-9a-f]{6}$/i.test(e.cor))
			problemas.push(`${e.chave}: cor inválida (${e.cor})`);
		if (!e.frase_trabalhando)
			problemas.push(`${e.chave}: sem frase de trabalho`);
		if (!e.saida.trim().startsWith('{')) {
			problemas.push(
				`${e.chave}: \`saida\` não é um exemplo de JSON — a tela não teria o que ler`,
			);
		}
	}
	if (problemas.length) {
		throw new Error(
			`ESPECIALISTA SEM LUGAR NA TELA:\n  ${problemas.join('\n  ')}\n` +
				'  Sem isso ele roda, é cobrado, e o aluno não vê nada dele.',
		);
	}
}

/**
 * O TETO DE SAÍDA CONTRA O TAMANHO ESPERADO DA RESPOSTA. Trava, não avisa.
 *
 * Ver a caixa de `SAIDA_ESTIMADA`: teto abaixo de 2× é JSON cortado, e JSON
 * cortado no essencial é 502 com o dinheiro já gasto.
 */
function conferirTetos(): void {
	const problemas: string[] = [];
	/**
	 * ┌─ O CLAMP QUE FAZIA A TRAVA APROVAR O QUE ELA DEVERIA REPROVAR ───────────┐
	 * │ `exigido` é aparado em `MAX_TOKENS_TETO`. Faz sentido — pedir mais do    │
	 * │ que o motor entrega seria travar o seed por um número impossível —, mas  │
	 * │ o efeito colateral é que um especialista cuja saída MEDIDA não cabe no   │
	 * │ teto do time passa em silêncio: a exigência desce até o teto, o          │
	 * │ `max_tokens` iguala a exigência, e a trava diz OK enquanto a chamada     │
	 * │ trunca em produção. Foi exatamente o que aconteceu com o `prompt_final`  │
	 * │ (medido: quer ~3.900, tem 4.000, exigiria 7.800) — e o sintoma só        │
	 * │ apareceu como run morto em 502.                                          │
	 * │                                                                          │
	 * │ Aqui não vira erro: reprovar bloquearia o seed de um roster que é o      │
	 * │ melhor possível DENTRO do teto de gasto de hoje, e a saída depende de    │
	 * │ `maxUsd`, que é decisão do dono. Vira AVISO — em toda rodada de seed,    │
	 * │ com o número na mão de quem for tomar a decisão.                         │
	 * └──────────────────────────────────────────────────────────────────────────┘
	 */
	const apertados: string[] = [];
	for (const e of TIME) {
		const esperado = SAIDA_ESTIMADA[e.chave];
		if (esperado) {
			const querido = Math.ceil((2 * esperado) / 200) * 200;
			const exigido = Math.min(MAX_TOKENS_TETO, querido);
			if (querido > MAX_TOKENS_TETO) {
				/**
				 * DUAS GRAVIDADES DIFERENTES, e misturá-las é o que faz um aviso
				 * virar ruído que ninguém lê:
				 *   teto ≥ saída  → só perdeu a FOLGA de 2×. Aperta, não corta —
				 *                   medido no `leitor_produto` (2.205 de teto 4.000):
				 *                   0 retry em 4 peças de ponta a ponta.
				 *   teto ≈ saída  → CORTA. O JSON não fecha e vira retry, e no
				 *                   essencial vira 502. É o `prompt_final` de hoje.
				 *
				 * O corte de gravidade é 1,2× e não 1,0× de propósito: o número da
				 * tabela é a MEDIANA de chamadas reais, e a metade de cima da
				 * distribuição passa dela. Medido no `prompt_final`: mediana 3.900
				 * com teto 4.000 (1,0×) truncou 2 de 3. Um teto que só empata com a
				 * mediana já corta metade das chamadas.
				 */
				const folga = MAX_TOKENS_TETO / esperado;
				apertados.push(
					`${e.chave}: saída medida ${esperado} tok · teto ${MAX_TOKENS_TETO} = ${folga.toFixed(1)}× ` +
						(folga < 1.2
							? '→ CORTA o JSON (vira retry, e 502 quando o retry também corta)'
							: `→ aperta (a regra deste arquivo pede 2×, pediria teto ${querido})`),
				);
			}
			if (e.max_tokens < exigido) {
				problemas.push(
					`${e.chave}: max_tokens ${e.max_tokens} < ${exigido} (2 × ${esperado} esperados)`,
				);
			}
		}
		if (e.max_tokens > MAX_TOKENS_TETO) {
			problemas.push(
				`${e.chave}: max_tokens ${e.max_tokens} acima de MAX_TOKENS_TETO (${MAX_TOKENS_TETO}) — o motor apertaria em silêncio`,
			);
		}
	}
	if (problemas.length) {
		throw new Error(`TETO DE SAÍDA CURTO:\n  ${problemas.join('\n  ')}`);
	}
	if (apertados.length) {
		console.warn(
			`⚠ O TETO DO TIME (${MAX_TOKENS_TETO}) NÃO COMPORTA A SAÍDA MEDIDA:\n  ${apertados.join('\n  ')}\n` +
				`  Sair disto é subir MAX_TOKENS_TETO E LIMITES_ATELIE.maxUsd juntos —\n` +
				`  o segundo é decisão de margem do dono. Enquanto ficar assim, o run\n` +
				`  morre em 502 quando o retry também trunca (medido: 2 de 4 peças).`,
		);
	}
}

/**
 * C5 — O TIME TRABALHA COM O QUE O ALUNO DEU.
 *
 * Aviso, e não trava: o caminho da busca existe de propósito (campos no roster,
 * interruptor mestre em `input.buscar_web`), e um dia um especialista vai
 * legitimamente usá-lo. Mas ligar busca num registro é uma decisão de produto
 * com preço (US$ 0,005 por consulta) e com efeito no relógio — e a única forma
 * de ela passar despercebida é ninguém dizer nada quando acontece.
 */
function conferirBusca(): void {
	const pesquisam = TIME.filter((e) => e.motor_busca !== 'nenhum');
	if (pesquisam.length === 0) {
		console.log('busca web: nenhum especialista pesquisa (C5) ✓');
		return;
	}
	console.warn(
		`⚠ busca web LIGADA em: ${pesquisam.map((e) => `${e.chave} (${e.motor_busca})`).join(', ')}\n` +
			'  O combinado é o time trabalhar com o que o aluno deu. Só passa a pesquisar de\n' +
			'  verdade quando o aluno ligar o interruptor (`input.buscar_web`) — confira se é isso mesmo.',
	);
}

/**
 * ┌─ O ROSTER TEM QUE CABER NO TETO DE GASTO DO BLOCO ───────────────────────┐
 * │ `podeGastar` (agent-team/budget.ts) PROJETA o pior caso de cada chamada  │
 * │ — os `max_tokens` inteiros ao preço de saída do modelo — e PULA quem não │
 * │ couber em `LIMITES_ATELIE.maxUsd`. Só quem escreve o prompt final é      │
 * │ protegido; os outros somem da arte com um aviso na tela.                 │
 * │                                                                          │
 * │ Ou seja: um roster caro demais não fica caro, fica MENOR. Trocar um       │
 * │ modelo pela tela de coleção — que é a razão de o time ser dado — pode     │
 * │ apagar dois especialistas sem que ninguém escreva uma linha de código.    │
 * │ Este portão faz a MESMA conta do bloco, com os MESMOS preços do catálogo, │
 * │ ONDA A ONDA (é assim que o bloco reserva: a onda inteira pergunta "cabe?" │
 * │ antes de qualquer um registrar gasto real).                              │
 * │                                                                          │
 * │ É pessimista de propósito em dois pontos, porque o custo de errar para    │
 * │ menos é um time encolhendo em produção:                                   │
 * │  · assume que a onda anterior gastou o PIOR CASO dela ÷ 3 (o real medido  │
 * │    fica bem abaixo do teto, mas não é zero);                              │
 * │  · assume a foto do produto + DUAS referências, que é o run mais caro que │
 * │    a tela permite montar.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function conferirOrcamento(): void {
	/** O digest que cada onda recebe, do bloco. A onda 1 não recebe nada. */
	const MATERIAL: Record<string, number> = {
		descoberta: 0,
		aprofundamento: TETO_DIGEST_ONDA2,
		sintese: TETO_DIGEST_ONDA3,
	};
	/** Quantas imagens cada `entrada` manda na chamada, no run mais caro. */
	const IMAGENS: Record<string, number> = {
		nenhuma: 0,
		foto_produto: 1,
		referencias: 2,
	};

	const previsto = (e: Especialista): number => {
		const m = findTextModel(e.modelo);
		if (!m) {
			throw new Error(
				`${e.chave}: modelo '${e.modelo}' não está no catálogo de texto — o bloco cairia no padrão e o preço seria outro`,
			);
		}
		const chars =
			e.papel.length +
			e.pergunta.length +
			e.saida.length +
			(MATERIAL[e.fase] ?? 0) +
			IMAGENS[e.entrada] * CHARS_POR_IMAGEM;
		return estimarCustoUsd({
			precoIn: m.pricing.in,
			precoOut: m.pricing.out,
			charsPrompt: chars,
			maxTokensSaida: e.max_tokens,
			comBusca: e.motor_busca !== 'nenhum',
		});
	};

	const teto = LIMITES_ATELIE.maxUsd;
	const problemas: string[] = [];
	let gastoAcumulado = 0;
	console.log(`orçamento do run (teto do bloco: US$ ${teto.toFixed(3)}):`);

	for (const fase of ['descoberta', 'aprofundamento', 'sintese'] as const) {
		const daOnda = TIME.filter((e) => e.fase === fase);
		if (daOnda.length === 0) continue;
		const soma = daOnda.reduce((t, e) => t + previsto(e), 0);
		const comprometido = gastoAcumulado + soma;
		const folga = ((teto - comprometido) / teto) * 100;
		console.log(
			`  ${fase.padEnd(15)} ${daOnda.length} especialista(s) · pior caso US$ ${soma.toFixed(4)} · comprometido US$ ${comprometido.toFixed(4)} (${folga.toFixed(0)}% de folga)`,
		);
		if (comprometido > teto) {
			const maisCaro = [...daOnda].sort((a, b) => previsto(b) - previsto(a))[0];
			problemas.push(
				`onda ${fase}: projeta US$ ${comprometido.toFixed(4)} de um teto de ${teto.toFixed(3)} — ` +
					`o mais caro é ${maisCaro?.chave} (US$ ${previsto(maisCaro as Especialista).toFixed(4)}, ${maisCaro?.modelo}, teto de ${maisCaro?.max_tokens} tokens)`,
			);
		}
		// O que a onda de fato gasta fica bem abaixo do pior caso; um terço é a
		// aproximação pessimista que este portão usa para a onda seguinte.
		gastoAcumulado += soma / 3;
	}

	if (problemas.length) {
		throw new Error(
			`ROSTER MAIS CARO QUE O TETO DO BLOCO:\n  ${problemas.join('\n  ')}\n` +
				'  Quem não couber é PULADO em produção — o aluno lê "não chegou a trabalhar\n' +
				'  nesta arte" e recebe uma peça feita por meio time. Baixe um `max_tokens`,\n' +
				'  troque um modelo, ou suba `LIMITES_ATELIE.maxUsd` sabendo o que isso custa.',
		);
	}
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
 * Idempotente por `chave`: atualiza quem já existe, cria quem falta e DESLIGA
 * quem saiu do time (sem apagar — um registro apagado leva junto o histórico de
 * quem editou o papel dele).
 */
async function main() {
	// Antes da rede: um time de forma errada não deve nem chegar ao banco.
	conferirForma();
	conferirRender();
	conferirTetos();
	// Nem um roster que o freio de gasto do bloco fosse encolher em produção.
	conferirOrcamento();
	conferirBusca();

	if (!STAFF_ID && !BEARER) {
		console.error('Defina SEED_STAFF_ID ou SEED_BEARER.');
		process.exit(1);
	}
	const url = `${BASE}/api/tools/${TOOL}/c/agentes`;

	const atual = await fetch(`${url}?page_size=50`, { headers: headers() });
	if (!atual.ok) {
		throw new Error(
			`não consegui ler a coleção (${atual.status}): ${(await atual.text()).slice(0, 300)}\n` +
				'  A coleção `agentes` existe na definition da tool? Rode antes, na upvox:\n' +
				'  npx tsx scripts/seed-estudio-imagens.ts',
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
					// A coleção também declara `visibility:'staff'` — aqui é redundância
					// deliberada, não confiança em um lado só.
					body: JSON.stringify({ title: nome, visibility: 'staff', data }),
				});

		if (!res.ok) {
			throw new Error(
				`falhou em '${chave}' (${res.status}): ${(await res.text()).slice(0, 400)}`,
			);
		}
		console.log(
			`  ${existente ? '~' : '+'} ${nome.padEnd(22)} ${e.fase.padEnd(15)} ${e.entrada.padEnd(13)} ${e.modelo.padEnd(30)} ${String(e.max_tokens).padStart(4)} tok ${e.essencial ? ' ESSENCIAL' : ''}`,
		);
	}

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
