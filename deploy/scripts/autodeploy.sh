#!/usr/bin/env bash
# autodeploy.sh — the server half of .github/workflows/deploy.yml.
#
# Installed on the host as /opt/anytools/bin/autodeploy by
# install-autodeploy.sh, and bound there to one SSH key as its forced command:
# that key can run this script and nothing else, with no shell, pty or
# forwarding. The workflow's only input is the commit, a 40-hex SHA, which
# arrives as SSH_ORIGINAL_COMMAND (or $1 when run by hand).
#
# For that commit it:
#   1. pulls the api and web images Images built and pushed to GHCR
#      (sha-<short>; public, so no registry login on the host);
#   2. fetches deploy/coolify/docker-compose.yml at the same commit and checks
#      it renders, so the stack's shape ships with its code;
#   3. dumps the database, because the next step may migrate it;
#   4. switches the tag and runs the stack (the one-shot `migrate` runs before
#      `api` starts);
#   5. waits for the API, the web server and the public route through Traefik;
#   6. if any of that fails, puts the previous compose file and tag back and
#      restarts `api` and `web` on them. Migrations are forward-only, so the
#      dump from step 3 is printed for a manual restore if the old code cannot
#      run on the new schema.
set -euo pipefail

repo=D0bby999/anytools
images=ghcr.io/d0bby999
dir=/opt/anytools
domain=anytools.world
keep_backups=10

say() { echo "autodeploy: $*"; }
die() { echo "autodeploy: $*" >&2; exit 1; }

sha=${SSH_ORIGINAL_COMMAND:-${1:-}}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "expected a 40-hex commit, got '${sha:0:60}'"
tag="sha-${sha:0:7}"

cd "$dir"
exec 9>"$dir/.autodeploy.lock"
flock 9

envtag() { sed -n 's/^ANYTOOLS_IMAGE_TAG=//p' .env | tail -1; }
settag() { sed -i '/^ANYTOOLS_IMAGE_TAG=/d' .env && echo "ANYTOOLS_IMAGE_TAG=$1" >> .env; }
dc() { docker compose -p anytools "$@"; }

prev=$(envtag)
if [[ $prev == "$tag" ]]; then
  say "$tag is already live"
  exit 0
fi
say "$prev -> $tag"

say "pull images"
docker pull -q "$images/anytools-api:$tag" >/dev/null
docker pull -q "$images/anytools-web:$tag" >/dev/null

say "compose file at ${sha:0:7}"
curl -fsSL --retry 3 -o docker-compose.next.yml \
  "https://raw.githubusercontent.com/$repo/$sha/deploy/coolify/docker-compose.yml"
ANYTOOLS_IMAGE_TAG=$tag dc -f docker-compose.next.yml config -q

say "back up the database"
mkdir -p backups
backup="backups/anytools-$(date -u +%Y%m%d-%H%M%S)-pre-$tag.sql.gz"
user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -1)
dc exec -T postgres pg_dump -U "${user:-anytools}" -d anytools | gzip > "$backup"
# pipefail off for this check only: head closing the pipe early is not a failure.
if ! (set +o pipefail; gzip -dc "$backup" | head -c 4096 | grep -q "PostgreSQL database dump"); then
  rm -f "$backup"
  die "the database dump is empty; nothing was changed"
fi
say "  $backup ($(du -h "$backup" | cut -f1))"
ls -1t backups/anytools-*-pre-*.sql.gz | tail -n +$((keep_backups + 1)) | xargs -r rm -f

cp docker-compose.yml docker-compose.prev.yml
rollback() {
  say "FAILED: $1"
  dc logs --tail 40 migrate api web 2>&1 | sed 's/^/  /' || true
  say "roll back to $prev"
  mv -f docker-compose.prev.yml docker-compose.yml
  settag "$prev"
  dc up -d --no-deps api web || true
  say "the database dump from before this deploy: $dir/$backup"
  exit 1
}

say "start the stack (migrate first)"
mv -f docker-compose.next.yml docker-compose.yml
settag "$tag"
dc up -d --remove-orphans || rollback "docker compose up (a failed migration stops here)"

say "health"
ok=""
for i in $(seq 1 40); do
  if dc exec -T web wget -qO /dev/null http://api:8080/health 2>/dev/null \
    && dc exec -T web wget -qO /dev/null http://127.0.0.1:3000/ 2>/dev/null \
    && curl -fsS -o /dev/null --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/"; then
    ok=1
    say "  api, web and https://$domain/ answer (try $i)"
    break
  fi
  sleep 3
done
[[ -n $ok ]] || rollback "health checks did not pass in 2 minutes"
rm -f docker-compose.prev.yml

# Keep the last three sha- tags of each image; host- tags belong to
# deploy-host.sh, which prunes its own.
for img in anytools-api anytools-web; do
  # `|| true`: grep finding nothing (no older tags yet) is not a failure.
  { docker images "$images/$img" --format '{{.Tag}}' | grep '^sha-' | grep -vx "$tag" || true; } | tail -n +3 \
    | xargs -r -I{} docker rmi -f "$images/$img:{}" >/dev/null
done

say "live: $tag ($(dc ps --format '{{.Service}}={{.State}}' | tr '\n' ' '))"
