#!/usr/bin/env bash
# deploy.sh — build, migrate, restart. Run from the repo on the VPS.
#
# Order matters: a backup first (a migration is a schema change, and the rule is
# back up before any), then build, then the one-shot migrate container, then
# the long-running services, then a health check that fails the deploy.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"
set -a; . ./.env; set +a
. deploy/scripts/legacy-env.sh

compose() { docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml "$@"; }

if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  deploy/scripts/backup.sh
fi

export VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
compose build --build-arg VERSION="$VERSION"
compose up -d postgres
compose run --rm migrate
compose up -d api web nginx certbot
# The built-in transcription engine, when the owner turned it on (docs/
# deployment.md, "Built-in transcription"). Not part of the health check: the
# site works without it, and the API offers it only while it answers.
if [ -n "${ANYTOOLS_STT_URL:-}" ]; then
  compose --profile stt up -d stt stt-model
fi
# The built-in voices, on the same terms (docs/deployment.md, "Built-in voices").
if [ -n "${ANYTOOLS_TTS_URL:-}" ]; then
  compose --profile tts up -d tts
fi

for _ in $(seq 1 30); do
  if curl -fsS "https://$ANYTOOLS_DOMAIN/" -o /dev/null; then
    echo "deployed $VERSION: https://$ANYTOOLS_DOMAIN is answering"
    exit 0
  fi
  sleep 2
done
echo "error: https://$ANYTOOLS_DOMAIN did not answer after the deploy" >&2
compose logs --tail 50 api web nginx >&2
exit 1
