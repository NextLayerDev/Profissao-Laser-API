# Cache Redis na Community — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cachear (cache-aside, TTL curto) as rotas de leitura mais pesadas da community — `getStats`, `getRanking`, `listMembers`, `listActivity` e a vitrine de projetos (`listProjects`/`getProject`) — sem acoplar a disponibilidade da API ao Redis.

**Architecture:** Um cliente Redis fail-open em `src/lib/redis.ts` (singleton exportado `cache`, no-op se `REDIS_URL` ausente) é importado pelos services. Os endpoints não-personalizados são envolvidos em `cache.cacheAside`. Para projetos, o repository ganha versões "base" (sem o flag de like por usuário) que são cacheadas, e o `liked` é reaplicado por request via `getLikedProjectIds`, mantendo a personalização correta.

**Tech Stack:** `ioredis`, Fastify 5, Supabase JS, Vitest, biome. ESM (`"type": "module"`), imports com extensão `.js`, alias `@/* → src/*`.

---

## Notas de contexto (lidas do código real)

- `src/services/community.ts` exporta um objeto literal `export const communityService = { ... }`. Importa `withCapture` de `@/lib/sentry.js` e `communityRepository` de `../repositories/community.js` (relativo).
- Methods alvo no service (assinaturas exatas):
  - `getStats()` → `communityRepository.getStats()`
  - `getRanking(period?)` → usa `communityRepository.getRanking(period)` e fatia em `{ top, rest }`.
  - `listMembers(search?, category?, featured?, online?, limit?, offset?)` → `communityRepository.listMembers(...)`
  - `listActivity(page, limit)` → `communityRepository.listActivity(page, limit)`
  - `listProjects(page, limit, filters?, currentCustomerId?)` → `communityRepository.listProjects(...)`
  - `getProject(id, currentCustomerId?)` → `communityRepository.getProject(...)`
- `src/repositories/community.ts`:
  - `listProjects(page, limit, filters?, currentCustomerId?)` faz: query em `pl_community_project` (range/filtros/sort) → `getAuthorAvatars` + `getLikedProjectIds` (Promise.all) → `mapProject(p, avatar, liked)`.
  - `getProject(id, currentCustomerId?)` faz: select do projeto + `listProjectComments(id,1,100)` → avatars + likedSet → retorna `{ ...mapProject(...), commentList }`.
  - `getLikedProjectIds(projectIds, customerId?)` é **`private`**; retorna `Set<string>`; vazio se `!customerId`.
  - `mapProject(...)` retorna um objeto com o campo booleano **`liked`** (entre outros: id, title, author, authorAvatar, img, description, material, technique, time, likes, comments).
- Testes ficam em `tests/**/*.test.ts` (vitest), imports relativos, padrão `vi.mock('../src/lib/xxx.js', ...)`. `npm test` = `vitest run`. `npm run lint` = `biome check --write .`.
- **Não há script de typecheck** (build é babel). Gates do repo: `npm test` + `npm run lint`. (Checagem de tipos opcional via `npx tsc --noEmit`, mas pode acusar erros pré-existentes — não é gate.)

## File Structure

- **Create** `src/lib/redis.ts` — `Cache` interface + `makeCache(client)` (fail-open) + singleton `cache` (no-op se sem `REDIS_URL`).
- **Create** `tests/redis-cache.test.ts` — testes de `makeCache` com cliente fake.
- **Create** `tests/community-cache.test.ts` — testes do overlay de likes e da delegação cacheada no service.
- **Modify** `vitest.config.ts` — adicionar alias `@/ → src/` (para os testes importarem o service).
- **Modify** `src/repositories/community.ts` — adicionar `listProjectsBase`, `getProjectBase`; tornar `getLikedProjectIds` público.
- **Modify** `src/services/community.ts` — importar `cache`; TTLs; envolver os 6 endpoints.
- **Modify** `.env` — adicionar `REDIS_URL`.
- **Modify** `package.json` — dependência `ioredis`.

---

### Task 1: Cliente Redis fail-open + env + alias de teste

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env`
- Modify: `vitest.config.ts`
- Create: `src/lib/redis.ts`
- Create: `tests/redis-cache.test.ts`

- [ ] **Step 1: Instalar ioredis**

Run: `npm install ioredis`
Expected: `ioredis` em `dependencies`.

- [ ] **Step 2: Adicionar REDIS_URL ao `.env`**

Acrescentar ao final de `.env`:
```
# Redis (cache da community). Opcional — se ausente, o cache vira no-op.
REDIS_URL=
```
(O usuário preenche o valor; pode reusar o mesmo Redis da upvox — o prefixo `community:` isola as chaves.)

- [ ] **Step 3: Adicionar alias `@/` ao vitest.config.ts**

Substituir o conteúdo de `vitest.config.ts` por:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
	},
});
```

