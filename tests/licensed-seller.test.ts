import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O PORTÃO DO VENDEDOR.
 *
 * O que estes testes prendem é a REGRA DO REACEITE. O termo diz "informei todos
 * os meus canais" — uma frase que só significa alguma coisa junto da lista a que
 * ela se referia. Se mexer na lista não vencesse a declaração, o registro
 * passaria a afirmar sobre um conjunto que não existe mais, e é justamente esse
 * registro que se leva para o licenciante.
 *
 * O outro lado importa igual: churn que NÃO muda onde a pessoa vende (ordem,
 * barra final, recadastrar o mesmo endereço) não pode pedir clique — portão que
 * incomoda à toa é portão que alguém desliga.
 */

type Linha = Record<string, unknown>;
const tabelas: Record<string, Linha[]> = {
	pl_licensed_seller_channel: [],
	pl_licensed_seller_term: [],
	pl_licensed_art: [],
};
let seq = 0;

/** Dublê do construtor de consulta do supabase: filtros em memória, thenable. */
function consulta(tabela: string) {
	const filtros: ((l: Linha) => boolean)[] = [];
	let inseridas: Linha[] | null = null;
	let patch: Linha | null = null;
	let ordenar: { col: string; asc: boolean } | null = null;
	let teto: number | null = null;
	let unica = false;

	const aplicar = () => {
		let linhas = tabelas[tabela].filter((l) => filtros.every((f) => f(l)));
		if (ordenar) {
			const { col, asc } = ordenar;
			linhas = [...linhas].sort((a, b) =>
				String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : asc ? 1 : -1,
			);
		}
		if (teto !== null) linhas = linhas.slice(0, teto);
		return linhas;
	};

	const q: Record<string, unknown> = {
		select: () => q,
		insert: (linhas: Linha | Linha[]) => {
			inseridas = Array.isArray(linhas) ? linhas : [linhas];
			return q;
		},
		update: (p: Linha) => {
			patch = p;
			return q;
		},
		eq: (col: string, val: unknown) => {
			filtros.push((l) => l[col] === val);
			return q;
		},
		is: (col: string, val: unknown) => {
			filtros.push((l) => (l[col] ?? null) === val);
			return q;
		},
		in: (col: string, vals: unknown[]) => {
			filtros.push((l) => vals.includes(l[col]));
			return q;
		},
		order: (col: string, opts?: { ascending?: boolean }) => {
			ordenar = { col, asc: opts?.ascending !== false };
			return q;
		},
		limit: (n: number) => {
			teto = n;
			return q;
		},
		single: () => {
			unica = true;
			return q;
		},
		// biome-ignore lint/suspicious/noThenProperty: dublê de um objeto thenable
		then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
			if (inseridas) {
				const novas = inseridas.map((l) => ({
					id: `id-${++seq}`,
					created_at: `2026-08-19T00:00:${String(seq).padStart(2, '0')}Z`,
					accepted_at: `2026-08-19T00:00:${String(seq).padStart(2, '0')}Z`,
					removed_at: null,
					...l,
				}));
				tabelas[tabela].push(...novas);
				return Promise.resolve({
					data: unica ? novas[0] : novas,
					error: null,
				}).then(ok, falha);
			}
			if (patch) {
				const alvo = aplicar();
				for (const l of alvo) Object.assign(l, patch);
				return Promise.resolve({ data: alvo, error: null }).then(ok, falha);
			}
			const linhas = aplicar();
			return Promise.resolve({
				data: unica ? (linhas[0] ?? null) : linhas,
				error: null,
			}).then(ok, falha);
		},
	};
	return q;
}

vi.mock('@/lib/supabase.js', () => ({
	supabase: { from: (t: string) => consulta(t) },
}));

const {
	adicionarCanal,
	declaracaoEmDia,
	listarCanais,
	listarVendedores,
	registrarAceite,
	removerCanal,
} = await import('@/repositories/licensed-seller.js');
const { TERMO_VERSAO } = await import('@/lib/licensed-terms.js');

const ALUNO = 'aluno-1';

beforeEach(() => {
	for (const t of Object.keys(tabelas)) tabelas[t].length = 0;
	seq = 0;
});

describe('a lista de canais', () => {
	it('quem nunca cadastrou nada está SEM CANAL', async () => {
		const d = await declaracaoEmDia(ALUNO);
		expect(d.ok).toBe(false);
		expect(d.status).toBe('sem_canal');
	});

	it('cadastrar não basta: sem aceite, o termo fica pendente', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://loja.com.br' });
		const d = await declaracaoEmDia(ALUNO);
		expect(d.ok).toBe(false);
		expect(d.status).toBe('termo_pendente');
	});

	it('remover tira da lista mas NÃO apaga a linha', async () => {
		const c = await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		expect(await removerCanal(c.id, ALUNO)).toBe(true);

		expect(await listarCanais(ALUNO)).toHaveLength(0);
		// A linha continua lá: um aceite antigo aponta para ela.
		expect(tabelas.pl_licensed_seller_channel).toHaveLength(1);
	});

	it('não dá para remover canal de outra pessoa', async () => {
		const c = await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		expect(await removerCanal(c.id, 'outro-aluno')).toBe(false);
		expect(await listarCanais(ALUNO)).toHaveLength(1);
	});
});

