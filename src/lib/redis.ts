import Redis from 'ioredis';

export interface Cache {
	cacheAside<T>(
		key: string,
		ttlSeconds: number,
		fetchFn: () => Promise<T>,
	): Promise<T>;
}

// Subconjunto do ioredis usado pelo Cache (facilita testar com fake).
export interface RedisLike {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
}

// no-op: usado quando não há REDIS_URL. Sempre chama o fetchFn.
const noopCache: Cache = {
	async cacheAside(_key, _ttl, fetchFn) {
		return fetchFn();
	},
};

export function makeCache(client: RedisLike): Cache {
	return {
		async cacheAside(key, ttlSeconds, fetchFn) {
			try {
				const hit = await client.get(key);
				// unsafe: sem validação de schema no hit (JSON.parse → any).
				if (hit !== null)
					return JSON.parse(hit) as Awaited<ReturnType<typeof fetchFn>>;
			} catch {
				return fetchFn(); // fail-open
			}
			const value = await fetchFn();
			try {
				await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
			} catch {
				// fail-open: valor já obtido
			}
			return value;
		},
	};
}

// Cliente cru compartilhado (reusado pelo `cache` e pelo `incrWithTtl`).
let sharedClient: Redis | null = null;

function build(): Cache {
	const url = process.env.REDIS_URL;
	if (!url) return noopCache;
	// Conexão eager + fail-fast: conecta já no load do módulo (que roda antes do
	// server.listen) pra estar `ready` quando chega a 1ª request. Com lazyConnect
	// a conexão só iniciava no 1º comando — e como enableOfflineQueue:false REJEITA
	// o comando na hora (em vez de enfileirar até conectar), o cacheAside caía no
	// fail-open e NUNCA gravava na 1ª request após cada (re)start. Os dois flags
	// abaixo mantêm o fail-fast quando o Redis está fora — casando com o fail-open
	// do cacheAside, que então cai no fetchFn.
	const client = new Redis(url, {
		maxRetriesPerRequest: 1,
		enableOfflineQueue: false,
	});
	sharedClient = client;
	// host:porta pro log (sem expor a senha da URL).
	const target = `${client.options.host}:${client.options.port}`;
	client.on('connect', () => console.log(`[redis] conectando em ${target}…`));
	client.on('ready', () => console.log(`[redis] pronto (${target})`));
	client.on('error', (err) => {
		// fail-open: cada chamada já trata; só logamos pra ter visibilidade.
		console.error(`[redis] erro de conexão (${target}):`, err.message);
	});
	return makeCache(client as unknown as RedisLike);
}

export const cache: Cache = build();

/**
 * INCR + EXPIRE (na 1ª vez) pra contadores com janela — ex.: teto de turnos por
 * sessão do agente. Fail-open: sem Redis ou erro, devolve -1 (= "sem teto",
 * não bloqueia). Reusa a conexão do `cache`.
 */
export async function incrWithTtl(
	key: string,
	ttlSeconds: number,
): Promise<number> {
	if (!sharedClient) return -1;
	try {
		const n = await sharedClient.incr(key);
		if (n === 1) await sharedClient.expire(key, ttlSeconds);
		return n;
	} catch {
		return -1; // fail-open
	}
}