- [ ] **Step 4: Escrever o teste do cache (falhando)**

Create `tests/redis-cache.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { makeCache } from '../src/lib/redis.js';

function fakeClient() {
	const store = new Map<string, string>();
	return {
		store,
		get: vi.fn(async (k: string) => store.get(k) ?? null),
		set: vi.fn(async (k: string, v: string) => {
			store.set(k, v);
			return 'OK';
		}),
	};
}

describe('makeCache', () => {
	it('miss chama fetchFn e popula; hit não chama fetchFn', async () => {
		const client = fakeClient();
		const cache = makeCache(client as never);
		const fetchFn = vi.fn(async () => ({ n: 1 }));

		const a = await cache.cacheAside('k', 60, fetchFn);
		const b = await cache.cacheAside('k', 60, fetchFn);

		expect(a).toEqual({ n: 1 });
		expect(b).toEqual({ n: 1 });
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('fail-open: erro no get cai no fetchFn', async () => {
		const client = fakeClient();
		client.get.mockRejectedValueOnce(new Error('redis down'));
		const cache = makeCache(client as never);
		const v = await cache.cacheAside('k', 60, async () => 42);
		expect(v).toBe(42);
	});

	it('fail-open: erro no set ainda retorna o valor', async () => {
		const client = fakeClient();
		client.set.mockRejectedValueOnce(new Error('down'));
		const cache = makeCache(client as never);
		const v = await cache.cacheAside('k2', 60, async () => 7);
		expect(v).toBe(7);
	});
});
```

- [ ] **Step 5: Rodar (deve falhar)**

Run: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npx vitest run tests/redis-cache.test.ts`
Expected: FAIL — `makeCache` não existe.

- [ ] **Step 6: Implementar `src/lib/redis.ts`**

Create `src/lib/redis.ts`:
```ts
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
	const client = new Redis(url, {
		lazyConnect: false,
		maxRetriesPerRequest: 1,
	});
	client.on('error', () => {
		// fail-open: silencia erros de conexão; cada chamada já trata
	});
	return makeCache(client as unknown as RedisLike);
}

export const cache: Cache = build();
```

- [ ] **Step 7: Rodar (deve passar)**

Run: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npx vitest run tests/redis-cache.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 8: Suite completa + lint**

Run: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npm test` → tudo verde (5 antigos + 3 novos).
Run: `npm run lint` → diff limpo.

---

### Task 2: Repository — base sem like + tornar getLikedProjectIds público

**Files:**
- Modify: `src/repositories/community.ts`

- [ ] **Step 1: Tornar `getLikedProjectIds` público**

Localizar `private async getLikedProjectIds(` e remover a palavra `private` (passa a `async getLikedProjectIds(`). Não mudar o corpo.

- [ ] **Step 2: Adicionar `listProjectsBase`**

Logo após o método `listProjects` existente, adicionar um método que reaproveita a base sem o overlay de like (chama `listProjects` sem `currentCustomerId`, devolvendo todos `liked: false`):
```ts
	/** Versão cacheável da lista (sem o flag de like por usuário). */
	async listProjectsBase(
		page: number,
		limit: number,
		filters?: {
			material?: string;
			technique?: string;
			search?: string;
			sort?: string;
		},
	) {
		return this.listProjects(page, limit, filters);
	}
```

- [ ] **Step 3: Adicionar `getProjectBase`**

Logo após `getProject`, adicionar:
```ts
	/** Versão cacheável do detalhe (sem o flag de like por usuário). */
	async getProjectBase(id: string) {
		return this.getProject(id);
	}
```

- [ ] **Step 4: Lint + suite (sem novos testes ainda)**

