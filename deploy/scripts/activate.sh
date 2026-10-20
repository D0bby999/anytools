#!/usr/bin/env bash
# activate.sh TAG — the host half of deploy-host.sh.
#
# deploy-host.sh builds on the owner's machine, copies the result to
# /opt/anytools/stage, builds the two runtime images there as
# ghcr.io/d0bby999/anytools-{api,web}:TAG, puts the commit's compose file at
# docker-compose.next.yml, and then runs this. For TAG it:
#   1. checks both images exist and the compose file renders;
#   2. dumps the database, because the next step may migrate it;
#   3. switches the tag and runs the stack (the one-shot `migrate` runs before
#      `api` starts);
#   4. waits for the API, the web server and the public route through Traefik;
#   5. if any of that fails, puts the previous compose file and tag back and
#      restarts `api` and `web` on them. Migrations are forward-only, so the
#      dump from step 2 is printed for a manual restore if the old code cannot
#      run on the new schema.
set -euo pipefail

images=ghcr.io/d0bby999
dir=/opt/anytools
domain=anytools.world
keep_backups=10

say() { echo "activate: $*"; }
die() { echo "activate: $*" >&2; exit 1; }

tag=${1:-}
[[ $tag =~ ^host-[0-9a-f]{7,12}$ ]] || die "expected host-<commit>, got '${tag:0:60}'"

cd "$dir"
exec 9>"$dir/.activate.lock"
flock 9

envtag() { sed -n 's/^ANYTOOLS_IMAGE_TAG=//p' .env | tail -1; }
settag() { sed -i '/^ANYTOOLS_IMAGE_TAG=/d' .env && echo "ANYTOOLS_IMAGE_TAG=$1" >> .env; }
dc() { docker compose -p anytools "$@"; }

prev=$(envtag)
if [[ $prev == "$tag" ]]; then
  say "$tag is already live"
  rm -f docker-compose.next.yml
  exit 0
fi
say "$prev -> $tag"

for img in anytools-api anytools-web; do
  docker image inspect "$images/$img:$tag" >/dev/null 2>&1 || die "no image $img:$tag; nothing was changed"
done
[[ -f docker-compose.next.yml ]] || die "no docker-compose.next.yml; nothing was changed"
ANYTOOLS_IMAGE_TAG=$tag dc -f docker-compose.next.yml config -q

say "back up the database"
mkdir -p backups
backup="backups/anytools-$(date -u +%Y%m%d-%H%M%S)-pre-$tag.sql.gz"
user=$(sed -n 's/^POSTGRES_USER=//p' .env | tail -1)
if dc ps --status running --services 2>/dev/null | grep -qx postgres; then
  dc exec -T postgres pg_dump -U "${user:-anytools}" -d anytools | gzip > "$backup"
  # pipefail off for this check only: head closing the pipe early is not a failure.
  if ! (set +o pipefail; gzip -dc "$backup" | head -c 4096 | grep -q "PostgreSQL database dump"); then
    rm -f "$backup"
    die "the database dump is empty; nothing was changed"
  fi
  say "  $backup ($(du -h "$backup" | cut -f1))"
  ls -1t backups/anytools-*-pre-*.sql.gz | tail -n +$((keep_backups + 1)) | xargs -r rm -f
else
  say "  no running database yet (first deploy); nothing to dump"
fi

[[ -f docker-compose.yml ]] && cp docker-compose.yml docker-compose.prev.yml
rollback() {
  say "FAILED: $1"
  dc logs --tail 40 migrate api web 2>&1 | sed 's/^/  /' || true
  if [[ -z $prev || ! -f docker-compose.prev.yml ]]; then
    say "nothing to roll back to (first deploy)"
    exit 1
  fi
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

# Keep the live tag and the two before it (rollback targets) of each image;
# drop the older ones, and the sha- tags GHCR deploys left behind.
for img in anytools-api anytools-web; do
  # `|| true`: grep finding nothing (no older tags yet) is not a failure.
  { docker images "$images/$img" --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r | cut -f2 \
      | grep -E '^host-' | grep -vx "$tag" || true; } | tail -n +3 \
    | xargs -r -I{} docker rmi -f "$images/$img:{}" >/dev/null
  { docker images "$images/$img" --format '{{.Tag}}' | grep -E '^sha-' || true; } \
    | xargs -r -I{} docker rmi -f "$images/$img:{}" >/dev/null
done
docker image prune -f >/dev/null

say "live: $tag ($(dc ps --format '{{.Service}}={{.State}}' | tr '\n' ' '))"
