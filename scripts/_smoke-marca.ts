/**
 * Smoke da coleção `marca` (Minha marca) — HTTP de verdade, banco de verdade.
 *
 * O que só este caminho prova, e nenhum unit test prova:
 *
 * 1. A definition que está NO BANCO (semeada por
 *    `api-upvox/scripts/seed-perfil.ts`) declara os campos com os
 *    nomes e tipos que o back espera. Campo com nome errado no seed não quebra
 *    nada: `validateCollectionData` o DESCARTA EM SILÊNCIO, e o cadastro do
 *    aluno nasce sem a cor da marca — sem erro e sem log.
 * 2. `visibility:'owner'` chega ao registro gravado. É a única coisa entre a
 *    identidade da empresa de um aluno e a tela de outro.
 * 3. O upload devolve a paleta junto (`{url, width, height, palette}`) DEPOIS
 *    de passar pelo schema de resposta da rota — que apaga em silêncio toda
 *    chave que ele não declara.
 *
 * Roda contra a instância local (`npm run dev` na 3333) e exige o GATEWAY no ar:
 * a identidade vai nos headers `x-user-*` (o que o gateway injeta em produção),
 * mas o token TAMBÉM é obrigatório — é ele que o main repassa ao buscar a
 * definition da tool, e sem ele o upvox responde 401 e o smoke morre num
 * `tool_definition_unavailable` que não é sobre a marca.
 *
 * O aluno precisa estar em `TOOL_PREVIEW_USERS`: a tool está em DRAFT, e só a
 * allowlist de preview enxerga a definition dela.
 *
 * Apaga o que criou, inclusive se falhar.
 *
 *   SMOKE_BEARER=<token de aluno> npx tsx --env-file=.env scripts/_smoke-marca.ts
 */
import sharp from 'sharp';
import { MARCA_COLECAO, MARCA_TOOL } from '../src/lib/marca.js';
import { supabase } from '../src/lib/supabase.js';
import { toolCollectionRepository as repo } from '../src/repositories/tool-collection.js';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3333';
/**
 * O contêiner e a coleção vêm de `src/lib/marca.ts` — o smoke não pode ter uma
 * segunda opinião sobre onde a marca mora: era exatamente assim que ele
 * continuaria verde depois de a coleção mudar de endereço.
 */
const TOOL = MARCA_TOOL;
const COL = MARCA_COLECAO;

/** Primeiro id de `TOOL_PREVIEW_USERS` — aluno de verdade, tool em rascunho. */
const ALUNO =
	process.env.SMOKE_CUSTOMER_ID ??
	(process.env.TOOL_PREVIEW_USERS ?? '').split(',')[0]?.trim();

const BEARER = process.env.SMOKE_BEARER ?? '';

