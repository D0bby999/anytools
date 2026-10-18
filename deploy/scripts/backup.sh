#!/usr/bin/env bash
# backup.sh — one backup unit: the database AND the data directory, together.
#
# A database without its files lists documents that never open; files without
# the database are unreadable blobs. So both go into one timestamped directory
# with a checksum file, and a unit is only complete once SHA256SUMS exists.
#
# The encryption key is NOT in the backup, on purpose: a backup that carries
# its own key decrypts every stored API key for whoever gets the backup. The
# key is escrowed separately (docs/deployment.md).
#
# Usage:   backup.sh [OUT_DIR]          (default $ANYTOOLS_BACKUP_DIR or /var/backups/anytools)
# Env:     ANYTOOLS_BACKUP_KEEP_DAYS    retention, default 7
#          ANYTOOLS_BACKUP_REMOTE       rsync destination for the off-box copy
#                                       (e.g. backup@host:/srv/anytools); required
#                                       in compose mode unless ANYTOOLS_BACKUP_NO_REMOTE=1
# Cron:    0 * * * * /opt/anytools/deploy/scripts/backup.sh >> /var/log/anytools-backup.log 2>&1
source "$(dirname "$0")/lib.sh"

OUT="${1:-${ANYTOOLS_BACKUP_DIR:-/var/backups/anytools}}"
KEEP_DAYS="${ANYTOOLS_BACKUP_KEEP_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
UNIT="$OUT/$STAMP"

if [ "$MODE" = compose ] && [ -z "${ANYTOOLS_BACKUP_REMOTE:-}" ] && [ "${ANYTOOLS_BACKUP_NO_REMOTE:-0}" != 1 ]; then
  echo "error: ANYTOOLS_BACKUP_REMOTE is not set; a backup that never leaves the VPS dies with it" >&2
  exit 2
fi

umask 077
mkdir -p "$UNIT"
# A unit that failed half-way is removed rather than left looking like a
# backup; only a unit with SHA256SUMS is ever complete.
trap '[ -f "$UNIT/SHA256SUMS" ] || rm -rf "$UNIT"' EXIT

dump_db > "$UNIT/db.dump"
archive_data > "$UNIT/data.tar.gz"
( cd "$UNIT" && sha256 db.dump data.tar.gz > SHA256SUMS )
echo "$(date -u +%FT%TZ) backup: $UNIT ($(du -sh "$UNIT" | cut -f1))"

if [ -n "${ANYTOOLS_BACKUP_REMOTE:-}" ]; then
  rsync -a "$UNIT" "$ANYTOOLS_BACKUP_REMOTE/"
  echo "$(date -u +%FT%TZ) backup: copied off-box to $ANYTOOLS_BACKUP_REMOTE"
fi

# Retention: only directories that look like units, only past the window.
find "$OUT" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