Run: `npm run lint` → limpo.
Run: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npm test` → continua verde (nada quebrou).

Nota: estas versões "base" delegam ao método existente passando `currentCustomerId` indefinido. Isso mantém a query cara (projeto + avatars + comentários) e zera o overlay — exatamente o que será cacheado. O service reaplica o `liked` por request (Task 3).

---

### Task 3: Service — caching dos 6 endpoints

**Files:**
- Modify: `src/services/community.ts`
- Create: `tests/community-cache.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Create `tests/community-cache.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';

// withCapture só executa a função; mockamos para evitar Sentry real.
vi.mock('@/lib/sentry.js', () => ({
	withCapture: (fn: () => unknown) => fn(),
}));

// Repository mockado (mesmo módulo que o service importa).
vi.mock('@/repositories/community.js', () => ({
	communityRepository: {
		getStats: vi.fn(),
		getRanking: vi.fn(),
		listMembers: vi.fn(),
		listActivity: vi.fn(),
		listProjectsBase: vi.fn(),
		getProjectBase: vi.fn(),
		getLikedProjectIds: vi.fn(),
	},
}));

import { communityRepository } from '@/repositories/community.js';
import { communityService } from '@/services/community.js';

describe('communityService caching (no-op cache em teste)', () => {
	it('getStats delega ao repository', async () => {
		vi.mocked(communityRepository.getStats).mockResolvedValue({
			activeMembers: 1,
			completedProjects: 2,
			messagesSent: 3,
			livesRealized: 4,
		} as never);

		const out = await communityService.getStats();

		expect(out).toMatchObject({ activeMembers: 1 });
		expect(communityRepository.getStats).toHaveBeenCalledTimes(1);
	});

	it('listProjects: usa a base cacheável e aplica liked por customer', async () => {
		vi.mocked(communityRepository.listProjectsBase).mockResolvedValue([
			{ id: 'a', liked: false },
			{ id: 'b', liked: false },
		] as never);
		vi.mocked(communityRepository.getLikedProjectIds).mockResolvedValue(
			new Set(['b']),
		);

		const out = (await communityService.listProjects(
			1,
			10,
			undefined,
			'cust-1',
		)) as Array<{ id: string; liked: boolean }>;

		expect(communityRepository.listProjectsBase).toHaveBeenCalledWith(
			1,
			10,
			undefined,
		);
		expect(communityRepository.getLikedProjectIds).toHaveBeenCalledWith(
			['a', 'b'],
			'cust-1',
		);
		expect(out.find((p) => p.id === 'a')?.liked).toBe(false);
		expect(out.find((p) => p.id === 'b')?.liked).toBe(true);
	});

	it('listProjects: sem customer retorna a base sem tocar likes', async () => {
		vi.mocked(communityRepository.listProjectsBase).mockResolvedValue([
			{ id: 'a', liked: false },
		] as never);

		const out = (await communityService.listProjects(1, 10)) as Array<{
			id: string;
			liked: boolean;
		}>;

		expect(out).toEqual([{ id: 'a', liked: false }]);
		expect(communityRepository.getLikedProjectIds).not.toHaveBeenCalled();
	});

	it('getProject: aplica liked no detalhe quando há customer', async () => {
		vi.mocked(communityRepository.getProjectBase).mockResolvedValue({
			id: 'a',
			liked: false,
			commentList: [],
		} as never);
		vi.mocked(communityRepository.getLikedProjectIds).mockResolvedValue(
			new Set(['a']),
		);

		const out = (await communityService.getProject('a', 'cust-1')) as {
			id: string;
			liked: boolean;
		};

		expect(out.liked).toBe(true);
	});
});
```

- [ ] **Step 2: Rodar (deve falhar)**

Run: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npx vitest run tests/community-cache.test.ts`
Expected: FAIL — `listProjects` ainda chama `listProjects` do repo (não `listProjectsBase`) e não aplica overlay; provavelmente erro de mock/asserção.

- [ ] **Step 3: Editar `src/services/community.ts`**

Adicionar import do cache (junto aos outros imports do topo):
```ts
import { cache } from '@/lib/redis.js';
```

Adicionar as constantes de TTL logo após os imports (antes de `export const communityService`):
```ts
const STATS_TTL = 60;
const RANKING_TTL = 120;
const MEMBERS_TTL = 60;
const ACTIVITY_TTL = 30;
const PROJECTS_TTL = 60;
```

Substituir `getStats`:
```ts
	async getStats() {
		return withCapture(() =>
			cache.cacheAside('community:stats', STATS_TTL, () =>
				communityRepository.getStats(),
			),
		);
	},
```

Substituir `getRanking` (mantém o fatiamento dentro do fetchFn, para cachear o resultado final):
```ts
	async getRanking(period?: string) {
		return withCapture(() =>
			cache.cacheAside(
				`community:ranking:${period ?? 'all'}`,
				RANKING_TTL,
				async () => {
					const ranked = await communityRepository.getRanking(period);
					return { top: ranked.slice(0, 3), rest: ranked.slice(3) };
				},
			),
		);
	},
