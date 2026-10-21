#!/usr/bin/env bash
# env-sync.sh pull|push [HOST] — anytools.world's .env, kept locally as
# .env.production (gitignored, mode 600), the way postclaw keeps its own.
#
#   pull  copies the host's /opt/anytools/.env to .env.production, keeping
#         a local copy that differed as .env.production.bak.
#   push  sends .env.production back and restarts the stack with it: the
#         host's .env is backed up first, ANYTOOLS_IMAGE_TAG keeps the host's
#         value (each deploy writes it there, so a local copy is stale), and
#         when the API, the web server or https://anytools.world/ do not
#         answer within two minutes the backup goes back.
#
# Edit .env.production, then push; nothing here prints a value.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
file="$root/.env.production"
cmd=${1:-}
# The host stays out of the repository (the public one included): anytools.world
# sits behind Cloudflare, and its origin's address is not published. It comes
# from ANYTOOLS_DEPLOY_HOST, else ~/.anytools-secrets/deploy-host (user@address).
deploy_host() {
  local h=${ANYTOOLS_DEPLOY_HOST:-$(cat "$HOME/.anytools-secrets/deploy-host" 2>/dev/null)}
  [[ -n $h ]] || { echo "no deploy host: set ANYTOOLS_DEPLOY_HOST or write ~/.anytools-secrets/deploy-host" >&2; exit 1; }
  echo "$h"
}
host=${2:-$(deploy_host)}
ssh_() { ssh -o BatchMode=yes "$host" "$@"; }

case $cmd in
pull)
  umask 077
  ssh_ cat /opt/anytools/.env > "$file.tmp"
  # Edits not pushed yet would be lost: keep the previous copy.
  if [[ -f $file ]] && ! cmp -s "$file" "$file.tmp"; then
    cp -p "$file" "$file.bak"
    echo "env-sync: the previous .env.production differed; kept as .env.production.bak"
  fi
  mv "$file.tmp" "$file"
  chmod 600 "$file"
  echo "env-sync: pulled $(grep -cE '^[A-Z0-9_]+=' "$file") values to .env.production"
  ;;
push)
  [[ -f $file ]] || { echo "env-sync: no .env.production; pull first" >&2; exit 1; }
  grep -qE '^ANYTOOLS_SESSION_SECRET=.' "$file" || { echo "env-sync: .env.production has no session secret; is it the right file?" >&2; exit 1; }
  scp -q "$file" "$host:/opt/anytools/.env.incoming"
  ssh_ bash -s <<'REMOTE'
set -euo pipefail
cd /opt/anytools
dc() { docker compose -p anytools "$@"; }
backup=".env.bak-$(date -u +%Y%m%d-%H%M%S)"
cp -p .env "$backup"
tag=$(sed -n 's/^ANYTOOLS_IMAGE_TAG=//p' .env | tail -1)
grep -v '^ANYTOOLS_IMAGE_TAG=' .env.incoming > .env.new
echo "ANYTOOLS_IMAGE_TAG=$tag" >> .env.new
rm -f .env.incoming
chmod --reference=.env .env.new
mv .env.new .env
# Every probe has its own deadline: a wget left to its 15-minute default
# against an API stuck restarting hung this loop, and with it the way back.
healthy() {
  for _ in $(seq 1 40); do
    if [[ $(dc ps api --format '{{.Status}}') == Up* ]] \
      && timeout 10 docker compose -p anytools exec -T web wget -q -T 5 -O /dev/null http://api:8080/health 2>/dev/null \
      && timeout 10 docker compose -p anytools exec -T web wget -q -T 5 -O /dev/null http://127.0.0.1:3000/ 2>/dev/null \
      && curl -fsS -o /dev/null --max-time 10 --resolve anytools.world:443:127.0.0.1 https://anytools.world/; then
      return 0
    fi
    sleep 3
  done
  return 1
}
timeout 180 docker compose -p anytools up -d >/dev/null 2>&1 || true
if healthy; then
  echo "env-sync: live with the pushed .env ($(grep -cE '^[A-Z0-9_]+=' .env) values, tag $tag); previous in $backup"
else
  echo "env-sync: the stack did not come up; putting $backup back" >&2
  dc logs --tail 20 api 2>&1 | grep -iE 'error|fatal' | tail -5 >&2 || true
  cp -p "$backup" .env
  timeout 180 docker compose -p anytools up -d >/dev/null 2>&1 || true
  healthy && echo "env-sync: back on the previous .env" >&2
  exit 1
fi
REMOTE
  ;;
*)
  echo "usage: env-sync.sh pull|push [HOST]" >&2
  exit 2
  ;;
esac
