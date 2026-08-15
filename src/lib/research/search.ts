import {
	type ChamadaOpts,
	type ChamadaResult,
	type Citation,
	chamarModelo,
} from '../agent-team/llm.js';

/**
 * A BUSCA DA CENTRAL — o que só a pesquisa usa.
 *
 * A chamada ao modelo (com ou sem o plugin de busca), a guarda de resposta
 * vazia, o mapa de erros e a contabilidade do que a chamada custou moram em
 * `lib/agent-team/llm.ts`: nada disso é sobre pesquisa, e o time do Ateliê
 * precisa exatamente do mesmo — com foto e sem busca. O código saiu daqui
 * VERBATIM, e os nomes continuam sendo reexportados por este arquivo porque é
 * daqui que o bloco, o seed e os testes sempre os importaram.
 *
 * `SearchError` é o mesmo objeto de classe que `ChamadaError` — o alias existe
 * para não renomear oito usos num arquivo em produção por causa de uma mudança
 * de caminho. Um `instanceof SearchError` continua valendo para tudo que a
 * chamada lança.
 *
 * O que ficou de próprio: `filtrarPorTema`. Ele descarta citação que não fala
 * do tema pesquisado, e "tema" é uma noção que só existe numa pesquisa.
 */
export {
	ChamadaError as SearchError,
	type ChamadaResult as SearchCallResult,
	type Citation,
	extrairCitacoes,
	FALHA_PARA_TELA,
	montarPlugin,
	parseDominios,
	type SearchEngine,
	USD_POR_BUSCA,
} from '../agent-team/llm.js';

/**
 * Descarta citação fora do tema ANTES de o texto chegar ao modelo que consolida.
 *
 * É a defesa determinística contra o lixo que a busca semântica traz. As
 * palavras-chave vêm da coleção `categorias` — por isso o campo existe lá.
 * Sem nenhuma palavra-chave, não filtra (melhor não filtrar que filtrar errado).
 */
export function filtrarPorTema(
	citacoes: Citation[],
	palavrasChave: string[],
): { mantidas: Citation[]; descartadas: number } {
	const chaves = palavrasChave
		.map((p) => p.trim().toLowerCase())
		.filter((p) => p.length >= 3);
	if (chaves.length === 0) return { mantidas: citacoes, descartadas: 0 };

	const mantidas = citacoes.filter((c) => {
		const alvo = `${c.title ?? ''} ${c.url} ${c.content ?? ''}`.toLowerCase();
		return chaves.some((k) => alvo.includes(k));
	});
	return { mantidas, descartadas: citacoes.length - mantidas.length };
}

/**
 * A chamada de um especialista de PESQUISA.
 *
 * É `chamarModelo` com duas coisas fixadas: nenhuma foto (na Central ninguém
 * enxerga nada) e o rótulo do produto no painel do OpenRouter, que é por onde
 * se separa o gasto da Central do gasto das outras ferramentas.
 */
export function chamarComBusca(
	o: Omit<ChamadaOpts, 'imagens' | 'maxSide' | 'titulo'>,
): Promise<ChamadaResult> {
	return chamarModelo({ ...o, titulo: 'Profissão Laser - Inteligência' });
}