```

Substituir `listMembers`:
```ts
	async listMembers(
		search?: string,
		category?: string,
		featured?: boolean,
		online?: boolean,
		limit?: number,
		offset?: number,
	) {
		const key = `community:members:${JSON.stringify({ search, category, featured, online, limit, offset })}`;
		return withCapture(() =>
			cache.cacheAside(key, MEMBERS_TTL, () =>
				communityRepository.listMembers(
					search,
					category,
					featured,
					online,
					limit,
					offset,
				),
			),
		);
	},
```

Substituir `listActivity`:
```ts
	async listActivity(page: number, limit: number) {
		return withCapture(() =>
			cache.cacheAside(
				`community:activity:${page}:${limit}`,
				ACTIVITY_TTL,
				() => communityRepository.listActivity(page, limit),
			),
		);
	},
```

Substituir `listProjects` (base cacheada + overlay):
```ts
	async listProjects(
		page: number,
		limit: number,
		filters?: {
			material?: string;
			technique?: string;
			search?: string;
			sort?: string;
		},
		currentCustomerId?: string,
	) {
		return withCapture(async () => {
			const base = (await cache.cacheAside(
				`community:projects:${JSON.stringify({ page, limit, filters })}`,
				PROJECTS_TTL,
				() => communityRepository.listProjectsBase(page, limit, filters),
			)) as Array<{ id: string; liked: boolean }>;
			if (!currentCustomerId) return base;
			const liked = await communityRepository.getLikedProjectIds(
				base.map((p) => p.id),
				currentCustomerId,
			);
			return base.map((p) => ({ ...p, liked: liked.has(p.id) }));
		});
	},
```

Substituir `getProject` (base cacheada + overlay):
```ts
	async getProject(id: string, currentCustomerId?: string) {
		return withCapture(async () => {
			const base = (await cache.cacheAside(
				`community:project:${id}`,
				PROJECTS_TTL,
				() => communityRepository.getProjectBase(id),
			)) as { id: string; liked: boolean } | null;
			if (!base || !currentCustomerId) return base;
			const liked = await communityRepository.getLikedProjectIds(
				[base.id],
				currentCustomerId,
			);
			return { ...base, liked: liked.has(base.id) };
		});
	},
```

- [ ] **Step 4: Rodar (deve passar)**

Run: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npx vitest run tests/community-cache.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: diff limpo.

---

### Task 4: Verificação final

- [ ] **Step 1: Suite completa**

Run: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH npm test`
Expected: tudo verde (5 antigos + 3 + 4 = 12).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: diff limpo.

- [ ] **Step 3: (Opcional) checagem de tipos**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: nenhum erro **novo** nos arquivos tocados (`src/lib/redis.ts`, `src/services/community.ts`, `src/repositories/community.ts`). Ignorar erros pré-existentes não relacionados.

- [ ] **Step 4: Smoke manual (opcional, com Redis)**

Com `REDIS_URL` setado e `npm run dev`: chamar `GET /community/stats` 2× e conferir no Redis que `community:stats` foi criada; chamar `GET /community/projects` autenticado e conferir que `liked` reflete o usuário mesmo no segundo (cache) hit.

---

## Self-review

- **Cobertura do spec:** cliente fail-open (T1) ✓; `REDIS_URL`/env (T1) ✓; singleton sem awilix (T1) ✓; alias de teste (T1) ✓; refactor repo base+overlay público (T2) ✓; caching dos 6 endpoints com TTLs (T3) ✓; projetos base cacheada + like por request (T3) ✓; testes em `tests/` padrão do repo (T1,T3) ✓; chats/feed fora de escopo (não há tasks — correto) ✓.
- **Placeholders:** nenhum — todo passo tem código/comando concreto.
- **Consistência:** `cache.cacheAside` (mesma assinatura) em redis.ts, redis-cache.test, e service. `listProjectsBase`/`getProjectBase`/`getLikedProjectIds` definidos em T2 e usados em T3 com os mesmos nomes. Campo `liked` (boolean) consistente com `mapProject`. TTLs constantes nomeadas.
- **Observação:** os testes do service usam `@/` nos `vi.mock` e imports; isso exige o alias adicionado em T1. O service importa o repo por caminho relativo, mas `@/repositories/community.js` resolve para o mesmo arquivo absoluto — vitest deduplica por caminho resolvido, então o mock intercepta.
