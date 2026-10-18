#!/usr/bin/env bash
# deploy-host.sh HOST [--private]
#
# Deploys AnyTools to one Docker host that already runs a Traefik on the
# external `coolify` network (Coolify's proxy), without a registry:
#
#   1. builds here: the Go API for linux/amd64, and the web app (`pnpm build`,
#      which also stages tool-runtime/);
#   2. copies those artifacts to HOST:/opt/anytools and wraps them there in
#      runtime-only images (no compiler runs on the host, so the 4 GB box and
#      its other sites keep their memory);
#   3. writes /opt/anytools/.env once, with fresh secrets, and never again
#      (ANYTOOLS_ENCRYPTION_KEY must not change after first boot);
#   4. runs deploy/coolify/docker-compose.yml there.
#
# --private starts the stack with Traefik ignoring `web`, so it can be checked
# from inside the host before it takes the domain. Run again without it to
# switch the domain over.
set -euo pipefail

host=${1:?usage: deploy-host.sh HOST [--private]}
private=${2:-}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sha=$(git -C "$root" rev-parse --short HEAD)
tag="host-$sha"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

[[ -z "$(git -C "$root" status --porcelain -- cmd internal migrations ui/web/app ui/web/package.json)" ]] \
  || { echo "error: uncommitted changes; deploy a commit" >&2; exit 2; }

echo "== build api ($sha)"
mkdir -p "$stage/api"
( cd "$root" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w -X github.com/D0bby999/anytools/cmd/anytools/cli.Version=$sha" \
    -o "$stage/api/anytools" ./cmd/anytools )
cp -R "$root/migrations" "$stage/api/migrations"
# Dockerfile.api's yt-dlp and runtime stages, with the compiled binary copied
# in instead of built.
awk '/^FROM alpine:3.21 AS ytdlp/{p=1} p' "$root/deploy/Dockerfile.api" \
  | sed 's#^COPY --from=build /out/anytools /app/anytools#COPY anytools /app/anytools#' > "$stage/api/Dockerfile"
grep -q '^COPY anytools /app/anytools' "$stage/api/Dockerfile" || { echo "error: Dockerfile.api changed shape" >&2; exit 1; }

echo "== build web"
( cd "$root/ui/web" && pnpm install --frozen-lockfile --prefer-offline >/dev/null && pnpm build >/dev/null && node scripts/ssr-smoke.mjs )
mkdir -p "$stage/web"
for d in build public tool-runtime package.json pnpm-lock.yaml; do cp -R "$root/ui/web/$d" "$stage/web/"; done
cat > "$stage/web/Dockerfile" <<'DOCKERFILE'
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY build ./build
COPY public ./public
COPY tool-runtime ./tool-runtime
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
DOCKERFILE
cp "$root/deploy/coolify/docker-compose.yml" "$stage/docker-compose.yml"

echo "== copy to $host"
ssh -o BatchMode=yes "$host" 'mkdir -p /opt/anytools && rm -rf /opt/anytools/stage'
rsync -a --delete "$stage/" "$host:/opt/anytools/stage/"

echo "== images and stack on $host"
ssh -o BatchMode=yes "$host" TAG="$tag" PRIVATE="$private" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/anytools
mv stage/docker-compose.yml docker-compose.yml
docker build -q -t "ghcr.io/d0bby999/anytools-api:$TAG" stage/api >/dev/null
docker build -q -t "ghcr.io/d0bby999/anytools-web:$TAG" stage/web >/dev/null
rm -rf stage

if [[ ! -f .env ]]; then
  umask 077
  pw=$(openssl rand -hex 24)
  cat > .env <<ENV
POSTGRES_PASSWORD=$pw
ANYTOOLS_POSTGRES_DSN=postgres://anytools:$pw@postgres:5432/anytools?sslmode=disable
ANYTOOLS_GATEWAY_TOKEN=$(openssl rand -hex 32)
ANYTOOLS_ENCRYPTION_KEY=$(openssl rand -hex 32)
ANYTOOLS_SESSION_SECRET=$(openssl rand -hex 32)
ANYTOOLS_PULL_POLICY=never
ENV
  echo "wrote /opt/anytools/.env (escrow ANYTOOLS_ENCRYPTION_KEY off this host)"
fi
sed -i '/^ANYTOOLS_IMAGE_TAG=/d' .env && echo "ANYTOOLS_IMAGE_TAG=$TAG" >> .env

files=(-f docker-compose.yml)
if [[ "$PRIVATE" == "--private" ]]; then
  printf 'services:\n  web:\n    labels:\n      - traefik.enable=false\n' > private.yml
  files+=(-f private.yml)
fi
docker compose -p anytools "${files[@]}" up -d --remove-orphans
docker compose -p anytools "${files[@]}" ps --format '{{.Service}} {{.State}} {{.Status}}'
# Keep the last three host-built tags of each image.
for img in anytools-api anytools-web; do
  docker images "ghcr.io/d0bby999/$img" --format '{{.Tag}}' | grep '^host-' | tail -n +4 \
    | xargs -r -I{} docker rmi -f "ghcr.io/d0bby999/$img:{}" >/dev/null
done
REMOTE
echo "deployed $tag to $host"
