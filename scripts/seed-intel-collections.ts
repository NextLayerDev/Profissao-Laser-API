/**
 * Semeia `categorias` e `heuristicas` da Central de Inteligência.
 *
 * As duas são pequenas e são o que faz a ferramenta funcionar:
 *
 * - `categorias` é o VOCABULÁRIO FECHADO da classificação. Sem ele o modelo
 *   inventa um slug por execução ("brindes-personalizados" numa, "copo-termico"
 *   na outra) e o cache de 7 dias nunca acerta. Medido com lista fechada e
 *   temperatura 0: "display de mesa com QR code do pix" e "placa PIX MDF"
 *   caem ambas em `placa-pix`.
 *
 * - `heuristicas` são os fatores que viram CLASSE em número. A IA diz
 *   "complexidade média"; o comprimento de corte sai de
 *   `2*(w+h) * k_perimetro[complexidade]`. Ficam como dado para poderem ser
 *   calibrados contra DXF real sem deploy.
 *
 * Passa pelo endpoint de import, que valida linha a linha contra os `fields`
 * declarados e não insere nada se qualquer linha falhar.
 *
 *   SEED_STAFF_ID=<id de staff> npx tsx scripts/seed-intel-collections.ts
 */
import 'dotenv/config';
import { toCsv } from '../src/lib/csv.js';

const TOOL = 'central_inteligencia';
const BASE = process.env.SEED_API_URL ?? 'http://localhost:3333';
const STAFF_ID = process.env.SEED_STAFF_ID ?? '';
const BEARER = process.env.SEED_BEARER ?? '';
const FORCE = process.argv.includes('--force');

/**
 * As categorias iniciais. Não é uma taxonomia acadêmica — é a lista do que o
 * público DE FATO faz e vende, que é o que faz o cache acertar. `outros` não
 * entra: produto fora da lista vira `outros` no runtime e o admin promove a
 * sugestão depois.
 */
const CATEGORIAS: [string, string, string, string][] = [
	// slug, nome, sinônimos, palavras-chave
	[
		'placa-pix',
		'Placa de PIX',
		'display pix, plaquinha pix, suporte qr code, placa qr',
		'pix, qr, code, placa, display',
	],
	[
		'cofre-desafio',
		'Cofre desafio',
		'cofrinho 52 semanas, caixa desafio, cofre poupança',
		'cofre, desafio, semanas, poupanca, cofrinho',
	],
	[
		'copo-termico-personalizado',
		'Copo térmico personalizado',
		'stanley personalizado, caneca térmica, copo gravado',
		'copo, termico, stanley, caneca, gravacao',
	],
	[
		'caneca-personalizada',
		'Caneca personalizada',
		'caneca gravada, caneca porcelana',
		'caneca, xicara, personalizada',
	],
	[
		'trofeu-medalha',
		'Troféu e medalha',
		'premiação, medalha esportiva, troféu acrílico',
		'trofeu, medalha, premiacao, campeonato',
	],
	[
		'quadro-mdf-camadas',
		'Quadro em camadas',
		'quadro 3d, mandala, quadro religioso',
		'quadro, camadas, mandala, parede, 3d',
	],
	[
		'luminaria-mdf',
		'Luminária',
		'abajur mdf, luminária acrílico, lampada decorativa',
		'luminaria, abajur, luz, lampada',
	],
	[
		'porta-copo',
		'Porta-copo',
		'bolacha de chopp, descanso de copo',
		'porta, copo, descanso, bolacha',
	],
	[
		'chaveiro-personalizado',
		'Chaveiro',
		'chaveiro acrílico, chaveiro mdf, lembrancinha chaveiro',
		'chaveiro, chave, lembrancinha',
	],
	[
		'topo-de-bolo',
		'Topo de bolo',
		'topper, enfeite de bolo',
		'topo, bolo, topper, festa',
	],
	[
		'calendario-perpetuo',
		'Calendário perpétuo',
		'calendário de mesa, calendário deslizante',
		'calendario, perpetuo, mesa',
	],
	[
		'placa-sinalizacao',
		'Placa de sinalização',
		'placa de porta, placa indicativa, sinalização',
		'placa, sinalizacao, indicativa, porta',
	],
	[
		'brinde-corporativo',
		'Brinde corporativo',
		'kit corporativo, brinde empresa',
		'brinde, corporativo, empresa, kit',
	],
	[
		'decoracao-infantil',
		'Decoração infantil',
		'painel festa, decoração quarto bebê',
		'infantil, festa, bebe, quarto, painel',
	],
	[
		'joia-acrilico',
		'Joia e acessório em acrílico',
		'brinco acrílico, acessório laser',
		'brinco, joia, acrilico, acessorio',
	],
	[
		'convite-e-papelaria',
		'Convite e papelaria',
		'convite laser, papelaria personalizada',
		'convite, papelaria, casamento',
	],
	[
		'organizador-mdf',
		'Organizador e caixa',
		'caixa mdf, organizador de mesa, porta-treco',
		'caixa, organizador, porta, treco, gaveta',
	],
	[
		'peca-tecnica-metal',
		'Peça técnica em metal',
		'corte fibra, peça industrial, chapa cortada',
		'chapa, metal, industrial, peca, fibra',
	],
];

