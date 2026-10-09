# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# Stage 1 : deps
# ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# 1. Essai npm ci (reproductible, rapide) si lockfile en cohérence
# 2. Fallback npm install --legacy-peer-deps si lock désynchronisé
#    (utile après upgrades majeures Next/eslint avec peer deps)
RUN if [ -f package-lock.json ]; then \
      echo "Trying npm ci (reproducible)"; \
      npm ci --omit=optional --legacy-peer-deps 2>/dev/null \
        || (echo "→ npm ci failed (lock out of sync), falling back to npm install"; \
            npm install --omit=optional --legacy-peer-deps --no-audit --no-fund); \
    else \
      echo "No lockfile found, using npm install (bootstrap)"; \
      npm install --omit=optional --legacy-peer-deps --no-audit --no-fund; \
    fi

# ─────────────────────────────────────────────────────────────────────
# Stage 2 : build
# ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─────────────────────────────────────────────────────────────────────
# Stage 3 : runtime (image minimale)
# ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache curl

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
