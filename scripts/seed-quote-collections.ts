/**
 * Semeia a coleção `materiais` do Orçamento com as 20 famílias que
 * `seedMateriaisCsv()` já produz.
 *
 * POR QUE ISTO EXISTE: a função de seed foi escrita junto com o precificador e
 * NUNCA foi chamada por ninguém. Resultado: a coleção `materiais` está vazia,
 * `quote.price` não acha preço nem chapa para família nenhuma, e todo orçamento
 * sai com os valores genéricos do `DEFAULT_PROFILE` marcado como estimativa.
 * É o bloqueador de uma linha que segurava a ferramenta inteira.
 *
 * Usa o endpoint de import (`POST /api/tools/:key/c/materiais/import`), que já
 * valida linha a linha contra os `fields` declarados na definition e **não
 * insere nada se qualquer linha falhar** — em vez de escrever direto no banco,
 * que puralaria essa validação.
 *
 * Idempotência: o import CRIA registros, não faz upsert. Rodar duas vezes
 * duplica. Por isso o script confere antes e recusa se já houver material —
 * use `--force` para semear mesmo assim (só faz sentido em base zerada).
 *
 *   npx tsx scripts/seed-quote-collections.ts [--tool central_custos] [--force]
 */
import 'dotenv/config';
import { seedMateriaisCsv } from '../src/lib/quote/materials.js';

const arg = (nome: string, padrao: string): string => {
	const i = process.argv.indexOf(`--${nome}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const TOOL = arg('tool', 'central_custos');
const COLLECTION = 'materiais';
const FORCE = process.argv.includes('--force');
const BASE = process.env.SEED_API_URL ?? 'http://localhost:3333';

/**
 * O import é `authenticateCustomer` + checagem de staff no controller. Local,
 * a main API confia em `x-user-id`/`x-user-role` (é como o gateway a chama),
 * então basta um id de staff. Em produção, use um Bearer real.
 */
const STAFF_ID = process.env.SEED_STAFF_ID ?? '';
const BEARER = process.env.SEED_BEARER ?? '';

function headers(): Record<string, string> {
	const h: Record<string, string> = { 'content-type': 'application/json' };
	if (BEARER) h.authorization = `Bearer ${BEARER}`;
	if (STAFF_ID) {
		h['x-user-id'] = STAFF_ID;
		h['x-user-role'] = 'admin';
	}
	return h;
}

async function main() {
	if (!STAFF_ID && !BEARER) {
		console.error(
			'Defina SEED_STAFF_ID (id de um staff) ou SEED_BEARER no ambiente.',
		);
		process.exit(1);
	}

	const url = `${BASE}/api/tools/${TOOL}/c/${COLLECTION}`;

	const atual = await fetch(`${url}?page_size=1`, { headers: headers() });
	if (!atual.ok) {
		const corpo = await atual.text();
		throw new Error(
			`não consegui ler a coleção (${atual.status}): ${corpo.slice(0, 300)}`,
		);
	}
	const { total } = (await atual.json()) as { total: number };
	if (total > 0 && !FORCE) {
		console.log(
			`A coleção '${COLLECTION}' de '${TOOL}' já tem ${total} registro(s). ` +
				'Nada a fazer. Use --force se quiser importar mesmo assim.',
		);
		return;
	}

	const csv = seedMateriaisCsv();
	const linhas = csv.trim().split('\n').length - 1;
	console.log(`Importando ${linhas} famílias em ${TOOL}/${COLLECTION}…`);

	const res = await fetch(`${url}/import`, {
		method: 'POST',
		headers: headers(),
		body: JSON.stringify({ csv }),
	});
	const corpo = await res.text();
	if (!res.ok) {
		throw new Error(`import falhou (${res.status}): ${corpo.slice(0, 1200)}`);
	}
	console.log('OK:', corpo.slice(0, 400));
	console.log(
		'\nA coleção `velocidades` continua VAZIA de propósito: não existe base ' +
			'curada para semear. A cascata de `cut-speed.ts` cai na curva paramétrica ' +
			'e a tela mostra isso como "velocidade estimada" — que é o comportamento ' +
			'honesto até alguém medir na máquina.',
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