/**
 * Fatores de estimativa. Os `k_perimetro` são o quanto o corte real passa do
 * perímetro da caixa envolvente: uma peça simples é quase o retângulo; uma
 * mandala tem muito recorte interno. Números iniciais de bom senso — a
 * calibração de verdade vem de comparar dossiê estimado com DXF real.
 */
const HEURISTICAS: [string, number, string][] = [
	[
		'k_perimetro_simples',
		1.15,
		'Contorno quase retangular: caixa, porta-copo, placa lisa.',
	],
	[
		'k_perimetro_media',
		1.9,
		'Recorte moderado: letras, furos, contorno vazado.',
	],
	[
		'k_perimetro_alta',
		3.2,
		'Muito recorte interno: mandala, renda, quadro em camadas.',
	],
	[
		'preenchimento_simples',
		0.85,
		'Fração da caixa envolvente que é material de fato.',
	],
	['preenchimento_media', 0.7, ''],
	['preenchimento_alta', 0.5, ''],
	[
		'fracao_area_gravacao',
		0.35,
		'Quando há gravação, quanto da face ela ocupa, em média.',
	],
	[
		'margem_faixa_pct',
		0.3,
		'Largura da faixa de custo mostrada ao aluno (±30%) quando a medida vem de foto.',
	],
];

function headers(): Record<string, string> {
	const h: Record<string, string> = { 'content-type': 'application/json' };
	if (BEARER) h.authorization = `Bearer ${BEARER}`;
	if (STAFF_ID) {
		h['x-user-id'] = STAFF_ID;
		h['x-user-role'] = 'admin';
	}
	return h;
}

async function importar(collection: string, csv: string, quantas: number) {
	const url = `${BASE}/api/tools/${TOOL}/c/${collection}`;

	const atual = await fetch(`${url}?page_size=1`, { headers: headers() });
	if (!atual.ok) {
		throw new Error(
			`não consegui ler '${collection}' (${atual.status}): ${(await atual.text()).slice(0, 300)}`,
		);
	}
	const { total } = (await atual.json()) as { total: number };
	if (total > 0 && !FORCE) {
		console.log(`  ${collection}: já tem ${total} registro(s), pulando.`);
		return;
	}

	const res = await fetch(`${url}/import`, {
		method: 'POST',
		headers: headers(),
		body: JSON.stringify({ csv }),
	});
	const corpo = await res.text();
	if (!res.ok) {
		throw new Error(
			`import de '${collection}' falhou (${res.status}): ${corpo.slice(0, 900)}`,
		);
	}
	console.log(`  ${collection}: ${quantas} linhas → ${corpo.slice(0, 120)}`);
}

async function main() {
	if (!STAFF_ID && !BEARER) {
		console.error('Defina SEED_STAFF_ID ou SEED_BEARER no ambiente.');
		process.exit(1);
	}

	console.log(`Semeando ${TOOL}…`);

	await importar(
		'categorias',
		toCsv(
			['title', 'slug', 'nome', 'sinonimos', 'palavras_chave', 'ativa'],
			CATEGORIAS.map(([slug, nome, sin, pc]) => [
				nome,
				slug,
				nome,
				sin,
				pc,
				'true',
			]),
		),
		CATEGORIAS.length,
	);

	await importar(
		'heuristicas',
		toCsv(
			['title', 'chave', 'valor', 'nota'],
			HEURISTICAS.map(([chave, valor, nota]) => [chave, chave, valor, nota]),
		),
		HEURISTICAS.length,
	);

	console.log(
		'\nPronto. A coleção `agentes` é semeada na fase do time de pesquisa.',
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
