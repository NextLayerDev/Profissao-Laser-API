# Configuração de Deploy

## Nginx - Upload de Vídeos Grandes

O arquivo `nginx-upload.conf` contém as diretivas necessárias para permitir uploads de vídeos grandes através do proxy reverso (Nginx) usado pelo Easypanel.

### Como aplicar no Easypanel

1. Acesse o painel do Easypanel
2. Localize o serviço do backend (`profissao-laser-back`)
3. Procure a opção de **configuração customizada do proxy/Nginx**
4. Adicione o conteúdo de `nginx-upload.conf` ou inclua o arquivo em `/data/nginx/user_conf.d/` no servidor

### Diretivas explicadas

| Diretiva | Valor | Descrição |
|----------|-------|-----------|
| `client_max_body_size` | 1024M | Tamanho máximo do body da requisição (padrão Nginx ~1MB) |
| `client_body_timeout` | 1800s | Tempo para receber o body completo |
| `proxy_connect_timeout` | 1800s | Tempo para conectar ao backend |
| `proxy_send_timeout` | 1800s | Tempo para enviar dados ao backend |
| `proxy_read_timeout` | 1800s | Tempo para ler resposta do backend |
| `send_timeout` | 1800s | Tempo para enviar resposta ao cliente |

---

## Upload direto (presigned URL) - Vídeos grandes

Para vídeos muito grandes, use o fluxo de upload direto ao Supabase, que evita passar o arquivo pela API:

1. **POST** `/lesson/:id/video/presigned-url` (body opcional: `{ "filename": "video.mp4" }`) → retorna `{ path, token, bucket }`
2. Frontend: `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)`
3. **PATCH** `/lesson/:id/video/confirm` (body: `{ "path": "<path retornado no passo 1>" }`) → atualiza a aula com a URL do vídeo
