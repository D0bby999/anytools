#!/usr/bin/env bash
# pull-backups.sh [HOST] — copies anytools.world's backups off the host.
#
# The host keeps them seven days, on the box only (docs/deployment.md,
# Backups). This pulls them to the owner's machine, where they are kept 30
# days:
#   nightly/     the host's /root/nightly-pg-backup.sh at 03:10 UTC: the
#                database (anytools-<date>.sql.gz) and the learners' files
#                (anytools-data-<date>.tar.gz, without the Drive cache);
#   pre-deploy/  the dump activate.sh takes before every deploy.
# It checks the newest database dump is a real one, and exits non-zero (so
# launchd's log says so) when it is not.
#
# Run daily by launchd (deploy/launchd/world.anytools.backup-pull.plist); a
# Mac asleep at that hour runs it on waking.
set -euo pipefail

# The host stays out of the repository (the public one included): anytools.world
# sits behind Cloudflare, and its origin's address is not published. It comes
# from ANYTOOLS_DEPLOY_HOST, else ~/.anytools-secrets/deploy-host (user@address).
deploy_host() {
  local h=${ANYTOOLS_DEPLOY_HOST:-$(cat "$HOME/.anytools-secrets/deploy-host" 2>/dev/null)}
  [[ -n $h ]] || { echo "no deploy host: set ANYTOOLS_DEPLOY_HOST or write ~/.anytools-secrets/deploy-host" >&2; exit 1; }
  echo "$h"
}
host=${1:-$(deploy_host)}
dest=${ANYTOOLS_BACKUP_DIR:-$HOME/Backups/anytools.world}
keep_days=30

mkdir -p "$dest/nightly" "$dest/pre-deploy"
rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
  --include='anytools-*.sql.gz' --include='anytools-data-*.tar.gz' --exclude='*' \
  "$host:/var/backups/pg/" "$dest/nightly/"
rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=20" "$host:/opt/anytools/backups/" "$dest/pre-deploy/"

newest=$(ls -1t "$dest"/nightly/anytools-2*.sql.gz 2>/dev/null | head -1)
[[ -n $newest ]] || { echo "pull-backups: no database dump arrived" >&2; exit 1; }
# pipefail off for this check only: head closing the pipe early is not a failure.
if ! (set +o pipefail; gzip -dc "$newest" | head -c 4096 | grep -q "PostgreSQL database dump"); then
  echo "pull-backups: $newest is not a database dump" >&2
  exit 1
fi
age_days=$(( ( $(date +%s) - $(stat -f %m "$newest") ) / 86400 ))
(( age_days <= 2 )) || echo "pull-backups: the newest dump is $age_days days old; is the host's nightly job running?" >&2

find "$dest" -type f -mtime +"$keep_days" -delete
echo "[$(date '+%F %T')] pull-backups: ok, newest $(basename "$newest"), $(du -sh "$dest" | cut -f1) in $dest"
