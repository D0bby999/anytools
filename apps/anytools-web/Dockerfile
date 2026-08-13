# Multi-stage Next.js 15 + pnpm workspace Dockerfile for Hetzner / Coolify.
# Produces ~150MB image. Persistent /data volume for SQLite (better-auth).

# ---- Base ----
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app

# Copy workspace manifests only — maximizes Docker layer cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/anytools-web/package.json apps/anytools-web/
COPY packages/ui/package.json packages/ui/
COPY packages/anytools-tools/package.json packages/anytools-tools/
COPY packages/anytools-i18n/package.json packages/anytools-i18n/
COPY packages/anytools-analytics/package.json packages/anytools-analytics/
COPY packages/config/package.json packages/config/
COPY packages/db-shared/package.json packages/db-shared/
COPY packages/postclaw-blog-endpoint/package.json packages/postclaw-blog-endpoint/

RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/anytools-web/node_modules ./apps/anytools-web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# NEXT_PUBLIC_* are inlined into the client bundle at build time, so they must be present
# during `next build` (client components can't read them at runtime). Public values only —
# no secrets — passed as --build-arg from CI. Runtime secrets (DATABASE_URL, BETTER_AUTH_SECRET,
# …) stay as runtime env injected by Coolify, never baked into the image.
ARG NEXT_PUBLIC_URL
ARG NEXT_PUBLIC_UMAMI_SRC
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ENV NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL
ENV NEXT_PUBLIC_UMAMI_SRC=$NEXT_PUBLIC_UMAMI_SRC
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID

RUN pnpm --filter @anytools/web build

# ---- Runtime ----
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Persist Better Auth SQLite DB across container restarts.
# Coolify: mount a volume to /data.
ENV AUTH_DB_PATH=/data/auth.db
# Absolute path so content loads regardless of process.cwd() at runtime.
ENV CONTENT_ROOT=/app/apps/anytools-web/content
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Standalone output already inlines workspace deps + minimal node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/anytools-web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/anytools-web/.next/static ./apps/anytools-web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/anytools-web/public ./apps/anytools-web/public

# Content MDX files are read at request time via fs.readFile — must include
COPY --chown=nextjs:nodejs apps/anytools-web/content ./apps/anytools-web/content

# Persistent volume for SQLite
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000

CMD ["node", "apps/anytools-web/server.js"]
