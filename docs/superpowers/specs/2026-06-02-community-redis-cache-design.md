# Cache Redis nas rotas pesadas da Community — Design

**Data:** 2026-06-02
**Repo:** Profissao-Laser-API
**Status:** Aprovado (design), pendente implementação

## Problema

As rotas de leitura mais pesadas do módulo **community** batem no Postgres a cada
request, com queries caras:

- `getStats` → 4× `COUNT(*) exact` (varredura completa de Customers, projects, messages, events).
- `getRanking(period)` → lê **todas** as linhas de `pl_community_post`, `pl_community_message` e
  `pl_community_project` (full scan de authorId/authorName) e agrega em JS.
- `listMembers`, `listActivity` → listagens.
- `listProjects` / `getProject` (a "vitrine") → query + `getAuthorAvatars` + overlay de likes.

São endpoints abertos com muito tráfego. Sem cache, cada acesso repete o trabalho.

## Estratégia

**Cache-aside com TTL curto, sem invalidação manual.** A community muda o tempo todo
(likes, comentários, posts). Invalidar em cada mutação seria invasivo e frágil. Um TTL
curto (30–120s por endpoint) corta a carga pesada e limita o staleness a poucos segundos —
aceitável para feed/ranking/stats. Difere da abordagem da upvox-api (invalidação imediata),
porque lá o catálogo muda raramente e precisa estar fresco; aqui não.

## Decisões

- **Lib:** `ioredis`, cliente **fail-open** (se o Redis cair, cai no Postgres). Mesmo desenho
  validado na upvox-api.
- **Sem awilix** (este repo não usa DI): o cliente é um **singleton exportado** de
  `src/lib/redis.ts`, espelhando `src/lib/supabase.ts`. Services importam `cache` direto.
- **Env:** `process.env.REDIS_URL` (lido direto, sem schema zod). Se ausente → cache no-op.
- **Prefixo de chaves:** `community:` (isola no Redis; permite reuso da mesma instância).
- **Personalização:** projetos têm `liked` por usuário → cacheia a **base** (sem like) e
  aplica o like **por request**.

## Arquitetura

### 1. Cliente Redis — `src/lib/redis.ts` (novo)

Interface `Cache` (igual à da upvox-api):

- `cacheAside<T>(key, ttlSeconds, fetchFn): Promise<T>` — get; em miss chama `fetchFn`,
  faz `set` com `EX ttl`, retorna. Erro de Redis → chama `fetchFn` direto (fail-open).
- (opcional, p/ futuro) `invalidate`, `invalidatePrefix` — incluídos por paridade, mas
  não usados nesta rodada.

`getCache()`/`cache` singleton: usa `process.env.REDIS_URL`; se ausente, retorna um
no-op (sempre chama o `fetchFn`). Erros de conexão silenciados (`client.on('error')`).
Serialização via `JSON.stringify`/`JSON.parse`.

Import nos services: `import { cache } from '@/lib/redis.js';` (extensão `.js`, padrão do repo).

### 2. Refatoração do repository — `src/repositories/community.ts`

Separar "base cacheável" do overlay de likes:

- **`listProjectsBase(page, limit, filters)`** — corpo atual de `listProjects` **sem** o
  parâmetro `currentCustomerId` (likedSet vazio → todos `liked: false`). Mantém a query +
  `getAuthorAvatars` (as partes caras).
- **`getProjectBase(id)`** — corpo atual de `getProject` sem `currentCustomerId`
  (inclui `commentList`).
- Tornar **`getLikedProjectIds(projectIds, customerId)` público** (hoje é `private`) para o
  service aplicar o overlay.
- `listProjects`/`getProject` antigos podem ser removidos ou manter como finos que chamam
  base + overlay (o service fará a composição; ver §3).

### 3. Caching nos services — `src/services/community.ts`

TTLs (constantes no topo do arquivo):

