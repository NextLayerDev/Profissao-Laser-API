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

function build(): Cache {
	const url = process.env.REDIS_URL;
	if (!url) return noopCache;
	// Conexão preguiçosa + fail-fast: não conecta no load do módulo, e comandos
	// falham rápido (sem fila offline) quando o Redis está fora — casando com o
	// fail-open do cacheAside, que então cai no fetchFn.
	const client = new Redis(url, {
		lazyConnect: true,
		maxRetriesPerRequest: 1,
		enableOfflineQueue: false,
	});
	client.on('error', () => {
		// fail-open: silencia erros de conexão; cada chamada já trata
	});
	return makeCache(client as unknown as RedisLike);
}

export const cache: Cache = build();
