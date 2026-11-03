/**
 * Semeia a coleção `maquinas` do Orçamento com o parque real deste público.
 *
 * POR QUE ISTO EXISTE: o perfil curto pergunta "que máquina você tem?" e deriva
 * doze campos da resposta. Enquanto a coleção estiver vazia, quem responde essa
 * pergunta é o LASTRO em código (`MACHINE_CLASSES`, `src/lib/quote/machines.ts`)
 * — e funciona, de propósito. O que a coleção acrescenta é a única coisa que o
 * código não dá: **o admin corrigir um número de mercado sem deploy**. Tubo de
 * CO2 a R$ 2.000 é o preço de hoje; ano que vem não é, e trocar isso não pode
 * exigir uma release.
 *
 * Semeada, a coleção VENCE o código campo a campo. Uma linha que só preenche
 * `consumiveis_hora` corrige o tubo e deixa o resto como está — é PATCH, não
 * cadastro inteiro. Por isso só `classe_id` e `laser` são obrigatórios.
 *
 * Usa o endpoint de import, que valida linha a linha contra os `fields`
 * declarados na definition e não insere nada se qualquer linha falhar — em vez
 * de escrever direto no banco, que pularia essa validação.
 *
 * Idempotência: o import CRIA, não faz upsert. Rodar duas vezes duplica; por
 * isso o script confere antes e recusa se já houver linha.
 *
 *   npx tsx scripts/seed-quote-machines.ts [--tool central_custos] [--force]
 */
import 'dotenv/config';
import { MACHINE_CLASSES } from '../src/lib/quote/machines.js';

const arg = (nome: string, padrao: string): string => {
	const i = process.argv.indexOf(`--${nome}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const TOOL = arg('tool', 'central_custos');
const COLLECTION = 'maquinas';
const FORCE = process.argv.includes('--force');
const BASE = process.env.SEED_API_URL ?? 'http://localhost:3333';

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

/** CSV na ordem dos campos declarados em `machineFieldsSpec()`. */
function csvDasMaquinas(): string {
	const cab = [
		'title',
		'classe_id',
		'laser',
		'potencia_w',
		'v_grav_mm_s',
		'line_mm',
		'energia_kw',
		'gas_m3h',
		'preco_gas_m3',
		'consumiveis_hora',
		'manutencao_hora',
		'valor_maquina',
		'supervisao_pct',
	];
	const linhas = MACHINE_CLASSES.map((m) =>
		[
			m.label,
			m.id,
			m.laser,
			m.potenciaW,
			m.vGravMmS,
			m.lineMm,
			m.energiaKw,
			m.gasM3h,
			m.precoGasM3,
			m.consumiveisHora,
			m.manutencaoHora,
			m.valorMaquina,
			m.supervisaoPct,
		].join(','),
	);
	return `${cab.join(',')}\n${linhas.join('\n')}\n`;
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

	const csv = csvDasMaquinas();
	console.log(
		`Importando ${MACHINE_CLASSES.length} classes em ${TOOL}/${COLLECTION}…`,
	);
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
		'\nUV (3–5 W) NÃO entra: `LaserKind` só conhece `fibra` e `co2`, e mapear ' +
			'UV para um dos dois faria a cascata de velocidade responder com a curva ' +
			'errada. Quem tem UV escolhe "outra máquina" e preenche o formulário ' +
			'longo, que continua existindo.',
	);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