const headers: Record<string, string> = {
	'x-user-id': ALUNO,
	'x-user-role': 'customer',
	authorization: `Bearer ${BEARER}`,
};

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: unknown) {
	console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${nome}`);
	if (!ok) {
		falhas++;
		if (detalhe !== undefined)
			console.log('        →', JSON.stringify(detalhe));
	}
}

/** Arte chapada em fundo branco: o que o classificador chama de logo. */
async function logo(): Promise<Buffer> {
	const w = 300;
	const h = 300;
	const px = Buffer.alloc(w * h * 3, 255);
	for (let y = 40; y < 160; y++) {
		for (let x = 40; x < 260; x++) {
			const i = (y * w + x) * 3;
			px[i] = 225;
			px[i + 1] = 29;
			px[i + 2] = 29;
		}
	}
	return sharp(px, { raw: { width: w, height: h, channels: 3 } })
		.png()
		.toBuffer();
}

async function main() {
	if (!ALUNO) {
		throw new Error(
			'Sem aluno: defina SMOKE_CUSTOMER_ID ou TOOL_PREVIEW_USERS no .env.',
		);
	}
	if (!BEARER) {
		throw new Error(
			'Sem token: defina SMOKE_BEARER com o token de um aluno (o main o repassa ao upvox para ler a definition).',
		);
	}
	console.log(`Aluno ${ALUNO} · ${BASE}\n`);

	console.log('Upload do logo:');
	const fd = new FormData();
	fd.append(
		'file',
		new Blob([await logo()], { type: 'image/png' }),
		'logo.png',
	);
	const up = await fetch(`${BASE}/api/tools/${TOOL}/c/${COL}/upload-image`, {
		method: 'POST',
		headers,
		body: fd,
	});
	const upBody = (await up.json()) as {
		url?: string;
		width?: number;
		palette?: { hex: string; share: number }[];
		message?: string;
	};
	check('200', up.status === 200, upBody);
	if (up.status !== 200) return;
	check('devolve URL', typeof upBody.url === 'string', upBody.url);
	check(
		'devolve a paleta do logo (vermelho na frente)',
		upBody.palette?.[0]?.hex === '#e11d1d',
		upBody.palette,
	);
	check(
		'o branco do fundo NÃO virou cor da marca',
		!upBody.palette?.some((c) => c.hex === '#ffffff'),
		upBody.palette,
	);

	console.log('\nCadastro da marca:');
	const data = {
		nome: 'LASER ART',
		publico: 'Noivas que querem lembrancinha de casamento, 25 a 40 anos.',
		tom_de_voz: 'Rústico e artesanal',
		logo_url: upBody.url,
		cor_primaria: upBody.palette?.[0]?.hex ?? '#E11D1D',
		cor_secundaria: '#1D3FE1',
		cor_fundo: '#FFFFFF',
		fonte: 'Montserrat — sem serifa, grossa, tudo em maiúscula',
		exemplo_url: upBody.url,
		nao_usar: 'nada de fundo escuro, nada de fonte manuscrita, sem emoji',
	};
	const cria = await fetch(`${BASE}/api/tools/${TOOL}/c/${COL}`, {
		method: 'POST',
		headers: { ...headers, 'content-type': 'application/json' },
		body: JSON.stringify({ title: '[SMOKE] Laser Art Marcenaria', data }),
	});
	const criado = (await cria.json()) as { id?: string; message?: string };
	check('201', cria.status === 201, criado);
	if (!criado.id) return;

	console.log('\nNo banco:');
	const { data: linha, error } = await supabase
		.from('pl_tool_bank_entry')
		.select('*')
		.eq('id', criado.id)
		.single();
	if (error) throw new Error(error.message);
	const row = linha as unknown as {
		visibility: string;
		owner_id: string;
		status: string;
		data: Record<string, unknown>;
	};

	check('visibility = owner', row.visibility === 'owner', row.visibility);
	check('owner_id = o aluno', row.owner_id === ALUNO, row.owner_id);
	check(
		'status = approved (sem moderação)',
		row.status === 'approved',
		row.status,
	);

	const esperados = Object.keys(data).sort();
	const gravados = Object.keys(row.data).sort();
	check(
		'os 10 campos entraram (nenhum descartado em silêncio)',
		JSON.stringify(esperados) === JSON.stringify(gravados),
		{ faltando: esperados.filter((k) => !gravados.includes(k)) },
	);
	for (const [k, v] of Object.entries(data)) {
		check(`  ${k} intacto`, row.data[k] === v, {
			esperado: v,
			gravado: row.data[k],
		});
	}

	console.log('\nLeitura por OUTRA tool (o caminho do `collection.query`):');
	const lista = await fetch(
		`${BASE}/api/tools/${TOOL}/c/${COL}?sort=recent&page_size=1`,
		{ headers },
	);
	const listado = (await lista.json()) as {
		items?: { id: string; data: Record<string, unknown> }[];
	};
	check(
		'a mais recente é a que acabou de ser criada',
		listado.items?.[0]?.id === criado.id,
		listado.items?.[0]?.id,
	);
	check(
		'o registro volta com os campos (e não só o envelope)',
		listado.items?.[0]?.data?.nome === 'LASER ART',
		listado.items?.[0]?.data,
	);

	console.log('\nOutro aluno NÃO enxerga esta marca:');
	/**
	 * Pelo REPOSITÓRIO, e não por HTTP, por um motivo: a tool está em draft, e um
	 * aluno fora da allowlist de preview levaria 404 ao carregar a definition —
	 * o 404 esconderia justamente o que se quer provar, que é o filtro de
	 * visibilidade da LISTAGEM. Aqui a pergunta é feita direto a quem responde.
	 */
	const comoOutro = await repo.list(
		TOOL,
		COL,
		{ fields: [] },
		{
			viewer: {
				customerId: '00000000-0000-4000-8000-000000000000',
				isStaff: false,
			},
			pageSize: 100,
		},
	);
	check(
		'a marca do aluno não aparece para outro aluno',
		!comoOutro.items.some((e) => e.id === criado.id),
		comoOutro.items.map((e) => e.id),
	);

	await supabase.from('pl_tool_bank_entry').delete().eq('id', criado.id);
	console.log('\n(registro de teste apagado)');
}

main()
	.then(() => {
		console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
		process.exit(falhas ? 1 : 0);
	})
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
