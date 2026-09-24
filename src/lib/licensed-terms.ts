/**
 * O TERMO DA ARTE LICENCIADA — o texto e a versão dele.
 *
 * ┌─ POR QUE O TEXTO MORA NO SERVIDOR, E NÃO NO FRONT ──────────────────────┐
 * │ O que se registra no aceite é uma VERSÃO, e o que dá sentido à versão é  │
 * │ o texto que ela nomeia. Se o texto morasse no front e a versão aqui, um  │
 * │ deploy de front poderia mudar o que as pessoas leem sem mudar o que o    │
 * │ banco diz que elas aceitaram — e aí o registro deixa de provar qualquer  │
 * │ coisa.                                                                   │
 * │                                                                          │
 * │ Com o texto aqui, ele viaja junto na resposta do portão. Trocar o texto  │
 * │ é subir a versão, e subir a versão vence o aceite de todo mundo — que é  │
 * │ exatamente o comportamento que um termo precisa ter.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ ESTE TEXTO É RASCUNHO DE ENGENHARIA, NÃO PEÇA JURÍDICA. Quem cuida dos
 * contratos com os licenciantes precisa revisar antes de valer em produção.
 * Quando revisar, suba a `TERMO_VERSAO` — é o que obriga o reaceite.
 */

/**
 * Data do texto, não número de sequência: `2026-08-19` diz sozinho quando
 * aquele aceite foi dado sobre qual redação. Um `v2` não diz nada.
 */
export const TERMO_VERSAO = '2026-08-19';

export interface ClausulaDoTermo {
	titulo: string;
	texto: string;
}

export const TERMO_CLAUSULAS: ClausulaDoTermo[] = [
	{
		titulo: 'Informei todos os meus canais de venda.',
		texto:
			'A lista acima é completa: inclui todo e-commerce, marketplace, rede social e ponto de venda onde eu ofereço produtos personalizados. Se eu abrir um canal novo, volto aqui e atualizo a lista antes de vender por ele.',
	},
	{
		titulo: 'Não fabrico nem vendo produto de marca licenciada sem licença.',
		texto:
			'Toda peça que eu produzir com a marca de um licenciante desta plataforma sai de uma geração feita aqui, com o código de autenticidade dela. Não reutilizo uma arte para gravar mais peças do que gerei, e não removo o código da arte.',
	},
	{
		titulo: 'A licença é por peça.',
		texto:
			'O código identifica a peça, não a mim. Repetir o mesmo código em mais de uma peça é vender peça não licenciada.',
	},
	{
		titulo: 'O licenciante pode auditar.',
		texto:
			'A contagem de peças que eu gerei de cada marca e os canais que informei acima ficam disponíveis para o licenciante daquela marca.',
	},
];
