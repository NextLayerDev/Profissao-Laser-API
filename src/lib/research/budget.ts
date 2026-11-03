/**
 * OS NÚMEROS DA CENTRAL DE INTELIGÊNCIA — a política, não o mecanismo.
 *
 * O `Budget` (reserva de vaga de busca, projeção de pior caso, relógio de
 * parede, os dois canais de mensagem), o `comLimite` e as réguas de estimativa
 * moram em `lib/agent-team/budget.ts`: são iguais para qualquer time de
 * agentes, e o Ateliê é o segundo. O código saiu daqui VERBATIM.
 *
 * O que ficou é o que só a Central pode responder: quanto UM RUN DELA pode
 * gastar, buscar e demorar. São números MEDIDOS em runs frios de 5 e 22
 * especialistas — ver o cabeçalho de `LIMITES_PADRAO`, que é onde a conta está
 * escrita e onde ela tem que ser refeita por quem mexer no roster.
 *
 * Os nomes continuam sendo reexportados por aqui porque é daqui que o bloco, o
 * seed e os testes sempre os importaram.
 */

export {
	Budget,
	type BudgetLimits,
	comLimite,
	estimarCustoUsd,
	msMinimoUtil,
	USD_POR_CHAMADA_COM_BUSCA,
} from '../agent-team/budget.js';

import type { BudgetLimits } from '../agent-team/budget.js';

