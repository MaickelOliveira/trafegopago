FROM node:24-alpine3.23 AS base

# Instala dependências
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=8192 npm run build

# Produção
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=America/Sao_Paulo
RUN apk add --no-cache postgresql18-client tzdata su-exec ffmpeg

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copia arquivos do build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/db ./db

# Script de inicialização
COPY --chown=nextjs:nodejs start.sh ./start.sh
RUN chmod +x ./start.sh
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 ./docker-entrypoint.sh && chown root:root ./docker-entrypoint.sh

# Pasta de dados (será montada como volume no EasyPanel)
RUN mkdir -p /app/data /app/private/backups && chown -R nextjs:nodejs /app/data /app/private

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
