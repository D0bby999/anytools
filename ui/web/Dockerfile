# syntax=docker/dockerfile:1

# ---- dependencies -----------------------------------------------------------
FROM node:22-alpine AS deps

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- production dependencies ------------------------------------------------
FROM node:22-alpine AS prod-deps

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
# Tools' run-time files (wasm, models, fonts), served by routes/tool-runtime.$.ts.
COPY --from=build /app/tool-runtime ./tool-runtime
COPY package.json server.mjs ./

# node:22-alpine ships an unprivileged `node` user; the server only reads.
USER node

EXPOSE 3000
CMD ["node", "server.mjs"]