/**
 * ┌─ A CONTA, MEDIDA EM RUN FRIO (5 e 22 especialistas) ────────────────────┐
 * │ Voxxy = R$ 1,20. Rápido cobra 2 (R$ 2,40); Profundo cobra 6 (R$ 7,20).  │
 * │ Câmbio de trabalho: R$ 5,50/US$. Piso de margem exigido: 75%.           │
 * │                                                                         │
 * │ ⇒ custo máximo tolerável: Rápido R$ 0,60 = US$ 0,109                     │
 * │                           Profundo R$ 1,80 = US$ 0,327                   │
 * │                                                                          │
 * │ O QUE O RUN CUSTA DE VERDADE — instrumentado chamada a chamada, com o    │
 * │ roster de hoje (`forcar:true`, cache frio, OpenRouter real):             │
 * │   produto+rápido   US$ 0,0614 · 0,0574 → 85,9% · 86,8%  ·  39 s          │
 * │   mercado+rápido   US$ 0,0977 · 0,1084 · 0,0873 → 77,6% · 75,2% · 80,0%  │
 * │   produto+profundo US$ 0,2772 · 0,2530 → 78,8% · 80,7%  ·  53–55 s       │
 * │   mercado+profundo US$ 0,2771 · 0,2650 · 0,2818 → 78,8% · 79,8% · 78,5%  │
 * │ Dez runs frios com o roster de hoje: 22/22 e 5/5 entregando em todos, e  │
 * │ os quatro modos acima do piso de 75% em TODAS as execuções. O profundo   │
 * │ ficou em 78,5–80,7% (a medição anterior, com o Estrategista cortado e    │
 * │ refeito em todo run de mercado, dava 72,6–74,0%).                        │
 * │                                                                          │
 * │ O QUE OSCILA é o Estrategista: o JSON dele fica sempre em 4,3 a 5,6 mil  │
 * │ caracteres, mas o modelo gasta de 2,7 mil a 6,7 mil tokens de SAÍDA para │
 * │ produzi-lo (pensa antes de escrever, e o pensamento é cobrado como       │
 * │ saída). É essa oscilação que separa 75,2% de 80,0% no mesmo modo, e é    │
 * │ por isso que o teto de saída dele é 8.000: com 4.000 ele vinha cortado,  │
 * │ e um run cortado custa o retry (US$ 0,06) ou o estorno inteiro. Medido:  │
 * │ o run com o Estrategista E o Redator refeitos custou US$ 0,4405          │
 * │ (margem 66,4%) — dobro do preço de deixar os dois caberem.               │
 * │                                                                          │
 * │ `maxBuscas` conta CHAMADAS com busca (ver `BudgetLimits`). O roster de   │
 * │ hoje pede, no máximo: 4 chamadas no rápido (produto: preço, demanda,     │
 * │ concorrência, margem) e 17 no profundo (produto; 16 em mercado). O resto │
 * │ do teto é folga para o retry, que refaz a busca.                         │
 * │                                                                          │
 * │ ┌─ O QUE `maxUsd` É, E O QUE ELE NÃO É ────────────────────────────────┐ │
 * │ │ Ele NÃO é o custo esperado, e tratá-lo como se fosse foi o defeito.   │ │
 * │ │ `podeGastar` compara "gasto real das ondas fechadas + PROJEÇÃO DE     │ │
 * │ │ PIOR CASO do que está em voo" — e o pior caso supõe todo mundo        │ │
 * │ │ escrevendo até o último token do teto, o que nunca acontece. O número │ │
 * │ │ que `maxUsd` precisa cobrir é esse PICO DE COMPROMETIMENTO, não o     │ │
 * │ │ custo do run.                                                         │ │
 * │ │                                                                       │ │
 * │ │ MEDIDO num run de `mercado+profundo`, onda a onda:                    │ │
 * │ │   onda 1   real US$ 0,0461 · projeção US$ 0,0668 · comprometido 0,067 │ │
 * │ │   onda 2   real US$ 0,0784 · projeção US$ 0,1025 · comprometido 0,149 │ │
 * │ │   onda 3   real US$ 0,1526 · projeção US$ 0,2108 · comprometido 0,335 │ │
 * │ │ Pico = US$ 0,335 contra um `maxUsd` de 0,32: o freio FECHAVA em run   │ │
 * │ │ normal, com o run custando 0,277 — e o log gravava "teto de gasto do  │ │
 * │ │ modo estourado" em toda execução. No rápido a mesma conta dá pico     │ │
 * │ │ 0,122 contra teto 0,10, com o run custando 0,082.                     │ │
 * │ │                                                                       │ │
 * │ │ Isso não cortou ninguém — na onda 3 todos são `sintese`, e `sintese`  │ │
 * │ │ é isento — mas é um freio disparando por engano, e um freio que grita │ │
 * │ │ lobo em 100% dos runs deixa de ser lido quando o lobo aparecer.       │ │
 * │ │                                                                       │ │
 * │ │ TETOS DE HOJE = pico medido + ~15%: rápido 0,14 (pico 0,122),         │ │
 * │ │ profundo 0,38 (pico 0,335). A folga é pequena de propósito: quem      │ │
 * │ │ acrescentar especialista ou subir teto de saída tem que refazer a     │ │
 * │ │ medição, e não afrouxar o teto até parar de reclamar.                 │ │
 * │ │                                                                       │ │
 * │ │ E O PISO DE 75% CONTINUA VALENDO — só que sobre o CUSTO MEDIDO        │ │
 * │ │ (78,8% a 85,4% nos quatro modos), que é onde ele sempre foi           │ │
 * │ │ verificável. `maxUsd` a 0,38 corresponde a 71% de margem: é o que a   │ │
 * │ │ execução pode chegar a comprometer antes de o freio fechar, não o que │ │
 * │ │ ela gasta. Amarrar o freio ao piso de margem foi o que colocou o teto │ │
 * │ │ ABAIXO do custo real de um run que dá certo.                          │ │
 * │ └───────────────────────────────────────────────────────────────────────┘ │
 * │                                                                          │
 * │ O QUE `maxUsd` FAZ E O QUE NÃO FAZ — a versão anterior deste cabeçalho   │
 * │ dizia "ele é freio" e não era: `podeGastar()` comparava só o gasto JÁ    │
 * │ REGISTRADO, e como a onda inteira é despachada no mesmo tick (concorrência│
 * │ 6 ≥ o número de pesquisadores nas quatro combinações), todo mundo        │
 * │ consultava com `usd = 0` e todo mundo passava. Em NENHUM run possível o  │
 * │ freio chegava a fechar.                                                  │
 * │                                                                         │
 * │ Agora `podeGastar(previsto)` compara gasto + RESERVADO + a projeção de   │
 * │ pior caso da chamada que está para sair (`estimarCustoUsd`), do mesmo    │
 * │ jeito que a busca já reservava vaga. Com isso o freio existe de verdade  │
 * │ e tem duas marchas, nesta ordem: (1) o especialista roda SEM BUSCA —     │
 * │ economia real de ~7 mil tokens de entrada, não só dos US$ 0,005; (2) se  │
 * │ nem sem busca couber, o especialista NÃO RODA e a falha aparece com o    │
 * │ motivo. A segunda marcha nunca alcança quem é `sintese` ou `essencial`:  │
 * │ cortar o Estrategista trocaria "caro" por "run estornado", que é pior.   │
 * │ Ou seja: o freio protege contra roster caro demais, não contra o custo   │
 * │ do dossiê mínimo — esse é decisão de produto, não de runtime.            │
 * │                                                                          │
 * │ A MESMA ISENÇÃO VALE NO RETRY, e ela custou uma rodada para aparecer: o  │
 * │ filtro de orçamento que escolhe o modelo alternativo (`escolherAlterna-  │
 * │ tivo`) chegou sem a exceção, e para o Estrategista — cujo modo de falha  │
 * │ é o JSON cortado no teto de saída — "não cabia no orçamento" virava run  │
 * │ estornado com o dinheiro da onda 1 já gasto. Quem é protegido refaz sem  │
 * │ passar pelo freio, e o estouro vira DIAGNÓSTICO (log), não ressalva: o   │
 * │ aluno recebeu a seção dele por inteiro e não tem o que ser avisado. Ver  │
 * │ `diagnosticos`.                                                          │
 * │                                                                          │
 * │ E VALE NO RELÓGIO, que é onde a mesma troca sobreviveu mais uma rodada.  │
 * │ `cabeNoTempo` responde só pelo relógio (é pergunta, não sentença) e      │
 * │ `rodarAgente` aplica a ele a isenção do protegido. Reproduzido com o     │
 * │ roster real: onda 1 fechando em 70 s dos 95 s do rápido deixa 25 s       │
 * │ contra o piso de 35 s do Estrategista — ele era PULADO, o piso de        │
 * │ sucesso reprovava o run, e o aluno que esperou 70 segundos vendo o time  │
 * │ inteiro entregar recebia 502 e estorno. Tentar apertado custa uma        │
 * │ chamada; não tentar custa o run.                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
export const LIMITES_PADRAO: Record<'rapido' | 'profundo', BudgetLimits> = {
	/**
	 * 6 chamadas com busca (4 do roster + 2 de folga para retry).
	 *
	 * ┌─ O RELÓGIO É FUNÇÃO DO TETO DE SAÍDA DO ESTRATEGISTA ─────────────────┐
	 * │ Ele subiu de 65 s para 95 s por medição: o pior caso das duas ondas    │
	 * │ não cabia em 65 s e o Estrategista era ABORTADO — falha de timeout não │
	 * │ é retriável, ele é `essencial`, o run devolvia 502 e o controller       │
	 * │ estornava. Naquela medição ele tinha teto de 4.000 tokens de saída e    │
	 * │ fechava em 34,4–54,8 s; com `preencherFotos` exigindo 20 s livres, a    │
	 * │ conta era 12 + 55 + 20 = 87 s, e 95 s dava 8 s de folga.                │
	 * │                                                                        │
	 * │ 120 s AGORA, e é a MESMA conta com o número novo: o teto de saída dele  │
	 * │ passou para 8.000 tokens (ver o registro no roster — com 4.000 ele      │
	 * │ vinha cortado, e no rápido chegou a escrever 4.028), e ao ritmo medido  │
	 * │ de 12,6 ms por token de saída 8.000 tokens são ~99 s. Com a onda 1      │
	 * │ fechando em 12 s, 95 s deixavam 83 s para uma chamada que pode precisar │
	 * │ de 99 — ou seja, o mesmo estorno de antes, por timeout, com o dinheiro  │
	 * │ da onda 1 já gasto. 12 + 99 = 111 s cabem em 120 s.                     │
	 * │                                                                        │
	 * │ 120 s E NÃO MAIS QUE ISSO porque o cartão do modo arredonda para cima   │
	 * │ (`Math.ceil(segundos/60)`): 95 s e 120 s são os dois "~2min" na tela do │
	 * │ aluno, e 121 s viraria "~3min". O rápido foi aprovado como está — este  │
	 * │ relógio é a folga que impede o estorno, não uma promessa nova.          │
	 * │                                                                        │
	 * │ O que fica de fora no pior caso são as FOTOS (20 s), que degradam com   │
	 * │ aviso honesto em vez de derrubar o run. Ordem certa de sacrifício.      │
	 * │                                                                        │
	 * │ Quem baixar este número tem que baixar junto o teto de saída do         │
	 * │ Estrategista, e quem subir o teto dele tem que refazer esta conta.      │
	 * └───────────────────────────────────────────────────────────────────────┘
	 *
	 * `maxUsd` 0,14: o PICO DE COMPROMETIMENTO medido em `mercado+rápido` é
	 * US$ 0,122 (onda 1 real 0,019 + projeção de pior caso da síntese 0,103), e
	 * o run custa US$ 0,082. Estava 0,10, ou seja ABAIXO do próprio pico, e o
	 * freio fechava em toda execução de mercado — sem cortar ninguém (os dois da
	 * síntese são isentos), mas gravando um estouro que não existia.
	 *
	 * O RÁPIDO NÃO MUDOU DE COMPORTAMENTO por causa disto: o teto subiu porque o
	 * teto de saída do Estrategista subiu (ele é o mesmo registro nos dois
	 * modos, e no rápido chegou a escrever 4.028 tokens — acima dos 4.000 em que
	 * ele batia). O que o aluno recebe é o mesmo, e o custo medido continua em
	 * 81–85% de margem.
	 */
	rapido: { maxBuscas: 6, maxUsd: 0.14, deadlineMs: 120_000 },
	/**
	 * 22 chamadas com busca (17 do roster + 5 de folga para retry) e 300 s para
	 * TRÊS ondas de 22 especialistas.
	 *
	 * ┌─ A CONTA DE RELÓGIO, E POR QUE ELA É UMA SOMA ─────────────────────────┐
	 * │ As ondas são BARREIRAS: a onda 2 só começa quando a 1 fecha, porque é   │
	 * │ do digest da 1 que ela vive. O tempo do run é a SOMA dos três máximos,  │
	 * │ nunca o máximo dos três. Com a concorrência do bloco (10, ver           │
	 * │ `CONCORRENCIA_PADRAO`) cada onda cabe numa leva só:                     │
	 * │   onda 1  7 a 8 especialistas, 1 leva ......... até  25 s               │
	 * │   onda 2  10 especialistas, 1 leva, com digest . até  30 s              │
	 * │   onda 3  4 a 5 sintetizadores (Estrategista 34–55 s) até 60 s          │
	 * │   fotos   até 36 páginas, 6 levas de 6 s ....... 36 s                   │
	 * │   ────────────────────────────────────────────────────────────────      │
	 * │   pior caso somado ........................... ~151 s                   │
	 * │ 300 s é o dobro disso, e o dobro é de propósito: o dono do produto      │
	 * │ disse "pode demorar mais tempo, não tem importância", e o que este      │
	 * │ relógio compra é a ISENÇÃO nunca precisar entrar em campo — cada        │
	 * │ especialista que roda com o relógio apertado ou é pulado (perde-se a    │
	 * │ seção dele) ou roda com o timeout cortado (morre por timeout, que não   │
	 * │ é retriável). Com 22 especialistas há 22 chances de isso acontecer.     │
	 * │                                                                          │
	 * │ COM A CONCORRÊNCIA ANTIGA (6) a conta dava ~181 s: a onda 2, que tem     │
	 * │ DEZ especialistas, virava duas levas cujo segundo turno carregava        │
	 * │ quatro — 30 s de relógio pagos por 4 de 16 pesquisadores, com a          │
	 * │ barreira segurando todo o resto. Cabia nos 300 s, mas era desperdício    │
	 * │ puro. Ver `CONCORRENCIA_PADRAO` no bloco.                                │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 *
	 * `maxUsd` 0,38: acima do PICO de comprometimento MEDIDO em run frio de
	 * `mercado+profundo` (US$ 0,335 = gasto real das ondas 1 e 2, US$ 0,125,
	 * mais a projeção de pior caso da onda 3, US$ 0,211), com ~15% de folga.
	 *
	 * Estava 0,32 — ABAIXO do próprio pico —, calibrado contra o teto de 75% de
	 * margem (US$ 0,327) em vez de contra o que a execução compromete. O freio
	 * fechava em TODO run profundo, com o run custando US$ 0,26 a US$ 0,30. Ver
	 * o cabeçalho: o piso de margem é conferido no custo MEDIDO, que é onde ele
	 * é verificável; este número é freio, não previsão.
	 */
	profundo: { maxBuscas: 22, maxUsd: 0.38, deadlineMs: 300_000 },
};
