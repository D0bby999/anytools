# Multi-stage Next.js 15 + pnpm workspace Dockerfile.
#
# Two runtime targets, one build:
#   - default (no --target) → stage `runner`   → deploy.yml, Hetzner/Coolify, persistent
#     /data volume for the better-auth SQLite DB.
#   - `--target selfhost`                       → release.yml, ghcr.io/d0bby999/anytools,
#     no volume, no AUTH_DB_PATH (better-auth never initializes when
#     NEXT_PUBLIC_SELF_HOSTED=1 — see src/lib/self-hosted.ts).
# `runner` MUST stay the last stage in this file (Docker's default target).

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
# Only two real values: unset (hosted, default) or "1" (self-host release build).
# Read at `next build` time because home + all locale/tool pages prerender via
# `setRequestLocale` — a runtime env var can't change HTML that's already rendered.
# See apps/anytools-web/src/lib/self-hosted.ts for the single source of truth every
# other file imports from.
ARG NEXT_PUBLIC_SELF_HOSTED
ENV NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL
ENV NEXT_PUBLIC_UMAMI_SRC=$NEXT_PUBLIC_UMAMI_SRC
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID
ENV NEXT_PUBLIC_SELF_HOSTED=$NEXT_PUBLIC_SELF_HOSTED

RUN pnpm --filter @anytools/web build

# ---- Runtime base ----
# Shared by both runtime stages below. Does NOT declare the /data volume — that is
# added only in `runner` (hosted), never here, because a VOLUME instruction can't be
# un-declared by a downstream stage (the image config is inherited). Splitting the
# stage *before* the VOLUME line is the only way to ship a volume-free variant.
FROM node:22-alpine AS runtime-base
WORKDIR /app

RUN apk add --no-cache libc6-compat \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
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

# LGPL-3.0 libheif-js (and other bundled licences) ship inside the image — the
# licence text and third-party notices must travel with the binary that uses them.
COPY --chown=nextjs:nodejs LICENSE THIRD-PARTY-NOTICES.md ./

# NOTE: USER/EXPOSE/CMD are declared per leaf stage below (not here), on purpose.
# `runner` still needs one root-only `RUN mkdir /data` after this point — `/` is
# root-owned (0755), so a non-root `nextjs` user can't create a top-level directory.
# Switching USER in this shared stage would break that RUN for `runner` while doing
# nothing useful for `selfhost` (which has no such RUN).

# ---- Self-host runtime (release.yml, target: selfhost) ----
# No VOLUME, no AUTH_DB_PATH: better-auth never initializes in self-host mode
# (IS_SELF_HOSTED gates every entry point before it's touched — see phase-01), so
# there is no SQLite file to persist and no volume to declare.
FROM runtime-base AS selfhost
USER nextjs
EXPOSE 3000
CMD ["node", "apps/anytools-web/server.js"]

# ---- Hosted runtime (deploy.yml, no --target ⇒ this is the default/last stage) ----
# Coolify: mount a volume to /data. This MUST stay the final stage in this file —
# `deploy.yml` builds without `target:`, and Docker picks the last stage by default.
FROM runtime-base AS runner

# Persist Better Auth SQLite DB across container restarts.
ENV AUTH_DB_PATH=/data/auth.db

RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000

CMD ["node", "apps/anytools-web/server.js"]
