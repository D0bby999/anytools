#!/usr/bin/env bash
# setup-server.sh — first-time setup of a fresh Ubuntu/Debian VPS. Run as root,
# once, from the checked-out repo (e.g. /opt/anytools).
#
# Does: Docker Engine + compose plugin, a firewall allowing only 22/80/443, the
# first TLS certificate (certbot standalone, before nginx holds port 80), and
# the hourly backup cron. Does NOT create secrets: .env is the operator's, and
# the encryption key must be escrowed OFF this box before anything is stored
# (docs/deployment.md).
#
# Usage:  ANYTOOLS_DOMAIN=learn.example.com LETSENCRYPT_EMAIL=you@example.com deploy/scripts/setup-server.sh
set -euo pipefail

: "${ANYTOOLS_DOMAIN:?set ANYTOOLS_DOMAIN}"
: "${LETSENCRYPT_EMAIL:?set LETSENCRYPT_EMAIL}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"

[ -f .env ] || { echo "error: $REPO_DIR/.env is missing — copy .env.example and fill it in first" >&2; exit 2; }
grep -q '^ANYTOOLS_ENCRYPTION_KEY=.\+' .env || { echo "error: ANYTOOLS_ENCRYPTION_KEY is empty in .env" >&2; exit 2; }

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null; then
  ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
  ufw --force enable
fi

compose() { docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml "$@"; }

if ! compose run --rm --entrypoint sh certbot -c "test -d /etc/letsencrypt/live/$ANYTOOLS_DOMAIN"; then
  compose run --rm -p 80:80 --entrypoint certbot certbot certonly --standalone \
    -d "$ANYTOOLS_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive
fi

install -d -m 700 /var/backups/anytools
CRON=/etc/cron.d/anytools-backup
cat > "$CRON" <<CRONTAB
SHELL=/bin/bash
# Hourly backup unit (RPO 1 hour). ANYTOOLS_BACKUP_REMOTE comes from .env.
0 * * * * root set -a; . $REPO_DIR/.env; set +a; $REPO_DIR/deploy/scripts/backup.sh >> /var/log/anytools-backup.log 2>&1
CRONTAB
chmod 644 "$CRON"

echo "setup done. Next: deploy/scripts/deploy.sh"
