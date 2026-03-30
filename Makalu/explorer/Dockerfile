# ============================================================================
# Lithosphere Block Explorer - Production Dockerfile
# Two-stage build for Next.js application
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1: Build
# ----------------------------------------------------------------------------
FROM node:20-alpine AS builder

RUN apk update && apk upgrade --no-cache

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install dependencies first (layer cache)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source
COPY . .

# Accept build-time env vars for Next.js public config
ARG NEXT_PUBLIC_RPC_URL=http://localhost:8545
ARG NEXT_PUBLIC_CHAIN_ID=700777
ARG NEXT_PUBLIC_CHAIN_NAME=Litho Devnet

ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL
ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID
ENV NEXT_PUBLIC_CHAIN_NAME=$NEXT_PUBLIC_CHAIN_NAME

RUN pnpm run build

# ----------------------------------------------------------------------------
# Stage 2: Production Runner
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runner

RUN apk update && apk upgrade --no-cache && apk add --no-cache wget

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 lithosphere

WORKDIR /app

# Copy Next.js standalone output
COPY --from=builder --chown=lithosphere:nodejs /app/public ./public
COPY --from=builder --chown=lithosphere:nodejs /app/.next/standalone ./
COPY --from=builder --chown=lithosphere:nodejs /app/.next/static ./.next/static

USER lithosphere

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q --spider http://localhost:3000 || exit 1

CMD ["node", "server.js"]
