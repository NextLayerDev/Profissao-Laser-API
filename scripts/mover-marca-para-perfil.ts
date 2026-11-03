/**
 * MUDA O ENDEREÇO DAS MARCAS JÁ CADASTRADAS — de `estudio_imagens` para `perfil`.
 *
 * ┌─ POR QUE ISTO É UM UPDATE E NÃO UMA MIGRAÇÃO ────────────────────────────┐
 * │ `pl_tool_bank_entry.tool_key` é `text` puro: sem FK, sem check           │
 * │ constraint, sem índice único que envolva a coluna (`sql/tool-bank-       │
 * │ entries.sql`). Não poderia ser diferente — a definition que dá sentido a │
 * │ essa string mora em OUTRO banco (o db-upvox), então o Postgres daqui não │
 * │ tem contra o que validar.                                                │
 * │                                                                          │
 * │ Consequência prática: mudar o dono de uma coleção custa um UPDATE de     │
 * │ coluna. ZERO DDL, zero downtime, e o inverso é o mesmo comando com as    │
 * │ duas keys trocadas (`--voltar`).                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE NÃO SE MOVE, E ISSO É O PONTO ───────────────────────────────────┐
 * │ `id`, `owner_id`, `data`, `created_at`, `status`, `visibility` e o       │
 * │ `position` ficam intactos. Ou seja:                                      │
 * │                                                                          │
 * │  • o campo `principal` — QUAL marca vale — continua valendo. Se o aluno  │
 * │    tinha escolhido a segunda marca, ela continua sendo a escolhida       │
 * │    depois da mudança de endereço;                                        │
 * │  • o LOGO não precisa ser re-enviado: o caminho na CDN é                 │
 * │    `aluno/<owner_id>/<uuid>.png` (ver "Pasta por DONO" em                │
 * │    `controllers/tool-collection.ts`) e não carrega `tool_key` nem nome   │
 * │    de coleção. A URL gravada em `logo_url` continua resolvendo;          │
 * │  • `created_at` intacto mantém o desempate da regra de escolha           │
 * │    (`lib/marca.ts`): a "mais recente" continua sendo a mesma de antes.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * IDEMPOTENTE de propósito: filtra por `tool_key = <origem>`, então rodar duas
 * vezes seguidas move 0 linhas na segunda. É seguro rodar sem olhar antes — o
 * modo de falha de um script de dado é alguém não rodar por medo de rodar duas.
 *
 *   npx tsx scripts/mover-marca-para-perfil.ts            # confere e move
 *   npx tsx scripts/mover-marca-para-perfil.ts --seco     # só confere, não grava
 *   npx tsx scripts/mover-marca-para-perfil.ts --voltar   # desfaz
 */
import 'dotenv/config';
import { MARCA_COLECAO, MARCA_TOOL } from '../src/lib/marca.js';
import { supabase } from '../src/lib/supabase.js';

const TABELA = 'pl_tool_bank_entry';

/** O endereço ANTIGO. Fica escrito aqui, e não em env, porque é história: é um
 * fato do passado, não uma configuração que alguém possa querer mudar. */
const CONTAINER_ANTIGO = 'estudio_imagens';

const voltar = process.argv.includes('--voltar');
const seco = process.argv.includes('--seco');

const origem = voltar ? MARCA_TOOL : CONTAINER_ANTIGO;
const destino = voltar ? CONTAINER_ANTIGO : MARCA_TOOL;

interface Linha {
	id: string;
	tool_key: string;
	owner_id: string | null;
	title: string | null;
	created_at: string;
	data: Record<string, unknown> | null;
}

async function censo(key: string): Promise<Linha[]> {
	const { data, error } = await supabase
		.from(TABELA)
		.select('id, tool_key, owner_id, title, created_at, data')
		.eq('tool_key', key)
		.eq('collection', MARCA_COLECAO)
		.order('created_at', { ascending: true });
	if (error) throw new Error(`censo de ${key}: ${error.message}`);
	return (data ?? []) as Linha[];
}

function descrever(l: Linha): string {
	const d = (l.data ?? {}) as Record<string, unknown>;
	const principal = d.principal === true || d.principal === 'true';
	const temLogo = typeof d.logo_url === 'string' && d.logo_url.length > 0;
	return [
		`  ${l.id}`,
		`dono ${l.owner_id ?? '—'}`,
		`"${l.title ?? 'sem título'}"`,
		principal ? 'PRINCIPAL' : '',
		temLogo ? 'com logo' : 'sem logo',
	]
		.filter(Boolean)
		.join('  ·  ');
}

async function main() {
	console.log(
		`marcas: \`${origem}\` → \`${destino}\`  (coleção \`${MARCA_COLECAO}\`)${
			seco ? '  [SECO: não grava]' : ''
		}\n`,
	);

	const antes = await censo(origem);
	const jaNoDestino = await censo(destino);

	console.log(`em \`${origem}\`:  ${antes.length} registro(s)`);
	for (const l of antes) console.log(descrever(l));
	console.log(`em \`${destino}\`: ${jaNoDestino.length} registro(s)`);
	for (const l of jaNoDestino) console.log(descrever(l));

	if (antes.length === 0) {
		console.log(
			`\nnada a mover — já está tudo em \`${destino}\` (ou nunca houve marca).`,
		);
		return;
	}
	if (seco) {
		console.log(`\n[SECO] moveria ${antes.length} registro(s).`);
		return;
	}

	const { data, error } = await supabase
		.from(TABELA)
		.update({ tool_key: destino })
		.eq('tool_key', origem)
		.eq('collection', MARCA_COLECAO)
		.select('id');
	if (error) throw new Error(`update: ${error.message}`);
	console.log(`\nmovidos: ${data?.length ?? 0} registro(s).`);

	/**
	 * RELÊ, e relê pelo DESTINO. O `update` acima poderia devolver sucesso e
	 * nenhuma linha (é o que acontece se `collection` estiver escrito diferente),
	 * e o sintoma seria a marca sumir da tela sem erro nenhum em lugar nenhum —
	 * exatamente o modo de falha que este cadastro já teve uma vez.
	 */
	const depois = await censo(destino);
	const sobrou = await censo(origem);
	console.log(`\nconferência:`);
	console.log(`  \`${destino}\`: ${depois.length} registro(s)`);
	for (const l of depois) console.log(descrever(l));
	console.log(`  \`${origem}\`:  ${sobrou.length} registro(s) (esperado: 0)`);
	if (sobrou.length > 0) {
		throw new Error(`sobraram ${sobrou.length} registro(s) em \`${origem}\``);
	}
	console.log(
		`\nreversível: npx tsx scripts/mover-marca-para-perfil.ts ${
			voltar ? '' : '--voltar'
		}`.trimEnd(),
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
