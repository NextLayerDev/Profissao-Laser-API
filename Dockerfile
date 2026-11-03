FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:22-alpine AS production

WORKDIR /app

# ffmpeg — o Ateliê monta vídeo de anúncio (Reels/Stories) a partir das artes que
# já gerou: movimento de câmera sobre a peça, texto entrando, o kit como cenas.
# Nada disso chama modelo — é composição local sobre imagem já paga.
#
# ┌─ POR QUE `apk` E NÃO UM PACOTE npm ─────────────────────────────────────┐
# │ `ffmpeg-static` e `@ffmpeg-installer/ffmpeg` embarcam binário compilado  │
# │ para glibc. A imagem base aqui é ALPINE, que usa musl: o binário instala │
# │ sem erro e falha ao EXECUTAR ("not found" por interpretador ausente) —   │
# │ uma quebra que só aparece em produção, nunca no macOS do dev.           │
# │                                                                          │
# │ Só na etapa de produção, de propósito: o builder não codifica vídeo, e   │
# │ ffmpeg no builder engordaria a camada sem servir a nada.                 │
# └─────────────────────────────────────────────────────────────────────────┘
# ┌─ E AS FONTES, PELA MESMA CLASSE DE ARMADILHA ───────────────────────────┐
# │ O texto do anúncio é desenhado por SVG dentro do sharp, e o sharp usa as │
# │ fontes DO SISTEMA. Um Alpine limpo tem ~ZERO fontes instaladas: sem      │
# │ `ttf-dejavu` o `<text>` não vira erro, vira NADA — o vídeo sai com o véu │
# │ escuro no rodapé e nenhuma letra dentro. Mesma quebra invisível do       │
# │ `ffmpeg-static`: só aparece em produção.                                 │
# │                                                                          │
# │ (O bloco ainda assim SONDA as fontes em tempo de execução e sai sem      │
# │ texto dizendo por quê — esta linha é para não precisar dessa saída.)     │
# └─────────────────────────────────────────────────────────────────────────┘
RUN apk add --no-cache ffmpeg ttf-dejavu

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3333

CMD ["node", "dist/server.js"]
