#!/usr/bin/env bash
# restore.sh — put one backup unit back, then prove it with `anytools verify`.
#
# DESTRUCTIVE: replaces the database's contents and the data directory's
# contents. Refuses to run without --yes.
#
# Usage:   restore.sh UNIT_DIR --yes
# Needs:   ANYTOOLS_ENCRYPTION_KEY — the ESCROWED key; verify fails without the
#          key the database was written with, which is the point of running it.
source "$(dirname "$0")/lib.sh"

UNIT="${1:-}"
[ -n "$UNIT" ] && [ -d "$UNIT" ] || { echo "usage: restore.sh UNIT_DIR --yes" >&2; exit 2; }
[ "${2:-}" = "--yes" ] || { echo "refusing: this replaces the database and the data directory; pass --yes" >&2; exit 2; }
need ANYTOOLS_ENCRYPTION_KEY
[ -f "$UNIT/SHA256SUMS" ] || { echo "error: $UNIT has no SHA256SUMS — an incomplete unit" >&2; exit 1; }

( cd "$UNIT" && sha256 -c SHA256SUMS )

if [ "$MODE" = compose ]; then
  # Nothing may write while the database and files are being replaced.
  compose stop api web
  compose up -d postgres
fi

restore_db < "$UNIT/db.dump"
restore_data < "$UNIT/data.tar.gz"
echo "$(date -u +%FT%TZ) restore: database and data directory replaced from $UNIT"

verify_restore
echo "$(date -u +%FT%TZ) restore: verify passed"

if [ "$MODE" = compose ]; then
  compose up -d api web
fi