| Endpoint (service) | Chave | TTL |
|---|---|---|
| `getStats` | `community:stats` | 60s |
| `getRanking(period)` | `community:ranking:${period ?? 'all'}` | 120s |
| `listMembers(...)` | `community:members:${JSON.stringify(params)}` | 60s |
| `listActivity(page,limit)` | `community:activity:${page}:${limit}` | 30s |
| `listProjects(filters,page,limit)` | `community:projects:${JSON.stringify({page,limit,filters})}` | 60s |
| `getProject(id)` | `community:project:${id}` | 60s |

Padrão para não-personalizados (stats/ranking/members/activity):
```ts
async getStats() {
  return withCapture(() =>
    cache.cacheAside('community:stats', STATS_TTL, () =>
      communityRepository.getStats(),
    ),
  );
}
```

Padrão para projetos (base cacheada + like por request):
```ts
async listProjects(page, limit, filters, currentCustomerId) {
  return withCapture(async () => {
    const base = await cache.cacheAside(
      `community:projects:${JSON.stringify({ page, limit, filters })}`,
      PROJECTS_TTL,
      () => communityRepository.listProjectsBase(page, limit, filters),
    );
    if (!currentCustomerId) return base;
    const liked = await communityRepository.getLikedProjectIds(
      base.map((p) => p.id),
      currentCustomerId,
    );
    return base.map((p) => ({ ...p, liked: liked.has(p.id) }));
  });
}

async getProject(id, currentCustomerId) {
  return withCapture(async () => {
    const base = await cache.cacheAside(
      `community:project:${id}`,
      PROJECTS_TTL,
      () => communityRepository.getProjectBase(id),
    );
    if (!base || !currentCustomerId) return base;
    const liked = await communityRepository.getLikedProjectIds([base.id], currentCustomerId);
    return { ...base, liked: liked.has(base.id) };
  });
}
```

Observação: `members.online` (presença em tempo real) entra na chave via `JSON.stringify`;
com TTL de 60s a presença pode ficar levemente defasada — aceitável. Se virar problema,
basta não cachear quando `online` for usado (decisão futura).

### 4. Fora de escopo (rodadas futuras)

- `listPosts` (feed) — personalizado (`currentUserId`) e muito dinâmico. Mesmo padrão
  base+overlay aplicável depois, se desejado.
- Chats (`channels/messages`, support-chat, doubt-chat) — **explicitamente não cachear**
  (decisão do usuário).
- Invalidação imediata — não nesta rodada (estratégia é TTL).

### 5. Testes — `tests/` (vitest, padrão leve do repo)

O repo inclui só `tests/**/*.test.ts`, com imports relativos e `vi.mock('../src/lib/xxx.js')`.
Seguir esse padrão:

- `tests/redis-cache.test.ts` — `makeCache` com um cliente ioredis fake: hit/miss popula,
  e fail-open (erro no `get` → chama `fetchFn`).
- `tests/community-projects-cache.test.ts` — `vi.mock('../src/lib/redis.js')` com fake em
  memória + `vi.mock('../src/repositories/community.js')`. Verifica:
  - `listProjects`: segundo call usa cache (base buscada 1×), e o overlay de `liked` é
    aplicado por `currentCustomerId` mesmo no hit.
  - `getStats`: segundo call não rebate no repo.

### 6. Env

Adicionar ao `.env` (e documentar): `REDIS_URL=...`. Pode reusar o mesmo Redis da upvox
(prefixo `community:` isola as chaves). Sem `REDIS_URL`, a API sobe normal e o cache vira no-op.

## Riscos / mitigações

- **Staleness até o TTL** — aceito por design para esses endpoints.
- **`liked` incorreto** — mitigado: o flag nunca é cacheado; é sempre recalculado por request.
- **Redis indisponível** — fail-open: cai no Postgres, nenhuma request quebra.
- **Chaves por filtro explodindo** — TTL curto faz expirar sozinho; sem invalidação a manter.
