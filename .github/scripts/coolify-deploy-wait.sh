#!/usr/bin/env bash
# Trigger a Coolify deploy for one app and block until it finishes (or fails).
# Keeps the GitHub Actions step running for the whole deploy so the next app's
# step (and any queued workflow run) cannot start a second build concurrently.
#
# Usage: coolify-deploy-wait.sh <app_uuid> <label>
# Env:   COOLIFY (base url), TOKEN (Coolify API bearer)
set -euo pipefail

UUID="$1"; LABEL="${2:-$1}"
: "${COOLIFY:?need COOLIFY}"; : "${TOKEN:?need TOKEN}"

echo "→ deploying $LABEL ($UUID)"
DEP=$(curl -fsS "$COOLIFY/api/v1/deploy?uuid=$UUID&force=true" \
        -H "Authorization: Bearer $TOKEN" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["deployments"][0]["deployment_uuid"])')
echo "  deployment uuid: $DEP"

# Poll up to ~12 min (next build on the small box can be slow under load).
for i in $(seq 1 72); do
  S=$(curl -fsS "$COOLIFY/api/v1/deployments/$DEP" -H "Authorization: Bearer $TOKEN" \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);o=d[0] if isinstance(d,list) and d else d;print(o.get("status",""))')
  echo "  [$i] $LABEL: $S"
  case "$S" in
    finished|success) echo "✓ $LABEL deployed"; exit 0;;
    failed|error) echo "✗ $LABEL deploy failed"; exit 1;;
    cancelled*|canceled*) echo "✗ $LABEL deploy cancelled"; exit 1;;
  esac
  sleep 10
done
echo "✗ $LABEL timed out waiting for deploy"; exit 1