describe('o aceite', () => {
	it('com canal e aceite, a declaração fica em dia', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://loja.com.br' });
		await registrarAceite({ customerId: ALUNO });

		const d = await declaracaoEmDia(ALUNO);
		expect(d.ok).toBe(true);
		expect(d.status).toBe('ok');
		expect(d.aceite?.terms_version).toBe(TERMO_VERSAO);
	});

	it('guarda o RETRATO da lista, não só a data', async () => {
		await adicionarCanal({
			customerId: ALUNO,
			url: 'https://loja.com.br',
			label: 'Minha loja',
		});
		const aceite = await registrarAceite({ customerId: ALUNO });

		// É este retrato que responde "o que ele declarou, exatamente?".
		expect(aceite.channels_snapshot).toEqual([
			{ url: 'https://loja.com.br', label: 'Minha loja' },
		]);
	});

	it('sem canal nenhum, aceitar é recusado', async () => {
		await expect(registrarAceite({ customerId: ALUNO })).rejects.toThrow(
			/nenhum canal/,
		);
	});

	it('cada aceite é uma LINHA NOVA — o histórico não é sobrescrito', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await registrarAceite({ customerId: ALUNO });
		await adicionarCanal({ customerId: ALUNO, url: 'https://b.com' });
		await registrarAceite({ customerId: ALUNO });

		expect(tabelas.pl_licensed_seller_term).toHaveLength(2);
	});
});

describe('mexer na lista vence a declaração', () => {
	/**
	 * O TESTE QUE MAIS IMPORTA DESTE ARQUIVO.
	 *
	 * Sem isto, o registro passaria a afirmar "informei todos os meus canais"
	 * sobre um conjunto que não existe mais — e é esse registro que se leva ao
	 * licenciante.
	 */
	it('ADICIONAR uma loja depois do aceite pede reaceite', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await registrarAceite({ customerId: ALUNO });
		expect((await declaracaoEmDia(ALUNO)).ok).toBe(true);

		await adicionarCanal({ customerId: ALUNO, url: 'https://b.com' });

		const d = await declaracaoEmDia(ALUNO);
		expect(d.ok).toBe(false);
		expect(d.status).toBe('lista_mudou');
	});

	it('REMOVER uma loja depois do aceite também pede reaceite', async () => {
		const a = await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await adicionarCanal({ customerId: ALUNO, url: 'https://b.com' });
		await registrarAceite({ customerId: ALUNO });

		await removerCanal(a.id, ALUNO);

		expect((await declaracaoEmDia(ALUNO)).status).toBe('lista_mudou');
	});

	it('aceitar de novo põe a declaração em dia', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await registrarAceite({ customerId: ALUNO });
		await adicionarCanal({ customerId: ALUNO, url: 'https://b.com' });
		await registrarAceite({ customerId: ALUNO });

		expect((await declaracaoEmDia(ALUNO)).ok).toBe(true);
	});

	it('barra final e maiúscula NÃO vencem a declaração', async () => {
		// Churn que não muda onde a pessoa vende não pode pedir clique: portão
		// que incomoda à toa é portão que alguém desliga.
		const c = await adicionarCanal({
			customerId: ALUNO,
			url: 'https://Loja.com.br/',
		});
		await registrarAceite({ customerId: ALUNO });

		await removerCanal(c.id, ALUNO);
		await adicionarCanal({ customerId: ALUNO, url: 'https://loja.com.br' });

		expect((await declaracaoEmDia(ALUNO)).ok).toBe(true);
	});

	it('trocar de loja mantendo a QUANTIDADE ainda vence', async () => {
		const a = await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await registrarAceite({ customerId: ALUNO });

		await removerCanal(a.id, ALUNO);
		await adicionarCanal({ customerId: ALUNO, url: 'https://outra.com' });

		expect((await declaracaoEmDia(ALUNO)).status).toBe('lista_mudou');
	});

	it('redação nova do termo vence o aceite de todo mundo', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await registrarAceite({ customerId: ALUNO });
		// Simula o texto tendo sido revisado depois do aceite.
		tabelas.pl_licensed_seller_term[0].terms_version = '2020-01-01';

		expect((await declaracaoEmDia(ALUNO)).status).toBe('termo_mudou');
	});
});

describe('o relatório de staff', () => {
	it('sem filtro, lista todo mundo que declarou', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await adicionarCanal({ customerId: 'aluno-2', url: 'https://b.com' });

		const linhas = await listarVendedores();
		expect(linhas.map((l) => l.customerId).sort()).toEqual([
			'aluno-1',
			'aluno-2',
		]);
	});

	it('com marca, só quem GEROU peça daquela marca', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await adicionarCanal({ customerId: 'aluno-2', url: 'https://b.com' });
		tabelas.pl_licensed_art.push({
			customer_id: ALUNO,
			feature_key: 'clube:corinthians',
		});

		const linhas = await listarVendedores('clube:corinthians');
		expect(linhas).toHaveLength(1);
		expect(linhas[0].customerId).toBe(ALUNO);
	});

	it('marca sem nenhuma peça devolve lista vazia, não a casa inteira', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		expect(await listarVendedores('clube:ninguem')).toEqual([]);
	});

	it('diz quem está em dia e quem não está', async () => {
		await adicionarCanal({ customerId: ALUNO, url: 'https://a.com' });
		await registrarAceite({ customerId: ALUNO });
		await adicionarCanal({ customerId: 'aluno-2', url: 'https://b.com' });

		const linhas = await listarVendedores();
		const porId = new Map(linhas.map((l) => [l.customerId, l]));
		expect(porId.get(ALUNO)?.emDia).toBe(true);
		expect(porId.get('aluno-2')?.emDia).toBe(false);
	});
});
