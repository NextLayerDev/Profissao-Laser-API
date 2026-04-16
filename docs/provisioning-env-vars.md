# Variaveis de Ambiente - Sistema de Provisionamento

## Variaveis novas no Master API (.env)

Adicionar ao `.env` da API principal:

```env
# Supabase Management API
SUPABASE_MANAGEMENT_PAT=         # Personal Access Token do dono da conta Supabase
                                  # Gerar em: https://supabase.com/dashboard/account/tokens

# Vercel API
VERCEL_ACCESS_TOKEN=              # Token da API Vercel
                                  # Gerar em: https://vercel.com/account/tokens
VERCEL_TEAM_ID=                   # ID do team/org na Vercel
VERCEL_GITHUB_REPO=               # Repositorio GitHub fixo, formato "org/repo"

# Criptografia de credenciais dos tenants
TENANT_ENCRYPTION_KEY=            # Chave AES-256 em hex (64 caracteres)
                                  # Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Token para endpoints internos
API_SECRET_TOKEN=                 # Token compartilhado para autenticar chamadas internas
                                  # Ex: nextlayerkey28230105@services321123-01

# Mercado Livre OAuth (proxy central)
TENANT_MERCADOLIVRE_APP_ID=            # client_id do app ML (DevCenter)
TENANT_MERCADOLIVRE_APP_SECRET=        # client_secret do app ML
TENANT_MERCADOLIVRE_OAUTH_CENTRAL_URL= # URL publica desta API (ex: https://api.profissaolaser.com)
                                       # usada como redirect_uri fixo pelo ML
```

## Variaveis injetadas em cada projeto Vercel (tenant)

### Fixas (mesmos valores para todos os tenants)

```env
SESSION_SECRET=nextlayercorplaserOnetop123profissao
API_SECRET_TOKEN=nextlayerkey28230105@services321123-01
JWT_SECRET=nextLayerNetComPorteiraTOP123333
VECTORIZER_AI_API_KEY_ID=vk93cqz9wmfv5dg
VECTORIZER_AI_API_SECRET_KEY=cm7c00lcnupav1g3r49huf7560blbmimgfobmrnhjp5lpvfocjsi
SPARTICUZ_CHROMIUM_VERSION=119
OPENROUTER_API_KEY=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
CRON_SECRET_KEY=NextLayerTop1Devs
ZAPI_CLIENT_TOKEN=F323220fc93044ee2aac8152882afe23fS
ZAPI_INSTANCE_ID=
ZAPI_INSTANCE_TOKEN=
ZAPI_SECURITY_TOKEN=
NEXT_PUBLIC_SOCKET_URL=https://ws.nextlayer.dev
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=nextlayerdev@gmail.com
SMTP_PASS=hpwh vyzn jgye pliq
MERCADOLIVRE_APP_ID=
MERCADOLIVRE_APP_SECRET=
MERCADOLIVRE_OAUTH_CENTRAL_URL=
```

### Dinamicas (geradas no provisionamento)

```env
NEXT_PUBLIC_COMPANY_SYSTEM=       # Nome original da empresa (nao normalizado)
DATABASE_URL=                     # postgresql://postgres.{ref}:{dbPass}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=                       # postgresql://postgres.{ref}:{dbPass}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
NEXT_PUBLIC_SUPABASE_URL=         # https://{ref}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Chave anon do projeto Supabase do tenant
SUPABASE_SERVICE_ROLE_KEY=        # Service role key do projeto Supabase do tenant
BLOB_READ_WRITE_TOKEN=            # Token do Vercel Blob Store
```

### Condicionais (apenas plano PLATINA)

```env
N8N_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMDQ2ODNhYy0yOGYyLTRiNzEtYWJiMi1iZTAwOWU3ZDExOTQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzYxNzkwMzUwfQ.OZKT-rnxUzcqmrFRz5Yk2DFxLIbdlR0J769MrOMf0Q8
N8N_BASE_URL=https://n8n_metalaser-n8n-editor.1nwz76.easypanel.host/
```
